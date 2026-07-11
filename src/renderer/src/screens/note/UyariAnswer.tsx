import { useState } from 'react'

// Respuesta de Uyari — compartida por el popover (compact) y el sheet. Muestra
// el texto, una cita trazable ("Esta nota · Abrir transcript →") y las acciones
// Copiar / Enviar a la nota / Regenerar. Token-driven.

export function UyariAnswer({
  answer,
  cite,
  compact,
  onCopy,
  onSendToNote,
  onRegenerate,
  onOpenTranscript,
}: {
  answer: string
  cite: string
  compact?: boolean
  onCopy: () => void
  onSendToNote: () => void
  onRegenerate: () => void
  onOpenTranscript: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)

  const copy = (): void => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  const send = (): void => {
    onSendToNote()
    setSent(true)
    setTimeout(() => setSent(false), 1400)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10, maxWidth: 640 }}>
      <span
        style={{
          font: 'var(--text-sm)',
          fontSize: compact ? 13.5 : 14,
          lineHeight: 1.65,
          color: 'var(--text-heading)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {answer}
      </span>
      {cite && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            alignSelf: 'flex-start',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: '7px 11px',
            font: 'var(--label-sm)',
            fontSize: 11.5,
            color: 'var(--text-heading)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--violet)' }} />
          {cite}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              onOpenTranscript()
            }}
            style={{ fontSize: 11, color: 'var(--accent-strong)' }}
          >
            Abrir transcript →
          </a>
        </span>
      )}
      <span style={{ display: 'flex', gap: 14, font: 'var(--text-xs)', fontWeight: 500, color: 'var(--ink-4)' }}>
        <span style={{ cursor: 'pointer' }} onClick={copy}>
          ⧉ {copied ? 'Copiado' : 'Copiar'}
        </span>
        <span style={{ cursor: 'pointer' }} onClick={send}>
          ↩ {sent ? 'Enviado' : 'Enviar a la nota'}
        </span>
        <span style={{ cursor: 'pointer' }} onClick={onRegenerate}>
          ↻ Regenerar
        </span>
      </span>
    </div>
  )
}
