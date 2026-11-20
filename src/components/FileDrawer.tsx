import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppWindow, Archive, Eye, EyeOff, File, FileText, Folder, FolderOpen, MoreHorizontal, RefreshCw, SquareArrowOutUpRight } from 'lucide-react';
import type { AppState } from '../../shared/types';
import { drawerNames, emptyDrawer, type DrawerCategory, type DrawerItem, type DrawerPoint } from '../../shared/drawer';
import { api, errorMessage } from '../api';
import { FrostedPanel } from './FrostedPanel';
import { DrawerIntent } from './drawer-intent';
import './file-drawer.css';

const icons = {app:AppWindow,document:FileText,folder:Folder,other:File};
const categories=Object.keys(drawerNames) as DrawerCategory[];

type MenuRequest={id:string;point:DrawerPoint;trigger:HTMLButtonElement;ticket?:string};
type MenuAction=(request:MenuRequest,extended?:boolean)=>void;
function menuPoint(x:number,y:number):DrawerPoint {return {x:Math.min(1,Math.max(0,x/innerWidth)),y:Math.min(1,Math.max(0,y/innerHeight))};}

// Paint immediately while preparing only this gesture's file menu off-process.
function QuickMenu({request,close,open,more}:{request:MenuRequest;close:()=>void;open:(id:string,reveal:boolean)=>void;more:(r:MenuRequest)=>void}) {
  const ref=useRef<HTMLDivElement>(null);
  const handedOff=useRef(false);
  useLayoutEffect(()=>{
    const el=ref.current!, panel=el.offsetParent as HTMLElement, box=panel.getBoundingClientRect();
    const x=(request.point.x*innerWidth-box.left)*panel.offsetWidth/box.width;
    const y=(request.point.y*innerHeight-box.top)*panel.offsetHeight/box.height;
    el.style.left=`${Math.max(6,Math.min(x,panel.clientWidth-el.offsetWidth-6))}px`;
    el.style.top=`${Math.max(6,Math.min(y,panel.clientHeight-el.offsetHeight-6))}px`;
    el.querySelector('button')?.focus({preventScroll:true});
  },[request]);
  useEffect(()=>{
    if(request.ticket)void api.prepareDrawerMenu(request.id,request.ticket).catch(()=>{});
    const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))close();};
    document.addEventListener('pointerdown',outside,true);window.addEventListener('blur',close);window.addEventListener('resize',close);window.addEventListener('wallnote:outside-press',close);
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('blur',close);window.removeEventListener('resize',close);window.removeEventListener('wallnote:outside-press',close);if(request.ticket&&!handedOff.current)void api.discardDrawerMenu(request.ticket).catch(()=>{});};
  },[close,request]);
  const finish=()=>{request.trigger.focus({preventScroll:true});close();};
  return <div className="drawer-menu" ref={ref} role="menu" aria-label="文件操作" onKeyDown={e=>{
    if(e.key==='Tab'){finish();return;}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish();return;}
    const items=Array.from(e.currentTarget.querySelectorAll('button')),i=items.indexOf(document.activeElement as HTMLButtonElement);
    const next=e.key==='ArrowDown'?(i+1)%items.length:e.key==='ArrowUp'?(i+items.length-1)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:-1;
    if(next>=0){e.preventDefault();items[next].focus();}
  }}><button role="menuitem" onClick={()=>{finish();open(request.id,false);}}><SquareArrowOutUpRight size={15}/>打开</button><button role="menuitem" onClick={()=>{finish();open(request.id,true);}}><FolderOpen size={15}/>打开所在位置</button><button role="menuitem" onClick={()=>{handedOff.current=true;finish();more(request);}}><MoreHorizontal size={15}/>Windows 文件菜单</button></div>;
}
const FileTile=memo(function FileTile({item,selected,select,firstClick,open,menu,intent}:{item:DrawerItem;selected:boolean;select:(id:string)=>void;firstClick:RefObject<string|null>;open:(id:string,reveal:boolean)=>void;menu:MenuAction;intent?:DrawerIntent}) {
  const [icon,setIcon]=useState(''), ref=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    let live=true;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){
      observer.disconnect();void api.drawerIcon(item.id).then(v=>{if(live)setIcon(v.startsWith('data:image/png;base64,')?v:'');}).catch(()=>{if(live)setIcon('');});
    }},{root:ref.current?.closest('.drawer-list')??null,rootMargin:'32px'});
    if(ref.current)observer.observe(ref.current);return()=>{live=false;observer.disconnect();};
  },[item.id,item.iconVersion]);
  const Icon=icons[item.category];return <div className={`drawer-cell${selected?' selected':''}`} onPointerEnter={e=>{if(e.pointerType==='mouse'&&!e.buttons)intent?.aim(item.id);}} onPointerLeave={()=>intent?.clear(item.id)} onContextMenu={e=>{
    e.preventDefault();e.stopPropagation();firstClick.current=null;select(item.id);ref.current?.focus({preventScroll:true});
    const trigger=ref.current!,b=trigger.getBoundingClientRect();menu({id:item.id,trigger,point:e.clientX||e.clientY?menuPoint(e.clientX,e.clientY):menuPoint(b.left+b.width/2,b.bottom)},e.shiftKey);
  }}><button type="button" className="drawer-tile" ref={ref} aria-label={`选择${item.name}`} aria-pressed={selected} aria-haspopup="menu" title={item.name}
    onPointerDown={e=>{if(e.isPrimary && (e.button===0||e.button===2)){select(item.id);if(e.button===2&&!e.shiftKey)intent?.aim(item.id,true);}}}
    onClick={e=>{if(e.detail===1)firstClick.current=item.id;select(item.id);}}
    onDoubleClick={e=>{if(e.button===0&&firstClick.current===item.id){firstClick.current=null;open(item.id,false);}}}
    onKeyDown={e=>{
      if(e.key==='Enter'){e.preventDefault();if(!e.repeat){select(item.id);open(item.id,false);}}
       else if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();if(!e.repeat){select(item.id);const b=e.currentTarget.getBoundingClientRect();menu({id:item.id,trigger:e.currentTarget,point:menuPoint(b.left+b.width/2,b.bottom)});}}
    }}>
    <span className="drawer-glyph">{icon?<img src={icon} alt="" draggable={false} onError={()=>setIcon('')}/>:<Icon size={25}/>}</span><span>{item.name}</span></button><button className="drawer-reveal" aria-label={`定位${item.name}`} title="在文件资源管理器中显示" onClick={()=>open(item.id,true)}><FolderOpen size={13}/></button></div>;
});

export function FileDrawerPanel({state,desktop=false}:{state:AppState;desktop?:boolean}) {
  const [view,set]=useState(emptyDrawer),[tab,pick]=useState<DrawerCategory>('app'),[limit,setLimit]=useState(40),[error,fail]=useState(''),[changing,wait]=useState(false);
  const list=useRef<HTMLDivElement>(null);
  const [selected,select]=useState<string|null>(null);
  const firstClick=useRef<string|null>(null);
  const [quick,setQuick]=useState<MenuRequest|null>(null);
  const windowsMenu=state.settings.drawerMenuMode!=='quick';
  const intent=useMemo(()=>new DrawerIntent(api.prepareDrawerMenu,api.discardDrawerMenu),[]);
  const opening=useRef<string|undefined>(undefined);
  const cancelOpening=useCallback(()=>{const ticket=opening.current;opening.current=undefined;if(ticket)void api.discardDrawerMenu(ticket).catch(()=>{});},[]);
  useEffect(()=>{
    const clear=()=>intent.clear();clear();window.addEventListener('blur',clear);window.addEventListener('wallnote:outside-press',clear);
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')cancelOpening();};
    window.addEventListener('pointerdown',cancelOpening,true);window.addEventListener('keydown',escape,true);window.addEventListener('wallnote:outside-press',cancelOpening);
    return()=>{clear();cancelOpening();window.removeEventListener('blur',clear);window.removeEventListener('wallnote:outside-press',clear);window.removeEventListener('pointerdown',cancelOpening,true);window.removeEventListener('keydown',escape,true);window.removeEventListener('wallnote:outside-press',cancelOpening);};
  },[intent,tab,windowsMenu,view.enabled,cancelOpening]);
  const closeMenu=useCallback(()=>setQuick(null),[]);
  useEffect(()=>{if(selected&&!view.items.some(i=>i.id===selected&&i.category===tab))select(null);},[view.items,tab,selected]);
  useEffect(()=>{let live=true,updated=false;const off=api.onDrawer(v=>{updated=true;if(live)set(v);});
    void api.getDrawer().then(v=>{if(live&&!updated)set(v);}).catch(e=>{if(live)fail(errorMessage(e));});return()=>{live=false;off();};},[]);
  const groups=useMemo(()=>{const g:Record<DrawerCategory,DrawerItem[]>={app:[],document:[],folder:[],other:[]};for(const i of view.items)g[i.category].push(i);return g;},[view.items]);
  const requested=state.settings.hideIconsWithDrawer===true, rows=groups[tab];
  useEffect(()=>{if(quick&&!rows.some(i=>i.id===quick.id))closeMenu();},[quick,rows,closeMenu]);
  const toggle=async()=>{wait(true);fail('');try{await api.setDrawerIcons(!requested);}catch(e){fail(errorMessage(e));}finally{wait(false);}};
  const open=useCallback((id:string,reveal:boolean)=>{intent.clear();fail('');void api.openDrawerItem(id,reveal).catch(e=>fail(errorMessage(e)));},[intent]);
  const systemMenu=useCallback((r:MenuRequest,extended=false)=>{
    cancelOpening();fail('');const ticket=opening.current=r.ticket??crypto.randomUUID();
    void api.showDrawerMenu(r.id,r.point,extended,ticket).catch(e=>{if(opening.current===ticket)fail(errorMessage(e));}).finally(()=>{if(opening.current===ticket)opening.current=undefined;});
  },[cancelOpening]);
  const menu:MenuAction=useCallback((r,extended)=>{
    fail('');
    if(extended){intent.clear();closeMenu();systemMenu(r,true);}
    else if(windowsMenu){closeMenu();systemMenu({...r,ticket:intent.take(r.id)});}
    else setQuick({...r,ticket:crypto.randomUUID()});
  },[intent,windowsMenu,closeMenu,systemMenu]);
  const message=error || view.message || (view.icons==='error'?'图标隐藏未生效。可关闭开关后重试。':'');
  const label=view.icons==='hidden'||view.icons==='already-hidden'?'桌面图标已隐藏':view.icons==='starting'?'正在隐藏…':'隐藏桌面图标';
  return <FrostedPanel state={state} desktop={desktop} title="文件抽屉" widgetKey="drawer" icon={<Archive size={17}/>} className="file-drawer-panel" onClose={desktop?()=>void api.dispatch({type:'settings:update',changes:{showDesktopDrawer:false}}).catch(e=>fail(errorMessage(e))):undefined}>
    <div className="drawer-tabs" role="group" aria-label="文件分类">{categories.map(c=><button key={c} aria-pressed={tab===c} onClick={()=>{pick(c);select(null);closeMenu();setLimit(40);if(list.current)list.current.scrollTop=0;}}>{drawerNames[c]} <small>{groups[c].length}</small></button>)}</div>
    <div className="drawer-list" ref={list} onScroll={()=>{intent.clear();if(quick)closeMenu();}} onPointerDown={e=>{if(e.isPrimary && (e.button===0||e.button===2) && !(e.target as Element).closest('button')){firstClick.current=null;select(null);intent.clear();}}} onKeyDown={e=>{if(e.key==='Escape'){firstClick.current=null;select(null);intent.clear();}}}>{rows.length?<><div className="drawer-grid">{rows.slice(0,limit).map(i=><FileTile key={i.id} item={i} selected={selected===i.id} select={select} firstClick={firstClick} open={open} menu={menu} intent={windowsMenu?intent:undefined}/>)}</div>{rows.length>limit&&<button className="text-link" onClick={()=>setLimit(n=>n+40)}>显示更多（剩余 {rows.length-limit} 项）</button>}</>:<p className="drawer-empty">{!view.enabled?'桌面文件抽屉未开启':view.busy&&!view.ready?'正在读取桌面…':'这个分类是空的'}</p>}</div>
    {message&&<p className="widget-error" role="status">{message}</p>}
    {quick&&<QuickMenu key={quick.ticket} request={quick} close={closeMenu} open={open} more={systemMenu}/>}
    <footer className="drawer-footer"><button role="switch" aria-label="隐藏桌面图标" aria-checked={requested} disabled={changing||!view.enabled||!requested&&!view.canHide} onClick={()=>void toggle()} title="只改变系统图标显示，关闭抽屉或退出时恢复">{requested?<EyeOff size={14}/>:<Eye size={14}/>} {label}</button><button className="icon-button" aria-label="刷新文件抽屉" disabled={!view.enabled||view.busy} onClick={()=>void api.refreshDrawer().catch(e=>fail(errorMessage(e)))}><RefreshCw size={14} className={view.busy?'spin':''}/></button></footer>
  </FrostedPanel>;
}
