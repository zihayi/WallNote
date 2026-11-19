import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Check, Clock3, GitMerge, GitPullRequest, Layers, Plus, RefreshCw, Settings2, Sparkles, Trash2 } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { emptyCommunity, feedNames, itemId, normalizeSettings, type CommunityView, type Digest, type FeedItem, type FeedKind } from '../../shared/community';
import { LayoutButton } from './LayoutStudio';
import { api, errorMessage, isDesktop } from '../api';
import { FrostedPanel } from './FrostedPanel';
import { Modal } from './Modal';
import './community.css';

function useCommunity() {
  const [view, setView] = useState(emptyCommunity);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true, updated = false;
    const off = api.onCommunity(next => { updated = true; if (alive) setView(next); });
    void api.getCommunity().then(next => { if (alive && !updated) setView(next); }).catch(e => { if (alive) setMessage(errorMessage(e)); });
    return () => { alive = false; off(); };
  }, []);
  const act = async (work: () => Promise<unknown>, success = '') => { try { setMessage(''); await work(); setMessage(success); } catch (e) { setMessage(errorMessage(e)); } };
  return { view, message, act };
}
const timeOf = (date: string) => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const sourceName = (repo: string, label: string) => repo.toLowerCase() === 'llvm/llvm-project' ? label.toLowerCase() === 'mlir' ? 'MLIR' : label || 'LLVM' : label ? `${repo} / ${label}` : repo;

export function ModuleLayout({ state }: { state: AppState }) {
  return <div className="module-layout"><h3><Layers size={16} />桌面模块布局</h3><p>在画布中添加模块、拖动对齐，或直接在桌面拖动卡片的标题和边角。</p><LayoutButton state={state} small/></div>;
}

function Preferences({ view, close }: { view: CommunityView; close: () => void }) {
  const [draft, set] = useState(() => structuredClone(view.settings)), [key, setKey] = useState(''), [message, note] = useState(''), [busy, wait] = useState(false);
  const disabled = !isDesktop || busy || view.busy;
  async function save() {
    wait(true); note('');
    try {
      const valid = normalizeSettings(draft);
      if (valid.ai && !key.trim() && !view.hasKey) throw new Error('请先填写 DeepSeek API Key，或关闭 AI 导读。');
      if (key.trim()) { await api.setCommunityKey(key.trim()); setKey(''); }
      await api.configureCommunity(valid); close();
    } catch (e) { note(errorMessage(e)); } finally { wait(false); }
  }
  const update = (i: number, field: 'repo'|'label', value: string) => set(prev => ({ ...prev, sources: prev.sources.map((s,n) => i === n ? { ...s, [field]: value } : s) }));
  return <Modal title="社区日报设置" onClose={() => { if (!busy) close(); }} className="community-modal"><div className="brief-form">
    <h3>关注的社区</h3><p>每行一个公开仓库，可按单个 GitHub 标签筛选。MLIR 在 llvm/llvm-project 中，标签为 mlir。</p>
    {draft.sources.map((s,i) => <div className="sub-row" key={i}><label>仓库<input aria-label={`仓库 ${i+1}`} value={s.repo} placeholder="owner/repo" maxLength={140} onChange={e => update(i,'repo',e.target.value)} /></label><label>标签（可选）<input aria-label={`标签 ${i+1}`} value={s.label} maxLength={50} placeholder="全部" onChange={e=>update(i,'label',e.target.value)} /></label><button className="icon-button" aria-label={`移除订阅 ${i+1}`} disabled={draft.sources.length === 1} onClick={()=>set({...draft,sources:draft.sources.filter((_,n)=>n!==i)})}><Trash2 size={16}/></button></div>)}
    {draft.sources.length < 3 && <button className="text-link" onClick={()=>set({...draft,sources:[...draft.sources,{repo:'',label:''}]})}><Plus size={14}/>添加订阅</button>}
    <div className="brief-form-section"><label className="check-line"><input type="checkbox" checked={draft.daily} onChange={e=>set({...draft,daily:e.target.checked})}/>每日自动生成</label><label>本地时间<input type="time" aria-label="每日生成时间" value={draft.time} onChange={e=>set({...draft,time:e.target.value})}/></label><p>WallNote 在托盘运行即可。错过时间会在当天启动或唤醒后补跑；每天最多自动尝试一次。</p></div>
    <div className="brief-form-section"><label className="check-line"><input type="checkbox" checked={draft.ai} onChange={e=>set({...draft,ai:e.target.checked})}/>用 DeepSeek 生成中文导读</label><p>启用后，每次生成最多调用一次模型，按你的 DeepSeek 账户计费。发送内容为下方关注方向及公开条目的标题、编号、标签与时间。</p>
    <label>关注方向<input maxLength={200} value={draft.focus} onChange={e=>set({...draft,focus:e.target.value})}/></label>
    <label>模型<select value={draft.model} onChange={e=>set({...draft,model:e.target.value as typeof draft.model})}><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
    <label>DeepSeek API Key · {view.hasKey ? '已配置' : '未配置'}<input type="password" autoComplete="new-password" spellCheck={false} disabled={!isDesktop} value={key} placeholder={view.hasKey?'留空保留现有密钥':'在此输入，使用 Windows 加密保存'} maxLength={256} onChange={e=>setKey(e.target.value)}/></label>
    {view.hasKey && <button className="text-link" disabled={disabled} onClick={async()=>{ wait(true); try { await api.setCommunityKey(null); setKey(''); set({...draft,ai:false}); note('密钥已删除。'); } catch(e){note(errorMessage(e));}finally{wait(false);} }}>删除本机密钥</button>}</div>
    {message && <p className="form-error" role="status">{message}</p>}{!isDesktop && <p>请在 Windows 安装版中配置社区助手。</p>}
  </div><div className="modal-footer"><button className="button" disabled={busy} onClick={close}>取消</button><button className="button primary" disabled={disabled} onClick={()=>void save()}><Check size={14}/>保存设置</button></div></Modal>;
}

export function CommunityPage({ state }: { state: AppState }) {
  const { view, message, act } = useCommunity(); const [editing,setEditing]=useState(false), [day,setDay]=useState(''), [kind,setKind]=useState<FeedKind>('opened'), [filter,setFilter]=useState('');
  const report = view.reports.find(d=>d.day===day) ?? view.reports[0];
  const sources = report?.sources ?? view.settings.sources;
  const items = (report?.items ?? []).filter(i=>!filter || sources.some(s => `${s.repo}:${s.label}` === filter && s.repo === i.repo && (!s.label || i.labels.some(l=>l.toLowerCase() === s.label.toLowerCase()))));
  const rows = items.filter(i=>i.kind===kind);
  const open = (i: FeedItem) => act(()=>api.communityItem('open',report.day,itemId(i)));
  const generate = () => act(async()=>{ await api.refreshCommunity(); setDay(''); setFilter(''); });
  return <div className="brief-page"><div className="page-heading compact-heading"><div><div className="eyebrow"><span/>COMMUNITY BRIEF</div><h1>社区日报</h1><p>关注开源社区的变化，把值得跟进的工作带回桌面。</p></div><div className="brief-actions"><button className="button" onClick={()=>setEditing(true)}><Settings2 size={15}/>订阅设置</button><button className="button primary" disabled={view.busy||!isDesktop} onClick={()=>void generate()}><RefreshCw size={15} className={view.busy?'spin':''}/>{view.busy?'生成中…':'生成日报'}</button></div></div>
    <div className="brief-grid"><div><section className="brief-hero"><div className="brief-line"><span className="eyebrow"><Sparkles size={14}/> DAILY DIGEST</span>{view.reports.length>0 && <select aria-label="日报日期" value={report.day} onChange={e=>{setDay(e.target.value);setFilter('');}}>{view.reports.map(d=><option key={d.day}>{d.day}</option>)}</select>}</div>
      <h2>{report ? '本期导读' : '你的第一份社区日报'}</h2><p>{report ? `${timeOf(report.at)} 生成 · ${report.items.length} 条来源 · ${report.model ?? 'GitHub 原始动态'}` : '已预设 LLVM 和 MLIR。点击「生成日报」获取真实动态，或先设置你的关注方向。'}</p>
      <div className="brief-tags">{sources.map(s=><span key={`${s.repo}:${s.label}`}>{sourceName(s.repo,s.label)}</span>)}</div>
      {report?.highlights.map(h=>{const i=report.items.find(v=>itemId(v)===h.source);return i && <button className="brief-highlight" key={h.source} onClick={()=>void open(i)}><span>{h.text}</span><small>{h.source} <ArrowUpRight size={12}/></small></button>;})}
      {report && !report.highlights.length && <p>{!report.items.length?'本期查询没有匹配条目。':!view.settings.ai?'可在订阅设置中开启 DeepSeek 中文导读。':'本期未生成 AI 导读，可在下方查看来源。'}</p>}
    </section>
    {view.error && <p role="alert" className="brief-notice">{view.error}{report && ' 当前展示已缓存的日报。'}</p>}{report?.notices.map((n,i)=><p className="brief-notice" key={i}>{n}</p>)}{message&&<p className="brief-notice" role="status">{message}</p>}
    <section className="settings-card brief-feed"><div className="brief-line"><h2>原始动态</h2><select aria-label="筛选订阅" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部订阅</option>{sources.map(s=><option key={`${s.repo}:${s.label}`} value={`${s.repo}:${s.label}`}>{sourceName(s.repo,s.label)}</option>)}</select></div>
    <div className="tabs">{(Object.keys(feedNames) as FeedKind[]).map(k=><button key={k} className={k===kind?'active':''} onClick={()=>setKind(k)}>{feedNames[k]} <span>{items.filter(i=>i.kind===k).length}</span></button>)}</div>
    {rows.map(i=><article className="brief-row" key={itemId(i)}>{i.kind==='merged'?<GitMerge size={17}/>:i.kind==='opened'?<GitPullRequest size={17}/>:<BookOpen size={17}/>}<button onClick={()=>void open(i)}><strong>{i.title}</strong><small>{itemId(i)} · {timeOf(i.at)}{i.labels.length>0 && ` · ${i.labels.slice(0,3).join(' / ')}`}</small></button><button className="icon-button" title="加入本地待办" aria-label={`加入待办：${i.title}`} onClick={()=>void act(()=>api.communityItem('task',report.day,itemId(i)),'已加入待办，相同条目不会重复添加。')}><Plus size={17}/></button></article>)}
    {!rows.length&&<p className="brief-empty">{report?'此分类暂无匹配条目。':'生成后，这里会列出可打开的 PR 和 Issue。'}</p>}
    <p className="brief-foot">PR 取近 24 小时；待认领为当前开放、未指派且标记 good first issue / help wanted 的 Issue。每个订阅每类最多 8 条。</p></section></div>
    <aside><section className="settings-card"><div className="settings-section-title"><Clock3 size={17}/><h2>生成计划</h2></div><h3 className="brief-time">{view.settings.daily?view.settings.time:'手动生成'}</h3><p className="settings-description">{view.settings.daily?'每天 · 本地时间 · WallNote 运行时':'在订阅设置中开启每日自动生成。'}<br/>最近 7 期保存在本机。</p><button className="text-link" onClick={()=>setEditing(true)}>管理订阅 <ArrowUpRight size={13}/></button></section><section className="settings-card"><ModuleLayout state={state}/></section></aside></div>
    {editing&&<Preferences view={view} close={()=>setEditing(false)}/>}</div>;
}

function firstLines(report: Digest) { return report.highlights.length ? report.highlights : report.items.slice(0, 5).map(i=>({source:itemId(i),text:i.title})); }
export function CommunityPanel({ state, desktop=false }: { state: AppState; desktop?: boolean }) {
  const { view, message, act }=useCommunity(); const report=view.reports[0];
  const manage=()=>desktop?act(()=>api.desktopControl('showCommunity')):location.hash='community';
  return <FrostedPanel state={state} desktop={desktop} title="社区日报" widgetKey="community" icon={<GitPullRequest size={17}/>} className="community-panel" onClose={desktop?()=>void act(()=>api.dispatch({type:'settings:update',changes:{showDesktopCommunity:false}})):undefined}>
    <div className="brief-widget-list"><span className="brief-widget-date">{report ? `${report.day} · ${report.model?'AI 导读':'GitHub 动态'}` : 'GITHUB / DAILY'}</span>{report && firstLines(report).map(h=><button key={h.source} onClick={()=>void act(()=>api.communityItem('open',report.day,h.source))}><strong>{h.text}</strong><small>{h.source} ↗</small></button>)}{(!report||!report.items.length)&&<p>{report?'本期没有匹配条目。':'从 LLVM、MLIR 开始关注，生成你的第一份日报。'}</p>}</div>
    {(view.error||message)&&<p className="widget-error" role="status">{message||view.error}</p>}<footer className="brief-widget-footer"><button className="text-link" onClick={()=>void manage()}>查看日报 <ArrowUpRight size={13}/></button><button className="icon-button" aria-label="刷新社区日报" disabled={!isDesktop||view.busy} onClick={()=>void act(()=>api.refreshCommunity())}><RefreshCw size={14} className={view.busy?'spin':''}/></button></footer></FrostedPanel>;
}
