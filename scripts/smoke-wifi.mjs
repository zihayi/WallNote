import { _electron as electron, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import https from 'node:https';
import net from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const directory = await mkdtemp(path.resolve('test-results', 'wifi-integration-'));
await writeFile(path.join(directory, 'state.json'), JSON.stringify({ version: 1, notes: [], tasks: [], events: [], wallpapers: [], favorites: [], selectedWallpaperId: 'mist', appliedWallpaperId: null, settings: { alwaysOnTop: false, launchAtLogin: false, desktopEnabled: false, layoutVersion: 4 } }));
const env = { ...process.env, WALLNOTE_DATA_DIR: directory, WALLNOTE_SHOW_MANAGER: '0', WALLNOTE_CREATE_MANAGER: '1', WALLNOTE_ENABLE_WIFI_RECEIVER: '1', WALLNOTE_WIFI_TEST_LOOPBACK: '1' };
delete env.VITE_DEV_SERVER_URL;
let app, page, profile;
async function launch() {
  const binary = process.env.WALLNOTE_TEST_INSTALLED_EXE || (process.argv.includes('--packaged') ? path.resolve('release/win-unpacked/WallNote.exe') : '');
  app = await electron.launch({ ...(binary ? { executablePath: binary, args: [] } : { args: ['.'] }), env, timeout: 60000 });
  page = await app.firstWindow();
  await page.evaluate(() => window.wallnote.desktopControl('showManager'));
  await expect.poll(() => page.evaluate(() => window.wallnote?.getState().then(state => state.phoneSync?.connected)), { timeout: 60000 }).toBe(true);
  profile = JSON.parse(await readFile(path.join(directory, 'wifi-receiver/state/wallnote-connection.json'), 'utf8'));
}
async function request(route, body, token) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = https.request(new URL(route, profile.baseUrl), { method: encoded ? 'POST' : 'GET', ca: profile.certificatePem, rejectUnauthorized: true, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(encoded ? { 'Content-Length': encoded.length, 'Content-Type': 'application/json' } : {}) } }, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', part => { text += part; }); response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(text) }); } catch (error) { reject(error); } }); response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Fixture request timeout'))); req.on('error', reject); req.end(encoded);
  });
}
async function discover() {
  const status = await page.evaluate(() => window.wallnote.wifiReceiverControl('status'));
  expect(status).toMatchObject({ running: true, discoveryAvailable: true });
  const socket = dgram.createSocket('udp4'), nonce = randomBytes(16).toString('hex');
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Discovery timeout')), 4000);
      socket.once('error', error => { clearTimeout(timer); reject(error); });
      socket.once('message', packet => { clearTimeout(timer); try { const reply = JSON.parse(packet.toString()); expect(reply.nonce).toBe(nonce); expect(reply.certificateSha256).toBe(profile.certificateSha256); resolve(reply); } catch (error) { reject(error); } });
      socket.send(Buffer.from(JSON.stringify({ type: 'calendarbridge-discover', version: 1, nonce })), status.discoveryPort, '127.0.0.1');
    });
  } finally { socket.close(); }
}
async function listening(port) {
  return new Promise(resolve => { const socket = net.connect({ host: '127.0.0.1', port }); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); });
}
try {
  await launch();
  expect((await discover()).pairing).toBe(false);
  expect((await request('/desktop/pairing/open', {})).status).toBe(401);
  await page.locator('.topbar').getByRole('button', { name: '打开手机同步：等待手机' }).click();
  await expect(page.locator('#phone-sync')).toBeFocused();
  await page.getByRole('button', { name: '配对手机', exact: true }).evaluate(button => button.click());
  await expect.poll(async () => (await discover()).pairing).toBe(true);
  const secret = randomBytes(32).toString('hex');
  const challenge = await request('/pair/begin', { clientId: 'mock-wifi-phone', device: 'Mock Wi-Fi Android', commitment: createHash('sha256').update(secret).digest('hex') });
  expect(challenge.status).toBe(200);
  const proof = { id: challenge.data.id, secret };
  expect((await request('/pair/reveal', proof)).data.state).toBe('waiting');
  expect((await request('/pair/finish', proof)).data.token).toBeUndefined();
  const transcript = ['CalendarBridge-pair-v1', proof.id, profile.certificateSha256, challenge.data.nonce, secret].join('\0');
  const code = String(createHash('sha256').update(transcript).digest().readUInt32BE(0) % 1000000).padStart(6, '0');
  await expect(page.locator('.phone-pair-code')).toHaveText(code, { timeout: 10000 });
  await page.getByRole('button', { name: '验证码一致，允许配对', exact: true }).evaluate(button => button.click());
  await expect.poll(async () => (await request('/pair/finish', proof)).data.state).toBe('approved');
  const phone = (await request('/pair/finish', proof)).data;
  expect(phone.adminToken).toBeUndefined();
  const now = Date.now();
  const day = new Date(now + 8 * 3600000).toISOString().slice(0, 10), start = Date.parse(`${day}T09:00:00+08:00`), end = start + 3600000;
  const snapshot = { schemaVersion: 1, clientId: 'mock-wifi-phone', device: 'Mock Wi-Fi Android', appVersion: 5, canWrite: false, rangeStartMs: now - 86400000, rangeEndMs: now + 86400000, calendars: [{ _id: 1, calendar_displayName: 'Local account', calendar_access_level: 700, visible: 1 }], events: [{ _id: 2, calendar_id: 1, title: '模拟手机安排', dtstart: start, dtend: end, allDay: 0, deleted: 0 }], instances: [{ event_id: 2, begin: start, end, allDay: 0 }], reminders: [] };
  expect((await request('/api/sync', snapshot, phone.token)).status).toBe(200);
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.locator('.topbar .phone-sync-entry')).toContainText('手机在线');
  await expect(page.locator('select[aria-label="手机写入日历"] option[value="1"]')).toHaveText('手机同步');
  const state = await page.evaluate(() => window.wallnote.getState());
  expect(state.phoneSync).toMatchObject({ connected: true, phoneOnline: true, canWrite: false, device: 'Mock Wi-Fi Android' });
  expect(JSON.stringify(state)).not.toContain(phone.token);
  expect(JSON.stringify(state)).not.toContain(profile.adminToken);
  await page.evaluate(date => window.wallnote.dispatch({ type: 'calendar:select', date }), day);
  await page.getByRole('navigation').getByRole('button', { name: '日历与日程' }).click();
  await expect(page.locator('.calendar-panel .event-source-line')).toHaveText('手机同步');
  await page.locator('.calendar-panel').getByRole('button', { name: '编辑日程：模拟手机安排' }).click();
  await expect(page.locator('.event-phone-info')).toContainText('手机同步 · 北京时间');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  snapshot.events[0].rrule = 'FREQ=DAILY'; // Same mock event becomes a read-only series.
  expect((await request('/api/sync', snapshot, phone.token)).status).toBe(200);
  await page.evaluate(() => window.wallnote.phoneSyncControl('refresh'));
  await page.locator('.calendar-panel').getByRole('button', { name: '查看日程：模拟手机安排' }).click();
  await expect(page.getByRole('dialog', { name: '查看手机日程' }).getByLabel('日程标题')).toBeDisabled();
  await expect(page.getByLabel('日程备注', { exact: true })).toBeDisabled();
  const oldPort = Number(new URL(profile.baseUrl).port), fingerprint = profile.certificateSha256;
  await app.close(); app = undefined;
  await expect.poll(() => listening(oldPort), { timeout: 10000 }).toBe(false);
  await launch();
  expect(profile.certificateSha256).toBe(fingerprint);
  expect((await discover()).pairing).toBe(false);
  expect((await request('/api/health', undefined, phone.token)).status).toBe(200);
  expect((await page.evaluate(() => window.wallnote.getState())).phoneSync.device).toBe('Mock Wi-Fi Android');
  console.log('Wi-Fi integration passed: automatic managed service, UDP discovery, matching verification codes, explicit approval, read-only sync, retained identity across restart, and receiver shutdown. Loopback mock data only.');
} finally { await app?.close(); }
