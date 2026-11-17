import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const profile = await mkdtemp(path.resolve('test-results', 'layer-profile-'));
const packaged = process.argv.includes('--packaged');
const helper = path.resolve(packaged ? 'release/win-unpacked/resources/native/WallNote.DesktopHost.exe' : 'dist-native/WallNote.DesktopHost.exe');
const execute = promisify(execFile);
async function native(...args) { const result = await execute(helper, args.map(String), { windowsHide: true }); return JSON.parse(result.stdout.replace(/^\uFEFF/, '')); }
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_SHOW_MANAGER: '0' };
delete env.VITE_DEV_SERVER_URL;
let app;
try {
  app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [] } : { args: ['.'] }), env, timeout: 60000 });
  await app.firstWindow();
  const managerMatch = page => /^(file|http):/.test(page.url()) && !new URL(page.url()).search;
  await expect.poll(() => app.windows().some(managerMatch), { timeout: 20000 }).toBe(true);
  const manager = app.windows().find(managerMatch);
  await expect.poll(() => manager.evaluate(() => window.wallnote?.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, widgets: 4, error: null });
  const metadata = await app.evaluate(({ BrowserWindow, screen }) => ({
    pid: process.pid,
    displays: screen.getAllDisplays(),
    primary: screen.getPrimaryDisplay(),
    windows: BrowserWindow.getAllWindows().map(win => ({ handle: win.getNativeWindowHandle().readBigUInt64LE().toString(), query: new URL(win.webContents.getURL()).search, transparent: win.getBackgroundColor() })),
  }));
  const byKind = kind => metadata.windows.find(win => new URLSearchParams(win.query).get('widget') === kind);
  const widgets = ['schedule', 'calendar', 'tasks', 'notes-empty'];
  const bounds = {};
  for (const kind of widgets) {
    const win = byKind(kind);
    const item = (await native('inspect', win.handle)).window;
    expect(item).toMatchObject({ child: true, topmost: false, visible: true });
    expect((await native('inspect', item.parent)).window.className).toBe('WorkerW');
    expect(win.transparent).toMatch(/^#000000/); // Electron's getter omits alpha on Windows.
    bounds[kind] = item.bounds;
  }
  expect(bounds.schedule.y).toBe(bounds.calendar.y);
  expect(bounds.calendar.y).toBe(bounds.tasks.y);
  expect(bounds.schedule.height).toBe(bounds.calendar.height);
  expect(bounds.tasks.x).toBe(bounds['notes-empty'].x);
  expect(bounds.tasks.width).toBe(bounds['notes-empty'].width);
  expect(bounds['notes-empty'].y + bounds['notes-empty'].height).toBe(bounds.calendar.y + bounds.calendar.height);
  expect(bounds.calendar.x - bounds.schedule.x - bounds.schedule.width).toBe(bounds.tasks.x - bounds.calendar.x - bounds.calendar.width);

  const calendar = app.windows().find(page => new URL(page.url()).searchParams.get('widget') === 'calendar');
  const schedule = app.windows().find(page => new URL(page.url()).searchParams.get('widget') === 'schedule');
  await expect(calendar.locator('.frost-panel')).toHaveCSS('border-radius', '20px');
  expect(await schedule.locator('.hourly-list').evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('auto');
  expect(await schedule.locator('.hourly-list').evaluate(el => getComputedStyle(el, '::-webkit-scrollbar-button').display)).toBe('none');
  const corner = await sharp(await calendar.screenshot({ omitBackground: true })).extract({ left: 0, top: 0, width: 24, height: 24 }).ensureAlpha().raw().toBuffer();
  expect([...corner].filter((value, index) => index % 4 === 3 && value > 0 && value < 255).length).toBeGreaterThan(5);

  // Move the test widget outside the visible work area before testing global topmost behavior.
  const p = metadata.primary;
  const offscreen = await app.evaluate(({ screen }, area) => screen.dipToScreenRect(null, area), { x: p.bounds.x + p.bounds.width + 100, y: p.bounds.y + 70, width: 330, height: 550 });
  await native('position', byKind('calendar').handle, metadata.pid, offscreen.x, offscreen.y, offscreen.width, offscreen.height);
  await expect.poll(() => calendar.evaluate(() => window.wallnote.getDesktopSurface())).toMatchObject({ bounds: { width: 330, height: 550 } });
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'widget:topmost', key: 'calendar', enabled: true }));
  expect((await native('inspect', byKind('calendar').handle)).window).toMatchObject({ parent: '0', child: false, topmost: true });
  await expect(calendar.getByRole('button', { name: '置顶日历', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const compact = await calendar.evaluate(() => {
    const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
    return { width: innerWidth, height: innerHeight, grid: box('.calendar-grid'), heading: box('.selected-day-heading'), agenda: box('.calendar-agenda'), toolbar: box('.calendar-toolbar') };
  });
  expect(compact.grid.right).toBeLessThanOrEqual(compact.width);
  expect(compact.toolbar.right).toBeLessThanOrEqual(compact.width);
  expect(compact.grid.bottom).toBeLessThanOrEqual(compact.heading.top + 1);
  expect(compact.agenda.height).toBeGreaterThanOrEqual(65);
  expect(compact.agenda.bottom).toBeLessThanOrEqual(compact.height);
  await calendar.screenshot({ path: 'test-results/calendar-compact.png', omitBackground: true });

  const secondary = metadata.displays.find(display => display.id !== p.id);
  if (secondary) {
    const target = await app.evaluate(({ screen }, area) => screen.dipToScreenRect(null, area), { x: secondary.bounds.x - 400, y: secondary.bounds.y + 70, width: 330, height: 550 });
    await native('position', byKind('calendar').handle, metadata.pid, target.x, target.y, target.width, target.height);
    await expect.poll(() => calendar.evaluate(() => window.devicePixelRatio), { timeout: 10000 }).toBeCloseTo(secondary.scaleFactor, 1);
    await expect.poll(() => calendar.evaluate(() => Math.abs(innerWidth - 330)), { timeout: 10000 }).toBeLessThanOrEqual(2);
    expect(await schedule.evaluate(() => window.devicePixelRatio)).toBeCloseTo(p.scaleFactor, 1);
  }
  await manager.evaluate(() => window.wallnote.dispatch({ type: 'widget:topmost', key: 'calendar', enabled: false }));
  const restored = (await native('inspect', byKind('calendar').handle)).window;
  expect(restored).toMatchObject({ child: true, topmost: false, bounds: bounds.calendar });
  expect((await native('inspect', restored.parent)).window.className).toBe('WorkerW');
  await expect.poll(() => calendar.evaluate(() => window.devicePixelRatio)).toBeCloseTo(p.scaleFactor, 1);
  expect((await manager.evaluate(() => window.wallnote.getDesktopStatus())).error).toBeNull();
  console.log(`Layer/size smoke passed: below-icon parents, explicit topmost, smooth alpha corners, aligned columns, compact calendar, custom scrollbar and mixed-DPI normalization. Profile: ${profile}`);
} catch (error) {
  if (app) {
    console.error(await app.windows().find(page => !new URL(page.url()).search)?.evaluate(() => window.wallnote.getDesktopStatus()).catch(() => null));
    const calendar = app.windows().find(page => new URL(page.url()).searchParams.get('widget') === 'calendar');
    if (calendar) console.error('DPI diagnostic', await calendar.evaluate(async () => ({ dpr: devicePixelRatio, width: innerWidth, height: innerHeight, surface: await window.wallnote.getDesktopSurface() })).catch(() => null));
  }
  throw error;
} finally { await app?.close(); }
