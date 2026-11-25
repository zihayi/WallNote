import { useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Monitor, Plus, StickyNote, Trash2 } from 'lucide-react';
import { createNote, noteColors } from '../../shared/state';
import type { Action, AppState, Note, NoteColor } from '../../shared/types';
import { api, errorMessage } from '../api';
import { Modal } from './Modal';
import { FrostedPanel } from './FrostedPanel';
import { colorLabels, NoteColorPicker, noteStyle } from './NoteAppearance';
import { NoteBody } from './NoteBody';
import '../notes.css';

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
  return <article className={`note-card ${note.color} ${note.backgroundColor ? 'custom-note' : ''}`} style={noteStyle(note)}>
    <button className="note-content-button" onClick={onEdit} aria-label={`编辑便签：${note.title || '无标题便签'}`}>
      <div className="note-card-top"><span className="note-fold" /><StickyNote size={17} />{note.pinned && <span className="pinned-label"><Monitor size={11} /> 桌面便签</span>}</div>
      <h3>{note.title || '无标题便签'}</h3>
      <p>{note.content || (note.images?.length ? `${note.images.length} 张图片` : '点击编辑内容')}</p>
      {!!note.images?.length && <img className="note-card-image" src={note.images[0].dataUrl} alt={note.images[0].name} />}
    </button>
    <footer><span>{relativeDate(note.updatedAt)}</span><div className="note-actions"><button className={`icon-button ${note.pinned ? 'active' : ''}`} onClick={onPin} aria-label={note.pinned ? `收起便签：${note.title}` : `贴到桌面：${note.title}`} title={note.pinned ? '从桌面收起' : '显示在桌面便签中'}>{note.pinned ? <EyeOff size={15} /> : <Eye size={15} />}</button><button className="icon-button danger-hover" onClick={onDelete} aria-label={`删除便签：${note.title}`}><Trash2 size={15} /></button></div></footer>
  </article>;
}

export function NoteEditor({ note, onSave, onClose }: { note: Note | null; onSave: (action: Action) => Promise<boolean>; onClose: () => void }) {
  const [draft, setDraft] = useState<Note>(() => note ? { ...note } : createNote());
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const busy = saving || importing;
  const empty = !draft.title.trim() && !draft.content.trim() && !draft.images?.length;
  const dirty = draft.title !== (note?.title ?? '') || draft.content !== (note?.content ?? '') || draft.color !== (note?.color ?? 'butter') || (draft.backgroundColor ?? null) !== (note?.backgroundColor ?? null) || draft.images !== note?.images;
  const close = () => { if (busy) return; if (dirty) setDiscard(true); else onClose(); };
  const save = async () => {
    if (busy || empty) return;
    setSaving(true);
    const values = { title: draft.title.trim(), content: draft.content, color: draft.color, backgroundColor: draft.backgroundColor, images: draft.images };
    const changes: Partial<Pick<Note, 'title' | 'content' | 'color' | 'backgroundColor' | 'images'>> = {};
    if (values.title !== note?.title) changes.title = values.title;
    if (values.content !== note?.content) changes.content = values.content;
    if (values.color !== note?.color) changes.color = values.color;
    if (values.backgroundColor !== note?.backgroundColor) changes.backgroundColor = values.backgroundColor;
    if (values.images !== note?.images) changes.images = values.images;
    const success = await onSave(note ? { type: 'note:update', id: note.id, changes } : { type: 'note:add', note: { ...draft, ...values } });
    setSaving(false);
    if (success) onClose();
  };
  return <Modal title={note ? '编辑便签' : '新建便签'} onClose={close} className="note-editor-modal">
    <div className={`note-editor ${draft.color} ${draft.backgroundColor ? 'custom-note' : ''}`} style={noteStyle(draft)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void save(); } }}>
      <input data-autofocus aria-label="便签标题" placeholder="便签标题" maxLength={120} disabled={busy} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} />
      <NoteBody content={draft.content} images={draft.images} disabled={busy} onTextChange={content => setDraft(current => ({ ...current, content }))} onImagesChange={images => setDraft(current => ({ ...current, images }))} onImportingChange={setImporting} onError={setError} />
      <div className="editor-bottom"><NoteColorPicker note={draft} disabled={busy} onChange={changes => setDraft({ ...draft, ...changes })} /><span>{draft.content.length} 字</span></div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {discard ? <div className="discard-prompt"><span>有尚未保存的内容，确定放弃吗？</span><button className="button small" onClick={() => setDiscard(false)}>继续编辑</button><button className="button danger small" onClick={onClose}>放弃更改</button></div> : <div className="modal-footer"><span className="shortcut-hint">Ctrl + Enter 快速保存</span><button className="button" disabled={busy} onClick={close}>取消</button><button className="button primary" disabled={busy || empty} onClick={() => void save()}><Check size={16} />{saving ? '保存中…' : importing ? '正在插入图片…' : '保存便签'}</button></div>}
  </Modal>;
}

export function NoteSelector({ notes, value = '', disabled = false, onSelect }: { notes: Note[]; value?: string; disabled?: boolean; onSelect: (id: string) => void }) {
  return <div className="note-selection"><select aria-label="选择便签" value={value} disabled={disabled || !notes.length} onChange={event => onSelect(event.target.value)}>
    {!value && <option value="" disabled>{notes.length ? '按标题选择便签' : '暂无便签'}</option>}
    {notes.map((note, index) => <option key={note.id} value={note.id}>{note.title.trim() || `无标题便签 ${index + 1}`}{note.title.trim() && notes.some(item => item.id !== note.id && item.title.trim() === note.title.trim()) ? ` (${index + 1})` : ''}</option>)}
  </select><span>{notes.length} 张</span></div>;
}

export function FloatingNote({ note, state, desktop = true }: { note: Note; state: AppState; desktop?: boolean }) {
  const [draft, setDraft] = useState({ title: note.title, content: note.content });
  const draftRef = useRef(draft);
  const dirty = useRef<Partial<Pick<Note, 'title' | 'content'>>>({});
  const pending = useRef(new Set<Promise<boolean>>());
  const changing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [focusedField, setFocusedField] = useState<'title' | 'content' | null>(null);
  const [status, setStatus] = useState('已保存到本地');
  const [error, setError] = useState('');

  useEffect(() => {
    if (pending.current.size || Object.keys(dirty.current).length) return;
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

  function flush(): Promise<boolean> {
    const changes = { ...dirty.current };
    if (!Object.keys(changes).length) return Promise.resolve(true);
    dirty.current = {};
    setStatus('保存中…');
    const save = api.dispatch({ type: 'note:update', id: note.id, changes }).then(() => {
      setError('');
      return true;
    }, cause => {
      // Retry the latest text, never an older failed keystroke acknowledgement.
      for (const field of Object.keys(changes) as ('title' | 'content')[]) dirty.current[field] = draftRef.current[field];
      setError(errorMessage(cause)); setStatus('保存失败，点击重试');
      return false;
    }).finally(() => {
      pending.current.delete(save);
      if (!pending.current.size && !Object.keys(dirty.current).length) setStatus('已保存到本地');
    });
    pending.current.add(save);
    return save;
  }

  // Flush on each blur (including clicking close); use beforeunload for pending edits on app quit.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const unload = () => { void flushRef.current(); };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  function change(field: 'title' | 'content', value: string) {
    setFocusedField(field);
    draftRef.current = { ...draftRef.current, [field]: value };
    setDraft(draftRef.current);
    dirty.current[field] = value;
    setStatus('正在编辑…');
    // Queue each edit immediately in the main process so quitting cannot lose a debounce buffer.
    void flush();
  }
  async function run(action: Action): Promise<boolean> {
    if (changing.current) return false;
    changing.current = true; setBusy(true);
    try {
      await Promise.all([...pending.current]);
      if (!await flush()) return false;
      await api.dispatch(action); setError(''); return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
    finally { changing.current = false; setBusy(false); }
  }
  const disabled = busy || importing;
  return <FrostedPanel state={state} title="便签" widgetKey="notes" icon={<StickyNote size={17} />} desktop={desktop} className={`floating-note ${note.color} ${note.backgroundColor ? 'custom-note' : ''}`} style={noteStyle(note)} onClose={() => { if (!disabled) void run({ type: 'note:update', id: note.id, changes: { pinned: false } }); }} actions={<>
    <button className="icon-button" aria-label="新建便签" title="新建便签" disabled={disabled} onClick={() => void run({ type: 'note:add', note: { ...createNote(), title: '新建便签', pinned: true } })}><Plus size={15} /></button>
    <button className="icon-button danger-hover" aria-label="删除当前便签" title="删除当前便签" disabled={disabled} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /></button>
  </>}>
    <NoteSelector notes={state.notes} value={note.id} disabled={disabled || confirmDelete} onSelect={id => void run({ type: 'note:selectDesktop', id })} />
    <input aria-label="便签标题" placeholder="无标题便签" value={draft.title} maxLength={120} disabled={disabled} onFocus={() => setFocusedField('title')} onPointerDown={() => setFocusedField('title')} onChange={event => change('title', event.target.value)} onBlur={() => { setFocusedField(null); void flush(); }} />
    <NoteBody content={draft.content} images={note.images} disabled={disabled} onTextChange={value => change('content', value)} onImagesChange={images => run({ type: 'note:update', id: note.id, changes: { images } })} onImportingChange={setImporting} onError={setError} textareaProps={{ onFocus: () => setFocusedField('content'), onPointerDown: () => setFocusedField('content'), onBlur: () => { setFocusedField(null); void flush(); } }} />
    {confirmDelete && <div className="note-delete-confirm" role="alertdialog" aria-label="删除便签"><p>删除「{draft.title || '无标题便签'}」及其中的图片？</p><div><button className="button small" disabled={disabled} onClick={() => setConfirmDelete(false)}>取消</button><button className="button danger small" disabled={disabled} onClick={() => void run({ type: 'note:delete', id: note.id })}>确认删除便签</button></div></div>}
    {error && <div className="floating-error" role="alert">{error}</div>}
    <footer><NoteColorPicker note={note} disabled={disabled} onChange={changes => void run({ type: 'note:update', id: note.id, changes })} /><button className="save-status" disabled={disabled} onClick={() => void flush()}>{importing ? '正在插入图片…' : status}</button></footer>
  </FrostedPanel>;
}
