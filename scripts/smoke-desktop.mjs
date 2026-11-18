import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createServer } from 'vite';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results', 'input-v4-'));
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_SHOW_MANAGER: '0', WALLNOTE_CREATE_MANAGER: '1' };
delete env.VITE_DEV_SERVER_URL;
const packaged = process.argv.includes('--packaged');
const nativePath = path.resolve(packaged ? 'release/win-unpacked/resources/native/WallNote.DesktopHost.exe' : 'dist-native/WallNote.DesktopHost.exe');
const execute = promisify(execFile);
const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const inputHelper = path.join(profile, 'DesktopInput.exe');
await execute(compiler, ['/nologo', '/target:exe', '/platform:x64', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${inputHelper}`, path.resolve('tests/DesktopInput.cs'), path.resolve('native/DesktopInputBridge.cs')], { windowsHide: true });
async function native(...args) { const { stdout } = await execute(nativePath, args.map(String), { windowsHide: true }); return JSON.parse(stdout.replace(/^\uFEFF/, '')); }
let server, app, shownDesktop = false;
if (process.argv.includes('--dev')) { server = await createServer({ server: { port: 5174, strictPort: true } }); await server.listen(); env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5174'; }

async function windowInfo(page) {
  const handle = await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).getNativeWindowHandle().readBigUInt64LE().toString(), page.url());
  return { handle, ...(await native('inspect', handle)).window };
}
async function mouse(page, locator, mode = 'click', extra = []) {
  const info = await windowInfo(page);
  const box = await locator.boundingBox();
  const factor = info.bounds.width / await page.evaluate(() => innerWidth);
  const x = Math.round(info.bounds.x + (box.x + Math.min(box.width / 2, 30)) * factor);
  const y = Math.round(info.bounds.y + (box.y + Math.min(box.height / 2, 24)) * factor);
  const owner = await app.evaluate(() => process.pid);
  await execute(inputHelper, [mode, x, y, ...extra, ...(info.child ? [`desktop:${info.handle}`] : []), owner].map(String), { windowsHide: true });
}
function widget(kind) { return app.windows().find(page => new URL(page.url()).searchParams.get('widget') === kind); }

try {
  app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [] } : { args: ['.'] }), env, timeout: 60000 });
  await app.firstWindow();
  const managerMatch = page => /^(file|http):/.test(page.url()) && !new URL(page.url()).search;
  await expect.poll(() => app.windows().some(managerMatch), { timeout: 20000 }).toBe(true);
  const manager = app.windows().find(managerMatch);
  await expect.poll(() => manager.evaluate(() => window.wallnote?.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, widgets: 4, error: null });
  await manager.evaluate(async () => {
    const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await window.wallnote.dispatch({ type: 'event:add', event: { id: 'native-event', title: '桌面日程测试', date, start: '09:00', end: '10:00', description: '', color: 'mint' } });
    await window.wallnote.dispatch({ type: 'calendar:select', date });
    await window.wallnote.dispatch({ type: 'note:add', note: { id: 'native-note', title: '输入测试', content: '自动保存测试', color: 'butter', pinned: true, updatedAt: now.toISOString() } });
  });
  await expect.poll(() => app.windows().some(page => new URL(page.url()).searchParams.get('note') === 'native-note')).toBe(true);
  const calendar = widget('calendar'), schedule = widget('schedule'), tasks = widget('tasks');
  let note = app.windows().find(page => new URL(page.url()).searchParams.get('note') === 'native-note');
  const owner = await app.evaluate(() => process.pid);
  for (const page of [calendar, schedule, tasks, note]) {
    const info = await windowInfo(page);
    expect(info).toMatchObject({ child: true, topmost: false });
    expect((await native('inspect', info.parent)).window.className).toBe('WorkerW');
  }
  const originalCalendar = (await windowInfo(calendar)).bounds;
  const originalNote = (await windowInfo(note)).bounds;

  await native('show-desktop'); shownDesktop = true;
  await new Promise(resolve => setTimeout(resolve, 700));
  const iconRects = await native('icon-rects');
  if (iconRects.length) {
    const icon = iconRects[0];
    const route = await native('route-check', (await windowInfo(calendar)).handle, owner, Math.round(icon.x + icon.width / 2), Math.round(icon.y + icon.height / 2));
    expect(route.iconPriority).toBe(true);
    expect(route.allowed).toBe(false);
  }

  const today = await manager.evaluate(() => window.wallnote.getState().then(state => state.calendarDate));
  const tomorrow = await calendar.evaluate(date => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + 1); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }, today);
  for (const date of [tomorrow, today]) {
    const button = calendar.getByRole('button', { name: `选择日期 ${date}`, exact: true });
    await mouse(calendar, button);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(schedule.locator('.schedule-event')).toHaveCount(date === today ? 1 : 0);
    expect((await windowInfo(calendar)).topmost).toBe(false);
  }
  const oldScroll = await schedule.locator('.hourly-list').evaluate(el => el.scrollTop);
  await mouse(schedule, schedule.locator('.hourly-list'), 'wheel', [-360]);
  await expect.poll(() => schedule.locator('.hourly-list').evaluate(el => el.scrollTop)).toBeGreaterThan(oldScroll);
  const checkbox = tasks.getByRole('checkbox', { name: '选择桌面壁纸', exact: true });
  await mouse(tasks, checkbox);
  await expect(checkbox).toBeChecked();

  await mouse(note, note.getByRole('button', { name: '置顶便签', exact: true }));
  await expect.poll(() => windowInfo(note)).toMatchObject({ child: false, parent: '0', topmost: true });
  await mouse(note, note.getByRole('textbox', { name: '便签内容', exact: true }), 'type', [' 98765']);
  await expect(note.getByRole('textbox', { name: '便签内容', exact: true })).toHaveValue(/98765/);
  const beforeMove = (await windowInfo(note)).bounds;
  await mouse(note, note.locator('.frost-title'), 'drag', [50, 35]);
  await expect.poll(async () => (await windowInfo(note)).bounds.x).toBe(beforeMove.x + 50);
  const beforeResize = (await windowInfo(note)).bounds;
  await mouse(note, note.getByRole('button', { name: '拖动调整便签大小', exact: true }), 'drag', [45, 35]);
  await expect.poll(async () => (await windowInfo(note)).bounds.width).toBe(beforeResize.width + 45);
  await mouse(note, note.getByRole('button', { name: '置顶便签', exact: true }));
  await expect.poll(() => windowInfo(note)).toMatchObject({ child: true, topmost: false, bounds: originalNote });

  await mouse(calendar, calendar.getByRole('button', { name: '置顶日历', exact: true }));
  await expect.poll(() => windowInfo(calendar)).toMatchObject({ child: false, topmost: true });
  await mouse(calendar, calendar.getByRole('button', { name: '拖动调整日历大小', exact: true }), 'drag', [-650, -650]);
  await expect.poll(async () => (await windowInfo(calendar)).bounds.width).toBe(330);
  expect((await windowInfo(calendar)).bounds.height).toBe(550);
  expect(await calendar.locator('.calendar-agenda').evaluate(el => el.clientHeight)).toBeGreaterThan(65);
  await mouse(calendar, calendar.getByRole('button', { name: '置顶日历', exact: true }));
  await expect.poll(() => windowInfo(calendar)).toMatchObject({ child: true, topmost: false, bounds: originalCalendar });

  await native('restore-desktop'); shownDesktop = false;
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'note:add', note: { id: 'second-note', title: '第二张便签', content: '切换测试', color: 'mint', pinned: true, updatedAt: new Date().toISOString() } }));
  await expect.poll(() => app.windows().filter(page => new URL(page.url()).searchParams.has('note')).length).toBe(1);
  await expect.poll(() => manager.evaluate(() => window.wallnote.getState().then(state => state.settings.activeDesktopNote))).toBe('second-note');
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'note:selectDesktop', id: 'native-note' }));
  await expect.poll(() => app.windows().some(page => new URL(page.url()).searchParams.get('note') === 'native-note')).toBe(true);
  note = app.windows().find(page => new URL(page.url()).searchParams.get('note') === 'native-note');
  await expect(note.getByRole('textbox', { name: '便签内容', exact: true })).toHaveValue(/98765/);
  expect((await manager.evaluate(() => window.wallnote.getDesktopStatus())).widgets).toBe(4);
  await app.close(); app = undefined;
  const saved = JSON.parse(await readFile(path.join(profile, 'state.json'), 'utf8'));
  expect(saved.settings.topmostWidgets).toEqual([]);
  expect(saved.notes.find(item => item.id === 'native-note').content).toContain('98765');
  expect(saved.events).toHaveLength(1);
  console.log(`Native desktop input passed: icon priority, background date clicks/scrolling, explicit pin/unpin, text input, drag/resize limits, aligned restore and note switching. Profile: ${profile}`);
} catch (error) {
  if (app) console.error(await app.windows().find(page => !new URL(page.url()).search)?.evaluate(() => window.wallnote.getDesktopStatus()).catch(() => null));
  throw error;
} finally {
  if (shownDesktop) await native('restore-desktop');
  await app?.close(); await server?.close();
}
