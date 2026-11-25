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
  // A Win32 resize can finish before Chromium has consumed WM_SIZE/DPI changes.
  await expect.poll(() => page.evaluate(({w,h}) => Math.max(Math.abs(innerWidth * devicePixelRatio - w), Math.abs(innerHeight * devicePixelRatio - h)), {w:info.bounds.width,h:info.bounds.height})).toBeLessThan(3);
  const box = await locator.boundingBox();
  const [width, height] = await page.evaluate(() => [innerWidth, innerHeight]);
  const owner = await app.evaluate(() => process.pid);
  // Only send input over the intended card and never through a covering application.
  for (const [fx, fy] of [[.5, .5], [.8, .25], [.7, .75], [.25, .25], [.25, .75]]) {
    const cx = box.x + box.width * fx, cy = box.y + box.height * fy;
    const x = info.bounds.x + Math.round(cx * info.bounds.width / width);
    const y = info.bounds.y + Math.round(cy * info.bounds.height / height);
    if (info.child && !(await native('route-check', info.handle, owner, x, y)).allowed) continue;
    await execute(inputHelper, [mode, x, y, ...extra, ...(info.child ? [`desktop:${info.handle}`] : []), owner].map(String), { windowsHide: true });
    return { cx, cy };
  }
  throw new Error(`Test element covered; no input sent: ${locator}`);
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

  await native('show-desktop'); shownDesktop = true;
  await new Promise(resolve => setTimeout(resolve, 700));
  const ci=await windowInfo(calendar);
  expect((await native('route-check',ci.handle,owner,ci.bounds.x,ci.bounds.y)).allowed).toBe(false);
  await calendar.evaluate(()=>{window.__moduleRight=[];for(const t of ['mousedown','mouseup','contextmenu'])window.addEventListener(t,e=>{if(e.button===2)window.__moduleRight.push([t,e.defaultPrevented]);});});
  await mouse(calendar,calendar.locator('.frost-title'),'right'); // No file tile or custom menu here.
  const right=await calendar.evaluate(()=>window.__moduleRight);
  for(const t of ['mousedown','mouseup','contextmenu'])expect(right.some(([type])=>type===t)).toBe(true);
  expect(right).toContainEqual(['contextmenu',true]);

  const today = await manager.evaluate(() => window.wallnote.getState().then(state => state.calendarDate));
  const tomorrow = await calendar.evaluate(date => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + 1); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }, today);
  const edges = await calendar.locator('.calendar-grid button:not(.outside-month)').evaluateAll(buttons => [buttons[0], buttons.at(-1)].map(b => b.getAttribute('aria-label').split(' ')[1]));
  await calendar.evaluate(() => {
    window.__testHits = {};
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) document.addEventListener(type, e => {
      window.__testHits[type] = [e.clientX, e.clientY, e.target.closest('button')?.getAttribute('aria-label')];
    }, true);
  });
  for (const date of [...edges, tomorrow, today]) {
    const button = calendar.getByRole('button', { name: `选择日期 ${date}`, exact: true });
    await calendar.evaluate(() => { window.__testHits = {}; });
    const { cx, cy } = await mouse(calendar, button);
    const hits = await calendar.evaluate(() => window.__testHits);
    const down = hits.mousedown;
    expect(down, `native click at ${cx}, ${cy}, received ${JSON.stringify(hits)}`).toBeDefined();
    expect(Math.abs(down[0] - cx)).toBeLessThan(2);
    expect(Math.abs(down[1] - cy)).toBeLessThan(2);
    try { await expect(button).toHaveAttribute('aria-pressed', 'true'); }
    catch (error) { console.error('Calendar native click', { date, hits: await calendar.evaluate(() => window.__testHits), selected: await manager.evaluate(() => window.wallnote.getState().then(state => state.calendarDate)) }); throw error; }
    await expect(schedule.locator('.schedule-event')).toHaveCount(date === today ? 1 : 0);
    expect((await windowInfo(calendar)).topmost).toBe(false);
  }
  const oldScroll = await schedule.locator('.hourly-list').evaluate(el => el.scrollTop);
  await mouse(schedule, schedule.locator('.hourly-list'), 'wheel', [-360]);
  await expect.poll(() => schedule.locator('.hourly-list').evaluate(el => el.scrollTop)).toBeGreaterThan(oldScroll);
  const checkbox = tasks.getByRole('checkbox', { name: '选择桌面壁纸', exact: true });
  await mouse(tasks, checkbox);
  await expect(checkbox).toBeChecked();

  const dockedNote = (await windowInfo(note)).bounds;
  const noteHome = await manager.evaluate(() => window.wallnote.getState().then(state => state.settings.dockFrames?.notes));
  await mouse(note, note.getByRole('button', { name: '置顶便签', exact: true }));
  await expect.poll(() => windowInfo(note)).toMatchObject({ child: false, parent: '0', topmost: true });
  await mouse(note, note.getByRole('textbox', { name: '便签内容', exact: true }), 'type', [' 98765']);
  await expect(note.getByRole('textbox', { name: '便签内容', exact: true })).toHaveValue(/98765/);
  const beforeMove = (await windowInfo(note)).bounds;
  await mouse(note, note.locator('.frost-title'), 'drag', [50, 35]);
  await expect.poll(async () => Math.abs((await windowInfo(note)).bounds.x - beforeMove.x - 50)).toBeLessThanOrEqual(2);
  const beforeResize = (await windowInfo(note)).bounds;
  await mouse(note, note.getByRole('button', { name: '拖动调整便签大小', exact: true }), 'drag', [45, 35]);
  await expect.poll(async () => Math.abs((await windowInfo(note)).bounds.width - beforeResize.width - 45)).toBeLessThanOrEqual(2);
  const resizedNote = (await windowInfo(note)).bounds;
  expect(await manager.evaluate(() => window.wallnote.getState().then(state => state.settings.dockFrames?.notes))).toEqual(noteHome);
  await mouse(note, note.getByRole('button', { name: '置顶便签', exact: true }));
  await expect.poll(() => windowInfo(note)).toMatchObject({ child: true, topmost: false, bounds: dockedNote });
  await mouse(note, note.getByRole('button', { name: '置顶便签', exact: true }));
  await expect.poll(() => windowInfo(note)).toMatchObject({ child: false, topmost: true, bounds: resizedNote });
  await mouse(note, note.getByRole('button', { name: '置顶便签', exact: true }));
  await expect.poll(() => windowInfo(note)).toMatchObject({ child: true, topmost: false, bounds: dockedNote });

  const dockedCalendar = (await windowInfo(calendar)).bounds;
  await mouse(calendar, calendar.getByRole('button', { name: '置顶日历', exact: true }));
  await expect.poll(() => windowInfo(calendar)).toMatchObject({ child: false, topmost: true });
  const calendarHandle = (await windowInfo(calendar)).handle;
  const assertOutline = kind => execute(inputHelper, ['outline', calendarHandle, String(owner), kind], { windowsHide: true });
  await assertOutline('floating');
  const scale = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
  await mouse(calendar, calendar.getByRole('button', { name: '拖动调整日历大小', exact: true }), 'drag', [-Math.ceil(650 * scale), -Math.ceil(650 * scale)]);
  await expect.poll(async () => Math.abs((await windowInfo(calendar)).bounds.width - 330 * scale)).toBeLessThanOrEqual(1);
  expect(Math.abs((await windowInfo(calendar)).bounds.height - 550 * scale)).toBeLessThanOrEqual(1);
  await assertOutline('floating');
  expect(await calendar.locator('.calendar-agenda').evaluate(el => el.clientHeight)).toBeGreaterThan(65);
  await mouse(calendar, calendar.getByRole('button', { name: '置顶日历', exact: true }));
  await expect.poll(() => windowInfo(calendar)).toMatchObject({ child: true, topmost: false, bounds: dockedCalendar });
  await assertOutline('embedded');

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
  console.log(`Native desktop input passed: rounded card ownership, both buttons, background date clicks/scrolling, pin/unpin, text input, drag/resize limits and note switching. Profile: ${profile}`);
} catch (error) {
  if (app) console.error(await app.windows().find(page => !new URL(page.url()).search)?.evaluate(() => window.wallnote.getDesktopStatus()).catch(() => null));
  throw error;
} finally {
  if (shownDesktop) await native('restore-desktop');
  await app?.close(); await server?.close();
}
