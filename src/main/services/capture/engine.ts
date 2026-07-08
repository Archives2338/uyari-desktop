import { EventEmitter } from 'node:events'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'

// Frontera de la captura. TODO lo que está detrás de esta interfaz es
// intercambiable: hoy un mock que emite captions falsos; después el
// pipeline real (helper nativo de audio + STT streaming). Ni el resto del
// main ni el renderer saben cuál corre.

export interface CaptureEngine {
  /** Empieza a emitir segmentos. Resuelve cuando la captura quedó activa. */
  start(): Promise<void>
  /** Detiene y libera recursos. Idempotente. */
  stop(): Promise<void>
  on(event: 'segment', listener: (segment: CaptionSegment) => void): this
  on(event: 'status', listener: (status: CaptureStatus, detail?: string) => void): this
  removeAllListeners(): this
}

export abstract class BaseCaptureEngine extends EventEmitter implements CaptureEngine {
  abstract start(): Promise<void>
  abstract stop(): Promise<void>

  protected emitSegment(segment: CaptionSegment): void {
    this.emit('segment', segment)
  }

  protected emitStatus(status: CaptureStatus, detail?: string): void {
    this.emit('status', status, detail)
  }
}
