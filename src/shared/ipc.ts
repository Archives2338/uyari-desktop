import type {
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
  captureState: 'capture:state',
  meetingsList: 'meetings:list',
  meetingsGet: 'meetings:get',
  meetingsAsk: 'meetings:ask',
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
  // main → renderer (push)
  evCaption: 'ev:caption',
  evSession: 'ev:session',
  evMicControl: 'ev:mic-control',
  evMeetingDetected: 'ev:meeting-detected',
  // El main calculó el hover del nub (posición global del cursor) y decide
  // cuándo expandir/colapsar; el renderer solo pinta.
  evNubExpanded: 'ev:nub-expanded',
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
    state(): Promise<SessionInfo | null>
  }
  meetings: {
    list(params?: { cursor?: string; limit?: number }): Promise<MeetingListPage>
    get(clientSessionId: string): Promise<MeetingDetailData>
    ask(clientSessionId: string, question: string): Promise<{ answer: string }>
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
  }
  events: {
    onCaption(cb: (segment: CaptionSegment) => void): () => void
    onSession(cb: (session: SessionInfo | null) => void): () => void
    onMicControl(cb: (cmd: MicControlCmd) => void): () => void
    /** Una app de reuniones empezó a usar el micrófono (auto-detección). */
    onMeetingDetected(cb: (info: { label: string }) => void): () => void
    /** El main decidió expandir/colapsar el nub (hover nativo). */
    onNubExpanded(cb: (expanded: boolean) => void): () => void
  }
}

declare global {
  interface Window {
    uyari: UyariBridge
  }
}
