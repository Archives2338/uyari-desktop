import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { Readable, Writable } from 'node:stream'
import { BaseCaptureEngine } from './engine'
import { AssemblyAiStream, STREAM_SAMPLE_RATE } from './assemblyai.stream'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'
import type { MicControlPort, SttTokenProvider } from './assemblyai.engine'

// Motor "fase 2c": DOS canales STT con separación de hablantes de fábrica.
//   - "You"  → micrófono del renderer (el camino ya probado de 2b)
//   - "Them" → audio del sistema vía el helper Swift (Core Audio process
//     tap, patrón Granola — ver native/audio-helper/main.swift)
//
// El helper es un child process que escribe PCM16LE mono 16 kHz por stdout
// en frames de 50 ms — mismo formato que el mic, así que ambos canales
// comparten AssemblyAiStream (conexión, backlog, reconexión, todo igual).
//
// Si el helper no puede arrancar (típicamente: falta el permiso TCC de
// System Audio Recording), degradamos a mic-only con aviso visible en vez
// de tumbar la sesión.

const CHUNK_BYTES = 1600 // 800 samples * 2 bytes = 50 ms

function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'uyari-audio-helper')
    : join(app.getAppPath(), 'native/bin/uyari-audio-helper')
}

export class NativeCaptureEngine extends BaseCaptureEngine {
  private readonly you: AssemblyAiStream
  private readonly them: AssemblyAiStream
  private helper: ChildProcessByStdio<Writable, Readable, Readable> | null = null
  private stdoutRemainder: Buffer = Buffer.alloc(0)
  private stopping = false
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
    // El mic es el canal principal: si falla, la sesión falla.
    await this.you.start()
    this.mic.start(STREAM_SAMPLE_RATE)
    // El audio del sistema es best-effort: sin permiso TCC degradamos.
    try {
      await this.them.start()
      this.spawnHelper()
    } catch (err) {
      console.error('[native] canal de sistema no disponible:', err)
      await this.them.stop()
      this.emitStatus(
        'recording',
        'System audio unavailable — only your microphone is being transcribed.',
      )
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
      // Reagrupar el stream en frames exactos de 50 ms.
      this.stdoutRemainder = Buffer.concat([this.stdoutRemainder, data])
      while (this.stdoutRemainder.length >= CHUNK_BYTES) {
        const chunk = this.stdoutRemainder.subarray(0, CHUNK_BYTES)
        this.stdoutRemainder = this.stdoutRemainder.subarray(CHUNK_BYTES)
        this.them.acceptAudio(chunk)
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
    console.error('[native] audio del sistema caído:', reason)
    this.helper = null
    void this.them.stop()
    // Degradar, no tumbar: el mic sigue transcribiendo.
    this.emitStatus(
      'recording',
      'System audio stopped — check System Audio Recording permission. Your microphone keeps working.',
    )
  }

  setNetworkOnline(online: boolean): void {
    this.you.setNetworkOnline(online)
    this.them.setNetworkOnline(online)
  }

  acceptAudio(chunk: ArrayBuffer): void {
    this.you.acceptAudio(chunk)
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.mic.stop()
    if (this.helper) {
      // Cerrar stdin = señal de salida limpia para el helper (y SIGTERM de
      // respaldo por si quedó colgado).
      const helper = this.helper
      this.helper = null
      try {
        helper.stdin.end()
      } catch {
        // seguir con el kill
      }
      setTimeout(() => helper.kill('SIGTERM'), 1500)
    }
    await Promise.all([this.you.stop(), this.them.stop()])
    this.emitStatus('idle')
  }
}
