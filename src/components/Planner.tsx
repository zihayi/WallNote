import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus, Trash2 } from 'lucide-react';
import type { Action, AppState, ScheduleEvent } from '../../shared/types';
import { createEvent, dateKey, eventError, eventsOnDate, monthDays, parseDate, selectedDate, shiftDate, validDate } from '../../shared/calendar';
import { api, errorMessage } from '../api';
import { ColorPicker } from './Notes';
import { Modal } from './Modal';
import { FrostedPanel } from './FrostedPanel';

type RunAction = (action: Action) => Promise<boolean>;
function useActions() {
  const [error, setError] = useState('');
  const run: RunAction = async action => {
    try { await api.dispatch(action); setError(''); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  };
  return { error, run };
}

export function EventEditor({ event, existing, onSave, onClose }: { event: ScheduleEvent; existing: boolean; onSave: RunAction; onClose: () => void }) {
  const [draft, setDraft] = useState({ ...event });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty = JSON.stringify(event) !== JSON.stringify(draft);
  const close = () => { if (busy) return; if (dirty) setConfirmDiscard(true); else onClose(); };
  const save = async () => {
    if (busy) return;
    const next = { ...draft, title: draft.title.trim(), description: draft.description.trim() };
    const message = eventError(next);
    if (message) { setError(message); return; }
    setBusy(true);
    let action: Action = { type: 'event:add', event: next };
    if (existing) {
      const changes: Partial<Omit<ScheduleEvent, 'id'>> = {};
      for (const key of ['title', 'date', 'start', 'end', 'description', 'color'] as const) if (next[key] !== event[key]) Object.assign(changes, { [key]: next[key] });
      action = { type: 'event:update', id: event.id, changes };
    }
    if (await onSave(action)) { await onSave({ type: 'calendar:select', date: next.date }); onClose(); }
    else setError('保存失败，请检查输入或稍后重试。');
    setBusy(false);
  };
  return <Modal title={existing ? '编辑日程' : '新建日程'} onClose={close} className="event-editor-modal">
    <form className="event-editor-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>标题<input data-autofocus aria-label="日程标题" maxLength={120} placeholder="例如：项目会议" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
      <label>日期<input type="date" aria-label="日程日期" min="1900-01-01" max="2100-12-31" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label>
      <div className="event-time-inputs"><label>开始时间<input type="time" aria-label="开始时间" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label><span>—</span><label>结束时间<input type="time" aria-label="结束时间" value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label></div>
      <label>备注<textarea aria-label="日程备注" placeholder="地点、说明等（选填）" maxLength={5000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <div className="event-color-row"><span>颜色</span><ColorPicker label="日程颜色" value={draft.color} onChange={color => setDraft({ ...draft, color })} /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {confirmDelete ? <div className="event-confirm"><p>确定删除这条日程？</p><button className="button small" type="button" onClick={() => setConfirmDelete(false)}>取消</button><button className="button danger small" type="button" disabled={busy} onClick={async () => { setBusy(true); if (await onSave({ type: 'event:delete', id: event.id })) onClose(); else setError('删除失败，请重试。'); setBusy(false); }}>确认删除日程</button></div> : confirmDiscard ? <div className="event-confirm"><p>放弃尚未保存的更改？</p><button className="button small" type="button" onClick={() => setConfirmDiscard(false)}>继续编辑</button><button className="button small danger" type="button" onClick={onClose}>放弃更改</button></div> : <div className="event-form-footer">{existing && <button type="button" className="icon-button danger-hover" aria-label="删除日程" onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>}<button type="button" className="button" onClick={close}>取消</button><button className="button primary" type="submit" disabled={busy}><Check size={15} />{busy ? '保存中…' : '保存日程'}</button></div>}
    </form>
  </Modal>;
}

function EventButton({ event, onClick }: { event: ScheduleEvent; onClick: () => void }) {
  return <button className={`schedule-event ${event.color}`} aria-label={`编辑日程：${event.title}`} onClick={onClick}><span className="schedule-event-time">{event.start}–{event.end}</span><strong>{event.title}</strong>{event.description && <span className="schedule-event-description">{event.description}</span>}</button>;
}

export function CalendarPanel({ state, desktop = false }: { state: AppState; desktop?: boolean }) {
  const date = selectedDate(state);
  const [month, setMonth] = useState(date.slice(0, 7));
  const [now, setNow] = useState(new Date());
  const [editor, setEditor] = useState<{ event: ScheduleEvent; existing: boolean } | null>(null);
  const { error, run } = useActions();
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  const days = useMemo(() => monthDays(month), [month]);
  const events = eventsOnDate(state, date);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const event of state.events ?? []) result.set(event.date, (result.get(event.date) ?? 0) + 1);
    return result;
  }, [state.events]);
  const changeMonth = (delta: number) => { const next = parseDate(`${month}-01`); next.setMonth(next.getMonth() + delta); const key = dateKey(next); if (validDate(key)) setMonth(key.slice(0, 7)); };
  const choose = async (key: string) => { if (await run({ type: 'calendar:select', date: key })) setMonth(key.slice(0, 7)); };
  return <FrostedPanel state={state} title="日历" widgetKey="calendar" icon={<CalendarDays size={18} />} desktop={desktop} className="calendar-panel" onClose={desktop ? () => void run({ type: 'settings:update', changes: { showDesktopCalendar: false } }) : undefined}>
    <div className="calendar-clock"><time>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time><span>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span></div>
    <div className="calendar-toolbar"><h3>{Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月</h3><div><button className="calendar-today" onClick={() => void choose(dateKey())}>今天</button><button className="icon-button" aria-label="上个月" disabled={month === '1900-01'} onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="下个月" disabled={month === '2100-12'} onClick={() => changeMonth(1)}><ChevronRight size={17} /></button></div></div>
    <div className="calendar-weekdays">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-grid" aria-label={`${month} 月历`}>{days.map(key => <button key={key} aria-label={`选择日期 ${key}`} aria-pressed={key === date} disabled={!validDate(key)} className={`${key.slice(0, 7) !== month ? 'outside-month' : ''} ${key === dateKey(now) ? 'today' : ''} ${key === date ? 'selected' : ''}`} onClick={() => void choose(key)}><span>{Number(key.slice(-2))}</span><span className="calendar-dots" aria-label={`${counts.get(key) ?? 0} 项安排`}>{Array.from({ length: Math.min(3, counts.get(key) ?? 0) }, (_, index) => <i key={index} />)}</span></button>)}</div>
    <div className="selected-day-heading"><div><h3>{parseDate(date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</h3><span>{events.length} 项安排</span></div><button className="icon-button" aria-label="为选中日期添加日程" onClick={() => setEditor({ event: createEvent(date), existing: false })}><Plus size={18} /></button></div>
    <div className="calendar-agenda">{events.length ? events.map(event => <EventButton key={event.id} event={event} onClick={() => setEditor({ event, existing: true })} />) : <div className="planner-empty"><CalendarDays size={24} /><p>当天暂无安排</p><button className="text-link" onClick={() => setEditor({ event: createEvent(date), existing: false })}>添加日程</button></div>}</div>
    {error && <p className="widget-error" role="alert">{error}</p>}
    {editor && <EventEditor key={editor.event.id} {...editor} onSave={run} onClose={() => setEditor(null)} />}
  </FrostedPanel>;
}

export function HourlySchedule({ state, desktop = false }: { state: AppState; desktop?: boolean }) {
  const date = selectedDate(state);
  const events = eventsOnDate(state, date);
  const [editor, setEditor] = useState<{ event: ScheduleEvent; existing: boolean } | null>(null);
  const { error, run } = useActions();
  const scroll = useRef<HTMLDivElement>(null);
  const firstTime = events[0]?.start;
  useEffect(() => {
    const hour = firstTime ? Math.max(0, Number(firstTime.slice(0, 2)) - 1) : date === dateKey() ? Math.max(0, new Date().getHours() - 1) : 8;
    const row = scroll.current?.querySelector<HTMLElement>(`[data-hour="${hour}"]`);
    if (row && scroll.current) scroll.current.scrollTop = row.offsetTop;
  }, [date, firstTime]);
  const moveDate = (delta: number) => { const next = shiftDate(date, delta); if (validDate(next)) void run({ type: 'calendar:select', date: next }); };
  return <FrostedPanel state={state} title="时间安排" widgetKey="schedule" icon={<Clock3 size={18} />} desktop={desktop} className="hourly-panel" onClose={desktop ? () => void run({ type: 'settings:update', changes: { showDesktopSchedule: false } }) : undefined}>
    <div className="schedule-day"><div><h3>{parseDate(date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</h3><span>{parseDate(date).toLocaleDateString('zh-CN', { weekday: 'long' })} · {events.length} 项安排</span></div><div><button className="icon-button" aria-label="前一天" disabled={date === '1900-01-01'} onClick={() => moveDate(-1)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="后一天" disabled={date === '2100-12-31'} onClick={() => moveDate(1)}><ChevronRight size={17} /></button></div></div>
    <div className="hourly-list" ref={scroll} aria-label={`${date} 按小时日程`}>{Array.from({ length: 24 }, (_, hour) => {
      const rows = events.filter(event => Number(event.start.slice(0, 2)) === hour);
      const hourText = `${String(hour).padStart(2, '0')}:00`;
      return <div key={hour} data-hour={hour} className={`hour-row ${date === dateKey() && new Date().getHours() === hour ? 'current-hour' : ''}`}><button className="hour-label" aria-label={`在 ${hourText} 添加日程`} onClick={() => setEditor({ event: createEvent(date, hour), existing: false })}>{hourText}</button><div className="hour-events">{rows.map(event => <EventButton key={event.id} event={event} onClick={() => setEditor({ event, existing: true })} />)}<button className={`hour-add ${rows.length ? 'has-events' : ''}`} aria-label={`添加 ${hourText} 的安排`} onClick={() => setEditor({ event: createEvent(date, hour), existing: false })}><Plus size={13} /><span>添加安排</span></button></div></div>;
    })}</div>
    <button className="schedule-add button" onClick={() => setEditor({ event: createEvent(date), existing: false })}><Plus size={15} />添加日程</button>
    {error && <p className="widget-error" role="alert">{error}</p>}
    {editor && <EventEditor key={editor.event.id} {...editor} onSave={run} onClose={() => setEditor(null)} />}
  </FrostedPanel>;
}
