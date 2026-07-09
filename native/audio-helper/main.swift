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
    _, inInputData, _, _, _ in
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

if !startMic(useVoiceProcessing: true) { fail("no pude arrancar el mic") }

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
        log("mic MUDO (2 s de ceros): rescate SIN AEC — intento \(restarts)")
        startMic(useVoiceProcessing: false)
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
    micEngine?.pause()
    if let proc = ioProcID { AudioDeviceStop(aggregateID, proc) }
    log("captura pausada (VP sigue armado — resume instantáneo)")
}

func resumeCapture() {
    guard paused else { return }
    paused = false
    if let proc = ioProcID { AudioDeviceStart(aggregateID, proc) }
    do {
        try micEngine?.start()
    } catch {
        log("no pude reanudar el mic (\(error)) — rescate SIN AEC")
        startMic(useVoiceProcessing: false)
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
    if let proc = ioProcID {
        AudioDeviceStop(aggregateID, proc)
        AudioDeviceDestroyIOProcID(aggregateID, proc)
    }
    AudioHardwareDestroyAggregateDevice(aggregateID)
    AudioHardwareDestroyProcessTap(tapID)
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
