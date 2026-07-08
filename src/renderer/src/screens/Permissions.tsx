import { useEffect } from 'react'
import { useApp } from '@renderer/store'

// Pantalla crítica del onboarding nativo: sin estos dos permisos TCC la
// captura no funciona. El de micrófono se pide en runtime; el de Screen
// Recording solo se otorga en System Settings, así que abrimos el panel y
// re-chequeamos cuando la ventana recupera el foco.

export function Permissions({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { permissions, refreshPermissions } = useApp()

  useEffect(() => {
    const onFocus = (): void => void refreshPermissions()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(onFocus, 2000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [refreshPermissions])

  const micOk = permissions.microphone === 'granted'
  const screenOk = permissions.screen === 'granted'

  return (
    <div className="screen">
      <div className="card">
        <p className="eyebrow">One-time setup</p>
        <h1 className="title">Let Uyari hear your meetings</h1>
        <p className="subtitle">
          Uyari only records while you are in a meeting. Nothing is stored without your say-so.
        </p>

        <div className="perm-row">
          <div className="grow">
            <p className="perm-name">Microphone</p>
            <p className="perm-why">Captures your side of the conversation.</p>
          </div>
          {micOk ? (
            <span className="perm-state-granted">✓ Granted</span>
          ) : (
            <button
              className="btn btn-accent"
              onClick={() => void window.uyari.permissions.requestMicrophone().then(refreshPermissions)}
            >
              Allow
            </button>
          )}
        </div>

        <div className="perm-row">
          <div className="grow">
            <p className="perm-name">Screen &amp; system audio</p>
            <p className="perm-why">
              Captures the other participants’ audio. macOS asks for this in System Settings.
            </p>
          </div>
          {screenOk ? (
            <span className="perm-state-granted">✓ Granted</span>
          ) : (
            <button
              className="btn btn-accent"
              onClick={() => void window.uyari.permissions.openScreenRecordingSettings()}
            >
              Open Settings
            </button>
          )}
        </div>

        <div className="footer-actions">
          <button className="btn btn-ghost" onClick={onDone}>
            Skip for now
          </button>
          <button className="btn" disabled={!micOk || !screenOk} onClick={onDone}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
