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
    // Nivel asertado ya en el constructor (belt-and-suspenders, como Granola):
    // si setVisibleOnAllWorkspaces reordenara el nivel, el flag del constructor
    // lo re-ancla.
    alwaysOnTop: true,
    // NSPanel: flota sobre apps en pantalla completa (Zoom) sin activarse ni
    // robar foco, y no aparece como ventana suelta en Mission Control (patrón
    // Granola para su banner de detección).
    type: 'panel',
    hiddenInMissionControl: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  // 'screen-saver' (no 'floating'): queda por encima de la ventana de Zoom
  // aun en pantalla completa. El TERCER arg es el relativeLevel: sube la
  // ventana N niveles por encima del screen-saver base. Granola usa 1 (flag
  // notification_always_on_top_level, default 1). Usamos 2 = un notch POR
  // ENCIMA de su default para ganar el z-order cuando ambas notificaciones
  // conviven (mismo nivel = empate que gana quien ordena al frente de último;
  // un nivel mayor gana siempre). skipTransformProcessType evita que mostrarla
  // cambie el tipo de proceso de la app (parpadeo de Dock/foco).
  win.setAlwaysOnTop(true, 'screen-saver', 2)
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })

  const query = { view: 'banner', label }
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', 'banner')
    url.searchParams.set('label', label)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query })
  }

  // showInactive (no roba foco) + moveTop: nos re-ordena al frente de nuestro
  // nivel en el instante de aparecer, para ganar el empate contra cualquier
  // otra notificación del mismo nivel que se muestre casi a la vez.
  win.once('ready-to-show', () => {
    win.showInactive()
    win.moveTop()
  })
  return win
}
