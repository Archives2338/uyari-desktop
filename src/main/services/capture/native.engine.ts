import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { helperPath } from './helper-path'
import { BaseCaptureEngine } from './engine'
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

export class NativeCaptureEngine extends BaseCaptureEngine {
  private readonly you: AssemblyAiStream
  private readonly them: AssemblyAiStream
  private helper: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private stdoutRemainder: Buffer = Buffer.alloc(0)
  private stopping = false
  private rendererMicActive = false
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
      stream.on('segment', (s: CaptionSegment) => this.emitSegment(s))
      stream.on('status', (status: CaptureStatus, detail?: string) => {
        this.statusByChannel.set(channel, status)
        this.emitAggregateStatus(detail)
      })
    }
  }

  /** Si cualquier canal está reconectando, la sesión está reconectando. */
  private emitAggregateStatus(detail?: string): void {
    if (this.stopping) return
    const statuses = [...this.statusByChannel.values()]
    const status: CaptureStatus = statuses.includes('reconnecting') ? 'reconnecting' : 'recording'
    this.emitStatus(status, detail)
  }

  async start(): Promise<void> {
    this.stopping = false
    // El canal del mic es el principal: si su STT falla, la sesión falla.
    await this.you.start()
    try {
      await this.them.start()
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
        if (channel === CHANNEL_MIC) this.you.acceptAudio(pcm)
        else this.them.acceptAudio(pcm)
      }
    })
    helper.stderr.on('data', (data: Buffer) => {
      process.stderr.write(data)
    })
    helper.on('error', (err) => this.onHelperGone(err.message))
    helper.on('exit', (code) => {
      if (!this.stopping) this.onHelperGone(`helper terminó con código ${code}`)
    })
  }

  private onHelperGone(reason: string): void {
    console.error('[native] helper de audio caído:', reason)
    this.helper = null
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
