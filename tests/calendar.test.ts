import { describe, expect, it } from 'vitest';
import { createEvent, dateKey, eventError, eventsOnDate, monthDays, parseDate, selectedDate, shiftDate, validDate } from '../shared/calendar';
import { activeDesktopNote, createInitialState, createNote, isValidState, reduceState } from '../shared/state';
import { plannerLayout, upgradeDesktopLayout } from '../shared/layout';

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
    expect(layout.schedule.width).toBe(layout.tasks.width);
    expect(layout.tasks.width).toBe(layout.notes.width);
    expect(layout.schedule.y).toBe(layout.calendar.y);
    expect(layout.calendar.y).toBe(layout.tasks.y);
    expect(layout.notes.y + layout.notes.height).toBe(layout.calendar.y + layout.calendar.height);
    expect(layout.calendar.x - layout.schedule.x - layout.schedule.width).toBe(layout.tasks.x - layout.calendar.x - layout.calendar.width);
    expect(Math.abs((layout.schedule.x + layout.tasks.x + layout.tasks.width) / 2 - (area.x + area.width / 2))).toBeLessThanOrEqual(1);
    for (const rect of Object.values(layout)) {
      expect(rect.x).toBeGreaterThanOrEqual(area.x);
      expect(rect.y).toBeGreaterThanOrEqual(area.y);
      expect(rect.x + rect.width).toBeLessThanOrEqual(area.x + area.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(area.y + area.height);
    }
  });

  it('migrates only legacy layout coordinates and preserves content', () => {
    const old = createInitialState();
    delete old.settings.layoutVersion;
    old.settings.tasksPosition = { x: 900, y: 10, width: 320, height: 380 };
    old.notes[0].position = { x: 60, y: 50, width: 320, height: 310 };
    old.notes[0].content = '用户内容';
    const migrated = upgradeDesktopLayout(old);
    expect(migrated.settings.layoutVersion).toBe(4);
    expect(migrated.settings.tasksPosition).toBeUndefined();
    expect(migrated.notes[0].position).toBeUndefined();
    expect(migrated.notes[0].content).toBe('用户内容');
    expect(old.notes[0].position).toBeDefined();
    expect(upgradeDesktopLayout(migrated)).toBe(migrated);
  });
});

describe('explicit layer pinning and note selection', () => {
  it('only marks a widget topmost through an explicit pin action', () => {
    const initial = createInitialState();
    const selected = reduceState(initial, { type: 'calendar:select', date: '2028-02-29' });
    expect(selected.settings.topmostWidgets).toEqual([]);
    const pinned = reduceState(selected, { type: 'widget:topmost', key: 'calendar', enabled: true });
    expect(pinned.settings.topmostWidgets).toEqual(['calendar']);
    expect(reduceState(pinned, { type: 'widget:topmost', key: 'calendar', enabled: true }).settings.topmostWidgets).toEqual(['calendar']);
    expect(reduceState(pinned, { type: 'widget:topmost', key: 'calendar', enabled: false }).settings.topmostWidgets).toEqual([]);
    expect(() => reduceState(initial, { type: 'widget:topmost', key: 'wallpaper', enabled: true })).toThrow();
    expect(isValidState({ ...initial, settings: { ...initial.settings, topmostWidgets: ['calendar', 'calendar'] } })).toBe(false);
  });

  it('switches the active desktop note without moving or duplicating the other widgets', () => {
    const first = { ...createNote(), pinned: true, title: '第一张' };
    const second = { ...createNote(), pinned: true, title: '第二张' };
    let state = reduceState(createInitialState(), { type: 'note:add', note: first });
    state = reduceState(state, { type: 'note:add', note: second });
    expect(activeDesktopNote(state)?.id).toBe(second.id);
    state = reduceState(state, { type: 'widget:topmost', key: 'notes', enabled: true });
    state = reduceState(state, { type: 'note:selectDesktop', id: first.id });
    expect(activeDesktopNote(state)?.id).toBe(first.id);
    expect(state.settings.topmostWidgets).toEqual(['notes']);
    expect(state.notes.filter(note => note.pinned)).toHaveLength(2);
    expect(isValidState(state)).toBe(true);
    expect(() => reduceState(state, { type: 'note:selectDesktop', id: 'welcome' })).toThrow();
  });
});
