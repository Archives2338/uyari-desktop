import type { AskAllCitation } from '@shared/domain'

// Historial de "Pregúntale a Uyari" (chat global) — LOCAL a este device
// (localStorage), no sincronizado al backend. El backend no tiene tablas
// de conversación todavía (solo responde preguntas con el contexto que le
// mandemos); persistir el hilo del lado del cliente es lo que alimenta
// "Recientes" (CH1) y el historial agrupado Hoy/Ayer (CH2) sin inventar
// una feature de sync entre dispositivos que no existe.
//
// Modelo: un THREAD con TURNOS (patrón `chat_thread`/`chat_message` con
// `turnIndex` de Granola, confirmado por RE en os/granola-desktop.md §1b —
// un mismo motor de chat, un follow-up es el turno N+1 del MISMO hilo, no
// una entrada nueva). v1 (pre-fix) trataba cada pregunta como su propia
// entrada — bug real que un usuario cazó probando: clickear un follow-up
// abría un chat nuevo en el sidebar en vez de continuar la conversación.

const KEY = 'uyari-desktop-ask-history-v2' // v1 era { question, answer } plano — shape incompatible
const MAX_THREADS = 100

export interface AskTurn {
  id: string
  question: string
  answer: string
  citations: AskAllCitation[]
  followUps: string[]
  createdAt: string
}

export interface AskThread {
  id: string
  /** Primera pregunta del hilo — se usa como título en Recientes/historial. */
  title: string
  turns: AskTurn[]
  createdAt: string
  /** Del último turno — determina el orden y el grupo Hoy/Ayer. */
  updatedAt: string
}

export function loadAskThreads(): AskThread[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AskThread[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAskThreads(list: AskThread[]): void {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_THREADS)))
}

/** Crea un hilo nuevo con un primer turno y persiste (más reciente primero). */
export function createAskThread(turn: AskTurn): AskThread[] {
  const thread: AskThread = {
    id: crypto.randomUUID(),
    title: turn.question,
    turns: [turn],
    createdAt: turn.createdAt,
    updatedAt: turn.createdAt,
  }
  const next = [thread, ...loadAskThreads()]
  saveAskThreads(next)
  return next
}

/** Agrega un turno a un hilo existente (follow-up) y lo sube al frente. */
export function appendAskTurn(threadId: string, turn: AskTurn): AskThread[] {
  const list = loadAskThreads()
  const idx = list.findIndex((t) => t.id === threadId)
  if (idx < 0) return list
  const updated: AskThread = { ...list[idx], turns: [...list[idx].turns, turn], updatedAt: turn.createdAt }
  const next = [updated, ...list.slice(0, idx), ...list.slice(idx + 1)]
  saveAskThreads(next)
  return next
}

/** Reemplaza un turno en su lugar (Regenerar) sin mover el hilo de posición. */
export function replaceAskTurn(threadId: string, turn: AskTurn): AskThread[] {
  const list = loadAskThreads()
  const next = list.map((t) =>
    t.id === threadId ? { ...t, turns: t.turns.map((x) => (x.id === turn.id ? turn : x)) } : t,
  )
  saveAskThreads(next)
  return next
}
