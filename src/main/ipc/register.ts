import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AuthState } from '@shared/domain'
import type { ApiClient } from '../services/api.client'
import type { SettingsStore } from '../services/settings.store'
import type { MeetingService } from '../services/meeting.service'
import { permissionsService } from '../services/permissions.service'

// Único punto donde se registran handlers IPC. Cada handler delega en un
// servicio; aquí no vive lógica de negocio.

interface Services {
  settings: SettingsStore
  api: ApiClient
  meetings: MeetingService
}

export function registerIpc({ settings, api, meetings }: Services): void {
  const authState = (): AuthState => ({
    loggedIn: Boolean(settings.token),
    email: settings.email,
  })

  ipcMain.handle(IPC.authLogin, async (_e, email: string) => {
    await api.login(email)
    return authState()
  })
  ipcMain.handle(IPC.authState, () => authState())
  ipcMain.handle(IPC.authLogout, () => settings.clearSession())

  ipcMain.handle(IPC.permissionsStatus, () => permissionsService.status())
  ipcMain.handle(IPC.permissionsRequestMic, () => permissionsService.requestMicrophone())
  ipcMain.handle(IPC.permissionsOpenScreenSettings, () =>
    permissionsService.openScreenRecordingSettings(),
  )

  ipcMain.handle(IPC.captureStart, (_e, title?: string) => meetings.start(title))
  ipcMain.handle(IPC.captureStop, () => meetings.stop())
  ipcMain.handle(IPC.captureState, () => meetings.state())

  // Audio del mic: alto volumen, fire-and-forget (send, no invoke).
  ipcMain.on(IPC.micChunk, (_e, chunk: ArrayBuffer) => meetings.acceptAudio(chunk))
  ipcMain.on(IPC.micError, (_e, message: string) => meetings.reportMicError(message))
  ipcMain.on(IPC.micLog, (_e, message: string) => console.log('[mic-renderer]', message))
  ipcMain.on(IPC.netStatus, (_e, online: boolean) => meetings.setNetworkOnline(online))
}
