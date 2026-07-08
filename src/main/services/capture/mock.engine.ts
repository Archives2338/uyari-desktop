import { randomUUID } from 'node:crypto'
import { BaseCaptureEngine } from './engine'

// Motor de captura falso para desarrollar UI y pipeline sin audio real:
// emite una conversación inventada a ritmo humano. Sirve para validar
// buffer → flush → backend → resumen de punta a punta.

const SCRIPT: Array<{ speaker: string; text: string }> = [
  { speaker: 'Ana Torres', text: 'Okay, let’s get started. Today we need to close the Q3 launch plan.' },
  { speaker: 'Luis Pérez', text: 'Quick update from my side: the onboarding flow is done and in review.' },
  { speaker: 'Ana Torres', text: 'Great. What’s still blocking the beta?' },
  { speaker: 'Luis Pérez', text: 'Mainly the permissions screen — screen recording needs better copy.' },
  { speaker: 'María Gómez', text: 'I can take that. I’ll have a draft by Thursday.' },
  { speaker: 'Ana Torres', text: 'Perfect. Action item for María: permissions copy by Thursday.' },
  { speaker: 'Luis Pérez', text: 'Also, pricing — do we start with the fifteen dollar plan?' },
  { speaker: 'Ana Torres', text: 'Yes, fifteen per month, five free hours on the trial.' },
  { speaker: 'María Gómez', text: 'Agreed. Let’s revisit after the first twenty users.' },
  { speaker: 'Ana Torres', text: 'Good meeting everyone. I’ll send the summary right after this.' },
]

export class MockCaptureEngine extends BaseCaptureEngine {
  private timer: NodeJS.Timeout | null = null
  private index = 0
  private startedAt = 0

  async start(): Promise<void> {
    this.index = 0
    this.startedAt = Date.now()
    this.emitStatus('recording')
    this.scheduleNext()
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      const line = SCRIPT[this.index % SCRIPT.length]
      this.emitSegment({
        providerMessageId: `mock-${randomUUID()}`,
        speaker: line.speaker,
        text: line.text,
        tsOffsetMs: Date.now() - this.startedAt,
      })
      this.index += 1
      this.scheduleNext()
    }, 1500 + Math.random() * 1500)
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.emitStatus('idle')
  }
}
