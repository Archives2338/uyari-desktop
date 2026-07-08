import { BaseCaptureEngine } from './engine'

// Motor de captura "fase 2b": micrófono → AssemblyAI Universal-Streaming.
// Patrón Granola verificado: el main pide un token efímero al backend y
// abre el WebSocket DIRECTO al proveedor; el audio nunca toca nuestro
// backend, solo el texto resultante (vía MeetingService).
//
// API verificada contra el servicio real (jul 2026):
//   wss://streaming.assemblyai.com/v3/ws
//     ?token=<efímero> &sample_rate=16000 &encoding=pcm_s16le
//     &speech_model=universal-streaming-multilingual &format_turns=true
//   ('pcm16' NO es válido → 3006. Validador: scratchpad/test-aai.mjs)
//   Audio: frames binarios PCM16 mono de ~50 ms (800 samples a 16 kHz).
//   Un Turn se re-emite mientras se finalizan palabras → mismo turn_order
//   = mismo segmento (el dedupe por providerMessageId lo pisa).
//   Cierre limpio: enviar {type:'Terminate'} antes de cerrar.
//
// RESILIENCIA (fase "gap 1"):
//   - Corte inesperado del WS → status 'reconnecting' + backoff (el mic
//     sigue vivo; los chunks se acumulan en un backlog acotado).
//   - Al reabrir, el backlog se envía de golpe: verificado empíricamente
//     que AssemblyAI acepta ráfagas de ≥10 s más rápido que tiempo real
//     (scratchpad/test-aai-burst.mjs) → no se pierden palabras.
//   - La sesión de AssemblyAI dura máx. 3 h → rotación PROACTIVA 5 min
//     antes del límite (cierre limpio + sesión nueva, mismo backlog).
//   - Cada (re)conexión es una "época": los providerMessageId llevan la
//     época (aai-<época>-<turn>) para que los turn_order que se reinician
//     en la sesión nueva no pisen segmentos de la anterior, y los offsets
//     se corrigen sumando el inicio de la época.

export const MIC_SAMPLE_RATE = 16000
const WS_BASE = 'wss://streaming.assemblyai.com/v3/ws'

// 3 h que impone AssemblyAI menos margen para rotar sin cortes.
const SESSION_ROTATE_MS = (10800 - 300) * 1000
// Backlog máx. durante un corte: 5 min de audio (6000 chunks ≈ 9.6 MB).
const MAX_BACKLOG_CHUNKS = 6000
// Tope corto: al volver la red conviene reconectar en segundos, no en 30 s.
const BACKOFF_MS = [1000, 2000, 4000, 8000, 10000]

// Detección de conexión estancada. Apagar el WiFi NO cierra el socket:
// TCP se queda mudo y ws.send() acumula bytes en bufferedAmount sin que
// llegue onclose (puede tardar minutos). Vigilamos bufferedAmount: si
// crece sostenido, damos la conexión por muerta y forzamos la reconexión.
const STALL_CHECK_MS = 2000
const STALL_THRESHOLD_BYTES = 16000 // ≈ 0.5 s de audio sin poder salir
const STALL_STRIKES = 3 // ~6 s estancado → reconectar
// Ventana de chunks ya "enviados" para rescatar los que quedaron varados
// en el buffer del socket muerto (bufferedAmount nos dice cuántos bytes
// nunca salieron de la máquina → se re-encolan sin duplicar audio).
const RECENT_SENT_MAX = 1200 // 60 s

interface TurnMessage {
  type: 'Turn'
  turn_order: number
  end_of_turn: boolean
  transcript: string
  turn_is_formatted: boolean
  words?: Array<{ text: string; start: number; end: number; confidence: number }>
}

export interface MicControlPort {
  start(sampleRate: number): void
  stop(): void
}

export interface SttTokenProvider {
  sttToken(): Promise<{ token: string }>
}

export class AssemblyAiMicEngine extends BaseCaptureEngine {
  private ws: WebSocket | null = null
  private stopping = false
  private chunksSent = 0

  // Vida completa de la captura (cruza reconexiones)
  private captureStartMs = 0
  private epoch = 0
  private epochStartOffsetMs = 0

  private backlog: Buffer[] = []
  private droppedChunks = 0
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private rotateTimer: NodeJS.Timeout | null = null

  private recentSent: Buffer[] = []
  private stallTimer: NodeJS.Timeout | null = null
  private stallStrikes = 0

  constructor(
    private readonly api: SttTokenProvider,
    private readonly mic: MicControlPort,
  ) {
    super()
  }

  async start(): Promise<void> {
    this.stopping = false
    this.captureStartMs = Date.now()
    // La primera conexión sí propaga el error (sin token no hay sesión y
    // el usuario debe verlo); las reconexiones se manejan solas.
    await this.connect()
    this.mic.start(MIC_SAMPLE_RATE)
  }

  private async connect(): Promise<void> {
    const { token } = await this.api.sttToken()

    const url = new URL(WS_BASE)
    url.searchParams.set('token', token)
    url.searchParams.set('sample_rate', String(MIC_SAMPLE_RATE))
    url.searchParams.set('encoding', 'pcm_s16le')
    url.searchParams.set('speech_model', 'universal-streaming-multilingual')
    url.searchParams.set('format_turns', 'true')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onopen = () => {
        this.epoch += 1
        this.epochStartOffsetMs = Date.now() - this.captureStartMs
        this.reconnectAttempt = 0
        this.recentSent = []
        console.log(`[stt] WebSocket abierto (época ${this.epoch})`)
        this.flushBacklog()
        this.scheduleRotation()
        this.startStallWatch(ws)
        this.emitStatus('recording')
        resolve()
      }
      ws.onmessage = (ev) => this.onMessage(ev)
      ws.onerror = () => {
        reject(new Error('WebSocket STT falló al conectar'))
        this.onConnectionLost('error de conexión')
      }
      ws.onclose = (ev) => {
        const detail = `${ev.code}${ev.reason ? `: ${ev.reason}` : ''}`
        this.onConnectionLost(detail)
      }
    })
  }

  /**
   * Vigila bufferedAmount: si el audio no puede salir (WiFi caído sin que
   * TCP lo note), forzamos el cierre y rescatamos al backlog los chunks
   * que quedaron varados en el buffer del socket — no se pierden.
   */
  private startStallWatch(ws: WebSocket): void {
    this.stallStrikes = 0
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.stallTimer = setInterval(() => {
      if (this.ws !== ws) return
      if (ws.bufferedAmount > STALL_THRESHOLD_BYTES) {
        this.stallStrikes += 1
      } else {
        this.stallStrikes = 0
      }
      if (this.stallStrikes < STALL_STRIKES) return
      this.forceDisconnect('conexión estancada — ¿sin red?')
    }, STALL_CHECK_MS)
  }

  /**
   * Da la conexión actual por muerta: rescata al backlog los chunks que
   * quedaron varados en el buffer del socket (bufferedAmount = bytes que
   * nunca salieron de la máquina, así que no se duplica audio) y entra al
   * ciclo de reconexión.
   */
  private forceDisconnect(reason: string): void {
    const ws = this.ws
    if (!ws) return
    const stranded = Math.min(Math.ceil(ws.bufferedAmount / 1600), this.recentSent.length)
    if (stranded > 0) {
      this.backlog.unshift(...this.recentSent.slice(-stranded))
    }
    console.warn(`[stt] ${reason} (${ws.bufferedAmount} bytes sin salir), rescatados ${stranded} chunks`)
    this.ws = null
    ws.onclose = null // cierre provocado: la reconexión la manejamos aquí
    try {
      ws.close()
    } catch {
      // ya está muerta
    }
    this.onConnectionLost(reason)
  }

  /**
   * Señal instantánea de conectividad desde el renderer (navigator
   * online/offline). Offline → desconectar ya (aviso inmediato al usuario,
   * audio al backlog). Online → reintentar ya, sin esperar el backoff.
   */
  setNetworkOnline(online: boolean): void {
    if (this.stopping) return
    if (!online) {
      this.forceDisconnect('sin conexión de red')
      return
    }
    if (this.ws) return // la conexión sobrevivió, nada que hacer
    console.log('[stt] red de vuelta: reintentando ya')
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.connect().catch(() => this.scheduleReconnect())
  }

  private onConnectionLost(detail: string): void {
    if (this.stopping) return
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.stallTimer = null
    this.ws = null
    console.warn(`[stt] conexión perdida (${detail}), reintentando…`)
    this.emitStatus('reconnecting', detail)
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) return
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)]
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopping) return
      this.connect().catch((err: unknown) => {
        // Token o handshake fallaron (p.ej. backend caído): seguir
        // reintentando; el audio se acumula en el backlog mientras tanto.
        console.warn('[stt] reintento fallido:', err instanceof Error ? err.message : err)
        this.scheduleReconnect()
      })
    }, delay)
  }

  /** Rotación proactiva antes del tope de 3 h de AssemblyAI. */
  private scheduleRotation(): void {
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    this.rotateTimer = setTimeout(() => {
      if (this.stopping || !this.ws) return
      console.log('[stt] rotando sesión antes del límite de 3 h')
      const ws = this.ws
      this.ws = null // los chunks pasan al backlog mientras rota
      try {
        ws.onclose = null // cierre esperado: no dispara reconexión doble
        ws.send(JSON.stringify({ type: 'Terminate' }))
        ws.close()
      } catch {
        // seguir con la sesión nueva igual
      }
      this.connect().catch(() => this.scheduleReconnect())
    }, SESSION_ROTATE_MS)
  }

  /** Chunk sin voz: pico bajo -40 dBFS (~1% de escala en PCM16). */
  private static isSilent(chunk: Buffer): boolean {
    const samples = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2)
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      if (s > 330 || s < -330) return false
    }
    return true
  }

  private flushBacklog(): void {
    if (!this.backlog.length) return
    // Recorte de silencio: el STT drena el backlog a solo ~1.5-2× tiempo
    // real, así que cada segundo de silencio descartado acorta el catch-up.
    // Costo aceptado: los timestamps del tramo recuperado se compactan
    // (el orden se preserva; solo afecta metadata de tiempo del corte).
    const before = this.backlog.length
    this.backlog = this.backlog.filter((c) => !AssemblyAiMicEngine.isSilent(c))
    const trimmed = before - this.backlog.length
    if (trimmed > 0) {
      console.log(`[stt] backlog: recortados ${trimmed} chunks de silencio (~${(trimmed * 50) / 1000}s)`)
    }
    if (!this.backlog.length) {
      this.droppedChunks = 0
      return
    }
    // Verificado: AssemblyAI acepta el backlog en ráfaga (más rápido que
    // tiempo real) sin cerrar la sesión.
    const seconds = (this.backlog.length * 50) / 1000
    // El backlog ocupa el INICIO del audio de esta sesión, pero fue hablado
    // ANTES de reconectar: la época arranca donde empezó el backlog, no en
    // el momento de la reconexión (si no, todos los timestamps de la época
    // quedan corridos ~backlog hacia el futuro).
    this.epochStartOffsetMs -= seconds * 1000
    console.log(
      `[stt] enviando backlog: ${this.backlog.length} chunks (~${seconds}s)` +
        (this.droppedChunks ? ` — ${this.droppedChunks} chunks descartados por tope` : ''),
    )
    for (const chunk of this.backlog) this.ws?.send(chunk)
    this.backlog = []
    this.droppedChunks = 0

    // Transparencia estilo "material recuperado": mientras el STT digiere
    // la ráfaga, las frases del corte aparecen tarde — avisamos para que
    // no parezca un bug. El servidor transcribe más rápido que tiempo
    // real; ~medio backlog es una estimación suficiente del catch-up.
    if (seconds > 5) {
      this.emitStatus('recording', `Recovering ${Math.round(seconds)}s of missed transcription…`)
      setTimeout(
        () => {
          if (!this.stopping && this.ws) this.emitStatus('recording')
        },
        Math.min(seconds * 500, 20_000),
      )
    }
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return
    let msg: { type: string }
    try {
      msg = JSON.parse(ev.data) as { type: string }
    } catch {
      return
    }
    if (msg.type === 'Begin') console.log('[stt] sesión iniciada por AssemblyAI')
    if (msg.type === 'Error') console.error('[stt]', ev.data)
    if (msg.type !== 'Turn') return

    const turn = msg as TurnMessage
    if (!turn.transcript) return
    // words[].start es relativo al AUDIO de la sesión actual; se corrige
    // con el offset de la época para que sea relativo a la captura entera.
    const inSession = turn.words?.[0]?.start ?? Date.now() - this.captureStartMs - this.epochStartOffsetMs
    const tsOffsetMs = this.epochStartOffsetMs + inSession
    // Diagnóstico de desfase: cuánto tardó este turno en llegar desde que
    // EMPEZASTE a decirlo. Normal en vivo: 1-4 s (incluye la duración de
    // la frase). Durante el catch-up post-corte sube (10-40 s) y debe
    // decaer de vuelta a lo normal — si no decae, hay un bug.
    if (turn.end_of_turn) {
      const lagS = (Date.now() - (this.captureStartMs + tsOffsetMs)) / 1000
      console.log(`[stt] turn ${this.epoch}-${turn.turn_order} desfase ~${lagS.toFixed(1)}s`)
    }
    this.emitSegment({
      providerMessageId: `aai-${this.epoch}-${turn.turn_order}`,
      speaker: 'You',
      text: turn.transcript,
      tsOffsetMs,
    })
  }

  /** Chunks PCM16 que llegan del renderer vía IPC. */
  acceptAudio(chunk: ArrayBuffer): void {
    if (this.stopping) return
    // Electron puede entregar el binario como ArrayBuffer o Buffer según
    // el camino IPC; normalizamos a Buffer para el frame binario del WS.
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(buf)
      this.recentSent.push(buf)
      if (this.recentSent.length > RECENT_SENT_MAX) this.recentSent.shift()
      this.chunksSent += 1
      // Diagnóstico: 1 chunk = 50 ms → cada 200 chunks ≈ 10 s de audio.
      if (this.chunksSent === 1 || this.chunksSent % 200 === 0) {
        console.log(
          `[stt] audio fluyendo: ${this.chunksSent} chunks (~${(this.chunksSent * 50) / 1000}s)`,
        )
      }
      return
    }

    // Sin conexión (reconectando o rotando): acumular, acotado.
    this.backlog.push(buf)
    if (this.backlog.length > MAX_BACKLOG_CHUNKS) {
      this.backlog.shift()
      this.droppedChunks += 1
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.reconnectTimer = null
    this.rotateTimer = null
    this.stallTimer = null
    this.mic.stop()

    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'Terminate' }))
      } catch {
        // cerrar igual
      }
      ws.close()
    }
    this.backlog = []
    this.emitStatus('idle')
  }
}
