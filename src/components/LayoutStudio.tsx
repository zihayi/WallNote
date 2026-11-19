import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointer, type ReactNode } from 'react';
import { Archive, CalendarDays, Check, Clock3, GitPullRequest, Grip, Layers, ListChecks, Magnet, RotateCcw, StickyNote } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { modules, type ModuleId } from '../../shared/modules';
import { displayedHome, moduleIds, moduleHome, shownModules, snapDrag, toFrame, type DockFrames, type DragMode, type Guides, type LayoutDisplay, type Rect } from '../../shared/snap-layout';
import { allWallpapers } from '../../shared/state';
import { api, errorMessage, wallpaperURL } from '../api';
import { Modal } from './Modal';
import { resizeHandles } from './resize-handles';
import './layout-studio.css';

const icons={schedule:Clock3,calendar:CalendarDays,tasks:ListChecks,notes:StickyNote,community:GitPullRequest,drawer:Archive};
function useDisplays() {
  const [displays,set]=useState<LayoutDisplay[]>([]),[error,fail]=useState('');
  useEffect(()=>{let live=true;const refresh=()=>void api.getLayoutDisplays().then(d=>{if(live){set(d);fail('');}}).catch(e=>{if(live)fail(errorMessage(e));});
    refresh();window.addEventListener('focus',refresh);const off=api.onDesktopStatus(refresh);
    return()=>{live=false;off();window.removeEventListener('focus',refresh);};},[]);
  return {displays,error};
}
const localStyle=(r:Rect,a:Rect):CSSProperties=>({left:`${(r.x-a.x)/a.width*100}%`,top:`${(r.y-a.y)/a.height*100}%`,width:`${r.width/a.width*100}%`,height:`${r.height/a.height*100}%`});
function MonitorPicker({displays,selected,pick}:{displays:LayoutDisplay[];selected:LayoutDisplay;pick:(id:number)=>void}) {
  return <select aria-label="布局显示器" value={selected.id} onChange={e=>pick(Number(e.target.value))}>{displays.map((d,i)=><option key={d.id} value={d.id}>{d.primary?'主屏幕':`屏幕 ${i+1}`} · {d.workArea.width} × {d.workArea.height}</option>)}</select>;
}
interface Gesture { id:ModuleId; mode:DragMode; pointer:number; cx:number; cy:number; start:Rect; area:LayoutDisplay; peers:Rect[]; prior:DockFrames; target:HTMLElement; scaleX:number;scaleY:number; moved:boolean }

function Studio({state,close}:{state:AppState;close:()=>void}) {
  const {displays,error:displayError}=useDisplays(), [monitor,pick]=useState<number>();
  const d=displays.find(s=>s.id===monitor)??displays.find(s=>s.primary)??displays[0];
  const [ids,setIds]=useState(()=>shownModules(state.settings)),[frames,setFrames]=useState<DockFrames>(()=>({...state.settings.dockFrames}));
  const [selected,select]=useState<ModuleId>(),[guides,lines]=useState<Guides>({}),[snap,enableSnap]=useState(state.settings.layoutSnap!==false),[busy,wait]=useState(false),[error,fail]=useState(''),[preset,setPreset]=useState(false);
  const board=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null);
  const settings={...state.settings,dockFrames:frames};
  const home=(id:ModuleId)=>(preset?moduleHome:displayedHome)(settings,id,displays);
  const visible=d?ids.filter(id=>home(id).display.id===d.id):[];
  const wallpaper=allWallpapers(state).find(w=>w.id===(state.appliedWallpaperId??state.selectedWallpaperId));
  function stop(cancel:boolean) {
    const g=gesture.current;if(!g)return;gesture.current=null;
    if(cancel)setFrames(g.prior);lines({}); if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);
  }
  useEffect(()=>{const blur=()=>stop(true);window.addEventListener('blur',blur);return()=>window.removeEventListener('blur',blur);},[]);
  function begin(e:ReactPointer<HTMLElement>,id:ModuleId,mode:DragMode) {
    if(!d||!board.current||busy||e.button!==0||!e.isPrimary||gesture.current)return;
    e.preventDefault();e.stopPropagation();select(id);const b=board.current.getBoundingClientRect();
    const el=e.currentTarget;el.focus({preventScroll:true});el.setPointerCapture(e.pointerId);
    gesture.current={id,mode,pointer:e.pointerId,cx:e.clientX,cy:e.clientY,start:home(id).rect,area:d,peers:visible.filter(v=>v!==id).map(v=>home(v).rect),prior:frames,target:el,scaleX:d.workArea.width/b.width,scaleY:d.workArea.height/b.height,moved:false};
  }
  function move(e:ReactPointer) {
    const g=gesture.current;if(!g||e.pointerId!==g.pointer)return;
    const dx=(e.clientX-g.cx)*g.scaleX,dy=(e.clientY-g.cy)*g.scaleY;
    if(!g.moved&&Math.max(Math.abs(dx),Math.abs(dy))<3)return;
    g.moved=true;const next=snapDrag(g.start,dx,dy,g.mode,g.area.workArea,g.peers,g.id,!snap||e.altKey);
    setFrames({...g.prior,[g.id]:toFrame(next.rect,g.area,g.id)});lines(next.guides);
  }
  function toggle(id:ModuleId) {
    if(ids.includes(id)) {setIds(ids.filter(v=>v!==id));if(selected===id)select(undefined);}
    else {setIds([...ids,id]);select(id);if(d&&!frames[id]){const rect=home(id).rect;setFrames({...frames,[id]:toFrame({...rect,x:d.workArea.x+24,y:d.workArea.y+24},d,id)});}else if(frames[id])pick(home(id).display.id);}
  }
  async function save(){if(busy||gesture.current)return;wait(true);try{
    const applied={...frames};for(const id of ids)if(!applied[id]){const h=home(id);applied[id]=toFrame(h.rect,h.display,id);}
    await api.dispatch({type:'layout:apply',ids,frames:applied,snap});close();
  }catch(e){fail(errorMessage(e));wait(false);}}
  const chosen=selected&&visible.includes(selected)?home(selected).rect:null;
  return <Modal title="整理桌面布局" className="layout-studio" onClose={()=>{if(gesture.current)stop(true);else if(!busy)close();}}>
    <div className="studio-toolbar"><div><span className="eyebrow">DESKTOP LAYOUT</span><p>拖卡片移动，拖边缘或角点缩放。对齐线亮起时松手即可贴齐。</p></div>{d&&<MonitorPicker displays={displays} selected={d} pick={id=>{stop(true);pick(id);}}/>}</div>
    <div className="studio-body"><div className="studio-screen-wrap">{d && <div className="studio-screen" ref={board} aria-label="桌面布局画布" style={{aspectRatio:`${d.workArea.width}/${d.workArea.height}`,maxWidth:`${54*d.workArea.width/d.workArea.height}vh`,backgroundImage:wallpaper?`linear-gradient(#243c3048,#243c303a),url("${wallpaperURL(wallpaper)}")`:undefined}} onPointerMove={move} onPointerUp={e=>{if(gesture.current?.pointer===e.pointerId){move(e);stop(false);}}} onPointerCancel={()=>stop(true)} onLostPointerCapture={()=>stop(true)}>
      {visible.map(id=>{const r=home(id).rect,Icon=icons[id];return <div key={id} data-module={id} className={`studio-tile ${selected===id?'selected':''}`} style={localStyle(r,d.workArea)}>
        <button type="button" className="studio-tile-face" aria-label={`移动${modules[id].name}`} onPointerDown={e=>begin(e,id,'move')} onFocus={()=>select(id)} onKeyDown={e=>{
          if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||gesture.current)return;e.preventDefault();
          const step=e.altKey?1:8;const axis=e.key==='ArrowLeft'?[-step,0]:e.key==='ArrowRight'?[step,0]:e.key==='ArrowUp'?[0,-step]:[0,step];
          const next=snapDrag(r,axis[0],axis[1],e.shiftKey?'resize':'move',d.workArea,[],id,true);setFrames({...frames,[id]:toFrame(next.rect,d,id)});
        }}><span><Icon size={17}/>{modules[id].name}</span><small>{r.width} × {r.height}</small><Grip className="studio-grip-mark" size={16}/></button>
        {resizeHandles.map(h=><button type="button" key={h.mode} aria-label={`${modules[id].name}：${h.label}`} title={h.label} className={`module-grip grip-${h.mode}`} tabIndex={-1} onPointerDown={e=>begin(e,id,h.mode)}/>)}
      </div>;})}
      <div className="snap-guides" aria-hidden="true">{guides.x!==undefined&&<i className="snap-line-x" style={{left:`${100*(guides.x-d.workArea.x)/d.workArea.width}%`}}/>}{guides.y!==undefined&&<i className="snap-line-y" style={{top:`${100*(guides.y-d.workArea.y)/d.workArea.height}%`}}/>}</div>
      {!visible.length&&<span className="studio-empty">从模块列表添加卡片</span>}
    </div>}</div>
    <aside className="studio-palette"><strong>桌面模块</strong>{moduleIds.map(id=>{const Icon=icons[id];return <div className="studio-choice" key={id}><input type="checkbox" aria-label={`显示${modules[id].name}`} checked={ids.includes(id)} disabled={busy||!d} onChange={()=>toggle(id)}/><button title={`选中${modules[id].name}`} disabled={!d||!ids.includes(id)} onClick={()=>{pick(home(id).display.id);select(id);}}><Icon size={14}/><span>{modules[id].name}</span></button></div>;})}
    {d&&ids.some(id=>!visible.includes(id))&&<div className="studio-transfer">移到此屏幕{ids.filter(id=>!visible.includes(id)).map(id=><button key={id} className="text-link" onClick={()=>{setFrames({...frames,[id]:toFrame({...home(id).rect,x:d.workArea.x+24,y:d.workArea.y+24},d,id)});select(id);}}>{modules[id].name} →</button>)}</div>}
    </aside></div>
    <div className="studio-options"><label><input type="checkbox" checked={snap} onChange={e=>enableSnap(e.target.checked)}/><Magnet size={15}/>自动吸附</label><span>{chosen?`${chosen.width} × ${chosen.height} DIP`:'选择一张卡片开始整理'}</span><button className="text-link" onClick={()=>{stop(true);setIds(shownModules({...state.settings,canvasModules:undefined}));setFrames({});setPreset(true);select(undefined);}}><RotateCcw size={13}/>恢复预设</button></div>
    {(error||displayError)&&<p className="form-error" role="alert">{error||displayError}</p>}<div className="modal-footer"><span className="shortcut-hint">Alt 自由拖动 · 方向键微调 · Shift + 方向键缩放</span><button className="button" disabled={busy} onClick={close}>取消</button><button className="button primary" disabled={!d||busy} onClick={()=>void save()}><Check size={15}/>应用布局</button></div>
  </Modal>;
}

export function LayoutButton({state,small=false}:{state:AppState;small?:boolean}) {
  const [open,set]=useState(false);
  return <><button className={`button ${small?'small':''}`} onClick={()=>set(true)}><Layers size={15}/>整理布局</button>{open&&<Studio state={state} close={()=>set(false)}/>}</>;
}

export function SpatialPreview({state,panel,standalone}:{state:AppState;panel:(id:ModuleId)=>ReactNode;standalone:boolean}) {
  const {displays,error}=useDisplays(), [monitor,pick]=useState<number>(), [width,measure]=useState(0);
  const ref=useRef<HTMLDivElement>(null), d=displays.find(s=>s.id===monitor)??displays.find(s=>s.primary)??displays[0];
  useLayoutEffect(()=>{const el=ref.current;if(!el)return;const ob=new ResizeObserver(()=>measure(el.clientWidth));ob.observe(el);measure(el.clientWidth);return()=>ob.disconnect();},[]);
  if(!d && error)return <p className="form-error">{error}</p>;
  const a=d?.workArea, scale=a&&width?Math.min(width/a.width,standalone?window.innerHeight/a.height:1):0;
  return <div className="spatial-preview-wrap" ref={ref}>{d&&displays.length>1&&<MonitorPicker displays={displays} selected={d} pick={pick}/>}
    {a&&scale>0&&<div className="spatial-viewport" style={{width:a.width*scale,height:a.height*scale}}><div className="spatial-plane" style={{width:a.width,height:a.height,transform:`scale(${scale})`}}>
      {shownModules(state.settings).map(id=>{const home=displayedHome(state.settings,id,displays);return home.display.id===d.id&&<div key={id} data-module={id} className="spatial-frame" style={{left:home.rect.x-a.x,top:home.rect.y-a.y,width:home.rect.width,height:home.rect.height}}>{panel(id)}</div>;})}
    </div></div>}</div>;
}
