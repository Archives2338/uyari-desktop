import type { CaptureEngine } from './engine'
import { MockCaptureEngine } from './mock.engine'
import { NativeCaptureEngine } from './native.engine'
import { WorkerCaptureEngine } from './worker.engine'
import { AssemblyAiMicEngine, type MicControlPort } from './assemblyai.engine'
import type { SttProvider } from './stt-stream'

export type { CaptureEngine } from './engine'
export type { MicControlPort } from './assemblyai.engine'

export interface CaptureDeps {
  // El ApiClient implementa ambos proveedores de token (AssemblyAI + Deepgram);
  // el canal STT elige según UYARI_STT.
  api: SttProvider
  mic: MicControlPort
  /** Ruta absoluta del binario del helper de audio (la resuelve el main). */
  helperBin: string
  /** Ruta del bundle del utilityProcess de audio (out/main/audio-worker.js). */
  workerPath: string
}

// Selección del motor por env var:
//   (default)            → native: mic ("You") + audio del sistema ("Them")
//                          vía helper Swift (fase 2c, patrón Granola), TODO en
//                          el proceso main.
//   UYARI_CAPTURE=native-worker
//                        → igual que native pero el pegamento JS corre en un
//                          utilityProcess aparte (aísla la captura de la UI y
//                          de fallas; patrón del servicio `audio` de Granola).
//   UYARI_CAPTURE=mic    → solo micrófono (fase 2b)
//   UYARI_CAPTURE=mock   → conversación falsa (desarrollar UI sin API key)
export function createCaptureEngine(deps: CaptureDeps): CaptureEngine {
  switch (process.env.UYARI_CAPTURE) {
    case 'mock':
      return new MockCaptureEngine()
    case 'mic':
      return new AssemblyAiMicEngine(deps.api, deps.mic)
    case 'native-worker':
      return new WorkerCaptureEngine(deps.api, deps.mic, deps.workerPath, deps.helperBin)
    default:
      return new NativeCaptureEngine(deps.api, deps.mic, deps.helperBin)
  }
}
