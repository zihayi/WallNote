import { useState } from 'react';
import { Check, Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { createTask } from '../../shared/state';
import type { Action, Task } from '../../shared/types';

export type RunAction = (action: Action) => Promise<boolean>;

export function TaskInput({ onAction, compact = false }: { onAction: RunAction; compact?: boolean }) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    if (await onAction({ type: 'task:add', task: createTask(text, priority) })) { setText(''); setPriority(false); }
    setBusy(false);
  };
  return <form className={`task-input ${compact ? 'compact' : ''}`} onSubmit={event => { event.preventDefault(); void submit(); }}>
    <Plus size={18} /><input aria-label="新待办事项" placeholder="添加待办事项" maxLength={500} value={text} onChange={event => setText(event.target.value)} />
    {!compact && <button type="button" className={`icon-button priority-button ${priority ? 'is-priority' : ''}`} aria-label="标记新任务为重要" aria-pressed={priority} onClick={() => setPriority(!priority)}><Flag size={17} /></button>}
    <button className={compact ? 'task-add-mini' : 'button primary'} disabled={!text.trim() || busy} aria-label="添加待办">{compact ? <span>添加</span> : '添加任务'}</button>
  </form>;
}

export function TaskRow({ task, onAction, compact = false }: { task: Task; onAction: RunAction; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.text);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    if (!text.trim()) { setText(task.text); setEditing(false); return; }
    setBusy(true);
    if (await onAction({ type: 'task:update', id: task.id, text })) setEditing(false);
    setBusy(false);
  };
  return <div className={`task-row ${task.completed ? 'completed' : ''} ${compact ? 'compact' : ''}`}>
    <button role="checkbox" aria-checked={task.completed} aria-label={task.text} className="task-checkbox" onClick={() => void onAction({ type: 'task:toggle', id: task.id })}>{task.completed && <Check size={13} strokeWidth={3} />}</button>
    {editing ? <form className="task-edit-form" onSubmit={event => { event.preventDefault(); void save(); }}><input autoFocus aria-label="编辑待办内容" maxLength={500} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setText(task.text); setEditing(false); } }} /><button className="icon-button" disabled={busy} aria-label="保存待办"><Check size={16} /></button></form> : <span className="task-text" onDoubleClick={() => { setText(task.text); setEditing(true); }}>{task.text}</span>}
    {compact ? task.priority && !task.completed && <span className="priority-dot" title="重要任务" /> : !editing && <div className="task-row-actions"><button className={`icon-button priority-button ${task.priority ? 'is-priority' : ''}`} aria-label={`标记重要：${task.text}`} aria-pressed={task.priority} onClick={() => void onAction({ type: 'task:priority', id: task.id })}><Flag size={15} /></button><button className="icon-button" aria-label={`编辑待办：${task.text}`} onClick={() => { setText(task.text); setEditing(true); }}><Pencil size={15} /></button><button className="icon-button danger-hover" aria-label={`删除待办：${task.text}`} onClick={() => void onAction({ type: 'task:delete', id: task.id })}><Trash2 size={15} /></button></div>}
  </div>;
}
