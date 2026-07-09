import { EventEmitter } from 'node:events'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'

// Un canal de STT streaming contra AssemblyAI: conexión, backlog,
// reconexión con backoff, rotación proactiva y recorte de silencio.
// Es la pieza reutilizable detrás de los engines: el de micrófono usa un
// canal ("You"); el nativo usa dos (mic="You" + audio del sistema="Them").
//
// API verificada contra el servicio real (jul 2026):
//   wss://streaming.assemblyai.com/v3/ws
//     ?token=<efímero> &sample_rate=16000 &encoding=pcm_s16le
//     &speech_model=universal-streaming-multilingual &format_turns=true
//   ('pcm16' NO es válido → 3006. Validador: scratchpad/test-aai.mjs)
//   Audio: frames binarios PCM16 mono de ~50 ms (800 samples a 16 kHz).
//   Un Turn se re-emite mientras se finalizan palabras → mismo turn_order
//   = mismo segmento (el dedupe por providerMessageId lo pisa).
//   Cierre limpio: enviar {type:'Terminate'} antes de cerrar.
//
// Resiliencia (verificada con cortes de red reales):
//   - Corte → status 'reconnecting'; el audio se acumula en backlog.
//   - Al reabrir, backlog en ráfaga (AssemblyAI la acepta, verificado con
//     scratchpad/test-aai-burst.mjs) → no se pierden palabras.
//   - Rotación proactiva 5 min antes del tope de 3 h por sesión.
//   - Cada (re)conexión es una "época": ids `aai-<canal>-<época>-<turn>`
//     y offsets corregidos por el inicio real del backlog.

export const STREAM_SAMPLE_RATE = 16000
const WS_BASE = 'wss://streaming.assemblyai.com/v3/ws'

const SESSION_ROTATE_MS = (10800 - 300) * 1000
const MAX_BACKLOG_CHUNKS = 6000 // 5 min de audio (~9.6 MB)
const BACKOFF_MS = [1000, 2000, 4000, 8000, 10000]
// Reintentos de la conexión INICIAL antes de tumbar la sesión: un WiFi
// flojo al arrancar no debe matar la reunión (la reconexión en vivo ya
// cubre las caídas posteriores).
const INITIAL_CONNECT_ATTEMPTS = 5

const QUOTA_MESSAGE = 'Alcanzaste tu límite de transcripción de este mes.'

/** El backend respondió 402: cuota de STT agotada (error terminal). */
function isQuotaError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'STT_QUOTA_EXCEEDED'
  )
}

// Socket estancado (WiFi caído sin que TCP lo note): bufferedAmount crece.
const STALL_CHECK_MS = 2000
const STALL_THRESHOLD_BYTES = 16000
const STALL_STRIKES = 3
const RECENT_SENT_MAX = 1200 // ventana para rescatar chunks varados (60 s)

interface TurnMessage {
  type: 'Turn'
  turn_order: number
  end_of_turn: boolean
  transcript: string
  turn_is_formatted: boolean
  words?: Array<{ text: string; start: number; end: number; confidence: number }>
}

export interface SttTokenProvider {
  sttToken(): Promise<{ token: string }>
}

export interface StreamOptions {
  /** Etiqueta de hablante en los segmentos ('You' | 'Them'). */
  speaker: string
  /** Distingue los ids entre canales ('you' | 'them'). */
  channel: string
}

export class AssemblyAiStream extends EventEmitter {
  private ws: WebSocket | null = null
  private stopping = false
  private chunksSent = 0

  private captureStartMs = 0
  private epoch = 0
  private epochStartOffsetMs = 0
  // Tramo de captura (0 = arranque, +1 por cada resume). Ver CaptureStartOptions.
  private take = 0
  // Desplazamiento del tramo en la línea de tiempo de la sesión (ms desde el
  // inicio real, incluyendo el hueco de las pausas). Se suma al tsOffsetMs.
  private baseOffsetMs = 0
  // Último turn_order al que ya le medimos el primer parcial (latencia VISIBLE
  // = cuánto tardó en aparecer el primer texto). Distinto del desfase, que se
  // mide al final del turno e incluye toda la duración de la frase.
  private lastPartialTurn = -1
  // ¿Ya fluyó audio en esta época? AssemblyAI mide sus timestamps relativos al
  // audio RECIBIDO, no a la apertura del socket: si el primer chunk llega
  // tarde (p.ej. ~1s de warm-up del voice processing en un arranque en frío),
  // la época se re-ancla a ese momento — si no, ese hueco infla tsOffsetMs y
  // las métricas de latencia de toda la sesión.
  private epochAudioStarted = false

  private backlog: Buffer[] = []
  private droppedChunks = 0
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private rotateTimer: NodeJS.Timeout | null = null

  private recentSent: Buffer[] = []
  private stallTimer: NodeJS.Timeout | null = null
  private stallStrikes = 0

  constructor(
    private readonly api: SttTokenProvider,
    private readonly opts: StreamOptions,
  ) {
    super()
  }

  private tag(): string {
    return `[stt:${this.opts.channel}]`
  }

  /** Segundos de audio efectivamente enviados (50 ms por chunk). */
  streamedSeconds(): number {
    return (this.chunksSent * 50) / 1000
  }

  async start(opts?: { take?: number; baseOffsetMs?: number }): Promise<void> {
    this.stopping = false
    this.take = opts?.take ?? 0
    this.baseOffsetMs = opts?.baseOffsetMs ?? 0
    this.captureStartMs = Date.now()
    await this.connectWithRetry()
  }

  /**
   * Conexión inicial con reintentos: un fallo transitorio al arrancar (WiFi
   * flojo, backend despertando) reintenta con backoff en vez de tumbar la
   * sesión. La cuota agotada (402) es terminal y se propaga de inmediato.
   */
  private async connectWithRetry(): Promise<void> {
    for (let attempt = 0; attempt < INITIAL_CONNECT_ATTEMPTS; attempt++) {
      if (this.stopping) return
      try {
        await this.connect()
        return
      } catch (err) {
        if (isQuotaError(err)) throw err
        if (this.stopping) return
        if (attempt === INITIAL_CONNECT_ATTEMPTS - 1) {
          throw err instanceof Error ? err : new Error(String(err))
        }
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
        console.warn(
          `${this.tag()} conexión inicial falló (intento ${attempt + 1}/${INITIAL_CONNECT_ATTEMPTS}), reintentando en ${delay} ms`,
        )
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  private async connect(): Promise<void> {
    const { token } = await this.api.sttToken()

    const url = new URL(WS_BASE)
    url.searchParams.set('token', token)
    url.searchParams.set('sample_rate', String(STREAM_SAMPLE_RATE))
    url.searchParams.set('encoding', 'pcm_s16le')
    url.searchParams.set('speech_model', 'universal-streaming-multilingual')
    url.searchParams.set('format_turns', 'true')

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      // Distinguir "falló antes de abrir" (reintento lo maneja quien llama)
      // de "se cayó ya conectado" (reconexión en vivo vía onConnectionLost).
      let opened = false

      ws.onopen = () => {
        opened = true
        // Nos pararon/pausaron mientras esta conexión estaba en vuelo (p.ej.
        // una reconexión en curso al momento de pausar): cerrar este socket en
        // vez de re-armar timers y dejarlo colgado hasta el idle-timeout.
        if (this.stopping) {
          try {
            ws.close()
          } catch {
            // ya está muerta
          }
          resolve()
          return
        }
        this.epoch += 1
        this.epochStartOffsetMs = Date.now() - this.captureStartMs
        this.reconnectAttempt = 0
        this.recentSent = []
        this.lastPartialTurn = -1
        this.epochAudioStarted = false
        console.log(`${this.tag()} WebSocket abierto (época ${this.epoch})`)
        this.flushBacklog()
        this.scheduleRotation()
        this.startStallWatch(ws)
        this.emit('status', 'recording' satisfies CaptureStatus)
        resolve()
      }
      ws.onmessage = (ev) => this.onMessage(ev)
      ws.onerror = () => {
        if (opened) return // ya conectado: el cierre lo maneja onclose
        this.ws = null
        try {
          ws.close()
        } catch {
          // ya está muerta
        }
        reject(new Error('WebSocket STT falló al conectar'))
      }
      ws.onclose = (ev) => {
        const detail = `${ev.code}${ev.reason ? `: ${ev.reason}` : ''}`
        if (!opened) {
          this.ws = null
          reject(new Error(`WebSocket STT cerró antes de abrir (${detail})`))
          return
        }
        this.onConnectionLost(detail)
      }
    })
  }

  private startStallWatch(ws: WebSocket): void {
    this.stallStrikes = 0
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.stallTimer = setInterval(() => {
      if (this.ws !== ws) return
      if (ws.bufferedAmount > STALL_THRESHOLD_BYTES) {
        this.stallStrikes += 1
      } else {
        this.stallStrikes = 0
      }
      if (this.stallStrikes < STALL_STRIKES) return
      this.forceDisconnect('conexión estancada — ¿sin red?')
    }, STALL_CHECK_MS)
  }

  /**
   * Da la conexión por muerta: rescata al backlog los chunks varados en el
   * buffer del socket (bufferedAmount = bytes que nunca salieron de la
   * máquina, no se duplica audio) y entra al ciclo de reconexión.
   */
  private forceDisconnect(reason: string): void {
    const ws = this.ws
    if (!ws) return
    const stranded = Math.min(Math.ceil(ws.bufferedAmount / 1600), this.recentSent.length)
    if (stranded > 0) {
      this.backlog.unshift(...this.recentSent.slice(-stranded))
    }
    console.warn(`${this.tag()} ${reason} (${ws.bufferedAmount} bytes sin salir), rescatados ${stranded} chunks`)
    this.ws = null
    ws.onclose = null
    try {
      ws.close()
    } catch {
      // ya está muerta
    }
    this.onConnectionLost(reason)
  }

  /** Señal instantánea de conectividad (navigator online/offline). */
  setNetworkOnline(online: boolean): void {
    if (this.stopping) return
    if (!online) {
      this.forceDisconnect('sin conexión de red')
      return
    }
    if (this.ws) return
    console.log(`${this.tag()} red de vuelta: reintentando ya`)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.connect().catch((err: unknown) =>
      isQuotaError(err) ? this.giveUp() : this.scheduleReconnect(),
    )
  }

  private onConnectionLost(detail: string): void {
    if (this.stopping) return
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.stallTimer = null
    this.ws = null
    console.warn(`${this.tag()} conexión perdida (${detail}), reintentando…`)
    this.emit('status', 'reconnecting' satisfies CaptureStatus, detail)
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopping) return
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)]
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopping) return
      this.connect().catch((err: unknown) => {
        if (isQuotaError(err)) return this.giveUp()
        console.warn(`${this.tag()} reintento fallido:`, err instanceof Error ? err.message : err)
        this.scheduleReconnect()
      })
    }, delay)
  }

  /**
   * Corte terminal (cuota agotada): parar todos los timers y reportar error.
   * A diferencia de una caída de red, aquí NO tiene sentido reintentar.
   */
  private giveUp(): void {
    if (this.stopping) return
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.reconnectTimer = null
    this.rotateTimer = null
    this.stallTimer = null
    console.warn(`${this.tag()} ${QUOTA_MESSAGE}`)
    this.emit('status', 'error' satisfies CaptureStatus, QUOTA_MESSAGE)
  }

  private scheduleRotation(): void {
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    this.rotateTimer = setTimeout(() => {
      if (this.stopping || !this.ws) return
      console.log(`${this.tag()} rotando sesión antes del límite de 3 h`)
      const ws = this.ws
      this.ws = null
      try {
        ws.onclose = null
        ws.send(JSON.stringify({ type: 'Terminate' }))
        ws.close()
      } catch {
        // seguir con la sesión nueva igual
      }
      this.connect().catch((err: unknown) =>
        isQuotaError(err) ? this.giveUp() : this.scheduleReconnect(),
      )
    }, SESSION_ROTATE_MS)
  }

  /** Chunk sin voz: pico bajo -40 dBFS (~1% de escala en PCM16). */
  private static isSilent(chunk: Buffer): boolean {
    // readInt16LE tolera cualquier byteOffset. NO usar `new Int16Array(buffer,
    // byteOffset)`: exige offset múltiplo de 2 y los frames del helper nativo
    // llegan con offset IMPAR (se les quitó el byte de canal con subarray(1,…))
    // → RangeError en flushBacklog al reconectar/reanudar.
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const s = chunk.readInt16LE(i)
      if (s > 330 || s < -330) return false
    }
    return true
  }

  private flushBacklog(): void {
    if (!this.backlog.length) return
    // Recorte de silencio: el STT drena a ~1.5-2× tiempo real; cada segundo
    // de silencio descartado acorta el catch-up. Los timestamps del tramo
    // recuperado se compactan (el orden se preserva).
    const before = this.backlog.length
    this.backlog = this.backlog.filter((c) => !AssemblyAiStream.isSilent(c))
    const trimmed = before - this.backlog.length
    if (trimmed > 0) {
      console.log(`${this.tag()} backlog: recortados ${trimmed} chunks de silencio (~${(trimmed * 50) / 1000}s)`)
    }
    if (!this.backlog.length) {
      this.droppedChunks = 0
      return
    }
    const seconds = (this.backlog.length * 50) / 1000
    // El backlog ocupa el INICIO del audio de esta sesión pero fue hablado
    // ANTES de reconectar: la época arranca donde empezó el backlog.
    this.epochStartOffsetMs -= seconds * 1000
    this.epochAudioStarted = true
    console.log(
      `${this.tag()} enviando backlog: ${this.backlog.length} chunks (~${seconds}s)` +
        (this.droppedChunks ? ` — ${this.droppedChunks} chunks descartados por tope` : ''),
    )
    for (const chunk of this.backlog) this.ws?.send(chunk)
    this.backlog = []
    this.droppedChunks = 0

    if (seconds > 5) {
      this.emit(
        'status',
        'recording' satisfies CaptureStatus,
        `Recovering ${Math.round(seconds)}s of missed transcription…`,
      )
      setTimeout(
        () => {
          if (!this.stopping && this.ws) this.emit('status', 'recording' satisfies CaptureStatus)
        },
        Math.min(seconds * 500, 20_000),
      )
    }
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return
    let msg: { type: string }
    try {
      msg = JSON.parse(ev.data) as { type: string }
    } catch {
      return
    }
    if (msg.type === 'Begin') console.log(`${this.tag()} sesión iniciada por AssemblyAI`)
    if (msg.type === 'Error') console.error(this.tag(), ev.data)
    if (msg.type !== 'Turn') return

    const turn = msg as TurnMessage
    if (!turn.transcript) return
    const inSession = turn.words?.[0]?.start ?? Date.now() - this.captureStartMs - this.epochStartOffsetMs
    // Offset dentro de ESTE tramo (relativo a su propio captureStartMs). El
    // desfase se mide con esto; a la línea de tiempo de la sesión se le suma
    // baseOffsetMs recién al emitir el segmento.
    const takeOffsetMs = this.epochStartOffsetMs + inSession
    if (turn.end_of_turn) {
      const lagS = (Date.now() - (this.captureStartMs + takeOffsetMs)) / 1000
      console.log(`${this.tag()} turn ${this.epoch}-${turn.turn_order} desfase ~${lagS.toFixed(1)}s (final)`)
    } else if (turn.turn_order !== this.lastPartialTurn) {
      // Primer parcial de este turno = latencia VISIBLE real (cuánto tardó en
      // aparecer el primer texto en pantalla). Si nunca aparece esta línea,
      // AssemblyAI no manda parciales y solo vemos finales (mala UX).
      this.lastPartialTurn = turn.turn_order
      const visibleS = (Date.now() - (this.captureStartMs + takeOffsetMs)) / 1000
      console.log(`${this.tag()} turn ${this.epoch}-${turn.turn_order} 1er texto ~${visibleS.toFixed(1)}s (visible)`)
    }
    const segment: CaptionSegment = {
      providerMessageId: `aai-${this.opts.channel}-t${this.take}-${this.epoch}-${turn.turn_order}`,
      speaker: this.opts.speaker,
      text: turn.transcript,
      tsOffsetMs: this.baseOffsetMs + takeOffsetMs,
    }
    this.emit('segment', segment)
  }

  acceptAudio(chunk: ArrayBuffer | Buffer): void {
    if (this.stopping) return
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    if (this.ws?.readyState === WebSocket.OPEN) {
      if (!this.epochAudioStarted) {
        // Primer audio real de la época (sin backlog previo): re-anclar aquí.
        // En un arranque en frío el mic tarda ~1s en calentar (warm-up del
        // voice processing) — ese hueco NO es parte de la línea de tiempo del
        // audio que AssemblyAI recibe.
        this.epochAudioStarted = true
        this.epochStartOffsetMs = Date.now() - this.captureStartMs
      }
      this.ws.send(buf)
      this.recentSent.push(buf)
      if (this.recentSent.length > RECENT_SENT_MAX) this.recentSent.shift()
      this.chunksSent += 1
      if (this.chunksSent === 1 || this.chunksSent % 200 === 0) {
        console.log(`${this.tag()} audio fluyendo: ${this.chunksSent} chunks (~${(this.chunksSent * 50) / 1000}s)`)
      }
      return
    }

    this.backlog.push(buf)
    if (this.backlog.length > MAX_BACKLOG_CHUNKS) {
      this.backlog.shift()
      this.droppedChunks += 1
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.rotateTimer) clearTimeout(this.rotateTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.reconnectTimer = null
    this.rotateTimer = null
    this.stallTimer = null

    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'Terminate' }))
      } catch {
        // cerrar igual
      }
      ws.close()
    }
    this.backlog = []
  }
}
