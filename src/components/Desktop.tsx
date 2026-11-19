import { useState } from 'react';
import { CheckCheck, Leaf, Plus, StickyNote } from 'lucide-react';
import { activeDesktopNote, allWallpapers, createNote } from '../../shared/state';
import type { Action, AppState } from '../../shared/types';
import { api, errorMessage, wallpaperURL } from '../api';
import { TaskInput, TaskRow } from './Tasks';
import { FrostedPanel } from './FrostedPanel';
import { CalendarPanel, HourlySchedule } from './Planner';
import { FloatingNote } from './Notes';
import { visibleModule, type Slot } from '../../shared/modules';
import { CommunityPanel } from './Community';

export function DesktopWallpaper({ state }: { state: AppState }) {
  const wallpapers = allWallpapers(state);
  const current = wallpapers.find(w => w.id === state.appliedWallpaperId) ?? wallpapers.find(w => w.id === state.selectedWallpaperId) ?? wallpapers[0];
  return <main className="desktop-wallpaper" aria-label="Windows 桌面壁纸"><img src={wallpaperURL(current)} alt={current.name} draggable={false} /><div className="wallpaper-signature"><Leaf size={14} /><span>WallNote</span><i />{current.name}</div></main>;
}

export function DesktopTasks({ state, desktop = false }: { state: AppState; desktop?: boolean }) {
  const [error, setError] = useState('');
  const completed = state.tasks.filter(t => t.completed).length;
  const tasks = [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.priority) - Number(a.priority));
  async function run(action: Action) {
    try { await api.dispatch(action); setError(''); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }
  return <FrostedPanel state={state} title="待办清单" widgetKey="tasks" icon={<CheckCheck size={18} />} desktop={desktop} className="desktop-tasks" onClose={desktop ? () => void run({ type: 'settings:update', changes: { showDesktopTasks: false } }) : undefined} actions={<span className="widget-count">{completed} / {state.tasks.length}</span>}>
    <div className="progress-track"><div style={{ width: `${state.tasks.length ? completed / state.tasks.length * 100 : 0}%` }} /></div>
    <div className="desktop-tasks-list">{tasks.length ? tasks.map(task => <TaskRow key={task.id} task={task} onAction={run} compact />) : <div className="planner-empty"><CheckCheck size={24} /><p>暂无待办事项</p></div>}</div>
    <TaskInput onAction={run} compact />
    {error ? <p className="widget-error" role="alert">{error}</p> : <footer className="widget-footer">{state.tasks.length - completed} 项未完成</footer>}
  </FrostedPanel>;
}

export function EmptyNotesPanel({ state, desktop = false }: { state: AppState; desktop?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { await api.dispatch({ type: 'note:add', note: { ...createNote(), pinned: true } }); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <FrostedPanel state={state} title="便签" widgetKey="notes" icon={<StickyNote size={18} />} desktop={desktop} className="empty-notes-panel" onClose={desktop ? () => { void api.dispatch({ type: 'settings:update', changes: { showDesktopNotes: false } }).catch(cause => setError(errorMessage(cause))); } : undefined}>
    <div className="planner-empty"><StickyNote size={30} /><p>暂无桌面便签</p><span>新建便签，或在管理面板中加入桌面便签。</span><button className="button" disabled={busy} onClick={() => void add()}><Plus size={15} />新建便签</button></div>
    {error && <p className="widget-error" role="alert">{error}</p>}
  </FrostedPanel>;
}

export function PlannerWorkspace({ state, standalone = false }: { state: AppState; standalone?: boolean }) {
  const wallpapers = allWallpapers(state);
  const wallpaper = wallpapers.find(w => w.id === (standalone ? state.appliedWallpaperId ?? state.selectedWallpaperId : state.selectedWallpaperId)) ?? wallpapers[0];
  const note = activeDesktopNote(state);
  const panel = (slot: Slot) => {
    switch (visibleModule(state.settings, slot)) {
      case 'schedule': return <HourlySchedule state={state} />;
      case 'calendar': return <CalendarPanel state={state} showPhoneLink={!standalone} />;
      case 'tasks': return <DesktopTasks state={state} />;
      case 'notes': return note ? <FloatingNote key={note.id} note={note} state={state} desktop={false} /> : <EmptyNotesPanel state={state} />;
      case 'community': return <CommunityPanel state={state} />;
      default: return <div className="workspace-empty-slot" aria-label="空模块位置" />;
    }
  };
  return <div className={`planner-workspace ${standalone ? 'standalone-workspace' : ''}`} style={{ backgroundImage: `url("${wallpaperURL(wallpaper)}")` }}>
    <div className="planner-workspace-grid">{panel('left')}{panel('center')}<div className="workspace-right">{panel('upper')}{panel('lower')}</div></div>
    {standalone && <div className="workspace-watermark">WallNote</div>}
  </div>;
}
