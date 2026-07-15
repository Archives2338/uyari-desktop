import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

// Sistema de temas del handoff v4 (design_handoff_uyari 4/ui_kits/desktop,
// IMPLEMENTACION-HOME-CHAT-TEMAS.md): dos temas por OVERRIDES de variables
// CSS sobre un wrapper — los componentes no saben de temas, solo leen
// tokens. Por ahora el tema SIGUE AL SISTEMA (prefers-color-scheme); el
// override manual con Settings queda pendiente (no hay pantalla Settings).
//
// Dark: carbón neutro cálido estilo Granola (jerarquía por luminosidad,
// NUNCA teñido de violeta en superficies — el violeta queda para detalles
// escasos: tile del workspace, botón enviar, links, dots de estado). El
// dark violeta-tintado anterior (#17151F/#232030) queda reservado al
// widget de Meet (ver ui_kits/meet) — ahí sí conviene que la marca se
// sienta porque vive sobre la UI de Google.

export const PAPER_DEFAULT = '#FDFDFB'

export const DESK_DARK: Record<string, string> = {
  '--sidebar': '#191917',
  '--paper': '#222220',
  '--surface': '#2A2A27',
  '--surface-card': '#2A2A27',
  '--surface-sunken': '#262624',
  '--surface-page': '#222220',
  '--ink': '#F0EFEA',
  '--ink-2': '#C7C6BE',
  '--ink-3': '#A3A29A',
  '--ink-4': '#6E6D66',
  '--border': '#343430',
  '--border-strong': '#454540',
  // Scrollbar: blanco traslúcido en dark (Granola #ffffff33), ver app.css.
  '--scrollbar-thumb': 'rgba(255, 255, 255, 0.20)',
  '--scrollbar-thumb-strong': 'rgba(255, 255, 255, 0.32)',
  '--text-heading': '#F0EFEA',
  '--text-body': '#C7C6BE',
  '--text-muted': '#A3A29A',
  '--text-link': '#A99BD9',
  '--accent-strong': '#A99BD9',
  '--violet-soft': 'rgba(132, 116, 196, 0.16)',
  '--violet-wash': 'rgba(132, 116, 196, 0.10)',
  '--mint-soft': 'rgba(16, 185, 129, 0.12)',
  '--cta-bg': '#F0EFEA',
  '--cta-bg-hover': '#FFFFFF',
  '--cta-fg': '#191917',
  '--shadow-card': '0 1px 2px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35)',
  '--shadow-float': '0 2px 6px rgba(0,0,0,0.35), 0 24px 64px rgba(0,0,0,0.5)',
  '--shadow-pop': '0 4px 12px rgba(0,0,0,0.35), 0 32px 80px rgba(0,0,0,0.5)',
}

/** Derivación light a partir de un tono de papel (hoy fijo en PAPER_DEFAULT;
 *  el knob queda listo para cuando el override manual permita elegirlo). */
export function lightVars(paper: string): Record<string, string> {
  return {
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

// --- Override manual del tema (Settings → Apariencia) ---
// 'system' (default) sigue a prefers-color-scheme; 'light'/'dark' lo fijan.
// Persistido en localStorage; el cambio se propaga en vivo con un evento
// propio (localStorage no dispara 'storage' en la misma ventana).

export type ThemePref = 'system' | 'light' | 'dark'
const THEME_PREF_KEY = 'uyari-theme-pref'
const THEME_PREF_EVENT = 'uyari-theme-pref-changed'

export function getThemePref(): ThemePref {
  const raw = localStorage.getItem(THEME_PREF_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function setThemePref(pref: ThemePref): void {
  if (pref === 'system') localStorage.removeItem(THEME_PREF_KEY)
  else localStorage.setItem(THEME_PREF_KEY, pref)
  window.dispatchEvent(new Event(THEME_PREF_EVENT))
}

export function useThemePref(): ThemePref {
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  useEffect(() => {
    const onChange = (): void => setPref(getThemePref())
    window.addEventListener(THEME_PREF_EVENT, onChange)
    return () => window.removeEventListener(THEME_PREF_EVENT, onChange)
  }, [])
  return pref
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
  const systemDark = useSystemDark()
  const pref = useThemePref()
  const dark = pref === 'system' ? systemDark : pref === 'dark'
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
