import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { createMainWindow } from './windows/main-window'
import {
  createOverlayWindow,
  attachNubBehavior,
  syncNubWithMainWindow,
  type NubBehavior,
} from './windows/overlay-window'
import { createDetectionBanner } from './windows/banner-window'
import { registerIpc } from './ipc/register'
import { MicMonitorService } from './services/mic-monitor.service'
import { SettingsStore } from './services/settings.store'
import { ApiClient } from './services/api.client'
import { MeetingService } from './services/meeting.service'
import { TranscriptStore } from './services/transcript.store'
import { createCaptureEngine } from './services/capture'

// Composition root: aquí (y solo aquí) se construyen y cablean los
// servicios. El resto del main recibe dependencias por constructor.

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    // Push a todas las ventanas (main window hoy; overlay después).
    const broadcast = (channel: string, payload?: unknown): void =>
      BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload))

    const settings = new SettingsStore()
    const api = new ApiClient(settings)

    // El mic vive en el renderer (getUserMedia); el main lo controla por IPC.
    const micControl = {
      start: (sampleRate: number) =>
        broadcast(IPC.evMicControl, { action: 'start', sampleRate }),
      stop: () => broadcast(IPC.evMicControl, { action: 'stop' }),
    }
    const store = new TranscriptStore()
    const meetings = new MeetingService(api, store, () =>
      createCaptureEngine({ api, mic: micControl }),
    )

    // Overlay nub: existe solo mientras hay sesión activa.
    let overlay: BrowserWindow | null = null
    let nub: NubBehavior | null = null
    // Banner "Meeting detected": existe desde la detección hasta que el
    // usuario decide (o 15 s). Instancia única.
    let banner: BrowserWindow | null = null
    let bannerTimer: NodeJS.Timeout | null = null
    // Delay antes de mostrar el banner tras detectar la reunión (como Granola,
    // flag mic_apps_notification_delay_seconds=2): deja que Zoom/Meet terminen
    // de abrirse y reclamar el z-order, así el banner aparece limpio ENCIMA en
    // vez de detrás o parpadeando.
    const BANNER_DELAY_MS = 2000
    let bannerPending: NodeJS.Timeout | null = null

    const closeBanner = (): void => {
      if (bannerPending) clearTimeout(bannerPending)
      bannerPending = null
      if (bannerTimer) clearTimeout(bannerTimer)
      bannerTimer = null
      if (banner && !banner.isDestroyed()) banner.close()
      banner = null
    }

    const showBanner = (label: string): void => {
      if (banner) return // ya hay uno en pantalla
      banner = createDetectionBanner(label)
      banner.on('closed', () => {
        banner = null
        if (bannerTimer) clearTimeout(bannerTimer)
        bannerTimer = null
      })
      // Auto-dismiss: si el usuario lo ignora, no estorbar.
      bannerTimer = setTimeout(closeBanner, 15_000)
    }

    // Crea la ventana principal y la sincroniza con el nub: foco en ella
    // oculta el nub siempre; perderlo (o minimizar/ocultarse) lo muestra
    // solo si hay captura activa (modelo Granola — ver overlay-window.ts).
    const spawnMainWindow = (): BrowserWindow => {
      const win = createMainWindow()
      syncNubWithMainWindow(
        win,
        () => overlay,
        () => meetings.state() !== null,
      )
      return win
    }

    // Trae la ventana principal al frente, sin confundirla con el overlay
    // ni el banner (BrowserWindows no-focusables). La usan el banner de
    // detección y el nub.
    const isMainWin = (w: BrowserWindow): boolean => w !== overlay && w !== banner
    const focusMainWindow = (): void => {
      const win = BrowserWindow.getAllWindows().find(isMainWin)
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      } else {
        spawnMainWindow()
      }
    }

    registerIpc({
      settings,
      api,
      meetings,
      overlay: { drag: (action) => nub?.drag(action), focusMain: focusMainWindow },
    })

    // Reuniones que quedaron a medias en una corrida anterior (crash o
    // backend caído): subirlas y cerrarlas ahora. Requiere sesión.
    if (settings.token) void meetings.recoverOrphans()

    meetings.setListener({
      onCaption: (segment) => broadcast(IPC.evCaption, segment),
      onSession: (session) => {
        broadcast(IPC.evSession, session)
        if (session) closeBanner() // ya está grabando: el banner sobra
        if (session && !overlay) {
          // Nace visible solo si la principal ya no tiene el foco (p.ej.
          // se arrancó la captura y de inmediato se cambió a otra app).
          const mainFocused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
          overlay = createOverlayWindow(!mainFocused)
          nub = attachNubBehavior(overlay)
          overlay.on('closed', () => {
            overlay = null
            nub = null
          })
        } else if (!session && overlay) {
          overlay.close()
        }
      },
    })

    // Auto-detección de reunión: si una app de reuniones enciende el mic y
    // no estamos grabando, banner flotante propio (patrón Granola), NO
    // notificación del sistema: siempre visible sobre la app de reunión, con
    // "Start recording" a un click, inmune a Focus/No molestar.
    const monitor = new MicMonitorService(({ label, platform }) => {
      // Recordar la plataforma detectada aunque ya estemos grabando: fija la
      // app real (Zoom/Teams/Meet) para la próxima sesión.
      if (platform) meetings.setPlatformHint(platform)
      // Suprimir solo si hay captura VIVA: una sesión colgada en 'error'
      // no debe tragarse la detección en silencio.
      const state = meetings.state()
      if (state && state.status !== 'error') return
      broadcast(IPC.evMeetingDetected, { label }) // pista in-app inmediata
      // Precalentar el token de STT ya mismo: cuando el usuario pulse
      // "Start recording", el fetch ya no está en el camino crítico.
      api.prefetchSttToken()
      // Banner flotante con delay: no encimarlo mientras Zoom se abre (ver
      // BANNER_DELAY_MS). Un solo pendiente a la vez.
      if (bannerPending || banner) return
      bannerPending = setTimeout(() => {
        bannerPending = null
        // Revalidar: en estos 2 s el usuario pudo arrancar la captura a mano.
        const s = meetings.state()
        if (s && s.status !== 'error') return
        showBanner(label)
      }, BANNER_DELAY_MS)
    })
    monitor.start()
    app.on('before-quit', () => monitor.stop())

    spawnMainWindow()

    app.on('second-instance', focusMainWindow)

    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().some(isMainWin)) spawnMainWindow()
    })

    app.on('before-quit', () => void meetings.stop())
  })

  app.on('window-all-closed', () => {
    // Comportamiento macOS estándar: la app vive en el Dock hasta Cmd+Q.
    if (process.platform !== 'darwin') app.quit()
  })
}
