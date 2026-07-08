import { BaseCaptureEngine } from './engine'

// Motor real de captura (fase 2). Plan, siguiendo el patrón validado en el
// research de Granola (os/granola-desktop.md):
//
//   1. Helper nativo (Swift) empaquetado en Resources/, lanzado como
//      child_process. Captura:
//        - audio del sistema: Core Audio process tap + aggregate device
//          (macOS 14.4+), excluyéndose a sí mismo para evitar eco
//        - micrófono: AVAudioEngine, alineado por timestamp
//      y escribe PCM crudo por stdout (o socket local), con mensajes de
//      control JSON por stderr/stdin.
//
//   2. STT streaming: WebSocket a Deepgram/AssemblyAI con token efímero
//      pedido al backend (nuevo endpoint /stt/token — la API key nunca
//      toca el cliente). Los resultados parciales/finales se normalizan
//      a CaptionSegment y se emiten con emitSegment().
//
// Requisitos previos: permisos TCC (micrófono + screen recording),
// firma Developer ID + notarización para distribuir el helper.

export class NativeCaptureEngine extends BaseCaptureEngine {
  async start(): Promise<void> {
    throw new Error(
      'NativeCaptureEngine pendiente: requiere el helper Swift de captura (ver desktop/README.md §Fase 2)',
    )
  }

  async stop(): Promise<void> {
    // no-op: nunca llegó a arrancar
  }
}
