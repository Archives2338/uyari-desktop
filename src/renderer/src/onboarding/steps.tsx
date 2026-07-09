import { useEffect, useState } from 'react'
import { useApp } from '@renderer/store'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { OnboardCard, PickChip, PickCard, dIcon } from '@renderer/ui/chrome'
import { S, WS_COLORS, type WsColorId } from '@renderer/strings'
import appIcon from '@renderer/assets/uyari-app-icon-macos.svg'

// Pasos 1–8 del onboarding (Steps.js.txt portado a TSX).
// Cableado real SOLO donde ya existe lógica: paso 1 = login por email,
// paso 6 = permisos TCC. El resto guarda estado local (ver state.ts).

interface StepProps {
  onNext: () => void
  onBack?: () => void
  step?: number
  total?: number
}

/* 1 · Welcome / sign-in — full-bleed, sin card. Cableado al login real. */
export function StepWelcome({ onNext }: StepProps): React.JSX.Element {
  const login = useApp((s) => s.login)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = email.includes('@')

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await login(email.trim())
      onNext()
    } catch {
      setError(S.welcome.loginError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowY: 'auto',
        minHeight: 0,
      }}
    >
      <div
        style={{
          width: 640,
          maxWidth: '86%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 16,
          margin: 'auto',
          padding: '28px 0',
        }}
      >
        <img
          src={appIcon}
          alt="Uyari"
          style={{ width: 104, filter: 'drop-shadow(0 16px 32px rgba(132,116,196,0.3))' }}
        />
        <h1
          style={{
            font: 'var(--display-lg)',
            fontSize: 44,
            lineHeight: 1.15,
            color: 'var(--text-heading)',
            margin: 0,
            maxWidth: 560,
          }}
        >
          {S.welcome.tagline}
        </h1>
        <p style={{ font: 'var(--text-md)', color: 'var(--text-body)', margin: 0, maxWidth: 420 }}>
          {S.welcome.sub}
        </p>
        <Input
          type="email"
          placeholder={S.welcome.emailPlaceholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && valid && !busy && void submit()}
          containerStyle={{ width: 320 }}
          error={error || undefined}
        />
        <Button size="lg" style={{ minWidth: 320 }} disabled={busy || !valid} onClick={() => void submit()}>
          {busy ? S.welcome.signingIn : S.welcome.continue}
        </Button>
        <span style={{ display: 'flex', gap: 8, font: 'var(--text-xs)', fontWeight: 400 }}>
          <span style={{ color: 'var(--ink-4)' }}>{S.welcome.worksWith}</span>
          <span style={{ color: 'var(--ink-3)', fontWeight: 600 }}>{S.welcome.platforms}</span>
        </span>
        <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', maxWidth: 340 }}>
          {S.welcome.legal}
        </span>
      </div>
    </div>
  )
}

/* 2 · Source */
export function StepSource({
  onNext,
  onBack,
  step,
  total,
  value,
  onChange,
}: StepProps & { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <OnboardCard
      eyebrow={S.source.eyebrow}
      title={S.source.title}
      step={step}
      total={total}
      onBack={onBack}
      footer={
        <>
          <Button variant="ghost" onClick={onNext}>
            {S.source.skip}
          </Button>
          <Button disabled={!value} onClick={onNext}>
            {S.source.continue}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {S.source.options.map((o) => (
          <PickChip key={o} selected={value === o} onClick={() => onChange(o)}>
            {o}
          </PickChip>
        ))}
      </div>
    </OnboardCard>
  )
}

/* 3 · Team type */
export function StepTeam({
  onNext,
  onBack,
  step,
  total,
  value,
  onChange,
}: StepProps & { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <OnboardCard
      eyebrow={S.team.eyebrow}
      title={S.team.title}
      step={step}
      total={total}
      onBack={onBack}
      width={680}
      footer={
        <>
          <span />
          <Button disabled={!value} onClick={onNext}>
            {S.team.continue}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12 }}>
        {S.team.options.map((o) => (
          <PickCard
            key={o.id}
            selected={value === o.id}
            onClick={() => onChange(o.id)}
            icon={dIcon(o.icon)}
            title={o.title}
            sub={o.sub}
          />
        ))}
      </div>
    </OnboardCard>
  )
}

/* 4 · Workspace name + color */
export function StepWorkspace({
  onNext,
  onBack,
  step,
  total,
  value,
  onChange,
  color,
  onColor,
}: StepProps & {
  value: string
  onChange: (v: string) => void
  color: WsColorId
  onColor: (c: WsColorId) => void
}): React.JSX.Element {
  const initial = (value || '').trim().charAt(0).toUpperCase()
  const ws = WS_COLORS.find((c) => c.id === color) ?? WS_COLORS[0]
  return (
    <OnboardCard
      eyebrow={S.workspace.eyebrow}
      title={S.workspace.title}
      sub={S.workspace.sub}
      step={step}
      total={total}
      onBack={onBack}
      footer={
        <>
          <span />
          <Button disabled={!value.trim()} onClick={onNext}>
            {S.workspace.continue}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 'var(--radius-md)',
            flexShrink: 0,
            background: initial ? ws.bg : 'var(--surface-sunken)',
            color: initial ? ws.fg : 'var(--ink-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: 'var(--display-sm)',
            fontSize: 24,
            transition: 'background var(--dur-med) var(--ease-out)',
          }}
        >
          {initial || '?'}
        </span>
        <Input
          placeholder={S.workspace.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          containerStyle={{ flex: 1 }}
          inputStyle={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--text-muted)', marginRight: 4 }}>
          {S.workspace.colorLabel}
        </span>
        {WS_COLORS.map((c) => (
          <span
            key={c.id}
            onClick={() => onColor(c.id)}
            title={c.id}
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              background: c.bg,
              cursor: 'pointer',
              boxSizing: 'border-box',
              outline: color === c.id ? '2px solid var(--accent-strong)' : 'none',
              outlineOffset: 2,
              border: c.id === 'violet' ? 'none' : '1px solid var(--border)',
              transition: 'outline-color var(--dur-fast) var(--ease-out)',
            }}
          />
        ))}
      </div>
    </OnboardCard>
  )
}

/* 5 · Invite teammates — solo estado local (no hay workspaces todavía). */
export function StepInvite({
  onNext,
  onBack,
  step,
  total,
  emails,
  onEmails,
}: StepProps & { emails: string[]; onEmails: (e: string[]) => void }): React.JSX.Element {
  const [q, setQ] = useState('')
  const add = (): void => {
    const v = q.trim()
    if (v && v.includes('@') && !emails.includes(v)) {
      onEmails([...emails, v])
      setQ('')
    }
  }
  return (
    <OnboardCard title={S.invite.title} sub={S.invite.sub} step={step} total={total} onBack={onBack} width={640}>
      <img
        src={appIcon}
        alt=""
        style={{ width: 44, position: 'absolute', top: 44, right: 48, transform: 'rotate(-8deg)' }}
      />
      <div
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ position: 'relative' }}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ink-4)"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            placeholder={S.invite.search}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              font: 'var(--text-sm)',
              color: 'var(--ink)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              padding: '11px 14px 11px 36px',
              outline: 'none',
            }}
          />
        </div>
        <div
          style={{
            minHeight: 110,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            justifyContent: emails.length ? 'flex-start' : 'center',
          }}
        >
          {emails.length === 0 ? (
            <span style={{ font: 'var(--text-sm)', color: 'var(--ink-4)', textAlign: 'center' }}>
              {S.invite.empty}
            </span>
          ) : (
            emails.map((e) => (
              <span
                key={e}
                style={{ display: 'flex', alignItems: 'center', gap: 10, font: 'var(--text-sm)', color: 'var(--ink-2)' }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--violet-soft)',
                    color: 'var(--accent-strong)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    font: 'var(--label-sm)',
                    fontSize: 12,
                  }}
                >
                  {e[0].toUpperCase()}
                </span>
                {e}
              </span>
            ))
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={onNext}>
              {S.invite.skip}
            </Button>
            <Button size="sm" disabled={emails.length === 0} onClick={onNext}>
              {S.invite.invite}
            </Button>
          </span>
        </div>
      </div>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          justifyContent: 'center',
          font: 'var(--text-xs)',
          fontWeight: 400,
          color: 'var(--ink-4)',
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="14" height="10" x="5" y="11" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {S.invite.privacy}
      </span>
    </OnboardCard>
  )
}

/* 6 · Permissions — cableado a los permisos TCC REALES. */
type RowState = 'pending' | 'granted' | 'denied'

function PermissionRow({
  icon,
  title,
  why,
  state,
  onAllow,
  onOpenSettings,
}: {
  icon: React.ReactNode
  title: string
  why: string
  state: RowState
  onAllow: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'var(--surface-sunken)',
        borderRadius: 'var(--radius-lg)',
        padding: '16px 18px',
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--radius-md)',
          background: 'var(--violet-wash)',
          color: 'var(--accent-strong)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
        <span style={{ font: 'var(--label-md)', fontSize: 15, color: 'var(--text-heading)' }}>{title}</span>
        <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--text-muted)' }}>{why}</span>
      </span>
      {state === 'pending' && (
        <Button size="sm" onClick={onAllow}>
          {S.permissions.allow}
        </Button>
      )}
      {state === 'granted' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, font: 'var(--label-sm)', color: 'var(--mint)' }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'var(--mint-soft)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--mint)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          {S.permissions.granted}
        </span>
      )}
      {state === 'denied' && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ font: 'var(--label-sm)', color: '#E5484D' }}>{S.permissions.denied}</span>
          <Button variant="secondary" size="sm" onClick={onOpenSettings}>
            {S.permissions.settings}
          </Button>
        </span>
      )}
    </div>
  )
}

/** PermissionState de macOS → estado visual del kit. */
function rowState(s: string): RowState {
  if (s === 'granted') return 'granted'
  if (s === 'denied' || s === 'restricted') return 'denied'
  return 'pending'
}

export function StepPermissions({ onNext, onBack, step, total }: StepProps): React.JSX.Element {
  const { permissions, refreshPermissions } = useApp()

  // El permiso de Screen Recording solo se otorga en System Settings:
  // re-chequear al recuperar el foco y cada 2 s mientras esta pantalla viva.
  useEffect(() => {
    const onFocus = (): void => void refreshPermissions()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(onFocus, 2000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [refreshPermissions])

  const mic = rowState(permissions.microphone)
  const screen = rowState(permissions.screen)
  const ok = mic === 'granted' && screen === 'granted'
  const openScreenSettings = (): void => void window.uyari.permissions.openScreenRecordingSettings()

  return (
    <OnboardCard
      eyebrow={S.permissions.eyebrow}
      title={S.permissions.title}
      sub={S.permissions.sub}
      step={step}
      total={total}
      onBack={onBack}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={onNext}>
            {S.permissions.skip}
          </Button>
          <Button disabled={!ok} onClick={onNext}>
            {S.permissions.continue}
          </Button>
        </>
      }
    >
      <PermissionRow
        icon={dIcon(['M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z', 'M19 10v1a7 7 0 0 1-14 0v-1', 'M12 18v4'])}
        title={S.permissions.mic.title}
        why={S.permissions.mic.why}
        state={mic}
        onAllow={() => void window.uyari.permissions.requestMicrophone().then(refreshPermissions)}
        onOpenSettings={openScreenSettings}
      />
      <PermissionRow
        icon={dIcon(['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8 21h8M12 17v4'])}
        title={S.permissions.screen.title}
        why={S.permissions.screen.why}
        state={screen}
        onAllow={openScreenSettings}
        onOpenSettings={openScreenSettings}
      />
    </OnboardCard>
  )
}

/* 7 · Calendar — la feature no existe: se guarda la intención y sigue. */
export function StepCalendar({
  onNext,
  onBack,
  step,
  total,
  onLink,
}: StepProps & { onLink: (provider: string | null) => void }): React.JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)

  const pick = (label: string): void => {
    setPicked(label)
    onLink(label)
    // Breve confirmación de "coming soon" antes de avanzar.
    setTimeout(onNext, 900)
  }

  const provider = (label: string, tone: string): React.JSX.Element => (
    <button
      onClick={() => pick(label)}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        background: picked === label ? 'var(--violet-wash)' : 'var(--surface-sunken)',
        border: `1.5px solid ${picked === label ? 'var(--violet)' : 'transparent'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '18px 18px',
        font: 'var(--label-md)',
        fontSize: 15,
        color: 'var(--text-heading)',
        transition: 'border-color var(--dur-fast) var(--ease-out)',
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          background: tone,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          font: 'var(--label-md)',
          fontSize: 15,
        }}
      >
        {label[0]}
      </span>
      {label}
    </button>
  )

  return (
    <OnboardCard
      eyebrow={S.calendar.eyebrow}
      title={S.calendar.title}
      sub={S.calendar.sub}
      step={step}
      total={total}
      onBack={onBack}
      width={620}
      footer={
        <>
          <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)' }}>
            {picked ? S.calendar.comingSoon : ''}
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              onLink(null)
              onNext()
            }}
          >
            {S.calendar.skip}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 12 }}>
        {provider(S.calendar.google, '#4285F4')}
        {provider(S.calendar.outlook, '#0F6CBD')}
      </div>
    </OnboardCard>
  )
}

/* 8 · Ready */
export function StepReady({ onNext, onBack, step, total }: StepProps): React.JSX.Element {
  return (
    <OnboardCard
      eyebrow={S.ready.eyebrow}
      title={S.ready.title}
      step={step}
      total={total}
      onBack={onBack}
      width={600}
      footer={
        <>
          <span />
          <Button onClick={onNext}>{S.ready.home}</Button>
        </>
      }
    >
      <div
        onClick={onNext}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          cursor: 'pointer',
          background: 'var(--violet-wash)',
          border: '1px solid var(--violet-soft)',
          borderRadius: 'var(--radius-lg)',
          padding: 16,
        }}
      >
        <span
          style={{
            width: 84,
            height: 56,
            borderRadius: 10,
            background: 'var(--violet)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ font: 'var(--label-md)', color: 'var(--text-heading)' }}>{S.ready.demoTitle}</span>
          <span style={{ font: 'var(--text-sm)', color: 'var(--accent-strong)' }}>{S.ready.demoSub}</span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-4)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginLeft: 'auto' }}
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </div>
    </OnboardCard>
  )
}
