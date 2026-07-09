import { EventEmitter } from 'node:events'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'

// Frontera de la captura. TODO lo que está detrás de esta interfaz es
// intercambiable: hoy un mock que emite captions falsos; después el
// pipeline real (helper nativo de audio + STT streaming). Ni el resto del
// main ni el renderer saben cuál corre.

/**
 * Un "take" es cada tramo de captura de una misma sesión: el arranque es el
 * take 0; cada resume tras una pausa incrementa el índice. Sirve para que los
 * segmentos de tramos distintos no colisionen ni se solapen en el tiempo:
 *  - `take` entra en el providerMessageId → ids únicos entre tramos.
 *  - `baseOffsetMs` se suma al tsOffsetMs → el tramo se ubica después del
 *    anterior en la línea de tiempo (con el hueco natural de la pausa).
 */
export interface CaptureStartOptions {
  take?: number
  baseOffsetMs?: number
}

export interface CaptureEngine {
  /** Empieza a emitir segmentos. Resuelve cuando la captura quedó activa. */
  start(opts?: CaptureStartOptions): Promise<void>
  /** Detiene y libera recursos. Idempotente. */
  stop(): Promise<void>
  /**
   * Segundos de audio transmitidos al STT en toda la sesión (suma de canales
   * en el motor nativo). Los motores sin costo de STT (mock) devuelven 0.
   */
  streamedSeconds(): number
  on(event: 'segment', listener: (segment: CaptionSegment) => void): this
  on(event: 'status', listener: (status: CaptureStatus, detail?: string) => void): this
  removeAllListeners(): this
}

export abstract class BaseCaptureEngine extends EventEmitter implements CaptureEngine {
  abstract start(opts?: CaptureStartOptions): Promise<void>
  abstract stop(): Promise<void>

  /** Por defecto sin consumo de STT; los motores con STT lo sobrescriben. */
  streamedSeconds(): number {
    return 0
  }

  protected emitSegment(segment: CaptionSegment): void {
    this.emit('segment', segment)
  }

  protected emitStatus(status: CaptureStatus, detail?: string): void {
    this.emit('status', status, detail)
  }
}
