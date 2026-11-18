import { describe, expect, it } from 'vitest';
import { createEvent } from '../shared/calendar';
import { createInitialState, isValidState } from '../shared/state';
import { stateForView } from '../shared/renderer-state';

describe('renderer memory payloads', () => {
  it('omits unrelated content from wallpaper and task windows', () => {
    const state = createInitialState();
    state.notes[0].content = 'x'.repeat(40000);
    state.events = [{ ...createEvent('2028-02-29'), title: '安排', description: 'y'.repeat(4000) }];
    const wallpaper = stateForView(state, 'wallpaper');
    expect(wallpaper.notes).toEqual([]);
    expect(wallpaper.tasks).toEqual([]);
    expect(wallpaper.events).toEqual([]);
    expect(wallpaper.selectedWallpaperId).toBe(state.selectedWallpaperId);
    expect(stateForView(state, 'tasks').tasks).toBe(state.tasks);
    expect(JSON.stringify(wallpaper).length).toBeLessThan(JSON.stringify(state).length / 10);
    expect(isValidState(wallpaper)).toBe(true);
    expect(state.notes[0].content).toHaveLength(40000);
  });

  it('preserves calendar dots while loading full details only for the selected day', () => {
    const state = createInitialState();
    state.calendarDate = '2028-02-29';
    state.events = [
      { ...createEvent('2028-02-29'), title: '今天', description: '完整备注' },
      { ...createEvent('2028-03-01'), title: '明天', description: '未选择日期的长备注' },
    ];
    const calendar = stateForView(state, 'calendar');
    expect(calendar.events).toHaveLength(2);
    expect(calendar.events?.[0].description).toBe('完整备注');
    expect(calendar.events?.[1].description).toBe('');
    expect(stateForView(state, 'schedule').events).toHaveLength(1);
    expect(stateForView({ ...state, calendarDate: '2028-03-01' }, 'schedule').events?.[0].description).toBe('未选择日期的长备注');
    expect(isValidState(calendar)).toBe(true);
  });

  it('keeps note switching metadata but not inactive note bodies', () => {
    const state = createInitialState();
    state.notes[0].pinned = true; state.notes[1].pinned = true;
    const view = stateForView(state, 'note', state.notes[0].id);
    expect(view.notes).toHaveLength(2);
    expect(view.notes[0].content).toBe(state.notes[0].content);
    expect(view.notes[1]).toMatchObject({ id: state.notes[1].id, title: state.notes[1].title, content: '' });
    expect(stateForView(state, 'main')).toBe(state);
  });
});
