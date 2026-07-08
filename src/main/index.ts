import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { createMainWindow } from './windows/main-window'
import { registerIpc } from './ipc/register'
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

    registerIpc({ settings, api, meetings })

    // Reuniones que quedaron a medias en una corrida anterior (crash o
    // backend caído): subirlas y cerrarlas ahora. Requiere sesión.
    if (settings.token) void meetings.recoverOrphans()

    meetings.setListener({
      onCaption: (segment) => broadcast(IPC.evCaption, segment),
      onSession: (session) => broadcast(IPC.evSession, session),
    })

    createMainWindow()

    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows()
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })

    app.on('before-quit', () => void meetings.stop())
  })

  app.on('window-all-closed', () => {
    // Comportamiento macOS estándar: la app vive en el Dock hasta Cmd+Q.
    if (process.platform !== 'darwin') app.quit()
  })
}
