// Tipos de dominio compartidos entre main y renderer.
// CaptionSegment es el mismo shape que espera el backend en
// POST /meetings/:clientSessionId/segments (idéntico al de la extensión).

export type Platform = 'GOOGLE_MEET' | 'ZOOM' | 'MS_TEAMS'

export interface CaptionSegment {
  providerMessageId: string
  speaker?: string
  text: string
  tsOffsetMs: number
}

export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface PermissionsStatus {
  microphone: PermissionState
  screen: PermissionState
}

// 'starting': la sesión arrancó (STT conectado) pero el mic nativo todavía
// no confirmó su primer frame real — activar voice processing en macOS
// toma ~1s; mostrar 'recording' antes de eso hace que se pierdan las
// primeras palabras del usuario.
// 'paused': la captura se detuvo (helper + STT liberados) pero la sesión
// sigue viva y retomable — el resumen NO se genera hasta el stop definitivo.
export type CaptureStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'reconnecting'
  | 'stopping'
  | 'error'

export interface SessionInfo {
  clientSessionId: string
  title: string
  platform: Platform
  startedAtMs: number
  status: CaptureStatus
  /** Mensaje legible cuando status === 'error' (p.ej. STT sin configurar). */
  statusDetail?: string
}

// Comando main → renderer para el micrófono. La captura de mic vive en el
// renderer (getUserMedia solo existe ahí); el main decide cuándo y a qué
// sample rate, y recibe los chunks PCM16 de vuelta por IPC.
export type MicControlCmd = { action: 'start'; sampleRate: number } | { action: 'stop' }

export interface AuthState {
  loggedIn: boolean
  email?: string
}

// Detalle/listado de reuniones (GET /meetings, GET /meetings/:id — backend
// ya los tenía, los usa la extensión). Fechas llegan como ISO string (el
// JSON de fetch no las revive a Date).

export type SummaryStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'

export interface MeetingSummary {
  status: SummaryStatus
  content?: string | null
  actionItems?: string[] | null
  error?: string | null
}

export interface TranscriptSegmentRow {
  providerMessageId: string
  speaker?: string | null
  text: string
  tsOffsetMs: number
}

export interface MeetingDetailData {
  id: string
  clientSessionId: string
  title?: string | null
  platform: Platform
  language?: string | null
  startedAt: string
  endedAt?: string | null
  summary: MeetingSummary | null
  segments: TranscriptSegmentRow[]
  /** Notas editables del usuario (Fase 5a, el scratchpad). null = vacías. */
  userNotes?: string | null
}

export interface MeetingListItem {
  id: string
  clientSessionId: string
  title?: string | null
  platform: Platform
  language?: string | null
  startedAt: string
  endedAt?: string | null
  summaryStatus: SummaryStatus | null
  segmentCount: number
}

export interface MeetingListPage {
  items: MeetingListItem[]
  nextCursor: string | null
}

// "Pregúntale a Uyari" global (chat, no ligado a una reunión abierta).
export interface AskAllCitation {
  clientSessionId: string
  title: string | null
  occurredAt: string
  actionItems: string[]
}

export interface AskAllResponse {
  answer: string
  citations: AskAllCitation[]
  followUps: string[]
}
