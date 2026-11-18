import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createInitialState, isValidState, reduceState } from '../shared/state';
import { createEvent } from '../shared/calendar';
import { PhoneSyncController } from '../electron/phone-sync';
import { phoneEvents, revision, type PhoneSnapshot, type ProviderRow } from '../electron/phone-adapter';
import { parsePhoneProfile, type PhoneProfile } from '../electron/phone-client';
import { emptyPhoneSync, phoneCalendarLabel, phoneConnection } from '../shared/phone';

const controllers: PhoneSyncController[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map(controller => controller.stop()));
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

function sample(): PhoneSnapshot {
  const start = Date.parse('2028-02-29T09:00:00+08:00');
  return { schemaVersion: 1, clientId: 'mock-phone', receivedAt: new Date(Date.now() - 10000).toISOString(), rangeStartMs: start - 30 * 86400000, rangeEndMs: start + 180 * 86400000,
    calendars: [{ _id: 1, calendar_displayName: '模拟日历', calendar_access_level: 700, visible: 1 }],
    events: [{ _id: 2, calendar_id: 1, title: '手机日程', dtstart: start, dtend: start + 3600000, allDay: 0, eventTimezone: 'Asia/Shanghai', description: '', deleted: 0 }],
    instances: [{ event_id: 2, calendar_id: 1, title: '手机日程', begin: start, end: start + 3600000, allDay: 0 }], reminders: [] };
}

async function fixture() {
  await fs.mkdir(path.resolve('test-results'), { recursive: true });
  const directory = await fs.mkdtemp(path.resolve('test-results', 'phone-store-'));
  directories.push(directory);
  let state = createInitialState();
  const snapshot = sample();
  const commands = new Map<string, { id: string; state: string; created: number; result?: { eventId: number; message: string }; request: ProviderRow }>();
  let submits = 0;
  const profile: PhoneProfile = { schemaVersion: 1, type: 'calendarbridge-desktop', baseUrl: 'https://127.0.0.1:1', adminToken: 'test-only-' + 'a'.repeat(40), certificatePem: 'mock transport only; not a TLS certificate', certificateSha256: 'a'.repeat(64) };
  const request = async (_profile: PhoneProfile, route: string, body?: unknown): Promise<Record<string, unknown>> => {
    if (route === '/desktop/state') return { ok: true, snapshot: structuredClone(snapshot), commands: structuredClone([...commands.values()]), device: { clientId: snapshot.clientId, device: 'Mock Android', canWrite: true, lastSeen: Date.now() / 1000 } };
    if (route.startsWith('/desktop/command/')) return { ok: true, command: structuredClone(commands.get(route.slice('/desktop/command/'.length)) ?? null) };
    if (route === '/desktop/commands') {
      const value = body as ProviderRow; submits += 1;
      if (!commands.has(String(value.id))) commands.set(String(value.id), { id: String(value.id), state: 'queued', created: Date.now() / 1000, request: structuredClone(value) });
      return { ok: true, id: value.id };
    }
    throw new Error('Unexpected route');
  };
  const makeController = () => {
    const controller = new PhoneSyncController(directory, () => state, async transform => { const next = transform(state); expect(isValidState(next)).toBe(true); state = next; }, request);
    controllers.push(controller); return controller;
  };
  const controller = makeController(); await controller.start(); await controller.connect(profile); await controller.chooseCalendar('1');
  const local = { ...createEvent('2028-02-29', 12), title: '本地日程' };
  state = reduceState(state, { type: 'event:add', event: local });
  function confirm(command: ReturnType<typeof commands.get>, includeSnapshot = true) {
    if (!command) throw new Error('Missing command');
    const id = command.request.action === 'create' ? 99 : Number(command.request.eventId);
    command.state = 'succeeded'; command.result = { eventId: id, message: '完成' };
    if (!includeSnapshot) return;
    let row = snapshot.events.find(item => item._id === id);
    if (!row) { row = { _id: id, calendar_id: 1, deleted: 0 }; snapshot.events.push(row); }
    Object.assign(row, command.request.changes);
    snapshot.instances = snapshot.events.map(item => ({ event_id: item._id, calendar_id: item.calendar_id, title: item.title, begin: item.dtstart, end: item.dtend, allDay: item.allDay }));
    snapshot.receivedAt = new Date(Date.now() + 100).toISOString();
  }
  return { controller, local, snapshot, commands, confirm, profile, makeController, state: () => state, dispatch: (action: Parameters<typeof reduceState>[1]) => { state = reduceState(state, action); }, submits: () => submits };
}

describe('Android calendar adapter', () => {
  it('distinguishes a running receiver from a live phone, including a stale heartbeat on connection loss', () => {
    const idle = emptyPhoneSync();
    const ready = { ...idle, configured: true, connected: true };
    const known = { ...ready, device: 'Mock Android' };
    expect([idle, ready, known, { ...known, phoneOnline: true }].map(v => phoneConnection(v).label)).toEqual(['未连接', '等待手机', '手机离线', '手机在线']);
    expect(phoneConnection({ ...known, connected: false, phoneOnline: true }).tone).not.toBe('online');
    expect(phoneConnection({ ...known, error: '连接失败', phoneOnline: true }).tone).toBe('error');
    expect(['Local account', ' LOCAL_ACCOUNT ', '本地账户', '家庭日历'].map(phoneCalendarLabel)).toEqual(['手机同步', '手机同步', '手机同步', '家庭日历']);
  });
  it('uses Beijing times and marks complex or null-permission events read-only', () => {
    const snapshot = sample();
    expect(phoneEvents(snapshot)[0]).toMatchObject({ date: '2028-02-29', start: '09:00', end: '10:00', phone: { readOnly: false } });
    snapshot.calendars[0].calendar_access_level = null;
    expect(phoneEvents(snapshot)[0].phone?.readOnly).toBe(true);
    snapshot.calendars[0].calendar_access_level = 700;
    snapshot.events[0].rrule = 'FREQ=WEEKLY';
    expect(phoneEvents(snapshot)[0].phone?.readOnly).toBe(true);
    const start = Date.parse('2028-02-29T00:00:00Z');
    snapshot.events[0].allDay = 1; snapshot.instances = [{ event_id: 2, begin: start, end: start + 2 * 86400000, allDay: 1 }];
    const events = phoneEvents(snapshot);
    expect(events.map(event => event.date)).toEqual(['2028-02-29', '2028-03-01']);
    expect(events[0]).toMatchObject({ start: '00:00', end: '24:00', phone: { readOnly: true } });
    expect(isValidState({ ...createInitialState(), phoneEvents: events })).toBe(true);
  });

  it('rejects phone pairing profiles and non-loopback desktop profiles', () => {
    expect(() => parsePhoneProfile(JSON.stringify({ schemaVersion: 1, type: 'calendarbridge-phone' }))).toThrow('wallnote-connection');
    expect(() => parsePhoneProfile(JSON.stringify({ schemaVersion: 1, type: 'calendarbridge-desktop', baseUrl: 'https://192.168.1.10', adminToken: 'x'.repeat(43), certificatePem: 'not a certificate', certificateSha256: 'a'.repeat(64) }))).toThrow('127.0.0.1');
  });
});

describe('phone operation journal', () => {
  it('deduplicates sends and waits for both the acknowledgement and a fresh snapshot', async () => {
    const f = await fixture();
    await f.controller.sendLocal(f.local.id);
    await f.controller.sendLocal(f.local.id);
    expect(f.submits()).toBe(1);
    expect(f.state().phoneSync?.items[f.local.id].state).toBe('queued');
    const command = [...f.commands.values()][0];
    f.confirm(command, false); await f.controller.refresh();
    expect(f.state().phoneSync?.items[f.local.id].state).toBe('delivered');
    f.confirm(command, true); await f.controller.refresh();
    expect(f.state().phoneSync?.items[f.local.id].state).toBe('synced');
    expect(f.state().phoneSync?.pending).toBe(0);
    expect(f.state().phoneEvents).toHaveLength(1); // The exported local event is not duplicated.
    expect(JSON.stringify(f.state())).not.toContain(f.profile.adminToken);
  });

  it('imports phone-only changes and detects concurrent edits without overwriting local data', async () => {
    const f = await fixture(); await f.controller.sendLocal(f.local.id); f.confirm([...f.commands.values()][0]); await f.controller.refresh();
    const remote = f.snapshot.events.find(row => row._id === 99)!;
    remote.title = '手机修改'; f.snapshot.receivedAt = new Date(Date.now() + 100).toISOString();
    await f.controller.refresh();
    expect(f.state().events?.find(event => event.id === f.local.id)?.title).toBe('手机修改');
    const before = revision(remote);
    f.dispatch({ type: 'event:update', id: f.local.id, changes: { title: '本地修改' } });
    remote.title = '手机再次修改'; await f.controller.refresh();
    expect(f.state().phoneSync?.items[f.local.id].state).toBe('conflict');
    expect(f.state().events?.find(event => event.id === f.local.id)?.title).toBe('本地修改');
    await expect(f.controller.sendLocal(f.local.id, before)).rejects.toThrow('重新打开');
    expect(f.submits()).toBe(1);
  });

  it('never retries an uncertain write, including after reconnecting', async () => {
    const f = await fixture(); await f.controller.sendLocal(f.local.id);
    [...f.commands.values()][0].state = 'uncertain';
    await f.controller.refresh(); await f.controller.refresh();
    await expect(f.controller.sendLocal(f.local.id)).rejects.toThrow('不能重发');
    expect(f.submits()).toBe(1);
    await f.controller.disconnect(); await f.controller.stop();
    const restarted = f.makeController(); await restarted.start(); await restarted.connect(f.profile);
    await expect(restarted.sendLocal(f.local.id)).rejects.toThrow('不能重发');
    expect(f.submits()).toBe(1);
  });

  it('does not simplify a linked phone event after it becomes a recurring series', async () => {
    const f = await fixture(); await f.controller.sendLocal(f.local.id); f.confirm([...f.commands.values()][0]); await f.controller.refresh();
    const remote = f.snapshot.events.find(row => row._id === 99)!;
    remote.rrule = 'FREQ=WEEKLY'; await f.controller.refresh();
    expect(f.state().phoneSync?.items[f.local.id].state).toBe('conflict');
    expect(f.state().phoneEvents?.some(event => event.phone?.eventId === '99' && event.phone.readOnly)).toBe(true);
    await expect(f.controller.sendLocal(f.local.id, revision(remote))).rejects.toThrow('复杂时间');
    expect(f.submits()).toBe(1);
  });

  it('submits a phone edit with the original revision and keeps the displayed record until confirmed', async () => {
    const f = await fixture();
    const event = f.state().phoneEvents![0];
    await expect(f.controller.updatePhone(event.id, { title: '修改' }, '0'.repeat(64))).rejects.toThrow('已更新');
    await f.controller.updatePhone(event.id, { title: '修改标题' }, event.phone!.revision);
    expect(f.state().phoneEvents![0].title).toBe('手机日程');
    const command = [...f.commands.values()][0];
    expect((command.request.expected as ProviderRow).title).toBe('手机日程');
    f.confirm(command); await f.controller.refresh();
    expect(f.state().phoneEvents![0].title).toBe('修改标题');
    expect(f.state().phoneSync?.items[event.id].state).toBe('synced');
  });
});
