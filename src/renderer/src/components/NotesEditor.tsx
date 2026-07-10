import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'

// Editor rico de las notas del usuario (Fase 5b, sobre la persistencia de 5a).
// StarterKit trae negritas/itálicas/headings/listas/citas/código con atajos de
// markdown de fábrica ("# ", "- ", "**x**", "> "…) y de teclado (⌘B, ⌘I). Se
// persiste como HTML (userNotes es String en la BD). Todo local, sin nube ni
// API key — TipTap core + StarterKit son MIT, cero costo de licencia.

const PLACEHOLDER =
  'Jot down your own notes… they stay private to you, alongside the AI summary.'

// Notas legadas (Fase 5a) se guardaron como texto plano. Si el valor inicial no
// parece HTML, se convierte a párrafos para que TipTap no colapse los saltos de
// línea; si ya es HTML, se usa tal cual.
function toInitialContent(raw: string): string {
  if (!raw) return ''
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return raw
    .split('\n')
    .map((line) => `<p>${esc(line) || '<br>'}</p>`)
    .join('')
}

interface ToolButton {
  label: string
  title: string
  isActive: (e: Editor) => boolean
  run: (e: Editor) => void
}

const BUTTONS: ToolButton[] = [
  { label: 'B', title: 'Bold (⌘B)', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'I', title: 'Italic (⌘I)', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: 'H', title: 'Heading', isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '•', title: 'Bullet list', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '1.', title: 'Numbered list', isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: '"', title: 'Quote', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
]

export function NotesEditor({
  initialContent,
  onChange,
  onBlur,
}: {
  initialContent: string
  onChange: (html: string) => void
  onBlur: () => void
}): React.JSX.Element {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: PLACEHOLDER })],
    content: toInitialContent(initialContent),
    // El editor NO es controlado: se inicializa una vez y avisa cambios hacia
    // arriba. Vacío → '' (no '<p></p>') para que el autosave lo trate como sin
    // notas y no dispare un save espurio.
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
    onBlur: () => onBlur(),
    editorProps: { attributes: { class: 'notes-editor-content' } },
  })

  return (
    <div className="notes-editor">
      {editor && (
        <div className="notes-toolbar">
          {BUTTONS.map((b) => (
            <button
              key={b.title}
              type="button"
              className={`notes-tool${b.isActive(editor) ? ' is-active' : ''}`}
              title={b.title}
              // onMouseDown preventDefault: no perder la selección del editor al
              // clickear el botón.
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => b.run(editor)}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
