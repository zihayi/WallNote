import { useEffect, useRef, useState } from 'react';
import { AppWindow, Archive, Eye, EyeOff, File, FileText, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { drawerNames, emptyDrawer, type DrawerCategory, type DrawerItem } from '../../shared/drawer';
import { api, errorMessage } from '../api';
import { FrostedPanel } from './FrostedPanel';
import './file-drawer.css';

const icons = {app:AppWindow,document:FileText,folder:Folder,other:File};
const categories=Object.keys(drawerNames) as DrawerCategory[];

function FileTile({item,open}:{item:DrawerItem;open:(id:string,reveal:boolean)=>void}) {
  const [icon,setIcon]=useState(''), ref=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    let live=true;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){
      observer.disconnect();void api.drawerIcon(item.id).then(v=>{if(live)setIcon(v.startsWith('data:image/png;base64,')?v:'');}).catch(()=>{if(live)setIcon('');});
    }},{root:ref.current?.closest('.drawer-list')??null,rootMargin:'32px'});
    if(ref.current)observer.observe(ref.current);return()=>{live=false;observer.disconnect();};
  },[item.id,item.iconVersion]);
  const Icon=icons[item.category];return <div className="drawer-cell"><button type="button" className="drawer-tile" ref={ref} aria-label={`打开${item.name}`} title={`${item.name} · ${item.origin==='public'?'公共桌面':'个人桌面'}`} onClick={()=>open(item.id,false)}>
    <span className="drawer-glyph">{icon?<img src={icon} alt="" draggable={false} onError={()=>setIcon('')}/>:<Icon size={25}/>}</span><span>{item.name}</span></button><button className="drawer-reveal" aria-label={`定位${item.name}`} title="在文件资源管理器中显示" onClick={()=>open(item.id,true)}><FolderOpen size={13}/></button></div>;
}

export function FileDrawerPanel({state,desktop=false}:{state:AppState;desktop?:boolean}) {
  const [view,set]=useState(emptyDrawer),[tab,pick]=useState<DrawerCategory>('app'),[limit,setLimit]=useState(40),[error,fail]=useState(''),[changing,wait]=useState(false);
  const list=useRef<HTMLDivElement>(null);
  useEffect(()=>{let live=true,updated=false;const off=api.onDrawer(v=>{updated=true;if(live)set(v);});
    void api.getDrawer().then(v=>{if(live&&!updated)set(v);}).catch(e=>{if(live)fail(errorMessage(e));});return()=>{live=false;off();};},[]);
  const requested=state.settings.hideIconsWithDrawer===true, rows=view.items.filter(i=>i.category===tab);
  const toggle=async()=>{wait(true);fail('');try{await api.setDrawerIcons(!requested);}catch(e){fail(errorMessage(e));}finally{wait(false);}};
  const open=(id:string,reveal:boolean)=>{fail('');void api.openDrawerItem(id,reveal).catch(e=>fail(errorMessage(e)));};
  const message=error || view.message || (view.icons==='error'?'图标隐藏未生效。可关闭开关后重试。':'');
  const label=view.icons==='hidden'?'原图标已隐藏':view.icons==='already-hidden'?'系统图标原已隐藏':view.icons==='starting'?'正在隐藏…':'隐藏桌面图标';
  return <FrostedPanel state={state} desktop={desktop} title="文件抽屉" widgetKey="drawer" icon={<Archive size={17}/>} className="file-drawer-panel" onClose={desktop?()=>void api.dispatch({type:'settings:update',changes:{showDesktopDrawer:false}}).catch(e=>fail(errorMessage(e))):undefined}>
    <div className="drawer-tabs" role="group" aria-label="文件分类">{categories.map(c=><button key={c} aria-pressed={tab===c} onClick={()=>{pick(c);setLimit(40);if(list.current)list.current.scrollTop=0;}}>{drawerNames[c]} <small>{view.items.filter(i=>i.category===c).length}</small></button>)}</div>
    <div className="drawer-list" ref={list}>{rows.length?<><div className="drawer-grid">{rows.slice(0,limit).map(i=><FileTile key={i.id} item={i} open={open}/>)}</div>{rows.length>limit&&<button className="text-link" onClick={()=>setLimit(n=>n+40)}>显示更多（还有 {rows.length-limit} 项）</button>}</>:<p className="drawer-empty">{!view.enabled?'开启桌面模式并应用文件抽屉布局后显示桌面项目。':view.busy&&!view.ready?'正在整理桌面…':`此分类暂无${drawerNames[tab]}。`}</p>}</div>
    {message&&<p className="widget-error" role="status">{message}</p>}
    <footer className="drawer-footer"><button role="switch" aria-label="隐藏桌面图标" aria-checked={requested} disabled={changing||!view.enabled||!requested&&!view.canHide} onClick={()=>void toggle()} title="只改变系统图标显示，关闭抽屉或退出时恢复">{requested?<EyeOff size={14}/>:<Eye size={14}/>} {label}</button><button className="icon-button" aria-label="刷新文件抽屉" disabled={!view.enabled||view.busy} onClick={()=>void api.refreshDrawer().catch(e=>fail(errorMessage(e)))}><RefreshCw size={14} className={view.busy?'spin':''}/></button></footer>
  </FrostedPanel>;
}
