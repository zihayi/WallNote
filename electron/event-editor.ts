import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';
import path from 'node:path';
import { calendarEvents, createEvent, validDate } from '../shared/calendar';
import type { Action, AppState, EventEditorData, EventEditorRequest, PhoneSyncView } from '../shared/types';

/** WorkerW children can receive routed clicks without owning the foreground keyboard or IME. */
export class EventEditorWindow {
  private current?: { win: BrowserWindow; data: EventEditorData };

  constructor(private getState: () => AppState, private load: (win: BrowserWindow, query: Record<string, string>) => Promise<void>, private secure: (win: BrowserWindow) => void, private quitting: () => boolean, private icon: string) {}

  owns(contents: WebContents) { return this.current?.win.webContents === contents; }
  allows(action: Action) {
    const data = this.current?.data;
    if (!data) return false;
    if (action.type === 'calendar:select') return validDate(action.date);
    if (data.event.phone?.readOnly) return false;
    if (action.type === 'event:add') return !data.existing && action.event.id === data.event.id && !action.event.phone;
    return (action.type === 'event:update' || action.type === 'event:delete') && action.id === data.event.id;
  }
  canSend(id: string) { return this.current?.data.event.id === id && !this.current.data.event.phone; }
  phone(view?: PhoneSyncView): PhoneSyncView | undefined {
    const id = this.current?.data.event.id;
    return view && { ...view, calendars: [], items: id && view.items[id] ? { [id]: view.items[id] } : {} };
  }
  data(): EventEditorData {
    if (!this.current) throw new Error('编辑窗口已关闭。');
    return { ...this.current.data, phoneSync: this.phone(this.getState().phoneSync) };
  }
  finish() { this.current?.win.destroy(); }

  private reveal(win: BrowserWindow) {
    // Explorer can still be frontmost in "Show desktop" mode even when Chromium
    // considers the new window focused. Raise the editor for this explicit action.
    win.setAlwaysOnTop(true); win.show(); win.focus();
  }

  async open(request: EventEditorRequest, anchor: Rectangle) {
    if (!request || typeof request !== 'object') throw new Error('无效的日程。');
    if (this.current) {
      const { win } = this.current;
      if (win.isMinimized()) win.restore();
      this.reveal(win); // Never replace an unfinished draft.
      return;
    }
    let data: EventEditorData;
    if ('id' in request) {
      const event = calendarEvents(this.getState()).find(item => item.id === request.id);
      if (!event) throw new Error('日程已变化，请刷新后重试。');
      data = { event, existing: true };
    } else {
      if (!validDate(request.date) || !Number.isInteger(request.hour) || request.hour < 0 || request.hour > 23) throw new Error('无效的日程日期或时间。');
      data = { event: createEvent(request.date, request.hour), existing: false };
    }
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(452, area.width), height = Math.min(540, area.height);
    const x = Math.max(area.x, Math.min(area.x + area.width - width, Math.round(anchor.x + (anchor.width - width) / 2)));
    const y = Math.max(area.y, Math.min(area.y + area.height - height, Math.round(anchor.y + (anchor.height - height) / 2)));
    const win = new BrowserWindow({ width, height, x, y, minWidth: Math.min(320, width), minHeight: Math.min(300, height),
      frame: false, show: false, backgroundColor: '#ffffff', title: data.event.phone?.readOnly ? '查看手机日程' : data.existing ? '编辑日程' : '新建日程', icon: this.icon,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.current = { win, data }; this.secure(win); win.setMenu(null);
    win.once('ready-to-show', () => { if (!win.isDestroyed()) this.reveal(win); });
    win.on('blur', () => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); });
    win.on('close', e => { if (!this.quitting() && !win.webContents.isCrashed()) { e.preventDefault(); win.webContents.send('event-editor:request-close'); } });
    win.once('closed', () => { if (this.current?.win === win) this.current = undefined; });
    try { await this.load(win, { editor: 'event' }); }
    catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; }
  }
}
