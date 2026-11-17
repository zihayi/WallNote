import type { AppState, DesktopSurface } from './types';

type Bounds = DesktopSurface['bounds'];

export function plannerLayout(area: Bounds): Record<'schedule' | 'calendar' | 'tasks' | 'notes', Bounds> {
  const usable = Math.min(1280, area.width - 64);
  const gap = area.width < 1100 ? 20 : 24;
  const side = Math.floor((usable - gap * 2) / 3.5);
  const middle = usable - side * 2 - gap * 2;
  const start = area.x + (area.width - usable) / 2;
  const height = Math.min(800, Math.max(420, area.height - 64));
  const top = area.y + Math.max(24, (area.height - height) / 2);
  const tasksHeight = Math.floor((height - gap) / 2);
  const make = (x: number, y: number, width: number, h: number): Bounds => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(h) });
  return {
    schedule: make(start, top, side, height),
    calendar: make(start + side + gap, top, middle, height),
    tasks: make(start + side + middle + gap * 2, top, side, tasksHeight),
    notes: make(start + side + middle + gap * 2, top + tasksHeight + gap, side, height - tasksHeight - gap),
  };
}

export function upgradeDesktopLayout(state: AppState): AppState {
  if (state.settings.layoutVersion === 4) return state;
  return { ...state, notes: state.notes.map(note => { const next = { ...note }; delete next.position; return next; }), settings: { ...state.settings, layoutVersion: 4, topmostWidgets: state.settings.topmostWidgets ?? [], tasksPosition: undefined, calendarPosition: undefined, schedulePosition: undefined, notesPosition: undefined } };
}
