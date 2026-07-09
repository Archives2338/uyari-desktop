import { useEffect, useRef, useState } from 'react'
import type { CaptionSegment, SessionInfo } from '@shared/domain'
import { groupCaptions, upsertCaption } from '@renderer/lib/captions'

// Nub flotante — modelo Granola completo: el HOVER lo calcula el MAIN con
// la posición global del cursor (ev:nub-expanded nos dice cuándo pintar el
// panel); aquí no hay mouseenter/mouseleave. El DRAG es manual: reportamos
// mousedown/mouseup en la pill y el main mueve la ventana con el cursor.
// Los captions llegan porque el main ya hace broadcast de ev:caption a
// TODAS las ventanas — cero lógica nueva.
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

  return (
    <div className="nub">
      <div
        className="overlay-pill"
        onMouseDown={(e) => {
          // Drag manual desde cualquier punto de la pill salvo el stop.
          if ((e.target as HTMLElement).closest('.pill-stop')) return
          window.uyari.overlay.dragStart()
        }}
      >
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

      <div className={expanded ? 'nub-panel nub-panel-open' : 'nub-panel'}>
        {captions.length === 0 ? (
          <p className="nub-empty">
            {reconnecting ? 'Reconnecting to transcription…' : 'Listening… captions will appear here.'}
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
                <span className="nub-text">{g.texts.join(' ')}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}
