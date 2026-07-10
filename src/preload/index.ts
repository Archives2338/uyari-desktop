import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type UyariBridge } from '@shared/ipc'
import type { CaptionSegment, MicControlCmd, SessionInfo } from '@shared/domain'

// Puente único y tipado entre renderer y main. El renderer no ve electron:
// solo window.uyari, cuya forma es UyariBridge (shared/ipc.ts).

function subscribe<T>(channel: string): (cb: (payload: T) => void) => () => void {
  return (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

const bridge: UyariBridge = {
  auth: {
    login: (email) => ipcRenderer.invoke(IPC.authLogin, email),
    state: () => ipcRenderer.invoke(IPC.authState),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
  },
  permissions: {
    status: () => ipcRenderer.invoke(IPC.permissionsStatus),
    requestMicrophone: () => ipcRenderer.invoke(IPC.permissionsRequestMic),
    openScreenRecordingSettings: () => ipcRenderer.invoke(IPC.permissionsOpenScreenSettings),
  },
  capture: {
    start: (title) => ipcRenderer.invoke(IPC.captureStart, title),
    stop: () => ipcRenderer.invoke(IPC.captureStop),
    pause: () => ipcRenderer.invoke(IPC.capturePause),
    resume: () => ipcRenderer.invoke(IPC.captureResume),
    state: () => ipcRenderer.invoke(IPC.captureState),
  },
  meetings: {
    list: (params) => ipcRenderer.invoke(IPC.meetingsList, params),
    get: (clientSessionId) => ipcRenderer.invoke(IPC.meetingsGet, clientSessionId),
    ask: (clientSessionId, question) =>
      ipcRenderer.invoke(IPC.meetingsAsk, clientSessionId, question),
    askAll: (question, meetingIds, history) =>
      ipcRenderer.invoke(IPC.meetingsAskAll, question, meetingIds, history),
    share: (clientSessionId) => ipcRenderer.invoke(IPC.meetingsShare, clientSessionId),
  },
  mic: {
    chunk: (data) => ipcRenderer.send(IPC.micChunk, data),
    error: (message) => ipcRenderer.send(IPC.micError, message),
    log: (message) => ipcRenderer.send(IPC.micLog, message),
  },
  net: {
    setOnline: (online) => ipcRenderer.send(IPC.netStatus, online),
  },
  overlay: {
    dragStart: () => ipcRenderer.send(IPC.overlayDrag, 'start'),
    dragEnd: () => ipcRenderer.send(IPC.overlayDrag, 'end'),
    focusMain: () => ipcRenderer.send(IPC.overlayFocusMain),
    openAsk: () => ipcRenderer.send(IPC.overlayOpenAsk),
  },
  events: {
    onCaption: subscribe<CaptionSegment>(IPC.evCaption),
    onSession: subscribe<SessionInfo | null>(IPC.evSession),
    onMicControl: subscribe<MicControlCmd>(IPC.evMicControl),
    onMeetingDetected: subscribe<{ label: string }>(IPC.evMeetingDetected),
    onNubExpanded: subscribe<boolean>(IPC.evNubExpanded),
    onOpenAsk: subscribe<void>(IPC.evOpenAsk),
  },
}

contextBridge.exposeInMainWorld('uyari', bridge)
