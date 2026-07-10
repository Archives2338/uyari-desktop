import type { CaptionSegment, CaptureStatus } from './domain'

// Protocolo del utilityProcess de audio (ver main/workers/audio-worker.ts y
// main/services/capture/worker.engine.ts). El pegamento JS de captura (parse
// de frames + dedup de eco + 2 streams STT) corre en ese proceso aparte; el
// main solo enruta comandos y recibe segmentos/estado, y sirve dos cosas que
// DEBEN quedarse de su lado: los tokens de STT (keychain/JWT) y el control del
// mic del renderer (fallback). Todo cruza por structured clone.

/** Opciones de arranque de un tramo (espejo de CaptureStartOptions). */
export interface WorkerStartOpts {
  take?: number
  baseOffsetMs?: number
}

/** Main → Worker. */
export type MainToWorker =
  | { t: 'start'; opts: WorkerStartOpts; helperBin: string }
  | { t: 'pause' }
  | { t: 'resume'; opts: WorkerStartOpts }
  | { t: 'stop' }
  | { t: 'net'; online: boolean }
  /** Chunk PCM del mic del renderer (solo en modo fallback). */
  | { t: 'micChunk'; chunk: ArrayBuffer }
  /** Respuesta a un tokenReq: value en éxito; errCode/errMsg en fallo
   *  (errCode preserva 'STT_QUOTA_EXCEEDED' para que el stream no reintente). */
  | { t: 'tokenRes'; id: number; value?: unknown; errCode?: string; errMsg?: string }

/** Worker → Main. */
export type WorkerToMain =
  | { t: 'segment'; segment: CaptionSegment }
  | { t: 'status'; status: CaptureStatus; detail?: string }
  /** Pide un token al main (los credenciales viven allá). */
  | { t: 'tokenReq'; id: number; kind: 'stt' | 'deepgram' }
  /** El engine cayó al mic del renderer: pide encenderlo/apagarlo en el main. */
  | { t: 'micStart'; sampleRate: number }
  | { t: 'micStop' }
  /** Acks de ciclo de vida (el main espera cada transición). */
  | { t: 'started' }
  | { t: 'startError'; message: string }
  | { t: 'resumed' }
  | { t: 'resumeError'; message: string }
  | { t: 'paused' }
  | { t: 'stopped'; streamedSeconds: number }
