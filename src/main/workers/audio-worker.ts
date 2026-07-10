import { NativeCaptureEngine } from '../services/capture/native.engine'
import type { SttProvider } from '../services/capture/stt-stream'
import type { MicControlPort } from '../services/capture/assemblyai.engine'
import type { MainToWorker, WorkerToMain } from '@shared/audio-worker'

// Entry del utilityProcess de audio. Aloja el NativeCaptureEngine COMPLETO
// (misma lógica probada: parse de frames, dedup de eco, respawn del helper, 2
// streams STT) — solo que ahora fuera del proceso main, para que la captura no
// compita con la UI ni pueda tumbar la ventana si se traba. Dos dependencias
// se proxian de vuelta al main: los tokens de STT y el control del mic del
// renderer. Ver worker.engine.ts (el otro extremo) y shared/audio-worker.ts.

// En el hijo, los mensajes del padre llegan como { data } por el evento
// 'message' de process.parentPort. No hay tipos de electron para esto aquí,
// así que lo tomamos con un cast acotado.
const port = process.parentPort
const send = (msg: WorkerToMain): void => port.postMessage(msg)
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// --- Proxy de tokens: se los pedimos al main (keychain/JWT viven allá) ---
let tokenSeq = 0
const tokenPending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void }
>()
const requestToken = (kind: 'stt' | 'deepgram'): Promise<unknown> => {
  const id = ++tokenSeq
  return new Promise((resolve, reject) => {
    tokenPending.set(id, { resolve, reject })
    send({ t: 'tokenReq', id, kind })
  })
}
const provider: SttProvider = {
  sttToken: () => requestToken('stt') as Promise<{ token: string }>,
  deepgramToken: () => requestToken('deepgram') as Promise<{ token: string; ephemeral: boolean }>,
}

// --- Proxy del mic del renderer (solo se usa en el fallback del engine) ---
const mic: MicControlPort = {
  start: (sampleRate) => send({ t: 'micStart', sampleRate }),
  stop: () => send({ t: 'micStop' }),
}

let engine: NativeCaptureEngine | null = null

const buildEngine = (helperBin: string): void => {
  engine = new NativeCaptureEngine(provider, mic, helperBin)
  engine.on('segment', (segment) => send({ t: 'segment', segment }))
  engine.on('status', (status, detail) => send({ t: 'status', status, detail }))
}

port.on('message', (e: { data: MainToWorker }) => {
  const msg = e.data
  switch (msg.t) {
    case 'start':
      buildEngine(msg.helperBin)
      engine!.start(msg.opts).then(
        () => send({ t: 'started' }),
        (err) => send({ t: 'startError', message: errMsg(err) }),
      )
      break
    case 'pause':
      void engine?.pauseCapture().then(() => send({ t: 'paused' }))
      break
    case 'resume':
      engine?.resumeCapture(msg.opts).then(
        () => send({ t: 'resumed' }),
        (err) => send({ t: 'resumeError', message: errMsg(err) }),
      )
      break
    case 'stop': {
      // Capturar los segundos ANTES del stop (mismo orden que MeetingService).
      const streamedSeconds = engine?.streamedSeconds() ?? 0
      const e2e = engine
      engine = null
      e2e?.removeAllListeners()
      void (e2e?.stop() ?? Promise.resolve()).then(() =>
        send({ t: 'stopped', streamedSeconds }),
      )
      break
    }
    case 'net':
      engine?.setNetworkOnline(msg.online)
      break
    case 'micChunk':
      engine?.acceptAudio(msg.chunk)
      break
    case 'tokenRes': {
      const p = tokenPending.get(msg.id)
      if (!p) break
      tokenPending.delete(msg.id)
      if (msg.errMsg !== undefined) {
        const err = new Error(msg.errMsg) as Error & { code?: string }
        if (msg.errCode) err.code = msg.errCode // preserva STT_QUOTA_EXCEEDED
        p.reject(err)
      } else {
        p.resolve(msg.value)
      }
      break
    }
  }
})
