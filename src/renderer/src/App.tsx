import { useEffect, useState } from 'react'
import { useApp } from '@renderer/store'
import { startMic, stopMic } from '@renderer/lib/mic'
import { ThemeRoot } from '@renderer/theme/theme'
import { OnboardingFlow } from '@renderer/onboarding/Flow'
import { loadFlow } from '@renderer/onboarding/state'
import { Home } from '@renderer/screens/Home'
import { AskUyari } from '@renderer/screens/AskUyari'
import { NoteScreen } from '@renderer/screens/note/NoteScreen'
import { RecordingPill } from '@renderer/components/RecordingPill'
import { OverlayPill } from '@renderer/screens/OverlayPill'
import { DetectionBanner } from '@renderer/screens/DetectionBanner'

const QUERY = new URLSearchParams(window.location.search)
const IS_OVERLAY = QUERY.get('view') === 'overlay'
// Dev: UYARI_ONBOARDING=1 npm run dev → el main agrega ?onboarding=1 y el
// wizard se muestra desde el inicio aunque ya esté completado.
const FORCE_ONBOARDING = QUERY.get('onboarding') === '1'

// Router por estado: onboarding (login + permisos incluidos) → Home.
// El cableado de eventos IPC es idéntico al de antes — la migración de UI
// no toca lógica: mismo store, mismos canales, mismo mic control.

export function App(): React.JSX.Element {
  if (IS_OVERLAY) {
    return (
      <ThemeRoot transparent>
        <OverlayPill />
      </ThemeRoot>
    )
  }
  if (QUERY.get('view') === 'banner') {
    return (
      <ThemeRoot transparent>
        <DetectionBanner />
      </ThemeRoot>
    )
  }
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const {
    auth,
    refreshAuth,
    refreshPermissions,
    pushCaption,
    setSession,
    setDetectedMeeting,
    openMeetingId,
    askOpen,
    openAsk,
    session,
    noteMinimized,
    restoreNote,
    noteAutoStopped,
  } = useApp()
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(() => !FORCE_ONBOARDING && loadFlow().done)

  useEffect(() => {
    void Promise.all([refreshAuth(), refreshPermissions()]).then(() => setReady(true))
    const offCaption = window.uyari.events.onCaption(pushCaption)
    const offSession = window.uyari.events.onSession(setSession)
    const offDetected = window.uyari.events.onMeetingDetected(({ label }) =>
      setDetectedMeeting(label),
    )
    const offOpenAsk = window.uyari.events.onOpenAsk(openAsk)
    const offRestoreNote = window.uyari.events.onRestoreNote(restoreNote)
    // Fin de reunión detectado por el mic-monitor: el main detuvo la captura
    // solo. Abrir la nota terminada ANTES de que llegue el session→null (si
    // no, el router caería al Home) y mostrar el aviso en la nota.
    const offAutoStopped = window.uyari.events.onAutoStopped(({ clientSessionId }) =>
      noteAutoStopped(clientSessionId),
    )
    const offMic = window.uyari.events.onMicControl((cmd) => {
      window.uyari.mic.log(`control recibido: ${cmd.action}`)
      if (cmd.action === 'start') {
        startMic(cmd.sampleRate).catch((err: unknown) => {
          window.uyari.mic.error(err instanceof Error ? err.message : String(err))
        })
      } else {
        stopMic()
      }
    })
    // Conectividad: aviso instantáneo al main (el socket estancado es el
    // fallback lento; esto dispara la reconexión y el aviso en <1 s).
    const notifyOnline = (): void => window.uyari.net.setOnline(true)
    const notifyOffline = (): void => window.uyari.net.setOnline(false)
    window.addEventListener('online', notifyOnline)
    window.addEventListener('offline', notifyOffline)
    return () => {
      offCaption()
      offSession()
      offMic()
      offDetected()
      offOpenAsk()
      offRestoreNote()
      offAutoStopped()
      window.removeEventListener('online', notifyOnline)
      window.removeEventListener('offline', notifyOffline)
    }
  }, [
    refreshAuth,
    refreshPermissions,
    pushCaption,
    setSession,
    setDetectedMeeting,
    openAsk,
    restoreNote,
  ])

  const showOnboarding = !auth.loggedIn || !onboarded

  return (
    <ThemeRoot>
      <div className="drag-region" />
      {/* Nota minimizada: píldora de grabación al centro-arriba del dashboard
          (patrón Granola), como indicador + reingreso dentro de la app. */}
      {ready && !showOnboarding && session && noteMinimized && <RecordingPill />}
      {!ready ? (
        <div style={{ height: '100%' }} />
      ) : showOnboarding ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <OnboardingFlow
            loggedIn={auth.loggedIn}
            startFresh={FORCE_ONBOARDING}
            onDone={() => setOnboarded(true)}
          />
        </div>
      ) : openMeetingId ? (
        // Reunión terminada → la MISMA pantalla de nota, en modo pasado
        // (documento único de Granola): notas + tab "Notas de Uyari".
        <NoteScreen key={openMeetingId} pastId={openMeetingId} />
      ) : askOpen ? (
        <AskUyari />
      ) : session && !noteMinimized ? (
        // Sesión activa → nota en vivo. Minimizada: Home + RecordingPill.
        <NoteScreen key="live" />
      ) : (
        <Home />
      )}
    </ThemeRoot>
  )
}
