import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useApp } from '@renderer/store'
import { Button } from '@renderer/ui/Button'
import { dIcon, useHover } from '@renderer/ui/chrome'
import { S, WS_COLORS } from '@renderer/strings'
import { loadFlow } from '@renderer/onboarding/state'
import { groupCaptions } from '@renderer/lib/captions'

// Home = paso 9 del kit (sidebar + "Coming up") FUSIONADO con la lógica
// real que ya existía: banner de reunión detectada, start/stop, estados de
// reconexión y transcript en vivo. Mismo store, mismos eventos IPC.

function SideItem({
  icon,
  label,
  active,
  indent,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  indent?: boolean
}): React.JSX.Element {
  const [hover, hoverProps] = useHover()
  return (
    <div
      {...hoverProps}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '7px 10px',
        marginLeft: indent ? 14 : 0,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
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

function Sidebar({ workspace, wsColorId }: { workspace: string; wsColorId: string }): React.JSX.Element {
  const initial = (workspace || 'U').trim().charAt(0).toUpperCase()
  const ws = WS_COLORS.find((c) => c.id === wsColorId) ?? WS_COLORS[0]
  const i = (d: string | string[]): ReactNode => dIcon(d, 1.6)
  return (
    <aside
      style={{
        width: 230,
        flexShrink: 0,
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
      <SideItem icon={i('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5')} label={S.home.nav.home} active />
      <SideItem
        icon={i([
          'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2',
          'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
          'M23 21v-2a4 4 0 0 0-3-3.87',
          'M16 3.13a4 4 0 0 1 0 7.75',
        ])}
        label={S.home.nav.shared}
      />
      <SideItem icon={i('M8 12a8 7 0 1 1 4 6.2L7 20l.8-3.4A8 7 0 0 1 8 12z')} label={S.home.nav.ask} />
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

export function Home(): React.JSX.Element {
  const { session, captions, startCapture, stopCapture, detectedMeeting, setDetectedMeeting } =
    useApp()
  const bottomRef = useRef<HTMLDivElement>(null)
  const flow = useMemo(loadFlow, [])
  const today = new Date()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [captions.length])

  const active = session?.status === 'recording' || session?.status === 'reconnecting'
  const reconnecting = session?.status === 'reconnecting'
  const showEmptyState = !session && captions.length === 0

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      <Sidebar workspace={flow.workspace} wsColorId={flow.wsColor} />
      <main style={{ flex: 1, overflowY: 'auto', position: 'relative', padding: '20px 40px 40px' }}>
        <div style={{ maxWidth: 640, margin: '18px auto 0' }}>
          {detectedMeeting && !session && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--violet-wash)',
                border: '1px solid var(--violet)',
                borderRadius: 'var(--radius-lg)',
                padding: '12px 16px',
                marginBottom: 20,
                font: 'var(--text-sm)',
                color: 'var(--text-body)',
              }}
            >
              <span style={{ flex: 1 }}>
                <strong style={{ color: 'var(--text-heading)' }}>{detectedMeeting}</strong>{' '}
                {S.home.detected}
              </span>
              <Button size="sm" onClick={() => void startCapture(`${detectedMeeting} meeting`)}>
                {S.home.startRecording}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDetectedMeeting(null)}>
                {S.home.dismiss}
              </Button>
            </div>
          )}

          <h1
            style={{
              font: 'var(--display-md)',
              fontSize: 28,
              color: 'var(--text-heading)',
              margin: '0 0 18px',
            }}
          >
            {active ? (
              <>
                <span className="rec-dot" />
                {session?.title}
              </>
            ) : (
              S.home.comingUp
            )}
          </h1>

          {reconnecting && <p className="reconnect-note">{S.home.reconnecting}</p>}
          {session?.status === 'recording' && session.statusDetail && (
            <p className="reconnect-note">{session.statusDetail}</p>
          )}
          {session?.status === 'error' && (
            <p className="error-text">
              {session.statusDetail ?? 'Capture failed'}{' '}
              <Button variant="ghost" size="sm" onClick={() => void stopCapture()}>
                {S.home.dismiss}
              </Button>
            </p>
          )}

          <div style={{ display: 'flex', gap: 18 }}>
            <div style={{ textAlign: 'center', flexShrink: 0, paddingTop: 4 }}>
              <div style={{ font: 'var(--display-md)', fontSize: 30, color: 'var(--text-heading)' }}>
                {today.getDate()}
              </div>
              <div style={{ font: 'var(--text-xs)', fontWeight: 500, color: 'var(--ink-4)' }}>
                {today.toLocaleDateString('en-US', { month: 'short' })}
                <br />
                {today.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  background: 'var(--violet-wash)',
                  border: '1px solid var(--violet-soft)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 14,
                }}
              >
                <span
                  style={{
                    width: 52,
                    height: 40,
                    borderRadius: 8,
                    background: 'var(--violet)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {active ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                  <span style={{ font: 'var(--label-sm)', fontSize: 14, color: 'var(--text-heading)' }}>
                    {active ? session?.title : S.home.firstNoteTitle}
                  </span>
                  <span style={{ font: 'var(--text-xs)', fontWeight: 500, color: 'var(--accent-strong)' }}>
                    {active ? 'Recording…' : S.home.firstNoteSub}
                  </span>
                </span>
                {active ? (
                  <Button variant="secondary" size="sm" onClick={() => void stopCapture()}>
                    {S.home.stop}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void startCapture()}>
                    {S.home.startCapture}
                  </Button>
                )}
              </div>

              {showEmptyState && !flow.calendar && (
                <div
                  style={{
                    border: '1.5px dashed var(--border-strong)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '22px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'center',
                  }}
                >
                  <span style={{ color: 'var(--ink-3)' }}>
                    {dIcon([
                      'M8 2v4M16 2v4',
                      'M3 8h18',
                      'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
                    ])}
                  </span>
                  <span style={{ font: 'var(--label-sm)', fontSize: 14, color: 'var(--ink-2)' }}>
                    {S.home.linkCalendarTitle}
                  </span>
                  <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', maxWidth: 240 }}>
                    {S.home.linkCalendarSub}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="transcript">
            {groupCaptions(captions).map((g) => (
              <div className="caption-line" key={g.key}>
                {g.speaker && <span className="caption-speaker">{g.speaker}</span>}
                {g.texts.join(' ')}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </main>
    </div>
  )
}
