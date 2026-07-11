import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useApp } from '@renderer/store'
import { dIcon } from '@renderer/ui/chrome'
import { groupCaptions } from '@renderer/lib/captions'
import { NotesEditor } from '@renderer/components/NotesEditor'
import { AudioBars } from './AudioBars'
import { LiveDock, type DockLine } from './LiveDock'
import { slashIcon } from './ask-common'
import { useAsk } from './useAsk'
import { AskPopover } from './AskPopover'
import { AskSheet } from './AskSheet'
import { CmdPalette } from './CmdPalette'

// Módulo de notas — NT1-B (diseño CAMBIOS-NOTA-PREGUNTAS.md). Pantalla de nota
// EN VIVO: aparece en la ventana principal mientras hay una sesión activa
// (tomar notas mientras Uyari transcribe, estilo Granola). El transcript vive
// en un dock a la derecha (N2); las preguntas en 3 niveles QA3 popover → QA1
// sheet → QA4 paleta ⌘J (N3/N4), un solo motor `useAsk` contra el backend real.

const BODY_PLACEHOLDER = 'Escribe — Uyari completa el resto al terminar…'

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type AskView = null | 'pop' | 'sheet' | 'palette'

export function NoteScreen(): React.JSX.Element {
  const session = useApp((s) => s.session)
  const pauseCapture = useApp((s) => s.pauseCapture)
  const resumeCapture = useApp((s) => s.resumeCapture)
  const minimizeNote = useApp((s) => s.minimizeNote)
  const captions = useApp((s) => s.captions)

  const clientSessionId = session?.clientSessionId ?? ''
  const paused = session?.status === 'paused'

  // --- Chat de la nota (N3/N4): un motor, tres vistas ---
  const { msgs, busy, ask, regenerate } = useAsk(clientSessionId)
  const [askView, setAskView] = useState<AskView>(null)
  const [dockPinned, setDockPinned] = useState(false)
  const editorRef = useRef<Editor | null>(null)

  // ⌘J abre la paleta; Esc cierra la vista activa (patrón del diseño).
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

  const copyAnswer = (answer: string): void => void navigator.clipboard.writeText(answer).catch(() => {})
  const sendToNote = (answer: string): void => {
    // Inserta la respuesta como un párrafo al final del editor.
    editorRef.current?.chain().focus('end').insertContent(`<p>${escapeHtml(answer)}</p>`).run()
  }
  const openTranscript = (): void => setDockPinned(true)

  // Segmentos reales → líneas del dock. groupCaptions ordena por tiempo de
  // audio y agrupa turnos consecutivos del mismo hablante (los dos canales
  // llegan entrelazados en vivo). Hora en reloj de pared del inicio del bloque.
  const startedAtMs = session?.startedAtMs ?? 0
  const lines = useMemo<DockLine[]>(
    () =>
      groupCaptions(captions).map((g) => ({
        key: g.key,
        who: g.speaker === 'You' ? 'you' : 'them',
        t: new Date(startedAtMs + g.tsOffsetMs).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        text: g.texts.join(' '),
      })),
    [captions, startedAtMs],
  )

  // "Untitled" (default del backend) se trata como vacío → placeholder gris,
  // igual que Granola. Al tipear se renombra la sesión en el main, que lo
  // persiste (vía ingest) y lo refleja en el nub/píldora por onSession.
  const [title, setTitle] = useState(
    session?.title && session.title !== 'Untitled' ? session.title : '',
  )
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onTitle = (value: string): void => {
    setTitle(value)
    if (titleTimer.current) clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => window.uyari.capture.rename(value), 400)
  }

  // Autosave del body (mismo contrato que la Fase 5a): debounce 800ms + flush
  // en unmount. Tolerante al 404 temprano (la reunión se crea al ingerir el
  // primer segmento; hasta entonces saveNotes puede fallar — se reintenta).
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
        // Best-effort: el próximo save (o el flush) reintenta.
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

  const dateLabel = new Date(session?.startedAtMs ?? Date.now()).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        minHeight: 0,
        // height:100% (como Home): el ThemeRoot no es flex column, así que sin
        // esto el flex:1 no reparte alto y el contenido no llega al fondo.
        height: '100%',
        position: 'relative',
        background: 'var(--paper)',
      }}
    >
      {/* volver = minimizar al Home (la grabación sigue; aparece el nub) */}
      <span
        onClick={() => minimizeNote()}
        title="Minimizar al inicio"
        style={{
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
          // Por encima de la .drag-region (fixed, z-index:10) y fuera de la zona
          // de arrastre — si no, la barra de título se come el clic.
          zIndex: 20,
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {dIcon('m15 6-6 6 6 6', 2, 18)}
        {dIcon('M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5', 1.7, 18)}
      </span>
      {/* editor */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            width: 560,
            maxWidth: '86%',
            margin: '72px auto 0',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
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
          <div style={{ display: 'flex', gap: 8, margin: '14px 0 24px' }}>
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
          <div style={{ flex: 1, minHeight: 220 }}>
            <NotesEditor
              variant="free"
              placeholder={BODY_PLACEHOLDER}
              initialContent=""
              onReady={(e) => (editorRef.current = e)}
              onChange={onBody}
              onBlur={() => {
                if (notesTimer.current) clearTimeout(notesTimer.current)
                void persistNotes(notesLatest.current)
              }}
            />
          </div>
        </div>

        {/* consent + píldoras */}
        <div
          style={{
            flexShrink: 0,
            padding: '6px 0 22px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)' }}>
            Pide siempre consentimiento al transcribir a otros ›
          </span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* píldora de captura (real: pausa/reanuda la sesión) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '11px 15px',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              {paused ? (
                <span style={{ font: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-4)' }}>
                  Pausado
                </span>
              ) : (
                <AudioBars />
              )}
              <span
                onClick={() => void (paused ? resumeCapture() : pauseCapture())}
                title={paused ? 'Reanudar' : 'Pausar'}
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: 4,
                  background: paused ? 'var(--mint)' : 'var(--ink-2)',
                  cursor: 'pointer',
                }}
              />
            </div>
            {/* píldora ask → abre el popover QA3 */}
            <div
              onClick={() => setAskView('pop')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-pill)',
                padding: '9px 10px 9px 18px',
                width: 440,
                boxSizing: 'border-box',
                boxShadow: 'var(--shadow-card)',
                cursor: 'text',
              }}
            >
              <span style={{ flex: 1, font: 'var(--text-sm)', color: 'var(--ink-4)' }}>
                Pregunta lo que sea…
              </span>
              <span
                style={{
                  font: 'var(--text-xs)',
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--ink-4)',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  padding: '3px 6px',
                }}
              >
                ⌘J
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  font: 'var(--label-sm)',
                  fontSize: 12,
                  color: 'var(--ink-2)',
                  background: 'var(--sidebar, var(--surface-sunken))',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)',
                  padding: '7px 12px',
                }}
              >
                {slashIcon}
                ¿Qué me perdí?
              </span>
            </div>
          </div>
        </div>
      </div>
      <LiveDock lines={lines} pinned={dockPinned} onTogglePin={() => setDockPinned((p) => !p)} />

      {/* Chat de la nota — 3 niveles, un motor. La paleta aterriza en el popover. */}
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
