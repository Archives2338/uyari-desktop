// Piezas compartidas por las 3 superficies de preguntas de la nota (QA3
// popover, QA1 sheet, QA4 paleta). Un solo motor (useAsk), distintas vistas.

/** Un turno del hilo de la nota. */
export type AskMsg =
  | { from: 'user'; text: string }
  | { from: 'uyari'; answer: string; cite: string }

/** Recetas rápidas (chips / paleta). */
export const NOTE_RECIPES = [
  '¿Qué me perdí?',
  'Redacta el follow-up',
  'Lista mis pendientes',
  'Escribe un TL;DR',
]

/** Icono "/" (slash) violeta que precede a las recetas. */
export const slashIcon = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--violet)"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="m14 5-4 14" />
  </svg>
)
