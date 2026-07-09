// uyari-audio-helper — captura el AUDIO DEL SISTEMA (los demás
// participantes de la reunión) con Core Audio process taps (macOS 14.4+),
// el mismo patrón botless que validamos en el research de Granola:
// tap global mono que EXCLUYE a nuestro propio proceso (anti-eco), montado
// en un aggregate device privado. Sin driver virtual, sin bot.
//
// Protocolo con el proceso Electron (deliberadamente mínimo):
//   stdout : PCM16LE mono a 16 kHz, frames de 800 samples (50 ms) — el
//            mismo formato que el mic del renderer, listo para el STT.
//   stderr : logs legibles.
//   stdin  : EOF = el padre murió o pidió cierre → limpiar y salir.
//
// Permiso TCC requerido: "System Audio Recording" (aparece bajo
// Privacy & Security → Screen & System Audio Recording). En dev, el
// responsable es Electron; en prod, la app firmada con
// NSAudioCaptureUsageDescription en su Info.plist.

import Foundation
import CoreAudio
import AudioToolbox

let TARGET_RATE = 16_000.0
let CHUNK_SAMPLES = 800 // 50 ms a 16 kHz

func log(_ message: String) {
    FileHandle.standardError.write(("[helper] " + message + "\n").data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
    log("FATAL: " + message)
    exit(1)
}

// --- 1. Nuestro proceso como AudioObject, para excluirnos del tap ---

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

// --- 2. Tap global mono excluyéndonos (patrón Granola) ---

let tapDescription = CATapDescription(monoGlobalTapButExcludeProcesses: [ownProcessAudioObject()])
tapDescription.name = "Uyari-Audio-Tap"
tapDescription.isPrivate = true
// muteBehavior default = CATapUnmuted (verificado en CATapDescription.h)

var tapID = AudioObjectID(kAudioObjectUnknown)
let tapStatus = AudioHardwareCreateProcessTap(tapDescription, &tapID)
if tapStatus != noErr {
    // -4 / 560947818 etc. suelen ser permiso TCC de System Audio Recording denegado
    fail("AudioHardwareCreateProcessTap falló (err \(tapStatus)) — ¿permiso de System Audio Recording?")
}
log("tap creado (id \(tapID))")

// --- 3. Formato del tap (normalmente float32 mono al rate del dispositivo) ---

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

// --- 4. Aggregate device privado con el tap adentro ---

let aggregateUID = UUID().uuidString
let aggregateDescription: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Uyari-Aggregate-Audio-Device",
    kAudioAggregateDeviceUIDKey: aggregateUID,
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

// --- 5. Escritor a stdout desacoplado del hilo de audio realtime ---

final class ChunkWriter {
    private let lock = NSLock()
    private var pcm = Data()
    private let out = FileHandle.standardOutput

    func append(_ samples: [Int16]) {
        lock.lock()
        samples.withUnsafeBufferPointer { pcm.append(Data(buffer: $0)) }
        lock.unlock()
    }

    func startFlushing() {
        Thread.detachNewThread { [self] in
            let chunkBytes = CHUNK_SAMPLES * 2
            while true {
                Thread.sleep(forTimeInterval: 0.025)
                lock.lock()
                var ready: Data? = nil
                if pcm.count >= chunkBytes {
                    let take = (pcm.count / chunkBytes) * chunkBytes
                    ready = pcm.prefix(take)
                    pcm.removeFirst(take)
                }
                lock.unlock()
                if let data = ready { out.write(data) }
            }
        }
    }
}

let writer = ChunkWriter()
writer.startFlushing()

// --- 6. IOProc: float32 @ deviceRate → int16 @ 16 kHz (interp. lineal) ---

let sourceRate = tapFormat.mSampleRate > 0 ? tapFormat.mSampleRate : 48_000
let ratio = sourceRate / TARGET_RATE
var carry: [Float] = []

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

    // A mono (promedio de canales si viniera >1) + juntar con el carry
    let frames = floatCount / max(channels, 1)
    var mono = carry
    mono.reserveCapacity(mono.count + frames)
    for f in 0..<frames {
        if channels <= 1 {
            mono.append(floats[f])
        } else {
            var sum: Float = 0
            for c in 0..<channels { sum += floats[f * channels + c] }
            mono.append(sum / Float(channels))
        }
    }

    // Downsample lineal continuo (mismo algoritmo que el mic del renderer)
    let producible = Int(Double(mono.count - 1) / ratio)
    guard producible > 0 else { carry = mono; return }
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
    writer.append(out)
}
if ioStatus != noErr || ioProcID == nil { fail("no pude crear el IOProc (err \(ioStatus))") }
if AudioDeviceStart(aggregateID, ioProcID) != noErr { fail("no pude arrancar el aggregate device") }
log("capturando audio del sistema a \(Int(sourceRate)) Hz → 16 kHz PCM16 por stdout")

// --- 7. Vida atada al padre: EOF en stdin = limpiar y salir ---

func cleanup() {
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

// Bloquea leyendo stdin; cuando Electron muere o cierra el pipe, salimos.
while FileHandle.standardInput.availableData.count > 0 {}
exit(0)
