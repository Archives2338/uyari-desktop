import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'

// Overlay "nub" flotante — réplica del modelo de Granola (su nub.node) con
// el diseño OA/OD (dock vertical + popover al hover, sin tabs):
//
//   1. La ventana nace YA con el tamaño expandido, anclada al borde derecho
//      y CENTRADA VERTICALMENTE (no top-anchored), y es click-through en su
//      zona transparente. NUNCA se redimensiona (nada salta bajo el cursor).
//   2. En reposo solo se ve el DOCK (icono + puntos de estado) — una franja
//      angosta contra el borde. El popover con transcript + "Pregúntale a
//      Uyari" vive a su izquierda, oculto por CSS hasta el hover.
//   3. El hover NO usa eventos DOM (poco confiables con click-through): se
//      CALCULA en el main comparando la posición global del cursor
//      (screen.getCursorScreenPoint() = NSEvent.mouseLocation, la misma
//      primitiva de AppKit que usa el computeNubWindowHovered de Granola)
//      contra los bounds del DOCK. Poll de 50 ms.
//   4. El drag es manual: el renderer avisa mousedown/mouseup sobre el dock
//      y el main mueve la ventana siguiendo el cursor.
//
// Always-on-top, visible en todos los espacios, no roba foco.

const WIDTH = 360
const HEIGHT = 440

// Geometría del dock DENTRO de la ventana — debe coincidir con .nub-dock en
// app.css (right/width/height/margen). Es lo que el main usa para saber si
// el cursor está "sobre la pill".
const DOCK_WIDTH = 56
const DOCK_HEIGHT = 76
const DOCK_MARGIN = 12

const POLL_MS = 50

/**
 * Crea la ventana del nub. `initiallyVisible` decide si aparece apenas esté
 * lista o si nace oculta (p.ej. porque la ventana principal ya tiene el
 * foco — ver syncNubWithMainWindow, patrón Granola: nub visible ⟺ sesión
 * activa Y la principal sin foco/oculta).
 */
export function createOverlayWindow(initiallyVisible: boolean): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: workArea.x + workArea.width - WIDTH - 24,
    y: workArea.y + Math.round((workArea.height - HEIGHT) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    // NSPanel NO-activador: clickear los botones del nub (pausa/resume/stop)
    // recibe el click SIN activar la app — antes traía la ventana principal
    // al frente en cada click. "Pregúntale a Uyari" sí abre la app, pero con
    // su focusMain explícito. hiddenInMissionControl: no ensucia el expose.
    type: 'panel',
    hiddenInMissionControl: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  })
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?view=overlay`)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      query: { view: 'overlay' },
    })
  }

  if (initiallyVisible) win.once('ready-to-show', () => win.showInactive())
  return win
}

/**
 * Sincroniza la visibilidad del nub con el foco de la ventana principal
 * (modelo Granola, confirmado por ingeniería inversa de su bundle):
 * foco en la principal → nub oculto siempre; la principal pierde foco o se
 * oculta → nub visible SI hay captura activa. Sin debounce: el toggle es
 * inmediato, igual que en Granola. No hace falta escuchar minimize/restore
 * por separado — en macOS minimizar dispara blur/hide y restaurar focus.
 */
export function syncNubWithMainWindow(
  mainWin: BrowserWindow,
  getOverlay: () => BrowserWindow | null,
  isCapturing: () => boolean,
): void {
  const update = (mainFocused: boolean): void => {
    const overlay = getOverlay()
    if (!overlay || overlay.isDestroyed()) return
    if (mainFocused) overlay.hide()
    else if (isCapturing()) overlay.showInactive()
  }
  mainWin.on('focus', () => update(true))
  mainWin.on('blur', () => update(false))
  mainWin.on('hide', () => update(false))
}

export interface NubBehavior {
  /** El renderer reporta mousedown/mouseup sobre el dock (drag manual). */
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

  const dockRect = (): { x: number; y: number; w: number; h: number } => {
    const b = win.getBounds()
    return {
      x: b.x + b.width - DOCK_WIDTH - DOCK_MARGIN,
      y: b.y + Math.round((b.height - DOCK_HEIGHT) / 2),
      w: DOCK_WIDTH,
      h: DOCK_HEIGHT,
    }
  }

  const inside = (
    p: { x: number; y: number },
    r: { x: number; y: number; w: number; h: number },
  ): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

  const setExpanded = (next: boolean): void => {
    if (expanded === next) return
    expanded = next
    // Interactiva mientras está expandida (scroll + stop + ask); click
    // a través con forward al colapsar.
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
      if (inside(cursor, dockRect())) setExpanded(true)
      return
    }
    // Expandido: colapsar cuando el cursor sale de la ventana completa
    // (el popover ocupa casi todo el resto de la ventana).
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
