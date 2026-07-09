import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@renderer/store'
import { Button } from '@renderer/ui/Button'
import { dIcon } from '@renderer/ui/chrome'
import { Sidebar } from '@renderer/components/Sidebar'
import { loadFlow } from '@renderer/onboarding/state'
import { groupCaptions } from '@renderer/lib/captions'
import { PLATFORM_LABEL } from '@renderer/strings'
import type { CaptionSegment, MeetingDetailData, SummaryStatus } from '@shared/domain'

// Quick win #1: el resumen + action items que el backend genera al cerrar
// una reunión (worker + LLM) ya existían — nadie los podía VER en el
// desktop. Esta pantalla es ese hueco. Se abre sola al terminar una
// captura (ver store.stopCapture) y pollea mientras el resumen está
// PENDING/PROCESSING, igual que el popup de la extensión.

const POLL_MS = 3000

interface QaEntry {
  question: string
  answer?: string
  error?: boolean
  pending?: boolean
}

export function MeetingDetail({ clientSessionId }: { clientSessionId: string }): React.JSX.Element {
  const closeMeeting = useApp((s) => s.closeMeeting)
  const flow = useMemo(loadFlow, [])

  const [meeting, setMeeting] = useState<MeetingDetailData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showTranscript, setShowTranscript] = useState(true)
  const [copied, setCopied] = useState(false)
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle')
  const [question, setQuestion] = useState('')
  const [qa, setQa] = useState<QaEntry[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async (): Promise<void> => {
      try {
        const data = await window.uyari.meetings.get(clientSessionId)
        if (cancelled) return
        setMeeting(data)
        setNotFound(false)
        setLoadError('')
        const status = data.summary?.status
        if (status === 'PENDING' || status === 'PROCESSING') {
          timer = setTimeout(() => void load(), POLL_MS)
        }
      } catch (err) {
        if (cancelled) return
        // El error cruza el borde de IPC como Error genérico (se pierde el
        // status HTTP tipado de ApiError) — el texto es lo único que queda.
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('404')) setNotFound(true)
        else setLoadError(message)
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [clientSessionId])

  const askUyari = async (): Promise<void> => {
    const q = question.trim()
    if (!q) return
    setQuestion('')
    setQa((list) => [...list, { question: q, pending: true }])
    try {
      const { answer } = await window.uyari.meetings.ask(clientSessionId, q)
      setQa((list) => list.map((e) => (e === list[list.length - 1] ? { question: q, answer } : e)))
    } catch {
      setQa((list) =>
        list.map((e) => (e === list[list.length - 1] ? { question: q, error: true } : e)),
      )
    }
  }

  const shareLink = async (): Promise<void> => {
    setShareState('sharing')
    try {
      const { url } = await window.uyari.meetings.share(clientSessionId)
      await navigator.clipboard.writeText(url)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 2000)
    } catch {
      setShareState('error')
      setTimeout(() => setShareState('idle'), 2500)
    }
  }

  const copyTranscript = async (): Promise<void> => {
    if (!meeting) return
    const text = groupCaptions(toCaptions(meeting.segments))
      .map((g) => `${g.speaker ? `${g.speaker}: ` : ''}${g.texts.join(' ')}`)
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      <Sidebar workspace={flow.workspace} wsColorId={flow.wsColor} active="home" />
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 40px 48px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <button className="detail-back" onClick={closeMeeting}>
            {dIcon('M15 18l-6-6 6-6', 2, 14)}
            Home
          </button>

          {notFound && (
            <p className="detail-empty">
              No hay datos guardados para esta reunión — puede que se haya cerrado antes de
              transcribir nada.
            </p>
          )}
          {loadError && <p className="error-text">{loadError}</p>}

          {meeting && (
            <>
              <div className="detail-header">
                <div className="detail-header-top">
                  <h1 className="detail-title">{meeting.title || 'Untitled meeting'}</h1>
                  {meeting.summary?.status === 'DONE' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={shareState === 'sharing'}
                      onClick={() => void shareLink()}
                    >
                      {shareState === 'copied'
                        ? 'Link copied ✓'
                        : shareState === 'sharing'
                          ? 'Creating…'
                          : shareState === 'error'
                            ? 'Try again'
                            : 'Share'}
                    </Button>
                  )}
                </div>
                <div className="detail-meta">
                  <span className="detail-tag">{PLATFORM_LABEL[meeting.platform]}</span>
                  <span>{new Date(meeting.startedAt).toLocaleString()}</span>
                  {meeting.summary && <StatusBadge status={meeting.summary.status} />}
                </div>
              </div>

              <SummaryPanel summary={meeting.summary} />

              <div className="detail-section">
                <div className="detail-section-head">
                  <button className="detail-toggle" onClick={() => setShowTranscript((v) => !v)}>
                    {showTranscript ? 'Hide transcript' : 'Show transcript'}
                  </button>
                  {meeting.segments.length > 0 && (
                    <button className="detail-toggle" onClick={() => void copyTranscript()}>
                      {copied ? 'Copied' : 'Copy transcript'}
                    </button>
                  )}
                </div>
                {showTranscript &&
                  (meeting.segments.length === 0 ? (
                    <p className="detail-empty">No transcript was captured for this meeting.</p>
                  ) : (
                    <div className="detail-transcript">
                      {groupCaptions(toCaptions(meeting.segments)).map((g) => (
                        <div className="detail-line" key={g.key}>
                          {g.speaker && (
                            <span
                              className={
                                g.speaker === 'You' ? 'detail-speaker detail-speaker-you' : 'detail-speaker'
                              }
                            >
                              {g.speaker}
                            </span>
                          )}
                          <div className="detail-bubble">{g.texts.join(' ')}</div>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>

              <div className="detail-section">
                <p className="detail-section-title">Ask Uyari</p>
                {qa.length > 0 && (
                  <div className="detail-qa">
                    {qa.map((e, idx) => (
                      <div className="detail-qa-entry" key={idx}>
                        <div className="detail-line">
                          <span className="detail-speaker detail-speaker-you">You</span>
                          <div className="detail-bubble">{e.question}</div>
                        </div>
                        <div className="detail-line">
                          <span className="detail-speaker">Uyari</span>
                          <div className="detail-bubble">
                            {e.pending ? '…' : e.error ? "Couldn't get an answer, try again." : e.answer}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="detail-ask-bar">
                  <input
                    className="detail-ask-input"
                    placeholder="Ask about this meeting…"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void askUyari()}
                  />
                  <Button size="sm" disabled={!question.trim()} onClick={() => void askUyari()}>
                    Ask
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function StatusBadge({ status }: { status: SummaryStatus }): React.JSX.Element {
  const label: Record<SummaryStatus, string> = {
    PENDING: 'Summarizing…',
    PROCESSING: 'Summarizing…',
    DONE: 'Summarized',
    FAILED: 'Summary failed',
  }
  return <span className={`detail-badge detail-badge-${status.toLowerCase()}`}>{label[status]}</span>
}

function SummaryPanel({ summary }: { summary: MeetingDetailData['summary'] }): React.JSX.Element {
  if (!summary) {
    return <p className="detail-empty">This meeting has no summary yet.</p>
  }
  if (summary.status === 'PENDING' || summary.status === 'PROCESSING') {
    return <p className="detail-empty">Generating your summary…</p>
  }
  if (summary.status === 'FAILED') {
    return (
      <p className="error-text">{summary.error || "We couldn't generate a summary this time."}</p>
    )
  }
  return (
    <div className="detail-summary">
      {summary.content && <p className="detail-summary-text">{summary.content}</p>}
      {summary.actionItems && summary.actionItems.length > 0 && (
        <ul className="detail-action-items">
          {summary.actionItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** El shape del backend (speaker?: string|null) → el de CaptionSegment. */
function toCaptions(segments: MeetingDetailData['segments']): CaptionSegment[] {
  return segments.map((s) => ({
    providerMessageId: s.providerMessageId,
    speaker: s.speaker ?? undefined,
    text: s.text,
    tsOffsetMs: s.tsOffsetMs,
  }))
}
