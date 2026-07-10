# Fase 5 — Notas editables (modelo de "documento" estilo Granola)

> **Decidido 2026-07-10.** Objetivo: pasar de "la nota = resumen IA de solo
> lectura" a un **documento** donde el usuario escribe SUS notas y la IA
> convive al lado (nunca las pisa), como Granola. Basado en la RE de Granola
> en `os/granola-desktop.md §1a/1b` y `granola-audit/03_notes/`.

## El insight que ordena todo

**Chat ≠ Notas.** El chat que ya construimos (hilos con turnos, citas,
`grouping_key`) SE PARECE al de Granola porque lo replicamos, pero las
"notas" son OTRA capa. Confundirlas hace creer que la feature está casi
lista cuando la parte difícil (el documento editable) está sin tocar.

| | Hoy en Uyari | "Nota" de Granola |
|---|---|---|
| Qué es | El `Summary` (markdown + action items) | Notas **editables del usuario** + N "paneles" IA al lado |
| ¿Escribible? | No — solo lectura | Sí — editor rico (scratchpad) |
| El resumen IA | *Es* la nota | Es un **panel** aparte, con "Restore" al original |
| Transcript | Entidad aparte | Entidad aparte (coincidimos) |

## Qué YA TRANSFIERE (no se reconstruye)

- **Modelo de hilos** (`AskThread`/turnos) = el `chat_thread` de Granola.
- **Citas** (`clientSessionId` → "Abrir nota →") ya enlazan chat ↔ reunión.
- **`grouping_key`**: hoy tenemos el chat global (`null`). El "chat DENTRO de
  una nota" es el MISMO código con `grouping_key = meetingId` — la inversión
  del chat escala 1:1 a chat-por-nota (Fase 5d). No se reescribe nada.

## Qué es NET-NEW (el trabajo real)

1. Un **campo/tabla de notas del usuario** por reunión (hoy `Meeting` no tiene
   ningún contenido escrito por el usuario).
2. Un **editor** en el detalle de la reunión (hoy `MeetingDetail` es 100%
   solo-lectura).
3. Reencuadrar el `Summary` de "la nota" a "un panel" que convive con las
   notas del usuario, con "Restore".

## Modelo de datos (decisión)

- **`Meeting.userNotes String?`** (markdown) = el scratchpad. Uno-a-uno con la
  reunión → un campo escalar alcanza; NO una tabla aparte todavía (sería
  sobre-ingeniería). Si algún día hay multi-doc o colaboración, se extrae a
  `Note`. El resumen IA (`Summary`) queda intacto y convive → ya cumple el
  principio "las notas del usuario nunca se pisan".
- **Paneles** (Fase 5c): tabla `Panel { meetingId, templateSlug, contentJson,
  originalContent }` cuando el resumen pase a ser un panel restaurable. El
  `Summary` actual se puede migrar a la primera fila de `Panel`.

## Fases (incremental, cada una validable en vivo)

- **5a — Fundación de datos + notas editables (ESTA PASADA).**
  `Meeting.userNotes` + endpoint `PUT /meetings/:id/notes` + IPC + una sección
  editable en `MeetingDetail` (arriba del resumen IA, como Granola) con
  **autosave debounced** (~800ms + save en blur/unmount; patrón throttle 500ms
  de Granola). Editor **simple** (textarea auto-crece) — el objetivo es probar
  el modelo de datos de punta a punta, no el editor rico todavía.

- **5b — Editor rico (TipTap).** Reemplazar el textarea por TipTap
  (ProseMirror, lo que usa Granola): headings, listas, checkboxes, negrita.
  Serializar a markdown (interop con el resto). Es swap de UI sobre la MISMA
  persistencia de 5a — por eso 5a usa un editor simple sin desperdiciar
  trabajo.

- **5c — Resumen como panel + Restore.** Tabla `Panel`; el resumen deja de ser
  "la nota" y pasa a un bloque anexo editable con `original_content` y botón
  "Restore" (copy de Granola: "Your original notes and transcript are safe").
  Botón "Generate/Enhance notes" re-ejecutable (ya tenemos `finish()` que
  genera; exponerlo como acción manual con template elegible).

- **5d — Chat por nota.** Extender `grouping_key` del chat: hoy global; agregar
  `meetingId` para un hilo scoped a esa reunión, embebido en `MeetingDetail`.
  El más BARATO — reusa el motor de chat entero. Por eso va al final.

## Orden y por qué

5a (datos) → 5b (editor rico) → 5c (panel+restore) → 5d (chat-por-nota).
Se arranca por la fundación de datos porque es lo que desbloquea todo lo demás
y es lo más contenido/verificable. El chat-por-nota va último justamente
porque el motor ya existe — es el tramo más corto.

## Fuera de alcance (por ahora)

- Selector de modelo (el "GPT-5.4 ▾" de Granola) — trivial de sumar cuando se
  quiera; hoy usamos un modelo fijo. No define la feature.
- Yjs/colaboración multi-usuario en tiempo real — solo si algún día hay
  co-edición. El modelo de campo escalar de 5a NO lo bloquea (se migra a ydoc
  si hace falta).
