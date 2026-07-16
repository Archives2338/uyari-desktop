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
  /** content = versión editable; originalContent = versión IA (para Restore). */
  content?: string | null
  originalContent?: string | null
  /** Slug de la plantilla que lo generó. */
  template?: string | null
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
  /** Proyecto al que pertenece (null = sin proyecto). Ver Project. */
  projectId?: string | null
}

export interface MeetingListPage {
  items: MeetingListItem[]
  nextCursor: string | null
}

// Proyectos: el diferenciador de Granola — agrupan reuniones por "en qué estoy
// trabajando" y muestran un rollup de pendientes de TODAS sus reuniones juntas.

/** Fila de proyecto para el sidebar (con contadores agregados). */
export interface ProjectSummary {
  id: string
  name: string
  /** Color del chip (slug de token o hex). null = neutral. */
  color: string | null
  archived: boolean
  createdAt: string
  meetingCount: number
  /** Total de action items sumando las reuniones (hoy sin estado abierto/hecho). */
  actionItemCount: number
}

/** Reunión dentro del detalle de un proyecto. */
export interface ProjectDetailMeeting {
  clientSessionId: string
  title: string | null
  platform: Platform
  startedAt: string
  endedAt: string | null
  summaryStatus: SummaryStatus | null
  actionItemCount: number
}

/** Un pendiente del rollup, con trazabilidad a su reunión de origen. */
export interface ProjectRollupItem {
  meetingClientSessionId: string
  meetingTitle: string | null
  text: string
}

/** Detalle del proyecto: reuniones + rollup de action items. */
export interface ProjectDetail {
  id: string
  name: string
  color: string | null
  archived: boolean
  createdAt: string
  meetings: ProjectDetailMeeting[]
  actionItems: ProjectRollupItem[]
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
