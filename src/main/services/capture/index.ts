import type { CaptureEngine } from './engine'
import { MockCaptureEngine } from './mock.engine'
import { NativeCaptureEngine } from './native.engine'
import {
  AssemblyAiMicEngine,
  type MicControlPort,
  type SttTokenProvider,
} from './assemblyai.engine'

export type { CaptureEngine } from './engine'
export type { MicControlPort } from './assemblyai.engine'

export interface CaptureDeps {
  api: SttTokenProvider
  mic: MicControlPort
}

// Selección del motor por env var:
//   (default)            → native: mic ("You") + audio del sistema ("Them")
//                          vía helper Swift (fase 2c, patrón Granola)
//   UYARI_CAPTURE=mic    → solo micrófono (fase 2b)
//   UYARI_CAPTURE=mock   → conversación falsa (desarrollar UI sin API key)
export function createCaptureEngine(deps: CaptureDeps): CaptureEngine {
  switch (process.env.UYARI_CAPTURE) {
    case 'mock':
      return new MockCaptureEngine()
    case 'mic':
      return new AssemblyAiMicEngine(deps.api, deps.mic)
    default:
      return new NativeCaptureEngine(deps.api, deps.mic)
  }
}
