import { useState } from 'react'
import { NOTE_RECIPES, slashIcon } from './ask-common'

// QA4 — paleta ⌘J (patrón Spotlight): input arriba, RECETAS filtrable, ↑↓
// navega / ↵ ejecuta; texto libre sin match ofrece "Preguntar «…»". Al
// ejecutar, la respuesta aterriza en el popover QA3 (no duplica UI).

export function CmdPalette({
  onRun,
  onClose,
}: {
  onRun: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const items = NOTE_RECIPES.filter((r) => r.toLowerCase().includes(q.toLowerCase()))

  const run = (text: string): void => {
    if (text && text.trim()) onRun(text.trim())
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(30,27,46,0.18)',
        zIndex: 8,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: 110,
          width: 600,
          maxWidth: '84%',
          alignSelf: 'flex-start',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '15px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--violet)"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="m14 5-4 14" />
          </svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((s) => Math.min(s + 1, items.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((s) => Math.max(s - 1, 0))
              }
              if (e.key === 'Enter') run(items[sel] || q)
            }}
            placeholder="Pregunta sobre esta reunión…"
            style={{
              flex: 1,
              font: 'var(--text-md)',
              fontSize: 15,
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <span
            onClick={onClose}
            style={{
              font: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--ink-4)',
              border: '1px solid var(--border)',
              borderRadius: 5,
              padding: '4px 6px',
              cursor: 'pointer',
            }}
          >
            esc
          </span>
        </div>
        <div style={{ padding: 8 }}>
          <div
            style={{
              font: 'var(--eyebrow)',
              fontSize: 10.5,
              letterSpacing: 'var(--eyebrow-tracking)',
              color: 'var(--ink-4)',
              padding: '8px 14px 6px',
            }}
          >
            RECETAS
          </div>
          {items.map((r, i) => (
            <div
              key={r}
              onClick={() => run(r)}
              onMouseEnter={() => setSel(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: i === sel ? 'var(--sidebar, var(--surface-sunken))' : 'transparent',
                borderRadius: 10,
                padding: '10px 14px',
                font: 'var(--label-sm)',
                fontSize: 13,
                color: i === sel ? 'var(--text-heading)' : 'var(--ink-2)',
                cursor: 'pointer',
              }}
            >
              {slashIcon}
              {r}
              {i === sel && (
                <span
                  style={{ marginLeft: 'auto', font: 'var(--text-xs)', fontSize: 10.5, color: 'var(--ink-4)' }}
                >
                  ↵
                </span>
              )}
            </div>
          ))}
          {items.length === 0 && q.trim() && (
            <div
              onClick={() => run(q)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--sidebar, var(--surface-sunken))',
                borderRadius: 10,
                padding: '10px 14px',
                font: 'var(--label-sm)',
                fontSize: 13,
                color: 'var(--text-heading)',
                cursor: 'pointer',
              }}
            >
              {slashIcon}
              Preguntar «{q}»
              <span
                style={{ marginLeft: 'auto', font: 'var(--text-xs)', fontSize: 10.5, color: 'var(--ink-4)' }}
              >
                ↵
              </span>
            </div>
          )}
        </div>
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '10px 20px',
            display: 'flex',
            gap: 14,
            font: 'var(--text-xs)',
            fontSize: 10.5,
            fontWeight: 500,
            color: 'var(--ink-4)',
          }}
        >
          <span>↑↓ navegar</span>
          <span>↵ ejecutar</span>
          <span>⌘J desde cualquier vista</span>
        </div>
      </div>
    </div>
  )
}
