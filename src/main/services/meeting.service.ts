import { randomUUID } from 'node:crypto'
import { powerSaveBlocker } from 'electron'
import type { CaptionSegment, SessionInfo } from '@shared/domain'
import type { ApiClient } from './api.client'
import type { CaptureEngine } from './capture'
import type { TranscriptStore } from './transcript.store'

// Orquesta el ciclo de vida de una sesión de captura. Mismo patrón que el
// service worker de la extensión: buffer con dedupe por providerMessageId
// (la versión más nueva pisa a la anterior), flush por lotes cada 5 s al
// backend, y finish() que drena el buffer antes de encolar el resumen.

const FLUSH_INTERVAL_MS = 5_000
const MAX_BATCH = 500

type Listener = {
  onCaption(segment: CaptionSegment): void
  onSession(session: SessionInfo | null): void
}

export class MeetingService {
  private engine: CaptureEngine | null = null
  private session: SessionInfo | null = null
  private buffer = new Map<string, CaptionSegment>()
  private ingestedAny = false
  // Mismo patrón que Granola: prevent-display-sleep con guard idempotente
  // — si la pantalla duerme a mitad de reunión, la captura muere con ella.
  private powerBlockerId: number | undefined
  private flushTimer: NodeJS.Timeout | null = null
  private listener: Listener | null = null

  constructor(
    private readonly api: ApiClient,
    private readonly store: TranscriptStore,
    private readonly engineFactory: () => CaptureEngine,
  ) {}

  setListener(listener: Listener): void {
    this.listener = listener
  }

  state(): SessionInfo | null {
    return this.session
  }

  async start(title?: string): Promise<SessionInfo> {
    if (this.session) return this.session

    this.session = {
      clientSessionId: randomUUID(),
      title: title ?? `Meeting ${new Date().toLocaleString()}`,
      platform: 'ZOOM',
      startedAtMs: Date.now(),
      status: 'recording',
    }

    this.store.openSession(this.session)

    this.engine = this.engineFactory()
    this.engine.on('segment', (segment) => {
      this.buffer.set(segment.providerMessageId, segment)
      // Write-through a SQLite: si la app muere, el próximo arranque
      // recupera y sube lo pendiente (recoverOrphans).
      if (this.session) this.store.upsertSegment(this.session.clientSessionId, segment)
      this.listener?.onCaption(segment)
    })
    this.engine.on('status', (status, detail) => {
      if (!this.session) return
      this.session = { ...this.session, status, statusDetail: detail }
      this.listener?.onSession(this.session)
      if (status === 'error') console.error('[capture]', detail)
    })

    try {
      await this.engine.start()
    } catch (err) {
      // El engine no pudo arrancar (p.ej. sin ASSEMBLYAI_API_KEY o backend
      // caído): dejar la sesión en error visible en vez de colgarla.
      const detail = err instanceof Error ? err.message : String(err)
      this.session = { ...this.session, status: 'error', statusDetail: detail }
      this.listener?.onSession(this.session)
      return this.session
    }
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
    if (this.powerBlockerId === undefined) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
    this.listener?.onSession(this.session)
    return this.session
  }

  /** Audio PCM16 del renderer → engine actual (si el engine consume audio). */
  acceptAudio(chunk: ArrayBuffer): void {
    const engine = this.engine as (CaptureEngine & { acceptAudio?(c: ArrayBuffer): void }) | null
    engine?.acceptAudio?.(chunk)
  }

  /**
   * Sesiones que quedaron a medias (crash / backend caído): subir lo
   * pendiente y cerrarlas para que el resumen no se pierda. Se corre al
   * arrancar la app, solo si hay sesión de usuario.
   */
  async recoverOrphans(): Promise<void> {
    let orphans
    try {
      orphans = this.store.listOrphans()
    } catch (err) {
      console.error('[recover]', err)
      return
    }
    for (const orphan of orphans) {
      try {
        let ingested = orphan.ingestedAny
        for (let i = 0; i < orphan.pending.length; i += MAX_BATCH) {
          await this.api.ingestSegments(orphan.clientSessionId, {
            platform: orphan.platform,
            title: orphan.title,
            segments: orphan.pending.slice(i, i + MAX_BATCH),
          })
          ingested = true
        }
        if (ingested) await this.api.finish(orphan.clientSessionId)
        this.store.closeSession(orphan.clientSessionId)
        console.log(
          `[recover] sesión ${orphan.clientSessionId} recuperada (${orphan.pending.length} segmentos pendientes)`,
        )
      } catch (err) {
        // Se queda en SQLite para el próximo intento (p.ej. backend caído).
        console.warn('[recover] no se pudo recuperar', orphan.clientSessionId, err)
      }
    }
  }

  /** Cambio de conectividad reportado por el renderer → engine actual. */
  setNetworkOnline(online: boolean): void {
    const engine = this.engine as
      | (CaptureEngine & { setNetworkOnline?(online: boolean): void })
      | null
    engine?.setNetworkOnline?.(online)
  }

  /** El mic del renderer no pudo arrancar: dejar la sesión en error visible. */
  reportMicError(message: string): void {
    if (!this.session) return
    console.error('[mic]', message)
    this.session = { ...this.session, status: 'error', statusDetail: `Micrófono: ${message}` }
    this.listener?.onSession(this.session)
  }

  private async flush(): Promise<void> {
    if (!this.session || this.buffer.size === 0) return
    const batch = [...this.buffer.values()].slice(0, MAX_BATCH)
    try {
      await this.api.ingestSegments(this.session.clientSessionId, {
        platform: this.session.platform,
        title: this.session.title,
        segments: batch,
      })
      if (!this.ingestedAny) {
        this.ingestedAny = true
        this.store.markIngested(this.session.clientSessionId)
      }
      for (const s of batch) this.buffer.delete(s.providerMessageId)
      this.store.deleteSegments(
        this.session.clientSessionId,
        batch.map((s) => s.providerMessageId),
      )
    } catch (err) {
      // El buffer conserva lo no confirmado; el próximo tick reintenta.
      console.error('[flush]', err)
    }
  }

  async stop(): Promise<{ finished: boolean }> {
    if (!this.session) return { finished: false }
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flushTimer = null
    if (this.powerBlockerId !== undefined) {
      powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = undefined
    }

    await this.engine?.stop()
    this.engine?.removeAllListeners()
    this.engine = null

    await this.flush()
    let finished = false
    // Solo cerrar en backend si la reunión existe allá (el POST de segments
    // es quien la crea; sin segmentos ingeridos, /finish daría 404).
    if (this.ingestedAny) {
      try {
        await this.api.finish(this.session.clientSessionId)
        finished = true
      } catch (err) {
        // El transcript sigue en SQLite; recoverOrphans() lo cerrará en el
        // próximo arranque.
        console.error('[finish]', err)
      }
    }
    if (finished || !this.ingestedAny) this.store.closeSession(this.session.clientSessionId)

    this.session = null
    this.buffer.clear()
    this.ingestedAny = false
    this.listener?.onSession(null)
    return { finished }
  }
}
