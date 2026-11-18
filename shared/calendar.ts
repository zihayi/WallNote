import type { AppState, ScheduleEvent } from './types';

export function dateKey(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date;
}

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2100-12-31' && dateKey(parseDate(value)) === value;
}

export function validTime(value: unknown, allowEndOfDay = false): value is string { return typeof value === 'string' && (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || allowEndOfDay && value === '24:00'); }
export function selectedDate(state: AppState): string { return state.calendarDate ?? dateKey(); }

export function shiftDate(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function monthDays(month: string): string[] {
  const first = parseDate(`${month}-01`);
  const offset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => shiftDate(dateKey(first), index));
}

export function eventsOnDate(state: AppState, date: string): ScheduleEvent[] {
  return calendarEvents(state).filter(event => event.date === date).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id));
}

export function calendarEvents(state: AppState): ScheduleEvent[] { return [...(state.events ?? []), ...(state.phoneEvents ?? [])]; }

export function createEvent(date: string, hour = 9): ScheduleEvent {
  const startHour = Math.min(23, Math.max(0, hour));
  return { id: crypto.randomUUID(), title: '', date, start: `${String(startHour).padStart(2, '0')}:00`, end: startHour === 23 ? '23:59' : `${String(startHour + 1).padStart(2, '0')}:00`, description: '', color: 'mint' };
}

export function eventError(event: ScheduleEvent): string | null {
  if (!event.title.trim()) return '请输入日程标题。';
  if (!validDate(event.date)) return '请选择 1900–2100 年之间的有效日期。';
  if (!validTime(event.start) || !validTime(event.end, true)) return '请输入有效的开始和结束时间。';
  if (event.start >= event.end) return '结束时间需要晚于开始时间，跨天安排请分开添加。';
  if (event.title.length > 120 || event.description.length > 5000) return '日程内容超出长度限制。';
  return null;
}
