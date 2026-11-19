// Default: isolated profile, renderer-directed gestures and a synthetic DIP cursor.
// --physical: briefly show the desktop and drag two unobstructed test controls with
// the OS mouse. The helper checks the target and restores the pointer after each drag.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();await mkdir('test-results',{recursive:true});
const dir=await mkdtemp(path.resolve('test-results','snap-')), packaged=process.argv.includes('--packaged');
const env={...process.env,WALLNOTE_DATA_DIR:dir,WALLNOTE_CREATE_MANAGER:'1',WALLNOTE_SHOW_MANAGER:'0'};
delete env.VITE_DEV_SERVER_URL;delete env.WALLNOTE_ENABLE_WIFI_RECEIVER;
const native=promisify(execFile), helper=path.resolve(packaged?'release/win-unpacked/resources/native/WallNote.DesktopHost.exe':'dist-native/WallNote.DesktopHost.exe');
const physical=process.argv.includes('--physical'),input=path.join(dir,'DesktopInput.exe');let showing=false;
if(physical)await native(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',`/out:${input}`,path.resolve('tests/DesktopInput.cs'),path.resolve('native/DesktopInputBridge.cs')],{windowsHide:true});
let app,manager,widget;
async function launch(){
  app=await electron.launch({...(packaged?{executablePath:path.resolve('release/win-unpacked/WallNote.exe'),args:[]}:{args:['.']}),env,timeout:45000});
  await app.firstWindow(); const find=()=>app.windows().find(p=>p.url().startsWith('file:')&&!new URL(p.url()).search);
  await expect.poll(()=>find()?.evaluate(()=>window.wallnote?.getDesktopStatus()),{timeout:30000}).toMatchObject({active:true,widgets:4});
  manager=find();widget=app.windows().find(p=>p.url().includes('widget=tasks'));
}
const surf=()=>widget.evaluate(()=>window.wallnote.getDesktopSurface());
const frames=()=>manager.evaluate(()=>window.wallnote.getState().then(s=>s.settings.dockFrames));
const mockCursor=async pt=>app.evaluate(({screen},pt)=>{screen.getCursorScreenPoint=()=>pt;},pt);
async function gesture(locator,x,y){
  const b=await locator.boundingBox(), cx=Math.round(b.x+b.width/2),cy=Math.round(b.y+b.height/2);
  if(physical){
    const w=await actual(), owner=await app.evaluate(()=>process.pid),[vw,vh]=await widget.evaluate(()=>[innerWidth,innerHeight]);
    const sx=w.bounds.width/vw,sy=w.bounds.height/vh;
    for(const [fx,fy] of [[.5,.5],[.25,.25],[.75,.75]]){
      const px=Math.round(w.bounds.x+(b.x+b.width*fx)*sx), py=Math.round(w.bounds.y+(b.y+b.height*fy)*sy);
      const check=await native(helper,['route-check',w.handle,String(owner),String(px),String(py)],{windowsHide:true});
      if(!JSON.parse(check.stdout.replace(/^\uFEFF/,'')).allowed)continue;
      await native(input,['drag',px,py,Math.round(x*sx),Math.round(y*sy),`desktop:${w.handle}`,owner].map(String),{windowsHide:true});return;
    }
    throw new Error('No unobstructed test control; no desktop input sent.');
  }
  const {bounds:r}=await surf();await mockCursor({x:r.x+cx+x,y:r.y+cy+y});
  await widget.mouse.move(cx,cy);await widget.mouse.down();await widget.mouse.up();
}
async function actual(){const b=await app.browserWindow(widget);const id=await b.evaluate(w=>w.getNativeWindowHandle().readBigUInt64LE().toString());await b.dispose();return JSON.parse((await native(helper,['inspect',id],{windowsHide:true})).stdout.replace(/^\uFEFF/,'')).window;}
async function aligned(rect){const px=await app.evaluate(({screen},r)=>screen.dipToScreenRect(null,r),rect);await expect.poll(async()=>{const r=(await actual()).bounds;return Math.max(...Object.keys(px).map(k=>Math.abs(px[k]-r[k])));}).toBeLessThanOrEqual(2);}
try {
  await launch();const [display]= (await manager.evaluate(()=>window.wallnote.getLayoutDisplays())).filter(d=>d.primary);
  const a=display.workArea,r=(await surf()).bounds;
  if(physical){await native(helper,['show-desktop'],{windowsHide:true});showing=true;await new Promise(r=>setTimeout(r,650));}
  await gesture(widget.locator('.frost-title'),a.x+3-r.x,a.y+3-r.y);
  await expect.poll(frames).toMatchObject({tasks:{x:0,y:0,displayId:display.id}});
  await aligned({...r,x:a.x,y:a.y});expect((await actual()).child).toBe(true);
  const peer=await app.windows().find(p=>p.url().includes('widget=calendar')).evaluate(()=>window.wallnote.getDesktopSurface().then(s=>s.bounds));
  const right=peer.x-12;
  await gesture(widget.locator('.grip-e'),right-3-a.x-r.width,0);
  if(showing){await native(helper,['restore-desktop'],{windowsHide:true});showing=false;}
  await expect.poll(async()=>Math.round((await frames()).tasks.width*a.width)).toBe(right-a.x);
  const applied=(await surf()).bounds;await aligned(applied);
  const saved=await frames();await mockCursor({x:a.x+100,y:a.y+60});
  await widget.evaluate(()=>{window.wallnote.manipulateDesktopWidget('move',{x:20,y:20},false);window.wallnote.finishDesktopManipulation(true);});
  await new Promise(r=>setTimeout(r,350));expect(await frames()).toEqual(saved);await aligned(applied);
  await manager.evaluate(()=>window.wallnote.dispatch({type:'widget:topmost',key:'tasks',enabled:true}));
  await manager.evaluate(()=>window.wallnote.dispatch({type:'widget:topmost',key:'tasks',enabled:false}));await aligned(applied);
  await app.close();app=undefined;await launch();await aligned(applied);expect((await actual()).child).toBe(true);
  await manager.evaluate(()=>window.wallnote.desktopControl('showManager'));
  await manager.getByRole('button',{name:'整理布局',exact:true}).click();const dialog=manager.getByRole('dialog',{name:'整理桌面布局'});
  const tile=dialog.locator('[data-module=tasks]'), edge=tile.locator('.grip-resize');await expect(edge).toBeVisible();
  const from=await tile.boundingBox(),b=await edge.boundingBox();const cx=b.x+b.width/2,cy=b.y+b.height/2;
  await manager.mouse.move(cx,cy);await manager.mouse.down();await manager.mouse.move(cx+45,cy+30,{steps:7});
  expect((await tile.boundingBox()).width).toBeGreaterThan(from.width+20);
  await manager.keyboard.press('Escape');await manager.mouse.up();await expect(tile).toBeVisible();
  expect(Math.abs((await tile.boundingBox()).width-from.width)).toBeLessThan(1);
  await dialog.getByRole('checkbox',{name:'显示社区日报'}).check();await dialog.getByRole('button',{name:'取消',exact:true}).click();
  expect(await frames()).toEqual(saved);await aligned(applied);
  console.log('Snap layout passed: direct header/edge gestures, monitor and peer magnets, actual WorkerW bounds, cancel, unpin, restart and studio discard.');
}finally{if(showing)await native(helper,['restore-desktop'],{windowsHide:true});await app?.close();}
