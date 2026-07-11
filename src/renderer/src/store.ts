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
  /** "Pregúntale a Uyari" (chat global) está abierto. */
  askOpen: boolean
  /** La nota en vivo está minimizada al Home (la sesión sigue; el nub queda
   *  como reingreso). Solo aplica con sesión activa. */
  noteMinimized: boolean

  refreshAuth(): Promise<void>
  refreshPermissions(): Promise<void>
  login(email: string): Promise<void>
  startCapture(title?: string): Promise<void>
  /** Reanuda una nota terminada: retoma la captura sobre su mismo
   *  clientSessionId y sale de modo pasado. El dock en vivo arranca VACÍO
   *  (como Granola: solo el stream nuevo; el transcript viejo vive en la nota,
   *  no se re-inyecta en la burbuja). El offset continúa tras lo ya transcrito. */
  resumeMeeting(input: {
    clientSessionId: string
    title: string
    baseOffsetMs: number
  }): Promise<void>
  stopCapture(): Promise<void>
  pauseCapture(): Promise<void>
  resumeCapture(): Promise<void>
  pushCaption(segment: CaptionSegment): void
  setSession(session: SessionInfo | null): void
  setDetectedMeeting(label: string | null): void
  openMeeting(clientSessionId: string): void
  closeMeeting(): void
  openAsk(): void
  closeAsk(): void
  /** Minimiza la nota en vivo al Home (la grabación sigue; aparece el nub). */
  minimizeNote(): void
  /** Vuelve a la nota en vivo desde el Home. */
  restoreNote(): void
}

export const useApp = create<AppStore>((set, get) => ({
  auth: { loggedIn: false },
  permissions: { microphone: 'unknown', screen: 'unknown' },
  session: null,
  captions: [],
  detectedMeeting: null,
  openMeetingId: null,
  askOpen: false,
  noteMinimized: false,

  refreshAuth: async () => set({ auth: await window.uyari.auth.state() }),
  refreshPermissions: async () => set({ permissions: await window.uyari.permissions.status() }),

  login: async (email) => set({ auth: await window.uyari.auth.login(email) }),

  startCapture: async (title) => {
    const session = await window.uyari.capture.start(title)
    set({ session, captions: [], detectedMeeting: null, noteMinimized: false })
  },

  resumeMeeting: async ({ clientSessionId, title, baseOffsetMs }) => {
    const session = await window.uyari.capture.start(title, { clientSessionId, baseOffsetMs })
    // captions arranca VACÍO (como Granola): el dock en vivo solo muestra el
    // stream nuevo. El transcript viejo NO se re-inyecta en la burbuja; sigue
    // en la nota y reaparece completo (viejo + nuevo) al terminar (modo pasado).
    // openMeetingId:null sale de modo pasado y entra a la nota en vivo.
    set({
      session,
      captions: [],
      openMeetingId: null,
      detectedMeeting: null,
      noteMinimized: false,
    })
  },

  stopCapture: async () => {
    // Guardar el id antes de limpiar la sesión: al terminar, saltamos
    // directo al detalle (resumen + action items) — el "momento wow".
    // captions también se limpia: si no, al volver al Home más tarde
    // (botón "Home" del detalle) se vería el transcript de la sesión
    // vieja pegado en la vista en vivo.
    const clientSessionId = get().session?.clientSessionId
    await window.uyari.capture.stop()
    set({ session: null, captions: [], openMeetingId: clientSessionId ?? null, noteMinimized: false })
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
      // Texto vacío = retracción (dedup de eco): se remueve de la vista.
      const idx = s.captions.findIndex((c) => c.providerMessageId === segment.providerMessageId)
      if (segment.text === '') {
        if (idx < 0) return {}
        return { captions: [...s.captions.slice(0, idx), ...s.captions.slice(idx + 1)] }
      }
      if (idx >= 0) {
        const next = s.captions.slice()
        next[idx] = segment
        return { captions: next }
      }
      return { captions: [...s.captions, segment] }
    }),

  setSession: (session) => set({ session }),

  setDetectedMeeting: (label) => set({ detectedMeeting: label }),

  // openMeetingId, askOpen: dos "pantallas" mutuamente excluyentes sobre el
  // Home — abrir una cierra la otra (mismo patrón que un router simple).
  openMeeting: (clientSessionId) => set({ openMeetingId: clientSessionId, askOpen: false }),
  closeMeeting: () => set({ openMeetingId: null }),
  openAsk: () => set({ openMeetingId: null, askOpen: true }),
  closeAsk: () => set({ askOpen: false }),

  // Minimizar/restaurar la nota en vivo (solo estado de UI). En el Home la
  // RecordingPill hace de indicador+reingreso; el nub flotante del borde sigue
  // su regla normal (aparece solo con la app en segundo plano).
  minimizeNote: () => set({ noteMinimized: true }),
  restoreNote: () => set({ noteMinimized: false }),
}))
