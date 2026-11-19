import type { AppState, ScheduleEvent } from './types';
import { selectedDate } from './calendar';

export type RendererView = 'main' | 'wallpaper' | 'calendar' | 'schedule' | 'tasks' | 'note' | 'notes-empty' | 'community';

// A wallpaper or task window must not retain every note body and phone calendar snapshot.
// Calendar dots only need lightweight records outside the selected day.
export function stateForView(state: AppState, view: RendererView, noteId?: string): AppState {
  if (view === 'main') return state;
  const date = selectedDate(state);
  const isPlanner = view === 'calendar' || view === 'schedule';
  const events = (records: ScheduleEvent[] = []) => !isPlanner ? [] : view === 'schedule' ? records.filter(event => event.date === date) : records.map(event => event.date === date ? event : { ...event, description: '', ...(event.phone ? { phone: { ...event.phone, location: '' } } : {}) });
  const local = events(state.events), phone = events(state.phoneEvents);
  const selectedIds = new Set([...local, ...phone].filter(event => event.date === date).map(event => event.id));
  return {
    ...state,
    notes: view === 'note' ? state.notes.filter(note => note.pinned).map(note => note.id === noteId ? note : { ...note, content: '' }) : [],
    tasks: view === 'tasks' ? state.tasks : [],
    events: local,
    phoneEvents: phone,
    phoneSync: isPlanner && state.phoneSync ? { ...state.phoneSync, items: Object.fromEntries(Object.entries(state.phoneSync.items).filter(([id]) => selectedIds.has(id))) } : undefined,
    wallpapers: state.wallpapers.filter(wallpaper => wallpaper.id === state.selectedWallpaperId || wallpaper.id === state.appliedWallpaperId),
    favorites: [],
  };
}
