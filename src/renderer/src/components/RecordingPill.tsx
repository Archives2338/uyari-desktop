import { useApp } from '@renderer/store'
import { dIcon } from '@renderer/ui/chrome'
import { AudioBars } from '@renderer/screens/note/AudioBars'

// Píldora de grabación al centro-arriba del dashboard (patrón Granola): cuando
// la nota en vivo está minimizada al Home, este es el indicador + reingreso
// dentro de la app (distinto del nub flotante del borde, que es para cuando la
// app está en segundo plano). Cuerpo → vuelve a la nota; ✕ → termina.

export function RecordingPill(): React.JSX.Element | null {
  const session = useApp((s) => s.session)
  const restoreNote = useApp((s) => s.restoreNote)
  const stopCapture = useApp((s) => s.stopCapture)
  if (!session) return null
  const paused = session.status === 'paused'

  return (
    <div
      style={
        {
          position: 'fixed',
          top: 9,
          left: '50%',
          transform: 'translateX(-50%)',
          // Sobre la .drag-region (fixed, z:10) y fuera de la zona de arrastre.
          zIndex: 20,
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-pill)',
          boxShadow: 'var(--shadow-card)',
          padding: '5px 7px 5px 13px',
        } as React.CSSProperties
      }
    >
      <button
        onClick={() => restoreNote()}
        title="Volver a la nota"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 2px',
          color: 'var(--text-heading)',
          font: 'var(--label-sm)',
          fontSize: 13,
        }}
      >
        {paused ? (
          <span
            style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ink-4)' }}
          />
        ) : (
          <AudioBars />
        )}
        {session.title || 'Untitled'}
      </button>
      <button
        onClick={() => void stopCapture()}
        title="Terminar reunión"
        style={{
          display: 'inline-flex',
          width: 24,
          height: 24,
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          borderRadius: '50%',
          cursor: 'pointer',
          color: 'var(--ink-3)',
        }}
      >
        {dIcon('M18 6 6 18M6 6l12 12', 1.8, 15)}
      </button>
    </div>
  )
}
