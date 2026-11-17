import { useEffect, useState } from 'react';
import { CheckCheck, Grip, Leaf, Settings, X } from 'lucide-react';
import { allWallpapers } from '../../shared/state';
import type { Action, AppState } from '../../shared/types';
import { api, errorMessage, wallpaperURL } from '../api';
import { TaskInput, TaskRow } from './Tasks';
import { beginDesktopManipulation } from './desktop-input';

export function DesktopWallpaper({ state }: { state: AppState }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000 * 30); return () => clearInterval(timer); }, []);
  const wallpapers = allWallpapers(state);
  const current = wallpapers.find(w => w.id === state.appliedWallpaperId) ?? wallpapers.find(w => w.id === state.selectedWallpaperId) ?? wallpapers[0];
  return <main className="desktop-wallpaper" aria-label="Windows 桌面壁纸">
    <img src={wallpaperURL(current)} alt={current.name} draggable={false} />
    <div className="wallpaper-clock"><span className="desktop-eyebrow">MAKE ROOM FOR A GOOD DAY</span><time>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time><p>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</p><span className="wallpaper-clock-line" /><p className="wallpaper-motto">给重要的事留位置，给新想法留一点空白。</p></div>
    <div className="wallpaper-signature"><Leaf size={14} /><span>WallNote</span><i />{current.name}</div>
  </main>;
}

export function DesktopTasks({ state }: { state: AppState }) {
  const [error, setError] = useState('');
  const completed = state.tasks.filter(t => t.completed).length;
  const tasks = [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.priority) - Number(a.priority));
  async function run(action: Action) {
    try { await api.dispatch(action); setError(''); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }
  return <section className="desktop-tasks" onPointerDownCapture={() => api.focusDesktopWidget()}>
    <header className="floating-drag" onPointerDown={event => beginDesktopManipulation(event, 'move')}><span><Grip size={16} /> TODAY, AT YOUR PACE</span><div><button className="icon-button" aria-label="打开管理面板" onClick={() => void api.desktopControl('showManager')}><Settings size={15} /></button><button className="icon-button" aria-label="收起桌面待办" onClick={() => void run({ type: 'settings:update', changes: { showDesktopTasks: false } })}><X size={17} /></button></div></header>
    <div className="desktop-tasks-heading"><CheckCheck size={19} /><h1>今天，一件一件来</h1><span>{completed} / {state.tasks.length}</span></div>
    <div className="progress-track"><div style={{ width: `${state.tasks.length ? completed / state.tasks.length * 100 : 0}%` }} /></div>
    <div className="desktop-tasks-list">{tasks.length ? tasks.map(task => <TaskRow key={task.id} task={task} onAction={run} compact />) : <div className="mini-empty"><Leaf size={24} />写下一件想做的小事吧</div>}</div>
    <TaskInput onAction={run} compact />
    {error ? <p className="floating-error" role="alert">{error}</p> : <footer><Leaf size={11} />按自己的节奏，每一小步都算数。</footer>}
    <button className="desktop-resize-handle" aria-label="拖动调整待办大小" onPointerDown={event => beginDesktopManipulation(event, 'resize')} />
  </section>;
}
