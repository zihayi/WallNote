import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState, PhoneSyncItem, PhoneSyncView, ScheduleEvent } from '../shared/types';
import { emptyPhoneSync } from '../shared/phone';
import { eventError } from '../shared/calendar';
import { expectedFields, localRevision, phoneCalendars, phoneEvents, providerChanges, revision, rowId, snapshotFrom, type PhoneSnapshot, type ProviderRow } from './phone-adapter';
import { parsePhoneProfile, phoneRequest, PhoneRequestError, type PhoneProfile } from './phone-client';

interface Binding { phoneId: string; clientId: string; localHash: string; phoneHash: string }
interface Job {
  id: string; eventKey: string; clientId: string; localHash?: string; request: ProviderRow;
  state: 'prepared' | 'queued' | 'delivered' | 'synced' | 'failed' | 'uncertain'; message: string;
}
interface PrivateData { version: 1; profile: PhoneProfile | null; identity: string; calendarId: string | null; bindings: Record<string, Binding>; jobs: Job[] }
interface RemoteCommand { id: string; state: string; created: number; result?: { eventId?: number | string; message?: string } | null }
type Transport = typeof phoneRequest;
const unresolved = (job: Job) => ['prepared', 'queued', 'delivered'].includes(job.state);

export class PhoneSyncController {
  private data: PrivateData = { version: 1, profile: null, identity: '', calendarId: null, bindings: {}, jobs: [] };
  private snapshot: PhoneSnapshot | null = null;
  private remote: Record<string, unknown> = {};
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private polling = false;
  private loadError = '';
  private connected = false;
  private failure: string | null = null;
  private readonly file: string;

  constructor(directory: string, private getState: () => AppState, private update: (transform: (state: AppState) => AppState) => Promise<void>, private request: Transport = phoneRequest) { this.file = path.join(directory, 'phone-connection.json'); }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result; }
  getStatus(): PhoneSyncView { return this.getState().phoneSync ?? emptyPhoneSync(); }
  isPhoneEvent(id: string): boolean { return (this.getState().phoneEvents ?? []).some(event => event.id === id); }
  isLinked(id: string): boolean {
    const binding = this.data.bindings[id];
    const bound = !!binding && (!this.connected || !this.snapshot || this.snapshot.clientId !== binding.clientId || !!this.rawEvent(binding.phoneId));
    return bound || this.data.jobs.some(job => job.eventKey === id && (unresolved(job) || job.state === 'uncertain'));
  }

  async start() {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as PrivateData;
      if (raw.version !== 1 || !Array.isArray(raw.jobs) || !raw.bindings || typeof raw.bindings !== 'object' || typeof raw.identity !== 'string' || raw.jobs.some(job => !/^[0-9a-f-]{36}$/i.test(job.id) || job.request?.id !== job.id || !['prepared', 'queued', 'delivered', 'synced', 'failed', 'uncertain'].includes(job.state))) throw new Error('invalid');
      if (raw.profile) raw.profile = parsePhoneProfile(JSON.stringify(raw.profile));
      this.data = raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.loadError = '手机同步配置或操作记录无法读取，请先备份并检查 phone-connection.json。';
    }
    this.failure = this.loadError || null;
    await this.publish();
    this.timer = setInterval(() => { if (this.data.profile && !this.polling && !this.stopped) void this.refresh().catch(() => undefined); }, 5000);
    if (this.data.profile && !this.loadError) void this.refresh().catch(() => undefined);
  }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); await this.queue; }
  private async save() {
    const temporary = `${this.file}.tmp`;
    const handle = await fs.open(temporary, 'w');
    try { await handle.writeFile(JSON.stringify(this.data, null, 2), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, this.file);
  }
  private profile(): PhoneProfile { if (!this.data.profile) throw new Error('请先连接手机日历接收服务。'); return this.data.profile; }

  connect(profile: PhoneProfile): Promise<PhoneSyncView> {
    return this.serial(async () => {
      if (this.loadError) throw new Error(this.loadError);
      if (this.data.identity && this.data.identity !== profile.certificateSha256) {
        if (this.data.jobs.some(job => unresolved(job) || job.state === 'uncertain')) throw new Error('存在待确认的手机操作，请先核对结果再更换接收服务。');
        this.data.bindings = {}; this.data.jobs = []; this.data.calendarId = null;
      }
      this.data.profile = profile; this.data.identity = profile.certificateSha256;
      this.snapshot = null; this.remote = {}; this.connected = false; this.failure = null;
      await this.save();
      await this.poll();
      return this.getStatus();
    });
  }
  disconnect(): Promise<PhoneSyncView> {
    return this.serial(async () => {
      if (this.data.jobs.some(unresolved)) throw new Error('有待手机确认的操作，请确认完成后再断开。');
      this.data.profile = null; this.connected = false; this.snapshot = null; this.remote = {}; this.failure = null;
      await this.save(); await this.publish(); return this.getStatus();
    });
  }
  chooseCalendar(id: string): Promise<PhoneSyncView> {
    return this.serial(async () => {
      if (!phoneCalendars(this.snapshot).some(calendar => calendar.id === id && calendar.writable)) throw new Error('请选择手机中的可写日历。');
      this.data.calendarId = id; await this.save(); await this.publish(); return this.getStatus();
    });
  }
  refresh(): Promise<PhoneSyncView> {
    return this.serial(async () => { await this.poll(); return this.getStatus(); });
  }
  private async fetchState() {
    const response = await this.request(this.profile(), '/desktop/state');
    this.snapshot = snapshotFrom(response.snapshot);
    if (!Array.isArray(response.commands)) throw new Error('接收服务的操作队列格式无效。');
    this.remote = response; this.connected = true; this.failure = null;
  }
  private rawEvent(id: string): ProviderRow | undefined { return this.snapshot?.events.find(row => rowId(row._id) === id); }
  private pendingFor(key: string): Job | undefined { return this.data.jobs.find(job => job.eventKey === key && (unresolved(job) || job.state === 'uncertain')); }

  private async poll() {
    if (!this.data.profile || this.loadError || this.stopped) { await this.publish(); return; }
    this.polling = true;
    try {
      await this.fetchState();
      const commands = this.remote.commands as RemoteCommand[];
      for (const job of this.data.jobs.filter(unresolved)) {
        if (this.snapshot && job.clientId !== this.snapshot.clientId) { job.state = 'uncertain'; job.message = '手机标识已改变，请先核对之前的操作。'; continue; }
        let command = commands.find(item => item.id === job.id);
        if (!command) {
          const response = await this.request(this.profile(), `/desktop/command/${job.id}`);
          command = response.command as RemoteCommand | undefined;
        }
        if (!command && job.state === 'prepared') {
          try { await this.request(this.profile(), '/desktop/commands', job.request); job.state = 'queued'; job.message = '等待手机处理'; }
          catch (error) { if (error instanceof PhoneRequestError && error.code === 400) { job.state = 'failed'; job.message = error.message; } else throw error; }
          continue;
        }
        if (!command) { job.state = 'uncertain'; job.message = '接收服务中找不到已提交操作，请核对手机。'; continue; }
        if (command.state === 'succeeded') {
          const phoneId = rowId(command.result?.eventId);
          const row = phoneId ? this.rawEvent(phoneId) : undefined;
          // A successful result alone is insufficient: require an actual, newer device snapshot.
          if (!row || !this.snapshot || Date.parse(this.snapshot.receivedAt) < Number(command.created) * 1000) { job.state = 'delivered'; job.message = '手机已回执，等待最新日历快照'; continue; }
          job.state = 'synced'; job.message = '已同步到手机';
          if (job.localHash) this.data.bindings[job.eventKey] = { phoneId: phoneId!, clientId: this.snapshot.clientId, localHash: job.localHash, phoneHash: revision(row) };
        } else if (command.state === 'failed' || command.state === 'cancelled' || command.state === 'uncertain') {
          job.state = command.state === 'uncertain' ? 'uncertain' : 'failed'; job.message = String(command.result?.message || (command.state === 'uncertain' ? '状态不确定，请核对手机，不能自动重发' : '手机操作未完成')).slice(0, 300);
        } else if (command.state === 'queued' || command.state === 'delivered') { job.state = command.state; job.message = command.state === 'queued' ? '等待手机处理' : '手机处理中'; }
      }
      if (this.data.jobs.length > 300) this.data.jobs = this.data.jobs.filter((job, index) => unresolved(job) || job.state === 'uncertain' || index >= this.data.jobs.length - 200);
      await this.save();
    } catch (error) { this.connected = false; this.failure = error instanceof Error ? error.message.slice(0, 300) : '无法连接接收服务'; }
    finally { this.polling = false; await this.publish(); }
  }

  private async publish() {
    const snapshot = this.snapshot;
    const device = this.remote.device as Record<string, unknown> | null | undefined;
    await this.update(state => {
      const items: PhoneSyncView['items'] = {};
      const hidden = new Set<string>();
      let localEvents = [...(state.events ?? [])];
      for (const [id, binding] of Object.entries(this.data.bindings)) {
        const local = localEvents.find(event => event.id === id);
        if (!local) continue;
        const raw = snapshot?.clientId === binding.clientId ? this.rawEvent(binding.phoneId) : undefined;
        if (raw) hidden.add(binding.phoneId);
        const localChanged = localRevision(local) !== binding.localHash;
        const phoneChanged = !!raw && revision(raw) !== binding.phoneHash;
        let complexChange = false;
        if (raw && phoneChanged && !localChanged && !this.pendingFor(id)) {
          const mirrored = phoneEvents(snapshot).filter(event => event.phone?.eventId === binding.phoneId);
          if (mirrored.length === 1 && !mirrored[0].phone?.readOnly) {
            const next = { ...mirrored[0], id: local.id, color: local.color }; delete next.phone;
            localEvents = localEvents.map(event => event.id === id ? next : event);
            binding.localHash = localRevision(next); binding.phoneHash = revision(raw);
          } else { complexChange = true; hidden.delete(binding.phoneId); }
        }
        const status: PhoneSyncItem['state'] = !raw && snapshot || complexChange ? 'conflict' : localChanged && phoneChanged ? 'conflict' : localChanged ? 'changed' : 'synced';
        items[id] = { state: status, message: complexChange ? '手机日程已变为复杂或只读安排，请在手机核对' : status === 'conflict' ? '手机端有变化，请核对后发送' : status === 'changed' ? '本地修改尚未发送' : '已同步到手机', linked: this.isLinked(id), revision: raw ? revision(raw) : binding.phoneHash };
      }
      const latestJobs = new Map(this.data.jobs.map(job => [job.eventKey, job]));
      for (const job of latestJobs.values()) {
        if (job.state === 'synced' && items[job.eventKey]) continue;
        items[job.eventKey] = { state: job.state === 'prepared' ? 'queued' : job.state, message: job.message, linked: !!this.data.bindings[job.eventKey] || job.state !== 'failed', revision: items[job.eventKey]?.revision };
      }
      const phoneSync: PhoneSyncView = {
        configured: !!this.data.profile, connected: this.connected, phoneOnline: this.connected && !!device && Date.now() / 1000 - Number(device.lastSeen ?? 0) < 90,
        canWrite: device?.canWrite === true, device: String(device?.device ?? '').slice(0, 200), lastSync: snapshot?.receivedAt ?? null,
        calendarId: this.data.calendarId, calendars: phoneCalendars(snapshot), pending: this.data.jobs.filter(unresolved).length, error: this.failure, items,
      };
      const mirrors = snapshot ? phoneEvents(snapshot, hidden) : this.data.profile ? state.phoneEvents ?? [] : [];
      return { ...state, events: localEvents, phoneEvents: mirrors, phoneSync };
    });
    if (!this.loadError && this.data.identity) await this.save();
  }

  sendLocal(id: string, expectedRevision?: string): Promise<PhoneSyncView> {
    return this.serial(async () => {
      if (this.loadError) throw new Error(this.loadError);
      this.profile();
      const pending = this.pendingFor(id);
      if (pending?.state === 'uncertain') throw new Error('此日程有不确定的手机操作，请先核对手机，不能重发。');
      if (pending) return this.getStatus();
      await this.fetchState();
      const event = this.getState().events?.find(item => item.id === id);
      if (!event) throw new Error('找不到本地日程。');
      const error = eventError(event); if (error) throw new Error(error);
      if (!this.snapshot) throw new Error('请先在手机完成一次同步。');
      const binding = this.data.bindings[id];
      const changes = providerChanges(event);
      const commandId = randomUUID();
      let request: ProviderRow;
      if (binding) {
        const raw = this.rawEvent(binding.phoneId);
        if (binding.clientId !== this.snapshot.clientId || !raw) throw new Error('关联的手机日程不存在或手机已更换。');
        const mirrors = phoneEvents(this.snapshot).filter(item => item.phone?.eventId === binding.phoneId);
        if (mirrors.length !== 1 || mirrors[0].phone?.readOnly) throw new Error('关联手机日程为只读或包含复杂时间，请在手机编辑。');
        if (expectedRevision !== revision(raw)) throw new Error('手机日程已变化，请重新打开编辑窗口核对。');
        if (localRevision(event) === binding.localHash && revision(raw) === binding.phoneHash) { await this.publish(); return this.getStatus(); }
        request = { id: commandId, action: 'update', eventId: binding.phoneId, expected: expectedFields(raw), changes: { title: changes.title, dtstart: changes.dtstart, dtend: changes.dtend, eventTimezone: changes.eventTimezone, allDay: 0, description: changes.description } };
      } else {
        if (!this.data.calendarId || !phoneCalendars(this.snapshot).some(calendar => calendar.id === this.data.calendarId && calendar.writable)) throw new Error('请先在偏好设置中选择可写的手机日历。');
        request = { id: commandId, action: 'create', calendarId: this.data.calendarId, changes, reminders: [] };
      }
      this.data.jobs.push({ id: commandId, eventKey: id, clientId: this.snapshot.clientId, localHash: localRevision(event), request, state: 'prepared', message: '等待发送到接收服务' });
      await this.save(); await this.poll(); return this.getStatus();
    });
  }

  updatePhone(id: string, changes: Partial<Omit<ScheduleEvent, 'id' | 'phone'>>, expectedRevision?: string): Promise<AppState> {
    return this.serial(async () => {
      this.profile();
      if (this.pendingFor(id)) throw new Error('这条手机日程有待确认操作，请等待结果后再修改。');
      await this.fetchState();
      const original = phoneEvents(this.snapshot).find(event => event.id === id);
      if (!original?.phone || !this.snapshot) throw new Error('手机日程已变化，请刷新。');
      if (original.phone.readOnly) throw new Error(original.phone.reason);
      const raw = this.rawEvent(original.phone.eventId)!;
      if (expectedRevision !== revision(raw)) throw new Error('手机日程已更新，请重新打开编辑。');
      if ('color' in changes) throw new Error('手机日程颜色请在手机端设置。');
      const next = { ...original, ...changes };
      const error = eventError(next); if (error) throw new Error(error);
      const mapped: ProviderRow = {};
      if ('title' in changes) mapped.title = next.title;
      if ('description' in changes) mapped.description = next.description;
      if ('date' in changes || 'start' in changes || 'end' in changes) { const times = providerChanges(next); Object.assign(mapped, { dtstart: times.dtstart, dtend: times.dtend, eventTimezone: 'Asia/Shanghai', allDay: 0 }); }
      if (!Object.keys(mapped).length) return this.getState();
      const commandId = randomUUID();
      this.data.jobs.push({ id: commandId, eventKey: id, clientId: this.snapshot.clientId, request: { id: commandId, action: 'update', eventId: original.phone.eventId, expected: expectedFields(raw), changes: mapped }, state: 'prepared', message: '等待发送到接收服务' });
      await this.save(); await this.poll(); return this.getState();
    });
  }
}
