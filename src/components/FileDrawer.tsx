import { useEffect, useRef, useState, type RefObject } from 'react';
import { AppWindow, Archive, Eye, EyeOff, File, FileText, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { drawerNames, emptyDrawer, type DrawerCategory, type DrawerItem, type DrawerPoint } from '../../shared/drawer';
import { api, errorMessage } from '../api';
import { FrostedPanel } from './FrostedPanel';
import { useDrawerHitAreas } from './drawer-hit-areas';
import './file-drawer.css';

const icons = {app:AppWindow,document:FileText,folder:Folder,other:File};
const categories=Object.keys(drawerNames) as DrawerCategory[];

type MenuAction=(id:string,point:DrawerPoint,extended:boolean)=>void;
function menuPoint(x:number,y:number):DrawerPoint {return {x:Math.min(1,Math.max(0,x/innerWidth)),y:Math.min(1,Math.max(0,y/innerHeight))};}
function FileTile({item,selected,select,firstClick,open,menu}:{item:DrawerItem;selected:boolean;select:(id:string)=>void;firstClick:RefObject<string|null>;open:(id:string,reveal:boolean)=>void;menu:MenuAction}) {
  const [icon,setIcon]=useState(''), ref=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    let live=true;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){
      observer.disconnect();void api.drawerIcon(item.id).then(v=>{if(live)setIcon(v.startsWith('data:image/png;base64,')?v:'');}).catch(()=>{if(live)setIcon('');});
    }},{root:ref.current?.closest('.drawer-list')??null,rootMargin:'32px'});
    if(ref.current)observer.observe(ref.current);return()=>{live=false;observer.disconnect();};
  },[item.id,item.iconVersion]);
  const Icon=icons[item.category];return <div className={`drawer-cell${selected?' selected':''}`} onContextMenu={e=>{
    e.preventDefault();e.stopPropagation();firstClick.current=null;select(item.id);ref.current?.focus({preventScroll:true});
    const b=ref.current!.getBoundingClientRect();menu(item.id,e.clientX||e.clientY?menuPoint(e.clientX,e.clientY):menuPoint(b.left+b.width/2,b.bottom),e.shiftKey);
  }}><button type="button" className="drawer-tile" ref={ref} aria-label={`选择${item.name}`} aria-pressed={selected} aria-haspopup="menu" title={`${item.name} · ${item.origin==='public'?'公共桌面':'个人桌面'}\n双击打开，右键显示文件菜单`}
    onClick={e=>{if(e.detail===1)firstClick.current=item.id;select(item.id);}}
    onDoubleClick={e=>{if(e.button===0&&firstClick.current===item.id){firstClick.current=null;open(item.id,false);}}}
    onKeyDown={e=>{
      if(e.key==='Enter'){e.preventDefault();if(!e.repeat){select(item.id);open(item.id,false);}}
      else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();if(!e.repeat){select(item.id);const b=e.currentTarget.getBoundingClientRect();menu(item.id,menuPoint(b.left+b.width/2,b.bottom),false);}}
    }}>
    <span className="drawer-glyph">{icon?<img src={icon} alt="" draggable={false} onError={()=>setIcon('')}/>:<Icon size={25}/>}</span><span>{item.name}</span></button><button className="drawer-reveal" aria-label={`定位${item.name}`} title="在文件资源管理器中显示" onClick={()=>open(item.id,true)}><FolderOpen size={13}/></button></div>;
}

export function FileDrawerPanel({state,desktop=false}:{state:AppState;desktop?:boolean}) {
  const [view,set]=useState(emptyDrawer),[tab,pick]=useState<DrawerCategory>('app'),[limit,setLimit]=useState(40),[error,fail]=useState(''),[changing,wait]=useState(false);
  const list=useRef<HTMLDivElement>(null);
  const [selected,select]=useState<string|null>(null);
  const firstClick=useRef<string|null>(null);
  useDrawerHitAreas(list,desktop,view.items,tab,limit);
  useEffect(()=>{if(selected&&!view.items.some(i=>i.id===selected&&i.category===tab))select(null);},[view.items,tab,selected]);
  useEffect(()=>{let live=true,updated=false;const off=api.onDrawer(v=>{updated=true;if(live)set(v);});
    void api.getDrawer().then(v=>{if(live&&!updated)set(v);}).catch(e=>{if(live)fail(errorMessage(e));});return()=>{live=false;off();};},[]);
  const requested=state.settings.hideIconsWithDrawer===true, rows=view.items.filter(i=>i.category===tab);
  const toggle=async()=>{wait(true);fail('');try{await api.setDrawerIcons(!requested);}catch(e){fail(errorMessage(e));}finally{wait(false);}};
  const open=(id:string,reveal:boolean)=>{fail('');void api.openDrawerItem(id,reveal).catch(e=>fail(errorMessage(e)));};
  const menu:MenuAction=(id,point,extended)=>{fail('');void api.showDrawerMenu(id,point,extended).catch(e=>fail(errorMessage(e)));};
  const message=error || view.message || (view.icons==='error'?'图标隐藏未生效。可关闭开关后重试。':'');
  const label=view.icons==='hidden'?'原图标已隐藏':view.icons==='already-hidden'?'系统图标原已隐藏':view.icons==='starting'?'正在隐藏…':'隐藏桌面图标';
  return <FrostedPanel state={state} desktop={desktop} title="文件抽屉" widgetKey="drawer" icon={<Archive size={17}/>} className="file-drawer-panel" onClose={desktop?()=>void api.dispatch({type:'settings:update',changes:{showDesktopDrawer:false}}).catch(e=>fail(errorMessage(e))):undefined}>
    <div className="drawer-tabs" role="group" aria-label="文件分类">{categories.map(c=><button key={c} aria-pressed={tab===c} onClick={()=>{pick(c);select(null);setLimit(40);if(list.current)list.current.scrollTop=0;}}>{drawerNames[c]} <small>{view.items.filter(i=>i.category===c).length}</small></button>)}</div>
    <div className="drawer-list" ref={list} onClick={e=>{if(!(e.target as Element).closest('button')){firstClick.current=null;select(null);}}} onKeyDown={e=>{if(e.key==='Escape'){firstClick.current=null;select(null);}}}>{rows.length?<><div className="drawer-grid">{rows.slice(0,limit).map(i=><FileTile key={i.id} item={i} selected={selected===i.id} select={select} firstClick={firstClick} open={open} menu={menu}/>)}</div>{rows.length>limit&&<button className="text-link" onClick={()=>setLimit(n=>n+40)}>显示更多（还有 {rows.length-limit} 项）</button>}</>:<p className="drawer-empty">{!view.enabled?'开启桌面模式并应用文件抽屉布局后显示桌面项目。':view.busy&&!view.ready?'正在整理桌面…':`此分类暂无${drawerNames[tab]}。`}</p>}</div>
    {message&&<p className="widget-error" role="status">{message}</p>}
    <footer className="drawer-footer"><button role="switch" aria-label="隐藏桌面图标" aria-checked={requested} disabled={changing||!view.enabled||!requested&&!view.canHide} onClick={()=>void toggle()} title="只改变系统图标显示，关闭抽屉或退出时恢复">{requested?<EyeOff size={14}/>:<Eye size={14}/>} {label}</button><button className="icon-button" aria-label="刷新文件抽屉" disabled={!view.enabled||view.busy} onClick={()=>void api.refreshDrawer().catch(e=>fail(errorMessage(e)))}><RefreshCw size={14} className={view.busy?'spin':''}/></button></footer>
  </FrostedPanel>;
}
