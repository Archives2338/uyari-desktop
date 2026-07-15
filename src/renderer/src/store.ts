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
  /** Modal de Ajustes abierto (overlay global, no compite con openMeetingId/askOpen). */
  settingsOpen: boolean
  /** La nota en vivo está minimizada al Home (la sesión sigue; el nub queda
   *  como reingreso). Solo aplica con sesión activa. */
  noteMinimized: boolean
  /** Si la sesión activa vino de REANUDAR una nota terminada, su clientSessionId.
   *  Permite quedarse en la vista de la nota (openMeetingId) mientras captura,
   *  y volver a ella al restaurar desde el nub — en vez de saltar a la vista
   *  "en vivo" (modelo de documento único de Granola: reanudar no cambia la
   *  vista). null = sesión nueva desde cero (nota en vivo normal). */
  resumedId: string | null
  /** clientSessionId de la nota que se ACABA de terminar (stop). Señal para
   *  que el NoteScreen (que se REMONTA al pasar de la vista "live" key="live"
   *  a la pasada key=openMeetingId) arranque el blind-poll de la auto-
   *  generación aunque no haya visto la transición capturing→false. Vive en el
   *  store justamente para sobrevivir ese remonte. Se limpia al consumirlo. */
  justEndedId: string | null
  /** La transcripción de esta nota se detuvo SOLA (fin de reunión detectado
   *  por el mic-monitor). El NoteScreen muestra el aviso; se limpia al
   *  descartarlo o al arrancar otra captura. */
  autoStoppedId: string | null

  refreshAuth(): Promise<void>
  refreshPermissions(): Promise<void>
  login(email: string): Promise<void>
  startCapture(title?: string): Promise<void>
  /** Reanuda una nota terminada: retoma la captura sobre su mismo
   *  clientSessionId SIN cambiar de vista (Granola: reanudar es un estado de
   *  fondo del mismo documento). Mantiene `openMeetingId` → seguís en la nota
   *  (tabs, panel, transcript); los captions nuevos se mergean al transcript. */
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
  openSettings(): void
  closeSettings(): void
  /** Minimiza la nota en vivo al Home (la grabación sigue; aparece el nub). */
  minimizeNote(): void
  /** Vuelve a la nota en vivo desde el Home. */
  restoreNote(): void
  /** Limpia justEndedId una vez que el NoteScreen lo consumió. */
  clearJustEnded(): void
  /** El main avisó que la transcripción se detuvo sola (fin de reunión).
   *  Llega ANTES del session→null: abre la nota terminada (misma transición
   *  que un stop manual) y marca el aviso para el NoteScreen. */
  noteAutoStopped(clientSessionId: string): void
  /** Descarta el aviso de auto-stop. */
  clearAutoStopped(): void
}

export const useApp = create<AppStore>((set, get) => ({
  auth: { loggedIn: false },
  permissions: { microphone: 'unknown', screen: 'unknown' },
  session: null,
  captions: [],
  detectedMeeting: null,
  openMeetingId: null,
  askOpen: false,
  settingsOpen: false,
  noteMinimized: false,
  resumedId: null,
  justEndedId: null,
  autoStoppedId: null,

  refreshAuth: async () => set({ auth: await window.uyari.auth.state() }),
  refreshPermissions: async () => set({ permissions: await window.uyari.permissions.status() }),

  login: async (email) => set({ auth: await window.uyari.auth.login(email) }),

  startCapture: async (title) => {
    const session = await window.uyari.capture.start(title)
    // Nota en vivo NUEVA (desde cero): no es una reanudación.
    set({ session, captions: [], detectedMeeting: null, noteMinimized: false, resumedId: null, autoStoppedId: null })
  },

  resumeMeeting: async ({ clientSessionId, title, baseOffsetMs }) => {
    const session = await window.uyari.capture.start(title, { clientSessionId, baseOffsetMs })
    // NO se cambia de vista: openMeetingId se MANTIENE en la nota (Granola:
    // reanudar es un estado de fondo). captions arranca vacío; el NoteScreen
    // mergea los captions nuevos con el transcript ya cargado (past.segments).
    // resumedId marca que esta sesión pertenece a esa nota (para volver a ella
    // al restaurar desde el nub, en vez de saltar a la vista "en vivo").
    set({
      session,
      captions: [],
      openMeetingId: clientSessionId,
      resumedId: clientSessionId,
      detectedMeeting: null,
      noteMinimized: false,
      autoStoppedId: null,
    })
  },

  stopCapture: async () => {
    // Al terminar quedamos EN la nota: openMeetingId = la reunión (misma vista;
    // si era una reanudación, ya estaba abierta ahí). El NoteScreen recarga el
    // transcript combinado al ver que la sesión pasó a null.
    const clientSessionId = get().session?.clientSessionId
    // finished=false → la sesión terminó ANTES del primer flush (5s) y nunca
    // se ingirió nada: la reunión NUNCA se creó en el backend. Navegar a
    // openMeetingId ahí sería abrir una nota fantasma — el NoteScreen quedaría
    // pollGeando un 404 para siempre (pantalla negra). En ese caso volvemos
    // al Home, como si la grabación nunca hubiera empezado.
    const { finished } = await window.uyari.capture.stop()
    // justEndedId: la nota recién terminada arranca el blind-poll del auto-gen
    // aunque el NoteScreen se remonte (live→pasada) — ver store interface.
    set({
      session: null,
      captions: [],
      openMeetingId: finished ? (clientSessionId ?? null) : null,
      noteMinimized: false,
      resumedId: null,
      justEndedId: finished ? (clientSessionId ?? null) : null,
    })
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
  // Overlay global: no toca openMeetingId/askOpen (se puede abrir desde
  // cualquier pantalla sin perder dónde estabas).
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  // Minimizar/restaurar la nota en vivo (solo estado de UI). En el Home la
  // RecordingPill hace de indicador+reingreso; el nub flotante del borde sigue
  // su regla normal (aparece solo con la app en segundo plano).
  // Minimizar libera la vista (Home + RecordingPill): se limpia openMeetingId
  // para que una nota reanudada no quede "pegada" por la precedencia del router.
  minimizeNote: () => set({ noteMinimized: true, openMeetingId: null }),
  // Restaurar: si la sesión venía de reanudar una nota, se reabre ESA nota
  // (openMeetingId = resumedId) — no la vista "en vivo". Sesión nueva → live.
  restoreNote: () =>
    set((s) => ({ noteMinimized: false, openMeetingId: s.resumedId ?? s.openMeetingId })),

  clearJustEnded: () => set({ justEndedId: null }),

  // Misma transición que un stop manual (openMeetingId queda en la nota, el
  // auto-gen arranca vía justEndedId) + el aviso "se detuvo sola". La sesión
  // en sí pasa a null cuando llegue el evSession(null) del stop del main.
  noteAutoStopped: (clientSessionId) =>
    set({
      captions: [],
      openMeetingId: clientSessionId,
      noteMinimized: false,
      resumedId: null,
      justEndedId: clientSessionId,
      autoStoppedId: clientSessionId,
    }),
  clearAutoStopped: () => set({ autoStoppedId: null }),
}))
