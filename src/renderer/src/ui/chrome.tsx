import { useState, type CSSProperties, type ReactNode } from 'react'

// Primitivas del kit desktop (Chrome.js.txt), portadas a TSX.
// MacWindow NO se porta: era el mockup del marco de ventana; la app real
// ya ES la ventana (hiddenInset + traffic lights nativos).

/** Card centrada del onboarding: eyebrow / title / sub / content / footer. */
export function OnboardCard({
  eyebrow,
  title,
  sub,
  step,
  total,
  onBack,
  footer,
  width = 620,
  children,
}: {
  eyebrow?: string
  title?: string
  sub?: string
  step?: number
  total?: number
  onBack?: () => void
  footer?: ReactNode
  width?: number
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width,
          maxWidth: '86%',
          background: 'var(--surface)',
          borderRadius: 20,
          border: '1px solid var(--border)',
          padding: '44px 48px 32px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          position: 'relative',
        }}
      >
        {step && (
          <span
            style={{
              position: 'absolute',
              top: 20,
              right: 24,
              font: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--ink-4)',
            }}
          >
            {step} of {total}
          </span>
        )}
        {onBack && (
          <button
            onClick={onBack}
            style={{
              position: 'absolute',
              top: 14,
              left: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              font: 'var(--text-xs)',
              fontWeight: 500,
              color: 'var(--ink-3)',
              padding: 6,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
        )}
        {eyebrow && (
          <span
            style={{
              font: 'var(--eyebrow)',
              letterSpacing: 'var(--eyebrow-tracking)',
              textTransform: 'uppercase',
              color: 'var(--accent-strong)',
              marginTop: onBack || step ? 10 : 0,
            }}
          >
            {eyebrow}
          </span>
        )}
        {title && (
          <h1
            style={{
              font: 'var(--display-md)',
              fontSize: 34,
              lineHeight: 1.18,
              color: 'var(--text-heading)',
              margin: 0,
              maxWidth: 480,
            }}
          >
            {title}
          </h1>
        )}
        {sub && (
          <p
            style={{
              font: 'var(--text-md)',
              color: 'var(--text-muted)',
              margin: '-6px 0 0',
              maxWidth: 440,
            }}
          >
            {sub}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        {footer && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 14,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Chip seleccionable (grid de opciones). */
export function PickChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        font: 'var(--text-sm)',
        fontWeight: 500,
        textAlign: 'center',
        cursor: 'pointer',
        color: selected ? 'var(--text-heading)' : 'var(--ink-2)',
        background: selected ? 'var(--violet-soft)' : 'var(--surface-sunken)',
        border: `1.5px solid ${selected ? 'var(--violet)' : 'transparent'}`,
        borderRadius: 'var(--radius-md)',
        padding: '13px 10px',
        transition:
          'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)',
      }}
    >
      {children}
    </button>
  )
}

/** Card seleccionable (tipo de equipo). */
export function PickCard({
  selected,
  onClick,
  icon,
  title,
  sub,
}: {
  selected: boolean
  onClick: () => void
  icon: ReactNode
  title: string
  sub: string
}): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: selected ? 'var(--violet-wash)' : 'var(--surface-sunken)',
        border: `1.5px solid ${selected ? 'var(--violet)' : 'transparent'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '20px 18px',
        transition:
          'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)',
      }}
    >
      <span
        style={{ color: selected ? 'var(--accent-strong)' : 'var(--ink-3)', display: 'inline-flex' }}
      >
        {icon}
      </span>
      <span style={{ font: 'var(--label-md)', color: 'var(--text-heading)' }}>{title}</span>
      <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--text-muted)' }}>
        {sub}
      </span>
    </div>
  )
}

/** Icono de trazo a partir de paths (formato compacto del kit). */
export function dIcon(d: string | string[], strokeWidth = 1.7, size = 20): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {([] as string[]).concat(d).map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  )
}

/** Hover genérico para filas/ítems que el kit resolvía con useState local. */
export function useHover(): [boolean, { onMouseEnter: () => void; onMouseLeave: () => void }] {
  const [hover, setHover] = useState(false)
  return [hover, { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }]
}

export type { CSSProperties }
