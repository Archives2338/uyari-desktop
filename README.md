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

## Fase 2c (HECHO): audio del sistema — dos canales con separación de hablantes

Patrón Granola implementado (`../os/granola-desktop.md`):

```
renderer (mic, getUserMedia)  ──IPC──▶ AssemblyAiStream "you"  ─▶ segmentos speaker="You"
helper Swift (system audio)   ─stdout─▶ AssemblyAiStream "them" ─▶ segmentos speaker="Them"
  (Core Audio process tap + aggregate device, macOS 14.4+,
   se excluye a sí mismo; PCM16LE mono 16 kHz, frames de 50 ms)
```

- Helper: `native/audio-helper/main.swift` → compilar con `npm run build:helper`
  (binario en `native/bin/`, empaquetado como extraResource en prod).
- Cada canal tiene SU PROPIA sesión STT con toda la resiliencia de
  `AssemblyAiStream` (backlog, reconexión, rotación 3 h, recorte de
  silencio). Costo: 2 × $0.15/h.
- Degradación elegante: si el helper no arranca (típicamente falta el
  permiso TCC "System Audio Recording" en Privacy & Security → Screen &
  System Audio Recording), la sesión sigue mic-only con aviso en la UI.
- Permiso TCC: exige `NSAudioCaptureUsageDescription` en el Info.plist del
  app. En dev se inyecta al Electron de node_modules vía `postinstall`;
  en prod va en `electron-builder.yml` (extendInfo).
- Motores: default = nativo (2 canales); `UYARI_CAPTURE=mic` = solo mic;
  `UYARI_CAPTURE=mock` = conversación falsa.

Pendiente del paquete 2c: auto-detección de reunión (monitorear qué app usa
el mic, estilo Granola) y overlay pill flotante.

Alternativa si se quiere acortar la fase 2: Recall.ai Desktop SDK
($0.50/h + STT) en otro engine más, misma interfaz.

## Distribución (pendiente)

- Cuenta Apple Developer ($99/año) → certificado Developer ID.
- Firma + notarización en `electron-builder.yml` (hardened runtime +
  entitlements de mic; el helper Swift se firma aparte).
- Updates: electron-updater + GitHub Releases.
