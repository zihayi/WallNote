import { useState } from 'react';
import { Plus, StickyNote } from 'lucide-react';
import { activeDesktopNote, createNote } from '../../shared/state';
import type { PanelProps } from '../module-views';
import { api, errorMessage } from '../api';
import { FrostedPanel } from './FrostedPanel';
import { FloatingNote } from './Notes';

export function NotesPanel({ state, desktop=false, noteId }:PanelProps) {
  const [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const note=noteId?state.notes.find(n=>n.id===noteId):activeDesktopNote(state);
  if(note)return <FloatingNote key={note.id} note={note} state={state} desktop={desktop}/>;
  const add = async () => {
    setBusy(true);
    try { await api.dispatch({ type: 'note:add', note: { ...createNote(), pinned: true } }); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <FrostedPanel state={state} title="便签" widgetKey="notes" icon={<StickyNote size={18} />} desktop={desktop} className="empty-notes-panel" onClose={desktop ? () => { void api.dispatch({ type: 'settings:update', changes: { showDesktopNotes: false } }).catch(cause => setError(errorMessage(cause))); } : undefined}>
    <div className="planner-empty"><button className="button" disabled={busy} onClick={() => void add()}><Plus size={15} />新建便签</button></div>
    {error && <p className="widget-error" role="alert">{error}</p>}
  </FrostedPanel>;
}
