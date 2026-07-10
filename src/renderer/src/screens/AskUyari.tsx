import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
// entregas/chat-pensando/Chat.js.txt + CAMBIOS-CHAT-PENSANDO.md (10 jul,
// segunda pasada — reemplaza el layout de explorations-chat.html en dos
// puntos concretos: la flama deja de acompañar cada respuesta y pasa a
// ser una FIRMA al final (FlameSign, con hover/click), y el indicador de
// "pensando" tiene palabras rotando + flama pulsante, estilo Claude Code.
//
// Modelo de datos (sin cambios en esta pasada): un THREAD con TURNOS
// (patrón chat_thread/chat_message de Granola, RE en
// os/granola-desktop.md §1b). Las tarjetas de cita SON reales — el LLM
// declara de qué reuniones sacó la respuesta, la UI solo pinta esas. El
// historial se persiste LOCAL (localStorage): el backend no tiene tablas
// de conversación todavía.
//
// Cambios de esta pasada vs la anterior: el panel de action items pasa a
// ser una lista DECORATIVA (checkbox falso, sin estado — igual que el
// mock; no había persistencia real detrás de mi versión "interactiva"
// tampoco, así que esto es una simplificación honesta, no una regresión).
// "Adjuntar"/mic se sacan del composer (el mock ya no los tiene). "Ver
// todas ›" de Recetas vuelve, con aviso "Coming soon" — visualmente
// completo, sin fingir una librería de recetas que no existe.

const RECIPE_ICONS: Array<string | string[]> = [
  ['M9 11l3 3 8-8', 'M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11'],
  ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  ['M8 2v4M16 2v4', 'M3 8h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm3 7 9 6 9-6'],
]
const SEND_ICON = ['M12 19V5', 'm5 12 7-7 7 7']
const COPY_ICON = [
  'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z',
  'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
]
const MAIL_ICON = ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm3 7 9 6 9-6']
const REGENERATE_ICON = ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10']

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

/** El glifo de flama vía CSS mask (no <img>): se colorea con
 *  --accent-strong y sigue el tema automáticamente (violeta en light,
 *  lila en dark), a diferencia del SVG suelto que trae su violeta fijo. */
function Flame({ size = 42, className }: { size?: number; className?: string }): React.JSX.Element {
  const mask: CSSProperties = {
    WebkitMaskImage: `url(${flameIcon})`,
    WebkitMaskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskImage: `url(${flameIcon})`,
    maskSize: 'contain',
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
  }
  return (
    <span
      className={className}
      style={{ width: size, height: size, display: 'inline-block', flexShrink: 0, background: 'var(--accent-strong)', ...mask }}
    />
  )
}

/** Firma al final de la última respuesta (patrón Claude): hover revela un
 *  saludo, click hace un squish con rebote. Puramente de personalidad —
 *  no navega a nada. */
function FlameSign(): React.JSX.Element {
  const [press, setPress] = useState(false)
  const [hello, setHello] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 6 }}>
      <span
        className="ask-flame-sign-btn"
        onMouseDown={() => setPress(true)}
        onMouseUp={() => setPress(false)}
        onMouseLeave={() => {
          setPress(false)
          setHello(false)
        }}
        onMouseEnter={() => setHello(true)}
        onClick={() => setHello(true)}
        style={{ transform: press ? 'scale(0.78)' : hello ? 'scale(1.08)' : 'scale(1)' }}
      >
        <Flame size={30} />
      </span>
      <span
        className="ask-flame-sign-hello"
        style={{ opacity: hello ? 1 : 0, transform: hello ? 'none' : 'translateX(-4px)' }}
      >
        {S.ask.flameHello}
      </span>
    </div>
  )
}

/** Indicador "pensando" (estilo Claude Code): flama pulsante + palabras
 *  rotando cada 1.4s + puntos 0→3 cada 350ms en un span de ancho fijo
 *  para que el texto no baile. */
function Thinking(): React.JSX.Element {
  const [idx, setIdx] = useState(0)
  const [dots, setDots] = useState(0)
  useEffect(() => {
    const w = setInterval(() => setIdx((i) => (i + 1) % S.ask.thinkingWords.length), 1400)
    const d = setInterval(() => setDots((n) => (n + 1) % 4), 350)
    return () => {
      clearInterval(w)
      clearInterval(d)
    }
  }, [])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <Flame size={22} className="ask-flame-pulse" />
      <span style={{ font: 'var(--text-sm)', fontStyle: 'italic', color: 'var(--text-muted)' }}>
        {S.ask.thinkingWords[idx]}
        <span style={{ display: 'inline-block', width: 18, textAlign: 'left' }}>{'.'.repeat(dots)}</span>
      </span>
    </div>
  )
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
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }
  const input = (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={variant === 'home' ? S.ask.composerPlaceholder : S.ask.bottomComposerPlaceholder}
      style={{
        flex: '1 1 100%',
        order: variant === 'bottom' ? 0 : -1,
        minWidth: 0,
        font: 'var(--text-sm)',
        fontSize: variant === 'bottom' ? 14 : 15,
        color: 'var(--ink)',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        padding: variant === 'bottom' ? 0 : '2px 2px 12px',
      }}
    />
  )
  const sendBtn = (
    <button
      className="ask-send-btn"
      onClick={onSubmit}
      disabled={disabled || !value.trim()}
      aria-label={S.ask.send}
    >
      {dIcon(SEND_ICON, 2, 15)}
    </button>
  )
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: variant === 'bottom' ? 'var(--radius-pill)' : 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: variant === 'bottom' ? '8px 8px 8px 16px' : '14px 16px',
        flexWrap: variant === 'bottom' ? 'nowrap' : 'wrap',
        boxSizing: 'border-box',
      }}
    >
      {input}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: variant === 'bottom' ? 0 : 'auto' }}>
        <ScopeSelect scope={scope} onChange={onScopeChange} meetings={meetings} citedCount={citedCount} />
        {sendBtn}
      </span>
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
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          width: 620,
          maxWidth: '88%',
          marginTop: 'clamp(40px, 14vh, 130px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          paddingBottom: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Flame size={42} />
          <span style={{ font: 'var(--display-md)', fontSize: 34, color: 'var(--text-heading)' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {S.ask.recipes.map((r, i) => (
              <button key={r} className="ask-chip" onClick={() => onRecipe(r)} disabled={loading}>
                {dIcon(RECIPE_ICONS[i], 1.7, 13)}
                {r}
              </button>
            ))}
            <button className="ask-chip" title={S.ask.comingSoon}>
              {S.ask.seeAllRecipes}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TurnBlock({
  turn,
  isLast,
  isRegenerating,
  loading,
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
  isRegenerating: boolean
  loading: boolean
  onOpenNote: (clientSessionId: string) => void
  onRegenerate: () => void
  onCopy: () => void
  copied: boolean
  onFollowUp: () => void
  followUpNotice: boolean
  onAskFollowUp: (text: string) => void
}): React.JSX.Element {
  if (isRegenerating) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="ask-question-bubble">{turn.question}</div>
        <Thinking />
      </div>
    )
  }
  const allActionItems = turn.citations.flatMap((c) => c.actionItems)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div className="ask-question-bubble">{turn.question}</div>

      <div style={{ font: 'var(--text-sm)', fontSize: 14, lineHeight: 1.65, color: 'var(--text-heading)' }}>
        {renderBold(turn.answer)}
      </div>

      {turn.citations.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {turn.citations.map((c) => (
            <div key={c.clientSessionId} className="ask-citation-card">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--violet)', flexShrink: 0 }} />
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
          <span style={{ font: 'var(--eyebrow)', fontSize: 10, letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--accent-strong)' }}>
            {S.ask.relatedActionItems.toUpperCase()}
          </span>
          {allActionItems.map((item, i) => (
            <span
              key={i}
              style={{ display: 'flex', gap: 9, alignItems: 'flex-start', font: 'var(--text-sm)', fontSize: 13, color: 'var(--text-heading)' }}
            >
              <span className="ask-action-item-box" />
              {item}
            </span>
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
      {followUpNotice && <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)' }}>{S.ask.followUpComingSoon}</span>}

      {isLast && turn.followUps.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {turn.followUps.map((f) => (
            <button key={f} className="ask-chip" onClick={() => onAskFollowUp(f)} disabled={loading}>
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ConversationView({
  thread,
  pendingQuestion,
  regeneratingTurnId,
  loading,
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
  /** null = todavía no hay hilo persistido (primera pregunta en vuelo). */
  thread: AskThread | null
  /** Pregunta nueva en vuelo para ESTE hilo (o para uno por crear). */
  pendingQuestion: string | null
  regeneratingTurnId: string | null
  loading: boolean
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const turns = thread?.turns ?? []
  const lastTurn = turns[turns.length - 1]
  const isThinking = pendingQuestion !== null || regeneratingTurnId !== null

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns.length, pendingQuestion, regeneratingTurnId])

  return (
    <>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ width: 620, maxWidth: '88%', margin: '0 auto', padding: '44px 0 10px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {turns.map((turn) => (
            <TurnBlock
              key={turn.id}
              turn={turn}
              isLast={turn.id === lastTurn.id}
              isRegenerating={regeneratingTurnId === turn.id}
              loading={loading}
              onOpenNote={onOpenNote}
              onRegenerate={() => onRegenerate(turn)}
              onCopy={() => onCopy(turn)}
              copied={copiedTurnId === turn.id}
              onFollowUp={() => onFollowUp(turn)}
              followUpNotice={followUpNoticeTurnId === turn.id}
              onAskFollowUp={onAskFollowUp}
            />
          ))}
          {pendingQuestion !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="ask-question-bubble">{pendingQuestion}</div>
              <Thinking />
            </div>
          )}
          {!isThinking && turns.length > 0 && <FlameSign />}
        </div>
      </div>
      <div style={{ width: 620, maxWidth: '88%', margin: '0 auto', padding: '10px 0 18px', alignSelf: 'center', flexShrink: 0, boxSizing: 'border-box' }}>
        <Composer
          variant="bottom"
          value={input}
          onChange={onInputChange}
          onSubmit={onSubmit}
          scope={scope}
          onScopeChange={onScopeChange}
          meetings={meetings}
          citedCount={lastTurn?.citations.length ?? 0}
          disabled={loading}
        />
      </div>
    </>
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
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const [followUpNoticeTurnId, setFollowUpNoticeTurnId] = useState<string | null>(null)
  // Estado optimista: la pregunta aparece al toque, el flame late hasta
  // que la respuesta real llega (ver Thinking). Sin esto un click en un
  // follow-up se siente "muerto" — nada cambia hasta que todo el turno
  // aparece de golpe.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [regeneratingTurnId, setRegeneratingTurnId] = useState<string | null>(null)

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
   *  al hilo activo — con los turnos previos como contexto (sin esto un
   *  follow-up no sabe a qué se refiere "esa reunión"). */
  const submit = async (question: string): Promise<void> => {
    const q = question.trim()
    if (!q || loading) return
    setLoading(true)
    setError('')
    setPendingQuestion(q) // optimista: se pinta antes de que llegue la respuesta
    setInput('')
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
    } catch {
      setError(S.ask.error)
    } finally {
      setLoading(false)
      setPendingQuestion(null)
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
    setRegeneratingTurnId(turn.id)
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
      setRegeneratingTurnId(null)
    }
  }

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

  const showConversation = active !== null || pendingQuestion !== null

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
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {showConversation ? (
          <ConversationView
            thread={active}
            pendingQuestion={pendingQuestion}
            regeneratingTurnId={regeneratingTurnId}
            loading={loading}
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
          <p className="error-text" style={{ maxWidth: 620, margin: '16px auto 0', width: '100%', flexShrink: 0 }}>
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
