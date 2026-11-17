import { describe, expect, it } from 'vitest';
import { createEvent, dateKey, eventError, eventsOnDate, monthDays, parseDate, selectedDate, shiftDate, validDate } from '../shared/calendar';
import { createInitialState, isValidState, reduceState } from '../shared/state';
import { plannerLayout } from '../shared/layout';

describe('local calendar dates', () => {
  it('uses local dates and round-trips leap days without UTC conversion', () => {
    expect(dateKey(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
    expect(dateKey(parseDate('2028-02-29'))).toBe('2028-02-29');
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(validDate('2026-02-29')).toBe(false);
    expect(validDate('2026-04-31')).toBe(false);
    expect(validDate('2026-13-01')).toBe(false);
    expect(validDate('2026-2-3')).toBe(false);
  });

  it('builds a complete Monday-first grid across month and year boundaries', () => {
    const days = monthDays('2026-11');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-10-26');
    expect(days[41]).toBe('2026-12-06');
    expect(parseDate(days[0]).getDay()).toBe(1);
    expect(new Set(days).size).toBe(42);
    expect(monthDays('2028-02')).toContain('2028-02-29');
  });
});

describe('schedule integrity', () => {
  it('adds, edits, selects and deletes events without modifying notes or tasks', () => {
    const initial = createInitialState();
    const event = { ...createEvent('2026-11-20', 9), title: '项目会议', description: '会议室 A' };
    const added = reduceState(initial, { type: 'event:add', event });
    const selected = reduceState(added, { type: 'calendar:select', date: event.date });
    const edited = reduceState(selected, { type: 'event:update', id: event.id, changes: { start: '10:30', end: '11:30', title: '项目讨论' } });
    expect(selectedDate(edited)).toBe('2026-11-20');
    expect(eventsOnDate(edited, '2026-11-20')[0]).toMatchObject({ title: '项目讨论', description: '会议室 A', start: '10:30' });
    expect(eventsOnDate(edited, '2026-11-21')).toEqual([]);
    expect(edited.notes).toEqual(initial.notes);
    expect(edited.tasks).toEqual(initial.tasks);
    expect(initial.events).toEqual([]);
    expect(isValidState(edited)).toBe(true);
    expect(reduceState(edited, { type: 'event:delete', id: event.id }).events).toEqual([]);
  });

  it('keeps multiple events in chronological order, including overlapping appointments', () => {
    let state = createInitialState();
    for (const hour of [14, 8, 9, 9]) state = reduceState(state, { type: 'event:add', event: { ...createEvent('2026-11-20', hour), title: `安排 ${hour}` } });
    expect(eventsOnDate(state, '2026-11-20').map(event => event.start)).toEqual(['08:00', '09:00', '09:00', '14:00']);
    expect(isValidState(state)).toBe(true);
  });

  it('rejects invalid dates, times, duplicate IDs, and unsafe updates', () => {
    const event = { ...createEvent('2026-11-20'), title: '会议' };
    expect(eventError({ ...event, end: '08:00' })).toContain('结束时间');
    expect(eventError({ ...event, start: '25:00' })).toContain('有效');
    expect(eventError({ ...event, title: '   ' })).toContain('标题');
    expect(eventError(createEvent('2026-11-20', 23))).toContain('标题');
    expect(eventError({ ...createEvent('2026-11-20', 23), title: '夜间安排' })).toBeNull();
    const state = reduceState(createInitialState(), { type: 'event:add', event });
    expect(() => reduceState(state, { type: 'event:update', id: event.id, changes: { end: '07:00' } })).toThrow();
    expect(() => reduceState(state, { type: 'calendar:select', date: '2026-02-31' })).toThrow();
    expect(() => reduceState(state, { type: 'event:update', id: 'missing', changes: { title: 'lost' } })).toThrow();
    expect(isValidState({ ...state, events: [event, event] })).toBe(false);
    expect(isValidState({ ...state, events: [{ ...event, date: '2026-02-31' }] })).toBe(false);
    expect(isValidState({ ...state, events: [{ ...event, start: '99:00' }] })).toBe(false);
    expect(isValidState({ ...state, calendarDate: 'not-a-date' })).toBe(false);
  });

  it('accepts old data with no calendar fields and validates new glass/layout settings', () => {
    const old = createInitialState();
    delete old.events; delete old.calendarDate;
    delete old.settings.showDesktopCalendar; delete old.settings.showDesktopSchedule; delete old.settings.showDesktopNotes; delete old.settings.glassEnabled;
    expect(isValidState(old)).toBe(true);
    expect(eventsOnDate(old, '2026-11-20')).toEqual([]);
    expect(selectedDate(old)).toBe(dateKey());
    expect(isValidState({ ...old, settings: { ...old.settings, glassEnabled: 'yes' } })).toBe(false);
    expect(isValidState({ ...old, settings: { ...old.settings, calendarPosition: { x: 0, y: 0, width: -1, height: 500 } } })).toBe(false);
  });
});

describe('three-column desktop layout', () => {
  it.each([{ x: 0, y: 0, width: 1920, height: 1032 }, { x: 0, y: 0, width: 1280, height: 720 }, { x: -1493, y: 460, width: 1493, height: 900 }])('keeps panels within the work area without overlap ($width px)', area => {
    const layout = plannerLayout(area);
    expect(layout.schedule.x + layout.schedule.width).toBeLessThan(layout.calendar.x);
    expect(layout.calendar.x + layout.calendar.width).toBeLessThan(layout.tasks.x);
    expect(layout.tasks.y + layout.tasks.height).toBeLessThan(layout.notes.y);
    for (const rect of Object.values(layout)) {
      expect(rect.x).toBeGreaterThanOrEqual(area.x);
      expect(rect.y).toBeGreaterThanOrEqual(area.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height);
    }
  });
});
