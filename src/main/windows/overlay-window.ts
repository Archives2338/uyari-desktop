import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'

// Overlay "nub" flotante — réplica del modelo de Granola (su nub.node):
//
//   1. La ventana nace YA con el tamaño expandido y es click-through en su
//      zona transparente. NUNCA se redimensiona (nada salta bajo el cursor).
//   2. El hover NO usa eventos DOM (poco confiables con click-through):
//      se CALCULA en el main comparando la posición global del cursor
//      (screen.getCursorScreenPoint() = NSEvent.mouseLocation, la misma
//      primitiva de AppKit que usa el computeNubWindowHovered de Granola)
//      contra los bounds de la pill / de la ventana. Poll de 50 ms.
//   3. El drag es manual: el renderer avisa mousedown/mouseup en la pill y
//      el main mueve la ventana siguiendo el cursor (el -webkit-app-region
//      drag no funciona bien en ventanas frameless no-focusables).
//
// Always-on-top, visible en todos los espacios, no roba foco.

const WIDTH = 360
const HEIGHT = 420
// Geometría de la pill DENTRO de la ventana (espejo de .overlay-pill en
// app.css: chip de 240×44 con margen 4 anclado arriba a la derecha).
const PILL_WIDTH = 240
const PILL_HEIGHT = 44
const PILL_MARGIN = 4

const POLL_MS = 50

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
  win.setIgnoreMouseEvents(true, { forward: true })

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

export interface NubBehavior {
  /** El renderer reporta mousedown/mouseup sobre la pill (drag manual). */
  drag(action: 'start' | 'end'): void
  dispose(): void
}

/**
 * Instala el comportamiento del nub sobre la ventana: hover calculado por
 * posición global del cursor + drag manual. Se auto-destruye al cerrarse
 * la ventana.
 */
export function attachNubBehavior(win: BrowserWindow): NubBehavior {
  let expanded = false
  let dragging = false
  // Offset cursor→esquina de la ventana al iniciar el drag, para que la
  // ventana no "salte" al primer movimiento.
  let dragOffset = { x: 0, y: 0 }

  const pillRect = (): { x: number; y: number; w: number; h: number } => {
    const b = win.getBounds()
    return {
      x: b.x + b.width - PILL_WIDTH - PILL_MARGIN,
      y: b.y + PILL_MARGIN,
      w: PILL_WIDTH,
      h: PILL_HEIGHT,
    }
  }

  const inside = (
    p: { x: number; y: number },
    r: { x: number; y: number; w: number; h: number },
  ): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

  const setExpanded = (next: boolean): void => {
    if (expanded === next) return
    expanded = next
    // Interactiva mientras está expandida (scroll + stop); click-through
    // con forward al colapsar.
    if (next) win.setIgnoreMouseEvents(false)
    else win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.send(IPC.evNubExpanded, next)
  }

  const tick = (): void => {
    if (win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()

    if (dragging) {
      // Seguir el cursor manteniendo el offset del agarre.
      win.setPosition(cursor.x - dragOffset.x, cursor.y - dragOffset.y)
      return
    }

    if (!expanded) {
      if (inside(cursor, pillRect())) setExpanded(true)
      return
    }
    // Expandido: colapsar cuando el cursor sale de la ventana completa.
    const b = win.getBounds()
    if (!inside(cursor, { x: b.x, y: b.y, w: b.width, h: b.height })) setExpanded(false)
  }

  const timer = setInterval(tick, POLL_MS)

  const behavior: NubBehavior = {
    drag(action) {
      if (win.isDestroyed()) return
      if (action === 'start') {
        const cursor = screen.getCursorScreenPoint()
        const b = win.getBounds()
        dragOffset = { x: cursor.x - b.x, y: cursor.y - b.y }
        dragging = true
      } else {
        dragging = false
      }
    },
    dispose() {
      clearInterval(timer)
    },
  }

  win.on('closed', () => behavior.dispose())
  return behavior
}
