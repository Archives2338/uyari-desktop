import { useEffect, useRef } from 'react'
import { useApp } from '@renderer/store'
import type { CaptionSegment } from '@shared/domain'

// El STT emite un "turn" por cada pausa corta, lo que produce burbujas de
// una frase. Para leerse como conversación, agrupamos turnos consecutivos
// del mismo hablante en un bloque, cortando solo ante una pausa larga o
// cuando el bloque ya es muy largo.
const GROUP_MAX_GAP_MS = 20_000
const GROUP_MAX_CHARS = 500

interface CaptionGroup {
  key: string
  speaker?: string
  texts: string[]
}

function groupCaptions(captions: CaptionSegment[]): CaptionGroup[] {
  const groups: CaptionGroup[] = []
  let lastOffset = 0
  let lastChars = 0
  for (const c of captions) {
    const prev = groups[groups.length - 1]
    const sameSpeaker = prev && prev.speaker === c.speaker
    const closeInTime = c.tsOffsetMs - lastOffset <= GROUP_MAX_GAP_MS
    if (prev && sameSpeaker && closeInTime && lastChars < GROUP_MAX_CHARS) {
      prev.texts.push(c.text)
      lastChars += c.text.length
    } else {
      groups.push({ key: c.providerMessageId, speaker: c.speaker, texts: [c.text] })
      lastChars = c.text.length
    }
    lastOffset = c.tsOffsetMs
  }
  return groups
}

export function Home(): React.JSX.Element {
  const { session, captions, startCapture, stopCapture, detectedMeeting, setDetectedMeeting } =
    useApp()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [captions.length])

  const active = session?.status === 'recording' || session?.status === 'reconnecting'
  const reconnecting = session?.status === 'reconnecting'

  return (
    <div className="home">
      <aside className="sidebar">
        <div className="sidebar-item active">Home</div>
        <div className="sidebar-item">Shared with me</div>
        <div className="sidebar-item">Chat</div>
        <div className="sidebar-footer">Uyari · dev build</div>
      </aside>

      <main className="main-pane">
        {detectedMeeting && !session && (
          <div className="meeting-banner">
            <span>
              <strong>{detectedMeeting}</strong> seems to be in a meeting.
            </span>
            <button
              className="btn btn-accent"
              onClick={() => void startCapture(`${detectedMeeting} meeting`)}
            >
              Start recording
            </button>
            <button className="btn btn-ghost" onClick={() => setDetectedMeeting(null)}>
              Dismiss
            </button>
          </div>
        )}
        <p className="eyebrow">Coming up</p>
        <h1 className="title" style={{ fontSize: 28 }}>
          {active ? (
            <>
              <span className="rec-dot" />
              {session?.title}
            </>
          ) : (
            'Your meetings will appear here'
          )}
        </h1>

        {reconnecting && (
          <p className="reconnect-note">
            Reconnecting to transcription… audio keeps being captured, nothing is lost.
          </p>
        )}
        {session?.status === 'recording' && session.statusDetail && (
          <p className="reconnect-note">{session.statusDetail}</p>
        )}

        {active ? (
          <button className="btn" onClick={() => void stopCapture()}>
            Finish &amp; summarize
          </button>
        ) : (
          <button className="btn btn-accent" onClick={() => void startCapture()}>
            Start capture
          </button>
        )}
        {session?.status === 'error' && (
          <p className="error-text">
            {session.statusDetail ?? 'Capture failed'} —{' '}
            <button className="btn btn-ghost" onClick={() => void stopCapture()}>
              Dismiss
            </button>
          </p>
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
      </main>
    </div>
  )
}
