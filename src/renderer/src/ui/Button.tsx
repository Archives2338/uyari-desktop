import { useState, type ButtonHTMLAttributes, type CSSProperties } from 'react'

// Botón del design system (_ds_bundle.js → components/core/Button.jsx),
// portado 1:1 a TSX. Lee solo tokens → funciona en ambos temas.

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, { font: string; pad: string; h: number }> = {
  sm: { font: 'var(--label-sm)', pad: '8px 14px', h: 36 },
  md: { font: 'var(--label-md)', pad: '12px 20px', h: 44 },
  lg: { font: 'var(--label-md)', pad: '16px 28px', h: 52 },
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({
  variant = 'primary',
  size = 'md',
  disabled,
  children,
  style,
  ...rest
}: ButtonProps): React.JSX.Element {
  const [hover, setHover] = useState(false)
  const [press, setPress] = useState(false)
  const s = SIZES[size]
  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: hover ? 'var(--cta-bg-hover)' : 'var(--cta-bg)',
      color: 'var(--cta-fg)',
      border: '1px solid transparent',
    },
    secondary: {
      background: hover ? 'var(--surface-sunken)' : 'var(--surface)',
      color: 'var(--ink)',
      border: '1px solid var(--border-strong)',
    },
    ghost: {
      background: hover ? 'var(--violet-soft)' : 'transparent',
      color: 'var(--accent-strong)',
      border: '1px solid transparent',
    },
  }
  return (
    <button
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setPress(false)
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        font: s.font,
        padding: s.pad,
        minHeight: s.h,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition:
          'background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
        transform: press ? 'scale(0.98)' : 'none',
        opacity: disabled ? 0.45 : 1,
        ...variants[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
