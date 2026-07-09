import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

// Overlay pill flotante (patrón Scribbl/Granola): ventanita transparente
// always-on-top que muestra que se está grabando y permite parar, visible
// en todos los espacios (incluida la app de Zoom en fullscreen). No roba
// el foco (focusable: false + showInactive).

const WIDTH = 248
const HEIGHT = 52

export function createOverlayWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: workArea.x + workArea.width - WIDTH - 24,
    y: workArea.y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?view=overlay`)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: { view: 'overlay' },
    })
  }

  win.once('ready-to-show', () => win.showInactive())
  return win
}
