import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@renderer/store'
import { Button } from '@renderer/ui/Button'
import { dIcon } from '@renderer/ui/chrome'
import { S, PLATFORM_LABEL } from '@renderer/strings'
import { loadFlow, saveFlow } from '@renderer/onboarding/state'
import { groupCaptions } from '@renderer/lib/captions'
import { formatRelativeDate } from '@renderer/lib/dates'
import { Sidebar } from '@renderer/components/Sidebar'
import type { MeetingListItem, SummaryStatus } from '@shared/domain'

// Home = paso 9 del kit (sidebar + dos estados) FUSIONADO con la lógica real
// que ya existía: banner de reunión detectada, start/stop, estados de
// reconexión y transcript en vivo. Mismo store, mismos eventos IPC.
//
// Los DOS estados del handoff v4 (IMPLEMENTACION-HOME-CHAT-TEMAS.md §2) se
// deciden por datos reales, no por un toggle de demo:
//   Estado A (vacío)      → meetings.length === 0
//   Estado B (con notas)  → meetings.length > 0
// El hero "Siguiente reunión · IN 25 MIN" del mock asume calendario (fecha,
// asistentes, countdown) — no existe todavía (queda para la fase de
// calendario). Mientras tanto el control de captura en vivo (start/pause/
// resume/stop) ocupa ese lugar: es la única acción real de "próxima nota".

const STATUS_LABEL: Record<SummaryStatus, string> = {
  PENDING: 'Summarizing…',
  PROCESSING: 'Summarizing…',
  DONE: 'Note ready',
  FAILED: 'Summary failed',
}

function MeetingRow({
  item,
  onOpen,
}: {
  item: MeetingListItem
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div className="home-meeting-row" onClick={onOpen}>
      <span className="home-meeting-icon">
        {dIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'])}
      </span>
      <span className="home-meeting-info">
        <span className="home-meeting-title">{item.title || 'Untitled meeting'}</span>
        <span className="home-meeting-meta">
          {PLATFORM_LABEL[item.platform]} · {formatRelativeDate(item.startedAt)}
        </span>
      </span>
      {item.summaryStatus && (
        <span className={`detail-badge detail-badge-${item.summaryStatus.toLowerCase()}`}>
          {STATUS_LABEL[item.summaryStatus]}
        </span>
      )}
    </div>
  )
}

/** Panel punteado "See your meetings here" (Estado A) — la feature de
 *  calendario real no existe todavía; el click guarda la elección (mismo
 *  patrón que el onboarding, StepCalendar) y el panel se oculta. */
function CalendarTeaser({
  onPicked,
}: {
  onPicked: (provider: string) => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  const pick = (provider: string): void => {
    setPicked(provider)
    onPicked(provider)
  }
  return (
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
        {S.home.calendarTeaserTitle}
      </span>
      <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', maxWidth: 280 }}>
        {S.home.calendarTeaserSub}
      </span>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Button variant="secondary" size="sm" onClick={() => pick(S.calendar.google)}>
          {S.calendar.google}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => pick(S.calendar.outlook)}>
          {S.calendar.outlook}
        </Button>
      </div>
      <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', marginTop: 2 }}>
        {picked ? S.calendar.comingSoon : S.home.calendarTeaserRescue}
      </span>
    </div>
  )
}

export function Home(): React.JSX.Element {
  const {
    session,
    captions,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
    detectedMeeting,
    setDetectedMeeting,
    openMeeting,
    openAsk,
    openSettings,
  } = useApp()
  const bottomRef = useRef<HTMLDivElement>(null)
  const flow = useMemo(loadFlow, [])
  const [calendarLinked, setCalendarLinked] = useState(!!flow.calendar)
  const today = new Date()

  const [meetings, setMeetings] = useState<MeetingListItem[]>([])
  const [meetingsLoaded, setMeetingsLoaded] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [captions.length])

  useEffect(() => {
    // v1: solo la primera página (más recientes primero, hasta 20). Sin
    // "load more" todavía — se agrega cuando alguien de verdad la necesite.
    void window.uyari.meetings
      .list()
      .then((page) => setMeetings(page.items))
      .catch(() => {
        // Backend caído o sin sesión: el Home sigue usable sin historial.
      })
      .finally(() => setMeetingsLoaded(true))
  }, [])

  const paused = session?.status === 'paused'
  const active =
    session?.status === 'recording' ||
    session?.status === 'reconnecting' ||
    session?.status === 'starting' ||
    paused
  const reconnecting = session?.status === 'reconnecting'
  const preparingMic = session?.status === 'starting'
  const showEmptyState = !session && captions.length === 0 && meetingsLoaded && meetings.length === 0

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      <Sidebar workspace={flow.workspace} wsColorId={flow.wsColor} active="home" onAsk={openAsk} onSettings={openSettings} />
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

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 18px' }}>
            <h1
              style={{
                font: 'var(--display-md)',
                fontSize: 28,
                color: 'var(--text-heading)',
                margin: 0,
              }}
            >
              {active ? (
                <>
                  <span className={paused ? 'rec-dot rec-dot-paused' : 'rec-dot'} />
                  {session?.title}
                </>
              ) : meetings.length > 0 ? (
                today.toLocaleDateString('en-US', { weekday: 'long' })
              ) : (
                S.home.comingUp
              )}
            </h1>
            {!active && meetings.length > 0 && (
              <span style={{ font: 'var(--text-sm)', fontWeight: 400, color: 'var(--ink-4)' }}>
                {today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
              </span>
            )}
          </div>

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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Card papel — el violeta queda en el icon well, nunca fondo dominante. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: 'var(--surface-card)',
                border: '1px solid var(--border)',
                borderRadius: 18,
                padding: 14,
                boxShadow: 'var(--shadow-card)',
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
                  {active
                    ? paused
                      ? S.home.paused
                      : preparingMic
                        ? S.home.micStarting
                        : S.home.recording
                    : S.home.firstNoteSub}
                </span>
              </span>
              {active ? (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void (paused ? resumeCapture() : pauseCapture())}
                  >
                    {paused ? S.home.resume : S.home.pause}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void stopCapture()}>
                    {S.home.stop}
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => void startCapture()}>
                  {S.home.startCapture}
                </Button>
              )}
            </div>

            {/* Estado A: sin notas ni reuniones — panel de calendario. */}
            {showEmptyState && !calendarLinked && (
              <CalendarTeaser
                onPicked={(provider) => {
                  saveFlow({ ...flow, calendar: provider })
                  // Deja ver la confirmación "coming soon" antes de ocultar
                  // el panel (mismo ritmo que StepCalendar en onboarding).
                  setTimeout(() => setCalendarLinked(true), 900)
                }}
              />
            )}
          </div>

          {/* Estado B: con notas — lista de reuniones recientes con estado. */}
          {meetings.length > 0 && (
            <div className="home-meetings">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  margin: '26px 0 2px',
                }}
              >
                <span
                  style={{
                    font: 'var(--eyebrow)',
                    letterSpacing: 'var(--eyebrow-tracking)',
                    color: 'var(--ink-4)',
                  }}
                >
                  {S.home.recent}
                </span>
              </div>
              {meetings.map((item) => (
                <MeetingRow key={item.id} item={item} onOpen={() => openMeeting(item.clientSessionId)} />
              ))}
            </div>
          )}

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
