import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '@renderer/store'
import { dIcon } from '@renderer/ui/chrome'
import { S } from '@renderer/strings'
import { loadFlow } from '@renderer/onboarding/state'
import { Sidebar } from '@renderer/components/Sidebar'
import {
  loadAskHistory,
  pushAskConversation,
  type AskConversation,
} from '@renderer/lib/askHistory'
import { dayBucketLabel, formatRelativeDate, formatTimeAgo } from '@renderer/lib/dates'
import type { MeetingListItem } from '@shared/domain'
import flameIcon from '@renderer/assets/uyari-flame-violet.svg'

// "Pregúntale a Uyari" — módulo de chat global (handoff v4,
// IMPLEMENTACION-HOME-CHAT-TEMAS.md §3: CH1 home + CH2 conversación).
//
// Alcance real vs el mock: el backend responde preguntas SUELTAS (sin
// memoria de conversación — igual que el ask por reunión que ya existía),
// así que cada envío crea una entrada de historial nueva en vez de
// simular un hilo multi-turno que no tenemos. Las tarjetas de cita SON
// reales: el LLM declara de qué reuniones sacó la respuesta (ver
// ASK_ALL_SYSTEM_PROMPT en el backend) y la UI solo pinta esas — nunca
// inventa una fuente. El historial (Recientes/CH1, rail Hoy-Ayer/CH2) se
// persiste LOCAL (localStorage, ver lib/askHistory.ts): el backend no
// tiene un modelo de conversación todavía, así que no sincroniza entre
// devices — se documenta, no se finge.
//
// Deliberadamente NO incluido (para no dejar controles decorativos sin
// función real): el botón "Adjuntar" y el mic del composer del mock — no
// hay una feature de adjuntos ni de dictado para ESTE input. "Enviar como
// follow-up" sí se deja como affordance con aviso "coming soon" (mismo
// patrón que el panel de calendario del Home) porque es una feature de
// roadmap real, no un placeholder vacío.

function renderBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function groupHistoryByDay(history: AskConversation[]): Array<[string, AskConversation[]]> {
  const map = new Map<string, AskConversation[]>()
  for (const h of history) {
    const label = dayBucketLabel(h.createdAt)
    const list = map.get(label)
    if (list) list.push(h)
    else map.set(label, [h])
  }
  return [...map.entries()]
}

function Composer({
  variant,
  value,
  onChange,
  onSubmit,
  scope,
  onScopeChange,
  meetings,
  disabled,
}: {
  variant: 'home' | 'bottom'
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  scope: string
  onScopeChange: (v: string) => void
  meetings: MeetingListItem[]
  disabled: boolean
}): React.JSX.Element {
  const textarea = (
    <textarea
      className="ask-textarea"
      placeholder={S.ask.composerPlaceholder}
      value={value}
      rows={variant === 'home' ? 2 : 1}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onSubmit()
        }
      }}
      style={variant === 'bottom' ? { flex: 1, minHeight: 22, maxHeight: 22 } : undefined}
    />
  )
  const scopeSelect = (
    <select
      className="ask-scope-select"
      value={scope}
      onChange={(e) => onScopeChange(e.target.value)}
    >
      <option value="all">{S.ask.scopeAll}</option>
      {meetings.map((m) => (
        <option key={m.clientSessionId} value={m.clientSessionId}>
          {m.title || 'Untitled meeting'}
        </option>
      ))}
    </select>
  )
  const sendBtn = (
    <button
      className="ask-send-btn"
      onClick={onSubmit}
      disabled={disabled || !value.trim()}
      aria-label={S.ask.send}
    >
      {dIcon('M12 19V5M5 12l7-7 7 7', 2, 16)}
    </button>
  )

  if (variant === 'bottom') {
    return (
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--surface-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-pill)',
          boxShadow: 'var(--shadow-card)',
          padding: '6px 8px 6px 18px',
          boxSizing: 'border-box',
        }}
      >
        {textarea}
        {scopeSelect}
        {sendBtn}
      </div>
    )
  }
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--surface-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-card)',
        padding: '16px 18px',
        boxSizing: 'border-box',
      }}
    >
      {textarea}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {scopeSelect}
        {sendBtn}
      </div>
    </div>
  )
}

function ChatHome({
  history,
  showAllRecent,
  onToggleShowAll,
  onSelectHistory,
  input,
  onInputChange,
  scope,
  onScopeChange,
  meetings,
  onSubmit,
  onRecipe,
  loading,
}: {
  history: AskConversation[]
  showAllRecent: boolean
  onToggleShowAll: () => void
  onSelectHistory: (id: string) => void
  input: string
  onInputChange: (v: string) => void
  scope: string
  onScopeChange: (v: string) => void
  meetings: MeetingListItem[]
  onSubmit: () => void
  onRecipe: (text: string) => void
  loading: boolean
}): React.JSX.Element {
  const shown = showAllRecent ? history : history.slice(0, 5)
  return (
    <div
      style={{
        maxWidth: 640,
        width: '100%',
        margin: '64px auto 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 26,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <img src={flameIcon} alt="" width={42} height={42} />
        <h1
          style={{
            font: 'var(--display-md)',
            fontSize: 26,
            color: 'var(--text-heading)',
            margin: 0,
            textAlign: 'center',
          }}
        >
          {S.ask.greeting}
        </h1>
      </div>

      <Composer
        variant="home"
        value={input}
        onChange={onInputChange}
        onSubmit={onSubmit}
        scope={scope}
        onScopeChange={onScopeChange}
        meetings={meetings}
        disabled={loading}
      />

      {history.length > 0 && (
        <div style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 2,
            }}
          >
            <span
              style={{ font: 'var(--eyebrow)', letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--ink-4)' }}
            >
              {S.ask.recentTitle}
            </span>
            {history.length > 5 && (
              <button
                onClick={onToggleShowAll}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  font: 'var(--label-sm)',
                  fontSize: 12,
                  color: 'var(--accent-strong)',
                }}
              >
                {showAllRecent ? S.ask.seeLess : S.ask.seeAll}
              </button>
            )}
          </div>
          {shown.map((h) => (
            <div key={h.id} className="ask-recent-row" onClick={() => onSelectHistory(h.id)}>
              <span style={{ color: 'var(--ink-3)', flexShrink: 0, display: 'inline-flex' }}>
                {dIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'], 1.6, 16)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: 'var(--text-sm)',
                  color: 'var(--text-heading)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {h.question}
              </span>
              <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)', flexShrink: 0 }}>
                {formatTimeAgo(h.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ width: '100%' }}>
        <span
          style={{ font: 'var(--eyebrow)', letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--ink-4)' }}
        >
          {S.ask.recipesTitle}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {S.ask.recipes.map((r) => (
            <button key={r} className="ask-chip" onClick={() => onRecipe(r)} disabled={loading}>
              {dIcon('M9 11l3 3L22 4', 1.6, 14)}
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ConversationView({
  entry,
  loading,
  checked,
  onToggleCheck,
  onOpenNote,
  onRegenerate,
  onCopy,
  copied,
  onFollowUp,
  followUpNotice,
  onAskFollowUp,
  input,
  onInputChange,
  scope,
  onScopeChange,
  meetings,
  onSubmit,
}: {
  entry: AskConversation
  loading: boolean
  checked: Set<string>
  onToggleCheck: (key: string) => void
  onOpenNote: (clientSessionId: string) => void
  onRegenerate: () => void
  onCopy: () => void
  copied: boolean
  onFollowUp: () => void
  followUpNotice: boolean
  onAskFollowUp: (text: string) => void
  input: string
  onInputChange: (v: string) => void
  scope: string
  onScopeChange: (v: string) => void
  meetings: MeetingListItem[]
  onSubmit: () => void
}): React.JSX.Element {
  const allActionItems = entry.citations.flatMap((c, ci) =>
    c.actionItems.map((item, ii) => ({ key: `${entry.id}:${ci}:${ii}`, item })),
  )
  return (
    <div
      style={{
        maxWidth: 640,
        width: '100%',
        margin: '24px auto 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        paddingBottom: 90,
      }}
    >
      <div className="ask-question-bubble">{entry.question}</div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <img src={flameIcon} alt="" width={26} height={26} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ font: 'var(--text-md)', color: 'var(--text-body)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {renderBold(entry.answer)}
          </div>

          {entry.citations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entry.citations.map((c) => (
                <div key={c.clientSessionId} className="ask-citation-card">
                  <span
                    style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--violet)', flexShrink: 0 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: 'var(--label-sm)',
                      fontSize: 14,
                      color: 'var(--text-heading)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.title || 'Untitled meeting'}
                  </span>
                  <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)', flexShrink: 0 }}>
                    {formatRelativeDate(c.occurredAt)}
                  </span>
                  <button className="ask-citation-open" onClick={() => onOpenNote(c.clientSessionId)}>
                    {S.ask.openNote}
                  </button>
                </div>
              ))}
            </div>
          )}

          {allActionItems.length > 0 && (
            <div
              style={{
                background: 'var(--violet-wash)',
                border: '1px solid var(--violet-soft)',
                borderRadius: 'var(--radius-lg)',
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span
                style={{ font: 'var(--eyebrow)', letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--ink-4)' }}
              >
                {S.ask.relatedActionItems}
              </span>
              {allActionItems.map(({ key, item }) => (
                <label
                  key={key}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    font: 'var(--text-sm)',
                    color: 'var(--text-body)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(key)}
                    onChange={() => onToggleCheck(key)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ textDecoration: checked.has(key) ? 'line-through' : 'none', opacity: checked.has(key) ? 0.6 : 1 }}>
                    {item}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="ask-answer-action" onClick={onCopy}>
              {copied ? S.ask.copied : S.ask.copy}
            </button>
            <button className="ask-answer-action" onClick={onFollowUp}>
              {S.ask.sendAsFollowUp}
            </button>
            <button className="ask-answer-action" onClick={onRegenerate} disabled={loading}>
              {S.ask.regenerate}
            </button>
          </div>
          {followUpNotice && (
            <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)' }}>{S.ask.followUpComingSoon}</span>
          )}

          {entry.followUps.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {entry.followUps.map((f) => (
                <button key={f} className="ask-chip" onClick={() => onAskFollowUp(f)} disabled={loading}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, paddingTop: 16, background: 'var(--paper)' }}>
        <Composer
          variant="bottom"
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          scope={scope}
          onScopeChange={onScopeChange}
          meetings={meetings}
          disabled={loading}
        />
      </div>
    </div>
  )
}

function HistoryRail({
  history,
  activeId,
  onSelect,
  onNew,
}: {
  history: AskConversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  const groups = groupHistoryByDay(history)
  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        padding: '48px 10px 14px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxSizing: 'border-box',
      }}
    >
      <button
        onClick={onNew}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '7px 10px',
          cursor: 'pointer',
          font: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--text-heading)',
        }}
      >
        {dIcon('M12 5v14M5 12h14', 1.8, 14)}
        {S.ask.newChat}
      </button>
      {groups.map(([label, items]) => (
        <div key={label}>
          <div
            style={{
              font: 'var(--eyebrow)',
              fontSize: 10,
              letterSpacing: 'var(--eyebrow-tracking)',
              color: 'var(--ink-4)',
              padding: '2px 8px 6px',
            }}
          >
            {label === 'Today' ? S.ask.todayGroup : label === 'Yesterday' ? S.ask.yesterdayGroup : label.toUpperCase()}
          </div>
          {items.map((h) => (
            <div
              key={h.id}
              className={`ask-history-row${h.id === activeId ? ' ask-history-row-active' : ''}`}
              onClick={() => onSelect(h.id)}
            >
              {h.question}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function AskUyari(): React.JSX.Element {
  const closeAsk = useApp((s) => s.closeAsk)
  const openMeeting = useApp((s) => s.openMeeting)
  const flow = useMemo(loadFlow, [])

  const [history, setHistory] = useState<AskConversation[]>(() => loadAskHistory())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [scope, setScope] = useState('all')
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [followUpNoticeId, setFollowUpNoticeId] = useState<string | null>(null)

  useEffect(() => {
    // Alimenta el selector de alcance con reuniones reales (título, id).
    void window.uyari.meetings
      .list()
      .then((page) => setMeetings(page.items))
      .catch(() => {
        // Backend caído: el chat sigue usable, solo sin narrow-by-meeting.
      })
  }, [])

  const active = history.find((h) => h.id === activeId) ?? null

  const submit = async (question: string): Promise<void> => {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setError('')
    try {
      const meetingIds = scope === 'all' ? undefined : [scope]
      const result = await window.uyari.meetings.askAll(q, meetingIds)
      const entry: AskConversation = {
        id: crypto.randomUUID(),
        question: q,
        answer: result.answer,
        citations: result.citations,
        followUps: result.followUps,
        createdAt: new Date().toISOString(),
      }
      setHistory(pushAskConversation(entry))
      setActiveId(entry.id)
      setInput('')
    } catch {
      setError(S.ask.error)
    } finally {
      setLoading(false)
    }
  }

  const toggleChecked = (key: string): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const copyAnswer = (entry: AskConversation): void => {
    void navigator.clipboard.writeText(entry.answer)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId((id) => (id === entry.id ? null : id)), 1500)
  }

  // Sin integración de email/Slack todavía: affordance real de roadmap con
  // aviso, no un botón mudo (mismo patrón que el panel de calendario).
  const sendFollowUp = (entry: AskConversation): void => {
    setFollowUpNoticeId(entry.id)
    setTimeout(() => setFollowUpNoticeId((id) => (id === entry.id ? null : id)), 2500)
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      <Sidebar workspace={flow.workspace} wsColorId={flow.wsColor} active="ask" onHome={closeAsk} />
      {active && (
        <HistoryRail
          history={history}
          activeId={activeId}
          onSelect={setActiveId}
          onNew={() => setActiveId(null)}
        />
      )}
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 40px 40px', boxSizing: 'border-box' }}>
        {active ? (
          <ConversationView
            entry={active}
            loading={loading}
            checked={checked}
            onToggleCheck={toggleChecked}
            onOpenNote={openMeeting}
            onRegenerate={() => void submit(active.question)}
            onCopy={() => copyAnswer(active)}
            copied={copiedId === active.id}
            onFollowUp={() => sendFollowUp(active)}
            followUpNotice={followUpNoticeId === active.id}
            onAskFollowUp={(text) => void submit(text)}
            input={input}
            onInputChange={setInput}
            scope={scope}
            onScopeChange={setScope}
            meetings={meetings}
            onSubmit={() => void submit(input)}
          />
        ) : (
          <ChatHome
            history={history}
            showAllRecent={showAllRecent}
            onToggleShowAll={() => setShowAllRecent((v) => !v)}
            onSelectHistory={setActiveId}
            input={input}
            onInputChange={setInput}
            scope={scope}
            onScopeChange={setScope}
            meetings={meetings}
            onSubmit={() => void submit(input)}
            onRecipe={(text) => void submit(text)}
            loading={loading}
          />
        )}
        {error && (
          <p className="error-text" style={{ maxWidth: 640, margin: '16px auto 0' }}>
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
