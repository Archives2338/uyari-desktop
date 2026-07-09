import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

// Banner de reunión detectada (patrón Granola: su "nub-banner"): ventanita
// propia always-on-top arriba a la derecha — NO una notificación del
// sistema, que es frágil (Focus/No molestar, permisos, se pierde en el
// centro de notificaciones). Un click en "Start recording" arranca la
// captura directo, sin pasar por la app. No roba foco (focusable: false —
// los botones reciben clicks igual, mismo comportamiento que el nub).

const WIDTH = 356
const HEIGHT = 76

export function createDetectionBanner(label: string): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: workArea.x + workArea.width - WIDTH - 20,
    y: workArea.y + 16,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
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

  const query = { view: 'banner', label }
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', 'banner')
    url.searchParams.set('label', label)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query })
  }

  win.once('ready-to-show', () => win.showInactive())
  return win
}
