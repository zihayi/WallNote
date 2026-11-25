import type { AppState, ScheduleEvent } from './types';
import { selectedDate } from './calendar';
import type { ModuleId } from './modules';

export type RendererView = 'main' | 'wallpaper' | Exclude<ModuleId,'notes'> | 'note' | 'notes-empty';

// The store replaces changed collections. Compare references before projecting or
// crossing IPC: typing in a note should never wake every wallpaper and calendar.
export function viewInputs(s:AppState, view:RendererView):unknown[] {
  if(view==='main')return [s];
  const inputs:unknown[]=[s.selectedWallpaperId,s.appliedWallpaperId,s.wallpapers];
  if(view!=='wallpaper')inputs.push(s.settings);
  if(view==='note'||view==='notes-empty')inputs.push(s.notes);
  if(view==='tasks')inputs.push(s.tasks);
  if(view==='calendar'||view==='schedule')inputs.push(s.events,s.phoneEvents,s.phoneSync,selectedDate(s));
  return inputs;
}

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
    notes: view === 'note' || view === 'notes-empty' ? state.notes.map(note => view === 'note' && note.id === noteId ? note : { ...note, content: '', images: undefined }) : [],
    tasks: view === 'tasks' ? state.tasks : [],
    events: local,
    phoneEvents: phone,
    phoneSync: isPlanner && state.phoneSync ? { ...state.phoneSync, items: Object.fromEntries(Object.entries(state.phoneSync.items).filter(([id]) => selectedIds.has(id))) } : undefined,
    wallpapers: state.wallpapers.filter(wallpaper => wallpaper.id === state.selectedWallpaperId || wallpaper.id === state.appliedWallpaperId),
    favorites: [],
  };
}
