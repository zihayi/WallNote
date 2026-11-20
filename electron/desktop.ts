import { app, BrowserWindow, screen, session, type Rectangle, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { Action, AppState, DesktopStatus, DesktopSurface, Note } from '../shared/types';
import { modules, type ModuleId } from '../shared/modules';
import { fitRect, minimum, moduleHome, shownModules, toFrame, type DragMode, type Guides } from '../shared/snap-layout';
import { layoutDisplays, startSnapGesture } from './snap-gesture';
import { DesktopInputBridge, type MousePacket } from './input-bridge';
import { activeDesktopNote } from '../shared/state';
import { finishWidgetExit } from './window-motion';

const execute = promisify(execFile);
type Kind = 'wallpaper' | 'note' | 'notes-empty' | Exclude<ModuleId,'notes'>;
interface Entry { key: string; kind: Kind; win: BrowserWindow; handle: string; attached: boolean; bounds: Rectangle; topmost: boolean; inputScale: number; displayId: number; layerVersion: number }
interface Inspection { exists: boolean; window: { handle: string; parent: string; className: string; child: boolean; visible: boolean; minimized: boolean; topmost: boolean; dpi: number; bounds: Rectangle } | null }

export class DesktopController {
  private entries = new Map<string, Entry>();
  private byContents = new Map<WebContents,Entry>();
  private byHandle = new Map<string,Entry>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private retry: ReturnType<typeof setInterval> | null = null;
  private displayTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private checking = false;
  private status: DesktopStatus = { enabled: false, active: false, displays: 0, widgets: 0, error: null };
  readonly executable = app.isPackaged ? path.join(process.resourcesPath, 'native', 'WallNote.DesktopHost.exe') : path.join(__dirname, '..', 'dist-native', 'WallNote.DesktopHost.exe');
  private input: DesktopInputBridge;
  private inputQueue: Promise<unknown> = Promise.resolve();
  private menuTracking = false;
  private pendingFocus = new Set<Promise<unknown>>();
  private lastFocus = { handle: '', at: 0 };
  private manipulations = new Map<string, ReturnType<typeof startSnapGesture>>();

  constructor(private getState: () => AppState, private load: (win: BrowserWindow, query: Record<string, string>) => Promise<void>, private persist: (action: Action) => Promise<unknown>, private changed: (status: DesktopStatus) => void) {
    this.input = new DesktopInputBridge(this.executable, packet => { this.inputQueue = this.inputQueue.then(() => this.forwardMouse(packet)).catch(() => undefined); }, error => { if (!this.stopped) this.publish(error.message); });
  }

  getStatus(): DesktopStatus { return { ...this.status }; }
  onDrawerSurface?: (handle:string|null)=>void;
  drawerHandle(): string|null {
    const entry=this.entries.get('drawer');
    return entry?.attached && !entry.win.isDestroyed() && !entry.win.webContents.isCrashed() && !this.stopped ? entry.handle : null;
  }
  identify(contents: WebContents): Entry | undefined { return this.byContents.get(contents); }
  surfaceFor(contents: WebContents): DesktopSurface | null {
    const entry = this.identify(contents);
    return entry ? { bounds: entry.bounds, display: screen.getDisplayMatching(entry.bounds).bounds, topmost: entry.topmost } : null;
  }
  private publish(error: string | null = null) {
    this.onDrawerSurface?.(this.drawerHandle());
    const entries = [...this.entries.values()].filter(e => e.attached && !e.win.isDestroyed());
    const next: DesktopStatus = { enabled: this.getState().settings.desktopEnabled !== false, active: entries.some(e => e.kind === 'wallpaper'), displays: entries.filter(e => e.kind === 'wallpaper').length, widgets: entries.filter(e => e.kind !== 'wallpaper').length, error };
    if (JSON.stringify(next) !== JSON.stringify(this.status)) { this.status = next; this.changed(next); }
  }
  async native<T>(...args: string[]): Promise<T> {
    const { stdout } = await execute(this.executable, args, { windowsHide: true, timeout: 12000, maxBuffer: args[0]==='drawer-files'?8_000_000:1_048_576, encoding: 'utf8' });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as T;
  }
  manipulate(contents: WebContents, mode: DragMode, anchor: {x:number;y:number}, bypass: boolean) {
    const entry = this.identify(contents);
    if (!entry?.attached || entry.kind==='wallpaper' || this.manipulations.size || this.stopped || anchor.x<0 || anchor.y<0 || anchor.x>entry.bounds.width+2 || anchor.y>entry.bounds.height+2) return;
    const id=entry.kind==='note'||entry.kind==='notes-empty'?'notes':entry.kind;
    const start={...entry.bounds},version=++entry.layerVersion;
    clearTimeout(this.timers.get(entry.key));this.timers.delete(entry.key);
    let last='';
    const guides=(g:Guides, force=false)=>{
      const sign=JSON.stringify(g);if(sign===last&&!force)return;last=sign;
      for(const target of this.entries.values())if(!target.win.isDestroyed()&&(target.kind==='wallpaper'||target===entry))target.win.webContents.send('layout:guides',g);
    };
    const gesture=startSnapGesture(this.executable,entry.handle,id,start,anchor,mode,bypass || this.getState().settings.layoutSnap===false,
      ()=>[...this.entries.values()].filter(e=>e!==entry&&e.attached&&e.kind!=='wallpaper').map(e=>e.bounds),
      (rect,g)=>{if(version!==entry.layerVersion||!entry.attached||entry.win.isDestroyed())return;
        if(Object.keys(rect).some(k=>rect[k as keyof Rectangle]!==entry.bounds[k as keyof Rectangle])){entry.bounds=rect;contents.send('desktop:surface',this.surfaceFor(contents));}
        guides(g);
      }, (rect,display,commit,failed)=>{
        if(this.manipulations.get(entry.handle)!==gesture)return;
        this.manipulations.delete(entry.handle);guides({},true);
        if(version!==entry.layerVersion||this.stopped||!entry.attached||entry.win.isDestroyed())return;
        entry.bounds=rect; contents.send('desktop:surface',this.surfaceFor(contents));
        if(failed) {
          const px=screen.dipToScreenRect(null,start);
          void this.native('position',entry.handle,String(process.pid),...[px.x,px.y,px.width,px.height].map(Math.round).map(String)).catch(()=>undefined);
          contents.send('layout:save-error');
        }
        if(commit)void this.persist({type:'layout:place',id,frame:toFrame(rect,display,id)}).catch(()=>contents.isDestroyed()||contents.send('layout:save-error'));
        void this.normalizeScale(entry).then(()=>this.updateInputTargets()).catch(()=>undefined);
      });
    this.manipulations.set(entry.handle,gesture);
  }
  finishManipulation(contents: WebContents, cancel=false) { const entry = this.identify(contents); if (entry) this.manipulations.get(entry.handle)?.finish(cancel); }
  private interrupt(entry:Entry) {
    const gesture=this.manipulations.get(entry.handle); if(!gesture)return;
    this.manipulations.delete(entry.handle);gesture.abort();
    for(const e of this.entries.values())if(!e.win.isDestroyed())e.win.webContents.send('layout:guides',{});
  }
  private async focusWidget(contents: WebContents) {
    const entry = this.identify(contents);
    if (this.menuTracking || !entry || entry.kind === 'wallpaper' || entry.win.isDestroyed()) return;
    if (!entry.topmost && (this.lastFocus.handle !== entry.handle || Date.now() - this.lastFocus.at > 180)) {
      this.lastFocus = { handle: entry.handle, at: Date.now() };
      const focus = this.input.focus(entry.handle);
      this.pendingFocus.add(focus);
      try { await focus; } finally { this.pendingFocus.delete(focus); }
    }
    if (!this.menuTracking && !entry.win.isDestroyed()) entry.win.webContents.focus();
  }
  private minimum(kind: Kind) { return minimum(kind==='note'||kind==='notes-empty'||kind==='wallpaper'?'notes':kind); }
  async setMenuTracking(active: boolean) {
    this.menuTracking = active;
    // A renderer pointer-down may already have started a native focus request.
    // Let it finish before handing the foreground to the Shell menu.
    if (active) await Promise.allSettled(this.pendingFocus);
  }
  setMenuProcess(pid:number) { this.input.setMenuProcess(pid); }
  private updateInputTargets() {
    // The bridge yields to *actual* Win32 popup tracking, not while Shell extensions load.
    this.input.setTargets([...this.entries.values()].filter(e => e.kind !== 'wallpaper' && !e.topmost && e.attached && !e.win.isDestroyed()).map(e => ({ handle: e.handle, scale: screen.getDisplayMatching(e.bounds).scaleFactor })));
  }
  private async forwardMouse(packet: MousePacket) {
    const entry = this.byHandle.get(packet.handle);
    if (this.menuTracking || !entry || !entry.attached || entry.topmost || entry.win.isDestroyed()) return;
    if(packet.type==='outside'){entry.win.webContents.send('desktop:outside-press');return;}
    if (packet.type === 'down' || packet.type === 'wheel') {
      await this.focusWidget(entry.win.webContents);
      if (this.menuTracking || entry.win.isDestroyed()) return;
    }
    const x = Math.round(packet.x / entry.inputScale), y = Math.round(packet.y / entry.inputScale);
    const modifiers: Electron.MouseInputEvent['modifiers'] = packet.leftDown ? ['leftbuttondown'] : [];
    if(packet.rightDown)modifiers.push('rightbuttondown');
    if(packet.shift)modifiers.push('shift');
    if(packet.alt)modifiers.push('alt');
    if (packet.type === 'wheel') entry.win.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: packet.delta / 120 * 70, canScroll: true, hasPreciseScrollingDeltas: true });
    else if (packet.type === 'down' || packet.type === 'up') entry.win.webContents.sendInputEvent({ type: packet.type === 'down' ? 'mouseDown' : 'mouseUp', x, y, button: packet.button==='right'?'right':'left', clickCount: packet.clickCount, modifiers });
    else entry.win.webContents.sendInputEvent({ type: packet.type === 'leave' ? 'mouseLeave' : 'mouseMove', x, y, modifiers });
    if (packet.type === 'up' && packet.button!=='right') this.manipulations.get(entry.handle)?.finish(false);
  }
  private async normalizeScale(entry: Entry) {
    if (entry.win.isDestroyed()) return;
    const version = entry.layerVersion;
    const display = screen.getDisplayMatching(entry.bounds);
    const dpr = await entry.win.webContents.executeJavaScript('new Promise(resolve => { const done = () => resolve(window.devicePixelRatio); requestAnimationFrame(done); setTimeout(done, 120); })') as number;
    if (entry.win.isDestroyed() || entry.layerVersion !== version) return;
    const base = dpr / entry.win.webContents.getZoomFactor();
    const zoom = display.scaleFactor / Math.max(.5, base);
    entry.inputScale = base;
    entry.displayId = display.id;
    if (Math.abs(entry.win.webContents.getZoomFactor() - zoom) > .01) entry.win.webContents.setZoomFactor(zoom);
  }
  private async setLayer(entry: Entry, topmost: boolean) {
    entry.attached = false;
    entry.layerVersion++;
    clearTimeout(this.timers.get(entry.key)); this.timers.delete(entry.key);
    this.interrupt(entry);
    let redock = false;
    if (!topmost && entry.kind !== 'wallpaper') {
      const home = this.widgetBounds(undefined, entry.kind === 'note' || entry.kind === 'notes-empty' ? 'notes' : entry.kind);
      redock = (['x', 'y', 'width', 'height'] as const).some(k => Math.abs(entry.bounds[k] - home[k]) > 2);
      if (redock) await finishWidgetExit(entry.win);
      entry.bounds = home;
    }
    const pixels = screen.dipToScreenRect(null, entry.bounds);
    if (topmost) {
      const actual = await this.native<{ bounds: Rectangle }>('topmost', entry.handle, String(process.pid), String(screen.getDisplayMatching(entry.bounds).scaleFactor));
      entry.bounds = screen.screenToDipRect(null, actual.bounds);
    }
    else await this.native('attach', entry.handle, String(process.pid), 'widget', ...[pixels.x, pixels.y, pixels.width, pixels.height].map(Math.round).map(String));
    entry.topmost = topmost;
    // Both native operations already show the same HWND at its final screen-space bounds
    // without activation. A second ShowWindow/position pass flashes at parent-local coords.
    entry.win.webContents.send('desktop:surface', this.surfaceFor(entry.win.webContents));
    await this.normalizeScale(entry);
    if (redock) entry.win.webContents.send('widget:reveal');
    entry.attached = true;
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
      if(entries.some(e=>!e.attached))return; // A sync/attachment is already underway.
      const snapshot=entries.map(e=>e.layerVersion);
      const healthy=await this.input.check(entries.map(e=>({handle:e.handle,pinned:e.topmost})));
      if(!healthy && !this.stopped && this.getState().settings.desktopEnabled!==false && entries.every((e,i)=>e.attached && e.layerVersion===snapshot[i] && this.entries.get(e.key)===e))await this.sync(true);
    } catch { await this.sync(true); }
    finally { this.checking = false; }
  }

  sync(rebuild = false, reflow = false): Promise<void> {
    const result = this.pending.then(async () => {
      if (this.stopped) return;
      if (rebuild) { await this.input.stop(); await this.releaseFocus(); this.destroyAll(); }
      const state = this.getState();
      if (state.settings.desktopEnabled === false) {
        await this.input.stop(); await this.releaseFocus();
        await Promise.all([...this.entries.values()].filter(e => e.kind !== 'wallpaper').map(e => finishWidgetExit(e.win)));
        this.destroyAll(); this.publish(); await this.refresh(); return;
      }
      if (process.platform !== 'win32') { this.publish('桌面壁纸模式目前支持 Windows 10 / 11。'); return; }
      try {
        await this.input.start();
        const wanted = new Set<string>(screen.getAllDisplays().map(d => `wallpaper:${d.id}`));
        const visible = shownModules(state.settings);
        const activeNote = activeDesktopNote(state);
        const notes = !visible.includes('notes') || !activeNote ? [] : [activeNote];
        notes.forEach(n => wanted.add(`note:${n.id}`));
        if (!notes.length && visible.includes('notes')) wanted.add('notes-empty');
        const ordinary = visible.filter((id): id is Exclude<ModuleId,'notes'> => id !== 'notes');
        ordinary.forEach(id => wanted.add(id));
        let noteBounds: Rectangle | undefined;
        await Promise.all([...this.entries.values()].filter(entry => !wanted.has(entry.key)).map(async entry => {
          if (entry.topmost && (entry.kind === 'note' || entry.kind === 'notes-empty')) {
            const snapshot = await this.native<Inspection>('inspect', entry.handle);
            if (snapshot.window) noteBounds = screen.screenToDipRect(null, snapshot.window.bounds);
          }
          if (entry.kind !== 'wallpaper') { entry.attached = false; await finishWidgetExit(entry.win); }
          this.destroy(entry);
        }));
        for (const display of screen.getAllDisplays()) {
          const key = `wallpaper:${display.id}`;
          if (!this.entries.has(key)) await this.create(key, 'wallpaper', display.bounds, { wallpaper: '1', display: String(display.id) });
        }
        for (const id of ordinary) if (!this.entries.has(id)) {
          await this.create(id, id, this.widgetBounds(state.settings.topmostWidgets?.includes(id) ? state.settings[`${id}Position`] : undefined, id), { widget: id });
        }
        if (!notes.length && visible.includes('notes') && !this.entries.has('notes-empty')) await this.create('notes-empty', 'notes-empty', this.widgetBounds(state.settings.topmostWidgets?.includes('notes') ? noteBounds ?? state.settings.notesPosition : undefined, 'notes'), { widget: 'notes-empty' });
        for (const note of notes) {
          if (!this.entries.has(`note:${note.id}`)) await this.create(`note:${note.id}`, 'note', this.widgetBounds(state.settings.topmostWidgets?.includes('notes') ? noteBounds ?? state.settings.notesPosition : undefined, 'notes'), { note: note.id });
        }
        for (const entry of this.entries.values()) {
          if (entry.kind === 'wallpaper') continue;
          const topmost = (state.settings.topmostWidgets ?? []).includes(entry.kind === 'note' || entry.kind === 'notes-empty' ? 'notes' : entry.key);
          if (entry.topmost !== topmost) await this.setLayer(entry, topmost);
          else if (reflow) {
            const kind = entry.kind === 'note' || entry.kind === 'notes-empty' ? 'notes' : entry.kind;
            const home = this.widgetBounds(undefined, kind);
            if ((['x','y','width','height'] as const).some(k => Math.abs(entry.bounds[k] - home[k]) > 1)) {
              entry.attached = false; entry.layerVersion++;
              this.interrupt(entry);
              clearTimeout(this.timers.get(entry.key)); this.timers.delete(entry.key);
              const px = screen.dipToScreenRect(null, home);
              await this.native('position', entry.handle, String(process.pid), ...[px.x, px.y, px.width, px.height].map(Math.round).map(String));
              entry.bounds = home; await this.normalizeScale(entry); entry.attached = true;
              entry.win.webContents.send('desktop:surface', this.surfaceFor(entry.win.webContents));
            }
          }
        }
        this.updateInputTargets();
        this.publish();
      } catch (error) {
        await this.input.stop();
        await this.releaseFocus();
        this.destroyAll();
        this.publish(`未能嵌入 Windows 桌面：${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  private widgetBounds(saved: Note['position'], kind: ModuleId): Rectangle {
    const settings=this.getState().settings;
    if(saved&&!settings.dockFrames?.[kind])return fitRect(saved,screen.getDisplayMatching(saved).workArea,kind);
    return moduleHome(settings,kind,layoutDisplays()).rect;
  }

  private async create(key: string, kind: Kind, bounds: Rectangle, query: Record<string, string>) {
    const wallpaper = kind === 'wallpaper';
    const win = new BrowserWindow({
      ...bounds, frame: false, thickFrame: false, show: false, skipTaskbar: true, alwaysOnTop: false,
      title: wallpaper ? 'WallNote Desktop Wallpaper' : 'WallNote Desktop Widget',
      resizable: !wallpaper, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: !wallpaper, transparent: !wallpaper, backgroundColor: wallpaper ? '#365d50' : '#00000000',
      ...(wallpaper ? {} : { minWidth: this.minimum(kind).width, minHeight: this.minimum(kind).height, maxWidth: 1600, maxHeight: 1600 }),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: process.env.VITE_DEV_SERVER_URL ? `wallnote-${wallpaper ? key : kind}` : 'wallnote-desktop' },
    });
    const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
    const topmost = !wallpaper && !!this.getState().settings.topmostWidgets?.includes(kind === 'note' || kind === 'notes-empty' ? 'notes' : key);
    const entry: Entry = { key, kind, win, handle, attached: false, bounds, topmost, inputScale: screen.getDisplayMatching(bounds).scaleFactor, displayId: screen.getDisplayMatching(bounds).id, layerVersion: 0 };
    this.entries.set(key, entry);
    const contents=win.webContents;
    this.byContents.set(contents,entry);this.byHandle.set(handle,entry);
    if(kind==='drawer')win.webContents.on('render-process-gone',()=>this.onDrawerSurface?.(null));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.setMenu(null);
    win.webContents.on('before-input-event', (event, input) => { if (input.control && ['+', '=', '-', '0'].includes(input.key)) event.preventDefault(); });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('closed', () => {
      this.byContents.delete(contents);this.byHandle.delete(handle);
      if(this.entries.get(key)!==entry)return; // Intentional destroy already removed the entry.
      this.entries.delete(key);this.updateInputTargets();this.publish();
      if(!this.stopped)void this.sync(); // Explorer may take a child HWND with it on restart.
    });
    win.on('close', event => {
      if (this.stopped) return;
      event.preventDefault();
      if (kind !== 'wallpaper') void this.persist(kind === 'note' ? { type: 'note:update', id: key.slice(5), changes: { pinned: false } } : { type: 'settings:update', changes: { [modules[kind === 'notes-empty' ? 'notes' : kind].flag]: false } });
    });
    if (!await win.webContents.session.protocol.isProtocolHandled('wallnote')) win.webContents.session.protocol.handle('wallnote', request => session.defaultSession.fetch(request.url));
    await this.load(win, query);
    await win.webContents.setVisualZoomLevelLimits(1, 1);
    const pixels = screen.dipToScreenRect(null, bounds);
    if (topmost) await this.native('topmost', handle, String(process.pid), String(screen.getDisplayMatching(bounds).scaleFactor));
    else await this.native('attach', handle, String(process.pid), wallpaper ? 'wallpaper' : 'widget', ...[pixels.x, pixels.y, pixels.width, pixels.height].map(Math.round).map(String));
    entry.attached = true;
    if(!wallpaper)this.updateInputTargets();
    win.showInactive();
    // Showing a transparent Chromium window can reinterpret its initial bounds as parent-local.
    // Reapply screen-space coordinates after ShowWindow, especially on negative-origin displays.
    if (!wallpaper) await this.native('position', handle, String(process.pid), ...[pixels.x, pixels.y, pixels.width, pixels.height].map(Math.round).map(String));
    if (!wallpaper) await this.normalizeScale(entry);
    win.webContents.send('desktop:surface', this.surfaceFor(win.webContents));
    if (!wallpaper) {
      win.webContents.send('widget:reveal');
      const savePosition = () => {
        if (this.stopped || !entry.attached || this.manipulations.has(entry.handle)) return;
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
    if (!entry.attached || entry.win.isDestroyed() || this.entries.get(entry.key) !== entry || this.manipulations.has(entry.handle)) return null;
    const version = entry.layerVersion;
    const result = await this.native<Inspection>('inspect', entry.handle);
    if (!result.window || entry.layerVersion !== version || !entry.attached) return null;
    let position = screen.screenToDipRect(null, result.window.bounds);
    const display = screen.getDisplayMatching(position);
    const previousPixels = screen.dipToScreenRect(null, entry.bounds);
    const moved = Math.abs(previousPixels.x - result.window.bounds.x) > 1 || Math.abs(previousPixels.y - result.window.bounds.y) > 1;
    if (display.id !== entry.displayId && moved && (Math.abs(position.width - entry.bounds.width) > 1 || Math.abs(position.height - entry.bounds.height) > 1)) {
      const size = { width: Math.round(entry.bounds.width * display.scaleFactor), height: Math.round(entry.bounds.height * display.scaleFactor) };
      await this.native('position', entry.handle, String(process.pid), String(result.window.bounds.x), String(result.window.bounds.y), String(size.width), String(size.height));
      if (entry.layerVersion !== version || !entry.attached) return null;
      position = screen.screenToDipRect(null, { ...result.window.bounds, ...size });
    }
    if (entry.topmost && (display.id !== entry.displayId || position.width !== entry.bounds.width || position.height !== entry.bounds.height)) {
      await this.native('outline', entry.handle, String(process.pid), String(display.scaleFactor));
      if (entry.layerVersion !== version || !entry.attached) return null;
    }
    entry.bounds = position;
    await this.normalizeScale(entry);
    if (entry.layerVersion !== version || !entry.attached || entry.win.isDestroyed()) return null;
    this.updateInputTargets();
    entry.win.webContents.send('desktop:surface', this.surfaceFor(entry.win.webContents));
    if (position.width < 240 || position.height < 200 || position.width > 2000 || position.height > 2000) return null;
    if(entry.kind==='wallpaper')return null;
    const id=entry.kind==='note'||entry.kind==='notes-empty'?'notes':entry.kind;
    return { type:'settings:update', changes:{[`${id}Position`]:position} };
  }

  async positions(): Promise<Action[]> {
    await this.pending;
    // An accepted drop must finish before the quit-time snapshot. A gesture still
    // held down at quit is cancelled rather than saving a halfway rectangle.
    const gestures=[...this.manipulations.values()];
    for (const g of gestures) g.finish(true);
    await Promise.all(gestures.map(g=>g.settled));
    const actions = await Promise.all([...this.entries.values()].filter(e => e.kind !== 'wallpaper').map(e => this.positionAction(e).catch(() => null)));
    return actions.filter((action): action is Action => action !== null);
  }
  private destroy(entry: Entry) {
    if(entry.kind==='drawer')this.onDrawerSurface?.(null);
    entry.attached = false; entry.layerVersion++;
    this.interrupt(entry);
    const timer = this.timers.get(entry.key);
    if (timer) clearTimeout(timer);
    this.timers.delete(entry.key);
    this.entries.delete(entry.key);
    this.updateInputTargets();
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
    await this.input.stop();
    await this.releaseFocus();
    this.destroyAll();
    await this.refresh();
  }
}
