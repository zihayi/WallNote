import { contextBridge, ipcRenderer } from 'electron';
import type { WallNoteAPI } from '../shared/types';

const api: WallNoteAPI = {
  getState: () => ipcRenderer.invoke('state:get'),
  dispatch: action => ipcRenderer.invoke('state:dispatch', action),
  importWallpapers: () => ipcRenderer.invoke('wallpaper:import'),
  applyWallpaper: id => ipcRenderer.invoke('wallpaper:apply', id),
  onStateChange: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  getInfo: () => ipcRenderer.invoke('app:info'),
  openDataFolder: () => ipcRenderer.invoke('app:dataFolder'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  phoneSyncControl: (command, calendarId) => ipcRenderer.invoke('phone:control', command, calendarId),
  sendEventToPhone: (id, expectedRevision) => ipcRenderer.invoke('phone:send', id, expectedRevision),
  getDesktopStatus: () => ipcRenderer.invoke('desktop:status'),
  getDesktopSurface: () => ipcRenderer.invoke('desktop:surface'),
  onDesktopSurface: callback => {
    const listener = (_event: Electron.IpcRendererEvent, surface: Parameters<typeof callback>[0]) => callback(surface);
    ipcRenderer.on('desktop:surface', listener);
    return () => ipcRenderer.removeListener('desktop:surface', listener);
  },
  focusDesktopWidget: () => ipcRenderer.send('desktop:focus'),
  manipulateDesktopWidget: mode => ipcRenderer.send('desktop:manipulate', mode),
  finishDesktopManipulation: () => ipcRenderer.send('desktop:manipulate-stop'),
  desktopControl: command => ipcRenderer.invoke('desktop:control', command),
  onDesktopStatus: callback => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
    ipcRenderer.on('desktop:changed', listener);
    return () => ipcRenderer.removeListener('desktop:changed', listener);
  },
  windowAction: action => ipcRenderer.send('window:action', action),
};
contextBridge.exposeInMainWorld('wallnote', api);
