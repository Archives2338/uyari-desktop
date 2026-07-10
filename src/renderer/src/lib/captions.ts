import type { CaptionSegment } from '@shared/domain'

// El STT emite un "turn" por cada pausa corta, lo que produce burbujas de
// una frase. Para leerse como conversación, agrupamos turnos consecutivos
// del mismo hablante en un bloque, cortando solo ante una pausa larga o
// cuando el bloque ya es muy largo. Lo usan el Home y el nub flotante.

const GROUP_MAX_GAP_MS = 20_000
const GROUP_MAX_CHARS = 500

export interface CaptionGroup {
  key: string
  speaker?: string
  texts: string[]
}

export function groupCaptions(captions: CaptionSegment[]): CaptionGroup[] {
  const groups: CaptionGroup[] = []
  let lastOffset = 0
  let lastChars = 0
  for (const c of captions) {
    const prev = groups[groups.length - 1]
    const sameSpeaker = prev && prev.speaker === c.speaker
    const closeInTime = c.tsOffsetMs - lastOffset <= GROUP_MAX_GAP_MS
    if (prev && sameSpeaker && closeInTime && lastChars < GROUP_MAX_CHARS) {
      prev.texts.push(c.text)
      lastChars += c.text.length
    } else {
      groups.push({ key: c.providerMessageId, speaker: c.speaker, texts: [c.text] })
      lastChars = c.text.length
    }
    lastOffset = c.tsOffsetMs
  }
  return groups
}

/**
 * Dedupe por providerMessageId: la versión más nueva pisa a la anterior.
 * Texto VACÍO = retracción (el dedup de eco descartó un turno cuya versión
 * temprana ya se había pintado): se remueve de la lista.
 */
export function upsertCaption(list: CaptionSegment[], segment: CaptionSegment): CaptionSegment[] {
  const idx = list.findIndex((c) => c.providerMessageId === segment.providerMessageId)
  if (segment.text === '') {
    return idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list
  }
  if (idx >= 0) {
    const next = list.slice()
    next[idx] = segment
    return next
  }
  return [...list, segment]
}
