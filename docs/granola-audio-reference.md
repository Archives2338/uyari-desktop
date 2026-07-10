# Referencia durable: pipeline de audio de Granola (AUHAL + AEC3)

> **Propósito**: consolidar en NUESTRO repo (versionado) todo lo aprendido
> del pipeline de audio de Granola, para no depender de la carpeta
> `emprendimiento/granola-audit/` (que puede perderse). Fuente: ASAR
> desminificado con webcrack + RE del binario nativo con `otool`/`nm`
> (herramientas nativas de macOS, sin apps de pago). Uso educativo /
> interoperabilidad; NO copiamos su código.
>
> Binario: `/Applications/Granola.app/Contents/Resources/native/granola.node`
> (Mach-O universal arm64+x64, 1.6 MB, 156 símbolos AEC3).
> Análisis original en `os/granola-desktop.md` §3.2-3.4.

## 1. Arquitectura de captura (clase `CombinedAudioCapture`)

Granola captura mic + sistema con las MISMAS APIs de Core Audio que nosotros
(confirmado por símbolos importados en el binario):
- `AudioHardwareCreateProcessTap` + `CATapDescription` → tap del sistema.
- `AudioHardwareCreateAggregateDevice` → aggregate device del tap.
- `AudioDeviceCreateIOProcIDWithBlock` → IOProc del sistema.
- `AudioUnitRender` → AUHAL para el micrófono.

Métodos clave de `-[CombinedAudioCapture ...]` (de `nm`):
```
initWithSampleRate:enableAutomaticGainCompensation:   ← constructor
initializeMicrophoneCapture
processInputBuffer:startTime:fromMicrophone:          ← ★ ALINEACIÓN
gotPCMAudioBuffer:time:                               ← buffer + timestamp
applyAutoGain:
defaultInputDeviceDidChange:outputDevice:            ← cambio de device
outputDeviceIsHeadphones / disableEchoCancellationOnHeadphones
bufferNilCountForMicrophone / bufferNilCountForSystemAudio  ← salud por canal
```

## 2. LA PIEZA CLAVE — alineación por timestamp

El desensamblado de `processInputBuffer:startTime:fromMicrophone:` (arm64,
`otool -tV`) revela las estructuras:
```
std::deque<TimestampedAudioBuffer>     ← cola de buffers CON timestamp
CombinedAudioBuffers(pcmBuf, pcmBuf)   ← combina mic + sistema alineados
SlicedAudioBuffer(pcmBuf, off, off)    ← corta por muestras para alinear
GetAudioBufferDuration(pcmBuf)
```

**Qué significa**: cada buffer que llega (mic o sistema) se envuelve en un
`TimestampedAudioBuffer` (audio **+ su timestamp de captura**) y se mete en
una deque. Antes del AEC, **cortan y alinean** ambos streams por su timestamp
para que el frame de referencia (far-end) y el del mic (near-end)
correspondan al MISMO instante real. Así el filtro lineal del AEC3 converge
bien (30-40 dB) en vez de degradarse por el jitter entre dos callbacks en
threads/relojes distintos.

> **Nuestra réplica** (`native/audio-helper/main.swift`, clase `AecAligner`):
> cada buffer se ubica en una línea de tiempo común por su `mHostTime` (reloj
> mach, compartido entre dispositivos); un worker tira frames de 10 ms del
> mismo instante de ambos anillos y alimenta el AEC en lockstep. Subió la
> cancelación de 17 → 23.5 dB (medido con eco acústico real).

## 3. Convención de llamada (JS → módulo nativo)

`audio_process` desminificado (líneas ~15925-15975), función `_I`:
```js
$.startAudioCapture(
  useCoreAudio,                        // bool
  disableEchoCancellationOnHeadphones, // bool (flag remoto, default true en prod)
  enableAutomaticGainCompensation,     // bool (AGC)
  sampleRate,                          // int
  (microphoneBuffer, systemAudioBuffer, capturedTimestamps) => {
    // El módulo nativo devuelve el mic YA LIMPIO (AEC aplicado adentro),
    // el audio de sistema crudo, y timestamps opcionales.
    // RMS por canal para el medidor de volumen; nada de AEC en JS.
  }
);
```
**Toda la superficie de config son 4 params.** El resto (el
`EchoCanceller3Config` completo) está compilado en el binario.

## 4. Config del AEC3 — DE FÁBRICA (sin overrides)

RE del constructor (`otool -tV`, en `-[CombinedAudioCapture init]`):
- `0x4170`: `bl EchoCanceller3ConfigC1Ev` (constructor **default**).
- `0x417c`: lo pasa al factory **sin un solo store al struct** entre medio.
- `0x419c`: `EchoCanceller3Factory::Create(sampleRate, 1, 1)` → **render mono,
  capture mono, a la rate nativa** del device (no fuerzan 48k).
- Literal pool (0x70840+): cada inmediato coincide EXACTO con los defaults del
  header de WebRTC (`normal_tuning.mask_lf={.3,.4,.3}`,
  `nearend_tuning.mask_lf={1.09,1.1,.3}`, `dominant_nearend.enr_threshold=.25`,
  etc.).

**Conclusión**: Granola NO tunea el suppressor. Su ventaja es la alineación
(§2) + delay externo (§5), no valores mágicos del AEC. Tunear el suppressor
fue la dirección equivocada (daña el near-end sin arreglar el eco saturado).

## 5. Delay externo + extras confirmados

- **`SetAudioBufferDelay`** presente (3 refs) + logs de `render_delay_buffer.cc`
  ("Receiving a first externally reported audio buffer delay of…"). Reportan
  el delay REAL de los devices (`kAudioDevicePropertyLatency` +
  `SafetyOffset`), no solo el estimador. → nosotros: `set_stream_delay_ms`,
  25 ms medido (out 13 + in 11).
- **AGC** (`enableAutomaticGainCompensation`) SÍ lo usan. OJO: en NUESTRO caso
  perjudica (amplifica el eco residual post-AEC hacia el rango que el STT
  transcribe) porque nuestro residuo aún no es negligible → lo tenemos OFF por
  defecto. Granola puede permitírselo porque su AEC deja residuo mínimo.
- **NS / gain_controller1 (AGC1) / transient_suppressor**: NO usan (cero
  símbolos). Solo AEC3 + HighPassFilter + AGC2.
- **Bypass con auriculares**: `OutputDeviceNameIsHeadphones(NSString*)` — por
  NOMBRE del device ("AirPods", "Headphones"), detrás del flag
  `disable_echo_cancellation_on_headphones` (default true en prod). Nuestro
  bypass por transport type/dataSource es más robusto.
- **Sin compensación de drift** adaptativa (igual que nosotros).

## 6. Flags remotos relevantes (Local Storage/leveldb, valores runtime)

- `flag_follow_meeting_app_mic_device: true` → capturan el mic del MISMO device
  que usa Zoom (no el default del sistema). **PENDIENTE de copiar** — importa
  cuando el usuario tiene Zoom en un device y el default es otro.
- `flag_system_audio_dropout_restart: true`, `..._threshold_ms: 30000` →
  reinician la captura de sistema si 30 s sin audio.
- `flag_audio_process_max_memory_restart: {maxMemoryBytes: 500000000}` →
  reinician el proceso de audio a 500 MB.
- Ignoran `com.apple.CoreSpeech` en el mic-monitor (nosotros también).

## 7. Estado de nuestra réplica (rama feature/mic-auhal-aec3)

| Pieza | Granola | Uyari | Estado |
|---|---|---|---|
| Tap sistema + AUHAL mic | ✓ | ✓ | igual |
| AEC3 stock (sin tuning) | ✓ | ✓ | igual (revertido) |
| Rate nativa 48k, mono/mono | ✓ | ✓ | igual |
| Delay externo (device latency) | ✓ | ✓ | igual (25 ms) |
| **Alineación por timestamp** | ✓ | ✓ | **replicado (17→23.5 dB)** |
| AGC | ON | OFF | difiere a propósito (ver §5) |
| Bypass auriculares | por nombre | por transport | nuestro mejor |
| follow_meeting_app_mic_device | ✓ | ✗ | PENDIENTE |
| Gate residual + dedup textual | ✗ | ✓ | extra nuestro (red de seguridad) |

Brecha restante hacia 30-40 dB: probablemente el resampler (ellos sinc,
nosotros lineal para el 16k del STT) y afinado fino del delay ahora que la
alineación es precisa.
