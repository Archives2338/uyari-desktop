import { useEffect, useState } from 'react'
import { useApp } from '@renderer/store'
import { startMic, stopMic } from '@renderer/lib/mic'
import { Welcome } from '@renderer/screens/Welcome'
import { Permissions } from '@renderer/screens/Permissions'
import { Home } from '@renderer/screens/Home'

// Router mínimo por estado: login → permisos → home.
// Cuando entren las pantallas de Claude Design, cada paso del wizard se
// agrega aquí sin tocar main ni preload.

export function App(): React.JSX.Element {
  const { auth, refreshAuth, refreshPermissions, pushCaption, setSession } = useApp()
  const [ready, setReady] = useState(false)
  const [permissionsDone, setPermissionsDone] = useState(false)

  useEffect(() => {
    void Promise.all([refreshAuth(), refreshPermissions()]).then(() => setReady(true))
    const offCaption = window.uyari.events.onCaption(pushCaption)
    const offSession = window.uyari.events.onSession(setSession)
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
      window.removeEventListener('online', notifyOnline)
      window.removeEventListener('offline', notifyOffline)
    }
  }, [refreshAuth, refreshPermissions, pushCaption, setSession])

  if (!ready) return <div className="screen" />

  let screen: React.JSX.Element
  if (!auth.loggedIn) {
    screen = <Welcome />
  } else if (!permissionsDone) {
    screen = <Permissions onDone={() => setPermissionsDone(true)} />
  } else {
    screen = <Home />
  }

  return (
    <>
      <div className="drag-region" />
      {screen}
    </>
  )
}
