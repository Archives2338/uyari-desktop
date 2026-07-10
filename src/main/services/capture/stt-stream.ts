import type { EventEmitter } from 'node:events'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'
import {
  AssemblyAiStream,
  type SttTokenProvider,
  type StreamOptions,
} from './assemblyai.stream'
import { DeepgramStream, type DeepgramTokenProvider } from './deepgram.stream'

// Frontera única de un canal de STT streaming: AssemblyAiStream y
// DeepgramStream la implementan igual. El engine habla contra esta interfaz;
// el proveedor se elige con UYARI_STT (default: deepgram — menor latencia y
// sin los cuelgues del tier compartido de AssemblyAI, validado en QA;
// UYARI_STT=assemblyai = escape hatch).

export interface SttStream extends EventEmitter {
  start(opts?: { take?: number; baseOffsetMs?: number }): Promise<void>
  stop(): Promise<void>
  acceptAudio(chunk: ArrayBuffer | Buffer): void
  streamedSeconds(): number
  setNetworkOnline(online: boolean): void
  on(event: 'segment', listener: (s: CaptionSegment) => void): this
  on(event: 'status', listener: (status: CaptureStatus, detail?: string) => void): this
}

/** Proveedor de tokens para cualquiera de los dos (el ApiClient los tiene). */
export type SttProvider = SttTokenProvider & DeepgramTokenProvider

export function createSttStream(api: SttProvider, opts: StreamOptions): SttStream {
  if (process.env.UYARI_STT === 'assemblyai') {
    return new AssemblyAiStream(api, opts) as unknown as SttStream
  }
  return new DeepgramStream(api, opts) as unknown as SttStream
}
