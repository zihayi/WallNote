import { contextBridge, ipcRenderer } from 'electron';
import type { WallNoteAPI } from '../shared/types';

// The native host has positioned the real HWND, including its DPI correction.
ipcRenderer.on('widget:reveal', () => { document.documentElement.dataset.widgetMotion = 'visible'; });
ipcRenderer.on('desktop:outside-press', () => { window.dispatchEvent(new Event('wallnote:outside-press')); });

const api: WallNoteAPI = {
  copyNoteImage: dataUrl => ipcRenderer.invoke('note:copy-image', dataUrl),
  getDrawer: () => ipcRenderer.invoke('drawer:get'),
  refreshDrawer: () => ipcRenderer.invoke('drawer:refresh'),
  openDrawerItem: (id,reveal=false) => ipcRenderer.invoke('drawer:open',id,reveal),
  showDrawerMenu: (id,anchor,extended,ticket) => ipcRenderer.invoke('drawer:menu',id,anchor,extended,ticket),
  prepareDrawerMenu: (id,ticket) => ipcRenderer.invoke('drawer:menu-prepare',id,ticket),
  discardDrawerMenu: ticket => ipcRenderer.invoke('drawer:menu-discard',ticket),
  drawerIcon: id => ipcRenderer.invoke('drawer:icon',id),
  setDrawerIcons: hide => ipcRenderer.invoke('drawer:icons',hide),
  onDrawer: callback => { const listener = (_e:Electron.IpcRendererEvent,view:Parameters<typeof callback>[0])=>callback(view);ipcRenderer.on('drawer:changed',listener);return()=>ipcRenderer.removeListener('drawer:changed',listener); },
  getCommunity: () => ipcRenderer.invoke('community:get'),
  configureCommunity: settings => ipcRenderer.invoke('community:configure', settings),
  setCommunityKey: key => ipcRenderer.invoke('community:key', key),
  refreshCommunity: () => ipcRenderer.invoke('community:run'),
  communityItem: (action, day, id) => ipcRenderer.invoke('community:item', action, day, id),
  onCommunity: callback => { const listener = (_e: Electron.IpcRendererEvent, view: Parameters<typeof callback>[0]) => callback(view); ipcRenderer.on('community:changed', listener); return () => ipcRenderer.removeListener('community:changed', listener); },
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
  wifiReceiverControl: (command, id) => ipcRenderer.invoke('wifi:control', command, id),
  sendEventToPhone: (id, expectedRevision) => ipcRenderer.invoke('phone:send', id, expectedRevision),
  openDesktopEventEditor: request => ipcRenderer.invoke('event-editor:open', request),
  getEventEditorData: () => ipcRenderer.invoke('event-editor:get'),
  onEditorCloseRequest: callback => { const listener = () => callback(); ipcRenderer.on('event-editor:request-close', listener); return () => ipcRenderer.removeListener('event-editor:request-close', listener); },
  finishEventEditor: () => ipcRenderer.send('event-editor:finish'),
  getDesktopStatus: () => ipcRenderer.invoke('desktop:status'),
  getDesktopSurface: () => ipcRenderer.invoke('desktop:surface'),
  onDesktopSurface: callback => {
    const listener = (_event: Electron.IpcRendererEvent, surface: Parameters<typeof callback>[0]) => callback(surface);
    ipcRenderer.on('desktop:surface', listener);
    return () => ipcRenderer.removeListener('desktop:surface', listener);
  },
  getLayoutDisplays: () => ipcRenderer.invoke('layout:displays'),
  switchModuleDisplay: id=>ipcRenderer.invoke('layout:switch-display',id),
  onLayoutDisplaysChange: callback=>{
    const listener=(_e:Electron.IpcRendererEvent,displays:Parameters<typeof callback>[0])=>callback(displays);
    ipcRenderer.on('layout:displays-changed',listener);return()=>ipcRenderer.removeListener('layout:displays-changed',listener);
  },
  onLayoutGuides: callback => { const listener = (_e: Electron.IpcRendererEvent, guides: Parameters<typeof callback>[0]) => callback(guides); ipcRenderer.on('layout:guides',listener); return () => ipcRenderer.removeListener('layout:guides', listener); },
  onLayoutSaveError: callback => { const listener=()=>callback(); ipcRenderer.on('layout:save-error',listener); return () => ipcRenderer.removeListener('layout:save-error',listener); },
  manipulateDesktopWidget: (mode,anchor,bypass) => ipcRenderer.send('desktop:manipulate', mode,anchor,bypass),
  finishDesktopManipulation: cancel => ipcRenderer.send('desktop:manipulate-stop',cancel),
  desktopControl: command => ipcRenderer.invoke('desktop:control', command),
  onDesktopStatus: callback => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
    ipcRenderer.on('desktop:changed', listener);
    return () => ipcRenderer.removeListener('desktop:changed', listener);
  },
  windowAction: action => ipcRenderer.send('window:action', action),
};
contextBridge.exposeInMainWorld('wallnote', api);
