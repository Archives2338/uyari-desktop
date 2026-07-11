import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useApp } from '@renderer/store'
import { dIcon } from '@renderer/ui/chrome'
import { groupCaptions } from '@renderer/lib/captions'
import { NotesEditor } from '@renderer/components/NotesEditor'
import type { CaptionSegment, MeetingDetailData } from '@shared/domain'
import { AudioBars } from './AudioBars'
import { LiveDock, type DockLine } from './LiveDock'
import { NOTE_RECIPES, slashIcon } from './ask-common'
import { aiStar } from './NoteTabs'
import { useAsk } from './useAsk'
import { AskPopover } from './AskPopover'
import { AskSheet } from './AskSheet'
import { CmdPalette } from './CmdPalette'
import { NoteTabs, type NoteTab } from './NoteTabs'
import { EnhancedPanel, summaryStatus } from './EnhancedPanel'

// Módulo de nota — NT1-B unificado (N5b): la MISMA nota vive de principio a fin
// (modelo de documento único de Granola). Dos modos:
//   • VIVO  (session activa): captura, transcript en vivo, editor de notas.
//   • PASADO (openMeetingId): reunión terminada cargada del backend + el tab
//     "Notas de Uyari" (panel Enhanced Notes). Sin píldora de captura.
// El transcript va al dock lateral (N2); el chat en 3 niveles (N3/N4).

const BODY_PLACEHOLDER = 'Escribe — Uyari completa el resto al terminar…'

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type AskView = null | 'pop' | 'sheet' | 'palette'

export function NoteScreen({ pastId }: { pastId?: string }): React.JSX.Element {
  const isPast = !!pastId
  const session = useApp((s) => s.session)
  const captions = useApp((s) => s.captions)
  const pauseCapture = useApp((s) => s.pauseCapture)
  const resumeCapture = useApp((s) => s.resumeCapture)
  const stopCapture = useApp((s) => s.stopCapture)
  const minimizeNote = useApp((s) => s.minimizeNote)
  const closeMeeting = useApp((s) => s.closeMeeting)

  const clientSessionId = pastId ?? session?.clientSessionId ?? ''
  const paused = session?.status === 'paused'

  // --- Carga de la reunión pasada (con polling mientras el resumen genera) ---
  const [past, setPast] = useState<MeetingDetailData | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (!pastId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = async (): Promise<void> => {
      try {
        const data = await window.uyari.meetings.get(pastId)
        if (cancelled) return
        setPast(data)
        const st = data.summary?.status
        if (st === 'PENDING' || st === 'PROCESSING') timer = setTimeout(() => void load(), 3000)
      } catch {
        // best-effort; el próximo tick reintenta
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [pastId, reloadTick])

  const dataReady = !isPast || !!past

  // --- Chat de la nota (N3/N4) ---
  const { msgs, busy, ask, regenerate } = useAsk(clientSessionId)
  const [askView, setAskView] = useState<AskView>(null)
  const [dockPinned, setDockPinned] = useState(false)
  const editorRef = useRef<Editor | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setAskView('palette')
      }
      if (e.key === 'Escape') setAskView(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const copyAnswer = (a: string): void => void navigator.clipboard.writeText(a).catch(() => {})
  const sendToNote = (a: string): void => {
    editorRef.current?.chain().focus('end').insertContent(`<p>${escapeHtml(a)}</p>`).run()
  }
  const openTranscript = (): void => setDockPinned(true)

  // --- Tabs (solo en pasado; en vivo aún no hay resumen) ---
  const [noteTab, setNoteTab] = useState<NoteTab>('mine')

  // --- Título (editable en vivo Y en pasado, como Granola) ---
  const [title, setTitle] = useState('')
  // Init UNA sola vez: el polling del pasado no debe pisar lo que estás tipeando.
  const titleInit = useRef(false)
  useEffect(() => {
    if (titleInit.current) return
    if (isPast && !past) return // esperar la carga
    const raw = isPast ? (past?.title ?? '') : (session?.title ?? '')
    setTitle(raw && raw !== 'Untitled' ? raw : '')
    titleInit.current = true
  }, [isPast, past, session?.title])
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTitle = (value: string): void => {
    setTitle(value)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      // Vivo: renombra la sesión del main (persiste por ingest + refleja en el
      // nub). Pasado: PUT directo al título de la reunión.
      if (isPast) void window.uyari.meetings.saveTitle(clientSessionId, value).catch(() => {})
      else window.uyari.capture.rename(value)
    }, 400)
  }

  // --- Autosave del body ---
  const notesLatest = useRef('')
  const notesSaved = useRef('')
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistNotes = useCallback(
    async (value: string): Promise<void> => {
      if (!clientSessionId || value === notesSaved.current) return
      try {
        await window.uyari.meetings.saveNotes(clientSessionId, value)
        notesSaved.current = value
      } catch {
        // best-effort
      }
    },
    [clientSessionId],
  )
  const onBody = (html: string): void => {
    notesLatest.current = html
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => void persistNotes(html), 800)
  }
  useEffect(() => {
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current)
      if (notesLatest.current !== notesSaved.current) void persistNotes(notesLatest.current)
    }
  }, [persistNotes])

  // --- Líneas del dock (pasado: segmentos cargados; vivo: captions del store) ---
  const startedAtMs = isPast
    ? past
      ? new Date(past.startedAt).getTime()
      : 0
    : (session?.startedAtMs ?? 0)
  const dockSource: CaptionSegment[] = useMemo(() => {
    if (isPast)
      return (past?.segments ?? []).map((s) => ({
        providerMessageId: s.providerMessageId,
        speaker: s.speaker ?? undefined,
        text: s.text,
        tsOffsetMs: s.tsOffsetMs,
      }))
    return captions
  }, [isPast, past?.segments, captions])
  const lines = useMemo<DockLine[]>(
    () =>
      groupCaptions(dockSource).map((g) => ({
        key: g.key,
        who: g.speaker === 'You' ? 'you' : 'them',
        t: new Date(startedAtMs + g.tsOffsetMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: g.texts.join(' '),
      })),
    [dockSource, startedAtMs],
  )

  const dateLabel = new Date(startedAtMs || Date.now()).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  // --- Regenerar / generar el resumen (pasado) ---
  const regenerateSummary = (template?: string): void => {
    if (!clientSessionId) return
    // Optimista: mostrar "generando" ya y re-poll.
    setPast((p) => (p ? { ...p, summary: { ...(p.summary ?? { status: 'PENDING' }), status: 'PROCESSING' } } : p))
    setNoteTab('uyari')
    void window.uyari.meetings
      .regenerateSummary(clientSessionId, template)
      .then(() => setReloadTick((t) => t + 1))
      .catch(() => setReloadTick((t) => t + 1))
  }

  const back = (): void => (isPast ? closeMeeting() : minimizeNote())
  const summary = past?.summary ?? null
  // 'empty' = terminada pero sin generar aún → NO hay tabs ni panel, solo la
  // nota + el botón "Generar notas" abajo (patrón Granola). Los tabs y el panel
  // aparecen RECIÉN al generar.
  const aiStatus = isPast ? summaryStatus(summary) : 'empty'
  const showAi = isPast && aiStatus !== 'empty'

  if (!dataReady) {
    return <div style={{ flex: 1, height: '100%', background: 'var(--paper)' }} />
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        minHeight: 0,
        height: '100%',
        position: 'relative',
        background: 'var(--paper)',
      }}
    >
      {/* volver: en vivo minimiza (sigue grabando), en pasado vuelve al Home */}
      <span
        onClick={back}
        title={isPast ? 'Volver al inicio' : 'Minimizar al inicio'}
        style={
          {
            position: 'absolute',
            top: 12,
            left: 78,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--sidebar, var(--surface-sunken))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-pill)',
            padding: '7px 12px',
            cursor: 'pointer',
            color: 'var(--ink-2)',
            zIndex: 20,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties
        }
      >
        {dIcon('m15 6-6 6 6 6', 2, 18)}
        {dIcon('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5', 1.7, 18)}
      </span>

      {/* columna principal */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 560, maxWidth: '86%', margin: '72px auto 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Untitled"
            style={{
              font: 'var(--display-md)',
              fontSize: 36,
              fontFamily: 'var(--font-serif-display)',
              color: 'var(--text-heading)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              width: '100%',
              padding: 0,
            }}
          />

          {/* fila de tabs (solo tras generar) + chips */}
          <div style={{ display: 'flex', gap: 8, margin: '14px 0 20px', alignItems: 'center', flexWrap: 'wrap' }}>
            {showAi && <NoteTabs tab={noteTab} onTab={setNoteTab} status={aiStatus} />}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                font: 'var(--text-xs)',
                color: 'var(--ink-2)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '8px 12px',
                textTransform: 'capitalize',
              }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>
                {dIcon(['M8 2v4M16 2v4', 'M3 8h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'], 1.7, 15)}
              </span>
              {dateLabel}
              <span style={{ display: 'inline-flex', color: 'var(--ink-3)', marginLeft: 4 }}>
                {dIcon(['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], 1.7, 15)}
              </span>
              Yo
            </span>
          </div>

          {/* cuerpo: Mis notas (editor) o Notas de Uyari (panel, solo tras generar) */}
          {showAi && noteTab === 'uyari' ? (
            <div style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column' }}>
              <EnhancedPanel
                summary={summary}
                hasUserNotes={!!(past?.userNotes && past.userNotes.trim())}
                onRegenerate={regenerateSummary}
              />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 220 }}>
              <NotesEditor
                variant="free"
                placeholder={BODY_PLACEHOLDER}
                initialContent={isPast ? (past?.userNotes ?? '') : ''}
                onReady={(e) => (editorRef.current = e)}
                onChange={onBody}
                onBlur={() => {
                  if (notesTimer.current) clearTimeout(notesTimer.current)
                  void persistNotes(notesLatest.current)
                }}
              />
            </div>
          )}
        </div>

        {/* consent + píldoras */}
        <div style={{ flexShrink: 0, padding: '6px 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {!isPast && (
            <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)' }}>
              Pide siempre consentimiento al transcribir a otros ›
            </span>
          )}

          {/* Terminada pero sin generar → botón verde "Generar notas" (Granola) */}
          {isPast && aiStatus === 'empty' && (
            <span
              onClick={() => regenerateSummary()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#6b7d1f',
                color: '#fff',
                font: 'var(--label-sm)',
                fontSize: 13,
                borderRadius: 'var(--radius-pill)',
                padding: '12px 22px',
                cursor: 'pointer',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {aiStar(14)}
              {past?.userNotes && past.userNotes.trim() ? 'Mejorar mis notas' : 'Generar notas'}
            </span>
          )}

          {/* Tras generar → chips de sugerencia violeta (aparecen animados) */}
          {showAi && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {NOTE_RECIPES.map((r, i) => (
                <span
                  key={r}
                  onClick={() => {
                    setAskView('pop')
                    ask(r)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    font: 'var(--text-xs)',
                    fontWeight: 500,
                    color: 'var(--accent-strong)',
                    background: 'var(--violet-soft)',
                    borderRadius: 'var(--radius-pill)',
                    padding: '7px 13px',
                    animation: 'uyariReveal 0.3s var(--ease-out) both',
                    animationDelay: `${i * 70}ms`,
                  }}
                >
                  {slashIcon}
                  {r}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* píldora de captura — solo en vivo */}
            {!isPast && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '11px 15px', boxShadow: 'var(--shadow-card)' }}>
                {paused ? (
                  <span style={{ font: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-4)' }}>Pausado</span>
                ) : (
                  <AudioBars />
                )}
                <span
                  onClick={() => void (paused ? resumeCapture() : pauseCapture())}
                  title={paused ? 'Reanudar' : 'Pausar'}
                  style={{ width: 15, height: 15, borderRadius: 4, background: paused ? 'var(--mint)' : 'var(--ink-2)', cursor: 'pointer' }}
                />
                <span style={{ width: 1, height: 16, background: 'var(--border)' }} />
                <span
                  onClick={() => void stopCapture()}
                  title="Terminar y resumir"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, cursor: 'pointer', color: 'var(--ink-3)' }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: 'currentColor' }} />
                </span>
              </div>
            )}
            {/* píldora ask → popover (vivo y pasado) */}
            <div
              onClick={() => setAskView('pop')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '9px 10px 9px 18px', width: 440, boxSizing: 'border-box', boxShadow: 'var(--shadow-card)', cursor: 'text' }}
            >
              <span style={{ flex: 1, font: 'var(--text-sm)', color: 'var(--ink-4)' }}>Pregunta lo que sea…</span>
              <span style={{ font: 'var(--text-xs)', fontSize: 11, fontWeight: 500, color: 'var(--ink-4)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 6px' }}>⌘J</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--label-sm)', fontSize: 12, color: 'var(--ink-2)', background: 'var(--sidebar, var(--surface-sunken))', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '7px 12px' }}>
                {slashIcon}
                ¿Qué me perdí?
              </span>
            </div>
          </div>
        </div>
      </div>

      <LiveDock lines={lines} pinned={dockPinned} onTogglePin={() => setDockPinned((p) => !p)} />

      {askView === 'pop' && (
        <AskPopover
          msgs={msgs}
          busy={busy}
          ask={ask}
          onExpand={() => setAskView('sheet')}
          onClose={() => setAskView(null)}
          onCopy={copyAnswer}
          onSendToNote={sendToNote}
          onRegenerate={regenerate}
          onOpenTranscript={openTranscript}
        />
      )}
      {askView === 'sheet' && (
        <AskSheet
          msgs={msgs}
          busy={busy}
          ask={ask}
          onClose={() => setAskView(null)}
          onCopy={copyAnswer}
          onSendToNote={sendToNote}
          onRegenerate={regenerate}
          onOpenTranscript={openTranscript}
        />
      )}
      {askView === 'palette' && (
        <CmdPalette
          onRun={(text) => {
            setAskView('pop')
            ask(text)
          }}
          onClose={() => setAskView(null)}
        />
      )}
    </div>
  )
}
