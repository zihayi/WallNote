import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Monitor, StickyNote, Trash2 } from 'lucide-react';
import { createNote, noteColors } from '../../shared/state';
import type { Action, AppState, Note, NoteColor } from '../../shared/types';
import { api, errorMessage } from '../api';
import { Modal } from './Modal';
import { FrostedPanel } from './FrostedPanel';

const colorLabels: Record<NoteColor, string> = { butter: '奶油黄', lavender: '浅薰衣草', mint: '薄荷绿', rose: '蔷薇粉', sky: '天空蓝' };

export function ColorPicker({ value, onChange, label = '便签颜色', disabled = false }: { value: NoteColor; onChange: (color: NoteColor) => void; label?: string; disabled?: boolean }) {
  return <div className="color-picker" aria-label={label}>{noteColors.map(color => <button type="button" key={color} disabled={disabled} className={`color-dot ${color}`} aria-label={colorLabels[color]} aria-pressed={value === color} onClick={() => onChange(color)}>{value === color && <Check size={13} />}</button>)}</div>;
}

function relativeDate(date: string): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days <= 0) return '今天更新';
  if (days === 1) return '昨天更新';
  return new Date(date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

export function NoteCard({ note, onEdit, onPin, onDelete }: { note: Note; onEdit: () => void; onPin: () => void; onDelete: () => void }) {
  return <article className={`note-card ${note.color}`}>
    <button className="note-content-button" onClick={onEdit} aria-label={`编辑便签：${note.title || '无标题便签'}`}>
      <div className="note-card-top"><span className="note-fold" /><StickyNote size={17} />{note.pinned && <span className="pinned-label"><Monitor size={11} /> 桌面便签</span>}</div>
      <h3>{note.title || '无标题便签'}</h3>
      <p>{note.content || '点击编辑内容'}</p>
    </button>
    <footer><span>{relativeDate(note.updatedAt)}</span><div className="note-actions"><button className={`icon-button ${note.pinned ? 'active' : ''}`} onClick={onPin} aria-label={note.pinned ? `收起便签：${note.title}` : `贴到桌面：${note.title}`} title={note.pinned ? '从桌面收起' : '显示在桌面便签中'}>{note.pinned ? <EyeOff size={15} /> : <Eye size={15} />}</button><button className="icon-button danger-hover" onClick={onDelete} aria-label={`删除便签：${note.title}`}><Trash2 size={15} /></button></div></footer>
  </article>;
}

export function NoteEditor({ note, onSave, onClose }: { note: Note | null; onSave: (action: Action) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState<Note>(() => note ? { ...note } : createNote());
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const dirty = draft.title !== (note?.title ?? '') || draft.content !== (note?.content ?? '') || draft.color !== (note?.color ?? 'butter');
  const close = () => { if (saving) return; if (dirty) setDiscard(true); else onClose(); };
  const save = async () => {
    if (saving || (!draft.title.trim() && !draft.content.trim())) return;
    setSaving(true);
    const values = { title: draft.title.trim(), content: draft.content, color: draft.color };
    const changes: Partial<Pick<Note, 'title' | 'content' | 'color'>> = {};
    if (values.title !== note?.title) changes.title = values.title;
    if (values.content !== note?.content) changes.content = values.content;
    if (values.color !== note?.color) changes.color = values.color;
    const success = await onSave(note ? { type: 'note:update', id: note.id, changes } : { type: 'note:add', note: { ...draft, ...values } });
    setSaving(false);
    if (success) onClose();
  };
  return <Modal title={note ? '编辑便签' : '新建便签'} onClose={close} className="note-editor-modal">
    <div className={`note-editor ${draft.color}`} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }}>
      <input data-autofocus aria-label="便签标题" placeholder="便签标题" maxLength={120} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
      <textarea aria-label="便签内容" placeholder="输入便签内容" maxLength={50000} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} />
      <div className="editor-bottom"><ColorPicker value={draft.color} onChange={color => setDraft({ ...draft, color })} /><span>{draft.content.length} 字</span></div>
    </div>
    {discard ? <div className="discard-prompt"><span>有尚未保存的内容，确定放弃吗？</span><button className="button small" onClick={() => setDiscard(false)}>继续编辑</button><button className="button danger small" onClick={onClose}>放弃更改</button></div> : <div className="modal-footer"><span className="shortcut-hint">Ctrl + Enter 快速保存</span><button className="button" onClick={close}>取消</button><button className="button primary" disabled={saving || (!draft.title.trim() && !draft.content.trim())} onClick={() => void save()}><Check size={16} />{saving ? '保存中…' : '保存便签'}</button></div>}
  </Modal>;
}

export function FloatingNote({ note, state, desktop = true }: { note: Note; state: AppState; desktop?: boolean }) {
  const [draft, setDraft] = useState({ title: note.title, content: note.content });
  const draftRef = useRef(draft);
  const dirty = useRef<Partial<Pick<Note, 'title' | 'content'>>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(0);
  const [focusedField, setFocusedField] = useState<'title' | 'content' | null>(null);
  const [status, setStatus] = useState('已保存到本地');
  const [error, setError] = useState('');

  useEffect(() => {
    if (pending.current || Object.keys(dirty.current).length) return;
    // Ignore delayed save acknowledgements for the actively edited field. Replacing its value
    // with an earlier acknowledgement moves the native textarea caret to the end.
    const next = { title: focusedField === 'title' ? draftRef.current.title : note.title, content: focusedField === 'content' ? draftRef.current.content : note.content };
    if (next.title === draftRef.current.title && next.content === draftRef.current.content) return;
    draftRef.current = next;
    setDraft(next);
  }, [note.title, note.content, focusedField]);

  useEffect(() => {
    const blur = () => setFocusedField(null);
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, []);

  async function flush(): Promise<boolean> {
    if (timer.current) clearTimeout(timer.current);
    const changes = { ...dirty.current };
    if (!Object.keys(changes).length) return true;
    dirty.current = {};
    pending.current += 1;
    setStatus('保存中…');
    try {
      await api.dispatch({ type: 'note:update', id: note.id, changes });
      setError('');
      if (!Object.keys(dirty.current).length) setStatus('已保存到本地');
      return true;
    } catch (cause) {
      dirty.current = { ...changes, ...dirty.current };
      setError(errorMessage(cause)); setStatus('保存失败，点击重试');
      return false;
    } finally { pending.current -= 1; }
  }

  // Flush on each blur (including clicking close); use beforeunload for pending edits on app quit.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const unload = () => { void flushRef.current(); };
    window.addEventListener('beforeunload', unload);
    return () => { if (timer.current) clearTimeout(timer.current); window.removeEventListener('beforeunload', unload); };
  }, []);
  function change(field: 'title' | 'content', value: string) {
    setFocusedField(field);
    draftRef.current = { ...draftRef.current, [field]: value };
    setDraft(draftRef.current);
    dirty.current[field] = value;
    setStatus('正在编辑…');
    if (timer.current) clearTimeout(timer.current);
    // Queue each edit immediately in the main process so quitting cannot lose a debounce buffer.
    void flush();
  }
  async function unpin() {
    if (!(await flush())) return;
    try { await api.dispatch({ type: 'note:update', id: note.id, changes: { pinned: false } }); } catch (cause) { setError(errorMessage(cause)); }
  }
  const notes = state.notes.filter(item => item.pinned);
  const currentIndex = notes.findIndex(item => item.id === note.id);
  const select = (index: number) => { void api.dispatch({ type: 'note:selectDesktop', id: notes[index].id }).catch(cause => setError(errorMessage(cause))); };
  return <FrostedPanel state={state} title="便签" widgetKey="notes" icon={<StickyNote size={17} />} desktop={desktop} className={`floating-note ${note.color}`} onClose={() => void unpin()} actions={notes.length > 1 ? <div className="note-switcher"><button className="icon-button" aria-label="上一张便签" disabled={currentIndex <= 0} onClick={() => select(currentIndex - 1)}><ChevronLeft size={13} /></button><span>{currentIndex + 1}/{notes.length}</span><button className="icon-button" aria-label="下一张便签" disabled={currentIndex >= notes.length - 1} onClick={() => select(currentIndex + 1)}><ChevronRight size={13} /></button></div> : undefined}>
    <input aria-label="便签标题" placeholder="无标题便签" value={draft.title} maxLength={120} onFocus={() => setFocusedField('title')} onPointerDown={() => setFocusedField('title')} onChange={event => change('title', event.target.value)} onBlur={() => { setFocusedField(null); void flush(); }} />
    <textarea aria-label="便签内容" placeholder="输入便签内容" value={draft.content} maxLength={50000} onFocus={() => setFocusedField('content')} onPointerDown={() => setFocusedField('content')} onChange={event => change('content', event.target.value)} onBlur={() => { setFocusedField(null); void flush(); }} />
    {error && <div className="floating-error" role="alert">{error}</div>}
    <footer><ColorPicker value={note.color} onChange={color => { void api.dispatch({ type: 'note:update', id: note.id, changes: { color } }).catch(cause => setError(errorMessage(cause))); }} /><button className="save-status" onClick={() => void flush()}>{status}</button></footer>
  </FrostedPanel>;
}
