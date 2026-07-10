import { utilityProcess, type UtilityProcess } from 'electron'
import { BaseCaptureEngine, type CaptureStartOptions } from './engine'
import type { SttProvider } from './stt-stream'
import type { MicControlPort } from './assemblyai.engine'
import type { MainToWorker, WorkerToMain } from '@shared/audio-worker'

// Motor que corre el pegamento de audio en un utilityProcess (patrón Granola:
// su servicio `audio`). El NativeCaptureEngine real vive en el worker; esta
// clase es el proxy en el main: forkea el proceso, le manda comandos, reemite
// sus segmentos/estado como si fuera un engine local, y le sirve las dos cosas
// que no pueden cruzar (tokens de STT y el mic del renderer). Ver
// workers/audio-worker.ts y shared/audio-worker.ts.
//
// Ciclo de vida: un worker por sesión, vivo entre pausas (igual que el helper
// caliente del engine nativo); el stop lo mata.

type Ack = { resolve: () => void; reject: (e: unknown) => void }

// El stop no debe colgar el teardown si el worker no contesta.
const STOP_ACK_TIMEOUT_MS = 2000

export class WorkerCaptureEngine extends BaseCaptureEngine {
  private worker: UtilityProcess | null = null
  private stopping = false
  private streamed = 0
  private rendererMicActive = false
  // A lo sumo una transición en vuelo (MeetingService las serializa).
  private acks: Partial<Record<'start' | 'pause' | 'resume' | 'stop', Ack>> = {}

  constructor(
    private readonly api: SttProvider,
    private readonly mic: MicControlPort,
    private readonly workerPath: string,
    private readonly helperBin: string,
  ) {
    super()
  }

  private send(msg: MainToWorker): void {
    this.worker?.postMessage(msg)
  }

  private waitAck(key: 'start' | 'pause' | 'resume' | 'stop'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.acks[key] = { resolve, reject }
    })
  }

  private settleAck(key: 'start' | 'pause' | 'resume' | 'stop', err?: unknown): void {
    const ack = this.acks[key]
    if (!ack) return
    delete this.acks[key]
    if (err !== undefined) ack.reject(err)
    else ack.resolve()
  }

  private spawnWorker(): void {
    if (this.worker) return
    this.stopping = false
    // env: process.env para que el worker (y el helper que él spawnea) hereden
    // UYARI_STT / UYARI_MIC / etc. stdio 'inherit': logs del worker y stderr
    // del helper salen a la misma terminal.
    const worker = utilityProcess.fork(this.workerPath, [], {
      serviceName: 'uyari-audio',
      env: process.env as Record<string, string>,
      stdio: 'inherit',
    })
    this.worker = worker
    worker.on('message', (msg: WorkerToMain) => this.handle(msg))
    worker.on('exit', (code) => this.onWorkerExit(code))
  }

  private onWorkerExit(code: number): void {
    this.worker = null
    // Rechazar cualquier transición en vuelo para no colgar el teardown.
    const dead = new Error(`worker de audio terminó (código ${code})`)
    for (const key of ['start', 'pause', 'resume', 'stop'] as const) this.settleAck(key, dead)
    if (!this.stopping) {
      // Muerte inesperada del pegamento de audio: la sesión no puede seguir
      // capturando. Se degrada a error visible (v1: sin respawn del worker
      // entero — el respawn del helper ya vive dentro del worker).
      console.error('[worker] pegamento de audio caído inesperadamente')
      this.emitStatus('error', 'Audio pipeline stopped unexpectedly.')
    }
  }

  private async serveToken(id: number, kind: 'stt' | 'deepgram'): Promise<void> {
    try {
      const value = kind === 'deepgram' ? await this.api.deepgramToken() : await this.api.sttToken()
      this.send({ t: 'tokenRes', id, value })
    } catch (err) {
      const code = (err as { code?: string })?.code
      this.send({ t: 'tokenRes', id, errCode: code, errMsg: err instanceof Error ? err.message : String(err) })
    }
  }

  private handle(msg: WorkerToMain): void {
    switch (msg.t) {
      case 'segment':
        this.emitSegment(msg.segment)
        break
      case 'status':
        this.emitStatus(msg.status, msg.detail)
        break
      case 'tokenReq':
        void this.serveToken(msg.id, msg.kind)
        break
      case 'micStart':
        this.rendererMicActive = true
        this.mic.start(msg.sampleRate)
        break
      case 'micStop':
        this.rendererMicActive = false
        this.mic.stop()
        break
      case 'started':
        this.settleAck('start')
        break
      case 'startError':
        this.settleAck('start', new Error(msg.message))
        break
      case 'resumed':
        this.settleAck('resume')
        break
      case 'resumeError':
        this.settleAck('resume', new Error(msg.message))
        break
      case 'paused':
        this.settleAck('pause')
        break
      case 'stopped':
        this.streamed = msg.streamedSeconds
        this.settleAck('stop')
        break
    }
  }

  async start(opts?: CaptureStartOptions): Promise<void> {
    this.spawnWorker()
    const ack = this.waitAck('start')
    this.send({ t: 'start', opts: opts ?? {}, helperBin: this.helperBin })
    await ack
  }

  async pauseCapture(): Promise<void> {
    if (!this.worker) return
    const ack = this.waitAck('pause')
    this.send({ t: 'pause' })
    await ack
  }

  async resumeCapture(opts?: CaptureStartOptions): Promise<void> {
    if (!this.worker) {
      // El worker murió durante la pausa: arrancar uno nuevo (equivalente al
      // respawn del helper en el resume del engine nativo).
      return this.start(opts)
    }
    const ack = this.waitAck('resume')
    this.send({ t: 'resume', opts: opts ?? {} })
    await ack
  }

  setNetworkOnline(online: boolean): void {
    this.send({ t: 'net', online })
  }

  /** Chunks del mic del renderer → worker (solo relevantes en el fallback). */
  acceptAudio(chunk: ArrayBuffer): void {
    if (this.rendererMicActive) this.send({ t: 'micChunk', chunk })
  }

  streamedSeconds(): number {
    return this.streamed
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.rendererMicActive) {
      this.mic.stop()
      this.rendererMicActive = false
    }
    if (!this.worker) return
    const ack = this.waitAck('stop')
    this.send({ t: 'stop' })
    // Best-effort: si el worker no ackea el stop a tiempo, seguimos igual.
    await Promise.race([
      ack,
      new Promise<void>((resolve) => setTimeout(resolve, STOP_ACK_TIMEOUT_MS)),
    ]).catch(() => {})
    this.killWorker()
  }

  private killWorker(): void {
    const worker = this.worker
    this.worker = null
    worker?.kill()
  }
}
