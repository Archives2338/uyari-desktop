import { BaseCaptureEngine, type CaptureStartOptions } from './engine'
import { STREAM_SAMPLE_RATE, type SttTokenProvider } from './assemblyai.stream'
import { createSttStream, type SttStream, type SttProvider } from './stt-stream'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'

// Motor "fase 2b": solo micrófono → un canal STT etiquetado "You".
// Toda la lógica de conexión/resiliencia vive en el stream (proveedor según
// UYARI_STT, igual que el motor nativo).

export const MIC_SAMPLE_RATE = STREAM_SAMPLE_RATE

export interface MicControlPort {
  start(sampleRate: number): void
  stop(): void
}

export type { SttTokenProvider }

export class AssemblyAiMicEngine extends BaseCaptureEngine {
  private readonly stream: SttStream

  constructor(
    api: SttProvider,
    private readonly mic: MicControlPort,
  ) {
    super()
    this.stream = createSttStream(api, { speaker: 'You', channel: 'you' })
    this.stream.on('segment', (s: CaptionSegment) => this.emitSegment(s))
    this.stream.on('status', (status: CaptureStatus, detail?: string) =>
      this.emitStatus(status, detail),
    )
  }

  async start(opts?: CaptureStartOptions): Promise<void> {
    await this.stream.start(opts)
    this.mic.start(MIC_SAMPLE_RATE)
  }

  acceptAudio(chunk: ArrayBuffer): void {
    this.stream.acceptAudio(chunk)
  }

  streamedSeconds(): number {
    return this.stream.streamedSeconds()
  }

  setNetworkOnline(online: boolean): void {
    this.stream.setNetworkOnline(online)
  }

  async stop(): Promise<void> {
    this.mic.stop()
    await this.stream.stop()
    this.emitStatus('idle')
  }
}
