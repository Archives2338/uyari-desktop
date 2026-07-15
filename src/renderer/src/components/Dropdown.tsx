import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { dIcon } from '@renderer/ui/chrome'

// Dropdown — pill trigger + popover flotante de opciones (design_handoff_uyari
// 6/dropdown/). Token-driven (mismos --surface/--surface-sunken/--border/
// --ink*/--accent-strong/--radius-pill/--shadow-pop que ya usa el resto de la
// app), funciona en light y dark sin props extra. Reemplaza TODOS los
// selects custom que había sueltos (el "Sel" que ciclaba valores al click en
// Settings, el menú de plantillas hecho a mano en EnhancedPanel) por un único
// componente reutilizable.

export type DropdownOption = string | { value: string; label: string }

export interface DropdownProps {
  options?: DropdownOption[]
  value?: string
  /** Texto sin selección. */
  placeholder?: string
  onChange?: (value: string) => void
  /** Alineación del popover relativa al trigger. */
  align?: 'left' | 'right'
  /** Alto máx. del menú (scroll). */
  menuMaxHeight?: number
  style?: CSSProperties
  /** No es parte del handoff original: pill visualmente inerte para las filas
   *  "Próximamente" de Settings (mic device, idioma, atajo global) — mismo
   *  trigger, sin abrir menú. */
  disabled?: boolean
}

function normalize(options: DropdownOption[]): Array<{ value: string; label: string }> {
  return options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
}

export function Dropdown({
  options = [],
  value,
  placeholder = 'Seleccionar',
  onChange,
  align = 'right',
  menuMaxHeight = 240,
  style,
  disabled,
}: DropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const norm = normalize(options)
  const current = norm.find((o) => o.value === value)

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        title={disabled ? 'Próximamente' : undefined}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          font: '500 12.5px/1 var(--font-sans)',
          color: current ? 'var(--ink-2)' : 'var(--ink-3)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-pill)',
          padding: '7px 12px',
          whiteSpace: 'nowrap',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.75 : 1,
          fontFamily: 'inherit',
        }}
      >
        {current ? current.label : placeholder}
        {!disabled && (
          <span
            style={{
              display: 'inline-flex',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
            }}
          >
            {dIcon('m6 9 6 6 6-6', 2, 11)}
          </span>
        )}
      </button>
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            zIndex: 60,
            [align === 'right' ? 'right' : 'left']: 0,
            minWidth: 190,
            maxHeight: menuMaxHeight,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-pop)',
            padding: 5,
            boxSizing: 'border-box',
          }}
        >
          {norm.map((o) => {
            const sel = o.value === value
            return (
              <div
                key={o.value}
                onClick={() => {
                  setOpen(false)
                  onChange?.(o.value)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  font: `${sel ? 600 : 400} 13px/1.4 var(--font-sans)`,
                  color: 'var(--ink)',
                  background: sel ? 'var(--surface-sunken)' : 'transparent',
                  borderRadius: 8,
                  padding: '8px 11px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--surface-sunken)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = sel ? 'var(--surface-sunken)' : 'transparent'
                }}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {sel && (
                  <span style={{ display: 'inline-flex', color: 'var(--accent-strong)' }}>
                    {dIcon('M20 6 9 17l-5-5', 2.5, 12)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
