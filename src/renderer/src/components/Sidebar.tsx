import type { ReactNode } from 'react'
import { dIcon, useHover } from '@renderer/ui/chrome'
import { S, WS_COLORS } from '@renderer/strings'

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
        padding: '7px 10px',
        marginLeft: indent ? 14 : 0,
        borderRadius: 'var(--radius-sm)',
        cursor: onClick ? 'pointer' : 'default',
        background: active ? 'var(--surface-sunken)' : hover ? 'var(--violet-wash)' : 'transparent',
        font: 'var(--text-sm)',
        fontWeight: 500,
        color: active ? 'var(--text-heading)' : 'var(--ink-2)',
      }}
    >
      <span style={{ display: 'inline-flex', color: active ? 'var(--accent-strong)' : 'var(--ink-3)' }}>
        {icon}
      </span>
      {label}
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
  askHistory,
}: {
  workspace: string
  wsColorId: string
  /** Qué ítem de nav está activo. "Shared" no tiene destino todavía. */
  active?: 'home' | 'shared' | 'ask'
  onHome?: () => void
  onAsk?: () => void
  /** En una conversación de "Pregúntale a Uyari": el nav de Spaces/My notes
   *  se reemplaza por el historial Hoy/Ayer (mismo patrón del handoff —
   *  explorations-chat.html CH2, NO es una columna nueva). */
  askHistory?: SidebarAskHistory
}): React.JSX.Element {
  const initial = (workspace || 'U').trim().charAt(0).toUpperCase()
  const ws = WS_COLORS.find((c) => c.id === wsColorId) ?? WS_COLORS[0]
  const i = (d: string | string[]): ReactNode => dIcon(d, 1.6)
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
        icon={i('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5')}
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
        icon={i('M8 12a8 7 0 1 1 4 6.2L7 20l.8-3.4A8 7 0 0 1 8 12z')}
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
        <>
          <div
            style={{
              font: 'var(--eyebrow)',
              letterSpacing: 'var(--eyebrow-tracking)',
              color: 'var(--ink-4)',
              padding: '16px 10px 6px',
            }}
          >
            {S.home.spaces}
          </div>
          <SideItem icon={i(['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'])} label={S.home.myNotes} />
          <SideItem
            icon={i([
              'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
              'M12 11v6M9 14h6',
            ])}
            label={S.home.addFolder}
            indent
          />
        </>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 6px', cursor: 'pointer' }}>
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
