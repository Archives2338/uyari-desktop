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

  refreshAuth(): Promise<void>
  refreshPermissions(): Promise<void>
  login(email: string): Promise<void>
  startCapture(title?: string): Promise<void>
  stopCapture(): Promise<void>
  pushCaption(segment: CaptionSegment): void
  setSession(session: SessionInfo | null): void
  setDetectedMeeting(label: string | null): void
}

export const useApp = create<AppStore>((set) => ({
  auth: { loggedIn: false },
  permissions: { microphone: 'unknown', screen: 'unknown' },
  session: null,
  captions: [],
  detectedMeeting: null,

  refreshAuth: async () => set({ auth: await window.uyari.auth.state() }),
  refreshPermissions: async () => set({ permissions: await window.uyari.permissions.status() }),

  login: async (email) => set({ auth: await window.uyari.auth.login(email) }),

  startCapture: async (title) => {
    const session = await window.uyari.capture.start(title)
    set({ session, captions: [], detectedMeeting: null })
  },

  stopCapture: async () => {
    await window.uyari.capture.stop()
    set({ session: null })
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
}))
