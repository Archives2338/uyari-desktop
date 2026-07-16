import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@renderer/store'
import { Button } from '@renderer/ui/Button'
import { dIcon } from '@renderer/ui/chrome'
import { Sidebar } from '@renderer/components/Sidebar'
import { loadFlow } from '@renderer/onboarding/state'
import { formatRelativeDate } from '@renderer/lib/dates'
import { S, PLATFORM_LABEL, projectDot, PROJECT_STATUSES, PROJECT_STATUS_LABEL } from '@renderer/strings'
import type { MeetingListItem, ProjectDetail as ProjectDetailData, ProjectStatus } from '@shared/domain'

// ProjectDetail = el diferenciador de Uyari hecho pantalla. Lo primero que se
// ve NO es la lista de reuniones (eso es Granola) sino el ROLLUP de pendientes:
// todos los action items de todas las reuniones del proyecto juntos, cada uno
// trazable a su reunión. Debajo, las reuniones. Gestión (renombrar/archivar/
// borrar) en un menú; "Add meeting" asigna reuniones al proyecto.

export function ProjectDetail({ projectId }: { projectId: string }): React.JSX.Element {
  const closeProject = useApp((s) => s.closeProject)
  const openMeeting = useApp((s) => s.openMeeting)
  const openAsk = useApp((s) => s.openAsk)
  const openSettings = useApp((s) => s.openSettings)
  const loadProjects = useApp((s) => s.loadProjects)
  const flow = useMemo(loadFlow, [])

  const [project, setProject] = useState<ProjectDetailData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [picking, setPicking] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setProject(await window.uyari.projects.get(projectId))
    } catch {
      setNotFound(true)
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  // Toda mutación refresca el detalle Y el sidebar (contadores).
  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([reload(), loadProjects()])
  }, [reload, loadProjects])

  if (notFound) {
    return (
      <Shell flow={flow} onHome={closeProject} onAsk={openAsk} onSettings={openSettings}>
        <div style={{ maxWidth: 640, margin: '40px auto 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          <p style={{ font: 'var(--text-sm)' }}>Project not found.</p>
          <Button variant="secondary" size="sm" onClick={closeProject}>
            {S.project.back}
          </Button>
        </div>
      </Shell>
    )
  }

  if (!project) {
    return <Shell flow={flow} onHome={closeProject} onAsk={openAsk} onSettings={openSettings} />
  }

  const rename = async (name: string): Promise<void> => {
    setRenaming(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === project.name) return
    await window.uyari.projects.update(projectId, { name: trimmed })
    await refreshAll()
  }

  const setStatus = async (status: ProjectStatus): Promise<void> => {
    setMenuOpen(false)
    if (status === project.status) return
    await window.uyari.projects.update(projectId, { status })
    await refreshAll()
  }

  const toggleFavorite = async (): Promise<void> => {
    setMenuOpen(false)
    await window.uyari.projects.update(projectId, { favorite: !project.favorite })
    await refreshAll()
  }

  const saveDescription = async (description: string): Promise<void> => {
    const next = description.trim()
    if (next === (project.description ?? '')) return
    await window.uyari.projects.update(projectId, { description: next || null })
    await reload()
  }

  const remove = async (): Promise<void> => {
    setMenuOpen(false)
    if (!window.confirm(S.project.deleteConfirm)) return
    await window.uyari.projects.remove(projectId)
    await loadProjects()
    closeProject()
  }

  const unassign = async (clientSessionId: string): Promise<void> => {
    await window.uyari.meetings.assignProject(clientSessionId, null)
    await refreshAll()
  }

  return (
    <Shell flow={flow} onHome={closeProject} onAsk={openAsk} onSettings={openSettings}>
      <div style={{ maxWidth: 660, margin: '6px auto 0' }}>
        {/* Volver */}
        <button
          onClick={closeProject}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            font: 'var(--text-xs)',
            color: 'var(--ink-4)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            marginBottom: 10,
          }}
        >
          {dIcon('M15 18l-6-6 6-6', 1.8, 14)}
          {S.project.back}
        </button>

        {/* Header: punto de color + nombre (editable) + estado + menú */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 5,
              background: projectDot(project.color),
              flexShrink: 0,
            }}
          />
          {renaming ? (
            <RenameInput initial={project.name} onDone={rename} onCancel={() => setRenaming(false)} />
          ) : (
            <h1
              onDoubleClick={() => setRenaming(true)}
              style={{ font: 'var(--display-md)', fontSize: 26, color: 'var(--text-heading)', margin: 0 }}
            >
              {project.name}
            </h1>
          )}
          <span style={{ flex: 1 }} />
          {project.status !== 'ACTIVE' && (
            <span
              style={{
                font: '600 10.5px/1 var(--font-sans)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--ink-4)',
                background: 'var(--surface-sunken)',
                borderRadius: 'var(--radius-pill)',
                padding: '4px 8px',
              }}
            >
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
          )}
          {/* Favorito: estrella clicable en el header. */}
          <button
            onClick={() => void toggleFavorite()}
            title={project.favorite ? S.project.unfavorite : S.project.favorite}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: project.favorite ? 'var(--accent-strong)' : 'var(--ink-4)',
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill={project.favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: 'var(--radius-sm)',
                background: menuOpen ? 'var(--surface-sunken)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-3)',
              }}
            >
              {dIcon(['M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'], 2, 18)}
            </button>
            {menuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setMenuOpen(false)} />
                <Menu
                  onRename={() => {
                    setMenuOpen(false)
                    setRenaming(true)
                  }}
                  status={project.status}
                  onSetStatus={(s) => void setStatus(s)}
                  favorite={project.favorite}
                  onToggleFavorite={() => void toggleFavorite()}
                  onDelete={() => void remove()}
                />
              </>
            )}
          </div>
        </div>

        {/* Meta */}
        <div style={{ font: 'var(--text-sm)', fontWeight: 400, color: 'var(--ink-4)', margin: '0 0 12px 26px' }}>
          {S.project.meetingsCount(project.meetings.length)}
          {project.actionItems.length > 0 && <> · {S.project.itemsCount(project.actionItems.length)}</>}
        </div>

        {/* Descripción editable — contexto libre del proyecto */}
        <div style={{ margin: '0 0 22px 26px' }}>
          <DescriptionField initial={project.description ?? ''} onSave={saveDescription} />
        </div>

        {/* ROLLUP DE PENDIENTES — el diferenciador, arriba de todo */}
        <Section
          title={S.project.openItems}
          count={project.actionItems.length}
          icon={dIcon(['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'], 1.8, 16)}
        >
          {project.actionItems.length === 0 ? (
            <Empty text={S.project.openItemsEmpty} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {project.actionItems.map((it, idx) => (
                <div
                  key={`${it.meetingClientSessionId}-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '9px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-card)',
                    border: '1px solid var(--border)',
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: 5,
                      border: '1.6px solid var(--border-strong)',
                      marginTop: 2,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ font: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 1.45 }}>
                      {it.text}
                    </span>
                    <button
                      onClick={() => openMeeting(it.meetingClientSessionId)}
                      style={{
                        alignSelf: 'flex-start',
                        font: 'var(--text-xs)',
                        color: 'var(--ink-4)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {S.project.fromMeeting} {it.meetingTitle || 'Untitled meeting'} →
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Reuniones del proyecto */}
        <Section
          title={S.project.meetings}
          count={project.meetings.length}
          icon={dIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'], 1.8, 16)}
          action={
            <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
              + {S.project.addMeeting}
            </Button>
          }
        >
          {project.meetings.length === 0 ? (
            <Empty text={S.project.meetingsEmpty} />
          ) : (
            project.meetings.map((m) => (
              <div key={m.clientSessionId} className="home-meeting-row" onClick={() => openMeeting(m.clientSessionId)}>
                <span className="home-meeting-icon">
                  {dIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'])}
                </span>
                <span className="home-meeting-info">
                  <span className="home-meeting-title">{m.title || 'Untitled meeting'}</span>
                  <span className="home-meeting-meta">
                    {PLATFORM_LABEL[m.platform]} · {formatRelativeDate(m.startedAt)}
                    {m.actionItemCount > 0 && <> · {S.project.itemsCount(m.actionItemCount)}</>}
                  </span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void unassign(m.clientSessionId)
                  }}
                  title={S.project.remove}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--radius-sm)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--ink-4)',
                    flexShrink: 0,
                  }}
                >
                  {dIcon('M6 6l12 12M18 6L6 18', 1.8, 15)}
                </button>
              </div>
            ))
          )}
        </Section>
      </div>

      {picking && (
        <AddMeetingPicker
          projectId={projectId}
          onClose={() => setPicking(false)}
          onAssigned={() => {
            setPicking(false)
            void refreshAll()
          }}
        />
      )}
    </Shell>
  )
}

function Shell({
  flow,
  onHome,
  onAsk,
  onSettings,
  children,
}: {
  flow: ReturnType<typeof loadFlow>
  onHome: () => void
  onAsk: () => void
  onSettings: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      <Sidebar workspace={flow.workspace} wsColorId={flow.wsColor} active="home" onHome={onHome} onAsk={onAsk} onSettings={onSettings} />
      <main style={{ flex: 1, overflowY: 'auto', position: 'relative', padding: '20px 40px 40px' }}>{children}</main>
    </div>
  )
}

function Section({
  title,
  count,
  icon,
  action,
  children,
}: {
  title: string
  count: number
  icon: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px' }}>
        <span style={{ color: 'var(--ink-3)', display: 'inline-flex' }}>{icon}</span>
        <span style={{ font: 'var(--label-sm)', fontSize: 14, color: 'var(--text-heading)' }}>{title}</span>
        <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)' }}>{count}</span>
        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      style={{
        font: 'var(--text-sm)',
        fontWeight: 400,
        color: 'var(--ink-4)',
        lineHeight: 1.5,
        padding: '14px 2px',
      }}
    >
      {text}
    </div>
  )
}

function Menu({
  onRename,
  status,
  onSetStatus,
  favorite,
  onToggleFavorite,
  onDelete,
}: {
  onRename: () => void
  status: ProjectStatus
  onSetStatus: (s: ProjectStatus) => void
  favorite: boolean
  onToggleFavorite: () => void
  onDelete: () => void
}): React.JSX.Element {
  const item: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    font: 'var(--text-sm)',
    color: 'var(--text-body)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '8px 12px',
    borderRadius: 'var(--radius-sm)',
  }
  const divider: React.CSSProperties = { height: 1, background: 'var(--border)', margin: '4px 0' }
  const heading: React.CSSProperties = {
    font: 'var(--eyebrow)',
    letterSpacing: 'var(--eyebrow-tracking)',
    color: 'var(--ink-4)',
    padding: '6px 12px 2px',
  }
  return (
    <div
      style={{
        position: 'absolute',
        top: 34,
        right: 0,
        zIndex: 11,
        minWidth: 184,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        padding: 4,
      }}
    >
      <button style={item} onClick={onRename}>
        {S.project.rename}
      </button>
      <button style={item} onClick={onToggleFavorite}>
        {favorite ? S.project.unfavorite : S.project.favorite}
      </button>
      <div style={divider} />
      <div style={heading}>{S.project.statusHeading}</div>
      {PROJECT_STATUSES.map((s) => (
        <button key={s} style={item} onClick={() => onSetStatus(s)}>
          <span style={{ width: 14, display: 'inline-flex', color: 'var(--accent-strong)' }}>
            {s === status ? dIcon('M20 6L9 17l-5-5', 2, 13) : null}
          </span>
          {PROJECT_STATUS_LABEL[s]}
        </button>
      ))}
      <div style={divider} />
      <button style={{ ...item, color: 'var(--danger)' }} onClick={onDelete}>
        {S.project.delete}
      </button>
    </div>
  )
}

// Descripción editable: textarea que crece; guarda al perder foco (patrón de
// las notas). Vacía muestra el placeholder — sin descripción no ocupa espacio.
function DescriptionField({
  initial,
  onSave,
}: {
  initial: string
  onSave: (value: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const [editing, setEditing] = useState(false)

  // Reflejar cambios externos (reload) cuando no se está editando.
  useEffect(() => {
    if (!editing) setValue(initial)
  }, [initial, editing])

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{
          font: 'var(--text-sm)',
          fontWeight: 400,
          lineHeight: 1.55,
          color: value ? 'var(--text-body)' : 'var(--ink-4)',
          background: 'transparent',
          border: 'none',
          cursor: 'text',
          textAlign: 'left',
          padding: 0,
          whiteSpace: 'pre-wrap',
        }}
      >
        {value || S.project.descriptionPlaceholder}
      </button>
    )
  }

  return (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        setEditing(false)
        onSave(value)
      }}
      placeholder={S.project.descriptionPlaceholder}
      rows={3}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        resize: 'vertical',
        font: 'var(--text-sm)',
        fontWeight: 400,
        lineHeight: 1.55,
        color: 'var(--text-body)',
        background: 'var(--surface-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        outline: 'none',
        padding: '8px 10px',
      }}
    />
  )
}

function RenameInput({
  initial,
  onDone,
  onCancel,
}: {
  initial: string
  onDone: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onDone(value)}
      style={{
        font: 'var(--display-md)',
        fontSize: 26,
        color: 'var(--text-heading)',
        background: 'transparent',
        border: 'none',
        borderBottom: '2px solid var(--border-strong)',
        outline: 'none',
        padding: '0 0 2px',
        minWidth: 220,
      }}
    />
  )
}

// Picker de reuniones a asignar: modal centrado con las reuniones que aún NO
// están en ESTE proyecto (las que ya están se excluyen; las de otro proyecto
// se pueden mover acá — assign reasigna).
function AddMeetingPicker({
  projectId,
  onClose,
  onAssigned,
}: {
  projectId: string
  onClose: () => void
  onAssigned: () => void
}): React.JSX.Element {
  const [items, setItems] = useState<MeetingListItem[] | null>(null)

  useEffect(() => {
    void window.uyari.meetings
      .list({ limit: 100 })
      .then((page) => setItems(page.items.filter((m) => m.projectId !== projectId)))
      .catch(() => setItems([]))
  }, [projectId])

  const assign = async (clientSessionId: string): Promise<void> => {
    await window.uyari.meetings.assignProject(clientSessionId, projectId)
    onAssigned()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        background: 'var(--scrim, rgba(20,18,30,0.32))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px 10px', font: 'var(--label-sm)', fontSize: 14, color: 'var(--text-heading)' }}>
          {S.project.addMeetingTitle}
        </div>
        <div style={{ overflowY: 'auto', padding: '0 8px 10px' }}>
          {items === null ? (
            <div style={{ padding: 18, font: 'var(--text-sm)', color: 'var(--ink-4)' }}>…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 18, font: 'var(--text-sm)', color: 'var(--ink-4)' }}>{S.project.addMeetingEmpty}</div>
          ) : (
            items.map((m) => (
              <button
                key={m.clientSessionId}
                onClick={() => void assign(m.clientSessionId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '9px 10px',
                  borderRadius: 'var(--radius-sm)',
                }}
                className="picker-row"
              >
                <span style={{ color: 'var(--ink-4)', display: 'inline-flex' }}>
                  {dIcon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'], 1.7, 16)}
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ font: 'var(--text-sm)', color: 'var(--text-heading)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.title || 'Untitled meeting'}
                  </span>
                  <span style={{ font: 'var(--text-xs)', color: 'var(--ink-4)' }}>
                    {PLATFORM_LABEL[m.platform]} · {formatRelativeDate(m.startedAt)}
                    {m.projectId && m.projectId !== projectId && <> · in another project</>}
                  </span>
                </span>
                <span style={{ color: 'var(--accent-strong)', font: 'var(--text-xs)', fontWeight: 600 }}>+</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
