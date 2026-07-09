import { execFile } from 'node:child_process'
import { shell, systemPreferences } from 'electron'
import { helperPath } from './capture/helper-path'
import type { PermissionState, PermissionsStatus } from '@shared/domain'

// Permisos TCC de macOS. El de micrófono se puede pedir en runtime; el de
// audio del sistema solo se otorga desde System Settings.
//
// El permiso que de verdad usamos NO es "Screen Recording": el canal de
// audio del sistema es un Core Audio process tap, que usa "System Audio
// Recording" (sección aparte de Ajustes, donde vive Granola). Por eso NO
// consultamos getMediaAccessStatus('screen') — miraría el permiso
// equivocado (además de sufrir el cache por-proceso de electron#36722).
//
// Fuente de verdad = el helper intenta crear el tap (--check-permissions)
// en un proceso FRESCO, sin el cache que deja a Electron pegado en
// "denied". Fallback a getMediaAccessStatus('screen') solo si el helper no
// está compilado.
//
// Nota dev: TCC atribuye el permiso al "responsible process" — al correr
// `npm run dev` desde la terminal de VS Code, el grant queda a nombre de
// VS Code (por eso aparece "Visual Studio Code" y nunca "Electron" en la
// lista). Es esperado; en la app firmada y empaquetada el grant es de
// Uyari.app.

const SCREEN_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

function mediaStatus(media: 'microphone' | 'screen'): PermissionState {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus(media) as PermissionState
}

/** Estado real del permiso de audio del sistema vía helper (proceso fresco,
 *  intenta crear el tap). Es la fuente de verdad, sin el cache de Electron. */
function systemAudioStatusLive(): Promise<PermissionState | null> {
  return new Promise((resolve) => {
    execFile(helperPath(), ['--check-permissions'], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null)
      try {
        const parsed = JSON.parse(stdout.trim()) as { audio?: boolean }
        if (typeof parsed.audio !== 'boolean') return resolve(null)
        resolve(parsed.audio ? 'granted' : 'denied')
      } catch {
        resolve(null)
      }
    })
  })
}

export const permissionsService = {
  async status(): Promise<PermissionsStatus> {
    if (process.platform !== 'darwin') {
      return { microphone: 'granted', screen: 'granted' }
    }
    const screen = (await systemAudioStatusLive()) ?? mediaStatus('screen')
    return { microphone: mediaStatus('microphone'), screen }
  },

  async requestMicrophone(): Promise<PermissionState> {
    if (process.platform !== 'darwin') return 'granted'
    await systemPreferences.askForMediaAccess('microphone')
    return mediaStatus('microphone')
  },

  async openScreenRecordingSettings(): Promise<void> {
    await shell.openExternal(SCREEN_SETTINGS_URL)
  },
}
