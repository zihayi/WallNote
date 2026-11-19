import { useEffect, useState } from 'react';
import type { EventEditorData } from '../../shared/types';
import { api, errorMessage } from '../api';
import { EventEditor } from './Planner';

export function DesktopEventEditor() {
  const [data, setData] = useState<EventEditorData | null>(null);
  const [error, setError] = useState('');
  const loading = data === null;
  useEffect(() => { if (loading) return api.onEditorCloseRequest(api.finishEventEditor); }, [loading]);
  useEffect(() => {
    let alive = true, updated = false;
    let phone: EventEditorData['phoneSync'];
    const off = api.onStateChange(state => {
      if (!alive) return;
      updated = true; phone = state.phoneSync;
      setData(prev => prev && { ...prev, phoneSync: phone }); // Keep the original edit baseline and revision.
    });
    void api.getEventEditorData().then(initial => {
      if (alive) setData(updated ? { ...initial, phoneSync: phone } : initial);
    }).catch(cause => { if (alive) setError(errorMessage(cause)); });
    return () => { alive = false; off(); };
  }, []);
  if (!data) return <div className="loading-screen"><p>{error || '正在打开日程…'}</p><button className="button" onClick={api.finishEventEditor}>关闭</button></div>;
  return <EventEditor event={data.event} existing={data.existing} state={data} separateWindow
    onSave={async action => { await api.dispatch(action); return true; }} onClose={api.finishEventEditor} />;
}
