// Barras de audio animadas (mint) de la píldora de captura — señal de "grabando"
// del diseño NT1-B. El keyframe uyariBar vive en app.css.

const BARS = [0.9, 1.4, 1.1]

export function AudioBars(): React.JSX.Element {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 16 }}>
      {BARS.map((s, i) => (
        <span
          key={i}
          style={{
            width: 3.5,
            height: 11 * s,
            borderRadius: 2,
            background: 'var(--mint)',
            animation: `uyariBar ${0.9 + i * 0.25}s ease-in-out infinite`,
          }}
        />
      ))}
    </span>
  )
}
