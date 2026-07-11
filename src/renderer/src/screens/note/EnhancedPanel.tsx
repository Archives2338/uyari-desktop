import { useState } from 'react'
import { dIcon } from '@renderer/ui/chrome'
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

/** Parsea negritas inline `**...**` a <b>. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part)
    return m ? (
      <b key={i} style={{ color: 'var(--text-heading)', fontWeight: 600 }}>
        {m[1]}
      </b>
    ) : (
      part
    )
  })
}

/** Render read-only del markdown del resumen: headings con marcador "#",
 *  bullets, párrafos. Suficiente para lo que produce el LLM. */
function renderMarkdown(md: string): React.JSX.Element[] {
  const h = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    font: 'var(--label-md)',
    fontSize: 15.5,
    color: 'var(--text-heading)',
    margin: '16px 0 6px',
  } as React.CSSProperties
  const mk = { font: 'var(--text-sm)', fontSize: 13, fontWeight: 500, color: 'var(--ink-4)' }
  const b = {
    display: 'flex',
    gap: 10,
    font: 'var(--text-sm)',
    fontSize: 14.5,
    lineHeight: 1.65,
    color: 'var(--text-body)',
    padding: '3px 0 3px 4px',
  } as React.CSSProperties
  const dot = (
    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ink-4)', marginTop: 9, flexShrink: 0 }} />
  )
  const out: React.JSX.Element[] = []
  // Cada bloque cae escalonado (efecto stream de Granola).
  let blk = 0
  const reveal = (): React.CSSProperties => ({
    animation: 'uyariReveal 0.4s var(--ease-out) both',
    animationDelay: `${blk++ * 45}ms`,
  })
  md.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const head = /^(#{1,3})\s+(.*)$/.exec(line)
    if (head) {
      out.push(
        <div key={i} style={{ ...h, ...reveal() }}>
          <span style={mk}>#</span>
          {inline(head[2])}
        </div>,
      )
      return
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      out.push(
        <div key={i} style={{ ...b, ...reveal() }}>
          {dot}
          <span>{inline(bullet[1])}</span>
        </div>,
      )
      return
    }
    out.push(
      <div key={i} style={{ font: 'var(--text-sm)', fontSize: 14.5, lineHeight: 1.65, color: 'var(--text-body)', margin: '4px 0', ...reveal() }}>
        {inline(line)}
      </div>,
    )
  })
  return out
}

export function EnhancedPanel({
  summary,
  hasUserNotes,
  onRegenerate,
}: {
  summary: MeetingSummary | null
  hasUserNotes: boolean
  onRegenerate: (template?: string) => void
}): React.JSX.Element {
  const status = summaryStatus(summary)
  const [tplOpen, setTplOpen] = useState(false)
  const [checks, setChecks] = useState<Record<number, boolean>>({})

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
  const tplLabel = TEMPLATES.find((t) => t.slug === summary?.template)?.label ?? 'General'
  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', position: 'relative', flexWrap: 'wrap' }}>
        <span
          onClick={() => setTplOpen((o) => !o)}
          style={{ ...pill, ...(tplOpen ? { borderColor: 'var(--violet)', boxShadow: '0 0 0 3px var(--focus-ring)' } : {}) }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--accent-strong)' }}>
            {dIcon(['M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.4 2.6L21 8', 'M21 3v5h-5'], 1.8, 15)}
          </span>
          Regenerar
          {dIcon('m6 9 6 6 6-6', 2, 15)}
        </span>
        <span style={{ marginLeft: 'auto', font: 'var(--text-xs)', fontSize: 11, color: 'var(--ink-4)' }}>
          plantilla: {tplLabel}
        </span>
        {tplOpen && (
          <div
            style={{
              position: 'absolute',
              top: 36,
              left: 0,
              width: 270,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              boxShadow: 'var(--shadow-pop)',
              padding: 8,
              zIndex: 4,
            }}
          >
            <div style={{ font: 'var(--eyebrow)', fontSize: 10.5, letterSpacing: 'var(--eyebrow-tracking)', color: 'var(--ink-4)', padding: '6px 12px' }}>
              PLANTILLAS
            </div>
            {TEMPLATES.map((t) => (
              <div
                key={t.slug}
                onClick={() => {
                  setTplOpen(false)
                  onRegenerate(t.slug)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: t.slug === summary?.template ? 'var(--sidebar, var(--surface-sunken))' : 'transparent',
                  borderRadius: 9,
                  padding: '9px 12px',
                  font: 'var(--label-sm)',
                  fontSize: 13,
                  color: 'var(--text-heading)',
                  cursor: 'pointer',
                }}
              >
                {aiStar(13)}
                {t.label}
                {t.slug === summary?.template && (
                  <span style={{ marginLeft: 'auto', color: 'var(--mint)', display: 'inline-flex' }}>
                    {dIcon('M20 6 9 17l-5-5', 2.5, 15)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* contenido (read-only en N5b) */}
      <div>{summary?.content ? renderMarkdown(summary.content) : null}</div>

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
