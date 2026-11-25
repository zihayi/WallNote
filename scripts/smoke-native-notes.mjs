import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { configureEnvironment } from './environment.mjs';

configureEnvironment(); await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results', 'native-notes-'));
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_SHOW_MANAGER: '0', WALLNOTE_CREATE_MANAGER: '1' };
delete env.VITE_DEV_SERVER_URL;
const execute = promisify(execFile), helper = path.resolve('dist-native/WallNote.DesktopHost.exe');
let app, manager, clipboardSaved = false;
const notePage = () => app.windows().find(page => new URL(page.url()).searchParams.has('note'));
const state = () => manager.evaluate(() => window.wallnote.getState());
async function native(...args) { const { stdout } = await execute(helper, args.map(String), { windowsHide: true }); return JSON.parse(stdout.replace(/^\uFEFF/, '')); }
async function info(page) {
  const handle = await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url).getNativeWindowHandle().readBigUInt64LE().toString(), page.url());
  return { handle, ...(await native('inspect', handle)).window };
}
async function selected(title) { await expect.poll(() => notePage()?.getByRole('textbox', { name: '便签标题' }).inputValue().catch(() => null)).toBe(title); return notePage(); }
try {
  app = await electron.launch({ args: ['.'], env, timeout: 60000 }); await app.firstWindow();
  await expect.poll(() => {
    manager = app.windows().find(page => page.url().startsWith('file:') && !new URL(page.url()).search);
    return manager?.evaluate(() => window.wallnote?.getDesktopStatus());
  }, { timeout: 30000 }).toMatchObject({ active: true, widgets: 4, error: null });
  const empty = app.windows().find(page => page.url().includes('widget=notes-empty'));
  await expect(empty.getByRole('combobox', { name: '选择便签' }).locator('option')).toHaveCount(4);
  await empty.getByRole('combobox', { name: '选择便签' }).selectOption('welcome');
  let note = await selected('使用说明');
  await note.getByRole('button', { name: '新建便签', exact: true }).click();
  note = await selected('新建便签');
  await note.getByRole('textbox', { name: '便签标题' }).fill('桌面图片');
  await note.getByLabel('自定义便签背景色').fill('#14324f');
  await expect.poll(async () => (await state()).notes.find(row => row.title === '桌面图片')?.backgroundColor).toBe('#14324f');
  const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#43b992' } }).png().toBuffer();
  await note.getByLabel('插入便签图片').setInputFiles({ name: '原始图片.png', mimeType: 'image/png', buffer: png });
  await expect(note.locator('.note-images img')).toHaveCount(1);

  // Keep the user's clipboard entirely in process memory, restoring it in finally.
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.__noteTestClipboard = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  }); clipboardSaved = true;
  await note.getByRole('button', { name: '复制图片：原始图片.png' }).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
  await note.getByRole('textbox', { name: '便签内容' }).focus();
  await note.getByRole('textbox', { name: '便签内容' }).press('Control+v');
  await expect(note.locator('.note-images img')).toHaveCount(2);
  const docked = await info(note), dockFrames = (await state()).settings.dockFrames;
  await note.getByRole('button', { name: '置顶便签', exact: true }).click();
  await expect.poll(() => info(note)).toMatchObject({ child: false, topmost: true });
  await note.getByRole('textbox', { name: '便签内容' }).focus();
  await note.getByRole('textbox', { name: '便签内容' }).press('Control+v');
  await expect(note.locator('.note-images img')).toHaveCount(3);
  await expect.poll(async () => (await state()).notes.find(row => row.title === '桌面图片')?.images?.length).toBe(3);

  const target = await app.evaluate(({ screen }) => {
    const display = screen.getPrimaryDisplay(), a = display.workArea;
    return { rect: screen.dipToScreenRect(null, { x: a.x + 50, y: a.y + 70, width: Math.min(440, a.width), height: Math.min(420, a.height) }), scale: display.scaleFactor, pid: process.pid };
  });
  await native('position', docked.handle, target.pid, target.rect.x, target.rect.y, target.rect.width, target.rect.height, target.scale);
  await expect.poll(async () => (await state()).settings.floatingFrames?.notes).toBeTruthy();
  const floated = (await info(note)).bounds;
  expect((await state()).settings.dockFrames).toEqual(dockFrames);
  await note.getByRole('button', { name: '置顶便签', exact: true }).click();
  await expect.poll(() => info(note)).toMatchObject({ child: true, topmost: false, bounds: docked.bounds });
  await note.getByRole('button', { name: '置顶便签', exact: true }).click();
  await expect.poll(() => info(note)).toMatchObject({ child: false, topmost: true, bounds: floated });
  await note.getByRole('combobox', { name: '选择便签' }).selectOption('inspiration');
  note = await selected('项目记录');
  await expect.poll(() => info(note)).toMatchObject({ topmost: true, bounds: floated });
  await note.getByRole('button', { name: '置顶便签', exact: true }).click();
  await expect.poll(() => info(note)).toMatchObject({ child: true, topmost: false, bounds: docked.bounds });
  await note.getByRole('combobox', { name: '选择便签' }).selectOption({ label: '桌面图片' });
  note = await selected('桌面图片');
  await expect(note.locator('.note-images img')).toHaveCount(3);
  const backup = path.join(profile, 'notes-backup.json');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, backup);
  await manager.evaluate(() => window.wallnote.exportBackup());
  expect(JSON.parse(await readFile(backup, 'utf8')).notes.find(row => row.title === '桌面图片').images).toHaveLength(3);
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'calendar:select', date: '2028-02-29' }));
  await app.evaluate(async ({ clipboard }) => { const items = globalThis.__noteTestClipboard; if (items.length) await clipboard.write(items); else clipboard.clear(); delete globalThis.__noteTestClipboard; }); clipboardSaved = false;
  await app.close(); app = undefined;
  app = await electron.launch({ args: ['.'], env, timeout: 60000 }); await app.firstWindow();
  await expect.poll(() => {
    manager = app.windows().find(page => page.url().startsWith('file:') && !new URL(page.url()).search);
    return manager?.evaluate(() => window.wallnote?.getDesktopStatus());
  }, { timeout: 30000 }).toMatchObject({ active: true, widgets: 4, error: null });
  note = await selected('桌面图片');
  await expect(note.locator('.note-images img')).toHaveCount(3);
  const today = await manager.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  expect((await state()).calendarDate).toBe(today);
  await expect.poll(() => info(note)).toMatchObject({ child: true, topmost: false, bounds: docked.bounds });
  await note.getByRole('button', { name: '置顶便签', exact: true }).click();
  await expect.poll(() => info(note)).toMatchObject({ topmost: true, bounds: floated });
  await note.getByRole('button', { name: '置顶便签', exact: true }).click();
  await note.getByRole('button', { name: '删除当前便签' }).click();
  await note.getByRole('button', { name: '确认删除便签' }).click();
  await expect.poll(async () => (await state()).notes.some(row => row.title === '桌面图片')).toBe(false);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }, backup);
  await manager.evaluate(() => window.wallnote.restoreBackup());
  expect((await state()).notes.find(row => row.title === '桌面图片')).toMatchObject({ backgroundColor: '#14324f', images: expect.arrayContaining([expect.objectContaining({ name: '原始图片.png' })]) });
  expect((await manager.evaluate(() => window.wallnote.getDesktopStatus())).error).toBeNull();
  console.log('Native notes passed: empty/all-title selection, create/delete, custom color, real clipboard copy/paste in both layers, independent geometry, restart with today selected, and image backup/restore.');
} finally {
  if (app && clipboardSaved) await app.evaluate(async ({ clipboard }) => { const items = globalThis.__noteTestClipboard; if (items.length) await clipboard.write(items); else clipboard.clear(); delete globalThis.__noteTestClipboard; }).catch(() => undefined);
  await app?.close();
}
