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
    state: () => ipcRenderer.invoke(IPC.captureState),
  },
  mic: {
    chunk: (data) => ipcRenderer.send(IPC.micChunk, data),
    error: (message) => ipcRenderer.send(IPC.micError, message),
    log: (message) => ipcRenderer.send(IPC.micLog, message),
  },
  net: {
    setOnline: (online) => ipcRenderer.send(IPC.netStatus, online),
  },
  events: {
    onCaption: subscribe<CaptionSegment>(IPC.evCaption),
    onSession: subscribe<SessionInfo | null>(IPC.evSession),
    onMicControl: subscribe<MicControlCmd>(IPC.evMicControl),
  },
}

contextBridge.exposeInMainWorld('uyari', bridge)
