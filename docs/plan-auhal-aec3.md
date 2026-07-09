# Plan: migración del mic a AUHAL + WebRTC AEC3 (camino Granola)

> Estado: **planificado, no arrancado**. Decisión 2026-07-09.
> Referencias: `os/granola-desktop.md` (evidencia del approach de Granola),
> `native/audio-helper/main.swift` (implementación actual).

## Por qué

El mic hoy se captura con `AVAudioEngine` + `setVoiceProcessingEnabled(true)`
(la Voice Processing I/O unit de Apple hace la cancelación de eco). Esto nos
cuesta tres problemas, todos con la misma raíz:

1. **Bug de mic mudo** (arbitraje de VP de macOS): si otra app (Zoom) tiene su
   sesión VP viva, re-armar la nuestra puede entregar un mic muerto (ceros
   exactos, sin callbacks). Hoy lo mitiga un watchdog (rescate sin AEC en
   ~2-4s), pero la sesión rescatada corre sin cancelación de eco.
2. **Warm-up de ~1s** en cada arranque en frío: `setVoiceProcessingEnabled`
   reconstruye la unidad de audio internamente. Es el grueso de la latencia
   visible del primer texto (~2s en frío vs ~0.9s en régimen).
3. **Caja negra**: cero control sobre la agresividad/calidad del AEC, y no
   podemos usar nuestro tap de sistema como señal de referencia.

Granola no tiene ninguno de los tres porque captura el mic **crudo por AUHAL**
(sin VP) y cancela el eco con **AEC3 de WebRTC compilado en su binario**,
usando su tap de audio del sistema como referencia (far-end). Confirmado por
símbolos en su bundle (`echo_canceller3.cc`, clase `CombinedAudioCapture`,
`AudioComponentFindNext`/`AudioUnitRender`; AEC deshabilitado con auriculares).

## Qué NO cambia

- El canal de sistema (Core Audio Process Tap + aggregate device) queda igual.
  De hecho es la pieza que habilita todo: ese stream ES la referencia far-end
  que AEC3 necesita.
- El protocolo con Electron (frames 1601 bytes por stdout, pause/resume por
  stdin) queda igual. Todo el cambio vive dentro del helper.
- Permisos TCC: mic + System Audio Recording, los mismos. Sin entitlements
  nuevos, firma/notarización igual.

## Arquitectura objetivo

```
                       ┌───────────────────────────────────────┐
  tap de sistema ──────► ring buffer far-end ──┐               │
  (48k → 16k mono)     │                       ▼               │
                       │            APM (WebRTC audio          │
  mic AUHAL crudo ─────► ring buffer ─► processing: AEC3) ──► canal 0 (mic limpio)
  (rate nativo → 16k)  │  near-end                             │
                       │                       │               │
                       │   detector de         └► bypass si    │
                       │   auriculares ──────────  auriculares │
                       └───────────────────────────────────────┘
                                    (helper nativo)
```

- El far-end (sistema) se sigue emitiendo como canal 1 igual que hoy; además
  alimenta `ProcessReverseStream()` del APM.
- El near-end (mic) pasa por `ProcessStream()` y sale limpio como canal 0.
- Con auriculares no hay eco físico → bypass del AEC (patrón Granola).

## Fases

### Fase 0 — Spike de empaquetado (2-3 días) · GATE: compila y linkea

La decisión técnica más importante es CÓMO meter AEC3 en el helper:

- **Opción recomendada: `webrtc-audio-processing`** (el extract standalone del
  módulo audio_processing de libwebrtc que mantiene el equipo de PulseAudio;
  build con meson, sin GN/Ninja de Google). Licencia BSD-3 (incluir
  atribución). Tamaño ~1-2 MB (Granola shipea 1.6 MB — mismo orden).
- Evitar: build completo de libwebrtc vía GN (semanas de peleas de build).
- Plan C si el empaquetado se traba: `speexdsp` (AEC mucho más simple, calidad
  claramente inferior — solo como salvavidas, no como objetivo).

Trabajo del spike:
1. Compilar webrtc-audio-processing **universal (arm64 + x86_64)**, estático.
2. Wrapper C/ObjC++ (`apm_bridge.mm`) con API C plana:
   `apm_create(sample_rate)`, `apm_process_render(int16*, n)`,
   `apm_process_capture(int16*, n)` (in-place), `apm_set_bypass(bool)`,
   `apm_destroy()`. Swift no habla C++ directo; el bridge sí.
3. **El build del helper deja de ser un `swiftc` de un archivo**: migrar a
   SwiftPM (target Swift + target C++/ObjC++) o Makefile. Actualizar
   `npm run build:helper`. Definir macOS mínimo (hoy 14.4 por el tap — sin
   cambio).
4. Prueba de humo: senoidal por render + copia atenuada+retardada por capture
   → verificar que la salida la atenúa >20 dB.

### Fase A — Mic por AUHAL crudo, detrás de flag (3-5 días) · GATE: sin bug de arbitraje y frío <300ms

Implementar la captura AUHAL (lo que elimina el VP y sus dos bugs) SIN tocar
aún el eco:

1. AUHAL: `kAudioUnitSubType_HALOutput`, input scope ON / output scope OFF,
   device = default input, callback de captura con `AudioUnitRender`.
   Convertir del rate nativo del dispositivo a 16k (reusar `Downsampler`).
2. **Cambio de dispositivo en vivo**: listener de
   `kAudioHardwarePropertyDefaultInputDevice` → re-armar el AUHAL sobre el
   nuevo device (el usuario enchufa AirPods a mitad de reunión). Este caso
   HOY lo maneja AVAudioEngine solo; con AUHAL es responsabilidad nuestra.
3. Flag: `UYARI_MIC=auhal|vp` (env var / settings), **default `vp`** hasta que
   la Fase B esté validada. El watchdog anti-mudo queda para el modo vp;
   en modo auhal no debería hacer falta (dejarlo como logging).
4. Validar en esta fase (con auriculares, donde no hay eco):
   - Escenario Zoom completo (grabar → parar → re-grabar en la misma llamada)
     × 10: cero micos mudos, sin watchdog.
   - Latencia de arranque en frío: mic vivo < 300ms (vs ~1s actual).
   - AirPods/HFP: ojo que el mic Bluetooth puede correr a 8/16k.
   - Cambio de input device a mitad de sesión.

**Nota**: al final de la Fase A ya se podría ofrecer `auhal` a usuarios con
auriculares (no hay eco que cancelar) — pero NO como default: con parlantes,
sin AEC, la voz de los demás se duplica en "You".

### Fase B — AEC3 integrado (1-2 semanas) · GATE: matriz de eco pasa

1. **Framing**: el APM procesa frames de **10 ms**. Nuestro pipeline interno
   trabaja a 16k mono → frames de 160 samples. Correr el APM a 16k (ambos
   canales ya se convierten a 16k; menos CPU, suficiente para voz — el STT
   es 16k de todos modos).
2. **Cadencia y orden**: por cada frame de captura:
   `ProcessReverseStream(far_end_10ms)` con lo que haya llegado del tap,
   luego `ProcessStream(capture_10ms)`. AEC3 trae **estimador de delay
   integrado** (absorbe hasta ~250ms de desalineación y deriva de reloj
   moderada entre el clock del mic y el del tap) — NO intentar alinear a mano
   con timestamps; darle los streams a ritmo constante y dejarlo converger.
3. **Ring buffers lock-free** (SPSC) entre los callbacks de audio y el hilo de
   proceso. Regla de oro de audio en tiempo real: **en el callback, nada de
   malloc/locks/logging/Swift-allocations** — buffers preasignados, el
   callback solo copia y sale. (El callback AUHAL es C: usar función C +
   refcon, no closures de Swift.)
4. **Detección de auriculares** → bypass del AEC (como Granola):
   `kAudioDevicePropertyTransportType` del default output (BuiltInSpeaker vs
   Headphones/Bluetooth/USB) + listener de cambio de output device. Con
   auriculares el AEC solo puede empeorar la voz.
5. **Solo AEC al principio**: NS (noise suppression) y AGC del APM apagados en
   la primera iteración — cada procesador extra es una variable más al tunear.
   Se habilitan después si hay valor medible.
6. Mantener el rescate/watchdog OFF en modo auhal+aec3 (no aplica), pero
   conservar el log de energía por canal para diagnóstico.

### Fase C — Validación y switch de default (3-5 días) · GATE: A/B contra vp

**Matriz de QA manual** (no hay forma barata de automatizar eco acústico real):

| Escenario | Qué verificar |
|---|---|
| Parlantes, volumen medio | La voz de "Them" NO aparece transcrita en "You" |
| Parlantes, volumen alto | Ídem + sin artefactos audibles en "You" |
| Double-talk (hablan los dos a la vez) | Tu voz no se "come" (over-suppression) |
| Auriculares (bypass) | Calidad idéntica al modo crudo |
| AirPods (HFP) | Rates raros no rompen el framing de 10ms |
| Música de fondo del sistema | No se cuela a "You" |
| Zoom re-grabar ×10 | Cero mudos (la razón de ser del proyecto) |
| Cambio de output device a mitad | El AEC re-converge en <2s |

**Métrica objetiva barata**: correlación de energía entre canal sistema y
canal mic (ventanas de 1s) mientras "Them" habla y "You" calla — con AEC bueno
la correlación debe caer cerca de cero. Sirve para comparar `vp` vs
`auhal+aec3` con números, y como test de regresión.

**CPU**: presupuesto < 5% de un core para el APM a 16k (medir con
`top -pid`). AEC3 a 16k mono es liviano; si se pasa, algo está mal armado.

**Rollout**: flag `auhal` default en dev → dogfood de Alejandro unos días →
default en la app empaquetada, con `vp` como fallback conmutable (el modo vp
NO se borra hasta tener señal de producción — es el plan B gratis).

## Consideraciones transversales / mejores prácticas

- **Tiempo real**: (repetido porque es LA fuente de bugs de audio) nada que
  pueda bloquear en los callbacks. Preasignar todo. Colas SPSC sin locks.
- **El indicador naranja del mic**: con AUHAL el mic se abre/cierra explícito
  — al pausar podremos **cerrar el AUHAL de verdad** (indicador se apaga) y
  reabrirlo en <300ms. Resuelve el trade-off de privacidad de la pausa suave
  actual (que deja el VP armado y el indicador encendido).
- **Deriva de reloj**: mic y tap corren en clocks distintos. AEC3 la tolera
  moderadamente; si en sesiones muy largas (>1h) el eco reaparece, el fix es
  un resampler adaptativo en el far-end — NO hace falta de entrada, solo
  saber que es el sospechoso #1 de "el AEC se degrada con el tiempo".
- **Licencia**: BSD-3 de WebRTC → incluir el texto en el about/acknowledgments.
- **No borrar el modo vp** hasta ≥2 semanas de auhal default sin regresiones.
- **Qué NO hacer**: no intentar alinear far/near con timestamps manuales (el
  estimador de AEC3 lo hace mejor); no arrancar con NS+AGC+AEC juntos; no
  buildear libwebrtc completo; no procesar a 48k (triple CPU sin beneficio
  para STT a 16k).

## Estimación y secuencia

| Fase | Duración | Entregable |
|---|---|---|
| 0 · Spike empaquetado | 2-3 días | APM compilado universal + bridge C + smoke test |
| A · AUHAL detrás de flag | 3-5 días | Mic sin VP: sin bug de arbitraje, frío <300ms |
| B · AEC3 | 1-2 semanas | Eco cancelado con parlantes, bypass con auriculares |
| C · QA + switch | 3-5 días | Matriz pasada, default auhal, vp de fallback |

**Total: ~3-4 semanas** de trabajo enfocado. Los gates entre fases permiten
abortar barato: si el spike de empaquetado se traba más de una semana,
re-evaluar (plan C speexdsp o posponer); si la Fase A no elimina el bug de
arbitraje (no debería pasar — Granola lo prueba), parar antes de invertir en
AEC3.

## Trigger para arrancar

Decidido: NO arrancar por ahora. El watchdog + pausa suave cubren el caso
actual. Arrancar cuando ocurra cualquiera de:
1. El bug de mic mudo muerde a usuarios reales en producción (no solo en la
   máquina de dev con el arbitraje envenenado por testing).
2. La latencia de arranque en frío (~2s) genere quejas reales de usuarios.
3. Quede bandwidth después de los quick wins de venta (búsqueda, export,
   consentimiento legal para EE.UU.).
