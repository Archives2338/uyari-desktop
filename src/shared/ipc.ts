import type {
  AskAllResponse,
  AuthState,
  CaptionSegment,
  MeetingDetailData,
  MeetingListPage,
  MicControlCmd,
  PermissionState,
  PermissionsStatus,
  SessionInfo,
} from './domain'

// Contrato IPC único entre main ⇄ preload ⇄ renderer.
// Cualquier canal nuevo se declara aquí; nadie usa strings sueltos.

export const IPC = {
  // renderer → main (invoke)
  authLogin: 'auth:login',
  authState: 'auth:state',
  authLogout: 'auth:logout',
  permissionsStatus: 'permissions:status',
  permissionsRequestMic: 'permissions:request-mic',
  permissionsOpenScreenSettings: 'permissions:open-screen-settings',
  captureStart: 'capture:start',
  captureStop: 'capture:stop',
  capturePause: 'capture:pause',
  captureResume: 'capture:resume',
  captureState: 'capture:state',
  captureRename: 'capture:rename',
  meetingsList: 'meetings:list',
  meetingsGet: 'meetings:get',
  meetingsSaveNotes: 'meetings:save-notes',
  meetingsSaveTitle: 'meetings:save-title',
  meetingsSaveSummary: 'meetings:save-summary',
  meetingsRegenerateSummary: 'meetings:regenerate-summary',
  meetingsAsk: 'meetings:ask',
  /** "Pregúntale a Uyari" global — contra el historial, con citas. */
  meetingsAskAll: 'meetings:ask-all',
  meetingsShare: 'meetings:share',
  // renderer → main (fire-and-forget, alto volumen)
  micChunk: 'mic:chunk',
  micError: 'mic:error',
  micLog: 'mic:log',
  netStatus: 'net:status',
  // renderer → main: mousedown/mouseup sobre la pill (drag manual del nub)
  overlayDrag: 'overlay:drag',
  // renderer → main: el nub pide traer la ventana principal al frente
  // (tap en "Pregúntale a Uyari" — las respuestas se abren en la app)
  overlayFocusMain: 'overlay:focus-main',
  // renderer → main: igual que overlayFocusMain, pero además navega a la
  // pantalla de chat (el overlay nunca renderiza respuestas, solo abre ahí).
  overlayOpenAsk: 'overlay:open-ask',
  // main → renderer (push)
  evCaption: 'ev:caption',
  evSession: 'ev:session',
  evMicControl: 'ev:mic-control',
  evMeetingDetected: 'ev:meeting-detected',
  // El main calculó el hover del nub (posición global del cursor) y decide
  // cuándo expandir/colapsar; el renderer solo pinta.
  evNubExpanded: 'ev:nub-expanded',
  /** La ventana principal debe abrir "Pregúntale a Uyari" (viene del nub). */
  evOpenAsk: 'ev:open-ask',
  /** Volver a la nota en vivo (el nub trajo la principal al frente). */
  evRestoreNote: 'ev:restore-note',
} as const

// Superficie que el preload expone como window.uyari.
// El renderer solo conoce esta interfaz — nunca importa nada de electron.
export interface UyariBridge {
  auth: {
    login(email: string): Promise<AuthState>
    state(): Promise<AuthState>
    logout(): Promise<void>
  }
  permissions: {
    status(): Promise<PermissionsStatus>
    requestMicrophone(): Promise<PermissionState>
    openScreenRecordingSettings(): Promise<void>
  }
  capture: {
    start(title?: string): Promise<SessionInfo>
    stop(): Promise<{ finished: boolean }>
    /** Pausa la captura sin cerrar la sesión (retomable, sin resumen aún). */
    pause(): Promise<SessionInfo | null>
    /** Retoma una sesión pausada en un tramo nuevo. */
    resume(): Promise<SessionInfo | null>
    state(): Promise<SessionInfo | null>
    /** Renombra la sesión en vivo (vacío → "Untitled"). Persiste vía ingest. */
    rename(title: string): void
  }
  meetings: {
    list(params?: { cursor?: string; limit?: number }): Promise<MeetingListPage>
    get(clientSessionId: string): Promise<MeetingDetailData>
    /** Guarda las notas editables del usuario (el scratchpad, Fase 5a). */
    saveNotes(clientSessionId: string, userNotes: string): Promise<{ ok: boolean }>
    /** Renombra una reunión pasada (título editable en modo pasado). */
    saveTitle(clientSessionId: string, title: string): Promise<{ ok: boolean }>
    /** Guarda el content editado del panel Enhanced Notes (Fase 5c). */
    saveSummary(clientSessionId: string, content: string): Promise<{ ok: boolean }>
    /** Genera/regenera/reintenta el resumen, con plantilla opcional. */
    regenerateSummary(clientSessionId: string, template?: string): Promise<{ ok: boolean }>
    ask(clientSessionId: string, question: string): Promise<{ answer: string }>
    /** Chat global: pregunta contra el historial, con citas trazables.
     *  `meetingIds` acota el alcance; sin acotar usa las más recientes.
     *  `history` = turnos previos del MISMO hilo (para que un follow-up
     *  como "¿quiénes participaron?" sepa a qué se refiere). */
    askAll(
      question: string,
      meetingIds?: string[],
      history?: Array<{ question: string; answer: string }>,
    ): Promise<AskAllResponse>
    /** Activa el link público de solo-lectura y devuelve la URL. */
    share(clientSessionId: string): Promise<{ url: string }>
  }
  mic: {
    /** PCM16 mono al sample rate pedido por el main. */
    chunk(data: ArrayBuffer): void
    /** El mic no pudo arrancar (permiso, dispositivo, AudioContext…). */
    error(message: string): void
    /** Diagnóstico: etapas del arranque del mic, visibles en el main. */
    log(message: string): void
  }
  net: {
    /**
     * El renderer avisa al main de cambios de conectividad (navigator
     * online/offline): señal instantánea, mucho más rápida que esperar a
     * que el socket se estanque.
     */
    setOnline(online: boolean): void
  }
  overlay: {
    /**
     * Drag manual de la pill: el renderer reporta mousedown/mouseup y el
     * main mueve la ventana siguiendo el cursor. (El hover NO pasa por
     * aquí: lo calcula el main solo, con la posición global del cursor.)
     */
    dragStart(): void
    dragEnd(): void
    /** El "Pregúntale a Uyari" del nub no responde inline: abre la app. */
    focusMain(): void
    /** Igual que focusMain, pero navega directo a la pantalla de chat. */
    openAsk(): void
  }
  events: {
    onCaption(cb: (segment: CaptionSegment) => void): () => void
    onSession(cb: (session: SessionInfo | null) => void): () => void
    onMicControl(cb: (cmd: MicControlCmd) => void): () => void
    /** Una app de reuniones empezó a usar el micrófono (auto-detección). */
    onMeetingDetected(cb: (info: { label: string }) => void): () => void
    /** El main decidió expandir/colapsar el nub (hover nativo). */
    onNubExpanded(cb: (expanded: boolean) => void): () => void
    /** El nub pidió abrir "Pregúntale a Uyari" en la ventana principal. */
    onOpenAsk(cb: () => void): () => void
    /** Volver a la nota en vivo (el nub trajo la principal al frente). */
    onRestoreNote(cb: () => void): () => void
  }
}

declare global {
  interface Window {
    uyari: UyariBridge
  }
}
