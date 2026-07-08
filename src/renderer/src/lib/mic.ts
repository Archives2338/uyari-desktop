// Captura de micrófono del renderer (getUserMedia solo existe aquí).
// El main la enciende/apaga vía ev:mic-control; los chunks PCM16 mono de
// ~50 ms (800 samples a 16 kHz, lo que pide AssemblyAI) vuelven por IPC.
//
// Nota: NO forzamos el sample rate del AudioContext — conectar un
// MediaStream a un contexto con rate distinto al del dispositivo es
// históricamente frágil en Chromium. Capturamos al rate nativo (típicamente
// 48 kHz) y downsampleamos a 16 kHz por interpolación lineal.

const CHUNK_MS = 50

const WORKLET_SOURCE = `
class UyariPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('uyari-pcm', UyariPcmProcessor)
`

let ctx: AudioContext | null = null
let stream: MediaStream | null = null
// Un stop() mientras getUserMedia sigue pendiente debe abortar ese arranque
// (si no, el mic queda encendido huérfano). Cada start incrementa la
// generación; tras cada await se comprueba que siga vigente.
let generation = 0

export async function startMic(targetRate: number): Promise<void> {
  const log = window.uyari.mic.log
  if (ctx) {
    log('startMic ignorado: ya hay un contexto activo')
    return
  }
  const gen = ++generation

  log('getUserMedia…')
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  if (gen !== generation) {
    log('start abortado: llegó stop durante getUserMedia')
    mediaStream.getTracks().forEach((t) => t.stop())
    return
  }
  stream = mediaStream
  log(`getUserMedia OK (track: ${stream.getAudioTracks()[0]?.label ?? 'sin label'})`)

  ctx = new AudioContext()
  const sourceRate = ctx.sampleRate
  log(`AudioContext OK (state=${ctx.state}, sampleRate=${sourceRate})`)
  // Chromium puede crear el contexto 'suspended' si no hubo gesto de
  // usuario reciente; sin resume() el worklet nunca procesa audio.
  if (ctx.state === 'suspended') {
    await ctx.resume()
    log(`AudioContext resumed (state=${ctx.state})`)
  }

  const workletUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
  )
  await ctx.audioWorklet.addModule(workletUrl)
  URL.revokeObjectURL(workletUrl)
  log('AudioWorklet cargado')

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'uyari-pcm')
  let firstFrame = true
  let firstChunk = true

  const chunkSize = Math.round((targetRate * CHUNK_MS) / 1000)
  const ratio = sourceRate / targetRate
  let pending = new Int16Array(chunkSize)
  let filled = 0
  // Restos entre callbacks para que el resampleo no pierda continuidad.
  let carry = new Float32Array(0)

  node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    if (firstFrame) {
      firstFrame = false
      log(`primer frame del worklet (${ev.data.length} samples)`)
    }
    const merged = new Float32Array(carry.length + ev.data.length)
    merged.set(carry)
    merged.set(ev.data, carry.length)

    // Downsample por interpolación lineal sourceRate → targetRate.
    const producible = Math.floor((merged.length - 1) / ratio)
    for (let i = 0; i < producible; i++) {
      const pos = i * ratio
      const i0 = Math.floor(pos)
      const frac = pos - i0
      const sample = merged[i0] * (1 - frac) + merged[i0 + 1] * frac
      const s = Math.max(-1, Math.min(1, sample))
      pending[filled++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (filled === chunkSize) {
        if (firstChunk) {
          firstChunk = false
          log(`primer chunk PCM16 enviado por IPC (${pending.buffer.byteLength} bytes)`)
        }
        window.uyari.mic.chunk(pending.buffer)
        pending = new Int16Array(chunkSize)
        filled = 0
      }
    }
    const consumed = Math.floor(producible * ratio)
    carry = merged.slice(consumed)
  }

  source.connect(node)
  // Sin salida audible; ganancia 0 evita que Chromium suspenda el grafo.
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute)
  mute.connect(ctx.destination)
}

export function stopMic(): void {
  generation += 1 // invalida cualquier startMic aún pendiente
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void ctx?.close()
  ctx = null
}
