import { useState } from 'react';
import { RefreshCw, Smartphone, Unplug, Upload } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { emptyPhoneSync } from '../../shared/phone';
import { api, errorMessage } from '../api';

export function PhoneSettings({ state }: { state: AppState }) {
  const view = state.phoneSync ?? emptyPhoneSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const command = async (action: 'connect' | 'refresh' | 'disconnect' | 'calendar', id?: string) => {
    setBusy(true); setError('');
    try { const result = await api.phoneSyncControl(action, id); if (result.error) setError(result.error); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <section className="settings-card phone-settings">
    <div className="settings-section-title"><Smartphone size={19} /><h2>手机日历同步</h2></div>
    <p className="settings-description">电脑运行 CalendarBridge 接收服务，手机导入配对文件并同步一次。在这里选择接收服务生成的 <code>wallnote-connection.json</code>。</p>
    <div className={`phone-connection-status ${view.connected ? 'connected' : ''}`}><i /><div><strong>{view.connected ? '接收服务已连接' : view.configured ? '接收服务未连接' : '尚未连接'}</strong><span>{view.device || '等待手机首次同步'}{view.device ? ` · ${view.phoneOnline ? '手机在线' : '手机离线'}` : ''}</span></div></div>
    {view.lastSync && <p className="settings-description">最近快照：{new Date(view.lastSync).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</p>}
    <label className="phone-calendar-select">本地日程写入的手机日历<select aria-label="手机写入日历" disabled={busy || !view.connected} value={view.calendarId ?? ''} onChange={event => { if (event.target.value) void command('calendar', event.target.value); }}><option value="">请选择可写日历</option>{view.calendars.map(calendar => <option key={calendar.id} value={calendar.id} disabled={!calendar.writable}>{calendar.name}{calendar.writable ? '' : '（只读）'}</option>)}</select></label>
    <p className="settings-description">手机日程按北京时间显示。打开本地日程可“发送到手机”；手机开启电脑编辑后才会执行。重复、全天及跨天日程在 WallNote 中只读，不支持删除手机日程。</p>
    {view.configured && <div className="phone-permission-status"><span>{view.canWrite ? '手机已允许电脑编辑' : '手机尚未允许电脑编辑'}</span><span>{view.pending} 项操作待确认</span></div>}
    {(error || view.error) && <p className="form-error" role="alert">{error || view.error}</p>}
    <div className="settings-buttons"><button className="button" disabled={busy} onClick={() => void command('connect')}><Upload size={15} />{view.configured ? '更换连接配置' : '连接接收服务'}</button>{view.configured && <><button className="button" disabled={busy} onClick={() => void command('refresh')}><RefreshCw size={15} />刷新</button><button className="button" disabled={busy} onClick={() => void command('disconnect')}><Unplug size={15} />断开</button></>}</div>
  </section>;
}
