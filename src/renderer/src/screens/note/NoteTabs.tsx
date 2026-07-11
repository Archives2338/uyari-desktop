import { dIcon } from '@renderer/ui/chrome'

// Segmented "Mis notas | Notas de Uyari" (patrón panel de Granola). La pestaña
// Uyari muestra un spinner + "Generando…" mientras el resumen se genera; si no,
// la estrella 4 puntas violeta. Refleja el modelo de datos: userNotes y summary
// son capas separadas del mismo lienzo.

export type NoteTab = 'mine' | 'uyari'

/** Estrella de 4 puntas (marca del panel IA). */
export function aiStar(size = 13): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  )
}

export function NoteTabs({
  tab,
  onTab,
  status,
}: {
  tab: NoteTab
  onTab: (t: NoteTab) => void
  status: 'empty' | 'generating' | 'done' | 'failed'
}): React.JSX.Element {
  const seg = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    font: 'var(--label-sm)',
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--text-heading)' : 'var(--ink-4)',
    background: active ? 'var(--surface)' : 'transparent',
    borderRadius: 'var(--radius-pill)',
    padding: '7px 12px',
    cursor: 'pointer',
    boxShadow: active ? '0 1px 3px rgba(30,27,46,0.08)' : 'none',
    transition: 'background var(--dur-fast) var(--ease-out)',
  })
  return (
    <span
      style={{
        display: 'inline-flex',
        background: 'var(--sidebar, var(--surface-sunken))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-pill)',
        padding: 3,
      }}
    >
      <span onClick={() => onTab('mine')} style={seg(tab === 'mine')}>
        {dIcon('M4 7h16M4 12h10M4 17h13', 1.8, 15)}
        Mis notas
      </span>
      <span onClick={() => onTab('uyari')} style={seg(tab === 'uyari')}>
        {status === 'generating' ? (
          <span style={{ display: 'inline-flex', animation: 'uyariSpin 0.9s linear infinite' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--violet)" strokeWidth="2" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-9-9" />
            </svg>
          </span>
        ) : (
          aiStar(13)
        )}
        {status === 'generating' ? 'Generando…' : 'Notas de Uyari'}
      </span>
    </span>
  )
}
