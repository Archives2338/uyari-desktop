import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApp } from '@renderer/store'
import { dIcon } from '@renderer/ui/chrome'
import { S } from '@renderer/strings'
import { loadFlow } from '@renderer/onboarding/state'
import { Sidebar } from '@renderer/components/Sidebar'
import {
  loadAskThreads,
  createAskThread,
  appendAskTurn,
  replaceAskTurn,
  type AskThread,
  type AskTurn,
} from '@renderer/lib/askHistory'
import { dayBucketLabel, formatRelativeDate, formatTimeAgo } from '@renderer/lib/dates'
import type { MeetingListItem } from '@shared/domain'
import flameIcon from '@renderer/assets/uyari-flame-violet.svg'

// "Pregúntale a Uyari" — módulo de chat global. Fuente de verdad VISUAL:
// design_handoff_uyari 4/ui_kits/desktop/explorations-chat.html (CH1+CH2)
// — no Flow.js.txt/Flow2.js.txt, que son el controlador del ONBOARDING,
// no el chat (confundible por el nombre "Flow").
//
// Modelo de datos: un THREAD con TURNOS (patrón chat_thread/chat_message
// de Granola, RE en os/granola-desktop.md §1b — un solo motor de chat, un
// follow-up es el turno N+1 del MISMO hilo). Antes cada pregunta creaba
// una entrada de historial suelta — un usuario cazó el bug probando: un
// follow-up abría un chat nuevo en vez de continuar la conversación.
// Además de agrupar visualmente, el backend ahora recibe los turnos
// previos como contexto (`history` en askAll) — sin eso, agrupar sería
// solo cosmético: un follow-up como "¿quiénes participaron?" no sabría a
// qué se refiere "esa reunión" sin ver la pregunta anterior.
//
// Las tarjetas de cita SON reales: el LLM declara de qué reuniones sacó
// la respuesta (ver ASK_ALL_SYSTEM_PROMPT en el backend) y la UI solo
// pinta esas — nunca inventa una fuente. El historial se persiste LOCAL
// (localStorage, ver lib/askHistory.ts): el backend no tiene tablas de
// conversación todavía, así que no sincroniza entre devices.
//
// Deliberadamente NO incluido: "Ver todas ›" de Recetas (solo hay 4, no
// hay una librería más grande detrás que revelar). "Adjuntar" y el mic sí
// se dejan (están en el mock) pero como affordance con "Coming soon" —
// ninguna feature de adjuntos/dictado existe, y así queda dicho, no mudo.

const RECIPE_ICONS: Array<string | string[]> = [
  ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  ['M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M16 2v4M8 2v4M3 10h18'],
  ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm3 7 9 6 9-6'],
]
const MAIL_ICON = ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm3 7 9 6 9-6']
const COPY_ICON = [
  'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z',
  'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
]
const REGENERATE_ICON = ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10']
const ATTACH_ICON =
  'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48'
const MIC_ICON = ['M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z', 'M19 10v1a7 7 0 0 1-14 0v-1', 'M12 18v4']

/** "jesus.rojas@…" → "Jesus". Aproximación honesta: no hay un campo de
 *  nombre real en el perfil (el onboarding solo pide workspace/equipo). */
function deriveDisplayName(email?: string): string | undefined {
  if (!email) return undefined
  const local = email.split('@')[0]?.split(/[._-]/)[0]
  if (!local) return undefined
  return local.charAt(0).toUpperCase() + local.slice(1)
}

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

function groupThreadsByDay(threads: AskThread[]): Array<[string, AskThread[]]> {
  const map = new Map<string, AskThread[]>()
  for (const t of threads) {
    const bucket = dayBucketLabel(t.updatedAt)
    const label = bucket === 'Today' ? S.ask.todayGroup : bucket === 'Yesterday' ? S.ask.yesterdayGroup : bucket
    const list = map.get(label)
    if (list) list.push(t)
    else map.set(label, [t])
  }
  return [...map.entries()]
}

function ScopeSelect({
  scope,
  onChange,
  meetings,
  citedCount,
}: {
  scope: string
  onChange: (v: string) => void
  meetings: MeetingListItem[]
  /** Si el último turno tiene citas, ofrece "N meetings" acotado a esas
   *  fuentes — el "2 reuniones ▾" del mock, pero funcional de verdad. */
  citedCount?: number
}): React.JSX.Element {
  return (
    <div className="ask-scope-wrap">
      <select className="ask-scope-select" value={scope} onChange={(e) => onChange(e.target.value)}>
        {citedCount ? (
          <option value="cited">
            {citedCount} {citedCount === 1 ? 'meeting' : 'meetings'}
          </option>
        ) : null}
        <option value="all">{S.ask.scopeAll}</option>
        {meetings.map((m) => (
          <option key={m.clientSessionId} value={m.clientSessionId}>
            {m.title || 'Untitled meeting'}
          </option>
        ))}
      </select>
      <span className="ask-scope-chevron">▾</span>
    </div>
  )
}

function Composer({
  variant,
  value,
  onChange,
  onSubmit,
  scope,
  onScopeChange,
  meetings,
  citedCount,
  disabled,
}: {
  variant: 'home' | 'bottom'
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  scope: string
  onScopeChange: (v: string) => void
  meetings: MeetingListItem[]
  citedCount?: number
  disabled: boolean
}): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }
  const sendBtn = (
    <button
      className="ask-send-btn"
      onClick={onSubmit}
      disabled={disabled || !value.trim()}
      aria-label={S.ask.send}
    >
      {dIcon('M12 19V5M5 12l7-7 7 7', 2, 15)}
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
          padding: '8px 8px 8px 18px',
          boxSizing: 'border-box',
        }}
      >
        <textarea
          className="ask-textarea"
          placeholder={S.ask.bottomComposerPlaceholder}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ flex: 1, minHeight: 20, maxHeight: 20, padding: 0 }}
        />
        <ScopeSelect scope={scope} onChange={onScopeChange} meetings={meetings} citedCount={citedCount} />
        {sendBtn}
      </div>
    )
  }
  return (
    <div
      style={{
        width: '100%',
        background: 'var(--surface-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-card)',
        padding: '16px 18px',
        boxSizing: 'border-box',
      }}
    >
      <textarea
        className="ask-textarea"
        placeholder={S.ask.composerPlaceholder}
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        style={{ fontSize: 15, padding: 0 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button className="ask-pill-btn" title={S.ask.comingSoon}>
          {dIcon(ATTACH_ICON, 1.7, 13)}
          {S.ask.attach}
        </button>
        <ScopeSelect scope={scope} onChange={onScopeChange} meetings={meetings} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="ask-icon-btn" title={S.ask.comingSoon} aria-label={S.ask.mic}>
            {dIcon(MIC_ICON, 1.7, 15)}
          </button>
          {sendBtn}
        </span>
      </div>
    </div>
  )
}

function ChatHome({
  displayName,
  threads,
  showAllRecent,
  onToggleShowAll,
  onSelectThread,
  input,
  onInputChange,
  scope,
  onScopeChange,
  meetings,
  onSubmit,
  onRecipe,
  loading,
}: {
  displayName?: string
  threads: AskThread[]
  showAllRecent: boolean
  onToggleShowAll: () => void
  onSelectThread: (id: string) => void
  input: string
  onInputChange: (v: string) => void
  scope: string
  onScopeChange: (v: string) => void
  meetings: MeetingListItem[]
  onSubmit: () => void
  onRecipe: (text: string) => void
  loading: boolean
}): React.JSX.Element {
  const shown = showAllRecent ? threads : threads.slice(0, 5)
  return (
    <div
      style={{
        maxWidth: 620,
        width: '100%',
        margin: '110px auto 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <img src={flameIcon} alt="" style={{ height: 42 }} />
        <span
          style={{
            fontFamily: 'var(--font-serif-display)',
            fontSize: 36,
            fontWeight: 500,
            color: 'var(--text-heading)',
          }}
        >
          {S.ask.greeting(displayName)}
        </span>
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

      {threads.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span
              style={{ font: 'var(--eyebrow)', letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--ink-4)' }}
            >
              {S.ask.recentTitle}
            </span>
            {threads.length > 5 && (
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
                {showAllRecent ? S.ask.seeLess : `${S.ask.seeAll} +`}
              </button>
            )}
          </div>
          {shown.map((t) => (
            <div key={t.id} className="ask-recent-row" onClick={() => onSelectThread(t.id)}>
              <span className="ask-recent-icon">
                {dIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'], 1.6, 13)}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--text-heading)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.title}
              </span>
              <span style={{ marginLeft: 'auto', font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)' }}>
                {formatTimeAgo(t.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ font: 'var(--eyebrow)', letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--ink-4)', marginBottom: 8 }}>
          {S.ask.recipesTitle}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {S.ask.recipes.map((r, i) => (
            <button key={r} className="ask-chip" onClick={() => onRecipe(r)} disabled={loading}>
              {dIcon(RECIPE_ICONS[i], 1.7, 13)}
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function TurnBlock({
  turn,
  isLast,
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
}: {
  turn: AskTurn
  isLast: boolean
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
}): React.JSX.Element {
  const allActionItems = turn.citations.flatMap((c, ci) =>
    c.actionItems.map((item, ii) => ({ key: `${turn.id}:${ci}:${ii}`, item })),
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="ask-question-bubble">{turn.question}</div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <img src={flameIcon} alt="" style={{ height: 26, marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ font: 'var(--text-sm)', fontSize: 14, color: 'var(--ink)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
            {renderBold(turn.answer)}
          </div>

          {turn.citations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {turn.citations.map((c) => (
                <div key={c.clientSessionId} className="ask-citation-card">
                  <span
                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--violet)', flexShrink: 0 }}
                  />
                  <span className="ask-citation-title">
                    {c.title || 'Untitled meeting'}
                    <span className="ask-citation-meta"> · {formatRelativeDate(c.occurredAt)}</span>
                  </span>
                  <button className="ask-citation-open" onClick={() => onOpenNote(c.clientSessionId)}>
                    {S.ask.openNote}
                  </button>
                </div>
              ))}
            </div>
          )}

          {allActionItems.length > 0 && (
            <div className="ask-action-items">
              <span
                style={{ font: 'var(--eyebrow)', letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--accent-strong)' }}
              >
                {S.ask.relatedActionItems}
              </span>
              {allActionItems.map(({ key, item }) => (
                <label
                  key={key}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: 'var(--text-sm)', fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}
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
              {dIcon(COPY_ICON, 1.7, 13)}
              {copied ? S.ask.copied : S.ask.copy}
            </button>
            <button className="ask-answer-action" onClick={onFollowUp}>
              {dIcon(MAIL_ICON, 1.7, 13)}
              {S.ask.sendAsFollowUp}
            </button>
            <button className="ask-answer-action" onClick={onRegenerate} disabled={loading}>
              {dIcon(REGENERATE_ICON, 1.7, 13)}
              {S.ask.regenerate}
            </button>
          </div>
          {followUpNotice && (
            <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)' }}>{S.ask.followUpComingSoon}</span>
          )}

          {isLast && turn.followUps.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {turn.followUps.map((f) => (
                <button key={f} className="ask-chip" onClick={() => onAskFollowUp(f)} disabled={loading}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConversationView({
  thread,
  loading,
  checked,
  onToggleCheck,
  onOpenNote,
  onRegenerate,
  onCopy,
  copiedTurnId,
  onFollowUp,
  followUpNoticeTurnId,
  onAskFollowUp,
  input,
  onInputChange,
  scope,
  onScopeChange,
  meetings,
  onSubmit,
}: {
  thread: AskThread
  loading: boolean
  checked: Set<string>
  onToggleCheck: (key: string) => void
  onOpenNote: (clientSessionId: string) => void
  onRegenerate: (turn: AskTurn) => void
  onCopy: (turn: AskTurn) => void
  copiedTurnId: string | null
  onFollowUp: (turn: AskTurn) => void
  followUpNoticeTurnId: string | null
  onAskFollowUp: (text: string) => void
  input: string
  onInputChange: (v: string) => void
  scope: string
  onScopeChange: (v: string) => void
  meetings: MeetingListItem[]
  onSubmit: () => void
}): React.JSX.Element {
  const lastTurn = thread.turns[thread.turns.length - 1]
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div
        style={{
          flex: 1,
          maxWidth: 620,
          width: '100%',
          margin: '0 auto',
          padding: '40px 0 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          boxSizing: 'border-box',
        }}
      >
        {thread.turns.map((turn) => (
          <TurnBlock
            key={turn.id}
            turn={turn}
            isLast={turn.id === lastTurn.id}
            loading={loading}
            checked={checked}
            onToggleCheck={onToggleCheck}
            onOpenNote={onOpenNote}
            onRegenerate={() => onRegenerate(turn)}
            onCopy={() => onCopy(turn)}
            copied={copiedTurnId === turn.id}
            onFollowUp={() => onFollowUp(turn)}
            followUpNotice={followUpNoticeTurnId === turn.id}
            onAskFollowUp={onAskFollowUp}
          />
        ))}
      </div>

      <div style={{ maxWidth: 620, width: '100%', margin: '0 auto', padding: '10px 0 20px', boxSizing: 'border-box' }}>
        <Composer
          variant="bottom"
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          scope={scope}
          onScopeChange={onScopeChange}
          meetings={meetings}
          citedCount={lastTurn.citations.length}
          disabled={loading}
        />
      </div>
    </div>
  )
}

export function AskUyari(): React.JSX.Element {
  const closeAsk = useApp((s) => s.closeAsk)
  const openMeeting = useApp((s) => s.openMeeting)
  const auth = useApp((s) => s.auth)
  const flow = useMemo(loadFlow, [])
  const displayName = useMemo(() => deriveDisplayName(auth.email), [auth.email])

  const [threads, setThreads] = useState<AskThread[]>(() => loadAskThreads())
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [scope, setScope] = useState('all')
  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAllRecent, setShowAllRecent] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const [followUpNoticeTurnId, setFollowUpNoticeTurnId] = useState<string | null>(null)

  useEffect(() => {
    // Alimenta el selector de alcance con reuniones reales (título, id).
    void window.uyari.meetings
      .list()
      .then((page) => setMeetings(page.items))
      .catch(() => {
        // Backend caído: el chat sigue usable, solo sin narrow-by-meeting.
      })
  }, [])

  const active = threads.find((t) => t.id === activeThreadId) ?? null
  const lastTurn = active ? active.turns[active.turns.length - 1] : null

  // Alcance del composer: si el último turno citó reuniones, arranca
  // acotado a esas (el "2 reuniones ▾" del mock, pero real — no solo un
  // label). Cambiar de hilo resetea el alcance; agregar turnos al MISMO
  // hilo no lo pisa (resolveMeetingIds relee lastTurn en cada envío).
  useEffect(() => {
    setScope(active && active.turns[active.turns.length - 1].citations.length > 0 ? 'cited' : 'all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId])

  const resolveMeetingIds = (): string[] | undefined => {
    if (scope === 'cited' && lastTurn) return lastTurn.citations.map((c) => c.clientSessionId)
    if (scope === 'all' || scope === 'cited') return undefined
    return [scope]
  }

  /** Pregunta nueva: crea hilo si no hay uno abierto, si no agrega un turno
   *  al hilo activo — con los turnos previos como contexto (ver comentario
   *  de arriba: sin esto un follow-up no sabe a qué se refiere). */
  const submit = async (question: string): Promise<void> => {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setError('')
    try {
      const priorTurns = active?.turns.slice(-6).map((t) => ({ question: t.question, answer: t.answer }))
      const result = await window.uyari.meetings.askAll(q, resolveMeetingIds(), priorTurns)
      const turn: AskTurn = {
        id: crypto.randomUUID(),
        question: q,
        answer: result.answer,
        citations: result.citations,
        followUps: result.followUps,
        createdAt: new Date().toISOString(),
      }
      if (active) {
        setThreads(appendAskTurn(active.id, turn))
      } else {
        const next = createAskThread(turn)
        setThreads(next)
        setActiveThreadId(next[0].id)
      }
      setInput('')
    } catch {
      setError(S.ask.error)
    } finally {
      setLoading(false)
    }
  }

  /** Regenerar: re-pregunta lo mismo con el contexto previo a ESE turno
   *  (no el hilo completo) y lo reemplaza en su lugar. */
  const regenerateTurn = async (turn: AskTurn): Promise<void> => {
    if (!active || loading) return
    const idx = active.turns.findIndex((t) => t.id === turn.id)
    if (idx < 0) return
    setLoading(true)
    setError('')
    try {
      const priorTurns = active.turns
        .slice(0, idx)
        .slice(-6)
        .map((t) => ({ question: t.question, answer: t.answer }))
      const result = await window.uyari.meetings.askAll(turn.question, resolveMeetingIds(), priorTurns)
      const updated: AskTurn = {
        ...turn,
        answer: result.answer,
        citations: result.citations,
        followUps: result.followUps,
      }
      setThreads(replaceAskTurn(active.id, updated))
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

  const copyTurn = (turn: AskTurn): void => {
    void navigator.clipboard.writeText(turn.answer)
    setCopiedTurnId(turn.id)
    setTimeout(() => setCopiedTurnId((id) => (id === turn.id ? null : id)), 1500)
  }

  // Sin integración de email/Slack todavía: affordance real de roadmap con
  // aviso, no un botón mudo (mismo patrón que el panel de calendario).
  const sendFollowUp = (turn: AskTurn): void => {
    setFollowUpNoticeTurnId(turn.id)
    setTimeout(() => setFollowUpNoticeTurnId((id) => (id === turn.id ? null : id)), 2500)
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      <Sidebar
        workspace={flow.workspace}
        wsColorId={flow.wsColor}
        active="ask"
        onHome={closeAsk}
        askHistory={
          active
            ? {
                groups: groupThreadsByDay(threads).map(([label, list]) => [
                  label,
                  list.map((t) => ({ id: t.id, question: t.title })),
                ]),
                activeId: activeThreadId,
                onSelect: setActiveThreadId,
              }
            : undefined
        }
      />
      <main style={{ flex: 1, overflowY: 'auto', padding: '0 40px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {active ? (
          <ConversationView
            thread={active}
            loading={loading}
            checked={checked}
            onToggleCheck={toggleChecked}
            onOpenNote={openMeeting}
            onRegenerate={(turn) => void regenerateTurn(turn)}
            onCopy={copyTurn}
            copiedTurnId={copiedTurnId}
            onFollowUp={sendFollowUp}
            followUpNoticeTurnId={followUpNoticeTurnId}
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
            displayName={displayName}
            threads={threads}
            showAllRecent={showAllRecent}
            onToggleShowAll={() => setShowAllRecent((v) => !v)}
            onSelectThread={setActiveThreadId}
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
          <p className="error-text" style={{ maxWidth: 620, margin: '16px auto 0', width: '100%' }}>
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
