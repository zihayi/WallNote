import { createInitialState, isValidState, reduceState } from '../shared/state';
import type { AppState, WallNoteAPI, Wallpaper } from '../shared/types';
import { emptyCommunity } from '../shared/community';
import { emptyDrawer } from '../shared/drawer';

const storageKey = 'wallnote.preview.v1';
const updates = new EventTarget();

function readState(): AppState {
  const stored = localStorage.getItem(storageKey);
  if (!stored) {
    const initial = createInitialState();
    localStorage.setItem(storageKey, JSON.stringify(initial));
    return initial;
  }
  const parsed: unknown = JSON.parse(stored);
  if (!isValidState(parsed)) throw new Error('浏览器本地数据无法读取。请备份浏览器数据后重试，或启动桌面版。');
  return parsed;
}

function saveState(state: AppState): AppState {
  if (!isValidState(state)) throw new Error('内容超出限制，无法保存。');
  localStorage.setItem(storageKey, JSON.stringify(state));
  updates.dispatchEvent(new CustomEvent('change', { detail: state }));
  return state;
}

const previewAPI: WallNoteAPI = {
  getDrawer: async()=>emptyDrawer(),refreshDrawer:async()=>emptyDrawer(),drawerIcon:async()=>'',
  openDrawerItem:async()=>{throw new Error('请在 Windows 桌面版中打开项目。');},
  setDrawerIcons:async()=>{throw new Error('请在 Windows 桌面版中设置桌面图标。');},
  onDrawer:()=>()=>undefined,
  getCommunity: async () => emptyCommunity(),
  configureCommunity: async () => { throw new Error('请在桌面版设置订阅。'); },
  setCommunityKey: async () => { throw new Error('密钥只在 Windows 桌面版中设置。'); },
  refreshCommunity: async () => { throw new Error('请在桌面版生成日报。'); },
  communityItem: async () => { throw new Error('请在桌面版查看来源。'); },
  onCommunity: () => () => undefined,
  getState: async () => readState(),
  dispatch: async action => {
    if (action.type === 'note:update' && action.changes.pinned) throw new Error('请运行桌面版，即可将便签贴到桌面。');
    if (action.type === 'settings:update' && action.changes.launchAtLogin !== undefined) throw new Error('开机启动需要在桌面版中设置。');
    return saveState(reduceState(readState(), action));
  },
  importWallpapers: async () => { throw new Error('导入本地壁纸需要桌面版，请使用 npm run dev 启动。'); },
  applyWallpaper: async () => { throw new Error('当前为浏览器预览。请在 Windows 桌面版中设置系统壁纸。'); },
  onStateChange: callback => {
    const listener = (event: Event) => callback((event as CustomEvent<AppState>).detail);
    const storage = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue) return;
      try { const next: unknown = JSON.parse(event.newValue); if (isValidState(next)) callback(next); } catch { /* Do not overwrite the current valid state. */ }
    };
    updates.addEventListener('change', listener);
    window.addEventListener('storage', storage);
    return () => { updates.removeEventListener('change', listener); window.removeEventListener('storage', storage); };
  },
  getInfo: async () => ({ version: '0.9.0', platform: 'browser', dataPath: '当前浏览器的本地存储', desktop: false, supportsLaunchAtLogin: false }),
  openDataFolder: async () => { throw new Error('浏览器预览使用 localStorage；桌面版数据保存在本地应用目录。'); },
  exportBackup: async () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(readState(), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `WallNote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },
  restoreBackup: async () => { throw new Error('请在桌面版中恢复 JSON 备份。'); },
  phoneSyncControl: async () => { throw new Error('手机同步需要 Windows 桌面版。'); },
  wifiReceiverControl: async command => {
    if (command === 'status') return { running: false, discoveryAvailable: false, discoveryPort: 0, pairingUntil: 0, requests: [], error: null };
    throw new Error('Wi-Fi 自动配对需要 Windows 桌面版。');
  },
  sendEventToPhone: async () => { throw new Error('请在桌面版中连接 CalendarBridge。'); },
  openDesktopEventEditor: async () => false,
  getEventEditorData: async () => { throw new Error('请通过桌面组件打开编辑窗口。'); },
  onEditorCloseRequest: () => () => undefined,
  finishEventEditor: () => undefined,
  getDesktopStatus: async () => ({ enabled: false, active: false, displays: 0, widgets: 0, error: null }),
  desktopControl: async () => { throw new Error('请启动 Windows 桌面版，将 WallNote 直接铺到电脑桌面。'); },
  onDesktopStatus: () => () => undefined,
  getDesktopSurface: async () => null,
  onDesktopSurface: () => () => undefined,
  focusDesktopWidget: () => undefined,
  manipulateDesktopWidget: () => undefined,
  getLayoutDisplays: async () => [{ id: 0, primary: true, workArea: { x:0,y:0,width:window.screen.availWidth||1440,height:window.screen.availHeight||900 } }],
  onLayoutGuides: () => () => undefined,
  onLayoutSaveError: () => () => undefined,
  finishDesktopManipulation: () => undefined,
  windowAction: () => undefined,
};

export const api = window.wallnote ?? previewAPI;
export const isDesktop = !!window.wallnote;
export function wallpaperURL(wallpaper: Wallpaper): string {
  return wallpaper.category === 'imported' ? `wallnote://image/${wallpaper.id}` : `./wallpapers/${wallpaper.file}`;
}
export function blurredWallpaperURL(wallpaper: Wallpaper): string { return isDesktop ? `wallnote://blur/${wallpaper.id}` : wallpaperURL(wallpaper); }

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '操作失败，请稍后再试。';
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
