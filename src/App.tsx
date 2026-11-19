import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronRight, CircleHelp, CloudOff, FolderOpen, Heart, Image, LayoutDashboard, Loader2, Maximize2, Minus, Monitor, PanelTop, Pin, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, StickyNote, Trash2, X } from 'lucide-react';
import type { Action, AppInfo, AppState, DesktopCommand, DesktopStatus, Note, Page, Wallpaper } from '../shared/types';
import { allWallpapers } from '../shared/state';
import { calendarEvents, dateKey } from '../shared/calendar';
import { api, errorMessage, isDesktop, wallpaperURL } from './api';
import { Modal } from './components/Modal';
import { FloatingNote, NoteCard, NoteEditor } from './components/Notes';
import { TaskInput, TaskRow } from './components/Tasks';
import { DesktopTasks, DesktopWallpaper, EmptyNotesPanel, PlannerWorkspace } from './components/Desktop';
import { CalendarPanel, HourlySchedule } from './components/Planner';
import { PhoneSettings } from './components/PhoneSettings';
import { PhoneSyncEntry, useManagerLink } from './components/PhoneSyncEntry';
import { GitPullRequest } from 'lucide-react';
import { CommunityPanel, CommunityPage, ModuleLayout } from './components/Community';
import { LayoutButton } from './components/LayoutStudio';
import { FileDrawerPanel } from './components/FileDrawer';

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '工作台', icon: LayoutDashboard },
  { id: 'calendar', label: '日历与日程', icon: CalendarDays },
  { id: 'community', label: '社区日报', icon: GitPullRequest },
  { id: 'wallpapers', label: '壁纸库', icon: Image },
  { id: 'notes', label: '便签', icon: StickyNote },
  { id: 'tasks', label: '待办清单', icon: CheckCircle2 },
];

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'small' : ''}`}><div className="brand-mark"><span /><span /><span /></div><span>WallNote<i /></span></div>;
}

function Empty({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{children}</div>;
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className={`switch ${checked ? 'checked' : ''}`}><span /></button>;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState('');
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
  const [now, setNow] = useState(new Date());
  const floatingId = useMemo(() => new URLSearchParams(window.location.search).get('note'), []);
  const desktopView = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('wallpaper') ? 'wallpaper' : params.has('workspace') ? 'workspace' : params.get('widget');
  }, []);
  useManagerLink(!floatingId && !desktopView, !!state, page, setPage);

  useEffect(() => {
    document.documentElement.dataset.view = floatingId || (desktopView && !['workspace', 'wallpaper'].includes(desktopView)) ? 'widget' : desktopView ?? 'manager';
    return () => { delete document.documentElement.dataset.view; };
  }, [floatingId, desktopView]);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    const unsubscribe = api.onStateChange(next => { revision += 1; if (mounted) setState(next); });
    void api.getState().then(next => { if (mounted && revision === 0) setState(next); }).catch(error => { if (mounted) setLoadError(errorMessage(error)); });
    void api.getInfo().then(next => { if (mounted) setInfo(next); }).catch(() => undefined);
    let statusRevision = 0;
    const unsubscribeDesktop = api.onDesktopStatus(next => { statusRevision += 1; if (mounted) setDesktopStatus(next); });
    void api.getDesktopStatus().then(next => { if (mounted && !statusRevision) setDesktopStatus(next); }).catch(() => undefined);
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => { mounted = false; unsubscribe(); unsubscribeDesktop(); clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (floatingId || desktopView) return;
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setQuery(''); setSearchOpen(open => !open); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [floatingId, desktopView]);

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
  if (desktopView === 'wallpaper') return <DesktopWallpaper state={state} />;
  if (desktopView === 'workspace') return <PlannerWorkspace state={state} standalone />;
  if (desktopView === 'tasks') return <DesktopTasks state={state} desktop />;
  if (desktopView === 'calendar') return <CalendarPanel state={state} desktop />;
  if (desktopView === 'schedule') return <HourlySchedule state={state} desktop />;
  if (desktopView === 'community') return <CommunityPanel state={state} desktop />;
  if (desktopView === 'drawer') return <FileDrawerPanel state={state} desktop />;
  if (desktopView === 'notes-empty') return <EmptyNotesPanel state={state} desktop />;
  if (floatingId) {
    const note = state.notes.find(n => n.id === floatingId);
    return note ? <FloatingNote note={note} state={state} /> : <div className="loading-screen"><p>便签已删除</p></div>;
  }

  const wallpapers = allWallpapers(state);
  const unfinished = state.tasks.filter(task => !task.completed);
  const completed = state.tasks.length - unfinished.length;
  const progress = state.tasks.length ? Math.round(completed / state.tasks.length * 100) : 0;
  const sortedTasks = [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.priority) - Number(a.priority));
  const visibleWallpapers = wallpapers.filter(w => wallpaperFilter === 'all' || (wallpaperFilter === 'favorites' ? state.favorites.includes(w.id) : w.category === wallpaperFilter));
  const visibleNotes = [...state.notes].filter(n => noteFilter === 'all' || n.pinned).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const visibleTasks = (taskSort === 'priority' ? sortedTasks : [...state.tasks].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))).filter(t => taskFilter === 'all' || (taskFilter === 'active' ? !t.completed : taskFilter === 'completed' ? t.completed : t.priority && !t.completed));
  const currentLabel = page === 'settings' ? '偏好设置' : navigation.find(item => item.id === page)!.label;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (text: string) => normalizedQuery && text.toLocaleLowerCase().includes(normalizedQuery);
  const searchNotes = state.notes.filter(n => matches(`${n.title} ${n.content}`)).slice(0, 5);
  const searchTasks = state.tasks.filter(t => matches(t.text)).slice(0, 5);
  const searchWallpapers = wallpapers.filter(w => matches(`${w.name} ${w.description}`)).slice(0, 5);
  const searchEvents = calendarEvents(state).filter(event => matches(`${event.title} ${event.description} ${event.date}`)).slice(0, 5);
  const noteCard = (note: Note) => <NoteCard key={note.id} note={note} onEdit={() => setNoteEditor(note)} onPin={() => void run({ type: 'note:update', id: note.id, changes: { pinned: !note.pinned } })} onDelete={() => setConfirm({ title: '删除便签？', description: `将删除「${note.title || '无标题便签'}」。`, action: { type: 'note:delete', id: note.id } })} />;

  return <div className={`app-shell ${isDesktop ? 'desktop' : ''}`}>
    <aside className="sidebar">
      <Brand /><div className="brand-tagline">桌面日程管理</div><div className="nav-label">管理面板</div>
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} aria-label={item.label} className={`nav-item ${page === item.id ? 'selected' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'notes' && <span className="nav-count">{state.notes.length}</span>}{item.id === 'tasks' && unfinished.length > 0 && <span className="nav-count">{unfinished.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-shortcuts"><button onClick={() => setNoteEditor('new')}><Plus size={16} />新建便签</button><button onClick={() => { setPage('calendar'); void run({ type: 'calendar:select', date: dateKey() }); }}><CalendarDays size={16} />查看今日日程</button></div><button aria-label="偏好设置" aria-current={page === 'settings' ? 'page' : undefined} className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')}><Settings size={19} /><span>偏好设置</span></button><div className="local-status"><span />数据保存在本地<ShieldCheck size={13} /></div></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>WallNote</span><ChevronRight size={13} /><strong>{currentLabel}</strong></div><div className="topbar-actions"><button className="search-trigger" onClick={() => { setQuery(''); setSearchOpen(true); }} aria-label="搜索内容"><Search size={16} /><span>搜索</span><kbd>Ctrl K</kbd></button><span className="topbar-divider" /><PhoneSyncEntry view={state.phoneSync} /></div>{isDesktop && <div className="window-controls"><button aria-label="最小化窗口" onClick={() => api.windowAction('minimize')}><Minus size={15} /></button><button aria-label="最大化或还原窗口" onClick={() => api.windowAction('maximize')}><Maximize2 size={13} /></button><button className="window-close" aria-label="关闭管理面板" onClick={() => api.windowAction('close')}><X size={17} /></button></div>}</header>
      <main className={`main-content ${page === 'dashboard' ? 'workspace-content' : ''}`} key={page}>
        {isDesktop && <div className={`desktop-mode-banner ${desktopStatus.error ? 'has-error' : ''}`}><Monitor size={19} /><div><strong>{desktopStatus.active ? '桌面模式已开启' : desktopStatus.enabled ? '正在连接桌面…' : '桌面模式已暂停'}</strong><p>{desktopStatus.error || (desktopStatus.active ? `${desktopStatus.displays} 块屏幕 · ${desktopStatus.widgets} 个桌面组件` : '开启后在 Windows 桌面显示日历、时间安排、待办和便签。')}</p></div><button className="button small" disabled={!!busy} onClick={() => void desktopCommand(desktopStatus.active ? 'showDesktop' : 'enable')}>{desktopStatus.active ? '查看桌面' : '开启桌面模式'}<ArrowRight size={14} /></button></div>}

        {page === 'community' && <section id="community" tabIndex={-1}><CommunityPage state={state} /></section>}
        {page === 'dashboard' && <>
          <div className="page-heading compact-heading"><div><h1>桌面工作台</h1><p>拖动桌面卡片的标题或边角，松手保存布局。</p></div><div className="workspace-tools"><span className="workspace-date"><CalendarDays size={16} />{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><LayoutButton state={state}/></div></div>
          <PlannerWorkspace state={state} />
        </>}

        {page === 'calendar' && <>
          <div className="page-heading"><div><h1>日历与日程</h1><p>选择日期查看、添加或编辑安排。</p></div><button className="button" onClick={() => void run({ type: 'calendar:select', date: dateKey() })}>返回今天</button></div>
          <div className="calendar-management-grid"><HourlySchedule state={state} /><CalendarPanel state={state} /></div>
        </>}

        {page === 'wallpapers' && <>
          <div className="page-heading"><div><h1>壁纸库</h1><p>选择内置壁纸或导入本地图片。</p></div><button className="button primary" disabled={!!busy} onClick={() => void importWallpapers()}>{busy === 'import' ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}导入本地壁纸</button></div>
          <div className="filter-bar"><div className="tabs">{[['all', '全部壁纸'], ['nature', '自然风景'], ['abstract', '抽象壁纸'], ['favorites', '已收藏'], ['imported', '本地导入']].map(([id, label]) => <button key={id} className={wallpaperFilter === id ? 'active' : ''} onClick={() => setWallpaperFilter(id)}>{id === 'favorites' && <Heart size={14} />}{label}{id === 'all' && <span>{wallpapers.length}</span>}</button>)}</div><span className="result-count">{visibleWallpapers.length} 张壁纸</span></div>
          {visibleWallpapers.length ? <div className="wallpaper-grid">{visibleWallpapers.map(w => <article key={w.id} className="wallpaper-card"><div className="wallpaper-image-wrap"><button className="wallpaper-image-button" onClick={() => setPreview(w)} aria-label={`预览壁纸：${w.name}`}><img src={wallpaperURL(w)} alt={w.name} loading="lazy" /><span className="wallpaper-hover"><Maximize2 size={19} />预览壁纸</span></button>{state.appliedWallpaperId === w.id && <span className="wallpaper-status"><Check size={12} />使用中</span>}<button className={`wallpaper-heart ${state.favorites.includes(w.id) ? 'favorited' : ''}`} aria-label={`收藏壁纸：${w.name}`} aria-pressed={state.favorites.includes(w.id)} onClick={() => void run({ type: 'wallpaper:favorite', id: w.id })}><Heart size={16} fill={state.favorites.includes(w.id) ? 'currentColor' : 'none'} /></button></div><div className="wallpaper-card-info"><div><h3>{w.name}</h3><p>{w.category === 'nature' ? '自然风景' : w.category === 'abstract' ? '抽象壁纸' : '本地图片'}</p></div><div className="wallpaper-swatches">{w.colors.map(color => <i key={color} style={{ background: color }} />)}</div>{w.category === 'imported' && <button className="icon-button danger-hover" aria-label={`删除壁纸：${w.name}`} onClick={() => setConfirm({ title: '移除壁纸？', description: '从壁纸库移除，原始图片会保留。', action: { type: 'wallpaper:delete', id: w.id } })}><Trash2 size={16} /></button>}</div></article>)}</div> : <Empty icon={<Image size={30} />} title="暂无壁纸" description={wallpaperFilter === 'favorites' ? '点击壁纸右上角的爱心收藏。' : '点击“导入本地壁纸”添加图片。'} />}
          <div className="gentle-tip"><ShieldCheck size={16} /><span>支持 JPG、PNG、WebP、BMP；内置壁纸可离线使用。</span></div>
        </>}

        {page === 'notes' && <>
          <div className="page-heading"><div><h1>便签</h1><p>编辑内容，或点击显示按钮加入桌面便签。</p></div><button className="button primary" onClick={() => setNoteEditor('new')}><Plus size={17} />新建便签</button></div>
          <div className="filter-bar"><div className="tabs"><button className={noteFilter === 'all' ? 'active' : ''} onClick={() => setNoteFilter('all')}>全部便签<span>{state.notes.length}</span></button><button className={noteFilter === 'pinned' ? 'active' : ''} onClick={() => setNoteFilter('pinned')}><Pin size={14} />桌面便签<span>{state.notes.filter(n => n.pinned).length}</span></button></div><span className="result-count">按最近编辑排序</span></div>
          {visibleNotes.length ? <div className="notes-grid full-notes-grid">{visibleNotes.map(noteCard)}<button className="add-note-card" onClick={() => setNoteEditor('new')}><Plus size={25} /><span>新建便签</span></button></div> : <Empty icon={<StickyNote size={30} />} title="暂无便签" description={noteFilter === 'pinned' ? '在全部便签中点击显示按钮，将便签加入桌面。' : '点击“新建便签”添加内容。'} />}
        </>}

        {page === 'tasks' && <>
          <div className="page-heading"><div><h1>待办清单</h1><p>添加、完成和管理待办事项。</p></div><div className="task-summary"><span className="summary-ring" style={{ background: `conic-gradient(var(--green) ${progress}%, #e6ece8 0)` }}><span>{progress}<small>%</small></span></span><div><strong>{completed} / {state.tasks.length}</strong><span>已完成</span></div></div></div>
          <section className="tasks-panel"><TaskInput onAction={run} /><div className="filter-bar"><div className="tabs">{[['all', '全部', state.tasks.length], ['active', '进行中', unfinished.length], ['completed', '已完成', completed], ['priority', '重要', state.tasks.filter(t => t.priority && !t.completed).length]].map(([id, label, count]) => <button key={id} className={taskFilter === id ? 'active' : ''} onClick={() => setTaskFilter(String(id))}>{label}<span>{count}</span></button>)}</div><label className="sort-control"><SlidersHorizontal size={14} /><select aria-label="待办排序" value={taskSort} onChange={event => setTaskSort(event.target.value)}><option value="priority">重要优先</option><option value="newest">最新创建</option></select></label></div><div className="full-task-list">{visibleTasks.length ? visibleTasks.map(task => <TaskRow key={task.id} task={task} onAction={run} />) : <Empty icon={<CheckCheck size={32} />} title="暂无待办事项" description="在上方输入内容添加任务。" />}</div><footer className="tasks-panel-footer"><span>{unfinished.length} 项未完成</span>{completed > 0 && <button className="text-link subtle" onClick={() => setConfirm({ title: '清理已完成的待办？', description: `将移除 ${completed} 条已完成记录。`, action: { type: 'task:clearCompleted' } })}><Trash2 size={13} />清理已完成</button>}</footer></section>
        </>}

        {page === 'settings' && <>
          <div className="page-heading"><div><h1>偏好设置</h1><p>手机同步、桌面组件与本地数据。</p></div><span className="version-tag">v{info?.version ?? '0.9.0'}</span></div>
          <div className="settings-layout"><div><PhoneSettings state={state} /><section className="settings-card"><div className="settings-section-title"><PanelTop size={19} /><h2>桌面组件</h2></div>
            <ModuleLayout state={state} />
            <div className="setting-row"><div><h3>桌面模式</h3><p>组件默认位于图标下方，直接拖动即可整理；点击图钉可置于其他窗口上方。</p></div><Switch label="桌面壁纸模式" checked={isDesktop && desktopStatus.enabled} onChange={() => void desktopCommand(desktopStatus.enabled ? 'disable' : 'enable')} /></div>
            {([
              ['showDesktopSchedule', '显示时间安排', '左侧显示选中日期的按小时日程'],
              ['showDesktopCalendar', '显示日历', '中间显示月历和日期安排'],
              ['showDesktopTasks', '显示桌面待办', '右侧显示待办清单'],
              ['showDesktopNotes', '显示桌面便签', '右侧显示已贴出的便签'],
              ['glassEnabled', '毛玻璃背景', '为各组件添加圆角、半透明和模糊背景'],
            ] as const).map(([key, label, description]) => <div className="setting-row" key={key}><div><h3>{label}</h3><p>{description}</p></div><Switch label={label} checked={state.settings[key] !== false} onChange={() => void run({ type: 'settings:update', changes: { [key]: state.settings[key] === false } })} /></div>)}
            <div className="setting-row"><div><h3>开机启动</h3><p>{info?.supportsLaunchAtLogin ? '登录 Windows 后自动启动 WallNote' : '使用 Windows 安装版可开启'}</p></div><Switch label="开机启动" disabled={!info?.supportsLaunchAtLogin} checked={!!info?.supportsLaunchAtLogin && state.settings.launchAtLogin} onChange={() => void run({ type: 'settings:update', changes: { launchAtLogin: !state.settings.launchAtLogin } })} /></div>
            <div className="settings-buttons desktop-setting-actions"><button className="button" disabled={!!busy} onClick={() => void desktopCommand('resetLayout')}>重置桌面组件位置</button><button className="button" disabled={!!busy} onClick={() => void desktopCommand('quit')}>退出 WallNote</button></div>
          </section><section className="settings-card"><div className="settings-section-title"><ShieldCheck size={19} /><h2>本地数据</h2></div><div className="data-summary"><span><CalendarDays size={17} /><strong>{state.events?.length ?? 0}</strong> 条日程</span><span><StickyNote size={17} /><strong>{state.notes.length}</strong> 张便签</span><span><CheckCircle2 size={17} /><strong>{state.tasks.length}</strong> 条待办</span></div><div className="data-path"><span>数据保存位置</span><code>{info?.dataPath ?? '读取中…'}</code><button className="icon-button" aria-label="打开数据文件夹" onClick={() => void api.openDataFolder().catch(error => notify(errorMessage(error), true))}><FolderOpen size={19} /></button></div><p className="settings-description">JSON 备份包含日程、便签和待办。图片需通过数据文件夹单独备份；恢复旧版备份时会保留当前日程。</p><div className="settings-buttons"><button className="button" disabled={!!busy} onClick={() => void backup(false)}><ArrowDownToLine size={16} />导出备份</button><button className="button" disabled={!!busy} onClick={() => void backup(true)}><ArrowUpFromLine size={16} />恢复备份</button></div></section></div>
          <aside className="about-card"><Brand small /><p>Windows 桌面日程管理</p><Monitor className="about-monitor" size={70} strokeWidth={1} /><div className="offline-badge"><CloudOff size={14} />离线使用 · 本地存储</div><div className="settings-help"><CircleHelp size={15} /><span>关闭管理面板后继续在托盘运行。双击托盘图标或按 Ctrl + Alt + W 打开管理面板。</span></div></aside></div>
        </>}
      </main>
    </div>

    {noteEditor !== null && <NoteEditor key={noteEditor === 'new' ? 'new' : noteEditor.id} note={noteEditor === 'new' ? null : noteEditor} onSave={async action => { const success = await run(action); if (success) notify('便签已保存'); return success; }} onClose={() => setNoteEditor(null)} />}
    {preview && <Modal title="壁纸预览" onClose={() => { if (!busy) setPreview(null); }} className="wallpaper-preview-modal"><img className="preview-image" src={wallpaperURL(preview)} alt={preview.name} /><div className="preview-details"><div><h2>{preview.name}</h2><p>{preview.description}</p></div><button className={`icon-button ${state.favorites.includes(preview.id) ? 'favorited' : ''}`} aria-label="收藏预览壁纸" aria-pressed={state.favorites.includes(preview.id)} onClick={() => void run({ type: 'wallpaper:favorite', id: preview.id })}><Heart size={21} fill={state.favorites.includes(preview.id) ? 'currentColor' : 'none'} /></button></div><div className="modal-footer"><span className="shortcut-hint">{isDesktop ? 'Windows 桌面 · 填充显示' : '应用系统壁纸需要桌面版'}</span><button className="button" disabled={!!busy} onClick={async () => { if (await run({ type: 'wallpaper:select', id: preview.id })) { notify('预览已更新'); setPreview(null); } }}>仅在工作台预览</button><button className="button primary" disabled={!!busy} onClick={() => void applyWallpaper(preview)}>{busy === 'apply' ? <Loader2 size={16} className="spin" /> : <Monitor size={16} />}设为桌面壁纸</button></div></Modal>}
    {confirm && <Modal title={confirm.title} onClose={() => { if (!busy) setConfirm(null); }} className="confirm-modal"><div className="confirm-body"><span className="confirm-icon"><Trash2 size={24} /></span><p>{confirm.description}</p></div><div className="modal-footer"><button className="button" disabled={!!busy} onClick={() => setConfirm(null)}>取消</button><button className="button danger" disabled={!!busy} onClick={async () => { setBusy('delete'); if (await run(confirm.action)) { setConfirm(null); notify('已删除'); } setBusy(''); }}>确认删除</button></div></Modal>}
    {searchOpen && <Modal title="搜索" onClose={() => setSearchOpen(false)} className="search-modal"><div className="search-input-wrap"><Search size={21} /><input data-autofocus aria-label="搜索关键词" placeholder="日程、便签、待办或壁纸" value={query} onChange={event => setQuery(event.target.value)} /><kbd>ESC</kbd></div><div className="search-results">{!normalizedQuery ? <Empty icon={<Search size={26} />} title="输入关键词" description="搜索标题、内容或日期。" /> : <>
      {searchEvents.length > 0 && <div className="search-group"><h3>日程</h3>{searchEvents.map(event => <button key={event.id} onClick={async () => { if (await run({ type: 'calendar:select', date: event.date })) { setSearchOpen(false); setPage('calendar'); } }}><CalendarDays size={17} /><span><strong>{event.title}</strong><small>{event.date} · {event.start}–{event.end}</small></span><ChevronRight size={15} /></button>)}</div>}
      {searchNotes.length > 0 && <div className="search-group"><h3>便签</h3>{searchNotes.map(n => <button key={n.id} onClick={() => { setSearchOpen(false); setNoteEditor(n); }}><StickyNote size={17} /><span><strong>{n.title || '无标题便签'}</strong><small>{n.content.slice(0, 70)}</small></span><ChevronRight size={15} /></button>)}</div>}
      {searchTasks.length > 0 && <div className="search-group"><h3>待办事项</h3>{searchTasks.map(t => <div className="search-task-result" key={t.id}><TaskRow task={t} onAction={run} compact /></div>)}</div>}
      {searchWallpapers.length > 0 && <div className="search-group"><h3>壁纸</h3>{searchWallpapers.map(w => <button key={w.id} onClick={() => { setSearchOpen(false); setPreview(w); }}><img src={wallpaperURL(w)} alt="" /><span><strong>{w.name}</strong><small>{w.description}</small></span><ChevronRight size={15} /></button>)}</div>}
      {!searchNotes.length && !searchTasks.length && !searchWallpapers.length && !searchEvents.length && <Empty icon={<Search size={26} />} title="没有匹配结果" description="请更换关键词。" />}
    </>}</div></Modal>}
    {toast && <div key={toast.id} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
