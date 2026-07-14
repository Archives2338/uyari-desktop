import { randomUUID } from 'node:crypto'
import { powerSaveBlocker } from 'electron'
import type { CaptionSegment, Platform, SessionInfo } from '@shared/domain'
import type { ResumeDescriptor } from '@shared/ipc'
import type { ApiClient } from './api.client'
import type { CaptureEngine } from './capture'
import type { TranscriptStore } from './transcript.store'

// Orquesta el ciclo de vida de una sesión de captura. Mismo patrón que el
// service worker de la extensión: buffer con dedupe por providerMessageId
// (la versión más nueva pisa a la anterior), flush por lotes cada 5 s al
// backend, y finish() que drena el buffer antes de encolar el resumen.

const FLUSH_INTERVAL_MS = 5_000
const MAX_BATCH = 500
// Delay de gracia antes de auto-generar el resumen al stop (patrón Granola:
// da tiempo a que un "stop" accidental se deshaga con Reanudar antes de
// gastar el crédito de IA). Las guardas de duración/tamaño viven en el
// backend (autoGenerateSummary); acá solo se decide CUÁNDO llamarlo.
const AUTO_GEN_GRACE_MS = 6_000

type Listener = {
  onCaption(segment: CaptionSegment): void
  onSession(session: SessionInfo | null): void
  /** La auto-generación resolvió (queued/skipped/no-credits) tras la gracia. */
  onAutoGenResult?(result: { clientSessionId: string; outcome: string; reason?: string }): void
}

export class MeetingService {
  private engine: CaptureEngine | null = null
  private session: SessionInfo | null = null
  private buffer = new Map<string, CaptionSegment>()
  private ingestedAny = false
  // Última plataforma detectada por el mic-monitor (Zoom/Teams/Meet). La usa
  // el próximo start() en vez de un valor fijo — así el backend registra la
  // app real de la reunión. Default Zoom: el caso más común en desktop nativo
  // (Meet lo cubre la extensión).
  private platformHint: Platform = 'ZOOM'
  // Mismo patrón que Granola: prevent-display-sleep con guard idempotente
  // — si la pantalla duerme a mitad de reunión, la captura muere con ella.
  private powerBlockerId: number | undefined
  private flushTimer: NodeJS.Timeout | null = null
  private listener: Listener | null = null
  // Tramo de captura actual: 0 al arrancar, +1 por cada resume tras pausa.
  // Mantiene únicos los ids de segmento entre tramos (ver CaptureStartOptions).
  private take = 0
  // Segundos de STT acumulados al destruir el engine (solo en el stop final —
  // el engine sobrevive las pausas y cuenta de forma acumulada; esto queda
  // como red por si alguna vez se destruye a mitad de sesión).
  private streamedSecondsClosed = 0
  // Auto-generación pendiente tras un stop (delay de gracia). Se cancela si
  // el usuario reanuda ESA MISMA nota antes de que dispare (equivalente a
  // `stop-auto-gen-skipped-resumed` de Granola).
  private pendingAutoGen: { clientSessionId: string; timer: NodeJS.Timeout } | null = null

  constructor(
    private readonly api: ApiClient,
    private readonly store: TranscriptStore,
    private readonly engineFactory: () => CaptureEngine,
  ) {}

  setListener(listener: Listener): void {
    this.listener = listener
  }

  /** El mic-monitor detectó una app de reunión: recordar su plataforma. */
  setPlatformHint(platform: Platform): void {
    this.platformHint = platform
  }

  /**
   * Renombra la sesión en vivo. El `session` del main es la fuente de verdad
   * del título que el ingest sube (upsert) — actualizarlo aquí evita que el
   * próximo flush pise el rename. `onSession` refleja el cambio en la UI (nub,
   * píldora). Persiste también directo (best-effort): tolera 404 si la reunión
   * aún no existe — el primer ingest la creará con este mismo título.
   */
  renameSession(title: string): void {
    if (!this.session) return
    const clean = title.trim() || 'Untitled'
    this.session = { ...this.session, title: clean }
    this.listener?.onSession(this.session)
    void this.api.saveTitle(this.session.clientSessionId, clean).catch(() => {})
  }

  state(): SessionInfo | null {
    return this.session
  }

  // Las transiciones de sesión (start/pause/resume/stop) NO pueden solaparse:
  // cada una libera o arranca el helper de audio, y un tramo nuevo debe
  // esperar a que el helper viejo muera del todo (arbitraje de voice
  // processing de macOS → mic mudo). Se serializan en una cola: cada llamada
  // corre completa antes de la siguiente, incluida la evaluación de su guard.
  private opChain: Promise<unknown> = Promise.resolve()

  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(op, op)
    // La cola nunca queda rechazada: un fallo de una transición no bloquea
    // las siguientes.
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  start(title?: string, resume?: ResumeDescriptor): Promise<SessionInfo> {
    return this.serialize(() => this._start(title, resume))
  }

  pause(): Promise<SessionInfo | null> {
    return this.serialize(() => this._pause())
  }

  resume(): Promise<SessionInfo | null> {
    return this.serialize(() => this._resume())
  }

  stop(): Promise<{ finished: boolean }> {
    return this.serialize(() => this._stop())
  }

  private async _start(title?: string, resume?: ResumeDescriptor): Promise<SessionInfo> {
    if (this.session) return this.session

    // Reanudar esta nota antes de que dispare la auto-generación la cancela:
    // el usuario "se arrepintió" del stop, no hay nada que resumir todavía.
    if (resume && this.pendingAutoGen?.clientSessionId === resume.clientSessionId) {
      clearTimeout(this.pendingAutoGen.timer)
      this.pendingAutoGen = null
    }

    const baseOffsetMs = resume?.baseOffsetMs ?? 0
    // Tramo de reanudación: `take` alto y creciente (1000 + segundos ya
    // transcritos) para que los ids nunca colisionen con los de los tramos
    // previos (0, 1, 2…). Como baseOffsetMs sube en cada resume, el take
    // también → tampoco colisionan dos reanudaciones entre sí.
    this.take = resume ? 1000 + Math.floor(baseOffsetMs / 1000) : 0
    this.streamedSecondsClosed = 0
    // Al reanudar una nota terminada la reunión YA existe en el backend: los
    // segmentos nuevos hacen upsert sobre ella y finish() no dará 404.
    this.ingestedAny = !!resume
    this.session = {
      clientSessionId: resume?.clientSessionId ?? randomUUID(),
      // Default "Untitled" (patrón Granola): la nota en vivo lo muestra como
      // placeholder gris hasta que el usuario la renombra (ver NoteScreen).
      title: title ?? 'Untitled',
      platform: this.platformHint,
      // Época retrocedida por lo ya transcrito: así una pausa EN VIVO del tramo
      // reanudado (que calcula su offset como now − startedAtMs) sigue cayendo
      // después de lo previo, sin solaparse.
      startedAtMs: Date.now() - baseOffsetMs,
      // 'recording' llega después, cuando el engine confirma mic real (ver
      // native.engine.ts) — evita que la UI invite a hablar antes de tiempo.
      status: 'starting',
    }

    this.store.openSession(this.session)
    // La reunión reanudada ya existe en backend → marcar la fila local como
    // ingerida (openSession la crea con 0) para que recoverOrphans la cierre
    // bien si la app muere durante el tramo nuevo.
    if (resume) this.store.markIngested(this.session.clientSessionId)
    this.buildEngine()
    try {
      await this.engine!.start({ take: this.take, baseOffsetMs })
    } catch (err) {
      return this.failSession(err)
    }
    this.startTimers()
    this.listener?.onSession(this.session)
    return this.session
  }

  /**
   * Pausa la captura sin cerrar la sesión: NO destruye el engine — lo deja
   * caliente (pauseCapture mantiene el helper vivo con el voice processing
   * armado; ver native.engine.ts) para que el resume sea instantáneo. Sube lo
   * pendiente. NO genera el resumen — eso es solo del stop.
   */
  private async _pause(): Promise<SessionInfo | null> {
    if (!this.session || this.session.status === 'paused') return this.session
    // Marcar 'paused' ANTES de pausar el engine: cualquier 'idle'/'status'
    // tardío no debe pisar el estado (el guard en el handler lo ignora).
    this.session = { ...this.session, status: 'paused', statusDetail: undefined }
    this.stopTimers()
    await this.engine?.pauseCapture()
    await this.flush()
    this.listener?.onSession(this.session)
    return this.session
  }

  /**
   * Retoma la sesión en un tramo nuevo sobre el MISMO engine caliente: reabre
   * los canales STT con ids que no colisionan (t<take>) y un offset temporal
   * que ubica el tramo después del anterior, dejando el hueco de la pausa.
   */
  private async _resume(): Promise<SessionInfo | null> {
    if (!this.session || this.session.status !== 'paused') return this.session
    this.take += 1
    // El tramo arranca donde estamos AHORA en la línea de tiempo real de la
    // sesión: el silencio de la pausa queda como hueco, sin solaparse.
    const baseOffsetMs = Date.now() - this.session.startedAtMs
    this.session = { ...this.session, status: 'starting', statusDetail: undefined }
    try {
      await this.engine?.resumeCapture({ take: this.take, baseOffsetMs })
    } catch (err) {
      return this.failSession(err)
    }
    this.startTimers()
    this.listener?.onSession(this.session)
    return this.session
  }

  /** Deja la sesión en error visible (engine no pudo arrancar/reanudar). */
  private failSession(err: unknown): SessionInfo {
    const detail = err instanceof Error ? err.message : String(err)
    this.session = { ...this.session!, status: 'error', statusDetail: detail }
    this.listener?.onSession(this.session)
    return this.session
  }

  private startTimers(): void {
    if (!this.flushTimer) this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
    if (this.powerBlockerId === undefined) {
      this.powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
  }

  private stopTimers(): void {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flushTimer = null
    if (this.powerBlockerId !== undefined) {
      powerSaveBlocker.stop(this.powerBlockerId)
      this.powerBlockerId = undefined
    }
  }

  /** Construye el engine de la sesión y cablea sus eventos. Una vez por sesión
   *  (el engine se mantiene caliente entre pausas; solo el stop lo destruye). */
  private buildEngine(): void {
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
      // Una pausa en curso manda: ignorar el 'idle' que el engine emite al
      // cerrarse (llegaría después de haber marcado 'paused').
      if (this.session.status === 'paused') return
      this.session = { ...this.session, status, statusDetail: detail }
      this.listener?.onSession(this.session)
      if (status === 'error') console.error('[capture]', detail)
    })
  }

  /**
   * Destruye el engine de la sesión (helper + sockets + timers) al terminar.
   * Solo lo llama el stop definitivo: entre pausas el engine se mantiene vivo.
   */
  private async teardownTake(): Promise<void> {
    this.stopTimers()
    // Soltar la referencia del campo ANTES del await: aunque otra transición
    // corra entre medio (no debería, están serializadas), el stop() lento del
    // helper opera sobre el engine local y nunca pisa un engine nuevo. Quitar
    // listeners antes de stop() para que su 'idle' de cierre no llegue al
    // handler.
    const engine = this.engine
    this.engine = null
    // Guardar los segundos de STT antes de perder el engine: así el consumo
    // del plan (todos los tramos, contados de forma acumulada por el engine
    // que sobrevive las pausas) queda registrado.
    this.streamedSecondsClosed += engine?.streamedSeconds() ?? 0
    engine?.removeAllListeners()
    await engine?.stop()
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

  /**
   * Programa la auto-generación tras el delay de gracia. Las guardas de
   * duración mínima / transcript mínimo viven en el backend
   * (autoGenerateSummary) — acá solo se decide CUÁNDO intentarlo, y se
   * cancela si _start() ve un resume de esta misma nota antes de disparar.
   */
  private scheduleAutoGenerate(clientSessionId: string): void {
    if (this.pendingAutoGen) clearTimeout(this.pendingAutoGen.timer)
    const timer = setTimeout(() => {
      this.pendingAutoGen = null
      void this.api
        .autoGenerateSummary(clientSessionId)
        .then((result) => {
          // Push al renderer: deja de sondear a ciegas y reacciona al instante
          // (skipped → botón manual ya; queued → esperar el resumen).
          const reason = 'reason' in result ? result.reason : undefined
          this.listener?.onAutoGenResult?.({ clientSessionId, outcome: result.outcome, reason })
        })
        .catch((err) => console.error('[auto-gen]', err))
    }, AUTO_GEN_GRACE_MS)
    this.pendingAutoGen = { clientSessionId, timer }
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

  private async _stop(): Promise<{ finished: boolean }> {
    if (!this.session) return { finished: false }
    const clientSessionId = this.session.clientSessionId
    // Cierra el tramo activo (si lo hay — si estaba pausada, el engine ya es
    // null) y acumula sus segundos de STT en streamedSecondsClosed.
    await this.teardownTake()

    // Segundos de audio realmente transmitidos al STT (suma de canales y de
    // todos los tramos). Se reportan al backend para medir el consumo del
    // plan — solo el desktop consume STT; la extensión captions-only no.
    const sttSeconds = Math.round(this.streamedSecondsClosed)

    await this.flush()
    let finished = false
    // Solo cerrar en backend si la reunión existe allá (el POST de segments
    // es quien la crea; sin segmentos ingeridos, /finish daría 404).
    if (this.ingestedAny) {
      try {
        await this.api.finish(clientSessionId)
        finished = true
      } catch (err) {
        // El transcript sigue en SQLite; recoverOrphans() lo cerrará en el
        // próximo arranque.
        console.error('[finish]', err)
      }
    }
    if (finished || !this.ingestedAny) this.store.closeSession(clientSessionId)
    // La reunión quedó cerrada en backend: programar la auto-generación (con
    // su propio delay de gracia, cancelable si el usuario reanuda ANTES de
    // que dispare — ver _start()).
    if (finished) this.scheduleAutoGenerate(clientSessionId)

    // Best-effort: medir el consumo de STT del plan. No bloquea el stop ni
    // importa si falla (el gate real está en la emisión del token).
    if (sttSeconds > 0) void this.api.reportSttUsage(sttSeconds).catch(() => {})

    this.session = null
    this.buffer.clear()
    this.ingestedAny = false
    this.streamedSecondsClosed = 0
    this.take = 0
    this.listener?.onSession(null)
    return { finished }
  }
}
