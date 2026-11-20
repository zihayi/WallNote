import { currentWallpaper, wallpaperURL } from '../shared/wallpapers';
import type { AppState, DesktopSurface } from '../shared/types';
import type { Guides } from '../shared/snap-layout';
import './wallpaper.css';

// One static image per screen. No React root, control panel, minute timer or widget tree.
export async function showWallpaper(root:HTMLElement, displayId:number) {
  const api=window.wallnote ?? (await import('./api')).api;
  const main=document.createElement('main'), image=new Image();
  main.className='desktop-wallpaper';main.setAttribute('aria-label','Windows 桌面壁纸');image.draggable=false;
  const lines=document.createElement('div');lines.className='snap-guides';lines.ariaHidden='true';
  const x=document.createElement('i'),y=document.createElement('i');x.className='snap-line-x';y.className='snap-line-y';lines.append(x,y);
  main.append(image,lines);root.replaceChildren(main);
  let surface:DesktopSurface|null=null, guides:Guides={}, updated=false;
  function draw(){
    const b=surface?.bounds, visible=guides.displayId===displayId && !!b;
    x.hidden=!visible || guides.x===undefined;y.hidden=!visible || guides.y===undefined;
    if(b&&!x.hidden)x.style.left=`${guides.x!-b.x}px`;
    if(b&&!y.hidden)y.style.top=`${guides.y!-b.y}px`;
  }
  const paint=(s:AppState)=>{const w=currentWallpaper(s),url=wallpaperURL(w);if(image.getAttribute('src')!==url){image.alt=w.name;image.src=url;}};
  draw();
  const off=[api.onStateChange(s=>{updated=true;paint(s);}),api.onLayoutGuides(g=>{guides=g;draw();}),api.onDesktopSurface(s=>{surface=s;draw();})];
  window.addEventListener('pagehide',()=>off.forEach(f=>f()),{once:true});
  await Promise.all([api.getState().then(s=>{if(!updated)paint(s);}),api.getDesktopSurface().then(s=>{if(!surface){surface=s;draw();}})]);
}
