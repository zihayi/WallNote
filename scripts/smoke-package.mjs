import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

// Packaged startup/IPC check. No Show Desktop, system keyboard input or mouse movement.
configureEnvironment();
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results', 'package-profile-'));
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_SHOW_MANAGER: '0', WALLNOTE_CREATE_MANAGER: '1' };
delete env.VITE_DEV_SERVER_URL;
let app;
try {
  app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [], env, timeout: 60000 });
  await app.firstWindow();
  const isManager = page => /^file:/.test(page.url()) && !new URL(page.url()).search;
  await expect.poll(() => app.windows().some(isManager), { timeout: 20000 }).toBe(true);
  const manager = app.windows().find(isManager);
  await expect.poll(() => manager.evaluate(() => window.wallnote?.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, widgets: 4, error: null });
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  expect(await manager.evaluate(() => window.wallnote.getInfo())).toMatchObject({ version, desktop: true });
  const calendar = app.windows().find(page => new URL(page.url()).searchParams.get('widget') === 'calendar');
  await expect(calendar.locator('.calendar-grid > button')).toHaveCount(42);
  await expect(calendar.locator('.frost-panel')).toHaveCSS('border-radius', '20px');
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'event:add', event: { id: 'package-check', title: '打包验证', date: '2028-02-29', start: '09:00', end: '10:00', description: '', color: 'mint' } }));
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'calendar:select', date: '2028-02-29' }));
  await expect(calendar.getByRole('button', { name: '编辑日程：打包验证', exact: true })).toBeVisible();
  const schedule = app.windows().find(page => new URL(page.url()).searchParams.get('widget') === 'schedule');
  await expect(schedule.getByRole('button', { name: '编辑日程：打包验证', exact: true })).toBeVisible();
  console.log(`Packaged v${version} passed: desktop input bridge, four widgets, calendar/schedule synchronization and glass styling.`);
} finally { await app?.close(); }
