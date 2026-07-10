// uyari-audio-helper — captura DOS canales de audio (patrón Granola):
//   canal 0: MICRÓFONO vía AVAudioEngine con voice processing del sistema
//            (la AEC de Apple resta lo que suena por los parlantes → la voz
//            de los demás NO se cuela en tu canal, incluso sin audífonos)
//   canal 1: AUDIO DEL SISTEMA (los demás participantes) vía Core Audio
//            process tap global mono que EXCLUYE a nuestro propio proceso,
//            montado en un aggregate device privado (macOS 14.4+).
// Sin driver virtual, sin bot.
//
// Protocolo con el proceso Electron (frames binarios fijos):
//   stdout : frames de 1601 bytes = [1 byte canal][1600 bytes PCM16LE mono
//            a 16 kHz = 800 samples = 50 ms] — mismo formato que el STT.
//   stderr : logs legibles.
//   stdin  : EOF = el padre murió o pidió cierre → limpiar y salir.
//
// Permisos TCC: micrófono + "System Audio Recording" (Privacy & Security →
// Screen & System Audio Recording). El responsable es el app padre
// (Electron en dev; la app firmada con NSAudioCaptureUsageDescription en
// prod).

import Foundation
import CoreAudio
import AudioToolbox
import AVFoundation
import CoreGraphics

let TARGET_RATE = 16_000.0
let CHUNK_SAMPLES = 800 // 50 ms a 16 kHz
let CHANNEL_MIC: UInt8 = 0
let CHANNEL_SYSTEM: UInt8 = 1

let bootTime = DispatchTime.now()

func log(_ message: String) {
    let elapsedMs = (DispatchTime.now().uptimeNanoseconds - bootTime.uptimeNanoseconds) / 1_000_000
    FileHandle.standardError.write(("[helper +\(elapsedMs)ms] " + message + "\n").data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
    log("FATAL: " + message)
    exit(1)
}

// --- Escritor a stdout: acumula por canal y emite frames [canal|PCM] ---

final class FrameWriter {
    private let lock = NSLock()
    private var pending: [UInt8: Data] = [CHANNEL_MIC: Data(), CHANNEL_SYSTEM: Data()]
    private var outbox = Data()
    private let out = FileHandle.standardOutput
    private let chunkBytes = CHUNK_SAMPLES * 2

    func append(channel: UInt8, samples: [Int16]) {
        lock.lock()
        samples.withUnsafeBufferPointer { pending[channel]!.append(Data(buffer: $0)) }
        while pending[channel]!.count >= chunkBytes {
            outbox.append(channel)
            outbox.append(pending[channel]!.prefix(chunkBytes))
            pending[channel]!.removeFirst(chunkBytes)
        }
        lock.unlock()
    }

    func startFlushing() {
        Thread.detachNewThread { [self] in
            while true {
                Thread.sleep(forTimeInterval: 0.025)
                lock.lock()
                let ready = outbox
                outbox = Data()
                lock.unlock()
                if !ready.isEmpty { out.write(ready) }
            }
        }
    }
}

// ============================================================
// MODO --mic-monitor: auto-detección de reunión (estilo Granola)
// Sin capturar nada: solo reporta qué apps están USANDO el micrófono
// (kAudioProcessPropertyIsRunningInput). Una línea JSON por cambio:
//   {"event":"mic-apps","apps":["us.zoom.xos", ...]}
// ============================================================

func activeInputBundleIDs() -> Set<String> {
    var listAddress = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &listAddress, 0, nil, &size
    ) == noErr else { return [] }
    var processes = [AudioObjectID](
        repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size
    )
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &listAddress, 0, nil, &size, &processes
    ) == noErr else { return [] }

    var result: Set<String> = []
    for process in processes {
        var runningAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyIsRunningInput,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var running: UInt32 = 0
        var runningSize = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(
            process, &runningAddress, 0, nil, &runningSize, &running
        ) == noErr, running == 1 else { continue }

        var bundleAddress = AudioObjectPropertyAddress(
            mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var bundleID: CFString? = nil
        var bundleSize = UInt32(MemoryLayout<CFString?>.size)
        let status = withUnsafeMutablePointer(to: &bundleID) { ptr in
            AudioObjectGetPropertyData(process, &bundleAddress, 0, nil, &bundleSize, ptr)
        }
        if status == noErr, let id = bundleID as String?, !id.isEmpty {
            result.insert(id)
        }
    }
    return result
}

func runMicMonitor() -> Never {
    log("modo mic-monitor: vigilando qué apps usan el micrófono")
    watchStdinEOF()
    var last: Set<String> = []
    while true {
        let apps = activeInputBundleIDs()
        if apps != last {
            last = apps
            let payload: [String: Any] = ["event": "mic-apps", "apps": Array(apps).sorted()]
            if let data = try? JSONSerialization.data(withJSONObject: payload) {
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write("\n".data(using: .utf8)!)
            }
        }
        Thread.sleep(forTimeInterval: 2)
    }
}

/// El padre murió o cerró el pipe → salir (vale para ambos modos).
func watchStdinEOF() {
    Thread.detachNewThread {
        while FileHandle.standardInput.availableData.count > 0 {}
        exit(0)
    }
}

// ============================================================
// MODO --check-permissions: estado REAL del permiso que de verdad usamos.
//
// OJO: NO es "Screen Recording" (captura de pantalla). Nuestro canal de
// audio del sistema es un Core Audio process tap (macOS 14.4+), que usa el
// permiso "System Audio Recording" — la sección "Sólo grabación de audio
// del sistema" de Ajustes, DISTINTA de captura de pantalla. Ahí es donde
// aparece Granola. CGPreflightScreenCaptureAccess miraba el permiso
// equivocado.
//
// Fuente de verdad = intentar crear el tap: si el permiso no está, falla.
// Como este helper es un proceso recién lanzado, no arrastra el cache de
// TCC por-proceso que deja a Electron pegado en "denied" (electron#36722).
// Una línea JSON por stdout: {"audio":true|false}
// ============================================================

if CommandLine.arguments.contains("--check-permissions") {
    let probeDescription = CATapDescription(monoGlobalTapButExcludeProcesses: [])
    probeDescription.isPrivate = true
    var probeTap = AudioObjectID(kAudioObjectUnknown)
    let probeStatus = AudioHardwareCreateProcessTap(probeDescription, &probeTap)
    let granted = probeStatus == noErr
    if granted { AudioHardwareDestroyProcessTap(probeTap) }
    print("{\"audio\":\(granted)}")
    exit(0)
}

if CommandLine.arguments.contains("--mic-monitor") {
    runMicMonitor()
}

let writer = FrameWriter()
writer.startFlushing()

// --- Downsampler lineal continuo float32 @ sourceRate → int16 @ 16 kHz ---

final class Downsampler {
    private let ratio: Double
    private var carry: [Float] = []

    init(sourceRate: Double) {
        self.ratio = sourceRate / TARGET_RATE
    }

    func process(_ input: [Float]) -> [Int16] {
        var mono = carry
        mono.append(contentsOf: input)
        let producible = Int(Double(mono.count - 1) / ratio)
        guard producible > 0 else {
            carry = mono
            return []
        }
        var out = [Int16](repeating: 0, count: producible)
        for i in 0..<producible {
            let pos = Double(i) * ratio
            let i0 = Int(pos)
            let frac = Float(pos - Double(i0))
            let sample = mono[i0] * (1 - frac) + mono[i0 + 1] * frac
            let clamped = max(-1, min(1, sample))
            out[i] = Int16(clamped < 0 ? clamped * 32768 : clamped * 32767)
        }
        let consumed = Int(Double(producible) * ratio)
        carry = Array(mono[min(consumed, mono.count)...])
        return out
    }
}

// ============================================================
// AEC3 (Fase B del plan AUHAL/AEC3): el APM de WebRTC cancela del mic lo
// que suena por los parlantes, usando el tap de sistema como referencia.
// Solo existe en modo UYARI_MIC=auhal (el modo vp usa la AEC de Apple).
// ============================================================

// Modo de captura del mic:
//   "auto"  (default) → HÍBRIDO: se decide al arrancar según la salida de
//           audio — auriculares → auhal (sin eco físico: arranque 200ms,
//           inmune al bug de arbitraje VP, indicador se apaga en pausa);
//           parlantes → vp (la AEC de Apple sigue siendo la mejor opción
//           disponible para cancelar parlantes; nuestro AEC3 propio queda
//           para cuando cierre la brecha en ese caso).
//   "auhal" → forzar mic crudo + AEC3 propio.
//   "vp"    → forzar AVAudioEngine + voice processing de Apple.
// Se resuelve en el arranque (ver dispatcher); var porque "auto" se
// reemplaza por el modo elegido.
var micMode = ProcessInfo.processInfo.environment["UYARI_MIC"] ?? "auto"

// El APM se crea en startMicAuhal(), cuando se conocen las rates REALES de
// ambos streams: el AEC corre a la rate NATIVA de cada dispositivo (48 kHz
// típico), ANTES de nuestro downsample a 16 kHz. Motivo: el downsampler
// lineal no tiene filtro anti-aliasing — al bajar 48k→16k el contenido de
// 8-16 kHz se pliega, y se pliega DISTINTO en la referencia digital que en
// el eco que pasó por parlante+aire+mic; esa diferencia es imposible de
// modelar para el filtro lineal del AEC (cancelación pobre). A rate nativa
// no hay plegado y el AEC ve el espectro completo.
var apmHandle: OpaquePointer? = nil
var apmCaptureRate = 0
// Diagnóstico: el primer error de cada lado del APM se loguea una vez (un
// error persistente = ese stream NO se está procesando).
var apmRenderErrLogged = false
var apmCaptureErrLogged = false
// Pico reciente del render (far-end) y del mic CRUDO (pre-AEC), con
// decaimiento, para el gate de eco residual (ver processPair).
var renderPeakRecent: Int32 = 0
var rawMicPeakRecent: Int32 = 0

func floatsToInt16(_ input: [Float]) -> [Int16] {
    var out = [Int16](repeating: 0, count: input.count)
    for i in 0..<input.count {
        let clamped = max(-1, min(1, input[i]))
        out[i] = Int16(clamped < 0 ? clamped * 32768 : clamped * 32767)
    }
    return out
}

func int16ToFloats(_ input: [Int16]) -> [Float] {
    var out = [Float](repeating: 0, count: input.count)
    for i in 0..<input.count { out[i] = Float(input[i]) / 32768 }
    return out
}

// ============================================================
// AecAligner — captura ALINEADA POR TIMESTAMP (réplica del
// deque<TimestampedAudioBuffer> de Granola, confirmado por RE de su binario:
// -[CombinedAudioCapture processInputBuffer:startTime:fromMicrophone:] usa
// TimestampedAudioBuffer + SlicedAudioBuffer para alinear mic y sistema).
//
// El problema: el AEC3 solo cancela bien si el render (sistema/far-end) y el
// capture (mic/near-end) llegan ALINEADOS en el tiempo. Con dos callbacks en
// threads/relojes distintos alimentados en ORDEN DE LLEGADA, el jitter entre
// ambos limita la convergencia del filtro lineal (~17 dB medido, donde un
// AEC3 alineado da 30-40 dB).
//
// La solución: cada buffer se ubica en una línea de tiempo COMÚN por su
// mHostTime (reloj mach, compartido entre dispositivos). Un worker tira
// frames de 10 ms del MISMO instante de ambos anillos y alimenta el AEC en
// lockstep (render primero, capture después). El playhead lo maneja el mic
// (que fluye continuo); el sistema se lee como escrito-o-cero (silencio del
// tap = ceros, sin desincronizar). El margen absorbe el jitter entre threads.
final class AecAligner {
    private let rate: Double
    private let frame: Int
    private let cap: Int
    private let margin: Int64
    private var sys: [Float]
    private var mic: [Float]
    private var sysEnd: Int64 = 0
    private var micEnd: Int64 = 0
    private var micFirst: Int64 = -1
    private var haveT0 = false
    private var t0Nanos: UInt64 = 0
    private var playhead: Int64 = 0
    private var started = false
    private let lock = NSLock()
    private var worker: Thread?
    // Recibe cada frame de mic ya LIMPIO (48 kHz float) para downsamplear+STT.
    var onCleanMic: (([Float]) -> Void)?

    init(rate: Double, frame: Int) {
        self.rate = rate
        self.frame = frame
        self.cap = Int(rate) // 1 s de anillo (holgura enorme vs el margen)
        self.margin = Int64(frame * 3) // ~30 ms de absorción de jitter
        self.sys = [Float](repeating: 0, count: cap)
        self.mic = [Float](repeating: 0, count: cap)
    }

    private func hostToSample(_ host: UInt64) -> Int64 {
        let nanos = AudioConvertHostTimeToNanos(host)
        if !haveT0 {
            t0Nanos = nanos
            haveT0 = true
        }
        return Int64(Double(Int64(nanos) &- Int64(t0Nanos)) * rate / 1_000_000_000.0)
    }

    private func write(_ ring: inout [Float], _ end: inout Int64, at start: Int64, _ s: [Float]) {
        // Reordenamiento raro o salto enorme (pausa): clampear para no barrer
        // todo el anillo con ceros.
        var pos = start
        if start - end > Int64(cap) || start < end - Int64(cap) { end = start }
        // Rellenar el hueco entre lo escrito y el nuevo start con ceros.
        while end < start {
            ring[Int(end % Int64(cap))] = 0
            end += 1
        }
        for (i, v) in s.enumerated() {
            ring[Int((start + Int64(i)) % Int64(cap))] = v
        }
        pos = start + Int64(s.count)
        if pos > end { end = pos }
    }

    func pushSystem(_ samples: [Float], hostTime: UInt64) {
        lock.lock(); defer { lock.unlock() }
        let start = hostToSample(hostTime)
        write(&sys, &sysEnd, at: start, samples)
    }

    func pushMic(_ samples: [Float], hostTime: UInt64) {
        lock.lock(); defer { lock.unlock() }
        let start = hostToSample(hostTime)
        if micFirst < 0 { micFirst = start }
        write(&mic, &micEnd, at: start, samples)
    }

    func reset() {
        lock.lock(); defer { lock.unlock() }
        sysEnd = 0; micEnd = 0; micFirst = -1; playhead = 0
        haveT0 = false; started = false
    }

    func start() {
        let t = Thread { [self] in
            while !Thread.current.isCancelled {
                usleep(5000)
                var pairs: [(s: [Float], m: [Float])] = []
                lock.lock()
                if !started, micFirst >= 0 {
                    // Arrancar donde el mic empezó (el sistema previo, si lo
                    // hay, ya está en el anillo; lo que falte se lee como cero).
                    playhead = micFirst
                    started = true
                }
                if started {
                    while micEnd - playhead >= Int64(frame) + margin {
                        var sf = [Float](repeating: 0, count: frame)
                        var mf = [Float](repeating: 0, count: frame)
                        for i in 0..<frame {
                            let p = playhead + Int64(i)
                            sf[i] = p < sysEnd ? sys[Int(p % Int64(cap))] : 0
                            mf[i] = mic[Int(p % Int64(cap))]
                        }
                        pairs.append((sf, mf))
                        playhead += Int64(frame)
                    }
                }
                lock.unlock()
                for pr in pairs { processPair(pr.s, pr.m) }
            }
        }
        t.stackSize = 512 * 1024
        worker = t
        t.start()
    }

    func stop() {
        worker?.cancel()
        worker = nil
    }

    // Procesa un par render/capture ALINEADO por el AEC (fuera del lock — el
    // trabajo pesado no bloquea a los callbacks de audio). render y capture
    // corren siempre en ESTE hilo → sin carrera cross-thread en el APM.
    private func processPair(_ sysF: [Float], _ micF: [Float]) {
        guard let apm = apmHandle else { onCleanMic?(micF); return }
        var sysI = floatsToInt16(sysF)
        var micI = floatsToInt16(micF)

        var rpeak: Int32 = 0
        for s in sysI where Int32(s.magnitude) > rpeak { rpeak = Int32(s.magnitude) }
        renderPeakRecent = max(rpeak, renderPeakRecent - (renderPeakRecent >> 4))
        sysI.withUnsafeMutableBufferPointer {
            let st = apm_process_render(apm, $0.baseAddress)
            if st != 0 && !apmRenderErrLogged {
                apmRenderErrLogged = true
                log("AEC3: process_render devolvió \(st) — el far-end NO se procesa")
            }
        }

        var rawPeak: Int32 = 0
        for s in micI where Int32(s.magnitude) > rawPeak { rawPeak = Int32(s.magnitude) }
        rawMicPeakRecent = max(rawPeak, rawMicPeakRecent - (rawMicPeakRecent >> 4))
        micI.withUnsafeMutableBufferPointer {
            let st = apm_process_capture(apm, $0.baseAddress)
            if st != 0 && !apmCaptureErrLogged {
                apmCaptureErrLogged = true
                log("AEC3: process_capture devolvió \(st) — el mic NO se procesa")
            }
        }

        // GATE de eco residual: si el sistema suena fuerte y el AEC removió
        // >85% del frame (salida <15% del pico crudo), era eco → a cero. La
        // voz del usuario en double-talk (ratio 0.3-0.6) pasa. Bypass con
        // auriculares no actúa.
        if !aecBypassedNow(), renderPeakRecent > 3000, rawMicPeakRecent > 0 {
            var fpeak: Int32 = 0
            for s in micI where Int32(s.magnitude) > fpeak { fpeak = Int32(s.magnitude) }
            if fpeak < rawMicPeakRecent * 15 / 100 && fpeak < 3000 {
                for i in 0..<micI.count { micI[i] = 0 }
            }
        }
        onCleanMic?(int16ToFloats(micI))
    }
}

var aecAligner: AecAligner?

// ============================================================
// CANAL 1: audio del sistema (Core Audio process tap)
// ============================================================

func ownProcessAudioObject() -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var pid = pid_t(ProcessInfo.processInfo.processIdentifier)
    var objectID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = withUnsafeMutablePointer(to: &pid) { pidPtr in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address,
            UInt32(MemoryLayout<pid_t>.size), pidPtr, &size, &objectID
        )
    }
    if status != noErr { fail("no pude traducir mi PID a AudioObject (err \(status))") }
    return objectID
}

let tapDescription = CATapDescription(monoGlobalTapButExcludeProcesses: [ownProcessAudioObject()])
tapDescription.name = "Uyari-Audio-Tap"
tapDescription.isPrivate = true
// muteBehavior default = CATapUnmuted (verificado en CATapDescription.h)

var tapID = AudioObjectID(kAudioObjectUnknown)
let tapStatus = AudioHardwareCreateProcessTap(tapDescription, &tapID)
if tapStatus != noErr {
    fail("AudioHardwareCreateProcessTap falló (err \(tapStatus)) — ¿permiso de System Audio Recording?")
}
log("tap creado (id \(tapID))")

var formatAddress = AudioObjectPropertyAddress(
    mSelector: kAudioTapPropertyFormat,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
var tapFormat = AudioStreamBasicDescription()
var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
if AudioObjectGetPropertyData(tapID, &formatAddress, 0, nil, &formatSize, &tapFormat) != noErr {
    fail("no pude leer el formato del tap")
}
log("formato del tap: \(tapFormat.mSampleRate) Hz, \(tapFormat.mChannelsPerFrame) canal(es)")

let aggregateDescription: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Uyari-Aggregate-Audio-Device",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [] as [[String: Any]],
    kAudioAggregateDeviceTapListKey: [
        [kAudioSubTapUIDKey: tapDescription.uuid.uuidString]
    ],
]
var aggregateID = AudioObjectID(kAudioObjectUnknown)
if AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &aggregateID) != noErr {
    fail("no pude crear el aggregate device")
}
log("aggregate device creado (id \(aggregateID))")

let systemRate = tapFormat.mSampleRate > 0 ? tapFormat.mSampleRate : 48_000
let systemDownsampler = Downsampler(sourceRate: systemRate)
var firstSystemFrame = true
var firstMicFrame = true

var ioProcID: AudioDeviceIOProcID?
let ioStatus = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, nil) {
    _, inInputData, inInputTime, _, _ in
    let bufferList = UnsafeMutableAudioBufferListPointer(
        UnsafeMutablePointer(mutating: inInputData)
    )
    guard let first = bufferList.first, let rawData = first.mData else { return }
    let channels = Int(first.mNumberChannels)
    let floatCount = Int(first.mDataByteSize) / MemoryLayout<Float>.size
    let floats = rawData.bindMemory(to: Float.self, capacity: floatCount)

    let frames = floatCount / max(channels, 1)
    var mono = [Float]()
    mono.reserveCapacity(frames)
    for f in 0..<frames {
        if channels <= 1 {
            mono.append(floats[f])
        } else {
            var sum: Float = 0
            for c in 0..<channels { sum += floats[f * channels + c] }
            mono.append(sum / Float(channels))
        }
    }
    // Far-end del AEC3: al alineador con el timestamp de captura del buffer
    // (mHostTime) para ubicarlo en la línea de tiempo común. El alineador
    // corre el AEC en su worker; acá NO se procesa nada del mic.
    let ts = inInputTime.pointee
    let hostTime = (ts.mFlags.contains(.hostTimeValid) && ts.mHostTime != 0)
        ? ts.mHostTime : mach_absolute_time()
    aecAligner?.pushSystem(mono, hostTime: hostTime)
    // El canal "Them" del STT recibe el audio tal cual (el AEC solo toca el mic).
    let pcm = systemDownsampler.process(mono)
    if !pcm.isEmpty {
        if firstSystemFrame {
            firstSystemFrame = false
            log("canal sistema: primer frame emitido")
        }
        writer.append(channel: CHANNEL_SYSTEM, samples: pcm)
    }
}
if ioStatus != noErr || ioProcID == nil { fail("no pude crear el IOProc (err \(ioStatus))") }
if AudioDeviceStart(aggregateID, ioProcID) != noErr { fail("no pude arrancar el aggregate device") }
log("canal sistema: capturando a \(Int(systemRate)) Hz → 16 kHz")

// ============================================================
// CANAL 0: micrófono con voice processing (AEC del sistema)
//
// BUG CONOCIDO de macOS: cuando otra app de voz (Zoom) tiene su propia
// sesión de voice processing viva y la nuestra se rearma rápido (parar y
// volver a grabar durante la MISMA llamada), el sistema puede entregar
// SILENCIO ABSOLUTO (ceros exactos) del mic. Un mic real siempre tiene
// piso de ruido > 0 — ceros sostenidos = sesión VP muerta. Watchdog:
// 4 s de ceros → reinicia el motor de voz; si sigue mudo, última carta
// SIN voice processing (se pierde la AEC pero hay audio).
// ============================================================

var micEngine: AVAudioEngine?
var micPeak: Float = 0 // pico de la ventana actual del watchdog
// Pausa suave: detenemos la captura SIN soltar el voice processing, para que
// el resume sea instantáneo (re-armar el VP de Apple cuesta ~1s). Ver
// pauseCapture()/resumeCapture() y el protocolo de stdin al final.
var paused = false

@discardableResult
func startMic(useVoiceProcessing: Bool) -> Bool {
    if let old = micEngine {
        old.inputNode.removeTap(onBus: 0)
        try? old.inputNode.setVoiceProcessingEnabled(false)
        old.stop()
        micEngine = nil
    }
    let engine = AVAudioEngine()
    let input = engine.inputNode
    if useVoiceProcessing {
        do {
            // La pieza clave anti-duplicados: la AEC de Apple resta del mic
            // lo que el Mac está reproduciendo (la voz de los demás).
            try input.setVoiceProcessingEnabled(true)
            log("voice processing (AEC del sistema) activado en el mic")
        } catch {
            log("AVISO: no pude activar voice processing (\(error)) — el mic puede colar el audio de los parlantes")
        }
        if #available(macOS 14.0, *) {
            // Sin ducking: que el sistema no baje el volumen de la reunión.
            input.voiceProcessingOtherAudioDuckingConfiguration =
                AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
                    enableAdvancedDucking: false,
                    duckingLevel: .min
                )
        }
    } else {
        log("mic SIN voice processing (AEC off) — modo de rescate")
    }

    let format = input.outputFormat(forBus: 0)
    let downsampler = Downsampler(sourceRate: format.sampleRate)
    input.installTap(onBus: 0, bufferSize: 2400, format: format) { buffer, _ in
        guard let channelData = buffer.floatChannelData else { return }
        let frames = Int(buffer.frameLength)
        let mono = Array(UnsafeBufferPointer(start: channelData[0], count: frames))
        for s in mono where abs(s) > micPeak { micPeak = abs(s) }
        let pcm = downsampler.process(mono)
        if !pcm.isEmpty {
            if firstMicFrame {
                firstMicFrame = false
                log("canal mic: primer frame emitido")
            }
            writer.append(channel: CHANNEL_MIC, samples: pcm)
        }
    }
    do {
        try engine.start()
        micEngine = engine
        log("canal mic: capturando a \(Int(format.sampleRate)) Hz → 16 kHz\(useVoiceProcessing ? "" : " (sin AEC)")")
        return true
    } catch {
        log("no pude arrancar el mic (\(error))")
        return false
    }
}

// ============================================================
// CANAL 0 (modo alternativo, Fase A del plan AUHAL/AEC3): micrófono CRUDO
// vía AUHAL — sin voice processing de Apple. Elimina de raíz el bug de
// arbitraje VP (mic mudo) y el warm-up de ~1s del arranque en frío.
// La cancelación de eco la hace el AEC3 de WebRTC (ver sección AEC3 arriba)
// con el tap de sistema como referencia — no la caja negra de Apple. Vive
// detrás del flag UYARI_MIC=auhal (default: vp) hasta pasar la QA de eco.
// ============================================================

var auhalUnit: AudioComponentInstance?
var auhalDownsampler: Downsampler?
// Buffer preasignado para AudioUnitRender: el callback de entrada corre en
// el hilo de tiempo real — nada de allocs ahí. 16384 frames cubre cualquier
// buffer size de dispositivo razonable.
let AUHAL_MAX_FRAMES = 16384
let auhalRenderMem = UnsafeMutablePointer<Float>.allocate(capacity: AUHAL_MAX_FRAMES)

// Callback C de entrada (sin capturas → convertible a puntero de función C).
// Consume vía globals, como el resto del helper.
let auhalInputProc: AURenderCallback = { _, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, _ in
    guard let unit = auhalUnit, inNumberFrames <= AUHAL_MAX_FRAMES else { return noErr }
    var abl = AudioBufferList(
        mNumberBuffers: 1,
        mBuffers: AudioBuffer(
            mNumberChannels: 1,
            mDataByteSize: UInt32(AUHAL_MAX_FRAMES * MemoryLayout<Float>.size),
            mData: auhalRenderMem
        )
    )
    let status = AudioUnitRender(unit, ioActionFlags, inTimeStamp, inBusNumber, inNumberFrames, &abl)
    guard status == noErr else { return status }

    let frames = Int(inNumberFrames)
    let mono = Array(UnsafeBufferPointer(start: auhalRenderMem, count: frames))
    // micPeak alimenta el watchdog anti-mic-mudo (mic crudo, en ESTE
    // callback: si el AUHAL muere, el worker deja de recibir y no lo vería).
    for s in mono where abs(s) > micPeak { micPeak = abs(s) }

    if let aligner = aecAligner {
        // Near-end del AEC3: al alineador con su timestamp de captura. El
        // worker corre el AEC render/capture ALINEADO y devuelve el mic
        // limpio por onCleanMic (ver setup de onCleanMic).
        let ts = inTimeStamp.pointee
        let hostTime = (ts.mFlags.contains(.hostTimeValid) && ts.mHostTime != 0)
            ? ts.mHostTime : mach_absolute_time()
        aligner.pushMic(mono, hostTime: hostTime)
    } else if let pcm = auhalDownsampler?.process(mono), !pcm.isEmpty {
        // Sin alineador/APM: mic crudo directo (degradado pero nunca mudo).
        if firstMicFrame {
            firstMicFrame = false
            log("canal mic: primer frame emitido")
        }
        writer.append(channel: CHANNEL_MIC, samples: pcm)
    }
    return noErr
}

func defaultInputDevice() -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
    )
    return deviceID
}

func deviceSampleRate(_ deviceID: AudioObjectID) -> Double {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyNominalSampleRate,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var rate: Float64 = 0
    var size = UInt32(MemoryLayout<Float64>.size)
    AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &rate)
    return rate > 0 ? rate : 48_000
}

func stopMicAuhal() {
    guard let unit = auhalUnit else { return }
    auhalUnit = nil // el callback ve nil y no rinde más
    AudioOutputUnitStop(unit)
    AudioUnitUninitialize(unit)
    AudioComponentInstanceDispose(unit)
}

@discardableResult
func startMicAuhal() -> Bool {
    stopMicAuhal()

    var desc = AudioComponentDescription(
        componentType: kAudioUnitType_Output,
        componentSubType: kAudioUnitSubType_HALOutput,
        componentManufacturer: kAudioUnitManufacturer_Apple,
        componentFlags: 0,
        componentFlagsMask: 0
    )
    guard let component = AudioComponentFindNext(nil, &desc) else {
        log("AUHAL: no encontré el componente HALOutput")
        return false
    }
    var unitOpt: AudioComponentInstance?
    guard AudioComponentInstanceNew(component, &unitOpt) == noErr, let unit = unitOpt else {
        log("AUHAL: no pude instanciar la unidad")
        return false
    }

    // Input ON (bus 1), output OFF (bus 0) — solo capturamos.
    var one: UInt32 = 1
    var zero: UInt32 = 0
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Input, 1, &one, 4)
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO,
                         kAudioUnitScope_Output, 0, &zero, 4)

    var deviceID = defaultInputDevice()
    guard deviceID != kAudioObjectUnknown else {
        log("AUHAL: no hay dispositivo de entrada default")
        AudioComponentInstanceDispose(unit)
        return false
    }
    guard AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice,
                               kAudioUnitScope_Global, 0, &deviceID,
                               UInt32(MemoryLayout<AudioObjectID>.size)) == noErr else {
        log("AUHAL: no pude asignar el dispositivo \(deviceID)")
        AudioComponentInstanceDispose(unit)
        return false
    }

    // Formato cliente en el output scope del bus de input (lo que RECIBIMOS):
    // float32 mono a la rate NATIVA del dispositivo (AUHAL no resamplea en
    // input; la conversión a 16 kHz la hace nuestro Downsampler).
    let rate = deviceSampleRate(deviceID)
    var fmt = AudioStreamBasicDescription(
        mSampleRate: rate,
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked
            | kAudioFormatFlagIsNonInterleaved,
        mBytesPerPacket: 4,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 32,
        mReserved: 0
    )
    guard AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat,
                               kAudioUnitScope_Output, 1, &fmt,
                               UInt32(MemoryLayout<AudioStreamBasicDescription>.size)) == noErr
    else {
        log("AUHAL: el dispositivo rechazó float32 mono @ \(Int(rate)) Hz")
        AudioComponentInstanceDispose(unit)
        return false
    }

    var callback = AURenderCallbackStruct(inputProc: auhalInputProc, inputProcRefCon: nil)
    AudioUnitSetProperty(unit, kAudioOutputUnitProperty_SetInputCallback,
                         kAudioUnitScope_Global, 0, &callback,
                         UInt32(MemoryLayout<AURenderCallbackStruct>.size))

    log("AUHAL: configurado, inicializando…")
    guard AudioUnitInitialize(unit) == noErr else {
        log("AUHAL: AudioUnitInitialize falló")
        AudioComponentInstanceDispose(unit)
        return false
    }
    log("AUHAL: inicializado, arrancando IO…")

    // (Re)crear el APM + alineador. El alineador necesita render y capture a
    // la MISMA rate (línea de tiempo común); en la práctica ambos son 48 kHz.
    // Si difieren, se cae a mic crudo sin AEC (caso raro).
    if apmHandle == nil || apmCaptureRate != Int(rate) {
        aecAligner?.stop()
        aecAligner = nil
        if let old = apmHandle {
            apmHandle = nil
            usleep(20_000) // dejar salir a los callbacks en vuelo
            apm_destroy(old)
        }
        if Int(rate) == Int(systemRate), let apm = apm_create(Int32(systemRate), Int32(rate)) {
            apmHandle = apm
            apmCaptureRate = Int(rate)
            let aligner = AecAligner(rate: rate, frame: Int(apm_capture_frame_samples(apm)))
            aligner.onCleanMic = { clean in
                // Worker del alineador: el mic YA limpio baja a 16 kHz → STT.
                guard let pcm = auhalDownsampler?.process(clean), !pcm.isEmpty else { return }
                if firstMicFrame {
                    firstMicFrame = false
                    log("canal mic: primer frame emitido")
                }
                writer.append(channel: CHANNEL_MIC, samples: pcm)
            }
            aecAligner = aligner
            aligner.start()
            log("AEC3: APM + alineador por timestamp (render/capture \(Int(rate)) Hz)")
        } else {
            apmCaptureRate = 0
            log("AEC3: sin APM (rate \(Int(systemRate))/\(Int(rate)) no soportada o distinta) — mic CRUDO")
        }
    }

    auhalDownsampler = Downsampler(sourceRate: rate)
    auhalUnit = unit

    // En pausa: dejar la unidad armada pero sin IO (el indicador del mic se
    // apaga — bonus de privacidad que el modo VP no puede dar).
    if !paused {
        guard AudioOutputUnitStart(unit) == noErr else {
            log("AUHAL: AudioOutputUnitStart falló")
            stopMicAuhal()
            return false
        }
    }
    log("AUHAL: IO corriendo")
    log("canal mic: capturando vía AUHAL a \(Int(rate)) Hz → 16 kHz\(apmHandle != nil ? " + AEC3" : " (CRUDO, sin AEC)")")
    return true
}

// Cambio del input default en vivo (enchufar AirPods a mitad de reunión):
// AVAudioEngine seguía al dispositivo solo; con AUHAL es responsabilidad
// nuestra. Re-armar sobre el dispositivo nuevo.
var inputDeviceAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
)
if micMode == "auhal" {
    AudioObjectAddPropertyListenerBlock(
        AudioObjectID(kAudioObjectSystemObject), &inputDeviceAddress, DispatchQueue.global()
    ) { _, _ in
        log("dispositivo de entrada default cambió: re-armando AUHAL")
        startMicAuhal()
    }
}

// --- Bypass del AEC con auriculares (patrón Granola) ---
// Sin eco físico (el audio va directo al oído, no rebota al mic) el AEC solo
// puede degradar la voz. Detección: transport type del output default;
// para BuiltIn se distingue parlante interno de jack por el data source
// ('ispk' vs 'hdpn'). Se re-chequea cada segundo desde el watchdog (enchufar
// auriculares al jack NO cambia el default device, solo el data source — un
// listener de default device no lo vería).
// UYARI_AEC=off fuerza el bypass (debug / A-B testing).

func outputLikelyHeadphones() -> Bool {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
    ) == noErr, deviceID != kAudioObjectUnknown else { return false }

    var transportAddress = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyTransportType,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var transport: UInt32 = 0
    size = UInt32(MemoryLayout<UInt32>.size)
    AudioObjectGetPropertyData(deviceID, &transportAddress, 0, nil, &size, &transport)

    switch transport {
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE:
        return true // AirPods / headset BT (un parlante BT también cae aquí — aceptado)
    case kAudioDeviceTransportTypeBuiltIn:
        // Parlante interno y jack de auriculares son el MISMO device BuiltIn;
        // el data source dice cuál está activo: 'hdpn' = headphones.
        var sourceAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDataSource,
            mScope: kAudioObjectPropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        var source: UInt32 = 0
        size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(deviceID, &sourceAddress, 0, nil, &size, &source) == noErr
        else { return false }
        return source == 0x6864_706E // 'hdpn'
    default:
        // HDMI/DisplayPort/USB/AirPlay: casi siempre parlantes → AEC activo.
        return false
    }
}

// --- Delay externo real → AEC3 (delta #1 confirmado del binario de Granola:
// SetAudioBufferDelay con la latencia de los devices, no solo el estimador).
// Delay total ≈ latencia del output (el far-end sale con retraso hacia el
// parlante) + latencia del input (el eco tarda en entrar del mic). Cada una
// = Latency + SafetyOffset + BufferFrameSize del device, a su rate.

func defaultOutputDevice() -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
    )
    return deviceID
}

func deviceLatencyMs(_ deviceID: AudioObjectID, scope: AudioObjectPropertyScope) -> Double {
    guard deviceID != kAudioObjectUnknown else { return 0 }
    func frames(_ selector: AudioObjectPropertySelector) -> UInt32 {
        var address = AudioObjectPropertyAddress(
            mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain
        )
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &value) == noErr
        else { return 0 }
        return value
    }
    let total = frames(kAudioDevicePropertyLatency)
        + frames(kAudioDevicePropertySafetyOffset)
        + frames(kAudioDevicePropertyBufferFrameSize)
    let rate = deviceSampleRate(deviceID)
    return Double(total) / rate * 1000
}

var lastReportedDelayMs = -1

func updateStreamDelay() {
    guard let apm = apmHandle else { return }
    let outMs = deviceLatencyMs(defaultOutputDevice(), scope: kAudioObjectPropertyScopeOutput)
    let inMs = deviceLatencyMs(defaultInputDevice(), scope: kAudioObjectPropertyScopeInput)
    let total = Int(outMs + inMs)
    apm_set_stream_delay_ms(apm, Int32(total))
    if total != lastReportedDelayMs {
        lastReportedDelayMs = total
        log("AEC3: delay externo reportado \(total) ms (out \(Int(outMs)) + in \(Int(inMs)))")
    }
}

var aecBypassed: Bool? = nil // nil = aún no evaluado (fuerza el primer log)

// Estado actual del bypass para el gate (con auriculares no hay eco → el
// gate no debe actuar). Lectura barata desde el callback de audio.
func aecBypassedNow() -> Bool {
    return aecBypassed == true
}

func updateAecBypass() {
    guard let apm = apmHandle else { return }
    let forcedOff = ProcessInfo.processInfo.environment["UYARI_AEC"] == "off"
    let bypass = forcedOff || outputLikelyHeadphones()
    // Aplicar SIEMPRE (es un store atómico barato): si el APM se recreó por
    // un cambio de dispositivo, su bypass interno nace en false aunque
    // aecBypassed diga otra cosa. Loguear solo el cambio.
    apm_set_bypass(apm, bypass ? 1 : 0)
    if bypass != aecBypassed {
        aecBypassed = bypass
        log("AEC3: \(bypass ? "BYPASS (\(forcedOff ? "forzado por UYARI_AEC=off" : "auriculares"))" : "ACTIVO (parlantes)")")
    }
}

// --- Arranque del canal mic según el modo ---
if micMode == "auhal" {
    if !startMicAuhal() { fail("no pude arrancar el mic (AUHAL)") }
    updateAecBypass()
    updateStreamDelay()
    // El silencio del sistema ya lo maneja el alineador (lee ceros donde el
    // tap no escribió) — sin feeder de ceros aparte.
} else {
    if !startMic(useVoiceProcessing: true) { fail("no pude arrancar el mic") }
}

// Watchdog anti-mic-mudo: revisa el pico de señal cada segundo.
// Umbral 2 s, verificado empíricamente como seguro: una sesión VP sana
// SIEMPRE tiene piso de ruido > 0 incluso en silencio ambiental (~4600 de
// energía medida); la muerta ni siquiera entrega callbacks (cero exacto).
// El rescate va DIRECTO a sin-AEC: reintentar con voice processing falló
// 4/4 veces observadas (la sesión re-armada nace muerta igual) y cuesta
// ~3.5 s extra. Peor caso: mic vivo a los ~4 s (antes ~9 s).
Thread.detachNewThread {
    var zeroStrikes = 0
    var restarts = 0
    while true {
        Thread.sleep(forTimeInterval: 1)
        // Re-chequear auriculares vs parlantes (enchufar al jack no cambia el
        // default device, así que se sondea; la lectura es barata) y refrescar
        // el delay externo (cambia con el device/buffer size).
        updateAecBypass()
        updateStreamDelay()
        // En pausa el mic está detenido a propósito: cero señal es lo esperado,
        // no un mic mudo. No contar strikes ni intentar rescate.
        if paused {
            zeroStrikes = 0
            micPeak = 0
            continue
        }
        let peak = micPeak
        micPeak = 0
        zeroStrikes = peak == 0 ? zeroStrikes + 1 : 0
        guard zeroStrikes >= 2, restarts < 2 else { continue }
        restarts += 1
        zeroStrikes = 0
        if micMode == "auhal" {
            // El mic crudo no sufre el arbitraje VP; ceros sostenidos aquí =
            // dispositivo caído/cambiado (el listener de default input ya
            // re-arma). Reintentar una vez y loguear, sin cambiar de modo.
            log("mic en silencio absoluto (AUHAL): re-armando — intento \(restarts)")
            startMicAuhal()
        } else {
            log("mic MUDO (2 s de ceros): rescate SIN AEC — intento \(restarts)")
            startMic(useVoiceProcessing: false)
        }
    }
}

// --- Pausa suave (resume instantáneo) ---
// Detiene mic y audio de sistema SIN destruir nada: el motor de voz queda
// armado (no llamamos setVoiceProcessingEnabled(false)), así el resume no
// re-paga el arranque de ~1s del VP de Apple. El indicador del micrófono
// puede quedar encendido durante la pausa (el precio de mantenerlo caliente).
func pauseCapture() {
    guard !paused else { return }
    paused = true
    if micMode == "auhal" {
        // Con AUHAL la pausa PARA el IO de verdad: el indicador naranja del
        // mic se apaga (bonus de privacidad); reanudar sigue siendo barato
        // porque la unidad queda armada.
        if let unit = auhalUnit { AudioOutputUnitStop(unit) }
    } else {
        micEngine?.pause()
    }
    if let proc = ioProcID { AudioDeviceStop(aggregateID, proc) }
    log("captura pausada (\(micMode == "auhal" ? "AUHAL detenido, unidad armada" : "VP sigue armado") — resume instantáneo)")
}

func resumeCapture() {
    guard paused else { return }
    paused = false
    if let proc = ioProcID { AudioDeviceStart(aggregateID, proc) }
    if micMode == "auhal" {
        // La pausa dejó un salto grande en la línea de tiempo del alineador:
        // resetearlo para re-anclar t0 con los buffers nuevos.
        aecAligner?.reset()
        if let unit = auhalUnit, AudioOutputUnitStart(unit) != noErr {
            log("no pude reanudar el mic (AUHAL) — re-armando")
            startMicAuhal()
        }
    } else {
        do {
            try micEngine?.start()
        } catch {
            log("no pude reanudar el mic (\(error)) — rescate SIN AEC")
            startMic(useVoiceProcessing: false)
        }
    }
    log("captura reanudada")
}

// --- Vida atada al padre: EOF en stdin = limpiar y salir ---

func cleanup() {
    // Soltar la sesión de voice processing EXPLÍCITAMENTE (removeTap +
    // VP off) antes de parar: un teardown a medias es lo que deja mudo
    // al siguiente proceso que la pida.
    if let engine = micEngine {
        engine.inputNode.removeTap(onBus: 0)
        try? engine.inputNode.setVoiceProcessingEnabled(false)
        engine.stop()
        micEngine = nil
    }
    stopMicAuhal()
    if let proc = ioProcID {
        AudioDeviceStop(aggregateID, proc)
        AudioDeviceDestroyIOProcID(aggregateID, proc)
    }
    AudioHardwareDestroyAggregateDevice(aggregateID)
    AudioHardwareDestroyProcessTap(tapID)
    // Parar el worker del alineador antes de destruir el APM (no debe haber
    // process_render/capture en vuelo cuando se libera).
    aecAligner?.stop()
    aecAligner = nil
    // Con las unidades y el worker parados ya no hay callbacks tocando el APM.
    if let apm = apmHandle {
        apmHandle = nil
        apm_destroy(apm)
    }
    log("limpieza completa, saliendo")
}

signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }
atexit { cleanup() }

// Protocolo de stdin (una línea por comando):
//   "pause"  → pausa suave (mantiene el VP armado)
//   "resume" → reanuda al instante
//   EOF      → el padre cerró stdin (murió o pidió cierre) → limpiar y salir
while let line = readLine(strippingNewline: true) {
    switch line {
    case "pause": pauseCapture()
    case "resume": resumeCapture()
    default: break
    }
}
exit(0)
