import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import type { Action } from '../../shared/types';
import type { PanelProps } from '../module-views';
import { api, errorMessage } from '../api';
import { TaskInput, TaskRow } from './Tasks';
import { FrostedPanel } from './FrostedPanel';

export function DesktopTasks({ state, desktop = false }: PanelProps) {
  const [error, setError] = useState('');
  const completed = state.tasks.filter(t => t.completed).length;
  const tasks = [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.priority) - Number(a.priority));
  async function run(action: Action) {
    try { await api.dispatch(action); setError(''); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }
  return <FrostedPanel state={state} title="待办清单" widgetKey="tasks" icon={<CheckCheck size={18} />} desktop={desktop} className="desktop-tasks" onClose={desktop ? () => void run({ type: 'settings:update', changes: { showDesktopTasks: false } }) : undefined} actions={<span className="widget-count" title="已完成 / 全部">{completed} / {state.tasks.length}</span>}>
    <div className="progress-track"><div style={{ width: `${state.tasks.length ? completed / state.tasks.length * 100 : 0}%` }} /></div>
    <div className="desktop-tasks-list">{tasks.length ? tasks.map(task => <TaskRow key={task.id} task={task} onAction={run} compact />) : <div className="planner-empty"><p>暂无待办事项</p></div>}</div>
    <TaskInput onAction={run} compact />
    {error && <p className="widget-error" role="alert">{error}</p>}
  </FrostedPanel>;
}
