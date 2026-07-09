import { useEffect, useState } from 'react'
import { S } from '@renderer/strings'
import appIcon from '@renderer/assets/uyari-app-icon-macos.svg'

// Contenido de la ventana banner de reunión detectada (creada por el main
// cuando el mic-monitor ve una app de reunión encender el micrófono).
// Un click en "Start recording" arranca la captura Y abre la app (mismo
// flujo que Granola: detectar → un click → grabando con la nota abierta).
// El auto-dismiss (15 s) y el cierre al arrancar la captura los maneja el
// main; aquí solo la X y los botones.

export function DetectionBanner(): React.JSX.Element {
  const label = new URLSearchParams(window.location.search).get('label') ?? 'A meeting app'
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
  }, [])

  const start = async (): Promise<void> => {
    if (starting) return
    setStarting(true)
    try {
      await window.uyari.capture.start(`${label} meeting`)
      // Abrir la app con el transcript en vivo (equivalente a la nota que
      // abre Granola). El main cierra este banner al arrancar la sesión.
      window.uyari.overlay.focusMain()
    } catch {
      // Sin sesión o backend caído: llevar a la app para que el usuario
      // vea qué pasa (login / error) en vez de fallar en silencio.
      window.uyari.overlay.focusMain()
      window.close()
    }
  }

  return (
    <div className="det-banner">
      <img src={appIcon} className="det-banner-icon" alt="Uyari" />
      <span className="det-banner-text">
        <span className="det-banner-title">{S.banner.title}</span>
        <span className="det-banner-label">{label}</span>
      </span>
      <button className="det-banner-cta" disabled={starting} onClick={() => void start()}>
        {starting ? S.banner.starting : S.banner.start}
      </button>
      <button className="det-banner-close" title={S.banner.dismiss} onClick={() => window.close()}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
