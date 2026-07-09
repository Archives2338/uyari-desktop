import { useState, type CSSProperties, type InputHTMLAttributes } from 'react'

// Input del design system (_ds_bundle.js → components/core/Input.jsx),
// portado 1:1 a TSX.

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  containerStyle?: CSSProperties
  inputStyle?: CSSProperties
}

export function Input({
  label,
  hint,
  error,
  containerStyle,
  inputStyle,
  ...rest
}: InputProps): React.JSX.Element {
  const [focus, setFocus] = useState(false)
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        font: 'var(--text-sm)',
        color: 'var(--ink)',
        ...containerStyle,
      }}
    >
      {label && <span style={{ font: 'var(--label-sm)' }}>{label}</span>}
      <input
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          font: 'var(--text-md)',
          color: 'var(--ink)',
          background: 'var(--surface)',
          border: `1px solid ${error ? '#D0455C' : focus ? 'var(--violet)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '11px 14px',
          outline: 'none',
          boxShadow: focus ? '0 0 0 3px var(--focus-ring)' : 'none',
          transition:
            'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
          ...inputStyle,
        }}
        {...rest}
      />
      {(error || hint) && (
        <span
          style={{
            font: 'var(--text-xs)',
            fontWeight: 400,
            color: error ? '#D0455C' : 'var(--text-muted)',
          }}
        >
          {error || hint}
        </span>
      )}
    </label>
  )
}
