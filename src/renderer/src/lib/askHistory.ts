import type { AskAllCitation } from '@shared/domain'

// Historial de "Pregúntale a Uyari" (chat global) — LOCAL a este device
// (localStorage), no sincronizado al backend. El backend no tiene un
// modelo de "conversación" todavía (solo responde preguntas sueltas, sin
// memoria); persistir el hilo del lado del cliente es lo que alimenta
// "Recientes" (CH1) y el historial agrupado Hoy/Ayer (CH2) sin inventar
// una feature de sync entre dispositivos que no existe.

const KEY = 'uyari-desktop-ask-history-v1'
const MAX_ITEMS = 100

export interface AskConversation {
  id: string
  question: string
  answer: string
  citations: AskAllCitation[]
  followUps: string[]
  createdAt: string
}

export function loadAskHistory(): AskConversation[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AskConversation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveAskHistory(list: AskConversation[]): void {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ITEMS)))
}

/** Agrega una conversación al frente (más reciente primero) y persiste. */
export function pushAskConversation(entry: AskConversation): AskConversation[] {
  const next = [entry, ...loadAskHistory()]
  saveAskHistory(next)
  return next
}
