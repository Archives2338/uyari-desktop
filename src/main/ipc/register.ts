import { ipcMain } from 'electron'
import { IPC, type ResumeDescriptor } from '@shared/ipc'
import type { AuthState, ProjectStatus } from '@shared/domain'
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
  /** Gestión de ventana del nub flotante — sin lógica de negocio. */
  overlay: {
    drag(action: 'start' | 'end'): void
    focusMain(): void
    openAsk(): void
  }
}

export function registerIpc({ settings, api, meetings, overlay }: Services): void {
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

  ipcMain.handle(IPC.captureStart, (_e, title?: string, resume?: ResumeDescriptor) =>
    meetings.start(title, resume),
  )
  ipcMain.handle(IPC.captureStop, () => meetings.stop())
  ipcMain.handle(IPC.capturePause, () => meetings.pause())
  ipcMain.handle(IPC.captureResume, () => meetings.resume())
  ipcMain.handle(IPC.captureState, () => meetings.state())
  ipcMain.on(IPC.captureRename, (_e, title: string) => meetings.renameSession(title))

  ipcMain.handle(IPC.meetingsList, (_e, params?: { cursor?: string; limit?: number }) =>
    api.listMeetings(params),
  )
  ipcMain.handle(IPC.meetingsGet, (_e, clientSessionId: string) => api.getMeeting(clientSessionId))
  ipcMain.handle(IPC.meetingsSaveNotes, (_e, clientSessionId: string, userNotes: string) =>
    api.saveNotes(clientSessionId, userNotes),
  )
  ipcMain.handle(IPC.meetingsSaveTitle, (_e, clientSessionId: string, title: string) =>
    api.saveTitle(clientSessionId, title),
  )
  ipcMain.handle(IPC.meetingsSaveSummary, (_e, clientSessionId: string, content: string) =>
    api.saveSummary(clientSessionId, content),
  )
  ipcMain.handle(
    IPC.meetingsRegenerateSummary,
    (_e, clientSessionId: string, template?: string) =>
      api.regenerateSummary(clientSessionId, template),
  )
  ipcMain.handle(IPC.meetingsAsk, (_e, clientSessionId: string, question: string) =>
    api.ask(clientSessionId, question),
  )
  ipcMain.handle(
    IPC.meetingsAskAll,
    (_e, question: string, meetingIds?: string[], history?: Array<{ question: string; answer: string }>) =>
      api.askAll(question, meetingIds, history),
  )
  ipcMain.handle(IPC.meetingsShare, (_e, clientSessionId: string) => api.share(clientSessionId))
  ipcMain.handle(
    IPC.meetingsAssignProject,
    (_e, clientSessionId: string, projectId: string | null) =>
      api.assignMeetingToProject(clientSessionId, projectId),
  )

  // Proyectos (el diferenciador: agrupan reuniones + rollup de pendientes).
  ipcMain.handle(IPC.projectsList, (_e, includeArchived?: boolean) =>
    api.listProjects(includeArchived),
  )
  ipcMain.handle(IPC.projectsCreate, (_e, name: string, color?: string, description?: string) =>
    api.createProject(name, color, description),
  )
  ipcMain.handle(IPC.projectsGet, (_e, projectId: string) => api.getProject(projectId))
  ipcMain.handle(
    IPC.projectsUpdate,
    (
      _e,
      projectId: string,
      patch: {
        name?: string
        description?: string | null
        color?: string | null
        status?: ProjectStatus
        favorite?: boolean
      },
    ) => api.updateProject(projectId, patch),
  )
  ipcMain.handle(IPC.projectsDelete, (_e, projectId: string) => api.deleteProject(projectId))

  // Audio del mic: alto volumen, fire-and-forget (send, no invoke).
  ipcMain.on(IPC.micChunk, (_e, chunk: ArrayBuffer) => meetings.acceptAudio(chunk))
  ipcMain.on(IPC.micError, (_e, message: string) => meetings.reportMicError(message))
  ipcMain.on(IPC.micLog, (_e, message: string) => console.log('[mic-renderer]', message))
  ipcMain.on(IPC.netStatus, (_e, online: boolean) => meetings.setNetworkOnline(online))
  ipcMain.on(IPC.overlayDrag, (_e, action: 'start' | 'end') => overlay.drag(action))
  ipcMain.on(IPC.overlayFocusMain, () => overlay.focusMain())
  ipcMain.on(IPC.overlayOpenAsk, () => overlay.openAsk())
}
