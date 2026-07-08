import type {
  AuthState,
  CaptionSegment,
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
  // renderer → main (fire-and-forget, alto volumen)
  micChunk: 'mic:chunk',
  micError: 'mic:error',
  micLog: 'mic:log',
  netStatus: 'net:status',
  // main → renderer (push)
  evCaption: 'ev:caption',
  evSession: 'ev:session',
  evMicControl: 'ev:mic-control',
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
  events: {
    onCaption(cb: (segment: CaptionSegment) => void): () => void
    onSession(cb: (session: SessionInfo | null) => void): () => void
    onMicControl(cb: (cmd: MicControlCmd) => void): () => void
  }
}

declare global {
  interface Window {
    uyari: UyariBridge
  }
}
