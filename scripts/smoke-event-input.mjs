// Disposable profile. --physical additionally checks the foreground OS keyboard path;
// run that mode on an idle desktop. By default keyboard events address the test renderer only.
import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
const run = promisify(execFile), packaged = process.argv.includes('--packaged'), physicalKeys = process.argv.includes('--physical');
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results', 'event-keyboard-'));
const input = path.join(profile, 'DesktopInput.exe');
if (physicalKeys) await run(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', '/platform:x64', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', `/out:${input}`, path.resolve('tests/DesktopInput.cs'), path.resolve('native/DesktopInputBridge.cs')], { windowsHide: true });
const helper = path.resolve(packaged ? 'release/win-unpacked/resources/native/WallNote.DesktopHost.exe' : 'dist-native/WallNote.DesktopHost.exe');
const native = async (...args) => JSON.parse((await run(helper, args.map(String), { windowsHide: true })).stdout.replace(/^\uFEFF/, ''));
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_CREATE_MANAGER: '1', WALLNOTE_SHOW_MANAGER: '0' };
delete env.VITE_DEV_SERVER_URL; delete env.WALLNOTE_ENABLE_WIFI_RECEIVER;
let app;
try {
  app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [] } : { args: ['.'] }), env, timeout: 45000 });
  await app.firstWindow();
  const manager = () => app.windows().find(p => /\/index\.html$/.test(p.url()));
  await expect.poll(() => manager()?.evaluate(() => window.wallnote?.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, widgets: 4 });
  if (!physicalKeys) await app.evaluate(({app}) => app.on('browser-window-created', (_e, w) => { w.show = () => {}; w.focus = () => {}; w.setAlwaysOnTop = () => {}; }));
  const owner = await app.evaluate(() => process.pid);
  const calendar = app.windows().find(p => p.url().includes('widget=calendar'));
  const schedule = app.windows().find(p => p.url().includes('widget=schedule'));
  await manager().evaluate(async () => {
    await window.wallnote.dispatch({ type: 'event:add', event: { id: 'keyboard-fixture', title: '测试日程', date: '2028-03-12', start: '09:00', end: '10:00', color: 'mint', description: '' } });
    await window.wallnote.dispatch({ type: 'calendar:select', date: '2028-03-12' });
  });
  async function typeIn(page, locator, word) {
    if (!physicalKeys) { await locator.focus(); await page.keyboard.type(word); return; }
    const bw = await app.browserWindow(page);
    await expect.poll(() => bw.evaluate(w => w.isVisible() && !w.isMinimized()), { message: 'the editor must be shown by the OS, not only present in the DOM' }).toBe(true);
    const focused = await bw.evaluate(w => w.isFocused());
    const id = await bw.evaluate(w => w.getNativeWindowHandle().readBigUInt64LE().toString()); await bw.dispose();
    const { window: win } = await native('inspect', id);
    const [vw, vh] = await page.evaluate(() => [innerWidth, innerHeight]);
    const b = await locator.boundingBox();
    for (const fx of [.5, .35, .75]) {
      const x = win.bounds.x + Math.round((b.x + fx * b.width) * win.bounds.width / vw), y = win.bounds.y + Math.round((b.y + b.height / 2) * win.bounds.height / vh);
      if (win.child && !(await native('route-check', id, owner, x, y)).allowed) continue;
      try { await run(input, ['type', x, y, word, ...(win.child ? [`desktop:${id}`] : []), owner].map(String), { windowsHide: true }); } catch (err) { console.error('QA input target', {query:new URL(page.url()).search,win,focused,viewport:[vw,vh],box:b});throw err; } return;
    }
    throw new Error('Test control is obscured; no input sent.');
  }
  async function formPage() {
    let editor;
    await expect.poll(async () => {
      for (const p of app.windows()) if (await p.getByRole('dialog').isVisible()) { editor = p; return true; }
      return false;
    }).toBe(true);
    return editor;
  }
  // Exercise the widget action without minimizing the user's other applications; the
  // normal OS keystrokes below must reach the standalone editor, not a CDP-focused field.
  await calendar.getByRole('button', { name: '编辑日程：测试日程', exact: true }).evaluate(b => b.click());
  const editor = await formPage();
  expect(new URL(editor.url()).searchParams.get('editor')).toBe('event');
  await expect(editor.evaluate(async () => { try { await window.wallnote.dispatch({type:'task:clearCompleted'}); return false; } catch { return true; } })).resolves.toBe(true);
  const title = editor.getByRole('textbox', { name: '日程标题', exact: true });
  await expect(title).toBeEnabled();
  await typeIn(editor, title, '42'); await expect(title).toHaveValue(/42/);
  const notes = editor.getByRole('textbox', { name: '日程备注', exact: true });
  await typeIn(editor, notes, 'hello'); await expect(notes).toHaveValue('hello');
  const ime = await editor.context().newCDPSession(editor);
  await ime.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
  await ime.send('Input.insertText', { text: '中文' }); await ime.detach();
  await expect(notes).toHaveValue('hello中文');
  await editor.getByRole('button', { name: '保存日程', exact: true }).click();
  await expect.poll(() => manager().evaluate(() => window.wallnote.getState().then(s => s.events.find(e => e.id === 'keyboard-fixture').description))).toBe('hello中文');
  await expect(calendar.getByRole('button', { name: '置顶日历', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await schedule.getByRole('button', { name: '在 09:00 添加日程', exact: true }).evaluate(b => b.click());
  const newEditor = await formPage();
  await expect(newEditor.getByLabel('开始时间', { exact: true })).toHaveValue('09:00');
  await typeIn(newEditor, newEditor.getByRole('textbox', { name: '日程标题', exact: true }), 'draft');
  // An OS close (Alt+F4) must go through the same discard confirmation as the X button.
  const popup = await app.browserWindow(newEditor); await popup.evaluate(w => w.close()); await popup.dispose();
  await newEditor.getByRole('button', { name: '放弃更改', exact: true }).click();
  await expect.poll(() => manager().evaluate(() => window.wallnote.getState().then(s => s.events.length))).toBe(1);
  if (!physicalKeys) {
    const bw = await app.browserWindow(calendar);
    const id = await bw.evaluate(w => w.getNativeWindowHandle().readBigUInt64LE().toString()); await bw.dispose();
    const area = await app.evaluate(({screen}) => { const {x,y,width} = screen.getPrimaryDisplay().bounds; return screen.dipToScreenRect(null,{x:x+width+64,y,width:400,height:600}); });
    await native('position', id, owner, area.x, area.y, area.width, area.height);
  }
  await manager().evaluate(() => window.wallnote.dispatch({ type: 'widget:topmost', key: 'calendar', enabled: true }));
  await calendar.getByRole('button', { name: '为选中日期添加日程' }).evaluate(b=>b.click());
  await expect(calendar.getByRole('dialog')).toBeVisible();
  await typeIn(calendar, calendar.getByRole('textbox', { name: '日程标题', exact: true }), 'pinned');
  await expect(calendar.getByRole('textbox', { name: '日程标题', exact: true })).toHaveValue('pinned');
  console.log(`Desktop event keyboard passed (${physicalKeys ? 'Windows keyboard' : 'renderer keyboard'}): Chinese composition, save, hour creation, OS close/discard and pinned inline editing.`);
} finally { await app?.close(); }
