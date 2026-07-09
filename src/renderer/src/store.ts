import { create } from 'zustand'
import type { AuthState, CaptionSegment, PermissionsStatus, SessionInfo } from '@shared/domain'

// Estado global del renderer. Espejo de lo que reporta el main vía bridge;
// no contiene lógica de negocio, solo estado de UI.

interface AppStore {
  auth: AuthState
  permissions: PermissionsStatus
  session: SessionInfo | null
  captions: CaptionSegment[]
  /** Reunión detectada por el mic-monitor ("Zoom", "a meeting in Chrome"…). */
  detectedMeeting: string | null
  /** clientSessionId abierto en MeetingDetail; null = se ve el Home. */
  openMeetingId: string | null

  refreshAuth(): Promise<void>
  refreshPermissions(): Promise<void>
  login(email: string): Promise<void>
  startCapture(title?: string): Promise<void>
  stopCapture(): Promise<void>
  pauseCapture(): Promise<void>
  resumeCapture(): Promise<void>
  pushCaption(segment: CaptionSegment): void
  setSession(session: SessionInfo | null): void
  setDetectedMeeting(label: string | null): void
  openMeeting(clientSessionId: string): void
  closeMeeting(): void
}

export const useApp = create<AppStore>((set, get) => ({
  auth: { loggedIn: false },
  permissions: { microphone: 'unknown', screen: 'unknown' },
  session: null,
  captions: [],
  detectedMeeting: null,
  openMeetingId: null,

  refreshAuth: async () => set({ auth: await window.uyari.auth.state() }),
  refreshPermissions: async () => set({ permissions: await window.uyari.permissions.status() }),

  login: async (email) => set({ auth: await window.uyari.auth.login(email) }),

  startCapture: async (title) => {
    const session = await window.uyari.capture.start(title)
    set({ session, captions: [], detectedMeeting: null })
  },

  stopCapture: async () => {
    // Guardar el id antes de limpiar la sesión: al terminar, saltamos
    // directo al detalle (resumen + action items) — el "momento wow".
    // captions también se limpia: si no, al volver al Home más tarde
    // (botón "Home" del detalle) se vería el transcript de la sesión
    // vieja pegado en la vista en vivo.
    const clientSessionId = get().session?.clientSessionId
    await window.uyari.capture.stop()
    set({ session: null, captions: [], openMeetingId: clientSessionId ?? null })
  },

  // Pausa/resume: el main empuja el nuevo estado por onSession, así que aquí
  // solo disparamos la acción (misma vía que las transiciones de estado).
  pauseCapture: async () => {
    await window.uyari.capture.pause()
  },
  resumeCapture: async () => {
    await window.uyari.capture.resume()
  },

  pushCaption: (segment) =>
    set((s) => {
      // Dedupe por providerMessageId: una versión más nueva pisa la anterior.
      const idx = s.captions.findIndex((c) => c.providerMessageId === segment.providerMessageId)
      if (idx >= 0) {
        const next = s.captions.slice()
        next[idx] = segment
        return { captions: next }
      }
      return { captions: [...s.captions, segment] }
    }),

  setSession: (session) => set({ session }),

  setDetectedMeeting: (label) => set({ detectedMeeting: label }),

  openMeeting: (clientSessionId) => set({ openMeetingId: clientSessionId }),
  closeMeeting: () => set({ openMeetingId: null }),
}))
