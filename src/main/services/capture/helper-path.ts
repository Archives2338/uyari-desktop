import { join } from 'node:path'
import { app } from 'electron'

/** Ruta del helper Swift (native/bin en dev, Resources/ empaquetado). */
export function helperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'uyari-audio-helper')
    : join(app.getAppPath(), 'native/bin/uyari-audio-helper')
}
