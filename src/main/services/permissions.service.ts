import { shell, systemPreferences } from 'electron'
import type { PermissionState, PermissionsStatus } from '@shared/domain'

// Permisos TCC de macOS. El de micrófono se puede pedir en runtime;
// el de Screen Recording (necesario para el audio del sistema vía
// ScreenCaptureKit/Core Audio tap) solo se otorga desde System Settings,
// así que ofrecemos el deep-link al panel correspondiente.

const SCREEN_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

function mediaStatus(media: 'microphone' | 'screen'): PermissionState {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus(media) as PermissionState
}

export const permissionsService = {
  status(): PermissionsStatus {
    return { microphone: mediaStatus('microphone'), screen: mediaStatus('screen') }
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
