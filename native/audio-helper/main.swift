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

let TARGET_RATE = 16_000.0
let CHUNK_SAMPLES = 800 // 50 ms a 16 kHz
let CHANNEL_MIC: UInt8 = 0
let CHANNEL_SYSTEM: UInt8 = 1

func log(_ message: String) {
    FileHandle.standardError.write(("[helper] " + message + "\n").data(using: .utf8)!)
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
    if !pcm.isEmpty { writer.append(channel: CHANNEL_SYSTEM, samples: pcm) }
}
if ioStatus != noErr || ioProcID == nil { fail("no pude crear el IOProc (err \(ioStatus))") }
if AudioDeviceStart(aggregateID, ioProcID) != noErr { fail("no pude arrancar el aggregate device") }
log("canal sistema: capturando a \(Int(systemRate)) Hz → 16 kHz")

// ============================================================
// CANAL 0: micrófono con voice processing (AEC del sistema)
// ============================================================

let audioEngine = AVAudioEngine()
let inputNode = audioEngine.inputNode
do {
    // La pieza clave anti-duplicados: la AEC de Apple resta del mic lo que
    // el Mac está reproduciendo (la voz de los demás en la reunión).
    try inputNode.setVoiceProcessingEnabled(true)
    log("voice processing (AEC del sistema) activado en el mic")
} catch {
    log("AVISO: no pude activar voice processing (\(error)) — el mic puede colar el audio de los parlantes")
}
if #available(macOS 14.0, *) {
    // Sin ducking: que el sistema no baje el volumen de la reunión.
    inputNode.voiceProcessingOtherAudioDuckingConfiguration =
        AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
            enableAdvancedDucking: false,
            duckingLevel: .min
        )
}

let micFormat = inputNode.outputFormat(forBus: 0)
let micDownsampler = Downsampler(sourceRate: micFormat.sampleRate)
inputNode.installTap(onBus: 0, bufferSize: 2400, format: micFormat) { buffer, _ in
    guard let channelData = buffer.floatChannelData else { return }
    let frames = Int(buffer.frameLength)
    let mono = Array(UnsafeBufferPointer(start: channelData[0], count: frames))
    let pcm = micDownsampler.process(mono)
    if !pcm.isEmpty { writer.append(channel: CHANNEL_MIC, samples: pcm) }
}
do {
    try audioEngine.start()
    log("canal mic: capturando a \(Int(micFormat.sampleRate)) Hz → 16 kHz")
} catch {
    fail("no pude arrancar el mic (\(error))")
}

// --- Vida atada al padre: EOF en stdin = limpiar y salir ---

func cleanup() {
    audioEngine.stop()
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

while FileHandle.standardInput.availableData.count > 0 {}
exit(0)
