import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results', 'memory-lifecycle-'));
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_SHOW_MANAGER: '0' };
delete env.WALLNOTE_CREATE_MANAGER; delete env.VITE_DEV_SERVER_URL;
let app;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 60000 });
  const desktop = await app.firstWindow();
  await expect.poll(() => desktop.evaluate(() => window.wallnote?.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, widgets: 4 });
  const managerMatch = page => !new URL(page.url()).search;
  expect(app.windows().some(managerMatch)).toBe(false);
  expect(await app.evaluate(({ BrowserWindow }) => new Set(BrowserWindow.getAllWindows().map(window => window.webContents.mainFrame.processId)).size)).toBe(1);
  // Accelerate only the idle-management timeout in this isolated test process.
  await app.evaluate(() => { const original = globalThis.setTimeout; globalThis.setTimeout = (callback, delay, ...args) => original(callback, delay === 30000 ? 150 : delay, ...args); });
  const calendar = app.windows().find(page => new URL(page.url()).searchParams.get('widget') === 'calendar');
  await calendar.getByRole('button', { name: '打开手机同步：未连接' }).evaluate(button => button.click());
  await expect.poll(() => app.windows().some(managerMatch)).toBe(true);
  const manager = app.windows().find(managerMatch);
  await expect(manager.locator('#phone-sync')).toBeFocused();
  await manager.evaluate(async () => { window.wallnote.windowAction('close'); await window.wallnote.desktopControl('showManager'); });
  await new Promise(resolve => setTimeout(resolve, 320)); // past both the fade and the accelerated idle teardown
  expect(await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => !new URL(w.webContents.getURL()).search);
    return win?.isVisible() && win.getOpacity() > .99;
  })).toBe(true);
  await manager.locator('.sidebar-shortcuts').getByRole('button', { name: '新建便签', exact: true }).click();
  await manager.getByRole('textbox', { name: '便签内容', exact: true }).fill('未保存的测试草稿');
  await manager.evaluate(() => window.wallnote.windowAction('close'));
  await new Promise(resolve => setTimeout(resolve, 500));
  expect(app.windows().includes(manager)).toBe(true);
  await calendar.getByRole('button', { name: '打开手机同步：未连接' }).evaluate(button => button.click());
  await expect(manager.getByRole('textbox', { name: '便签内容', exact: true })).toHaveValue('未保存的测试草稿');
  await manager.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await manager.getByRole('button', { name: '放弃更改', exact: true }).click();
  await expect(manager.locator('#phone-sync')).toBeFocused();
  await manager.evaluate(() => window.wallnote.windowAction('close'));
  await expect.poll(() => app.windows().some(managerMatch)).toBe(false);
  expect((await desktop.evaluate(() => window.wallnote.getDesktopStatus())).widgets).toBe(4);
  console.log('Memory lifecycle passed: one shared desktop renderer, lazy management window, unsaved draft retention and idle-window release.');
} finally { await app?.close(); }
