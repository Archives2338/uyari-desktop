import { useEffect, useRef, useState } from 'react'
import { dIcon } from '@renderer/ui/chrome'
import { NOTE_RECIPES, slashIcon, type AskMsg } from './ask-common'
import { UyariAnswer } from './UyariAnswer'

// QA1 — sheet (nivel expandido): overlay desde abajo con el historial completo
// scrolleable, recetas + composer con alcance "Esta reunión ▾". Cierra con Esc
// o ✕. Comparte el mismo motor (msgs/busy/ask) que el popover.

export function AskSheet({
  msgs,
  busy,
  ask,
  onClose,
  onCopy,
  onSendToNote,
  onRegenerate,
  onOpenTranscript,
}: {
  msgs: AskMsg[]
  busy: boolean
  ask: (t: string) => void
  onClose: () => void
  onCopy: (answer: string) => void
  onSendToNote: (answer: string) => void
  onRegenerate: () => void
  onOpenTranscript: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [msgs.length, busy])

  const submit = (): void => {
    ask(q)
    setQ('')
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 0,
        top: '26%',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderBottom: 'none',
        borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-pop)',
        padding: '18px 30px 16px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-4)' }}>
          {dIcon(['M3 12a9 9 0 1 0 9-9', 'M3 3v5h5', 'M12 7v5l3 3'], 1.7, 18)}
          <span style={{ font: 'var(--text-xs)', fontWeight: 500 }}>Historial</span>
        </span>
        <span onClick={onClose} style={{ cursor: 'pointer', color: 'var(--ink-4)', display: 'inline-flex' }}>
          {dIcon('M18 6 6 18M6 6l12 12', 1.8, 18)}
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
          gap: 12,
          paddingBottom: 8,
        }}
      >
        {msgs.length === 0 && !busy && (
          <span
            style={{
              font: 'var(--text-sm)',
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginTop: 26,
            }}
          >
            Pregunta sobre esta reunión — la nota queda intacta detrás.
          </span>
        )}
        {msgs.map((m, i) =>
          m.from === 'user' ? (
            <span
              key={i}
              style={{
                alignSelf: 'flex-end',
                background: 'var(--surface-sunken)',
                borderRadius: '14px 14px 4px 14px',
                padding: '10px 14px',
                font: 'var(--text-sm)',
                color: 'var(--text-heading)',
                maxWidth: '70%',
              }}
            >
              {m.text}
            </span>
          ) : (
            <UyariAnswer
              key={i}
              answer={m.answer}
              cite={m.cite}
              onCopy={() => onCopy(m.answer)}
              onSendToNote={() => onSendToNote(m.answer)}
              onRegenerate={onRegenerate}
              onOpenTranscript={onOpenTranscript}
            />
          ),
        )}
        {busy && (
          <span style={{ font: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--text-muted)' }}>
            Repasando la reunión…
          </span>
        )}
      </div>

      <div style={{ flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            font: 'var(--text-xs)',
            fontWeight: 500,
            color: 'var(--ink-2)',
            marginBottom: 10,
            alignItems: 'center',
          }}
        >
          {NOTE_RECIPES.map((r) => (
            <span
              key={r}
              onClick={() => ask(r)}
              style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
            >
              {slashIcon}
              {r}
            </span>
          ))}
          <span style={{ color: 'var(--ink-4)' }}>⠿ Todas las recetas</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--surface)',
            border: '1.5px solid var(--violet)',
            borderRadius: 'var(--radius-pill)',
            padding: '9px 10px 9px 18px',
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
              fontSize: 14,
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              minWidth: 0,
            }}
          />
          <span
            style={{
              font: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--ink-3)',
              whiteSpace: 'nowrap',
            }}
          >
            Esta reunión ▾
          </span>
          <span
            onClick={submit}
            style={{
              width: 28,
              height: 28,
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
      </div>
    </div>
  )
}
