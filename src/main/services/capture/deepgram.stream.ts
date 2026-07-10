import { EventEmitter } from 'node:events'
import type { CaptionSegment, CaptureStatus } from '@shared/domain'
import type { StreamOptions } from './assemblyai.stream'

// Un canal de STT streaming contra Deepgram nova-3 — el proveedor de menor
// latencia que usa Granola. Interfaz idéntica a AssemblyAiStream (start/stop/
// acceptAudio/streamedSeconds/setNetworkOnline + eventos 'segment'/'status'),
// así el engine puede usar cualquiera de los dos (ver createSttStream).
//
// Protocolo (verificado contra la doc de Deepgram, jul 2026):
//   wss://api.deepgram.com/v1/listen
//     ?model=nova-3 &language=multi &encoding=linear16 &sample_rate=16000
//     &channels=1 &interim_results=true &smart_format=true &endpointing=300
//     &no_delay=true
//   Auth: token efímero como SUBPROTOCOLO → new WebSocket(url, ['token', tk])
//     (Sec-WebSocket-Protocol: token, <token> — browser-safe, como Granola).
//   Audio: frames binarios PCM16 mono a 16 kHz.
//   Respuestas JSON: {type:'Results', channel:{alternatives:[{transcript}]},
//     is_final, speech_final, start, duration}. Interinos (is_final=false) se
//     actualizan en vivo; el final cierra el segmento.
//   Cierre limpio: enviar {type:'CloseStream'} antes de close().
//
// Resiliencia con FILOSOFÍA TIEMPO-REAL (la lección de Granola:
// maxEnqueuedMessages): el backlog es ACOTADO. Si la conexión se cae, al
// reconectar mandamos a lo sumo unos segundos y descartamos lo viejo — nunca
// el catch-up de segundos que hacía sentir el delay con AssemblyAI.

export const DG_SAMPLE_RATE = 16000
const DG_URL = 'wss://api.deepgram.com/v1/listen'

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
const INITIAL_CONNECT_ATTEMPTS = 5
// Backlog ACOTADO: máximo ~3 s. Preferimos perder un pedacito y quedar en
// tiempo real a acumular delay (patrón Granola).
const MAX_BACKLOG_CHUNKS = 60 // 3 s a chunks de 50 ms
const KEEPALIVE_MS = 8000 // Deepgram cierra por inactividad a ~10 s

// Socket estancado (uplink caído sin que TCP lo note): bufferedAmount crece.
const STALL_CHECK_MS = 2000
const STALL_THRESHOLD_BYTES = 32000
const STALL_STRIKES = 3

const QUOTA_MESSAGE = 'Alcanzaste tu límite de transcripción de este mes.'

function isQuotaError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'STT_QUOTA_EXCEEDED'
  )
}

export interface DeepgramTokenProvider {
  deepgramToken(): Promise<{ token: string }>
}

interface DgResults {
  type: 'Results'
  is_final?: boolean
  speech_final?: boolean
  start?: number
  duration?: number
  channel?: { alternatives?: Array<{ transcript?: string }> }
}

export class DeepgramStream extends EventEmitter {
  private ws: WebSocket | null = null
  private stopping = false
  private chunksSent = 0

  private captureStartMs = 0
  private epoch = 0
  private epochStartOffsetMs = 0
  private epochAudioStarted = false
  private segSeq = 0
  private take = 0
  private baseOffsetMs = 0

  private backlog: Buffer[] = []
  private reconnectAttempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private keepaliveTimer: NodeJS.Timeout | null = null
  private stallTimer: NodeJS.Timeout | null = null
  private stallStrikes = 0

  constructor(
    private readonly api: DeepgramTokenProvider,
    private readonly opts: StreamOptions,
  ) {
    super()
  }

  private tag(): string {
    return `[dg:${this.opts.channel}]`
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
        console.warn(`${this.tag()} conexión inicial falló (intento ${attempt + 1}), reintenta en ${delay} ms`)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }

  private async connect(): Promise<void> {
    const { token } = await this.api.deepgramToken()

    const url = new URL(DG_URL)
    url.searchParams.set('model', 'nova-3')
    url.searchParams.set('language', 'multi') // multilingüe (es/en, code-switching)
    url.searchParams.set('encoding', 'linear16')
    url.searchParams.set('sample_rate', String(DG_SAMPLE_RATE))
    url.searchParams.set('channels', '1')
    url.searchParams.set('interim_results', 'true')
    url.searchParams.set('smart_format', 'true')
    url.searchParams.set('endpointing', '300') // ms de silencio para cerrar turno
    url.searchParams.set('no_delay', 'true') // menor latencia de parciales

    await new Promise<void>((resolve, reject) => {
      // Token como subprotocolo (browser-safe, sin headers custom).
      const ws = new WebSocket(url, ['token', token])
      ws.binaryType = 'arraybuffer'
      this.ws = ws
      let opened = false

      ws.onopen = () => {
        opened = true
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
        this.epochAudioStarted = false
        this.reconnectAttempt = 0
        this.segSeq = 0
        console.log(`${this.tag()} WebSocket abierto (época ${this.epoch})`)
        this.flushBacklog()
        this.startKeepalive()
        this.startStallWatch(ws)
        this.emit('status', 'recording' satisfies CaptureStatus)
        resolve()
      }
      ws.onmessage = (ev) => this.onMessage(ev)
      ws.onerror = () => {
        if (opened) return
        this.ws = null
        try {
          ws.close()
        } catch {
          // ya está muerta
        }
        reject(new Error('WebSocket Deepgram falló al conectar'))
      }
      ws.onclose = (ev) => {
        const detail = `${ev.code}${ev.reason ? `: ${ev.reason}` : ''}`
        if (!opened) {
          this.ws = null
          reject(new Error(`WebSocket Deepgram cerró antes de abrir (${detail})`))
          return
        }
        this.onConnectionLost(detail)
      }
    })
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
        } catch {
          // el onclose lo maneja
        }
      }
    }, KEEPALIVE_MS)
  }

  private startStallWatch(ws: WebSocket): void {
    this.stallStrikes = 0
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.stallTimer = setInterval(() => {
      if (this.ws !== ws) return
      this.stallStrikes = ws.bufferedAmount > STALL_THRESHOLD_BYTES ? this.stallStrikes + 1 : 0
      if (this.stallStrikes < STALL_STRIKES) return
      console.warn(`${this.tag()} conexión estancada (${ws.bufferedAmount} bytes) — reconectando`)
      this.forceDisconnect('estancada')
    }, STALL_CHECK_MS)
  }

  private forceDisconnect(reason: string): void {
    const ws = this.ws
    if (!ws) return
    // Backlog ACOTADO: NO rescatamos lo estancado (quedaría delay). Empezamos
    // limpio en tiempo real al reconectar.
    this.backlog = []
    this.ws = null
    ws.onclose = null
    try {
      ws.close()
    } catch {
      // ya está muerta
    }
    this.onConnectionLost(reason)
  }

  setNetworkOnline(online: boolean): void {
    if (this.stopping) return
    if (!online) {
      this.forceDisconnect('sin red')
      return
    }
    if (this.ws) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.connect().catch((err: unknown) =>
      isQuotaError(err) ? this.giveUp() : this.scheduleReconnect(),
    )
  }

  private onConnectionLost(detail: string): void {
    if (this.stopping) return
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.keepaliveTimer = null
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

  private giveUp(): void {
    if (this.stopping) return
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.reconnectTimer = null
    this.keepaliveTimer = null
    this.stallTimer = null
    console.warn(`${this.tag()} ${QUOTA_MESSAGE}`)
    this.emit('status', 'error' satisfies CaptureStatus, QUOTA_MESSAGE)
  }

  private flushBacklog(): void {
    if (!this.backlog.length) return
    for (const chunk of this.backlog) this.ws?.send(chunk)
    this.backlog = []
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return
    let msg: DgResults
    try {
      msg = JSON.parse(ev.data) as DgResults
    } catch {
      return
    }
    if (msg.type !== 'Results') return
    const transcript = msg.channel?.alternatives?.[0]?.transcript ?? ''
    if (!transcript) {
      // Un final vacío igual cierra el turno (silencio detectado).
      if (msg.is_final) this.segSeq += 1
      return
    }

    const startMs = (msg.start ?? 0) * 1000
    const tsOffsetMs = this.baseOffsetMs + this.epochStartOffsetMs + startMs
    if (msg.is_final) {
      const lagS = (Date.now() - (this.captureStartMs + tsOffsetMs)) / 1000
      console.log(`${this.tag()} seg ${this.epoch}-${this.segSeq} desfase ~${lagS.toFixed(1)}s (final)`)
    }

    const segment: CaptionSegment = {
      providerMessageId: `dg-${this.opts.channel}-t${this.take}-${this.epoch}-${this.segSeq}`,
      speaker: this.opts.speaker,
      text: transcript,
      tsOffsetMs,
    }
    this.emit('segment', segment)

    // is_final cierra el segmento: el próximo Results arranca uno nuevo.
    if (msg.is_final) this.segSeq += 1
  }

  acceptAudio(chunk: ArrayBuffer | Buffer): void {
    if (this.stopping) return
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    if (this.ws?.readyState === WebSocket.OPEN) {
      if (!this.epochAudioStarted) {
        // Re-anclar la época al primer audio real (el mic tarda en calentar).
        this.epochAudioStarted = true
        this.epochStartOffsetMs = Date.now() - this.captureStartMs
      }
      this.ws.send(buf)
      this.chunksSent += 1
      if (this.chunksSent === 1 || this.chunksSent % 200 === 0) {
        console.log(`${this.tag()} audio fluyendo: ${this.chunksSent} chunks (~${(this.chunksSent * 50) / 1000}s)`)
      }
      return
    }

    // Desconectados: backlog ACOTADO (tiramos lo viejo → tiempo real).
    this.backlog.push(buf)
    if (this.backlog.length > MAX_BACKLOG_CHUNKS) this.backlog.shift()
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
    if (this.stallTimer) clearInterval(this.stallTimer)
    this.reconnectTimer = null
    this.keepaliveTimer = null
    this.stallTimer = null

    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'CloseStream' }))
      } catch {
        // cerrar igual
      }
      ws.close()
    }
    this.backlog = []
  }
}
