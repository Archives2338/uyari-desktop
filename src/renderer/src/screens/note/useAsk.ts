import { useCallback, useState } from 'react'
import type { AskMsg } from './ask-common'

// Motor de preguntas de la nota (patrón del diseño: el estado vive acá, los
// contenedores solo lo presentan). Un solo hilo por nota, scopeado a la
// reunión activa — el equivalente al `chat_thread` con `grouping_key =
// documentId` de Granola. Contra el backend real (`meetings.ask`, una reunión).
//
// Reusable: el mismo hook puede alimentar un ⌘J global (alcance "todas las
// reuniones") cambiando la llamada por `meetings.askAll` — por eso vive suelto.

export interface UseAsk {
  msgs: AskMsg[]
  busy: boolean
  ask: (text: string) => void
  regenerate: () => void
}

export function useAsk(clientSessionId: string): UseAsk {
  const [msgs, setMsgs] = useState<AskMsg[]>([])
  const [busy, setBusy] = useState(false)

  // La llamada real al LLM + push de la respuesta. No toca los mensajes de
  // usuario (así `regenerate` reusa la última pregunta sin duplicarla).
  const run = useCallback(
    async (question: string): Promise<void> => {
      setBusy(true)
      try {
        const { answer } = await window.uyari.meetings.ask(clientSessionId, question)
        setMsgs((m) => [...m, { from: 'uyari', answer, cite: 'Esta nota' }])
      } catch {
        setMsgs((m) => [
          ...m,
          { from: 'uyari', answer: 'No pude responder ahora. Reintentá en un momento.', cite: '' },
        ])
      } finally {
        setBusy(false)
      }
    },
    [clientSessionId],
  )

  const ask = useCallback(
    (text: string): void => {
      const q = text.trim()
      if (!q || busy) return
      setMsgs((m) => [...m, { from: 'user', text: q }])
      void run(q)
    },
    [busy, run],
  )

  const regenerate = useCallback((): void => {
    if (busy) return
    const lastUser = [...msgs].reverse().find((m) => m.from === 'user')
    if (!lastUser || lastUser.from !== 'user') return
    // Quitar la última respuesta (si la hay) y re-preguntar la misma pregunta.
    setMsgs((m) => (m[m.length - 1]?.from === 'uyari' ? m.slice(0, -1) : m))
    void run(lastUser.text)
  }, [busy, msgs, run])

  return { msgs, busy, ask, regenerate }
}
