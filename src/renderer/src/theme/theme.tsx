import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

// Sistema de temas del handoff (design_handoff_uyari 3/ui_kits/desktop):
// dos temas por OVERRIDES de variables CSS sobre un wrapper — los
// componentes no saben de temas, solo leen tokens. Light usa un tono de
// papel cálido (#FAF9F5, crema suave — más descansado y "editorial" que
// el blanco puro); Dark es la paleta DESK_DARK del widget. Por ahora el
// tema SIGUE AL SISTEMA (prefers-color-scheme); el override manual con Settings.

export const PAPER_DEFAULT = '#FAF9F5'

// Paleta dark — copiada 1:1 de Flow.js.txt (DESK_DARK).
export const DESK_DARK: Record<string, string> = {
  '--desk': '#0D0C12',
  '--paper': '#17151F',
  '--surface': '#232030',
  '--surface-card': '#232030',
  '--surface-sunken': '#2C2939',
  '--surface-page': '#17151F',
  '--ink': '#F2F0FA',
  '--ink-2': '#C9C6D8',
  '--ink-3': '#918DA6',
  '--ink-4': '#5F5B73',
  '--border': '#332F42',
  '--border-strong': '#443F56',
  '--text-heading': '#F2F0FA',
  '--text-body': '#C9C6D8',
  '--text-muted': '#918DA6',
  '--text-link': '#A99BD9',
  '--accent-strong': '#A99BD9',
  '--violet-soft': '#3A3352',
  '--violet-wash': '#2A2640',
  '--mint-soft': '#1E3A31',
  '--cta-bg': '#F2F0FA',
  '--cta-bg-hover': '#FFFFFF',
  '--cta-fg': '#1E1B2E',
  '--shadow-card': '0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35)',
  '--shadow-float': '0 2px 6px rgba(0,0,0,0.35), 0 24px 64px rgba(0,0,0,0.5)',
  '--shadow-pop': '0 4px 12px rgba(0,0,0,0.35), 0 32px 80px rgba(0,0,0,0.5)',
}

// Derivación light — copiada 1:1 de Flow.js.txt (lightVars).
export function lightVars(paper: string): Record<string, string> {
  return {
    '--desk': `color-mix(in oklab, ${paper} 91%, #1E1B2E)`,
    '--paper': paper,
    '--surface': `color-mix(in oklab, #FFFFFF 70%, ${paper})`,
    '--surface-card': `color-mix(in oklab, #FFFFFF 70%, ${paper})`,
  }
}

export function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

/** Wrapper raíz: aplica las variables del tema activo y pinta el papel.
 *  `transparent` = para la ventana overlay (pill flotante sin fondo). */
export function ThemeRoot({
  children,
  transparent = false,
}: {
  children: ReactNode
  transparent?: boolean
}): React.JSX.Element {
  const dark = useSystemDark()
  const vars = dark ? DESK_DARK : lightVars(PAPER_DEFAULT)
  return (
    <div
      data-theme={dark ? 'dark' : 'light'}
      style={{
        ...(vars as CSSProperties),
        height: '100%',
        background: transparent ? 'transparent' : 'var(--paper)',
        color: 'var(--text-body)',
        font: 'var(--text-md)',
        transition: 'background 240ms ease',
      }}
    >
      {children}
    </div>
  )
}
