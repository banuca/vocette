import { contextBridge, ipcRenderer } from 'electron'
import type {
  RecorderAudioPayload,
  RecorderErrorPayload,
  RecorderStartRequest,
  RecorderStartedPayload,
  RecorderStopRequest
} from '../shared/types'

const api = {
  onStart: (callback: (request: RecorderStartRequest) => void): (() => void) => {
    const listener = (_event: unknown, request: RecorderStartRequest): void => callback(request)
    ipcRenderer.on('recorder:start', listener)
    return () => ipcRenderer.removeListener('recorder:start', listener)
  },
  onStop: (callback: (request: RecorderStopRequest) => void): (() => void) => {
    const listener = (_event: unknown, request: RecorderStopRequest): void => callback(request)
    ipcRenderer.on('recorder:stop', listener)
    return () => ipcRenderer.removeListener('recorder:stop', listener)
  },
  sendStarted: (payload: RecorderStartedPayload): void =>
    ipcRenderer.send('recorder:started', payload),
  sendAudio: (payload: RecorderAudioPayload): void => ipcRenderer.send('recorder:audio', payload),
  sendError: (payload: RecorderErrorPayload): void => ipcRenderer.send('recorder:error', payload)
}

export type RecorderApi = typeof api

contextBridge.exposeInMainWorld('recorder', api)
