import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useApp } from '@renderer/store'
import { dIcon, useHover } from '@renderer/ui/chrome'
import { Dropdown } from '@renderer/components/Dropdown'
import { setThemePref, useThemePref, type ThemePref } from '@renderer/theme/theme'

// Modal de Ajustes — implementa el mock del handoff
// (design_handoff_uyari 4/settings/settings-modal.html) con UNA corrección
// deliberada: el ítem activo del rail es NEUTRO (solo cambia el fondo; el
// ícono NO se pinta de morado ni la letra pasa a negrita) — la misma regla
// que se aplicó al sidebar principal (patrón Granola).
//
// Funcional hoy: Tema (override system/light/dark), Cerrar sesión, y los
// toggles/selects persisten en localStorage (el cableado real de cada uno
// —launch at login, mute-sync, plantilla— se conecta por partes; la UI ya
// queda lista y recuerda la elección).

type Tab = 'cuenta' | 'general' | 'grabacion' | 'calendario' | 'privacidad'

// --- Persistencia local de las preferencias de UI ---

interface UiSettings {
  launchAtLogin: boolean
  pauseOnMute: boolean
  autoGenerate: boolean
  consentNotice: boolean
  defaultTemplate: string
  retention: string
}

const UI_SETTINGS_KEY = 'uyari-ui-settings'
const UI_DEFAULTS: UiSettings = {
  launchAtLogin: false,
  pauseOnMute: true,
  autoGenerate: true,
  consentNotice: true,
  defaultTemplate: 'General',
  retention: '90 días',
}

function loadUiSettings(): UiSettings {
  try {
    return { ...UI_DEFAULTS, ...JSON.parse(localStorage.getItem(UI_SETTINGS_KEY) ?? '{}') }
  } catch {
    return UI_DEFAULTS
  }
}

// --- Piezas visuales del mock ---

function Row({ title, desc, control }: { title: string; desc?: string; control: ReactNode }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13.5, color: 'var(--text-heading)' }}>{title}</span>
        {desc && <span style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>{desc}</span>}
      </span>
      {control}
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 34,
        height: 20,
        borderRadius: 999,
        background: on ? 'var(--violet)' : 'var(--border-strong)',
        position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
        border: 'none',
        padding: 0,
        transition: 'background 150ms ease',
      }}
    >
      <i
        style={{
          position: 'absolute',
          left: on ? 16 : 2,
          top: 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(30,27,46,0.2)',
          transition: 'left 150ms ease',
        }}
      />
    </button>
  )
}

function Ghost({ label, onClick, disabled }: { label: string; onClick?: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={disabled ? 'Próximamente' : undefined}
      style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--ink-2)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        borderRadius: 999,
        padding: '8px 14px',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        opacity: disabled ? 0.75 : 1,
      }}
    >
      {label}
    </button>
  )
}

const sect: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--text-heading)', margin: '20px 0 4px' }
const sectFirst: CSSProperties = { ...sect, marginTop: 0 }

// Rail: ítem NEUTRO al estar activo (solo fondo) — regla del sidebar principal.
function RailItem({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <button
      {...hoverProps}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 10px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--ink-2)',
        cursor: 'pointer',
        background: active || hover ? 'var(--surface-sunken)' : 'none',
        border: 'none',
        width: '100%',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--ink-3)', flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  )
}

const THEME_OPTIONS: Array<{ value: ThemePref; title: string; icon: string | string[] }> = [
  { value: 'system', title: 'Sistema', icon: ['M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 21h8M12 17v4'] },
  { value: 'light', title: 'Claro', icon: ['M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M12 2.5v2M12 19.5v2M4.3 4.3l1.4 1.4M18.3 18.3l1.4 1.4M2.5 12h2M19.5 12h2M4.3 19.7l1.4-1.4M18.3 5.7l1.4-1.4'] },
  { value: 'dark', title: 'Oscuro', icon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' },
]

const TEMPLATE_OPTIONS = ['General', 'Reunión de equipo', '1:1', 'Llamada de ventas', 'Entrevista']
const RETENTION_OPTIONS = ['30 días', '90 días', '1 año', 'Siempre']

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const auth = useApp((s) => s.auth)
  const refreshAuth = useApp((s) => s.refreshAuth)
  const themePref = useThemePref()
  const [tab, setTab] = useState<Tab>('general')
  const [ui, setUi] = useState<UiSettings>(loadUiSettings)

  const patch = (p: Partial<UiSettings>): void => {
    setUi((prev) => {
      const next = { ...prev, ...p }
      localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(next))
      return next
    })
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const logout = async (): Promise<void> => {
    await window.uyari.auth.logout()
    await refreshAuth()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(30,27,46,0.35)' }} />
      <div
        style={{
          position: 'relative',
          width: 760,
          height: 520,
          maxWidth: '94vw',
          maxHeight: '92vh',
          background: 'var(--surface)',
          borderRadius: 20,
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* cerrar */}
        <button
          onClick={onClose}
          title="Cerrar (Esc)"
          style={{ position: 'absolute', right: 14, top: 14, width: 28, height: 28, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', cursor: 'pointer', background: 'none', border: 'none', zIndex: 1 }}
        >
          {dIcon('M18 6 6 18M6 6l12 12', 2, 14)}
        </button>

        {/* rail de categorías */}
        <nav style={{ width: 208, flexShrink: 0, background: 'var(--sidebar)', borderRight: '1px solid var(--border)', padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface-sunken)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, color: 'var(--ink-4)', marginBottom: 10 }}>
            {dIcon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm21 21-4.35-4.35'], 1.8, 12)}
            Buscar
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--ink-4)', padding: '8px 10px 4px', textTransform: 'uppercase' }}>
            Ajustes
          </span>
          <RailItem
            icon={dIcon(['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M6.5 19a6.5 6.5 0 0 1 11 0'], 1.6, 15)}
            label="Cuenta"
            active={tab === 'cuenta'}
            onClick={() => setTab('cuenta')}
          />
          <RailItem
            icon={dIcon(['M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M12 2.5v3M12 18.5v3M4.2 6.8l2.1 2.1M17.7 15.1l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.2l2.1-2.1M17.7 8.9l2.1-2.1'], 1.6, 15)}
            label="General"
            active={tab === 'general'}
            onClick={() => setTab('general')}
          />
          <RailItem
            icon={dIcon(['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5 11a7 7 0 0 0 14 0M12 18v3'], 1.6, 15)}
            label="Grabación"
            active={tab === 'grabacion'}
            onClick={() => setTab('grabacion')}
          />
          <RailItem
            icon={dIcon(['M8 2v4M16 2v4M3 9h18', 'M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'], 1.6, 15)}
            label="Calendario"
            active={tab === 'calendario'}
            onClick={() => setTab('calendario')}
          />
          <RailItem
            icon={dIcon(['M12 2.5 4.5 5v6c0 4.8 3.2 8.7 7.5 10 4.3-1.3 7.5-5.2 7.5-10V5z', 'm9 11.5 2 2 4-4'], 1.6, 15)}
            label="Privacidad"
            active={tab === 'privacidad'}
            onClick={() => setTab('privacidad')}
          />
        </nav>

        {/* cuerpo */}
        <div style={{ flex: 1, minWidth: 0, padding: '22px 26px', overflowY: 'auto' }}>
          {tab === 'cuenta' && (
            <div>
              <p style={sectFirst}>Cuenta</p>
              <Row title="Email" control={<span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{auth.email ?? '—'}</span>} />
              <Row title="Plan" desc="Free plan · 30 días de historial" control={<Ghost label="Upgrade" disabled />} />
              <Row title="Cerrar sesión" desc="Tu sesión en este equipo." control={<Ghost label="Cerrar sesión" onClick={() => void logout()} />} />
              <p style={sect}>Zona de riesgo</p>
              <Row
                title="Borrar cuenta"
                desc="Elimina tu cuenta, notas y transcripts. No se puede deshacer."
                control={
                  <button title="Próximamente" style={{ fontSize: 12.5, fontWeight: 500, color: '#E5484D', cursor: 'default', whiteSpace: 'nowrap', background: 'none', border: 'none', fontFamily: 'inherit', opacity: 0.8 }}>
                    Borrar cuenta…
                  </button>
                }
              />
            </div>
          )}

          {tab === 'general' && (
            <div>
              <p style={sectFirst}>Apariencia</p>
              <Row
                title="Tema"
                desc="Sigue al sistema, o fíjalo en claro u oscuro."
                control={
                  <span style={{ display: 'inline-flex', background: 'var(--surface-sunken)', border: '1px solid var(--border)', borderRadius: 999, padding: 2, flexShrink: 0 }}>
                    {THEME_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        title={o.title}
                        onClick={() => setThemePref(o.value)}
                        style={{
                          width: 30,
                          height: 24,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 999,
                          color: themePref === o.value ? 'var(--text-heading)' : 'var(--ink-3)',
                          cursor: 'pointer',
                          background: themePref === o.value ? 'var(--surface)' : 'none',
                          boxShadow: themePref === o.value ? '0 1px 3px rgba(30,27,46,0.1)' : 'none',
                          border: 'none',
                        }}
                      >
                        {dIcon(o.icon, 1.8, 13)}
                      </button>
                    ))}
                  </span>
                }
              />
              <Row title="Idioma de la app" control={<Dropdown value="es" options={[{ value: 'es', label: 'Español' }]} disabled />} />
              <p style={sect}>Sistema</p>
              <Row
                title="Iniciar con el sistema"
                desc="Uyari se abre al iniciar sesión en tu Mac."
                control={<Toggle on={ui.launchAtLogin} onChange={(v) => patch({ launchAtLogin: v })} />}
              />
              <Row title="Atajo global" desc="Abrir Uyari o empezar a grabar desde cualquier app." control={<Dropdown value="opt-space" options={[{ value: 'opt-space', label: '⌥ Space' }]} disabled />} />
            </div>
          )}

          {tab === 'grabacion' && (
            <div>
              <p style={sectFirst}>Captura</p>
              <Row title="Micrófono" desc="Dispositivo de entrada para tu voz." control={<Dropdown value="default" options={[{ value: 'default', label: 'Default del sistema' }]} disabled />} />
              <Row
                title="Pausar al mutear en Meet / Zoom"
                desc="Si te muteás en la app de reunión, la transcripción se pausa."
                control={<Toggle on={ui.pauseOnMute} onChange={(v) => patch({ pauseOnMute: v })} />}
              />
              <p style={sect}>Notas</p>
              <Row
                title="Plantilla por defecto"
                desc="El formato con el que se generan tus notas."
                control={<Dropdown value={ui.defaultTemplate} options={TEMPLATE_OPTIONS} onChange={(v) => patch({ defaultTemplate: v })} />}
              />
              <Row
                title="Generar notas automáticamente"
                desc="Al terminar una reunión, Uyari escribe las notas solo."
                control={<Toggle on={ui.autoGenerate} onChange={(v) => patch({ autoGenerate: v })} />}
              />
            </div>
          )}

          {tab === 'calendario' && (
            <div>
              <p style={sectFirst}>Calendario</p>
              <Row
                title="Google Calendar"
                desc="Agenda del día, recordatorios para unirte y notas adjuntas automáticamente."
                control={<Ghost label="Conectar" disabled />}
              />
              <Row title="Microsoft Outlook" control={<Ghost label="Conectar" disabled />} />
              <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-4)', margin: '14px 0 0' }}>
                ¿Sin calendario? Uyari igual captura cualquier reunión a la que te unas.
              </p>
            </div>
          )}

          {tab === 'privacidad' && (
            <div>
              <p style={sectFirst}>Privacidad</p>
              <Row
                title="Aviso de consentimiento"
                desc="Recordatorio de pedir consentimiento al transcribir a otros, en cada nota."
                control={<Toggle on={ui.consentNotice} onChange={(v) => patch({ consentNotice: v })} />}
              />
              <Row
                title="Retención de transcripts"
                desc="El audio nunca se guarda; el texto se borra según esta regla."
                control={<Dropdown value={ui.retention} options={RETENTION_OPTIONS} onChange={(v) => patch({ retention: v })} />}
              />
              <p style={sect}>Zona de riesgo</p>
              <Row
                title="Borrar todos los transcripts"
                desc="Elimina el texto de todas tus reuniones. No se puede deshacer."
                control={
                  <button title="Próximamente" style={{ fontSize: 12.5, fontWeight: 500, color: '#E5484D', cursor: 'default', whiteSpace: 'nowrap', background: 'none', border: 'none', fontFamily: 'inherit', opacity: 0.8 }}>
                    Borrar…
                  </button>
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
