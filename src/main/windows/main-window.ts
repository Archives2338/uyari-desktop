import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1E1B2E',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Links externos al navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // UYARI_ONBOARDING=1 fuerza el wizard aunque ya esté completado (dev:
  // iterar sobre las pantallas sin borrar localStorage a mano cada vez).
  const forceOnboarding = process.env.UYARI_ONBOARDING === '1'

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (forceOnboarding) url.searchParams.set('onboarding', '1')
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: forceOnboarding ? { onboarding: '1' } : {},
    })
  }

  return win
}
