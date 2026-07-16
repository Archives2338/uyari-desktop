import { useEffect, useRef, useState, type ReactNode } from 'react'
import { dIcon, fIcon, useHover } from '@renderer/ui/chrome'
import { S, WS_COLORS, PROJECT_COLORS, projectDot } from '@renderer/strings'
import { useApp } from '@renderer/store'

// Shell de la app (search, nav, spaces, switcher de workspace) — compartido
// por todas las pantallas post-onboarding (Home, MeetingDetail, ...).

function SideItem({
  icon,
  label,
  active,
  indent,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  indent?: boolean
  onClick?: () => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      {...hoverProps}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '6px 10px',
        marginLeft: indent ? 14 : 0,
        borderRadius: 'var(--radius-sm)',
        cursor: onClick ? 'pointer' : 'default',
        background: active || hover ? 'var(--surface-sunken)' : 'transparent',
        // 13px (no --text-sm=14px): un toque más compacto, a la par de Granola.
        font: '500 13px/1.5 var(--font-sans)',
        color: active ? 'var(--text-heading)' : 'var(--ink-2)',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>
        {icon}
      </span>
      {label}
    </div>
  )
}

// Sección PROYECTOS — el diferenciador. Consume el store directamente (así
// las pantallas que montan el Sidebar no tienen que pasar props de proyectos).
function ProjectsSection(): React.JSX.Element {
  const projects = useApp((s) => s.projects)
  const openProjectId = useApp((s) => s.openProjectId)
  const openProject = useApp((s) => s.openProject)
  const loadProjects = useApp((s) => s.loadProjects)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const eyebrowRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 6px 6px 10px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={eyebrowRow}>
        <span
          style={{
            font: 'var(--eyebrow)',
            letterSpacing: 'var(--eyebrow-tracking)',
            color: 'var(--ink-4)',
          }}
        >
          {S.home.projects}
        </span>
        <AddProjectButton onClick={() => setCreating(true)} />
      </div>

      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {projects.map((p) => (
          <ProjectItem
            key={p.id}
            name={p.name}
            color={p.color}
            openItems={p.actionItemCount}
            meetings={p.meetingCount}
            favorite={p.favorite}
            done={p.status === 'DONE'}
            active={p.id === openProjectId}
            onClick={() => openProject(p.id)}
          />
        ))}

        {creating && (
          <NewProjectInput
            onCancel={() => setCreating(false)}
            onDone={async (name, color) => {
              setCreating(false)
              try {
                const created = await window.uyari.projects.create(name, color)
                await loadProjects()
                openProject(created.id)
              } catch {
                // Backend caído: no rompas el sidebar, el usuario reintenta.
              }
            }}
          />
        )}

        {projects.length === 0 && !creating && (
          <span
            style={{
              font: 'var(--text-xs)',
              fontWeight: 400,
              color: 'var(--ink-4)',
              lineHeight: 1.5,
              padding: '4px 10px 0',
            }}
          >
            {S.home.projectsEmpty}
          </span>
        )}
      </div>
    </div>
  )
}

function AddProjectButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <span
      {...hoverProps}
      onClick={onClick}
      title={S.home.newProject}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        color: 'var(--ink-4)',
        background: hover ? 'var(--surface-sunken)' : 'transparent',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  )
}

function ProjectItem({
  name,
  color,
  openItems,
  meetings,
  favorite,
  done,
  active,
  onClick,
}: {
  name: string
  color: string | null
  openItems: number
  meetings: number
  favorite: boolean
  done: boolean
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      {...hoverProps}
      onClick={onClick}
      title={S.project.meetingsCount(meetings)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '6px 10px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        background: active || hover ? 'var(--surface-sunken)' : 'transparent',
        font: '500 13px/1.5 var(--font-sans)',
        color: active ? 'var(--text-heading)' : 'var(--ink-2)',
        // Proyectos "Done" atenuados: siguen visibles pero fuera del foco.
        opacity: done ? 0.55 : 1,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 3,
          background: projectDot(color),
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </span>
      {favorite && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent-strong)" style={{ flexShrink: 0 }}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      )}
      {openItems > 0 && (
        <span
          title={S.project.itemsCount(openItems)}
          style={{
            font: '600 10.5px/1 var(--font-sans)',
            color: 'var(--accent-strong)',
            background: 'var(--violet-wash)',
            borderRadius: 'var(--radius-pill)',
            padding: '3px 6px',
            minWidth: 8,
            textAlign: 'center',
          }}
        >
          {openItems}
        </span>
      )}
    </div>
  )
}

function NewProjectInput({
  onDone,
  onCancel,
}: {
  onDone: (name: string, color: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(PROJECT_COLORS[0].id)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed) onDone(trimmed, color)
    else onCancel()
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-sunken)',
      }}
    >
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') onCancel()
        }}
        onBlur={submit}
        placeholder={S.home.newProjectPlaceholder}
        style={{
          font: '500 13px/1.4 var(--font-sans)',
          color: 'var(--text-heading)',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          padding: 0,
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        {PROJECT_COLORS.map((c) => (
          <span
            key={c.id}
            // onMouseDown (no onClick): el onBlur del input dispara antes que el
            // click y cerraría el creador — mousedown gana la carrera.
            onMouseDown={(e) => {
              e.preventDefault()
              setColor(c.id)
            }}
            style={{
              width: 15,
              height: 15,
              borderRadius: 5,
              background: c.dot,
              cursor: 'pointer',
              boxSizing: 'border-box',
              border: color === c.id ? '2px solid var(--text-heading)' : '2px solid transparent',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export interface SidebarAskHistory {
  /** [etiqueta del grupo ("Today"/"Yesterday"/fecha), entradas] */
  groups: Array<[string, Array<{ id: string; question: string }>]>
  activeId: string | null
  onSelect: (id: string) => void
}

export function Sidebar({
  workspace,
  wsColorId,
  active = 'home',
  onHome,
  onAsk,
  onSettings,
  askHistory,
}: {
  workspace: string
  wsColorId: string
  /** Qué ítem de nav está activo. "Shared" no tiene destino todavía. */
  active?: 'home' | 'shared' | 'ask'
  onHome?: () => void
  onAsk?: () => void
  /** Abre el modal de Ajustes (overlay global, ver store.settingsOpen). */
  onSettings?: () => void
  /** En una conversación de "Pregúntale a Uyari": el nav de Spaces/My notes
   *  se reemplaza por el historial Hoy/Ayer (mismo patrón del handoff —
   *  explorations-chat.html CH2, NO es una columna nueva). */
  askHistory?: SidebarAskHistory
}): React.JSX.Element {
  const initial = (workspace || 'U').trim().charAt(0).toUpperCase()
  const ws = WS_COLORS.find((c) => c.id === wsColorId) ?? WS_COLORS[0]
  const i = (d: string | string[]): ReactNode => dIcon(d, 1.6)
  const f = (d: string): ReactNode => fIcon(d, 18)
  return (
    <aside
      style={{
        width: 230,
        flexShrink: 0,
        background: 'var(--sidebar)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '48px 12px 14px',
        boxSizing: 'border-box',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--surface-sunken)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 12px',
          marginBottom: 10,
          font: 'var(--text-sm)',
          color: 'var(--ink-4)',
        }}
      >
        {i(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm21 21-4.35-4.35'])}
        {S.home.search}
        <span style={{ marginLeft: 'auto', font: 'var(--text-xs)', color: 'var(--ink-4)' }}>⌘K</span>
      </div>
      <SideItem
        icon={f(
          'M219.31,108.68l-80-80a16,16,0,0,0-22.62,0l-80,80A15.87,15.87,0,0,0,32,120v96a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V160h32v56a8,8,0,0,0,8,8h64a8,8,0,0,0,8-8V120A15.87,15.87,0,0,0,219.31,108.68ZM208,208H160V152a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8v56H48V120l80-80,80,80Z',
        )}
        label={S.home.nav.home}
        active={active === 'home'}
        onClick={onHome}
      />
      {!askHistory && (
        <SideItem
          icon={i([
            'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
            'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
            'M23 21v-2a4 4 0 0 0-3-3.87',
            'M16 3.13a4 4 0 0 1 0 7.75',
          ])}
          label={S.home.nav.shared}
          active={active === 'shared'}
        />
      )}
      <SideItem
        icon={f(
          'M232.07,186.76a80,80,0,0,0-62.5-114.17A80,80,0,1,0,23.93,138.76l-7.27,24.71a16,16,0,0,0,19.87,19.87l24.71-7.27a80.39,80.39,0,0,0,25.18,7.35,80,80,0,0,0,108.34,40.65l24.71,7.27a16,16,0,0,0,19.87-19.86ZM62,159.5a8.28,8.28,0,0,0-2.26.32L32,168l8.17-27.76a8,8,0,0,0-.63-6,64,64,0,1,1,26.26,26.26A8,8,0,0,0,62,159.5Zm153.79,28.73L224,216l-27.76-8.17a8,8,0,0,0-6,.63,64.05,64.05,0,0,1-85.87-24.88A79.93,79.93,0,0,0,174.7,89.71a64,64,0,0,1,41.75,92.48A8,8,0,0,0,215.82,188.23Z',
        )}
        label={S.home.nav.ask}
        active={active === 'ask'}
        onClick={onAsk}
      />
      {askHistory ? (
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {askHistory.groups.map(([label, items]) => (
            <div key={label}>
              <div
                style={{
                  font: 'var(--eyebrow)',
                  letterSpacing: 'var(--eyebrow-tracking)',
                  color: 'var(--ink-4)',
                  padding: '16px 10px 6px',
                }}
              >
                {label}
              </div>
              {items.map((h) => (
                <div
                  key={h.id}
                  onClick={() => askHistory.onSelect(h.id)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-sm)',
                    font: 'var(--text-sm)',
                    fontSize: 13,
                    fontWeight: h.id === askHistory.activeId ? 500 : 400,
                    color: h.id === askHistory.activeId ? 'var(--text-heading)' : 'var(--ink-2)',
                    background: h.id === askHistory.activeId ? 'var(--surface-sunken)' : 'transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {h.question}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <ProjectsSection />
      )}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {onSettings && (
          <SideItem
            icon={i([
              'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
              'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
            ])}
            label="Ajustes"
            onClick={onSettings}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px', marginTop: 8, cursor: 'pointer' }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: ws.bg,
              color: ws.fg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: 'var(--label-sm)',
              fontSize: 13,
            }}
          >
            {initial}
          </span>
          <span style={{ font: 'var(--label-sm)', fontSize: 14, color: 'var(--text-heading)' }}>
            {workspace || 'Uyari'}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ink-4)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginLeft: 'auto' }}
          >
            <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
          </svg>
        </div>
      </div>
    </aside>
  )
}
