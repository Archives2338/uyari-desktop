import { useEffect, useState } from 'react'
import { useApp } from '@renderer/store'
import { startMic, stopMic } from '@renderer/lib/mic'
import { ThemeRoot } from '@renderer/theme/theme'
import { OnboardingFlow } from '@renderer/onboarding/Flow'
import { loadFlow } from '@renderer/onboarding/state'
import { Home } from '@renderer/screens/Home'
import { OverlayPill } from '@renderer/screens/OverlayPill'

const IS_OVERLAY = new URLSearchParams(window.location.search).get('view') === 'overlay'

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
  return <MainApp />
}

function MainApp(): React.JSX.Element {
  const { auth, refreshAuth, refreshPermissions, pushCaption, setSession, setDetectedMeeting } =
    useApp()
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(() => loadFlow().done)

  useEffect(() => {
    void Promise.all([refreshAuth(), refreshPermissions()]).then(() => setReady(true))
    const offCaption = window.uyari.events.onCaption(pushCaption)
    const offSession = window.uyari.events.onSession(setSession)
    const offDetected = window.uyari.events.onMeetingDetected(({ label }) =>
      setDetectedMeeting(label),
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
      window.removeEventListener('online', notifyOnline)
      window.removeEventListener('offline', notifyOffline)
    }
  }, [refreshAuth, refreshPermissions, pushCaption, setSession, setDetectedMeeting])

  const showOnboarding = !auth.loggedIn || !onboarded

  return (
    <ThemeRoot>
      <div className="drag-region" />
      {!ready ? (
        <div style={{ height: '100%' }} />
      ) : showOnboarding ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <OnboardingFlow loggedIn={auth.loggedIn} onDone={() => setOnboarded(true)} />
        </div>
      ) : (
        <Home />
      )}
    </ThemeRoot>
  )
}
