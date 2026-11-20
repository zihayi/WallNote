import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronRight, CircleHelp, FolderOpen, Heart, Image, LayoutDashboard, Loader2, Maximize2, Minus, Monitor, PanelTop, Pin, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, StickyNote, Trash2, X } from 'lucide-react';
import type { Action, AppInfo, DesktopCommand, DesktopStatus, Note, Page, Wallpaper } from '../shared/types';
import { allWallpapers } from '../shared/state';
import { calendarEvents, dateKey } from '../shared/calendar';
import { api, errorMessage, isDesktop, wallpaperURL } from './api';
import { Modal } from './components/Modal';
import { NoteCard, NoteEditor } from './components/Notes';
import { TaskInput, TaskRow } from './components/Tasks';
import { PlannerWorkspace } from './components/Desktop';
import { CalendarPanel, HourlySchedule } from './components/Planner';
import { PhoneSettings } from './components/PhoneSettings';
import { PhoneSyncEntry, useManagerLink } from './components/PhoneSyncEntry';
import { GitPullRequest } from 'lucide-react';
import { CommunityPage, ModuleLayout } from './components/Community';
import { LayoutButton } from './components/LayoutStudio';
import { useAppState } from './use-app-state';
import { assignedModules } from '../shared/snap-layout';
import { modules } from '../shared/modules';
import { thumbnailURL } from '../shared/wallpapers';
import './manager.css';

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { id: 'calendar', label: '日历与日程', icon: CalendarDays },
  { id: 'community', label: '社区日报', icon: GitPullRequest },
  { id: 'wallpapers', label: '壁纸库', icon: Image },
  { id: 'notes', label: '便签', icon: StickyNote },
  { id: 'tasks', label: '待办清单', icon: CheckCircle2 },
];

function Brand() {
  return <div className="brand"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><span>WallNote</span></div>;
}

function Empty({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3></div>;
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className={`switch ${checked ? 'checked' : ''}`}><span /></button>;
}

export default function App() {
  const {state,loadError}=useAppState();
  const [page, setPage] = useState<Page>('dashboard');
  const [noteEditor, setNoteEditor] = useState<Note | 'new' | null>(null);
  const [preview, setPreview] = useState<Wallpaper | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; action: Action } | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean; id: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [wallpaperFilter, setWallpaperFilter] = useState('all');
  const [noteFilter, setNoteFilter] = useState('all');
  const [taskFilter, setTaskFilter] = useState('all');
  const [taskSort, setTaskSort] = useState('priority');
  const [busy, setBusy] = useState('');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus>({ enabled: true, active: false, displays: 0, widgets: 0, error: null });
  useManagerLink(true, !!state, page, setPage);

  useEffect(() => {
    let mounted = true;
    void api.getInfo().then(next => { if (mounted) setInfo(next); }).catch(() => undefined);
    let statusRevision = 0;
    const unsubscribeDesktop = api.onDesktopStatus(next => { statusRevision += 1; if (mounted) setDesktopStatus(next); });
    void api.getDesktopStatus().then(next => { if (mounted && !statusRevision) setDesktopStatus(next); }).catch(() => undefined);
    return () => { mounted = false; unsubscribeDesktop(); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setQuery(''); setSearchOpen(open => !open); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const notify = (message: string, error = false) => setToast({ message, error, id: Date.now() });
  async function run(action: Action): Promise<boolean> {
    try { await api.dispatch(action); return true; }
    catch (error) { notify(errorMessage(error), true); return false; }
  }
  async function desktopCommand(command: DesktopCommand) {
    setBusy('desktop');
    try { const status = await api.desktopControl(command); setDesktopStatus(status); if (status.error) notify(status.error, true); }
    catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }
  async function importWallpapers() {
    setBusy('import');
    try { const result = await api.importWallpapers(); if (result.count) { setWallpaperFilter('imported'); setPage('wallpapers'); notify(`已导入 ${result.count} 张壁纸`); } }
    catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }
  async function applyWallpaper(wallpaper: Wallpaper) {
    setBusy('apply');
    try { await api.applyWallpaper(wallpaper.id); notify(`已应用壁纸：${wallpaper.name}`); setPreview(null); }
    catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }
  async function backup(restore: boolean) {
    setBusy('backup');
    try {
      if (restore) { if (await api.restoreBackup()) notify('数据已恢复'); }
      else if (await api.exportBackup()) notify('备份已导出');
    } catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }

  if (loadError) return <div className="loading-screen"><Brand /><h2>加载失败</h2><p role="alert">{loadError}</p><button className="button primary" onClick={() => location.reload()}>重新加载</button></div>;
  if (!state) return <div className="loading-screen"><Brand /><Loader2 className="spin" size={24} /><p>加载中…</p></div>;

  const wallpapers = allWallpapers(state);
  const unfinished = state.tasks.filter(task => !task.completed);
  const completed = state.tasks.length - unfinished.length;
  const visibleWallpapers = page==='wallpapers'?wallpapers.filter(w => wallpaperFilter === 'all' || (wallpaperFilter === 'favorites' ? state.favorites.includes(w.id) : w.category === wallpaperFilter)):[];
  const visibleNotes = page==='notes'?state.notes.filter(n => noteFilter === 'all' || n.pinned).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)):[];
  const visibleTasks = page==='tasks'?state.tasks.filter(t => taskFilter === 'all' || (taskFilter === 'active' ? !t.completed : taskFilter === 'completed' ? t.completed : t.priority && !t.completed)).sort((a,b)=>taskSort==='priority'?Number(a.completed)-Number(b.completed)||Number(b.priority)-Number(a.priority):Date.parse(b.createdAt)-Date.parse(a.createdAt)):[];
  const normalizedQuery = searchOpen && query.trim().toLocaleLowerCase();
  const matches = (text: string) => !!normalizedQuery && text.toLocaleLowerCase().includes(normalizedQuery);
  const searchNotes = normalizedQuery?state.notes.filter(n => matches(`${n.title} ${n.content}`)).slice(0, 5):[];
  const searchTasks = normalizedQuery?state.tasks.filter(t => matches(t.text)).slice(0, 5):[];
  const searchWallpapers = normalizedQuery?wallpapers.filter(w => matches(`${w.name} ${w.description}`)).slice(0, 5):[];
  const searchEvents = normalizedQuery?calendarEvents(state).filter(event => matches(`${event.title} ${event.description} ${event.date}`)).slice(0, 5):[];
  const noteCard = (note: Note) => <NoteCard key={note.id} note={note} onEdit={() => setNoteEditor(note)} onPin={() => void run({ type: 'note:update', id: note.id, changes: { pinned: !note.pinned } })} onDelete={() => setConfirm({ title: '删除便签？', description: `将删除「${note.title || '无标题便签'}」。`, action: { type: 'note:delete', id: note.id } })} />;

  return <div className={`app-shell ${isDesktop ? 'desktop' : ''}`}>
    <aside className="sidebar">
      <Brand />
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} aria-label={item.label} className={`nav-item ${page === item.id ? 'selected' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'notes' && <span className="nav-count">{state.notes.length}</span>}{item.id === 'tasks' && unfinished.length > 0 && <span className="nav-count">{unfinished.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-shortcuts"><button onClick={() => setNoteEditor('new')}><Plus size={16} />新建便签</button></div><button aria-label="偏好设置" aria-current={page === 'settings' ? 'page' : undefined} className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')}><Settings size={19} /><span>偏好设置</span></button></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><button className="search-trigger" onClick={() => { setQuery(''); setSearchOpen(true); }} aria-label="搜索内容"><Search size={16} /><span>搜索</span><kbd>Ctrl K</kbd></button><div className="topbar-actions"><PhoneSyncEntry view={state.phoneSync} /></div>{isDesktop && <div className="window-controls"><button aria-label="最小化窗口" onClick={() => api.windowAction('minimize')}><Minus size={15} /></button><button aria-label="最大化或还原窗口" onClick={() => api.windowAction('maximize')}><Maximize2 size={13} /></button><button className="window-close" aria-label="关闭管理面板" onClick={() => api.windowAction('close')}><X size={17} /></button></div>}</header>
      <main className={`main-content ${page === 'dashboard' ? 'workspace-content' : ''}`} key={page}>
        {desktopStatus.error && <p role="alert" className="widget-error">{desktopStatus.error}</p>}

        {page === 'community' && <section id="community" tabIndex={-1}><CommunityPage state={state} /></section>}
        {page === 'dashboard' && <>
          <div className="page-heading compact-heading"><h1>桌面工作台</h1><div className="workspace-tools"><LayoutButton state={state}/>{isDesktop && <button className="button primary" disabled={!!busy} onClick={()=>void desktopCommand(desktopStatus.active?'showDesktop':'enable')}><Monitor size={15}/>{desktopStatus.active?'查看桌面':'开启桌面模式'}</button>}</div></div>
          <PlannerWorkspace state={state} />
        </>}

        {page === 'calendar' && <>
          <div className="page-heading"><h1>日历与日程</h1><button className="button" onClick={() => void run({ type: 'calendar:select', date: dateKey() })}>返回今天</button></div>
          <div className="calendar-management-grid"><HourlySchedule state={state} /><CalendarPanel state={state} /></div>
        </>}

        {page === 'wallpapers' && <>
          <div className="page-heading"><h1>壁纸库</h1><button className="button primary" disabled={!!busy} onClick={() => void importWallpapers()}>{busy === 'import' ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}导入壁纸</button></div>
          <div className="filter-bar"><div className="tabs">{[['all','全部'],['nature','风景'],['abstract','抽象'],['favorites','已收藏'],['imported','本地导入']].map(([id,label])=><button key={id} aria-pressed={wallpaperFilter===id} className={wallpaperFilter===id?'active':''} onClick={()=>setWallpaperFilter(id)}>{label}</button>)}</div></div>
          {visibleWallpapers.length ? <div className="wallpaper-grid">{visibleWallpapers.map(w => <article key={w.id} className="wallpaper-card">
            <div className="wallpaper-image-wrap"><button className="wallpaper-image-button" onClick={()=>setPreview(w)} aria-label={`预览壁纸：${w.name}`}><img src={thumbnailURL(w)} alt={w.name} loading="lazy" decoding="async"/></button>
              {state.appliedWallpaperId===w.id && <span className="wallpaper-status"><Check size={12}/>使用中</span>}
              <button className={`wallpaper-heart ${state.favorites.includes(w.id)?'favorited':''}`} aria-label={`收藏壁纸：${w.name}`} aria-pressed={state.favorites.includes(w.id)} onClick={()=>void run({type:'wallpaper:favorite',id:w.id})}><Heart size={16} fill={state.favorites.includes(w.id)?'currentColor':'none'}/></button></div>
            <div className="wallpaper-card-info"><h3>{w.name}</h3><div className="wallpaper-swatches" aria-hidden="true">{w.colors.map(c=><i key={c} style={{background:c}}/>)}</div>{w.category==='imported' && <button className="icon-button danger-hover" aria-label={`删除壁纸：${w.name}`} onClick={()=>setConfirm({title:'移除壁纸？',description:'只从壁纸库移除，原图会保留。',action:{type:'wallpaper:delete',id:w.id}})}><Trash2 size={16}/></button>}</div>
          </article>)}</div> : <Empty icon={<Image size={30}/>} title={wallpaperFilter==='favorites'?'还没有收藏壁纸':'暂无壁纸'}/>}
        </>}

        {page === 'notes' && <>
          <div className="page-heading"><h1>便签</h1><button className="button primary" onClick={() => setNoteEditor('new')}><Plus size={17} />新建便签</button></div>
          <div className="filter-bar"><div className="tabs"><button className={noteFilter === 'all' ? 'active' : ''} onClick={() => setNoteFilter('all')}>全部便签<span>{state.notes.length}</span></button><button className={noteFilter === 'pinned' ? 'active' : ''} onClick={() => setNoteFilter('pinned')}><Pin size={14} />桌面便签<span>{state.notes.filter(n => n.pinned).length}</span></button></div></div>
          {visibleNotes.length ? <div className="notes-grid full-notes-grid">{visibleNotes.map(noteCard)}</div> : <Empty icon={<StickyNote size={30} />} title={noteFilter==='pinned'?'桌面上还没有便签':'暂无便签'}/>}
        </>}

        {page === 'tasks' && <>
          <div className="page-heading"><h1>待办清单</h1></div>
          <section className="tasks-panel"><TaskInput onAction={run} /><div className="filter-bar"><div className="tabs">{[['all', '全部', state.tasks.length], ['active', '未完成', unfinished.length], ['completed', '已完成', completed], ['priority', '重要', state.tasks.filter(t => t.priority && !t.completed).length]].map(([id, label, count]) => <button key={id} className={taskFilter === id ? 'active' : ''} onClick={() => setTaskFilter(String(id))}>{label}<span>{count}</span></button>)}</div><label className="sort-control"><SlidersHorizontal size={14} /><select aria-label="待办排序" value={taskSort} onChange={event => setTaskSort(event.target.value)}><option value="priority">重要优先</option><option value="newest">最新创建</option></select></label></div><div className="full-task-list">{visibleTasks.length ? visibleTasks.map(task => <TaskRow key={task.id} task={task} onAction={run} />) : <Empty icon={<CheckCheck size={32} />} title="暂无待办事项" />}</div>{completed > 0 && <footer className="tasks-panel-footer"><button className="text-link subtle" onClick={() => setConfirm({ title: '清理已完成的待办？', description: `将移除 ${completed} 条已完成记录。`, action: { type: 'task:clearCompleted' } })}><Trash2 size={13} />清理已完成</button></footer>}</section>
        </>}

        {page === 'settings' && <>
          <div className="page-heading"><h1>偏好设置</h1>{info && <span className="version-tag">v{info.version}</span>}</div>
          <div className="settings-layout"><section className="settings-card"><div className="settings-section-title"><PanelTop size={19} /><h2>桌面组件</h2></div>
            <ModuleLayout state={state} />
            <div className="setting-row"><h3>桌面模式</h3><Switch label="桌面壁纸模式" disabled={!isDesktop||!!busy} checked={isDesktop && desktopStatus.enabled} onChange={() => void desktopCommand(desktopStatus.enabled ? 'disable' : 'enable')} /></div>
            {assignedModules(state.settings).map(id=>{const {name,flag}=modules[id];return <div className="setting-row" key={id}><h3>{name}</h3><Switch label={`显示${name}`} checked={state.settings[flag]!==false} onChange={()=>void run({type:'settings:update',changes:{[flag]:state.settings[flag]===false}})}/></div>;})}
            {assignedModules(state.settings).includes('drawer')&&<div className="setting-row"><h3>文件右键菜单</h3><select aria-label="文件右键菜单" value={state.settings.drawerMenuMode??'windows'} onChange={e=>void run({type:'settings:update',changes:{drawerMenuMode:e.target.value==='quick'?'quick':'windows'}})}><option value="windows">Windows 文件菜单</option><option value="quick">快捷菜单</option></select></div>}
            <div className="setting-row"><h3>毛玻璃背景</h3><Switch label="毛玻璃背景" checked={state.settings.glassEnabled!==false} onChange={()=>void run({type:'settings:update',changes:{glassEnabled:state.settings.glassEnabled===false}})}/></div>
            <div className="setting-row" title={!info?.supportsLaunchAtLogin?'仅 Windows 安装版支持':undefined}><h3>开机启动</h3><Switch label="开机启动" disabled={!info?.supportsLaunchAtLogin} checked={!!info?.supportsLaunchAtLogin && state.settings.launchAtLogin} onChange={() => void run({ type: 'settings:update', changes: { launchAtLogin: !state.settings.launchAtLogin } })} /></div>
            <div className="settings-buttons desktop-setting-actions"><button className="button" disabled={!!busy} onClick={() => void desktopCommand('resetLayout')}>重置桌面组件位置</button><button className="button" disabled={!!busy} onClick={() => void desktopCommand('quit')}>退出 WallNote</button></div>
          </section><PhoneSettings state={state}/><section className="settings-card data-settings"><div className="settings-section-title"><ShieldCheck size={19}/><h2>本地数据</h2></div><div className="data-path"><span>数据目录</span><code>{info?.dataPath ?? '读取中…'}</code><button className="icon-button" aria-label="打开数据文件夹" onClick={()=>void api.openDataFolder().catch(error=>notify(errorMessage(error),true))}><FolderOpen size={19}/></button></div><p className="settings-description">备份包含日程、便签和待办，不含壁纸图片。</p><div className="settings-buttons"><button className="button" disabled={!!busy} onClick={()=>void backup(false)}><ArrowDownToLine size={16}/>导出备份</button><button className="button" disabled={!!busy} onClick={()=>void backup(true)}><ArrowUpFromLine size={16}/>恢复备份</button></div></section></div>
        </>}
      </main>
    </div>

    {noteEditor !== null && <NoteEditor key={noteEditor === 'new' ? 'new' : noteEditor.id} note={noteEditor === 'new' ? null : noteEditor} onSave={async action => { const success = await run(action); if (success) notify('便签已保存'); return success; }} onClose={() => setNoteEditor(null)} />}
    {preview && <Modal title={preview.name} onClose={() => { if (!busy) setPreview(null); }} className="wallpaper-preview-modal"><img className="preview-image" src={wallpaperURL(preview)} alt={preview.name}/><div className="modal-footer"><button className={`icon-button ${state.favorites.includes(preview.id)?'favorited':''}`} aria-label="收藏预览壁纸" aria-pressed={state.favorites.includes(preview.id)} onClick={()=>void run({type:'wallpaper:favorite',id:preview.id})}><Heart size={19} fill={state.favorites.includes(preview.id)?'currentColor':'none'}/></button><button className="button" disabled={!!busy} onClick={async()=>{if(await run({type:'wallpaper:select',id:preview.id})){notify('预览已更新');setPreview(null);}}}>仅在工作台预览</button><button className="button primary" title={!isDesktop?'请在 Windows 桌面版设置':undefined} disabled={!!busy||!isDesktop} onClick={()=>void applyWallpaper(preview)}>{busy==='apply'?<Loader2 size={16} className="spin"/>:<Monitor size={16}/>}设为桌面壁纸</button></div></Modal>}
    {confirm && <Modal title={confirm.title} onClose={() => { if (!busy) setConfirm(null); }} className="confirm-modal"><div className="confirm-body"><span className="confirm-icon"><Trash2 size={24} /></span><p>{confirm.description}</p></div><div className="modal-footer"><button className="button" disabled={!!busy} onClick={() => setConfirm(null)}>取消</button><button className="button danger" disabled={!!busy} onClick={async () => { setBusy('delete'); if (await run(confirm.action)) { setConfirm(null); notify('已删除'); } setBusy(''); }}>确认删除</button></div></Modal>}
    {searchOpen && <Modal title="搜索" onClose={() => setSearchOpen(false)} className="search-modal"><div className="search-input-wrap"><Search size={21} /><input data-autofocus aria-label="搜索关键词" placeholder="搜索日程、便签、待办或壁纸" value={query} onChange={event => setQuery(event.target.value)} /><kbd>Esc</kbd></div><div className="search-results">{normalizedQuery && <>
      {searchEvents.length > 0 && <div className="search-group"><h3>日程</h3>{searchEvents.map(event => <button key={event.id} onClick={async () => { if (await run({ type: 'calendar:select', date: event.date })) { setSearchOpen(false); setPage('calendar'); } }}><CalendarDays size={17} /><span><strong>{event.title}</strong><small>{event.date} · {event.start}–{event.end}</small></span><ChevronRight size={15} /></button>)}</div>}
      {searchNotes.length > 0 && <div className="search-group"><h3>便签</h3>{searchNotes.map(n => <button key={n.id} onClick={() => { setSearchOpen(false); setNoteEditor(n); }}><StickyNote size={17} /><span><strong>{n.title || '无标题便签'}</strong><small>{n.content.slice(0, 70)}</small></span><ChevronRight size={15} /></button>)}</div>}
      {searchTasks.length > 0 && <div className="search-group"><h3>待办事项</h3>{searchTasks.map(t => <div className="search-task-result" key={t.id}><TaskRow task={t} onAction={run} compact /></div>)}</div>}
      {searchWallpapers.length > 0 && <div className="search-group"><h3>壁纸</h3>{searchWallpapers.map(w => <button key={w.id} onClick={() => { setSearchOpen(false); setPreview(w); }}><img src={thumbnailURL(w)} alt=""/><span><strong>{w.name}</strong></span><ChevronRight size={15} /></button>)}</div>}
      {!searchNotes.length && !searchTasks.length && !searchWallpapers.length && !searchEvents.length && <Empty icon={<Search size={26} />} title="没有匹配结果"/>}
    </>}</div></Modal>}
    {toast && <div key={toast.id} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
