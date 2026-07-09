import { useEffect, useRef, useState } from 'react'
import type { CaptionSegment, SessionInfo } from '@shared/domain'
import { groupCaptions, upsertCaption } from '@renderer/lib/captions'
import appIcon from '@renderer/assets/uyari-app-icon-macos.svg'

// Nub flotante — diseño OA/OD (dock vertical + popover al hover, sin tabs):
// en reposo solo se ve el DOCK (icono + puntos de estado, franja angosta
// contra el borde); el popover con el transcript vivo y "Pregúntale a
// Uyari" vive a su izquierda, oculto por CSS hasta el hover.
//
// El HOVER lo calcula el MAIN con la posición global del cursor contra los
// bounds del dock (ev:nub-expanded nos dice cuándo pintar el popover); aquí
// no hay mouseenter/mouseleave. El DRAG es manual: reportamos mousedown/
// mouseup sobre el dock y el main mueve la ventana con el cursor.
// Los captions llegan porque el main ya hace broadcast de ev:caption a
// TODAS las ventanas — cero lógica nueva.
//
// El ask bar no responde inline (el nub no tiene espacio para un chat):
// cualquier tap abre/enfoca la ventana principal — ahí vivirá "Ask Uyari"
// cuando exista esa pantalla.
//
// La ventana existe solo durante una sesión: si está montada, hay sesión.

const MAX_SEGMENTS = 60 // suficiente para la vista; el Home tiene el total

function formatElapsed(startedAtMs: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function OverlayPill(): React.JSX.Element {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [captions, setCaptions] = useState<CaptionSegment[]>([])
  const [expanded, setExpanded] = useState(false)
  const [, forceTick] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    void window.uyari.capture.state().then(setSession)
    const offSession = window.uyari.events.onSession(setSession)
    const offCaption = window.uyari.events.onCaption((segment) =>
      setCaptions((list) => upsertCaption(list, segment).slice(-MAX_SEGMENTS)),
    )
    const offExpanded = window.uyari.events.onNubExpanded(setExpanded)
    // Cierre del drag manual: mouseup en cualquier parte de la ventana.
    const onUp = (): void => window.uyari.overlay.dragEnd()
    document.addEventListener('mouseup', onUp)
    const tick = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => {
      offSession()
      offCaption()
      offExpanded()
      document.removeEventListener('mouseup', onUp)
      clearInterval(tick)
    }
  }, [])

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [captions, expanded])

  if (!session) return <></>
  const reconnecting = session.status === 'reconnecting'
  const preparingMic = session.status === 'starting'
  const paused = session.status === 'paused'
  const dim = reconnecting || paused // punto ámbar: no está grabando en vivo
  const openApp = (): void => window.uyari.overlay.focusMain()

  return (
    <div className="nub">
      <div
        className="nub-dock"
        onMouseDown={() => window.uyari.overlay.dragStart()}
        title="Uyari"
      >
        <img src={appIcon} className="nub-dock-icon" alt="Uyari" />
        <span className="nub-dock-dots">
          <i className={dim ? 'nub-dock-dot nub-dock-dot-amber' : 'nub-dock-dot'} />
          <i
            className={dim ? 'nub-dock-dot nub-dock-dot-amber' : 'nub-dock-dot'}
            style={{ opacity: 0.6, animationDelay: '160ms' }}
          />
          <i
            className={dim ? 'nub-dock-dot nub-dock-dot-amber' : 'nub-dock-dot'}
            style={{ opacity: 0.3, animationDelay: '320ms' }}
          />
        </span>
      </div>

      <div className={expanded ? 'nub-popover nub-popover-open' : 'nub-popover'}>
        <div className="nub-popover-header">
          <span className={dim ? 'nub-dot nub-dot-amber' : 'nub-dot'} />
          <span className="nub-title">{session.title}</span>
          <span className="nub-time">{formatElapsed(session.startedAtMs)}</span>
          <button
            className="nub-pause"
            title={paused ? 'Resume' : 'Pause'}
            onClick={() =>
              void (paused ? window.uyari.capture.resume() : window.uyari.capture.pause())
            }
          >
            {paused ? '▶' : '❚❚'}
          </button>
          <button
            className="nub-stop"
            title="Finish & summarize"
            onClick={() => void window.uyari.capture.stop()}
          >
            ■
          </button>
        </div>

        <div className="nub-popover-body">
          {captions.length === 0 ? (
            <p className="nub-empty">
              {reconnecting
                ? 'Reconnecting to transcription…'
                : paused
                  ? 'Paused — tap ▶ to resume.'
                  : preparingMic
                    ? 'Starting microphone…'
                    : 'Listening… captions will appear here.'}
            </p>
          ) : (
            <div className="nub-transcript">
              {groupCaptions(captions).map((g) => (
                <div className="nub-line" key={g.key}>
                  {g.speaker && (
                    <span className={g.speaker === 'You' ? 'nub-speaker nub-speaker-you' : 'nub-speaker'}>
                      {g.speaker}
                    </span>
                  )}
                  <div className="nub-bubble">{g.texts.join(' ')}</div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="nub-ask-bar">
          <button className="nub-ask-input" onClick={openApp}>
            Pregúntale a Uyari…
          </button>
          <button className="nub-ask-chip" onClick={openApp}>
            ¿Qué me perdí?
          </button>
        </div>
        <p className="nub-footnote">Las respuestas se abren en la app ↗</p>
      </div>
    </div>
  )
}
