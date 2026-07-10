import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { helperPath } from './helper-path'
import { BaseCaptureEngine, type CaptureStartOptions } from './engine'
import { AssemblyAiStream, STREAM_SAMPLE_RATE } from './assemblyai.stream'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'
import type { MicControlPort, SttTokenProvider } from './assemblyai.engine'

// Motor "fase 2c": DOS canales STT con separación de hablantes de fábrica.
//   - "You"  → micrófono capturado por el helper con voice processing
//     (la AEC del sistema resta lo que suena por los parlantes → la voz de
//     los demás no se duplica en tu canal, incluso sin audífonos)
//   - "Them" → audio del sistema vía Core Audio process tap (patrón
//     Granola — ver native/audio-helper/main.swift)
//
// Protocolo del helper: frames binarios de 1601 bytes por stdout =
// [1 byte canal (0=mic, 1=sistema)][1600 bytes PCM16LE mono 16 kHz].
//
// Degradación: si el helper no arranca o muere (típicamente falta el
// permiso TCC de System Audio Recording), caemos al mic del renderer
// (comportamiento 2b) con aviso visible — la sesión nunca se tumba.

const PCM_BYTES = 1600 // 800 samples * 2 = 50 ms
const FRAME_BYTES = 1 + PCM_BYTES
const CHANNEL_MIC = 0

// --- Dedup textual de eco (la red final, determinística) ---
// El AEC + gate eliminan la mayoría del eco acústico, pero a volumen alto
// de parlantes pueden fugarse ráfagas que el STT transcribe. El eco tiene
// una firma inconfundible A NIVEL DE TEXTO: produce las MISMAS palabras que
// el canal del sistema. Si un turno de "You" es mayormente un subconjunto
// de lo que "Them" dijo en la ventana reciente, es eco → se descarta antes
// de emitir. Ataca el síntoma exactamente donde importa (el transcript) sin
// depender de la física del audio.

const ECHO_TEXT_WINDOW_MS = 30_000
const ECHO_MIN_TOKENS = 4 // turnos cortos ("ok", "sí, claro") nunca se filtran
const ECHO_OVERLAP = 0.65

// Palabras función del español/inglés: no cuentan como evidencia de eco
// (coinciden entre hablantes por azar). Solo las palabras de contenido votan.
const STOPWORDS = new Set(
  ('de la que el en y a los se del las un por con no una su para es al lo como ' +
    'mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien ' +
    'me hasta hay donde quien desde todo nos durante todos uno les ni contra ' +
    'otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra ' +
    'el tanto esa estos mucho quienes nada muchos cual poco ella estar estas ' +
    'algunas algo nosotros the a an and or but if of to in on for with at by ' +
    'is are was were be been it this that these those i you he she we they').split(' '),
)

/** Tokens de contenido normalizados (minúsculas, sin tildes ni puntuación). */
function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

export class NativeCaptureEngine extends BaseCaptureEngine {
  private readonly you: AssemblyAiStream
  private readonly them: AssemblyAiStream
  private helper: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private stdoutRemainder: Buffer = Buffer.alloc(0)
  private stopping = false
  // Pausa suave en curso: el helper sigue vivo pero con la captura detenida.
  // Distingue una muerte del helper "durante la pausa" (no hacer fallback al
  // mic del renderer) de una caída real durante la captura.
  private paused = false
  private rendererMicActive = false
  private micReady = false
  private statusByChannel = new Map<string, CaptureStatus>()

  constructor(
    api: SttTokenProvider,
    private readonly mic: MicControlPort,
  ) {
    super()
    this.you = new AssemblyAiStream(api, { speaker: 'You', channel: 'you' })
    this.them = new AssemblyAiStream(api, { speaker: 'Them', channel: 'them' })
    for (const [channel, stream] of [
      ['you', this.you],
      ['them', this.them],
    ] as const) {
      stream.on('segment', (s: CaptionSegment) => {
        if (channel === 'them') {
          // Referencia para el dedup: TODAS las versiones del turno (los
          // parciales llegan en ~1s, mucho antes de que el eco finalice).
          this.rememberThemText(s.text)
        } else if (this.looksLikeEcho(s.text)) {
          console.log(`[echo-dedup] You descartado (eco textual de Them): "${s.text.slice(0, 70)}"`)
          return
        }
        this.emitSegment(s)
      })
      stream.on('status', (status: CaptureStatus, detail?: string) => {
        this.statusByChannel.set(channel, status)
        this.emitAggregateStatus(detail)
      })
    }
  }

  // Textos recientes del canal sistema (tokens de contenido + timestamp).
  private themRecent: Array<{ tokens: Set<string>; at: number }> = []

  private rememberThemText(text: string): void {
    const tokens = new Set(contentTokens(text))
    if (tokens.size === 0) return
    const now = Date.now()
    this.themRecent.push({ tokens, at: now })
    while (this.themRecent.length > 0 && now - this.themRecent[0].at > ECHO_TEXT_WINDOW_MS) {
      this.themRecent.shift()
    }
  }

  /**
   * ¿Este texto de "You" es eco de lo que sonó por el sistema? Verdadero si
   * la mayoría de sus palabras de contenido aparecen en lo que "Them" dijo
   * en la ventana reciente. Turnos cortos nunca se filtran (sin evidencia
   * suficiente, gana el usuario).
   */
  private looksLikeEcho(text: string): boolean {
    const words = contentTokens(text)
    if (words.length < ECHO_MIN_TOKENS) return false
    const now = Date.now()
    const seen = new Set<string>()
    for (const entry of this.themRecent) {
      if (now - entry.at <= ECHO_TEXT_WINDOW_MS) {
        for (const w of entry.tokens) seen.add(w)
      }
    }
    if (seen.size === 0) return false
    const hits = words.reduce((n, w) => (seen.has(w) ? n + 1 : n), 0)
    return hits / words.length >= ECHO_OVERLAP
  }

  /**
   * Si cualquier canal está reconectando, la sesión está reconectando.
   * 'recording' requiere además que el mic nativo ya haya confirmado su
   * primer frame real — si no, la sesión está 'starting' (ver CaptureStatus).
   */
  private emitAggregateStatus(detail?: string): void {
    if (this.stopping) return
    const statuses = [...this.statusByChannel.values()]
    const status: CaptureStatus = statuses.includes('reconnecting')
      ? 'reconnecting'
      : this.micReady || this.rendererMicActive
        ? 'recording'
        : 'starting'
    this.emitStatus(status, detail)
  }

  async start(opts?: CaptureStartOptions): Promise<void> {
    this.stopping = false
    this.micReady = false
    // El canal del mic es el principal: si su STT falla, la sesión falla.
    await this.you.start(opts)
    try {
      await this.them.start(opts)
      this.spawnHelper()
    } catch (err) {
      console.error('[native] canal de sistema no disponible:', err)
      await this.them.stop()
      this.fallbackToRendererMic('System audio unavailable — only your microphone is being transcribed.')
    }
  }

  private spawnHelper(): void {
    const bin = helperPath()
    let helper: ChildProcessByStdio<Writable, Readable, Readable>
    try {
      helper = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      this.onHelperGone(`no se pudo lanzar el helper (${String(err)})`)
      return
    }
    this.helper = helper

    helper.stdout.on('data', (data: Buffer) => {
      this.stdoutRemainder = Buffer.concat([this.stdoutRemainder, data])
      while (this.stdoutRemainder.length >= FRAME_BYTES) {
        const channel = this.stdoutRemainder[0]
        const pcm = this.stdoutRemainder.subarray(1, FRAME_BYTES)
        this.stdoutRemainder = this.stdoutRemainder.subarray(FRAME_BYTES)
        if (channel === CHANNEL_MIC) {
          this.you.acceptAudio(pcm)
          if (!this.micReady) {
            this.micReady = true
            this.emitAggregateStatus()
          }
        } else {
          this.them.acceptAudio(pcm)
        }
      }
    })
    helper.stderr.on('data', (data: Buffer) => {
      process.stderr.write(data)
    })
    // Escribir un comando a un helper ya muerto emite 'error' (EPIPE) de forma
    // ASÍNCRONA — el try/catch alrededor del write NO lo atrapa; sin este
    // listener tumbaría el proceso main. El 'exit'/'error' del hijo hace el
    // resto (fallback o respawn).
    helper.stdin.on('error', (err) => console.warn('[native] stdin del helper:', err.message))
    helper.on('error', (err) => this.onHelperGone(err.message))
    helper.on('exit', (code) => {
      if (!this.stopping) this.onHelperGone(`helper terminó con código ${code}`)
    })
  }

  /**
   * Pausa CALIENTE: el helper sigue vivo con el voice processing armado (solo
   * pausa sus motores de audio, comando "pause" por stdin), y paramos los
   * canales STT (dejamos de transcribir/consumir cuota). El resume vuelve en
   * ~0.2s en vez de re-pagar el ~1s de re-armar el VP de Apple.
   */
  async pauseCapture(): Promise<void> {
    this.paused = true
    try {
      this.helper?.stdin.write('pause\n')
    } catch {
      // El EPIPE async lo maneja el listener de stdin; el 'exit' del helper
      // solo anula la referencia (sin fallback) porque estamos pausados.
    }
    this.micReady = false
    await Promise.all([this.you.stop(), this.them.stop()])
  }

  /** Reanuda: reabre los canales STT (tramo nuevo) y despierta al helper. */
  async resumeCapture(opts?: CaptureStartOptions): Promise<void> {
    this.stopping = false
    this.paused = false
    this.micReady = false
    // start() marca el stream como receptivo (stopping=false) de forma
    // SÍNCRONA antes de conectar, así que despertamos al helper en paralelo:
    // sus frames se encolan en el backlog del stream hasta que el WS abre (sin
    // pérdida) y el mic vuelve a ~0.2s en vez de esperar la reconexión STT.
    const youStarted = this.you.start(opts)
    const themStarted = this.them.start(opts)
    if (this.helper) {
      try {
        this.helper.stdin.write('resume\n')
      } catch {
        // idem: el listener de stdin maneja el EPIPE.
      }
    } else {
      // El helper murió durante la pausa: arrancar uno nuevo (paga el ~1s del
      // VP, pero solo en este caso de recuperación, no en el resume normal).
      this.spawnHelper()
    }
    await youStarted
    try {
      await themStarted
    } catch (err) {
      console.error('[native] canal de sistema no disponible al reanudar:', err)
    }
  }

  private onHelperGone(reason: string): void {
    console.error('[native] helper de audio caído:', reason)
    this.helper = null
    // Si murió estando pausado, NO abrir el mic del renderer (la sesión está
    // en pausa — encender el mic con la UI en "pausa" sería un bug de
    // confianza). El resume respawnea un helper limpio.
    if (this.paused) return
    void this.them.stop()
    this.fallbackToRendererMic(
      'System audio stopped — check System Audio Recording permission. Your microphone keeps working.',
    )
  }

  /** Sin helper no hay mic nativo: volver al mic del renderer (modo 2b). */
  private fallbackToRendererMic(notice: string): void {
    if (this.stopping || this.rendererMicActive) return
    this.rendererMicActive = true
    this.mic.start(STREAM_SAMPLE_RATE)
    this.emitStatus('recording', notice)
  }

  setNetworkOnline(online: boolean): void {
    this.you.setNetworkOnline(online)
    this.them.setNetworkOnline(online)
  }

  streamedSeconds(): number {
    return this.you.streamedSeconds() + this.them.streamedSeconds()
  }

  /** Chunks del mic del renderer: solo se usan en el modo fallback. */
  acceptAudio(chunk: ArrayBuffer): void {
    if (this.rendererMicActive) this.you.acceptAudio(chunk)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.rendererMicActive) {
      this.mic.stop()
      this.rendererMicActive = false
    }
    if (this.helper) {
      // ESPERAR a que el helper muera antes de resolver: si el usuario
      // hace stop→start rápido, dos motores de voz conviviendo dejan mudo
      // el mic de la sesión nueva.
      const helper = this.helper
      this.helper = null
      await new Promise<void>((resolve) => {
        const done = (): void => resolve()
        helper.once('exit', done)
        try {
          helper.stdin.end() // salida limpia (EOF)
        } catch {
          // seguir con el kill
        }
        setTimeout(() => helper.kill('SIGTERM'), 300)
        setTimeout(() => {
          helper.removeListener('exit', done)
          helper.kill('SIGKILL')
          resolve()
        }, 1200)
      })
    }
    await Promise.all([this.you.stop(), this.them.stop()])
    this.emitStatus('idle')
  }
}
