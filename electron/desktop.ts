import { app, BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Action, AppState, DesktopStatus, DesktopSurface, Note } from '../shared/types';
import { plannerLayout } from '../shared/layout';

const execute = promisify(execFile);
type Kind = 'wallpaper' | 'note' | 'tasks' | 'calendar' | 'schedule' | 'notes-empty';
interface Entry { key: string; kind: Kind; win: BrowserWindow; handle: string; attached: boolean; bounds: Rectangle }
interface Inspection { exists: boolean; window: { handle: string; parent: string; className: string; child: boolean; visible: boolean; minimized: boolean; bounds: Rectangle } | null }

export class DesktopController {
  private entries = new Map<string, Entry>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retry: ReturnType<typeof setInterval> | null = null;
  private displayTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private checking = false;
  private status: DesktopStatus = { enabled: false, active: false, displays: 0, widgets: 0, error: null };
  readonly executable = app.isPackaged ? path.join(process.resourcesPath, 'native', 'WallNote.DesktopHost.exe') : path.join(__dirname, '..', 'dist-native', 'WallNote.DesktopHost.exe');

  constructor(private getState: () => AppState, private load: (win: BrowserWindow, query: Record<string, string>) => Promise<void>, private persist: (action: Action) => Promise<unknown>, private changed: (status: DesktopStatus) => void) {}

  getStatus(): DesktopStatus { return { ...this.status }; }
  identify(contents: WebContents): Entry | undefined { return [...this.entries.values()].find(entry => entry.win.webContents === contents); }
  surfaceFor(contents: WebContents): DesktopSurface | null {
    const entry = this.identify(contents);
    return entry ? { bounds: entry.bounds, display: screen.getDisplayMatching(entry.bounds).bounds } : null;
  }
  private publish(error: string | null = null) {
    const entries = [...this.entries.values()].filter(e => e.attached && !e.win.isDestroyed());
    const next: DesktopStatus = { enabled: this.getState().settings.desktopEnabled !== false, active: entries.some(e => e.kind === 'wallpaper'), displays: entries.filter(e => e.kind === 'wallpaper').length, widgets: entries.filter(e => e.kind !== 'wallpaper').length, error };
    if (JSON.stringify(next) !== JSON.stringify(this.status)) { this.status = next; this.changed(next); }
  }
  async native<T>(...args: string[]): Promise<T> {
    const { stdout } = await execute(this.executable, args, { windowsHide: true, timeout: 12000, encoding: 'utf8' });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as T;
  }

  start() {
    this.retry = setInterval(() => { void this.check(); }, 6000);
    const displaysChanged = () => {
      if (this.displayTimer) clearTimeout(this.displayTimer);
      this.displayTimer = setTimeout(() => { void this.sync(true); }, 800);
    };
    screen.on('display-added', displaysChanged);
    screen.on('display-removed', displaysChanged);
    screen.on('display-metrics-changed', displaysChanged);
  }

  private async check() {
    if (this.checking || this.stopped || this.getState().settings.desktopEnabled === false) return;
    this.checking = true;
    try {
      const entries = [...this.entries.values()];
      if (!entries.length) { await this.sync(); return; }
      let invalid = false;
      for (const entry of entries) {
        if (!entry.attached || entry.win.isDestroyed() || this.entries.get(entry.key) !== entry) continue;
        const inspection = await this.native<Inspection>('inspect', entry.handle);
        if (this.entries.get(entry.key) !== entry) continue;
        if (!inspection.exists || !inspection.window || inspection.window.parent === '0') { invalid = true; break; }
      }
      await this.sync(invalid);
    } catch { await this.sync(true); }
    finally { this.checking = false; }
  }

  sync(rebuild = false): Promise<void> {
    const result = this.pending.then(async () => {
      if (this.stopped) return;
      if (rebuild) { await this.releaseFocus(); this.destroyAll(); }
      const state = this.getState();
      if (state.settings.desktopEnabled === false) { await this.releaseFocus(); this.destroyAll(); this.publish(); await this.refresh(); return; }
      if (process.platform !== 'win32') { this.publish('桌面壁纸模式目前支持 Windows 10 / 11。'); return; }
      try {
        const wanted = new Set<string>(screen.getAllDisplays().map(d => `wallpaper:${d.id}`));
        const notes = state.settings.showDesktopNotes === false ? [] : state.notes.filter(n => n.pinned);
        notes.forEach(n => wanted.add(`note:${n.id}`));
        if (!notes.length && state.settings.showDesktopNotes !== false) wanted.add('notes-empty');
        if (state.settings.showDesktopTasks !== false) wanted.add('tasks');
        if (state.settings.showDesktopCalendar !== false) wanted.add('calendar');
        if (state.settings.showDesktopSchedule !== false) wanted.add('schedule');
        for (const [key, entry] of this.entries) if (!wanted.has(key)) this.destroy(entry);
        for (const display of screen.getAllDisplays()) {
          const key = `wallpaper:${display.id}`;
          if (!this.entries.has(key)) await this.create(key, 'wallpaper', display.bounds, { wallpaper: '1', display: String(display.id) });
        }
        if (state.settings.showDesktopTasks !== false && !this.entries.has('tasks')) {
          await this.create('tasks', 'tasks', this.widgetBounds(state.settings.tasksPosition, 'tasks'), { widget: 'tasks' });
        }
        if (state.settings.showDesktopCalendar !== false && !this.entries.has('calendar')) await this.create('calendar', 'calendar', this.widgetBounds(state.settings.calendarPosition, 'calendar'), { widget: 'calendar' });
        if (state.settings.showDesktopSchedule !== false && !this.entries.has('schedule')) await this.create('schedule', 'schedule', this.widgetBounds(state.settings.schedulePosition, 'schedule'), { widget: 'schedule' });
        if (!notes.length && state.settings.showDesktopNotes !== false && !this.entries.has('notes-empty')) await this.create('notes-empty', 'notes-empty', this.widgetBounds(state.settings.notesPosition, 'notes'), { widget: 'notes-empty' });
        let index = 0;
        for (const note of notes) {
          if (!this.entries.has(`note:${note.id}`)) await this.create(`note:${note.id}`, 'note', this.widgetBounds(note.position ?? state.settings.notesPosition, 'notes', index), { note: note.id });
          index += 1;
        }
        this.publish();
      } catch (error) {
        await this.releaseFocus();
        this.destroyAll();
        this.publish(`未能嵌入 Windows 桌面：${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  private widgetBounds(saved: Note['position'], kind: 'schedule' | 'calendar' | 'tasks' | 'notes', index = 0): Rectangle {
    const area = saved ? screen.getDisplayMatching(saved).workArea : screen.getPrimaryDisplay().workArea;
    const defaults = plannerLayout(area)[kind];
    const width = Math.round(Math.min(saved?.width ?? defaults.width, area.width));
    const height = Math.round(Math.min(saved?.height ?? defaults.height, area.height));
    return {
      x: Math.round(Math.max(area.x, Math.min(saved?.x ?? defaults.x - index * 18, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(saved?.y ?? defaults.y + index * 18, area.y + area.height - height))),
      width, height,
    };
  }

  private async create(key: string, kind: Kind, bounds: Rectangle, query: Record<string, string>) {
    const wallpaper = kind === 'wallpaper';
    const win = new BrowserWindow({
      ...bounds, frame: false, thickFrame: false, show: false, skipTaskbar: true, alwaysOnTop: false,
      title: wallpaper ? 'WallNote Desktop Wallpaper' : 'WallNote Desktop Widget',
      resizable: !wallpaper, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: !wallpaper, transparent: !wallpaper, backgroundColor: wallpaper ? '#365d50' : '#00000000',
      ...(wallpaper ? {} : { minWidth: 260, minHeight: 220, maxWidth: 1600, maxHeight: 1600 }),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
    const entry: Entry = { key, kind, win, handle, attached: false, bounds };
    this.entries.set(key, entry);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('closed', () => { if (this.entries.get(key) === entry) { this.entries.delete(key); this.publish(); } });
    win.on('close', event => {
      if (this.stopped) return;
      event.preventDefault();
      const flag = { tasks: 'showDesktopTasks', calendar: 'showDesktopCalendar', schedule: 'showDesktopSchedule', 'notes-empty': 'showDesktopNotes' }[kind as 'tasks' | 'calendar' | 'schedule' | 'notes-empty'];
      if (!wallpaper) void this.persist(kind === 'note' ? { type: 'note:update', id: key.slice(5), changes: { pinned: false } } : { type: 'settings:update', changes: { [flag]: false } });
    });
    await this.load(win, query);
    const pixels = screen.dipToScreenRect(null, bounds);
    await this.native('attach', handle, String(process.pid), wallpaper ? 'wallpaper' : 'widget', ...[pixels.x, pixels.y, pixels.width, pixels.height].map(Math.round).map(String));
    entry.attached = true;
    win.showInactive();
    // Showing a transparent Chromium window can reinterpret its initial bounds as parent-local.
    // Reapply screen-space coordinates after ShowWindow, especially on negative-origin displays.
    if (!wallpaper) await this.native('position', handle, String(process.pid), ...[pixels.x, pixels.y, pixels.width, pixels.height].map(Math.round).map(String));
    win.webContents.send('desktop:surface', this.surfaceFor(win.webContents));
    if (!wallpaper) {
      const savePosition = () => {
        if (this.stopped || !entry.attached) return;
        const timer = this.timers.get(key);
        if (timer) clearTimeout(timer);
        this.timers.set(key, setTimeout(() => {
          this.timers.delete(key);
          void this.positionAction(entry).then(action => { if (action) return this.persist(action); }).catch(() => undefined);
        }, 250));
      };
      win.on('move', savePosition);
      win.on('resize', savePosition);
    }
  }

  private async positionAction(entry: Entry): Promise<Action | null> {
    if (!entry.attached || entry.win.isDestroyed() || this.entries.get(entry.key) !== entry) return null;
    const result = await this.native<Inspection>('inspect', entry.handle);
    if (!result.window) return null;
    const position = screen.screenToDipRect(null, result.window.bounds);
    entry.bounds = position;
    entry.win.webContents.send('desktop:surface', this.surfaceFor(entry.win.webContents));
    if (position.width < 240 || position.height < 200 || position.width > 2000 || position.height > 2000) return null;
    if (entry.kind === 'note') return { type: 'note:update', id: entry.key.slice(5), changes: { position } };
    if (entry.kind === 'tasks') return { type: 'settings:update', changes: { tasksPosition: position } };
    if (entry.kind === 'calendar') return { type: 'settings:update', changes: { calendarPosition: position } };
    if (entry.kind === 'schedule') return { type: 'settings:update', changes: { schedulePosition: position } };
    if (entry.kind === 'notes-empty') return { type: 'settings:update', changes: { notesPosition: position } };
    return null;
  }

  async positions(): Promise<Action[]> {
    await this.pending;
    const actions = await Promise.all([...this.entries.values()].filter(e => e.kind !== 'wallpaper').map(e => this.positionAction(e).catch(() => null)));
    return actions.filter((action): action is Action => action !== null);
  }
  private destroy(entry: Entry) {
    const timer = this.timers.get(entry.key);
    if (timer) clearTimeout(timer);
    this.timers.delete(entry.key);
    this.entries.delete(entry.key);
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }
  private destroyAll() { for (const entry of [...this.entries.values()]) this.destroy(entry); }
  private async releaseFocus() {
    const entry = [...this.entries.values()].find(e => !e.win.isDestroyed());
    if (entry) await this.native('release-focus', entry.handle, String(process.pid)).catch(() => undefined);
  }
  private async refresh() { if (process.platform === 'win32') await this.native('refresh').catch(() => undefined); }
  async stop() {
    this.stopped = true;
    if (this.retry) clearInterval(this.retry);
    if (this.displayTimer) clearTimeout(this.displayTimer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    await this.pending;
    await this.releaseFocus();
    this.destroyAll();
    await this.refresh();
  }
}
