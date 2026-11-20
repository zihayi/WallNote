import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Smartphone, Unplug, Upload, Wifi } from 'lucide-react';
import type { AppState, WifiReceiverView } from '../../shared/types';
import { emptyPhoneSync, PHONE_SYNC, phoneCalendarLabel, phoneConnection } from '../../shared/phone';
import { api, errorMessage, isDesktop } from '../api';

export function PhoneSettings({ state }: { state: AppState }) {
  const view = state.phoneSync ?? emptyPhoneSync();
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const revision = useRef(0);
  const connection = phoneConnection(view);
  const disabled = !!busy || !isDesktop;
  const [wifi, setWifi] = useState<WifiReceiverView>({ running: false, discoveryAvailable: false, discoveryPort: 0, pairingUntil: 0, requests: [], error: null });
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);
  useEffect(() => {
    if (!isDesktop) return;
    let active = true, pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const before = revision.current;
      try { const next = await api.wifiReceiverControl('status'); if (active && before === revision.current) setWifi(next); }
      catch { /* Connection actions report errors explicitly. */ }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    document.addEventListener('visibilitychange',refresh);
    return () => { active = false; clearInterval(timer);document.removeEventListener('visibilitychange',refresh); };
  }, []);
  const pairing = async (action: 'pair' | 'approve' | 'reject', id?: string) => {
    setBusy(action); setError(''); setFeedback('');
    try { const next = await api.wifiReceiverControl(action, id); revision.current++; setWifi(next); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  };
  const command = async (action: 'connect' | 'refresh' | 'disconnect' | 'calendar', id?: string) => {
    setBusy(action); setError(''); setFeedback('');
    try {
      const result = await api.phoneSyncControl(action, id);
      if (result.error) setError(result.error);
      else if (action === 'refresh') setFeedback('连接状态已刷新。');
    }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(''); }
  };
  const known = !!(view.device || view.lastSync);
  const labels = view.calendars.map(calendar => phoneCalendarLabel(calendar.name));
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return <section id="phone-sync" tabIndex={-1} aria-labelledby="phone-sync-heading" className="settings-card phone-settings">
    <div className="settings-section-title"><Smartphone size={19} /><h2 id="phone-sync-heading">{PHONE_SYNC}</h2></div>
    <div className="phone-connection-status" data-tone={isDesktop ? connection.tone : 'idle'} role="status"><i /><div><strong>{isDesktop ? connection.label : '浏览器预览'}</strong><span>{isDesktop ? connection.detail : '请在 Windows 桌面版中配对手机。'}</span>
      {view.lastSync && <span>最近同步：{new Date(view.lastSync).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</span>}</div></div>
    <div className="settings-buttons"><button className={`button ${known ? '' : 'primary'}`} disabled={disabled} onClick={() => void pairing('pair')}><Wifi size={15} />配对手机</button>
      {view.configured && <button className={`button ${known ? 'primary' : ''}`} disabled={disabled} onClick={() => void command('refresh')}><RefreshCw size={15} className={busy === 'refresh' ? 'spin' : ''} />{busy === 'refresh' ? '正在刷新…' : view.connected ? '刷新状态' : '重试连接'}</button>}</div>
    {feedback && <p className="phone-action-feedback" role="status">{feedback}</p>}
    {wifi.pairingUntil > Date.now() / 1000 && <p className="settings-description">请在同一 Wi-Fi 下用手机搜索这台电脑。验证码两分钟内有效。</p>}
    {wifi.requests.map(request => <div className="phone-pair-request" key={request.id}><strong>{request.device}</strong><p>核对手机显示的验证码</p><div className="phone-pair-code">{request.code}</div><div className="settings-buttons"><button className="button primary" disabled={disabled} onClick={() => void pairing('approve', request.id)}>验证码一致，允许配对</button><button className="button" disabled={disabled} onClick={() => void pairing('reject', request.id)}>拒绝</button></div></div>)}
    {wifi.error && <p className="form-error" role="alert">{wifi.error}</p>}
    {view.configured&&<label className="phone-calendar-select">写入日历<select aria-label="手机写入日历" disabled={disabled || !view.connected} value={view.calendarId ?? ''} onChange={event => { if (event.target.value) void command('calendar', event.target.value); }}><option value="">请选择可写日历</option>{view.calendars.map((calendar, i) => <option key={calendar.id} value={calendar.id} disabled={!calendar.writable}>{labels[i]}{counts.get(labels[i])! > 1 ? ` · #${calendar.id}` : ''}{calendar.writable ? '' : '（只读）'}</option>)}</select></label>}
    {view.configured && <div className="phone-permission-status"><span>{view.canWrite ? '手机已允许电脑编辑' : '手机尚未允许电脑编辑'}</span><span>{view.pending} 项操作待确认</span></div>}
    {error && error !== view.error && <p className="form-error" role="alert">{error}</p>}
    <details className="phone-advanced"><summary>高级：连接独立接收服务</summary><div className="settings-buttons"><button className="button" disabled={disabled} onClick={() => void command('connect')}><Upload size={15} />{view.configured ? '更换连接配置' : '连接接收服务'}</button>{view.configured && <button className="button" disabled={disabled} onClick={() => void command('disconnect')}><Unplug size={15} />断开</button>}</div></details>
  </section>;
}
