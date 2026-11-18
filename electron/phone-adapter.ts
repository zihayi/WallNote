import { createHash } from 'node:crypto';
import type { PhoneSyncView, ScheduleEvent } from '../shared/types';
import { validDate } from '../shared/calendar';

export type ProviderRow = Record<string, unknown>;
export interface PhoneSnapshot {
  schemaVersion: 1;
  clientId: string; receivedAt: string; rangeStartMs: number; rangeEndMs: number;
  calendars: ProviderRow[]; events: ProviderRow[]; instances: ProviderRow[]; reminders: ProviderRow[];
}
export const EVENT_FIELDS = ['calendar_id', 'title', 'dtstart', 'dtend', 'duration', 'eventTimezone', 'allDay', 'eventLocation', 'description', 'rrule', 'rdate', 'exrule', 'exdate', 'original_id', 'originalInstanceTime', 'originalAllDay', 'eventStatus', 'deleted'];
const DAY = 86400000, OFFSET = 8 * 3600000;
export function rowId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' && /^\d{1,18}$/.test(value) ? value : null;
}
export function revision(row: ProviderRow): string {
  return createHash('sha256').update(JSON.stringify(EVENT_FIELDS.map(key => row[key] ?? null))).digest('hex');
}
export function localRevision(event: ScheduleEvent): string {
  return createHash('sha256').update(JSON.stringify([event.title, event.date, event.start, event.end, event.description])).digest('hex');
}
export function expectedFields(row: ProviderRow): ProviderRow { return Object.fromEntries(EVENT_FIELDS.map(key => [key, row[key] ?? null])); }
export function providerChanges(event: ScheduleEvent): ProviderRow {
  const start = Date.parse(`${event.date}T${event.start}:00+08:00`), end = Date.parse(`${event.date}T${event.end}:00+08:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('日程时间无效。');
  return { title: event.title, dtstart: start, dtend: end, eventTimezone: 'Asia/Shanghai', allDay: 0, description: event.description, eventLocation: '' };
}
export function snapshotFrom(value: unknown): PhoneSnapshot | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('手机快照格式无效。');
  const item = value as Record<string, unknown>;
  if (item.schemaVersion !== 1 || typeof item.clientId !== 'string' || item.clientId.length > 128 || typeof item.receivedAt !== 'string' || !Number.isFinite(Date.parse(item.receivedAt))) throw new Error('手机标识或同步时间无效。');
  for (const key of ['calendars', 'events', 'instances', 'reminders']) if (!Array.isArray(item[key]) || item[key].length > 100000 || item[key].some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('手机日历数据格式无效。');
  if (typeof item.rangeStartMs !== 'number' || typeof item.rangeEndMs !== 'number' || !Number.isFinite(item.rangeStartMs) || !Number.isFinite(item.rangeEndMs) || item.rangeEndMs <= item.rangeStartMs || item.rangeEndMs - item.rangeStartMs > 400 * DAY) throw new Error('手机日历范围无效。');
  return item as unknown as PhoneSnapshot;
}
export function phoneCalendars(snapshot: PhoneSnapshot | null): PhoneSyncView['calendars'] {
  return (snapshot?.calendars ?? []).flatMap(row => { const id = rowId(row._id); return id ? [{ id, name: String(row.calendar_displayName || '未命名日历').slice(0, 120), writable: Number(row.calendar_access_level ?? 0) >= 500 && row.visible !== 0 }] : []; });
}
export function phoneEvents(snapshot: PhoneSnapshot | null, hiddenIds: Set<string> = new Set()): ScheduleEvent[] {
  if (!snapshot) return [];
  const rows = new Map(snapshot.events.map(row => [rowId(row._id), row]));
  const calendars = new Map(phoneCalendars(snapshot).map(calendar => [calendar.id, calendar]));
  const result = new Map<string, ScheduleEvent>();
  for (const instance of snapshot.instances) {
    const id = rowId(instance.event_id), row = id ? rows.get(id) : undefined;
    if (!id || !row || hiddenIds.has(id) || row.deleted === 1 || row.eventStatus === 2) continue;
    const start = Number(instance.begin), end = Number(instance.end);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) continue;
    const allDay = Number(instance.allDay ?? row.allDay) === 1;
    const offset = allDay ? 0 : OFFSET;
    const from = Math.max(Math.floor((start + offset) / DAY) * DAY, Math.floor((snapshot.rangeStartMs + offset) / DAY) * DAY);
    const until = Math.min(end + offset, snapshot.rangeEndMs + offset);
    const calendar = calendars.get(rowId(row.calendar_id) ?? '');
    const recurring = !!(row.rrule || row.rdate || row.original_id);
    const multiDay = Math.floor((start + offset) / DAY) !== Math.floor((end - 1 + offset) / DAY);
    const minuteExact = start % 60000 === 0 && end % 60000 === 0;
    const readOnly = !calendar?.writable || allDay || recurring || multiDay || (end + offset) % DAY === 0 || !minuteExact || String(row.title ?? '').length > 120 || String(row.description ?? '').length > 5000;
    const reason = !calendar?.writable ? '此手机日历不可写' : readOnly ? '重复、全天、跨天或特殊时间日程请在手机编辑' : '';
    for (let day = from, guard = 0; day < until && guard < 400 && result.size < 10000; day += DAY, guard++) {
      const date = new Date(day).toISOString().slice(0, 10);
      if (!validDate(date)) continue;
      const beginMinute = allDay ? 0 : Math.max(0, Math.floor((start + offset - day) / 60000));
      const endMinute = allDay ? 1440 : Math.min(1440, Math.ceil((end + offset - day) / 60000));
      if (beginMinute >= 1440 || endMinute <= beginMinute) continue;
      const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const eventId = `phone-${createHash('sha256').update(`${snapshot.clientId}/${id}/${start}/${date}`).digest('hex').slice(0, 32)}`;
      result.set(eventId, { id: eventId, title: String(row.title || instance.title || '无标题日程').slice(0, 120), date, start: time(beginMinute), end: time(endMinute), description: String(row.description ?? '').slice(0, 5000), color: 'sky', phone: { eventId: id, clientId: snapshot.clientId, revision: revision(row), calendarName: calendar?.name ?? '手机日历', readOnly, reason, location: String(row.eventLocation ?? '').slice(0, 1000) } });
    }
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
