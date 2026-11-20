import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { feedNames, itemId, sourceItems, sourceKey, sourceName, type CommunityView, type FeedItem, type FeedKind } from '../../shared/community';

export function BriefCardContent({ view, open }: { view: CommunityView; open: (item: FeedItem) => void }) {
  const report = view.reports[0], sources = report?.sources ?? view.settings.sources;
  const [picked, pick] = useState(''), [kind, choose] = useState<FeedKind>('opened');
  const filter = sources.some(s => sourceKey(s) === picked) ? picked : '';
  const scoped = sourceItems(report, filter), rows = scoped.filter(i => i.kind === kind);
  const root = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), tipId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bubble=useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ id: string; text: string; start: number; end: number } | null>(null);
  useLayoutEffect(()=>{
    if(!tip||!bubble.current||!root.current)return;
    const height=root.current.clientHeight, box=bubble.current.offsetHeight;
    const preferred=tip.start>=box+4 ? tip.start-box-4 : tip.end+4;
    bubble.current.style.top=`${Math.max(0,Math.min(height-box,preferred))}px`;
  },[tip]);
  const dismiss = () => { clearTimeout(timer.current); setTip(null); };
  useLayoutEffect(() => {
    dismiss(); if (list.current) list.current.scrollTop = 0;
  }, [report?.at, filter, kind]);
  useEffect(() => {
    const el=root.current!;let w=el.clientWidth,h=el.clientHeight;
    const observer = new ResizeObserver(()=>{if(w!==el.clientWidth || h!==el.clientHeight){w=el.clientWidth;h=el.clientHeight;dismiss();}});observer.observe(el);
    window.addEventListener('blur', dismiss);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', escape);
    return () => { clearTimeout(timer.current); observer.disconnect(); window.removeEventListener('blur', dismiss); window.removeEventListener('keydown', escape); };
  }, []);
  const show = (item: FeedItem, button: HTMLElement, delay: number) => {
    clearTimeout(timer.current);
    const reveal=() => {
      if (!button.isConnected || !root.current) return;
      const id = itemId(item), r = root.current.getBoundingClientRect(), b = button.getBoundingClientRect();
      const scale = r.height / Math.max(1, root.current.clientHeight);
      const summary = item.summary || report?.highlights.find(h => h.source === id)?.text;
      if(summary)setTip({ id, start:(b.top-r.top)/scale, end:(b.bottom-r.top)/scale, text:summary });
    };
    if(delay)timer.current=setTimeout(reveal,delay);else reveal();
  };
  const overview = report?.overview || report?.highlights[0]?.text;
  return <div className="brief-card-content" ref={root}>
    {overview && <div className="brief-card-lead"><p title={overview}>{overview}</p></div>}
    <div className="brief-card-tags" role="group" aria-label="社区标签" onFocus={dismiss}><button aria-pressed={!filter} onClick={()=>pick('')}>全部</button>{sources.map(s=><button key={sourceKey(s)} aria-pressed={filter===sourceKey(s)} title={`${s.repo}${s.label?' / '+s.label:''}`} onClick={()=>pick(sourceKey(s))}>{sourceName(s)}</button>)}</div>
    <div className="brief-card-kinds" role="group" aria-label="动态分类" onFocus={dismiss}>{(['opened','opportunity','merged'] as const).map(k=><button key={k} aria-pressed={kind===k} onClick={()=>choose(k)}>{feedNames[k]} <small>{scoped.filter(i=>i.kind===k).length}</small></button>)}</div>
    <div className="brief-card-list" ref={list} onScroll={()=>{
      // Tabbing to a clipped row scrolls it into view *after* focus. Re-anchor its tip.
      const el=document.activeElement, item=el instanceof HTMLButtonElement && rows.find(i=>itemId(i)===el.dataset.item);
      if(item && el instanceof HTMLButtonElement && list.current?.contains(el))show(item,el,0);else dismiss();
    }} aria-label="社区条目">{rows.map(i=>{const id=itemId(i);return <button key={id} data-item={id} aria-describedby={tip?.id===id?tipId:undefined} onMouseEnter={e=>show(i,e.currentTarget,220)} onMouseLeave={e=>{if(document.activeElement!==e.currentTarget)dismiss();}} onFocus={e=>show(i,e.currentTarget,0)} onBlur={dismiss} onClick={()=>{dismiss();open(i);}}><strong>{i.title}</strong><small>{id} <ArrowUpRight size={10}/></small></button>;})}{!rows.length && <p>{report?'暂无动态':'暂无日报'}</p>}</div>
    {tip && <div ref={bubble} id={tipId} role="tooltip" className="brief-card-tooltip" style={{maxHeight:'100%'}}><p>{tip.text}</p></div>}
  </div>;
}
