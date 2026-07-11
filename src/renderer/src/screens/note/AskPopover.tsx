import { useState } from 'react'
import { dIcon } from '@renderer/ui/chrome'
import { NOTE_RECIPES, slashIcon, type AskMsg } from './ask-common'
import { UyariAnswer } from './UyariAnswer'

// QA3 — popover anclado a la píldora "Pregunta lo que sea…" (primer nivel).
// Vacío: 3 recetas. Con pregunta: chip de la última pregunta + respuesta
// compacta con cita. "Expandir ⤢" pasa al sheet conservando la conversación.

export function AskPopover({
  msgs,
  busy,
  ask,
  onExpand,
  onClose,
  onCopy,
  onSendToNote,
  onRegenerate,
  onOpenTranscript,
}: {
  msgs: AskMsg[]
  busy: boolean
  ask: (t: string) => void
  onExpand: () => void
  onClose: () => void
  onCopy: (answer: string) => void
  onSendToNote: (answer: string) => void
  onRegenerate: () => void
  onOpenTranscript: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const last = msgs.length ? msgs[msgs.length - 1] : null
  const lastQ = [...msgs].reverse().find((m) => m.from === 'user')

  const submit = (): void => {
    ask(q)
    setQ('')
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 560,
        maxWidth: '80%',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-pop)',
        padding: '16px 20px 14px',
        boxSizing: 'border-box',
        zIndex: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        {lastQ && lastQ.from === 'user' ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              font: 'var(--label-sm)',
              fontSize: 12,
              color: 'var(--ink-2)',
              background: 'var(--sidebar, var(--surface-sunken))',
              borderRadius: 'var(--radius-pill)',
              padding: '6px 11px',
            }}
          >
            {slashIcon}
            {lastQ.text}
          </span>
        ) : (
          <span style={{ font: 'var(--text-xs)', fontWeight: 500, color: 'var(--ink-4)' }}>
            Pregunta rápida — la nota queda intacta
          </span>
        )}
        <span
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            color: 'var(--ink-4)',
            font: 'var(--text-xs)',
            fontWeight: 500,
          }}
        >
          <span onClick={onExpand} style={{ cursor: 'pointer' }}>
            Expandir ⤢
          </span>
          <span onClick={onClose} style={{ cursor: 'pointer', display: 'inline-flex' }}>
            {dIcon('M18 6 6 18M6 6l12 12', 1.8, 18)}
          </span>
        </span>
      </div>

      {busy && (
        <span style={{ font: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--text-muted)' }}>
          Repasando la reunión…
        </span>
      )}
      {!busy && last && last.from === 'uyari' && (
        <UyariAnswer
          compact
          answer={last.answer}
          cite={last.cite}
          onCopy={() => onCopy(last.answer)}
          onSendToNote={() => onSendToNote(last.answer)}
          onRegenerate={onRegenerate}
          onOpenTranscript={onOpenTranscript}
        />
      )}
      {!busy && !last && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {NOTE_RECIPES.slice(0, 3).map((r) => (
            <span
              key={r}
              onClick={() => ask(r)}
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                cursor: 'pointer',
                font: 'var(--text-xs)',
                fontWeight: 500,
                color: 'var(--ink-2)',
                background: 'var(--sidebar, var(--surface-sunken))',
                borderRadius: 'var(--radius-pill)',
                padding: '7px 12px',
              }}
            >
              {slashIcon}
              {r}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface)',
          border: '1.5px solid var(--violet)',
          borderRadius: 'var(--radius-pill)',
          padding: '8px 9px 8px 16px',
          marginTop: 12,
          boxShadow: '0 0 0 3px var(--focus-ring)',
        }}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Pregunta lo que sea…"
          style={{
            flex: 1,
            font: 'var(--text-sm)',
            fontSize: 13.5,
            color: 'var(--ink)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            minWidth: 0,
          }}
        />
        <span
          onClick={submit}
          style={{
            width: 26,
            height: 26,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--violet)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {dIcon(['M12 19V5', 'm5 12 7-7 7 7'], 2, 18)}
        </span>
      </div>

      {/* flecha hacia la píldora */}
      <span
        style={{
          position: 'absolute',
          bottom: -7,
          left: '50%',
          transform: 'translateX(-50%) rotate(45deg)',
          width: 12,
          height: 12,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
        }}
      />
    </div>
  )
}
