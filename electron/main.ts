import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, shell, Tray, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { allWallpapers, builtInWallpapers, createNote, isValidState, reduceState } from '../shared/state';
import type { Action, AppState, DesktopCommand, Wallpaper } from '../shared/types';
import { StateStore } from './store';
import { DesktopController } from './desktop';
import { upgradeDesktopLayout } from '../shared/layout';
import { PhoneSyncController } from './phone-sync';
import { parsePhoneProfile } from './phone-client';
import { WallpaperCache } from './wallpaper-cache';
import { stateForView } from '../shared/renderer-state';
import { dateKey } from '../shared/calendar';
import { WifiReceiver } from './wifi-receiver';
import { ManagerMotion } from './window-motion';

// Isolated user data is used by desktop smoke tests; normal sessions use Electron's userData.
if (process.env.WALLNOTE_DATA_DIR) app.setPath('userData', process.env.WALLNOTE_DATA_DIR);
app.setName('WallNote');
const supportsLaunchAtLogin = process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
if (process.platform === 'win32') app.setAppUserModelId('com.wallnote.desktop');
// Static wallpapers and pre-blurred widgets do not need a GPU raster cache per window.
// Keep an explicit escape hatch for machines with unusual software-compositor behavior.
if (process.env.WALLNOTE_HARDWARE_RENDERING !== '1') app.disableHardwareAcceleration();
// Explorer's icon view covers the wallpaper HWND; Chromium must not treat it as an occluded app.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// All renderer pages are bundled, same-site application UI. Reuse a renderer for that site.
app.commandLine.appendSwitch('process-per-site');
protocol.registerSchemesAsPrivileged([{ scheme: 'wallnote', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

const devURL = process.env.VITE_DEV_SERVER_URL;
const rendererDir = path.join(__dirname, '..', 'dist');
const assetDir = devURL ? path.join(__dirname, '..', 'public') : rendererDir;
const store = new StateStore(app.getPath('userData'));
const imageDir = path.join(store.directory, 'wallpapers');
let mainWindow: BrowserWindow | null = null;
let managerMotion: ManagerMotion | null = null;
let managerLoaded: Promise<void> = Promise.resolve();
let managerIdleTimer: ReturnType<typeof setTimeout> | null = null;
let rendererDayTimer: ReturnType<typeof setInterval> | null = null;
let tray: Tray | null = null;
let quitting = false;
let flushed = false;
let queue: Promise<unknown> = Promise.resolve();
const wallpaperCache = new WallpaperCache(path.join(store.directory, 'render-cache'), wallpaperPath);
const desktop = new DesktopController(() => store.state, loadWindow, action => serial(async () => {
  if (quitting) return;
  await store.save(reduceState(store.state, action));
  await desktop.sync(); broadcast();
}), status => {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('desktop:changed', status);
  updateTray();
});
const phoneSync = new PhoneSyncController(store.directory, () => store.state, transform => serial(async () => {
  const next = transform(store.state);
  if (JSON.stringify(next) !== JSON.stringify(store.state)) { await store.save(next); broadcast(); }
}));
const receiverExecutable = app.isPackaged ? path.join(process.resourcesPath, 'native', 'CalendarBridge.Receiver.exe') : process.env.CALENDAR_PYTHON || 'python';
const receiverArgs = app.isPackaged ? [] : ['-u', path.resolve(process.env.CALENDAR_BRIDGE_ROOT || path.join(__dirname, '..', 'receiver'), 'server.py')];
if (process.env.WALLNOTE_DATA_DIR && process.env.WALLNOTE_WIFI_TEST_LOOPBACK === '1') receiverArgs.push('--host', '127.0.0.1', '--discovery-port', '0');
const wifiReceiver = new WifiReceiver(store.directory, receiverExecutable, receiverArgs, profile => phoneSync.connect(profile));

function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}

function wallpaperPath(wallpaper: Wallpaper): string {
  return builtInWallpapers.some(w => w.id === wallpaper.id)
    ? path.join(assetDir, 'wallpapers', wallpaper.file)
    : path.join(imageDir, wallpaper.file);
}

function trusted(event: IpcMainInvokeEvent, mainOnly = false): void {
  const known = mainWindow?.webContents === event.sender || (!mainOnly && desktop.identify(event.sender));
  if (!known || event.senderFrame !== event.sender.mainFrame) throw new Error('无权执行此操作');
}

function secureWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

async function loadWindow(win: BrowserWindow, query: Record<string, string> = {}): Promise<void> {
  if (devURL) {
    const url = new URL(devURL);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    await win.loadURL(url.toString());
  } else await win.loadFile(path.join(rendererDir, 'index.html'), { query });
}

function createMainWindow(show = false): void {
  mainWindow = new BrowserWindow({
    width: 1380, height: 920, minWidth: 1000, minHeight: 720, frame: false,
    backgroundColor: '#f6f7f9', title: 'WallNote', icon: path.join(assetDir, 'icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  secureWindow(mainWindow);
  const window = mainWindow;
  window.on('show', () => { if (!window.isDestroyed()) window.webContents.send('state:changed', store.state); });
  const motion = managerMotion = new ManagerMotion(window, show, () => {
    if (managerIdleTimer) clearTimeout(managerIdleTimer);
    if (quitting) return;
    managerIdleTimer = setTimeout(() => {
      // Keep open forms and unfinished task input; release only an idle management page.
      if (window.isDestroyed() || window.isVisible()) return;
      void window.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"], .task-edit-form') || [...document.querySelectorAll('.task-input input')].some(input => input.value.trim()) || [...document.querySelectorAll('.save-status')].some(item => /保存失败|正在编辑|保存中/.test(item.textContent)))`).then(hasDraft => {
        if (!hasDraft && mainWindow === window && !window.isDestroyed() && !window.isVisible()) window.destroy();
      }).catch(() => undefined);
    }, 30000);
  });
  window.on('close', event => {
    if (flushed) return;
    event.preventDefault(); if (!quitting) void motion.hide();
  });
  window.on('closed', () => { if (mainWindow === window) { mainWindow = null; managerMotion = null; } });
  managerLoaded = loadWindow(window);
}

function showManager() {
  if (managerIdleTimer) clearTimeout(managerIdleTimer);
  if (!mainWindow || mainWindow.isDestroyed()) { createMainWindow(true); return; }
  managerMotion?.show();
}

function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const status = desktop.getStatus();
  tray.setToolTip(status.active ? 'WallNote · 桌面壁纸正在运行' : 'WallNote · 桌面管理');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 WallNote 管理面板', click: showManager },
    { label: '新建桌面便签', click: () => { void serial(async () => {
      const note = { ...createNote(), pinned: true, title: '新建便签' };
      await store.save(reduceState({ ...store.state, settings: { ...store.state.settings, desktopEnabled: true, showDesktopNotes: true } }, { type: 'note:add', note }));
      await desktop.sync(); broadcast();
    }).catch(reportBackgroundError); } },
    { label: '显示桌面待办', type: 'checkbox', checked: store.state.settings.showDesktopTasks !== false, click: item => { void serial(async () => {
      await store.save(reduceState(store.state, { type: 'settings:update', changes: { showDesktopTasks: item.checked } }));
      await desktop.sync(); broadcast();
    }).catch(reportBackgroundError); } },
    ...([['显示日历', 'showDesktopCalendar'], ['显示时间安排', 'showDesktopSchedule'], ['显示桌面便签', 'showDesktopNotes']] as const).map(([label, key]) => ({ label, type: 'checkbox' as const, checked: store.state.settings[key] !== false, click: (item: Electron.MenuItem) => { void serial(async () => { await store.save(reduceState(store.state, { type: 'settings:update', changes: { [key]: item.checked } })); await desktop.sync(); broadcast(); }).catch(reportBackgroundError); } })),
    { type: 'separator' },
    { label: status.enabled ? '暂停桌面壁纸' : '启用桌面壁纸', click: () => { void controlDesktop(status.enabled ? 'disable' : 'enable').catch(reportBackgroundError); } },
    { label: '退出 WallNote', click: () => app.quit() },
  ]));
}

async function controlDesktop(command: DesktopCommand) {
  if (command === 'quit') { setImmediate(() => app.quit()); return desktop.getStatus(); }
  if (command === 'showManager') { showManager(); return desktop.getStatus(); }
  if (command === 'showPhoneSync') {
    showManager();
    const window = mainWindow;
    await managerLoaded;
    if (window && !window.isDestroyed()) await window.webContents.executeJavaScript("location.hash = 'phone-sync'; void 0");
    return desktop.getStatus();
  }
  if (command === 'showDesktop') { if (!managerMotion || await managerMotion.hide()) await desktop.native('show-desktop'); return desktop.getStatus(); }
  return serial(async () => {
    if (command === 'resetLayout') {
      await store.save({ ...store.state, notes: store.state.notes.map(note => { const copy = { ...note }; delete copy.position; return copy; }), settings: { ...store.state.settings, layoutVersion: 4, tasksPosition: undefined, schedulePosition: undefined, calendarPosition: undefined, notesPosition: undefined } });
    } else await store.save(reduceState(store.state, { type: 'settings:update', changes: { desktopEnabled: command === 'enable' } }));
    await desktop.sync(command === 'resetLayout'); broadcast();
    return desktop.getStatus();
  });
}

function reportBackgroundError(error: unknown): void {
  console.error(error);
  dialog.showErrorBox('WallNote 保存失败', error instanceof Error ? error.message : '无法保存数据，请检查磁盘空间和目录权限。');
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && (win !== mainWindow || win.isVisible())) win.webContents.send('state:changed', rendererState(win.webContents));
  updateTray();
}

function rendererState(contents: WebContents): AppState {
  if (mainWindow?.webContents === contents) return store.state;
  const entry = desktop.identify(contents);
  return stateForView(store.state, entry?.kind ?? 'wallpaper', entry?.kind === 'note' ? entry.key.slice(5) : undefined);
}

function validateAction(value: unknown): asserts value is Action {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('无效的操作');
  const action = value as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    'note:add': ['type', 'note'], 'note:update': ['type', 'id', 'changes'], 'note:delete': ['type', 'id'], 'note:selectDesktop': ['type', 'id'],
    'task:add': ['type', 'task'], 'task:toggle': ['type', 'id'], 'task:priority': ['type', 'id'], 'task:update': ['type', 'id', 'text'], 'task:delete': ['type', 'id'], 'task:clearCompleted': ['type'],
    'event:add': ['type', 'event'], 'event:update': ['type', 'id', 'changes'], 'event:delete': ['type', 'id'], 'calendar:select': ['type', 'date'],
    'widget:topmost': ['type', 'key', 'enabled'],
    'wallpaper:favorite': ['type', 'id'], 'wallpaper:select': ['type', 'id'], 'wallpaper:delete': ['type', 'id'], 'settings:update': ['type', 'changes'],
  };
  const keys = allowed[value.type];
  const optional = value.type === 'event:update' ? ['expectedRevision'] : [];
  if (!keys || Object.keys(action).some(k => !keys.includes(k) && !optional.includes(k)) || keys.some(k => !(k in action))) throw new Error('无效的操作参数');
  if (action.expectedRevision !== undefined && (typeof action.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(action.expectedRevision))) throw new Error('无效的日程版本。');
  if ('id' in action && (typeof action.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(action.id))) throw new Error('无效的项目编号');
  if (value.type === 'note:update' || value.type === 'settings:update' || value.type === 'event:update') {
    const fields = value.type === 'note:update' ? ['title', 'content', 'color', 'pinned', 'position'] : value.type === 'event:update' ? ['title', 'date', 'start', 'end', 'description', 'color'] : ['alwaysOnTop', 'launchAtLogin', 'desktopEnabled', 'showDesktopTasks', 'showDesktopCalendar', 'showDesktopSchedule', 'showDesktopNotes', 'glassEnabled', 'tasksPosition', 'calendarPosition', 'schedulePosition', 'notesPosition'];
    if (!action.changes || typeof action.changes !== 'object' || Array.isArray(action.changes) || Object.keys(action.changes).some(k => !fields.includes(k))) throw new Error('无效的修改参数');
  }
  if (value.type === 'task:update' && typeof action.text !== 'string') throw new Error('无效的任务内容');
  if (value.type === 'wallpaper:delete' && builtInWallpapers.some(w => w.id === action.id)) throw new Error('内置壁纸不能删除');
  if (value.type.startsWith('wallpaper:') && !allWallpapers(store.state).some(w => w.id === action.id)) throw new Error('找不到这张壁纸');
}

function installIPC(): void {
  ipcMain.handle('state:get', event => { trusted(event); return rendererState(event.sender); });
  ipcMain.handle('state:dispatch', (event, input: unknown) => {
    trusted(event); validateAction(input);
    if (quitting) throw new Error('正在退出，请稍后重新打开。');
    const widget = desktop.identify(event.sender);
    if (widget?.kind === 'wallpaper') throw new Error('壁纸层为只读显示。');
    if (input.type === 'widget:topmost') {
      if (widget && input.key !== (widget.kind === 'note' || widget.kind === 'notes-empty' ? 'notes' : widget.key)) throw new Error('只能切换当前组件的层级。');
    } else {
    if (widget?.kind === 'note' && input.type !== 'note:selectDesktop' && (input.type !== 'note:update' || input.id !== widget.key.slice(5))) throw new Error('便签窗口只能修改当前便签');
    if (widget?.kind === 'tasks' && !input.type.startsWith('task:') && !(input.type === 'settings:update' && Object.keys(input.changes).every(key => key === 'showDesktopTasks'))) throw new Error('待办组件只能修改待办事项。');
    if (widget?.kind === 'calendar' || widget?.kind === 'schedule') {
      const flag = widget.kind === 'calendar' ? 'showDesktopCalendar' : 'showDesktopSchedule';
      if (!input.type.startsWith('event:') && input.type !== 'calendar:select' && !(input.type === 'settings:update' && Object.keys(input.changes).every(key => key === flag))) throw new Error('日历组件只能修改日程。');
    }
    if (widget?.kind === 'notes-empty' && input.type !== 'note:add' && !(input.type === 'settings:update' && Object.keys(input.changes).every(key => key === 'showDesktopNotes'))) throw new Error('便签组件只能新建便签。');
    }
    if (input.type === 'event:update' && phoneSync.isPhoneEvent(input.id)) return phoneSync.updatePhone(input.id, input.changes, input.expectedRevision).then(() => rendererState(event.sender));
    if (input.type === 'event:delete' && (phoneSync.isPhoneEvent(input.id) || phoneSync.isLinked(input.id))) throw new Error('此日程来自手机或已关联手机，当前版本不支持删除手机日程。');
    return serial(async () => {
      let next = reduceState(store.state, input);
      if ((input.type === 'note:add' && input.note.pinned) || (input.type === 'note:update' && input.changes.pinned === true)) next = { ...next, settings: { ...next.settings, showDesktopNotes: true } };
      if (!isValidState(next)) throw new Error('内容超出限制或数据无效，未保存更改。');
      if (input.type === 'settings:update' && input.changes.launchAtLogin !== undefined) {
        if (!supportsLaunchAtLogin) throw new Error('请在 Windows 安装版中设置登录时启动。');
        app.setLoginItemSettings({ openAtLogin: input.changes.launchAtLogin, name: 'WallNote', path: process.execPath });
      }
      await store.save(next);
      if (input.type === 'wallpaper:delete') {
        // Imported files are app-owned copies; the original image is never removed.
        await fs.unlink(path.join(imageDir, `${input.id}.jpg`)).catch(() => undefined);
        await wallpaperCache.remove(input.id);
      }
      await desktop.sync(); broadcast();
      return rendererState(event.sender);
    });
  });
  ipcMain.handle('wallpaper:import', async event => {
    trusted(event, true);
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择喜欢的壁纸', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }], properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return { state: store.state, count: 0 };
    if (result.filePaths.length > 30) throw new Error('一次最多导入 30 张图片。');
    return serial(async () => {
      if (store.state.wallpapers.length + result.filePaths.length > 500) throw new Error('最多可保存 500 张自选壁纸。');
      const imported: Wallpaper[] = [];
      const written: string[] = [];
      try {
        for (const file of result.filePaths) {
          if (!/\.(jpe?g|png|webp|bmp)$/i.test(file) || (await fs.stat(file)).size > 40 * 1024 * 1024) throw new Error('请选择 40 MB 以内的 JPG、PNG、WebP 或 BMP 图片。');
          let image = nativeImage.createFromPath(file);
          if (image.isEmpty()) throw new Error(`无法读取图片：${path.basename(file)}`);
          const size = image.getSize();
          if (size.width * size.height > 80_000_000) throw new Error('图片尺寸过大，请选择小于 8000 万像素的图片。');
          if (size.width > 3840 || size.height > 3840) image = image.resize(size.width >= size.height ? { width: 3840, quality: 'best' } : { height: 3840, quality: 'best' });
          const id = randomUUID();
          const filename = `${id}.jpg`;
          await fs.writeFile(path.join(imageDir, filename), image.toJPEG(92));
          written.push(path.join(imageDir, filename));
          imported.push({ id, name: path.parse(file).name.slice(0, 120), description: '来自你的本地收藏', category: 'imported', file: filename, colors: [] });
        }
        await store.save({ ...store.state, wallpapers: [...store.state.wallpapers, ...imported] });
      } catch (error) {
        await Promise.all(written.map(file => fs.unlink(file).catch(() => undefined)));
        throw error;
      }
      broadcast(); return { state: store.state, count: imported.length };
    });
  });
  ipcMain.handle('wallpaper:apply', (event, id: string) => {
    trusted(event, true);
    return serial(async () => {
      if (process.platform !== 'win32') throw new Error('系统壁纸切换目前支持 Windows。');
      const wallpaper = allWallpapers(store.state).find(w => w.id === id);
      if (!wallpaper) throw new Error('找不到这张壁纸');
      await store.save({ ...store.state, selectedWallpaperId: id, appliedWallpaperId: id, settings: { ...store.state.settings, desktopEnabled: true } });
      await desktop.sync(); broadcast();
      if (!desktop.getStatus().active) throw new Error(desktop.getStatus().error || '无法开启桌面壁纸');
      return store.state;
    });
  });
  ipcMain.handle('app:info', event => { trusted(event); return { version: app.getVersion(), platform: process.platform, dataPath: store.directory, desktop: true, supportsLaunchAtLogin }; });
  ipcMain.handle('phone:control', async (event, command: string, calendarId?: string) => {
    trusted(event, true);
    if (command === 'connect') {
      const selected = await dialog.showOpenDialog(mainWindow!, { title: '选择 CalendarBridge 的电脑连接配置', filters: [{ name: '电脑连接配置', extensions: ['json'] }], properties: ['openFile'] });
      if (selected.canceled) return phoneSync.getStatus();
      if ((await fs.stat(selected.filePaths[0])).size > 32768) throw new Error('连接配置文件过大。');
      const profile = parsePhoneProfile(await fs.readFile(selected.filePaths[0], 'utf8'));
      const result = await phoneSync.connect(profile);
      if (!wifiReceiver.owns(profile)) await wifiReceiver.stop(true);
      return result;
    }
    if (command === 'refresh') return phoneSync.refresh();
    if (command === 'disconnect') { const result = await phoneSync.disconnect(); await wifiReceiver.stop(true); return result; }
    if (command === 'calendar' && typeof calendarId === 'string') return phoneSync.chooseCalendar(calendarId);
    throw new Error('未知手机同步操作。');
  });
  ipcMain.handle('wifi:control', async (event, command: string, id?: string) => {
    trusted(event, true);
    if (!['status', 'pair', 'approve', 'reject'].includes(command)) throw new Error('未知 Wi-Fi 配对操作。');
    return wifiReceiver.control(command as 'status' | 'pair' | 'approve' | 'reject', id);
  });
  ipcMain.handle('phone:send', (event, id: string, expectedRevision?: string) => {
    trusted(event);
    const widget = desktop.identify(event.sender);
    if (widget && widget.kind !== 'calendar' && widget.kind !== 'schedule') throw new Error('请通过日历或时间安排发送日程。');
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || expectedRevision !== undefined && !/^[a-f0-9]{64}$/.test(expectedRevision)) throw new Error('日程参数无效。');
    return phoneSync.sendLocal(id, expectedRevision);
  });
  ipcMain.handle('desktop:status', event => { trusted(event); return desktop.getStatus(); });
  ipcMain.handle('desktop:surface', event => { trusted(event); return desktop.surfaceFor(event.sender); });
  ipcMain.on('desktop:focus', event => {
    const entry = desktop.identify(event.sender);
    if (entry && entry.kind !== 'wallpaper' && event.senderFrame === event.sender.mainFrame) void desktop.focusWidget(event.sender).catch(() => undefined);
  });
  ipcMain.on('desktop:manipulate', (event, mode: string) => {
    const entry = desktop.identify(event.sender);
    if (!entry || entry.kind === 'wallpaper' || event.senderFrame !== event.sender.mainFrame || (mode !== 'move' && mode !== 'resize')) return;
    desktop.manipulate(event.sender, mode);
  });
  ipcMain.on('desktop:manipulate-stop', event => { if (event.senderFrame === event.sender.mainFrame) desktop.finishManipulation(event.sender); });
  ipcMain.handle('desktop:control', (event, command: DesktopCommand) => {
    trusted(event);
    if (!['enable', 'disable', 'showManager', 'showPhoneSync', 'showDesktop', 'resetLayout', 'quit'].includes(command)) throw new Error('未知桌面操作');
    if (mainWindow?.webContents !== event.sender && command !== 'showManager' && !(command === 'showPhoneSync' && desktop.identify(event.sender)?.kind === 'calendar')) throw new Error('请通过管理面板执行此操作。');
    return controlDesktop(command);
  });
  ipcMain.handle('app:dataFolder', async event => { trusted(event, true); const error = await shell.openPath(store.directory); if (error) throw new Error(error); });
  ipcMain.handle('backup:export', async event => {
    trusted(event, true);
    const result = await dialog.showSaveDialog(mainWindow!, { title: '导出数据备份', defaultPath: `WallNote-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON 备份', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await serial(async () => {
      // Images are deliberately excluded; backup is a portable notes/tasks/settings snapshot.
      const snapshot: AppState = { ...store.state, wallpapers: [], favorites: store.state.favorites.filter(id => builtInWallpapers.some(w => w.id === id)), selectedWallpaperId: 'mist', appliedWallpaperId: null };
      await fs.writeFile(result.filePath!, JSON.stringify(snapshot, null, 2), 'utf8');
    });
    return true;
  });
  ipcMain.handle('backup:restore', async event => {
    trusted(event, true);
    const result = await dialog.showOpenDialog(mainWindow!, { title: '恢复便签与待办备份', filters: [{ name: 'JSON 备份', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 30 * 1024 * 1024) throw new Error('备份文件过大。');
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!isValidState(parsed)) throw new Error('这不是有效的 WallNote 备份文件。');
    const confirmation = await dialog.showMessageBox(mainWindow!, { type: 'question', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0, title: '恢复备份', message: '将恢复便签、待办和备份中包含的日程，继续吗？', detail: '恢复前会自动备份现有数据。旧版备份不包含日程时，当前日程会保留。' });
    if (confirmation.response !== 1) return null;
    return serial(async () => {
      await fs.copyFile(store.file, path.join(store.directory, `before-restore-${Date.now()}.json`));
      await store.save({ ...store.state, notes: parsed.notes.map(n => ({ ...n, pinned: false })), tasks: parsed.tasks, events: parsed.events ?? store.state.events ?? [], calendarDate: parsed.calendarDate ?? store.state.calendarDate });
      await desktop.sync(); broadcast(); return store.state;
    });
  });
  ipcMain.on('window:action', (event, action: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win !== mainWindow) return;
    if (action === 'minimize') win?.minimize();
    if (action === 'maximize') { if (win?.isMaximized()) win.unmaximize(); else win?.maximize(); }
    if (action === 'close') win?.close();
  });
}

if (hasLock) {
  app.on('second-instance', showManager);
  app.whenReady().then(async () => {
    await fs.mkdir(imageDir, { recursive: true });
    const recovery = await store.load();
    const updatedLayout = upgradeDesktopLayout(store.state);
    if (updatedLayout !== store.state) {
      await fs.copyFile(store.file, path.join(store.directory, `before-layout-v4-${Date.now()}.json`));
      await store.save(updatedLayout);
    }
    if (store.state.settings.desktopEnabled !== false && !store.state.appliedWallpaperId) await store.save({ ...store.state, appliedWallpaperId: store.state.selectedWallpaperId });
    protocol.handle('wallnote', async request => {
      const url = new URL(request.url);
      const wallpaper = allWallpapers(store.state).find(w => w.id === url.pathname.slice(1));
      if (!['image', 'blur'].includes(url.hostname) || !wallpaper || request.method !== 'GET') return new Response('Not found', { status: 404 });
      try { return net.fetch(pathToFileURL(url.hostname === 'blur' ? await wallpaperCache.blur(wallpaper) : wallpaperPath(wallpaper)).toString()); }
      catch { return new Response('Image unavailable', { status: 404 }); }
    });
    await phoneSync.start();
    installIPC();
    if (!process.env.WALLNOTE_DATA_DIR || process.env.WALLNOTE_ENABLE_WIFI_RECEIVER === '1') void wifiReceiver.autoStart(phoneSync.getStatus().configured);
    let renderedDay = dateKey();
    rendererDayTimer = setInterval(() => { const day = dateKey(); if (day !== renderedDay) { renderedDay = day; broadcast(); } }, 30000);
    rendererDayTimer.unref();
    const showOnStart = process.argv.includes('--manage') || process.env.WALLNOTE_SHOW_MANAGER === '1';
    if (showOnStart || process.env.WALLNOTE_CREATE_MANAGER === '1') createMainWindow(showOnStart);
    tray = new Tray(nativeImage.createFromPath(path.join(assetDir, 'icon.png')).resize({ width: 20, height: 20 }));
    tray.on('double-click', showManager);
    updateTray();
    globalShortcut.register('CommandOrControl+Alt+W', showManager);
    desktop.start();
    await desktop.sync();
    if (!desktop.getStatus().active) showManager();
    if (recovery) dialog.showErrorBox('数据已恢复', `原有数据无法读取，已保留原文件：\n${recovery}\n\nWallNote 已恢复到初始状态。`);
  }).catch(error => { dialog.showErrorBox('WallNote 无法启动', String(error)); app.quit(); });
  app.on('before-quit', event => {
    if (flushed) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    globalShortcut.unregisterAll();
    if (managerIdleTimer) clearTimeout(managerIdleTimer);
    if (rendererDayTimer) clearInterval(rendererDayTimer);
    void (async () => {
      try {
        await wifiReceiver.stop();
        await phoneSync.stop();
        const positions = await desktop.positions();
        await serial(async () => {
          let next = store.state;
          for (const action of positions) next = reduceState(next, action);
          await store.save(next);
        });
      } finally { await desktop.stop(); tray?.destroy(); }
    })().catch(reportBackgroundError).finally(() => { flushed = true; app.quit(); });
  });
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
}
