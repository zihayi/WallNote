import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { createServer } from 'vite';
import { configureEnvironment } from './environment.mjs';
import sharp from 'sharp';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const dataPath = await mkdtemp(path.resolve('test-results', 'embedded-profile-'));
const env = { ...process.env, WALLNOTE_DATA_DIR: dataPath, WALLNOTE_SHOW_MANAGER: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const development = process.argv.includes('--dev');
const packaged = process.argv.includes('--packaged');
const nativePath = path.resolve(packaged ? 'release/win-unpacked/resources/native/WallNote.DesktopHost.exe' : 'dist-native/WallNote.DesktopHost.exe');
const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const inputHelper = path.resolve(dataPath, 'DesktopInput.exe');
await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/platform:x64', '/reference:System.Windows.Forms.dll', `/out:${inputHelper}`, path.resolve('tests/DesktopInput.cs')], { windowsHide: true });
async function input(...args) { await promisify(execFile)(inputHelper, args.map(String), { windowsHide: true }); }
async function native(...args) { const { stdout } = await promisify(execFile)(nativePath, args, { windowsHide: true }); return JSON.parse(stdout.replace(/^\uFEFF/, '')); }
let server;
if (development) { server = await createServer({ server: { port: 5174, strictPort: true } }); await server.listen(); env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5174'; }
let app;
let desktopToggled = false;
const errors = [];
async function launch() {
  app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [] } : { args: ['.'] }), env, timeout: 60000 });
  await app.firstWindow();
  const isManager = window => /^(file|http):/.test(window.url()) && !new URL(window.url()).search;
  await expect.poll(() => app.windows().some(isManager), { timeout: 20000 }).toBe(true);
  const page = app.windows().find(isManager);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('让桌面', { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => window.wallnote.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, error: null });
  return page;
}
async function windows() {
  return app.evaluate(({ BrowserWindow, screen }) => ({
    displays: screen.getAllDisplays().length,
    windows: BrowserWindow.getAllWindows().map(win => ({ handle: win.getNativeWindowHandle().readBigUInt64LE().toString(), url: win.webContents.getURL(), visible: win.isVisible(), id: win.id })),
  }));
}

try {
  let page = await launch();
  const initial = await windows();
  const backgrounds = initial.windows.filter(w => new URL(w.url).searchParams.has('wallpaper'));
  expect(backgrounds.length).toBe(initial.displays);
  for (const background of backgrounds) {
    const actual = await native('inspect', background.handle);
    expect(actual.window).toMatchObject({ child: true, topmost: false, visible: true, minimized: false });
    expect((await native('inspect', actual.window.parent)).window.className).toBe('WorkerW');
  }
  await page.getByRole('button', { name: '新建便签', exact: true }).click();
  await page.getByRole('textbox', { name: '便签标题' }).fill('桌面层集成测试');
  await page.getByRole('textbox', { name: '便签内容' }).fill('这张便签直接固定在 Windows 桌面上');
  await page.getByRole('button', { name: '保存便签', exact: true }).click();
  const floatingEvent = app.waitForEvent('window');
  await page.getByRole('button', { name: '贴到桌面：桌面层集成测试', exact: true }).click();
  const floating = await floatingEvent;
  await expect(floating.getByRole('textbox', { name: '便签内容' })).toHaveValue('这张便签直接固定在 Windows 桌面上');
  await expect.poll(() => page.evaluate(() => window.wallnote.getDesktopStatus()), { timeout: 20000 }).toMatchObject({ widgets: 2, error: null });
  await floating.getByRole('textbox', { name: '便签内容' }).fill('桌面与管理面板实时同步');
  await expect(page.getByText('桌面与管理面板实时同步', { exact: true })).toBeVisible();
  const noteWindow = (await windows()).windows.find(w => new URL(w.url).searchParams.has('note'));
  const noteInspection = await native('inspect', noteWindow.handle);
  expect(noteInspection.window).toMatchObject({ child: true, topmost: false, minimized: false });
  expect(['Progman', 'WorkerW']).toContain((await native('inspect', noteInspection.window.parent)).window.className);

  const geometry = await app.evaluate(({ screen }) => ({ pid: process.pid, bounds: screen.dipToScreenRect(null, { x: 80, y: 90, width: 360, height: 340 }) }));
  await native('position', noteWindow.handle, String(geometry.pid), ...Object.values(geometry.bounds).map(String));
  await expect.poll(async () => JSON.parse(await readFile(path.join(dataPath, 'state.json'), 'utf8')).notes[0].position?.width).toBe(360);
  await floating.screenshot({ path: 'test-results/embedded-note.png' });

  // A real desktop child must survive Show Desktop, unlike a normal floating window.
  await page.getByRole('button', { name: '关闭应用', exact: true }).click();
  const hiddenManager = (await windows()).windows.find(w => !new URL(w.url).search);
  expect(hiddenManager.visible).toBe(false);
  await native('toggle-desktop'); desktopToggled = true;
  await new Promise(resolve => setTimeout(resolve, 800));
  expect((await native('inspect', noteWindow.handle)).window).toMatchObject({ child: true, visible: true, minimized: false, cloaked: false });
  const captured = await app.evaluate(async ({ desktopCapturer, screen }) => {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(Math.max(...displays.map(d => d.size.width * d.scaleFactor))), height: Math.round(Math.max(...displays.map(d => d.size.height * d.scaleFactor))) } });
    return { primary: String(screen.getPrimaryDisplay().id), screens: sources.map(source => ({ id: source.display_id, image: source.thumbnail.toPNG().toString('base64') })) };
  });
  expect(captured.screens.length).toBe(initial.displays);
  for (const capture of captured.screens) {
    const desktopImage = Buffer.from(capture.image, 'base64');
    await writeFile(capture.id === captured.primary ? 'test-results/actual-desktop.png' : `test-results/actual-desktop-${capture.id}.png`, desktopImage);
    const metadata = await sharp(desktopImage).metadata();
    const wallpaperPixels = await sharp(desktopImage).extract({ left: Math.floor(metadata.width * .4), top: Math.floor(metadata.height * .65), width: Math.floor(metadata.width * .2), height: Math.floor(metadata.height * .25) }).stats();
    expect(Math.max(...wallpaperPixels.channels.slice(0, 3).map(channel => channel.stdev))).toBeGreaterThan(5);
  }
  // Real Win32 mouse/keyboard input, not CDP events: verify desktop hit testing and focus.
  const noteBounds = (await native('inspect', noteWindow.handle)).window.bounds;
  await input('type', noteBounds.x + 60, noteBounds.y + 110, ' 98765');
  await expect(floating.getByRole('textbox', { name: '便签内容' })).toHaveValue(/98765/);
  await input('drag', noteBounds.x + 70, noteBounds.y + 22, 65, 45);
  await expect.poll(async () => (await native('inspect', noteWindow.handle)).window.bounds.x).toBe(noteBounds.x + 65);
  const movedBounds = (await native('inspect', noteWindow.handle)).window.bounds;
  await input('drag', movedBounds.x + movedBounds.width - 7, movedBounds.y + movedBounds.height - 7, 50, 40);
  await expect.poll(async () => (await native('inspect', noteWindow.handle)).window.bounds.width).toBe(movedBounds.width + 50);
  const desktopTaskPage = app.windows().find(w => new URL(w.url()).searchParams.get('widget') === 'tasks');
  const taskNativeWindow = (await windows()).windows.find(w => new URL(w.url).searchParams.get('widget') === 'tasks');
  const taskBounds = (await native('inspect', taskNativeWindow.handle)).window.bounds;
  const checkbox = desktopTaskPage.getByRole('checkbox', { name: '换一张让人心情好的壁纸', exact: true });
  const box = await checkbox.boundingBox();
  const factor = taskBounds.width / await desktopTaskPage.evaluate(() => window.innerWidth);
  await input('click', Math.round(taskBounds.x + (box.x + box.width / 2) * factor), Math.round(taskBounds.y + (box.y + box.height / 2) * factor));
  await expect(checkbox).toBeChecked();
  // Put it back at a deterministic position for the restart assertion.
  await native('position', noteWindow.handle, String(geometry.pid), ...Object.values(geometry.bounds).map(String));
  await floating.getByRole('textbox', { name: '便签内容' }).fill('桌面与管理面板实时同步');
  await native('toggle-desktop'); desktopToggled = false;
  await floating.getByRole('button', { name: '打开管理面板', exact: true }).click();
  await expect.poll(async () => (await windows()).windows.find(w => !new URL(w.url).search).visible).toBe(true);

  const taskWidget = app.windows().find(w => new URL(w.url()).searchParams.get('widget') === 'tasks');
  await taskWidget.getByRole('textbox', { name: '新待办事项' }).fill('直接在桌面完成任务');
  await taskWidget.getByRole('button', { name: '添加待办', exact: true }).click();
  await taskWidget.getByRole('checkbox', { name: '直接在桌面完成任务', exact: true }).click();
  await expect(taskWidget.getByRole('checkbox', { name: '直接在桌面完成任务', exact: true })).toBeChecked();

  const importPath = path.resolve('public/wallpapers/coast.jpg');
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, importPath);
  await page.getByRole('button', { name: '壁纸收藏馆', exact: true }).click();
  await page.getByRole('button', { name: '导入本地壁纸', exact: true }).click();
  await expect(page.locator('.wallpaper-card')).toHaveCount(1);
  await page.getByRole('button', { name: '预览壁纸：coast', exact: true }).click();
  await page.getByRole('button', { name: '设为桌面壁纸', exact: true }).click();
  const backgroundPage = app.windows().find(w => new URL(w.url()).searchParams.has('wallpaper'));
  await expect(backgroundPage.locator('img')).toHaveAttribute('alt', 'coast');
  await expect.poll(() => backgroundPage.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  const backupPath = path.join(dataPath, 'exported-backup.json');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, backupPath);
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('备份已导出');
  expect(JSON.parse(await readFile(backupPath, 'utf8')).notes[0].content).toBe('桌面与管理面板实时同步');

  const oldHandles = (await windows()).windows.filter(w => new URL(w.url).search).map(w => w.handle);
  await page.getByRole('switch', { name: '桌面壁纸模式' }).click();
  await expect.poll(() => page.evaluate(() => window.wallnote.getDesktopStatus())).toMatchObject({ enabled: false, active: false, widgets: 0, displays: 0 });
  for (const handle of oldHandles) expect((await native('inspect', handle)).exists).toBe(false);
  await page.getByRole('switch', { name: '桌面壁纸模式' }).click();
  await expect.poll(() => page.evaluate(() => window.wallnote.getDesktopStatus()), { timeout: 20000 }).toMatchObject({ active: true, widgets: 2 });

  const noteAfterResume = app.windows().find(w => new URL(w.url()).searchParams.has('note'));
  await noteAfterResume.getByRole('textbox', { name: '便签内容' }).fill('退出前最后一条桌面修改');
  await app.close(); app = undefined;
  page = await launch();
  await expect(page.getByText('退出前最后一条桌面修改', { exact: true })).toBeVisible();
  const stored = JSON.parse(await readFile(path.join(dataPath, 'state.json'), 'utf8'));
  expect(stored.notes[0].position).toMatchObject({ width: 360, height: 340, x: 80, y: 90 });
  expect(stored.notes[0].pinned).toBe(true);
  expect(stored.wallpapers).toHaveLength(1);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, backupPath);
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('button', { name: '恢复备份', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('便签与待办已恢复');
  await expect.poll(() => page.evaluate(() => window.wallnote.getDesktopStatus())).toMatchObject({ active: true, widgets: 1 });
  const restored = JSON.parse(await readFile(path.join(dataPath, 'state.json'), 'utf8'));
  expect(restored.notes[0]).toMatchObject({ content: '桌面与管理面板实时同步', pinned: false });
  expect(restored.wallpapers).toHaveLength(1);
  expect(errors).toEqual([]);
  const handlesAtExit = (await windows()).windows.filter(w => new URL(w.url).search).map(w => w.handle);
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  const closed = app.waitForEvent('close');
  await page.getByRole('button', { name: '退出 WallNote', exact: true }).click();
  await closed; app = undefined;
  for (const handle of handlesAtExit) expect((await native('inspect', handle)).exists).toBe(false);
  console.log(`Embedded desktop smoke passed: real WorkerW parents, all displays, desktop widgets, Show Desktop, tray lifetime, live wallpaper apply/import, pause/resume, persisted positions, clean exit. Profile: ${dataPath}`);
} catch (error) {
  if (app) {
    console.error('Desktop diagnostic:', await app.windows()[0]?.evaluate(() => window.wallnote?.getDesktopStatus()).catch(() => null));
    console.error('Shell tree:', JSON.stringify(await native('probe')));
  }
  throw error;
} finally {
  if (desktopToggled) await native('toggle-desktop');
  await app?.close();
  await server?.close();
}
