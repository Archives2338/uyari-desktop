import { useEffect, useState } from 'react'
import type { SessionInfo } from '@shared/domain'

// Contenido de la ventana overlay (creada por el main solo durante una
// sesión). Píldora arrastrable: punto de estado + tiempo transcurrido +
// botón de stop. No maneja auth ni permisos: si existe, hay sesión.

function formatElapsed(startedAtMs: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function OverlayPill(): React.JSX.Element {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [, forceTick] = useState(0)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    void window.uyari.capture.state().then(setSession)
    const off = window.uyari.events.onSession(setSession)
    const tick = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [])

  if (!session) return <></>
  const reconnecting = session.status === 'reconnecting'

  return (
    <div className="overlay-pill">
      <span className={reconnecting ? 'pill-dot pill-dot-amber' : 'pill-dot'} />
      <span className="pill-time">{formatElapsed(session.startedAtMs)}</span>
      <span className="pill-label">{reconnecting ? 'Reconnecting…' : 'Uyari'}</span>
      <button
        className="pill-stop"
        title="Finish & summarize"
        onClick={() => void window.uyari.capture.stop()}
      >
        ■
      </button>
    </div>
  )
}
