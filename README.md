# Uyari Desktop (macOS)

App Electron de Uyari: notas IA de reuniones con captura botless. Consume el
mismo backend que la extensión (`backend/`, puerto 3001) y el mismo design
system (`design_handoff_uyari 2/`).

## Correr en desarrollo

```bash
# 1. Backend (en otra terminal)
cd ../backend && npm run dev

# 2. App
npm install
npm run dev
```

`npm run dev` levanta la app con el **motor real: micrófono → AssemblyAI
Universal-Streaming** (requiere `ASSEMBLYAI_API_KEY` en `backend/.env.development`).
Para desarrollar UI sin API key: `UYARI_CAPTURE=mock npm run dev`
(conversación falsa por el mismo pipeline).

Otros comandos: `npm run typecheck`, `npm run build`, `npm run package`
(genera el .app/.dmg sin firmar en `dist/`).

## Arquitectura

Regla central: **el renderer nunca toca Electron ni la red; el main nunca
renderiza**. Todo cruce pasa por el contrato tipado de `src/shared/ipc.ts`.

```
src/
├─ shared/            Contrato entre procesos (lo único importado por ambos)
│  ├─ domain.ts       Tipos de dominio (CaptionSegment = shape del backend)
│  └─ ipc.ts          Canales IPC + interfaz UyariBridge (window.uyari)
│
├─ main/              LÓGICA (proceso principal, Node)
│  ├─ index.ts        Composition root: construye y cablea los servicios
│  ├─ windows/        Creación de BrowserWindows (main; overlay después)
│  ├─ ipc/register.ts Handlers IPC — delegan en servicios, sin lógica propia
│  └─ services/
│     ├─ settings.store.ts   Persistencia local; JWT cifrado con safeStorage
│     ├─ api.client.ts       Cliente HTTP del backend (mismo protocolo que la extensión)
│     ├─ permissions.service.ts  Permisos TCC de macOS (mic + screen recording)
│     ├─ meeting.service.ts  Sesión: buffer + dedupe + flush cada 5 s + finish
│     └─ capture/            LA FRONTERA INTERCAMBIABLE
│        ├─ engine.ts        Interfaz CaptureEngine (segment/status events)
│        ├─ assemblyai.engine.ts  Mic → AssemblyAI streaming (default, fase 2b)
│        ├─ mock.engine.ts   Conversación falsa (UYARI_CAPTURE=mock)
│        └─ native.engine.ts Stub mic+system audio vía helper Swift (fase 2c)
│
├─ preload/index.ts   Puente contextBridge: expone window.uyari (UyariBridge)
│
└─ renderer/          FRONTAL (React 19 + zustand, tokens del design system)
   └─ src/
      ├─ App.tsx      Router por estado: Welcome → Permissions → Home
      ├─ store.ts     Estado de UI (espejo de lo que reporta main)
      ├─ screens/     Welcome, Permissions (TCC), Home con transcript en vivo
      └─ styles/      tokens.css (copiado del design handoff) + app.css (dark)
```

### Flujo de datos de una sesión

```
CaptureEngine ──segment──▶ MeetingService ──buffer/dedupe──▶ flush 5s ──▶ POST /meetings/:id/segments
      │                          │
      └──status──▶               └──push IPC (ev:caption / ev:session)──▶ renderer (transcript en vivo)

stop() ──▶ engine.stop + flush final ──▶ POST /meetings/:id/finish (encola resumen IA)
```

## Fase 2b (HECHO): mic → STT streaming, patrón Granola

Flujo implementado (el audio NUNCA pasa por nuestro backend, solo texto):

```
renderer (getUserMedia + AudioWorklet, PCM16 16 kHz, chunks de 50 ms)
   └─IPC──▶ main: AssemblyAiMicEngine
              ├─ POST /stt/token al backend (token efímero, API key nunca sale del server)
              ├─ WebSocket directo wss://streaming.assemblyai.com/v3/ws
              │    (speech_model=universal-streaming-multilingual, format_turns)
              └─ mensajes Turn → CaptionSegment (mismo turn_order = mismo id,
                 el dedupe del buffer lo pisa → captions que se corrigen en vivo)
```

## Fase 2c: audio del sistema (reemplazar native.engine)

Patrón validado en el research de Granola (`../os/granola-desktop.md`):

1. **Helper Swift** empaquetado en `Resources/`, lanzado como child process:
   system audio vía Core Audio process tap + aggregate device (macOS 14.4+,
   excluyéndose a sí mismo), micrófono vía AVAudioEngine, PCM por stdout.
2. Se enchufa al MISMO stream STT de 2b como segundo canal (mic = "You",
   sistema = los demás participantes).
3. Se implementa todo dentro de `NativeCaptureEngine`; nada más cambia.
   Activar con `UYARI_CAPTURE=native`.

Alternativa si se quiere acortar la fase 2: Recall.ai Desktop SDK
($0.50/h + STT) en otro engine más, misma interfaz.

## Distribución (pendiente)

- Cuenta Apple Developer ($99/año) → certificado Developer ID.
- Firma + notarización en `electron-builder.yml` (hardened runtime +
  entitlements de mic; el helper Swift se firma aparte).
- Updates: electron-updater + GitHub Releases.
