import { _electron as electron, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const root = await mkdtemp(path.resolve('test-results', 'phone-integration-'));
const python = process.env.CALENDAR_PYTHON || 'C:/Python314/python.exe';
const bridge = path.resolve(process.env.CALENDAR_BRIDGE_ROOT || '../CalendarBridge');
const fixture = spawn(python, ['-u', path.join(bridge, 'tests/mock_service.py'), '--root', path.join(root, 'receiver')], { windowsHide: true, stdio: 'pipe' });
let output = '', startupError = '';
const messages = [];
fixture.stdout.setEncoding('utf8'); fixture.stderr.setEncoding('utf8');
fixture.stderr.on('data', text => { startupError += text; });
fixture.stdout.on('data', text => { output += text; const lines = output.split('\n'); output = lines.pop() || ''; for (const line of lines) { try { messages.push(JSON.parse(line)); } catch { /* Request logs contain no test protocol messages. */ } } });
async function command(op) { const start = messages.length; fixture.stdin.write(JSON.stringify({ op }) + '\n'); await expect.poll(() => messages.slice(start).some(message => message.done === op), { timeout: 10000 }).toBe(true); }
let app;
try {
  await expect.poll(() => messages.some(message => message.ready), { timeout: 15000 }).toBe(true);
  const ready = messages.find(message => message.ready);
  const directory = path.join(root, 'wallnote'); await mkdir(directory);
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ version: 1, notes: [], tasks: [], events: [], wallpapers: [], favorites: [], selectedWallpaperId: 'mist', appliedWallpaperId: null, settings: { alwaysOnTop: false, launchAtLogin: false, desktopEnabled: false, layoutVersion: 4 } }));
  const env = { ...process.env, WALLNOTE_DATA_DIR: directory, WALLNOTE_SHOW_MANAGER: '0', WALLNOTE_CREATE_MANAGER: '1' }; delete env.VITE_DEV_SERVER_URL;
  app = await electron.launch({ ...(process.argv.includes('--packaged') ? { executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [] } : { args: ['.'] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => { window.on('show', () => window.hide()); window.hide(); }));
  await expect.poll(() => page.evaluate(() => !!window.wallnote), { timeout: 15000 }).toBe(true);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, ready.profile);
  await page.evaluate(() => window.wallnote.phoneSyncControl('connect'));
  await expect.poll(() => page.evaluate(() => window.wallnote.getState().then(state => state.phoneSync))).toMatchObject({ connected: true, device: 'Mock Android' });
  let state = await page.evaluate(() => window.wallnote.getState());
  expect(state.phoneEvents).toHaveLength(1);
  const profile = JSON.parse(await readFile(ready.profile, 'utf8'));
  expect(JSON.stringify(state)).not.toContain(profile.adminToken);
  await page.evaluate(() => window.wallnote.phoneSyncControl('calendar', '1'));
  const day = state.phoneEvents[0].date;
  await page.evaluate(async date => {
    await window.wallnote.dispatch({ type: 'event:add', event: { id: 'sync-test-local', title: '模拟电脑日程', date, start: '12:00', end: '13:00', description: '仅模拟数据', color: 'mint' } });
    await window.wallnote.sendEventToPhone('sync-test-local');
    await window.wallnote.sendEventToPhone('sync-test-local');
  }, day);
  state = await page.evaluate(() => window.wallnote.getState());
  expect(state.phoneSync.items['sync-test-local'].state).toBe('queued');
  await command('apply');
  await page.evaluate(() => window.wallnote.phoneSyncControl('refresh'));
  state = await page.evaluate(() => window.wallnote.getState());
  expect(state.phoneSync.items['sync-test-local'].state).toBe('synced');
  expect(state.phoneEvents).toHaveLength(1);
  const original = state.phoneEvents[0];
  await page.evaluate(event => window.wallnote.dispatch({ type: 'event:update', id: event.id, expectedRevision: event.phone.revision, changes: { title: '模拟电脑修改手机日程' } }), original);
  expect((await page.evaluate(() => window.wallnote.getState())).phoneEvents[0].title).toBe('模拟手机日程');
  await command('apply'); await page.evaluate(() => window.wallnote.phoneSyncControl('refresh'));
  state = await page.evaluate(() => window.wallnote.getState());
  expect(state.phoneEvents[0].title).toBe('模拟电脑修改手机日程');
  const oldRevision = state.phoneEvents[0].phone.revision;
  await command('edit-phone');
  const conflict = await page.evaluate(async ({ id, revision }) => { try { await window.wallnote.dispatch({ type: 'event:update', id, expectedRevision: revision, changes: { title: '不应覆盖' } }); return false; } catch { return true; } }, { id: original.id, revision: oldRevision });
  expect(conflict).toBe(true);
  await page.evaluate(async date => { await window.wallnote.dispatch({ type: 'event:add', event: { id: 'sync-uncertain-local', title: '模拟不确定状态', date, start: '15:00', end: '16:00', description: '', color: 'mint' } }); await window.wallnote.sendEventToPhone('sync-uncertain-local'); }, day);
  await command('uncertain'); await page.evaluate(() => window.wallnote.phoneSyncControl('refresh'));
  expect((await page.evaluate(() => window.wallnote.getState())).phoneSync.items['sync-uncertain-local'].state).toBe('uncertain');
  expect(await page.evaluate(async () => { try { await window.wallnote.sendEventToPhone('sync-uncertain-local'); return false; } catch { return true; } })).toBe(true);
  console.log('Phone integration passed: pinned HTTPS, separate admin profile, phone import, create/update queue, acknowledgement + snapshot confirmation, stale-edit rejection and uncertain-write protection. Mock data only.');
} catch (error) { if (startupError) console.error(startupError); throw error; }
finally { await app?.close(); fixture.stdin.end(); await new Promise(resolve => { fixture.once('exit', resolve); setTimeout(() => { fixture.kill(); resolve(); }, 3000).unref(); }); }
