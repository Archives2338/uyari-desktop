import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { dIcon } from '@renderer/ui/chrome'
import { Dropdown } from '@renderer/components/Dropdown'
import { NotesEditor } from '@renderer/components/NotesEditor'
import { mdToHtml, htmlToMd } from '@renderer/lib/markdown'
import type { MeetingSummary } from '@shared/domain'
import { aiStar } from './NoteTabs'

// Panel "Notas de Uyari" (Enhanced Notes) — vive DENTRO de la pestaña Uyari,
// nunca bloquea la escritura en "Mis notas". 4 estados (vacío/generando/listo/
// falló) + toolbar con Regenerar ▾ (plantillas). N5b: contenido read-only;
// N5c suma editable + Restaurar original (el backend ya guarda content +
// originalContent). Todo token-driven.

/** Plantillas — deben coincidir con los slugs del backend (prompts.ts). */
const TEMPLATES: Array<{ slug: string; label: string }> = [
  { slug: 'general', label: 'General' },
  { slug: 'weekly', label: 'Reunión de equipo' },
  { slug: 'one_on_one', label: '1:1' },
  { slug: 'sales', label: 'Llamada de ventas' },
  { slug: 'interview', label: 'Entrevista' },
]

type Status = 'empty' | 'generating' | 'done' | 'failed'

export function summaryStatus(summary: MeetingSummary | null): Status {
  if (!summary) return 'empty'
  if (summary.status === 'PENDING' || summary.status === 'PROCESSING') return 'generating'
  if (summary.status === 'FAILED') return 'failed'
  if (summary.status === 'DONE') return 'done'
  return 'empty'
}

export function EnhancedPanel({
  summary,
  hasUserNotes,
  onRegenerate,
  onSaveContent,
}: {
  summary: MeetingSummary | null
  hasUserNotes: boolean
  onRegenerate: (template?: string) => void
  /** Persiste el content editado del panel (markdown). No toca originalContent. */
  onSaveContent: (content: string) => void
}): React.JSX.Element {
  const status = summaryStatus(summary)
  const [checks, setChecks] = useState<Record<number, boolean>>({})

  // --- Edición del panel (N5c) ---
  // El resumen se muestra editable (patrón Granola). La versión IA cruda vive en
  // originalContent → "Restaurar" y el indicador "editado" comparan contra ella.
  const original = summary?.originalContent ?? null
  const content = summary?.content ?? ''
  const editorRef = useRef<Editor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // El markdown se captura en cada edición (NO se lee del editor al desmontar:
  // al cambiar de tab TipTap ya lo destruyó → getHTML() tiraría y, por ser un
  // cleanup de React, dejaría la pantalla en blanco). `latestMd` = edición sin
  // persistir; `savedMd` = último content guardado (evita saves espurios).
  const latestMd = useRef<string | null>(null)
  const savedMd = useRef<string>('')
  const [edited, setEdited] = useState(false)
  // Al aparecer/cambiar las notas (status→done), fijar la línea base: content ya
  // persistido = savedMd (así solo persisten cambios reales) e indicador
  // "editado" contra el original. NO se re-lee al editar (content es estable
  // hasta un regenerate), así que no pisa lo que estás tipeando.
  useEffect(() => {
    if (status !== 'done') return
    savedMd.current = content
    latestMd.current = null
    setEdited(!!original && content !== original)
  }, [status, original, content])

  const persist = (md: string): void => {
    if (md === savedMd.current) return
    savedMd.current = md
    latestMd.current = null
    onSaveContent(md)
  }
  const onEdit = (html: string): void => {
    const md = htmlToMd(html)
    latestMd.current = md
    setEdited(!!original && md !== original)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => persist(md), 700)
  }
  const flushEdit = (): void => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (latestMd.current != null) persist(latestMd.current)
  }
  const restore = (): void => {
    if (original == null) return
    editorRef.current?.commands.setContent(mdToHtml(original))
    setEdited(false)
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    persist(original)
  }
  useEffect(() => () => flushEdit(), []) // guardar al desmontar el panel

  const center: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    textAlign: 'center',
    paddingBottom: 60,
  }

  if (status === 'empty') {
    return (
      <div style={center}>
        {aiStar(26)}
        <span style={{ font: 'var(--label-md)', fontSize: 15, color: 'var(--text-heading)' }}>
          La reunión terminó
        </span>
        <span
          onClick={() => onRegenerate()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: '#6b7d1f',
            color: '#fff',
            font: 'var(--label-sm)',
            fontSize: 13,
            borderRadius: 'var(--radius-pill)',
            padding: '12px 20px',
            cursor: 'pointer',
          }}
        >
          {aiStar(13)}
          {hasUserNotes ? 'Mejorar mis notas' : 'Generar notas'}
        </span>
        <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', maxWidth: 300 }}>
          Tus notas y el transcript están a salvo — Uyari escribe en su propia capa.
        </span>
      </div>
    )
  }

  if (status === 'generating') {
    const bar = (w: number | string, ht: number): React.JSX.Element => (
      <span style={{ width: w, height: ht, borderRadius: ht / 2, background: 'var(--surface-sunken)' }} />
    )
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
        {bar(130, 13)}
        {bar('80%', 10)}
        {bar('70%', 10)}
        <span style={{ marginTop: 10 }} />
        {bar(110, 13)}
        {bar('76%', 10)}
        <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', marginTop: 18 }}>
          Analizando el transcript… tus notas siguen en "Mis notas".
        </span>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div style={center}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(196,85,77,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#C4554D' }}>
          {dIcon('M12 8v5M12 16.5v.5', 2, 15)}
        </span>
        <span style={{ font: 'var(--label-md)', fontSize: 14, color: 'var(--text-heading)' }}>
          No pudimos generar las notas
        </span>
        <span style={{ font: 'var(--text-xs)', fontWeight: 400, color: 'var(--ink-4)', maxWidth: 300 }}>
          Tus notas y el transcript están intactos. Suele resolverse al reintentar.
        </span>
        <span
          onClick={() => onRegenerate()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: '#6b7d1f',
            color: '#fff',
            font: 'var(--label-sm)',
            fontSize: 12.5,
            borderRadius: 'var(--radius-pill)',
            padding: '11px 18px',
            cursor: 'pointer',
          }}
        >
          ↻ Reintentar
        </span>
      </div>
    )
  }

  // done
  const pill: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    font: 'var(--text-xs)',
    fontWeight: 500,
    color: 'var(--ink-2)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-pill)',
    padding: '7px 12px',
    cursor: 'pointer',
  }
  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', color: 'var(--accent-strong)' }}>
          {dIcon(['M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.4 2.6L21 8', 'M21 3v5h-5'], 1.8, 15)}
        </span>
        <Dropdown
          options={TEMPLATES.map((t) => ({ value: t.slug, label: t.label }))}
          value={summary?.template ?? 'general'}
          onChange={(slug) => onRegenerate(slug)}
          placeholder="Plantilla"
          align="left"
        />
        {/* Editado + Restaurar original (aparecen solo si tocaste el resumen) */}
        {edited && original != null && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: 'var(--text-xs)', fontSize: 11, fontWeight: 500, color: 'var(--ink-4)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-strong)' }} />
              Editado
            </span>
            <span
              onClick={restore}
              title="Volver a la versión original de Uyari"
              style={{ ...pill, gap: 5 }}
            >
              {dIcon(['M3 12a9 9 0 1 0 9-9c-2.5 0-4.8 1-6.4 2.6L3 8', 'M3 3v5h5'], 1.8, 14)}
              Restaurar
            </span>
          </>
        )}
      </div>

      {/* contenido SIEMPRE editable (patrón Granola) — mismo editor que "Mis
          notas". El reveal (fade + slide) corre UNA vez, al montar este div
          cuando las notas aparecen (status→done); como el panel no se
          re-monta al cambiar de tab (NoteScreen alterna con display), no
          reproduce el parpadeo en cada cambio. */}
      <div style={{ animation: 'uyariReveal 0.5s var(--ease-out) both' }}>
        <NotesEditor
          variant="free"
          placeholder="Edita las notas de Uyari…"
          initialContent={mdToHtml(content)}
          onReady={(e) => (editorRef.current = e)}
          onChange={onEdit}
          onBlur={flushEdit}
        />
      </div>

      {/* action items */}
      {summary?.actionItems && summary.actionItems.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, font: 'var(--label-md)', fontSize: 15.5, color: 'var(--text-heading)', margin: '16px 0 6px' }}>
            <span style={{ font: 'var(--text-sm)', fontSize: 13, fontWeight: 500, color: 'var(--ink-4)' }}>#</span>
            Action items
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, paddingLeft: 4, marginTop: 2 }}>
            {summary.actionItems.map((a, i) => (
              <span
                key={i}
                onClick={() => setChecks((c) => ({ ...c, [i]: !c[i] }))}
                style={{
                  display: 'flex',
                  gap: 9,
                  alignItems: 'flex-start',
                  font: 'var(--text-sm)',
                  fontSize: 14,
                  color: checks[i] ? 'var(--ink-4)' : 'var(--text-heading)',
                  cursor: 'pointer',
                }}
              >
                {checks[i] ? (
                  <span style={{ width: 15, height: 15, borderRadius: 5, background: 'var(--violet)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', marginTop: 3, flexShrink: 0 }}>
                    {dIcon('M20 6 9 17l-5-5', 3, 9)}
                  </span>
                ) : (
                  <span style={{ width: 15, height: 15, borderRadius: 5, border: '1.5px solid var(--border-strong)', boxSizing: 'border-box', marginTop: 3, flexShrink: 0 }} />
                )}
                <span style={{ textDecoration: checks[i] ? 'line-through' : 'none' }}>{a}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
