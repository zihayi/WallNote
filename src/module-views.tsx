import { lazy, Suspense, type ComponentType } from 'react';
import type { ModuleId } from '../shared/modules';
import type { AppState } from '../shared/types';

export type PanelProps = {state:AppState; desktop?:boolean; noteId?:string; showPhoneLink?:boolean};
// One loader per module, shared by the desktop HWND and the workspace preview.
// Keep it outside React so an update never remounts a panel (or loses a draft).
const loaders = {
  calendar: () => import('./components/Planner').then(m=>m.CalendarPanel),
  schedule: () => import('./components/Planner').then(m=>m.HourlySchedule),
  tasks: () => import('./components/TaskPanel').then(m=>m.DesktopTasks),
  notes: () => import('./components/NotesPanel').then(m=>m.NotesPanel),
  community: () => import('./components/Community').then(m=>m.CommunityPanel),
  drawer: () => import('./components/FileDrawer').then(m=>m.FileDrawerPanel),
} satisfies Record<ModuleId,()=>Promise<ComponentType<PanelProps>>>;
const panels = new Map<ModuleId,ComponentType<PanelProps>>();
export function ModulePanel({id,...props}:PanelProps & {id:ModuleId}) {
  let Panel=panels.get(id);
  if(!Panel){Panel=lazy(async()=>({default:await loaders[id]()}));panels.set(id,Panel);}
  return <Suspense fallback={null}><Panel {...props}/></Suspense>;
}
