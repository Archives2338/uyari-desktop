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
  const resumeMeeting = useApp((s) => s.resumeMeeting)

  const clientSessionId = pastId ?? session?.clientSessionId ?? ''
  const paused = session?.status === 'paused'
  // ¿Hay una sesión de captura activa que pertenece a ESTA nota? (nota nueva en
  // vivo, o una nota pasada REANUDADA). Reanudar no cambia de vista: seguís acá.
  const capturing = !!session && session.clientSessionId === clientSessionId

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
    if (!isPast) return captions
    const pastSegs = (past?.segments ?? []).map((s) => ({
      providerMessageId: s.providerMessageId,
      speaker: s.speaker ?? undefined,
      text: s.text,
      tsOffsetMs: s.tsOffsetMs,
    }))
    // Nota pasada REANUDADA: el transcript viejo (cargado) + los captions nuevos
    // en vivo, ordenados por offset (los nuevos ya arrancan después). Así el
    // transcript se actualiza en vivo SIN cambiar de vista (Granola).
    if (!capturing) return pastSegs
    return [...pastSegs, ...captions].sort((a, b) => a.tsOffsetMs - b.tsOffsetMs)
  }, [isPast, past?.segments, captions, capturing])
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
  // El transcript quedó "desactualizado" respecto del resumen (reanudaste y
  // creció). Muestra el toast "Transcript actualizado → Regenerar" (Granola).
  const [transcriptStale, setTranscriptStale] = useState(false)
  // Confirmación antes de regenerar sobre un resumen ya hecho (Granola:
  // "reemplazará las notas, no se puede deshacer"). null = sin diálogo.
  const [pendingRegen, setPendingRegen] = useState<{ template?: string } | null>(null)

  const doRegenerate = (template?: string): void => {
    if (!clientSessionId) return
    setTranscriptStale(false)
    // Optimista: mostrar "generando" ya y re-poll.
    setPast((p) => (p ? { ...p, summary: { ...(p.summary ?? { status: 'PENDING' }), status: 'PROCESSING' } } : p))
    setNoteTab('uyari')
    void window.uyari.meetings
      .regenerateSummary(clientSessionId, template)
      .then(() => setReloadTick((t) => t + 1))
      .catch(() => setReloadTick((t) => t + 1))
  }
  // Gate: Granola muestra el diálogo específicamente cuando EDITaste el panel
  // (content ≠ originalContent) — regenerar pisaría tus ediciones. Si no las
  // tocaste (o es la primera generación), corre directo (no hay nada que perder).
  const requestRegenerate = (template?: string): void => {
    const s = past?.summary
    const edited = !!s && s.status === 'DONE' && s.originalContent != null && (s.content ?? '') !== s.originalContent
    if (edited) setPendingRegen({ template })
    else doRegenerate(template)
  }

  // Al terminar una reanudación (la sesión de esta nota pasa a null), recargar
  // el transcript combinado; y si había un resumen, marcarlo desactualizado.
  const wasCapturing = useRef(false)
  useEffect(() => {
    if (wasCapturing.current && !capturing && isPast) {
      setReloadTick((t) => t + 1)
      if (summaryStatus(past?.summary ?? null) === 'done') setTranscriptStale(true)
    }
    wasCapturing.current = capturing
  }, [capturing, isPast, past?.summary])

  // Reanudar una nota terminada: retoma la captura sobre el MISMO
  // clientSessionId, arrancando el tramo nuevo justo después de lo ya
  // transcrito (patrón Granola: "el stop es una pausa que nadie retomó").
  const onResume = (): void => {
    if (!past) return
    // El tramo nuevo arranca justo después del último segmento ya transcrito,
    // para que sus offsets no se solapen con lo previo (el orden en la vista
    // pasada, al terminar, queda correcto). El dock en vivo, en cambio, arranca
    // vacío — no re-mostramos el transcript viejo (como Granola).
    const maxOffset = (past.segments ?? []).reduce((m, s) => Math.max(m, s.tsOffsetMs), 0)
    void resumeMeeting({
      clientSessionId: pastId!,
      title: past.title ?? '',
      baseOffsetMs: maxOffset + 2000, // hueco de 2 s tras lo previo
    })
  }

  const back = (): void => {
    // Capturando (nota nueva o reanudada) → minimizar al Home + RecordingPill
    // (la captura sigue; restaurar reabre ESTA nota). Nota pasada quieta → Home.
    if (capturing) minimizeNote()
    else if (isPast) closeMeeting()
    else minimizeNote()
  }
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

          {/* cuerpo: ambos editores MONTADOS a la vez; se alterna con `display`
              (no se re-montan al cambiar de tab → sin parpadeo, y cada editor
              conserva su estado). "Notas de Uyari" solo existe tras generar. */}
          <div style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 220, display: showAi && noteTab === 'uyari' ? 'none' : 'block' }}>
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
            {showAi && (
              <div style={{ flex: 1, minHeight: 220, display: noteTab === 'uyari' ? 'flex' : 'none', flexDirection: 'column' }}>
                <EnhancedPanel
                  summary={summary}
                  hasUserNotes={!!(past?.userNotes && past.userNotes.trim())}
                  onRegenerate={requestRegenerate}
                  onSaveContent={(c) =>
                    void window.uyari.meetings.saveSummary(clientSessionId, c).catch(() => {})
                  }
                />
              </div>
            )}
          </div>
        </div>

        {/* consent + píldoras */}
        <div style={{ flexShrink: 0, padding: '6px 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {!isPast && (
            <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)' }}>
              Pide siempre consentimiento al transcribir a otros ›
            </span>
          )}

          {/* Terminada pero sin generar → botón verde "Generar notas" (Granola).
              Primera generación: sin confirmación (no hay nada que reemplazar). */}
          {isPast && aiStatus === 'empty' && !capturing && (
            <span
              onClick={() => doRegenerate()}
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

          {/* Toast "Transcript actualizado → Regenerar notas" (Granola): el
              transcript creció tras reanudar y el resumen quedó viejo. No
              auto-regenera; invita. */}
          {transcriptStale && !capturing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '8px 10px 8px 16px', boxShadow: 'var(--shadow-card)', animation: 'uyariReveal 0.3s var(--ease-out) both' }}>
              <span
                onClick={() => setTranscriptStale(false)}
                title="Descartar"
                style={{ display: 'inline-flex', cursor: 'pointer', color: 'var(--ink-3)' }}
              >
                {dIcon('M18 6 6 18M6 6l12 12', 1.8, 15)}
              </span>
              <span style={{ font: 'var(--text-sm)', fontSize: 13, color: 'var(--ink-2)' }}>Transcript actualizado</span>
              <span
                onClick={() => requestRegenerate()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--label-sm)', fontSize: 12.5, color: 'var(--ink)', background: 'var(--sidebar, var(--surface-sunken))', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '7px 13px', cursor: 'pointer' }}
              >
                {aiStar(13)}
                Regenerar notas
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Reanudar — nota pasada y SIN captura activa: retoma sobre la
                misma nota sin cambiar de vista. Mientras captura, la reemplaza
                la píldora de captura (con Detener). */}
            {isPast && !capturing && (
              <div
                onClick={onResume}
                title="Reanudar la transcripción de esta nota"
                style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '9px 15px', boxShadow: 'var(--shadow-card)', cursor: 'pointer', color: 'var(--ink-2)', font: 'var(--label-sm)', fontSize: 13 }}
              >
                <span style={{ display: 'inline-flex', width: 8, height: 8, borderRadius: '50%', background: '#e5484d' }} />
                Reanudar
              </div>
            )}
            {/* píldora de captura — cuando hay captura activa de ESTA nota
                (nota nueva en vivo O nota pasada reanudada) */}
            {capturing && (
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

      {/* Confirmación al regenerar tras EDITAR el panel (Granola): regenerar o
          aplicar una plantilla pisaría tus ediciones. */}
      {pendingRegen && (
        <div
          onClick={() => setPendingRegen(null)}
          style={{ position: 'absolute', inset: 0, background: 'rgba(20,18,30,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 420, maxWidth: '86%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-pop)', padding: '22px 24px 18px' }}
          >
            <div style={{ font: 'var(--label-md)', fontSize: 17, color: 'var(--text-heading)', marginBottom: 8 }}>
              ¿Regenerar notas?
            </div>
            <div style={{ font: 'var(--text-sm)', fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
              Editaste estas notas. Regenerar o aplicar una plantilla reemplazará tus ediciones, y esto no se puede deshacer.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <span
                onClick={() => setPendingRegen(null)}
                style={{ font: 'var(--label-sm)', fontSize: 13, color: 'var(--ink-2)', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-pill)', padding: '9px 18px', cursor: 'pointer' }}
              >
                Cancelar
              </span>
              <span
                onClick={() => {
                  const tpl = pendingRegen.template
                  setPendingRegen(null)
                  doRegenerate(tpl)
                }}
                style={{ font: 'var(--label-sm)', fontSize: 13, color: '#fff', background: '#C4554D', borderRadius: 'var(--radius-pill)', padding: '9px 18px', cursor: 'pointer' }}
              >
                Continuar
              </span>
            </div>
          </div>
        </div>
      )}

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
