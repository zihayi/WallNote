import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, CalendarDays, Check, CheckCheck, CheckCircle2, ChevronRight, CircleHelp, CloudOff, FolderOpen, Heart, Image, LayoutDashboard, Leaf, Loader2, Maximize2, Minus, Monitor, PanelTop, Pin, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Sprout, StickyNote, Trash2, X } from 'lucide-react';
import type { Action, AppInfo, AppState, DesktopCommand, DesktopStatus, Note, Page, Wallpaper } from '../shared/types';
import { allWallpapers } from '../shared/state';
import { api, errorMessage, isDesktop, wallpaperURL } from './api';
import { Modal } from './components/Modal';
import { FloatingNote, NoteCard, NoteEditor } from './components/Notes';
import { TaskInput, TaskRow } from './components/Tasks';
import { DesktopTasks, DesktopWallpaper } from './components/Desktop';

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: '我的工作台', icon: LayoutDashboard },
  { id: 'wallpapers', label: '壁纸收藏馆', icon: Image },
  { id: 'notes', label: '桌面便签', icon: StickyNote },
  { id: 'tasks', label: '待办清单', icon: CheckCircle2 },
];

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'small' : ''}`}><div className="brand-mark"><span /><span /><span /></div><span>WallNote<i /></span></div>;
}

function Empty({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{children}</div>;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`switch ${checked ? 'checked' : ''}`}><span /></button>;
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
  const desktopView = useMemo(() => { const query = new URLSearchParams(window.location.search); return query.has('wallpaper') ? 'wallpaper' : query.get('widget'); }, []);

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
    try {
      const status = await api.desktopControl(command);
      setDesktopStatus(status);
      if (status.error) notify(status.error, true);
    } catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }
  async function importWallpapers() {
    setBusy('import');
    try {
      const result = await api.importWallpapers();
      if (result.count) { setWallpaperFilter('imported'); setPage('wallpapers'); notify(`已收藏 ${result.count} 张新壁纸`); }
    } catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }
  async function applyWallpaper(wallpaper: Wallpaper) {
    setBusy('apply');
    try { await api.applyWallpaper(wallpaper.id); notify(`「${wallpaper.name}」已设为桌面壁纸`); setPreview(null); }
    catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }
  async function backup(restore: boolean) {
    setBusy('backup');
    try {
      if (restore) { if (await api.restoreBackup()) notify('便签与待办已恢复'); }
      else if (await api.exportBackup()) notify('备份已导出，记得妥善保存');
    } catch (error) { notify(errorMessage(error), true); }
    finally { setBusy(''); }
  }

  if (loadError) return <div className="loading-screen"><Brand /><h2>暂时无法打开你的小天地</h2><p role="alert">{loadError}</p><button className="button primary" onClick={() => location.reload()}>重新加载</button></div>;
  if (!state) return <div className="loading-screen"><Brand /><Loader2 className="spin" size={24} /><p>正在整理你的桌面…</p></div>;
  if (desktopView === 'wallpaper') return <DesktopWallpaper state={state} />;
  if (desktopView === 'tasks') return <DesktopTasks state={state} />;
  if (floatingId) {
    const note = state.notes.find(n => n.id === floatingId);
    return note ? <FloatingNote note={note} /> : <div className="loading-screen"><p>这张便签已被删除</p></div>;
  }

  const wallpapers = allWallpapers(state);
  const selected = wallpapers.find(w => w.id === state.selectedWallpaperId) ?? wallpapers[0];
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
  const noteCard = (note: Note) => <NoteCard key={note.id} note={note} onEdit={() => setNoteEditor(note)} onPin={() => void run({ type: 'note:update', id: note.id, changes: { pinned: !note.pinned } })} onDelete={() => setConfirm({ title: '删除这张便签？', description: `「${note.title || '无标题便签'}」的内容将被删除。`, action: { type: 'note:delete', id: note.id } })} />;

  return <div className={`app-shell ${isDesktop ? 'desktop' : ''}`}>
    <aside className="sidebar">
      <Brand /><div className="brand-tagline">桌面有序，灵感自由。</div>
      <div className="nav-label">我的空间</div>
      <nav aria-label="主导航">{navigation.map(item => <button key={item.id} aria-label={item.label} className={`nav-item ${page === item.id ? 'selected' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'notes' && <span className="nav-count">{state.notes.length}</span>}{item.id === 'tasks' && unfinished.length > 0 && <span className="nav-count">{unfinished.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="little-message"><div className="plant-drawing"><Sprout size={36} strokeWidth={1.25} /><span className="plant-dot one" /><span className="plant-dot two" /></div><h4>小小桌面，大大可能</h4><p>好想法，总需要一个落脚点。</p><button onClick={() => setNoteEditor('new')}>记下此刻的灵感 <ArrowRight size={13} /></button></div><button aria-label="偏好设置" aria-current={page === 'settings' ? 'page' : undefined} className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => setPage('settings')}><Settings size={19} strokeWidth={1.7} /><span>偏好设置</span></button><div className="local-status"><span />所有美好，本地珍藏<ShieldCheck size={13} /></div></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>我的空间</span><ChevronRight size={13} /><strong>{currentLabel}</strong></div><div className="topbar-actions"><button className="search-trigger" onClick={() => { setQuery(''); setSearchOpen(true); }} aria-label="搜索便签、待办和壁纸"><Search size={16} /><span>搜索你的空间</span><kbd>Ctrl K</kbd></button><span className="topbar-divider" /><span className="mode-label"><span />{isDesktop ? '本地模式' : '浏览器预览'}</span><button className="avatar" aria-label="打开偏好设置" onClick={() => setPage('settings')}>W</button></div>{isDesktop && <div className="window-controls"><button aria-label="最小化窗口" onClick={() => api.windowAction('minimize')}><Minus size={15} /></button><button aria-label="最大化或还原窗口" onClick={() => api.windowAction('maximize')}><Maximize2 size={13} /></button><button className="window-close" aria-label="关闭应用" onClick={() => api.windowAction('close')}><X size={17} /></button></div>}</header>

      <main className="main-content" key={page}>
        {isDesktop && <div className={`desktop-mode-banner ${desktopStatus.error ? 'has-error' : ''}`}><Monitor size={19} /><div><strong>{desktopStatus.active ? 'WallNote 已成为你的电脑桌面' : desktopStatus.enabled ? '正在连接 Windows 桌面层…' : '桌面壁纸已暂停'}</strong><p>{desktopStatus.error || (desktopStatus.active ? `${desktopStatus.displays} 块屏幕 · 壁纸与组件固定在桌面，关闭此面板仍会继续运行` : '开启后，壁纸、便签和待办会直接出现在电脑桌面上。')}</p></div><button className="button small" disabled={!!busy} onClick={() => void desktopCommand(desktopStatus.active ? 'showDesktop' : 'enable')}>{desktopStatus.active ? '返回电脑桌面' : '启用桌面壁纸'}<ArrowRight size={14} /></button></div>}
        {page === 'dashboard' && <>
          <div className="page-heading dashboard-heading"><div><div className="eyebrow"><span /> A LITTLE SPACE, A BETTER DAY</div><h1>让桌面，成为喜欢的样子<span className="heading-dot">。</span></h1><p>安放每一个灵感，从容做好每一件小事。</p></div><div className="date-widget"><CalendarDays size={18} /><div><strong>{now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</strong><span>{now.toLocaleDateString('zh-CN', { weekday: 'long' })}，今天也很值得</span></div></div></div>
          <div className="dashboard-top-grid">
            <section className="wallpaper-hero" style={{ backgroundImage: `url("${wallpaperURL(selected)}")` }} aria-label="当前壁纸预览"><div className="hero-top"><span className="glass-pill"><Monitor size={13} />{state.appliedWallpaperId === selected.id ? '当前桌面壁纸' : '你的壁纸预览'}</span><button className={`hero-heart ${state.favorites.includes(selected.id) ? 'favorited' : ''}`} aria-label="收藏当前壁纸" aria-pressed={state.favorites.includes(selected.id)} onClick={() => void run({ type: 'wallpaper:favorite', id: selected.id })}><Heart size={18} fill={state.favorites.includes(selected.id) ? 'currentColor' : 'none'} /></button></div><div className="hero-bottom"><div><span className="hero-kicker">给日常，一点新风景</span><h2>{selected.name}</h2><p>{selected.description}</p></div><button className="button hero-button" onClick={() => setPage('wallpapers')}><Image size={15} />换个风景<ArrowRight size={15} /></button></div></section>
            <section className="today-card"><div className="section-title"><div className="title-with-icon"><span className="section-icon green"><CheckCheck size={19} /></span><h2>给今天一点方向</h2></div><span className="count-pill">{unfinished.length} 项待办</span></div><div className="task-progress-line"><span>每完成一件，离理想更近一点</span><strong>{completed}<em> / {state.tasks.length}</em></strong></div><div className="progress-track"><div style={{ width: `${progress}%` }} /></div><div className="dashboard-task-list">{sortedTasks.length ? sortedTasks.slice(0, 4).map(task => <TaskRow key={task.id} task={task} onAction={run} compact />) : <div className="mini-empty"><Leaf size={22} /><span>暂时没有待办，享受这一刻。</span></div>}</div><TaskInput onAction={run} compact /><button className="text-link task-view-all" onClick={() => setPage('tasks')}>查看全部待办 <ArrowRight size={13} /></button></section>
          </div>
          <section className="dashboard-notes"><div className="section-heading"><div><h2>随手记下<span className="soft-count">{state.notes.length}</span></h2><p>让一闪而过的想法，有迹可循。</p></div><div className="section-heading-actions"><button className="text-link subtle" onClick={() => setPage('notes')}>全部便签<ChevronRight size={14} /></button><button className="button small" onClick={() => setNoteEditor('new')}><Plus size={15} />新建便签</button></div></div><div className="notes-grid dashboard-notes-grid">{[...state.notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 3).map(noteCard)}{state.notes.length === 0 && <button className="add-note-card" onClick={() => setNoteEditor('new')}><Plus size={24} /><span>写下你的第一个想法</span></button>}</div></section>
          <section className="recommendations"><div className="section-heading"><div className="recommendation-heading"><Sparkles size={17} /><h2>换个心情，从桌面开始</h2></div><button className="text-link subtle" onClick={() => setPage('wallpapers')}>发现更多壁纸<ArrowRight size={14} /></button></div><div className="recommendation-grid">{wallpapers.filter(w => w.id !== selected.id).slice(0, 4).map(w => <button key={w.id} className="recommendation-card" onClick={() => setPreview(w)}><img src={wallpaperURL(w)} alt={w.name} /><div><span>{w.name}</span><span>{w.category === 'nature' ? '自然风景' : w.category === 'abstract' ? '色彩美学' : '我的收藏'}</span></div><ArrowRight size={15} /></button>)}</div></section>
          <footer className="page-footer"><Leaf size={12} /> 把桌面留给喜欢的事物。<span>Made for your everyday.</span></footer>
        </>}

        {page === 'wallpapers' && <>
          <div className="page-heading"><div><div className="eyebrow">A VIEW JUST FOR YOU</div><h1>壁纸收藏馆<span className="heading-dot">。</span></h1><p>喜欢的风景，抬眼就能看见。</p></div><button className="button primary" disabled={!!busy} onClick={() => void importWallpapers()}>{busy === 'import' ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}导入本地壁纸</button></div>
          <div className="filter-bar"><div className="tabs">{[['all', '全部壁纸'], ['nature', '自然风景'], ['abstract', '色彩美学'], ['favorites', '我的喜欢'], ['imported', '本地导入']].map(([id, label]) => <button key={id} className={wallpaperFilter === id ? 'active' : ''} onClick={() => setWallpaperFilter(id)}>{id === 'favorites' && <Heart size={14} />}{label}{id === 'all' && <span>{wallpapers.length}</span>}</button>)}</div><span className="result-count">{visibleWallpapers.length} 张风景</span></div>
          {visibleWallpapers.length ? <div className="wallpaper-grid">{visibleWallpapers.map(w => <article key={w.id} className="wallpaper-card"><div className="wallpaper-image-wrap"><button className="wallpaper-image-button" onClick={() => setPreview(w)} aria-label={`预览壁纸：${w.name}`}><img src={wallpaperURL(w)} alt={w.name} loading="lazy" /><span className="wallpaper-hover"><Maximize2 size={19} />预览壁纸</span></button>{state.appliedWallpaperId === w.id ? <span className="wallpaper-status"><Check size={12} />使用中</span> : state.selectedWallpaperId === w.id && <span className="wallpaper-status">工作台预览</span>}<button className={`wallpaper-heart ${state.favorites.includes(w.id) ? 'favorited' : ''}`} aria-label={`收藏壁纸：${w.name}`} aria-pressed={state.favorites.includes(w.id)} onClick={() => void run({ type: 'wallpaper:favorite', id: w.id })}><Heart size={16} fill={state.favorites.includes(w.id) ? 'currentColor' : 'none'} /></button></div><div className="wallpaper-card-info"><div><h3>{w.name}</h3><p>{w.category === 'nature' ? '自然风景' : w.category === 'abstract' ? '色彩美学' : '本地收藏'}<span>·</span>{w.category === 'imported' ? '你的独家风景' : '1920 × 1080'}</p></div><div className="wallpaper-swatches">{w.colors.map(color => <i key={color} style={{ background: color }} />)}</div>{w.category === 'imported' && <button className="icon-button danger-hover" aria-label={`删除壁纸：${w.name}`} onClick={() => setConfirm({ title: '移除这张壁纸？', description: '壁纸将从收藏馆移除，原始图片不会受到影响。', action: { type: 'wallpaper:delete', id: w.id } })}><Trash2 size={16} /></button>}</div></article>)}</div> : <Empty icon={<Image size={30} />} title={wallpaperFilter === 'favorites' ? '收藏让你心动的风景' : '给桌面带来一点新鲜感'} description={wallpaperFilter === 'favorites' ? '点击壁纸右上角的爱心，就能在这里找到它。' : '导入喜欢的本地图片，建立自己的壁纸收藏馆。'}>{wallpaperFilter === 'imported' && <button className="button primary" disabled={!!busy} onClick={() => void importWallpapers()}><Plus size={16} />导入壁纸</button>}</Empty>}
          <div className="gentle-tip"><ShieldCheck size={16} /><span>内置壁纸可离线使用 · 本地导入支持 JPG、PNG、WebP、BMP · 应用后直接显示在 Windows 桌面图标后方</span></div>
        </>}

        {page === 'notes' && <>
          <div className="page-heading"><div><div className="eyebrow">THOUGHTS WORTH KEEPING</div><h1>给灵感一个落脚点<span className="heading-dot">。</span></h1><p>碎片想法、生活小事，都值得好好记下。</p></div><button className="button primary" onClick={() => setNoteEditor('new')}><Plus size={17} />新建便签</button></div>
          <div className="filter-bar"><div className="tabs"><button className={noteFilter === 'all' ? 'active' : ''} onClick={() => setNoteFilter('all')}>全部便签<span>{state.notes.length}</span></button><button className={noteFilter === 'pinned' ? 'active' : ''} onClick={() => setNoteFilter('pinned')}><Pin size={14} />已贴到桌面<span>{state.notes.filter(n => n.pinned).length}</span></button></div><span className="result-count">按最近编辑排序</span></div>
          {visibleNotes.length ? <div className="notes-grid full-notes-grid">{visibleNotes.map(noteCard)}<button className="add-note-card" onClick={() => setNoteEditor('new')}><Plus size={25} /><span>再记点什么</span><small>新的想法，从这里开始</small></button></div> : <Empty icon={<StickyNote size={30} />} title={noteFilter === 'pinned' ? '桌面还留着一片空白' : '让第一个想法在这里落地'} description={noteFilter === 'pinned' ? '点击便签上的图钉，就能把它贴到桌面。' : '不需要完整的句子，从一个词开始也很好。'}><button className="button primary" onClick={() => noteFilter === 'pinned' ? setNoteFilter('all') : setNoteEditor('new')}>{noteFilter === 'pinned' ? '查看全部便签' : '新建便签'}<ArrowRight size={15} /></button></Empty>}
          <div className="gentle-tip"><Pin size={15} /><span>点击图钉，将便签固定到 Windows 桌面。拖动顶部移动位置，内容自动保存；普通应用会显示在便签上方。</span></div>
        </>}

        {page === 'tasks' && <>
          <div className="page-heading"><div><div className="eyebrow">ONE SMALL STEP AT A TIME</div><h1>慢慢来，一件一件完成<span className="heading-dot">。</span></h1><p>把脑海里的「记得做」，变成踏实的「已完成」。</p></div><div className="task-summary"><span className="summary-ring" style={{ background: `conic-gradient(var(--green) ${progress}%, #e6ece8 0)` }}><span>{progress}<small>%</small></span></span><div><strong>{completed} / {state.tasks.length}</strong><span>每一小步，都算数</span></div></div></div>
          <section className="tasks-panel"><TaskInput onAction={run} /><div className="filter-bar"><div className="tabs">{[['all', '全部', state.tasks.length], ['active', '进行中', unfinished.length], ['completed', '已完成', completed], ['priority', '重要', state.tasks.filter(t => t.priority && !t.completed).length]].map(([id, label, count]) => <button key={id} className={taskFilter === id ? 'active' : ''} onClick={() => setTaskFilter(String(id))}>{label}<span>{count}</span></button>)}</div><label className="sort-control"><SlidersHorizontal size={14} /><select aria-label="待办排序" value={taskSort} onChange={event => setTaskSort(event.target.value)}><option value="priority">重要优先</option><option value="newest">最新创建</option></select></label></div><div className="full-task-list">{visibleTasks.length ? visibleTasks.map(task => <TaskRow key={task.id} task={task} onAction={run} />) : <Empty icon={<CheckCheck size={32} />} title={taskFilter === 'completed' ? '每一份完成，都值得记录' : '此刻，没有未尽的小事'} description={taskFilter === 'completed' ? '完成一件事后，点击左侧圆圈，给自己一点肯定。' : '在上方添加新的计划，或者给自己一个小小的休息。'} />}</div><footer className="tasks-panel-footer"><span><Leaf size={14} />{unfinished.length ? `还有 ${unfinished.length} 件小事，按自己的节奏就好。` : '今天也辛苦了，给自己一点放松的时间。'}</span>{completed > 0 && <button className="text-link subtle" onClick={() => setConfirm({ title: '清理已完成的待办？', description: `将移除 ${completed} 条已完成记录，未完成的任务会保留。`, action: { type: 'task:clearCompleted' } })}><Trash2 size={13} />清理已完成</button>}</footer></section>
          <div className="quote-card"><span>“</span><p>不必把所有事都做完。<br />把重要的事，做好一点点。</p><Sprout size={66} strokeWidth={1} /></div>
        </>}

        {page === 'settings' && <>
          <div className="page-heading"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>按照你的习惯<span className="heading-dot">。</span></h1><p>一点小调整，让这里更像你自己的空间。</p></div><span className="version-tag">WallNote v{info?.version ?? '0.2.0'}</span></div>
          <div className="settings-layout"><div>
            <section className="settings-card">
              <div className="settings-section-title"><PanelTop size={19} /><h2>电脑桌面</h2></div>
              <div className="setting-row"><div><h3>桌面壁纸模式</h3><p>直接嵌入 Windows 桌面，普通应用显示在壁纸与组件上方</p></div><Switch label="桌面壁纸模式" checked={isDesktop && desktopStatus.enabled} onChange={() => void desktopCommand(desktopStatus.enabled ? 'disable' : 'enable')} /></div>
              <div className="setting-row"><div><h3>显示桌面待办</h3><p>在电脑桌面直接添加、勾选待办，拖动顶部调整位置</p></div><Switch label="显示桌面待办" checked={state.settings.showDesktopTasks !== false} onChange={() => void run({ type: 'settings:update', changes: { showDesktopTasks: state.settings.showDesktopTasks === false } })} /></div>
              <div className="setting-row"><div><h3>开机启动</h3><p>登录 Windows 后启动桌面壁纸（开发版与便携版不支持）</p></div><Switch label="开机启动" checked={state.settings.launchAtLogin} onChange={() => void run({ type: 'settings:update', changes: { launchAtLogin: !state.settings.launchAtLogin } })} /></div>
              <div className="settings-buttons desktop-setting-actions"><button className="button" disabled={!!busy} onClick={() => void desktopCommand('resetLayout')}>重置桌面组件位置</button><button className="button" disabled={!!busy} onClick={() => void desktopCommand('quit')}>退出 WallNote</button></div>
            </section>
            <section className="settings-card"><div className="settings-section-title"><ShieldCheck size={19} /><h2>你的数据，你来保管</h2></div><div className="data-summary"><span><StickyNote size={17} /><strong>{state.notes.length}</strong> 张便签</span><span><CheckCircle2 size={17} /><strong>{state.tasks.length}</strong> 条待办</span><span><Image size={17} /><strong>{state.wallpapers.length}</strong> 张本地壁纸</span></div><div className="data-path"><span>数据保存位置</span><code>{info?.dataPath ?? '读取中…'}</code><button className="icon-button" aria-label="打开数据文件夹" onClick={() => void api.openDataFolder().catch(error => notify(errorMessage(error), true))}><FolderOpen size={19} /></button></div><p className="settings-description">便签、待办与设置自动保存到本地。导出备份用于迁移便签与待办；图片文件请通过数据文件夹单独备份。恢复备份会保留当前壁纸和系统设置。</p><div className="settings-buttons"><button className="button" disabled={!!busy} onClick={() => void backup(false)}><ArrowDownToLine size={16} />导出备份</button><button className="button" disabled={!!busy} onClick={() => void backup(true)}><ArrowUpFromLine size={16} />恢复备份</button></div></section>
          </div><aside className="about-card"><Brand small /><p>桌面有序，灵感自由。</p><div className="about-illustration"><Sprout size={86} strokeWidth={1} /><span /></div><h3>这就是你的电脑桌面。</h3><p>原有桌面图标依然可用。<br />壁纸、灵感和计划，都在桌面上。</p><div className="offline-badge"><CloudOff size={14} />可以完全离线使用</div><div className="settings-help"><CircleHelp size={15} /><span>关闭面板会继续在托盘运行。<br />双击托盘图标或按 Ctrl + Alt + W 打开管理。暂停或退出后显示原来的系统壁纸。</span></div></aside></div>
        </>}
      </main>
    </div>

    {noteEditor !== null && <NoteEditor key={noteEditor === 'new' ? 'new' : noteEditor.id} note={noteEditor === 'new' ? null : noteEditor} onSave={async action => { const ok = await run(action); if (ok) notify(action.type === 'note:add' ? '新想法，已好好收下' : '便签已保存'); return ok; }} onClose={() => setNoteEditor(null)} />}
    {preview && <Modal title="一眼喜欢的风景" onClose={() => { if (!busy) setPreview(null); }} className="wallpaper-preview-modal"><img className="preview-image" src={wallpaperURL(preview)} alt={preview.name} /><div className="preview-details"><div><h2>{preview.name}</h2><p>{preview.description}</p></div><button className={`icon-button ${state.favorites.includes(preview.id) ? 'favorited' : ''}`} aria-label="收藏预览壁纸" aria-pressed={state.favorites.includes(preview.id)} onClick={() => void run({ type: 'wallpaper:favorite', id: preview.id })}><Heart size={21} fill={state.favorites.includes(preview.id) ? 'currentColor' : 'none'} /></button></div><div className="modal-footer"><span className="shortcut-hint">{isDesktop ? 'Windows 桌面 · 填充显示' : '浏览器预览 · 系统壁纸切换需桌面版'}</span><button className="button" disabled={!!busy} onClick={async () => { if (await run({ type: 'wallpaper:select', id: preview.id })) { notify('工作台已换上新的风景'); setPreview(null); } }}>仅在工作台预览</button><button className="button primary" disabled={!!busy} onClick={() => void applyWallpaper(preview)}>{busy === 'apply' ? <Loader2 size={16} className="spin" /> : <Monitor size={16} />}设为桌面壁纸</button></div></Modal>}
    {confirm && <Modal title={confirm.title} onClose={() => { if (!busy) setConfirm(null); }} className="confirm-modal"><div className="confirm-body"><span className="confirm-icon"><Trash2 size={24} /></span><p>{confirm.description}</p></div><div className="modal-footer"><button className="button" disabled={!!busy} onClick={() => setConfirm(null)}>保留</button><button className="button danger" disabled={!!busy} onClick={async () => { setBusy('delete'); if (await run(confirm.action)) { setConfirm(null); notify('已删除'); } setBusy(''); }}>确认删除</button></div></Modal>}
    {searchOpen && <Modal title="在你的小天地里找一找" onClose={() => setSearchOpen(false)} className="search-modal"><div className="search-input-wrap"><Search size={21} /><input data-autofocus aria-label="搜索关键词" placeholder="搜索便签、待办、壁纸…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>ESC</kbd></div><div className="search-results">{!normalizedQuery ? <Empty icon={<Search size={26} />} title="想找些什么？" description="输入一个关键词，让灵感和计划重新浮现。" /> : <>{searchNotes.length > 0 && <div className="search-group"><h3>便签</h3>{searchNotes.map(n => <button key={n.id} onClick={() => { setSearchOpen(false); setNoteEditor(n); }}><StickyNote size={17} /><span><strong>{n.title || '无标题便签'}</strong><small>{n.content.slice(0, 70)}</small></span><ChevronRight size={15} /></button>)}</div>}{searchTasks.length > 0 && <div className="search-group"><h3>待办事项</h3>{searchTasks.map(t => <div className="search-task-result" key={t.id}><TaskRow task={t} onAction={run} compact /></div>)}</div>}{searchWallpapers.length > 0 && <div className="search-group"><h3>壁纸</h3>{searchWallpapers.map(w => <button key={w.id} onClick={() => { setSearchOpen(false); setPreview(w); }}><img src={wallpaperURL(w)} alt="" /><span><strong>{w.name}</strong><small>{w.description}</small></span><ChevronRight size={15} /></button>)}</div>}{!searchNotes.length && !searchTasks.length && !searchWallpapers.length && <Empty icon={<Search size={26} />} title="还没有找到相关内容" description="试试更简短的关键词，或者记下一个新的想法。" />}</>}</div></Modal>}
    {toast && <div key={toast.id} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
  </div>;
}
