import { useEffect, useRef, useState } from 'react'
import { dIcon } from '@renderer/ui/chrome'

// Dock de transcript de la nota (NT1-B): colapsado como pestaña vertical
// "TRANSCRIPT" al borde derecho; se expande al pasar el mouse (anim. de width),
// se oculta al salir, y el PIN lo fija (rota 45° fijado; atajo ⌥T). Burbujas:
// Tú = violet-soft alineado derecha · Ellos = blanco con borde alineado
// izquierda, con la etiqueta hablante · hora. Token-driven (light/dark).

export interface DockLine {
  key: string
  who: 'you' | 'them'
  t: string
  text: string
}

const pinPaths = [
  'M12 17v5',
  'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z',
]
const docPaths = ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6M8 13h8M8 17h5']

export function LiveDock({
  lines,
  pinned,
  onTogglePin,
}: {
  lines: DockLine[]
  pinned: boolean
  onTogglePin: () => void
}): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const open = pinned || hover
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll al fondo al llegar líneas nuevas o al abrirse.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines.length, open])

  // ⌥T fija/suelta el dock (hint en el título del pin).
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.altKey && e.code === 'KeyT') {
        e.preventDefault()
        onTogglePin()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onTogglePin])

  return (
    <>
      {!open && (
        <div
          onMouseEnter={() => setHover(true)}
          style={{
            position: 'absolute',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--sidebar, var(--surface-sunken))',
            border: '1px solid var(--border)',
            borderRight: 'none',
            borderRadius: '10px 0 0 10px',
            padding: '14px 7px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            color: 'var(--ink-3)',
            zIndex: 3,
          }}
        >
          {dIcon(docPaths, 1.7, 18)}
          <span
            style={{
              font: 'var(--eyebrow)',
              fontSize: 10,
              letterSpacing: 'var(--eyebrow-tracking)',
              color: 'var(--ink-3)',
              writingMode: 'vertical-rl',
            }}
          >
            TRANSCRIPT
          </span>
        </div>
      )}
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: open ? 300 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width var(--dur-med) var(--ease-out)',
        }}
      >
        <div
          style={{
            width: 300,
            height: '100%',
            background: 'var(--sidebar, var(--surface-sunken))',
            borderLeft: '1px solid var(--border)',
            padding: '52px 16px 14px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                font: 'var(--eyebrow)',
                fontSize: 11,
                letterSpacing: 'var(--eyebrow-tracking)',
                color: 'var(--ink-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mint)' }}
              />
              EN VIVO
            </span>
            <span
              onClick={onTogglePin}
              title={pinned ? 'Soltar (⌥T)' : 'Fijar (⌥T)'}
              style={{
                cursor: 'pointer',
                color: pinned ? 'var(--accent-strong)' : 'var(--ink-4)',
                display: 'inline-flex',
                transform: pinned ? 'rotate(45deg)' : 'none',
                transition: 'transform var(--dur-fast) var(--ease-out)',
              }}
            >
              {dIcon(pinPaths, 1.6, 18)}
            </span>
          </div>
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            {lines.map((l) =>
              l.who === 'them' ? (
                <span
                  key={l.key}
                  style={{
                    alignSelf: 'flex-start',
                    maxWidth: '85%',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px 12px 12px 4px',
                    padding: '8px 11px',
                    color: 'var(--text-body)',
                  }}
                >
                  <i style={{ fontStyle: 'normal', fontSize: 10.5, color: 'var(--ink-4)' }}>
                    Ellos · {l.t}
                  </i>
                  <br />
                  {l.text}
                </span>
              ) : (
                <span
                  key={l.key}
                  style={{
                    alignSelf: 'flex-end',
                    maxWidth: '85%',
                    background: 'var(--violet-soft)',
                    borderRadius: '12px 12px 4px 12px',
                    padding: '8px 11px',
                    color: 'var(--text-heading)',
                  }}
                >
                  <i style={{ fontStyle: 'normal', fontSize: 10.5, color: 'var(--accent-strong)' }}>
                    Tú · {l.t}
                  </i>
                  <br />
                  {l.text}
                </span>
              ),
            )}
            {lines.length === 0 && (
              <span style={{ color: 'var(--ink-4)', textAlign: 'center', marginTop: 30 }}>
                Escuchando… las líneas aparecerán aquí.
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 400,
              color: 'var(--ink-4)',
              textAlign: 'center',
            }}
          >
            {pinned ? 'fijado · clic en el pin para soltar' : 'se oculta al salir · pin para fijar'}
          </div>
        </div>
      </div>
    </>
  )
}
