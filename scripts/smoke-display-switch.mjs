// Real HWNDs on connected monitors. All state and simulated hot-plug events belong
// to this disposable process; this does not change the system's display configuration.
import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();await mkdir('test-results',{recursive:true});
const dir=await mkdtemp(path.resolve('test-results','display-switch-'));
const env={...process.env,WALLNOTE_DATA_DIR:dir,WALLNOTE_SHOW_MANAGER:'1'};
for(const k of ['VITE_DEV_SERVER_URL','WALLNOTE_ENABLE_WIFI_RECEIVER','GITHUB_PERSONAL_ACCESS_TOKEN','GH_TOKEN','DEEPSEEK_API_KEY'])delete env[k];
const binary=process.env.WALLNOTE_TEST_INSTALLED_EXE||(process.argv.includes('--packaged')?path.resolve('release/win-unpacked/WallNote.exe'):'');
const helper=binary?path.join(path.dirname(binary),'resources/native/WallNote.DesktopHost.exe'):path.resolve('dist-native/WallNote.DesktopHost.exe');
const run=promisify(execFile);let app,manager;
async function launch(widgets){
  app=await electron.launch({...(binary?{executablePath:binary,args:[]}:{args:['.']}),env,timeout:60000});await app.firstWindow();
  await expect.poll(()=>{manager=app.windows().find(p=>p.url().startsWith('file:')&&!new URL(p.url()).search);return manager?.evaluate(()=>window.wallnote?.getDesktopStatus());},{timeout:30000}).toMatchObject({active:true,widgets,error:null});
}
const picker=()=>manager.getByRole('combobox',{name:'切换组件屏幕'});
const settings=()=>manager.evaluate(()=>window.wallnote.getState().then(s=>s.settings));
async function boxes(){
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().flatMap(w=>{
    const url=w.webContents.getURL();if(!url.startsWith('file:'))return [];
    const q=new URL(url).searchParams,key=q.get('widget')||(q.has('note')?'notes':null);
    return key?[{key,handle:w.getNativeWindowHandle().readBigUInt64LE().toString()}]:[];
  }));
  return Promise.all(windows.map(async w=>{const {stdout}=await run(helper,['inspect',w.handle],{windowsHide:true});return {...w,...JSON.parse(stdout.replace(/^\uFEFF/,'')).window};}));
}
async function assertOn(display){
  const px=await app.evaluate(({screen},area)=>screen.dipToScreenRect(null,area),display.workArea);
  try{await expect.poll(async()=>{
    const items=await boxes();return items.length===3 && items.every(w=>{const r=w.bounds;return r && r.x>=px.x-2 && r.y>=px.y-2 && r.x+r.width<=px.x+px.width+2 && r.y+r.height<=px.y+px.height+2 && (w.key==='tasks'?w.topmost:w.child);});
  },{timeout:10000,message:`All three windows must be on display ${display.id}, with their original layers`}).toBe(true);}catch(e){console.error(JSON.stringify({display,px,actual:(await boxes()).map(w=>({key:w.key,bounds:w.bounds,topmost:w.topmost,child:w.child,dpi:w.dpi})),settings:await settings(),status:await manager.evaluate(()=>window.wallnote.getDesktopStatus())},null,2));throw e;}
}
try {
  await launch(4);const displays=await manager.evaluate(()=>window.wallnote.getLayoutDisplays());
  const p=displays.find(d=>d.primary),other=displays.find(d=>!d.primary);
  await expect(manager.evaluate(async()=>{try{await window.wallnote.switchModuleDisplay(Number.MIN_SAFE_INTEGER);return false;}catch{return true;}})).resolves.toBe(true);
  expect((await settings()).moduleDisplayId).toBeUndefined();
  if(!other){await expect(picker()).toHaveCount(0);console.log('Single-screen UI verified; a second display is required for the native move test.');}
  else {
    await app.evaluate(({Tray})=>{const set=Tray.prototype.setContextMenu;Tray.prototype.setContextMenu=function(menu){globalThis.__testTray=menu;return set.call(this,menu);};});
    await manager.evaluate(async({id})=>{
      const api=window.wallnote;
      await api.dispatch({type:'note:add',note:{id:'screen-note',title:'测试便签',content:'跨屏保留',color:'mint',pinned:true,updatedAt:new Date().toISOString()}});
      await api.dispatch({type:'widget:topmost',key:'tasks',enabled:true});
      await api.dispatch({type:'layout:apply',ids:['calendar','notes','schedule','tasks'],frames:{calendar:{displayId:id,x:.12,y:.07,width:.4,height:.82}},snap:false});
      await api.dispatch({type:'settings:update',changes:{showDesktopSchedule:false}});
    },p);
    const calendar=app.windows().find(w=>w.url().includes('widget=calendar'));
    expect(await calendar.evaluate(async id=>{try{await window.wallnote.switchModuleDisplay(id);return false;}catch{return true;}},other.id)).toBe(true);
    await assertOn(p);const before=await boxes(), handles=list=>list.map(w=>w.handle).sort();
    const primaryLabel=await picker().locator(`option[value="${p.id}"]`).textContent();
    await picker().selectOption(String(other.id));await expect(picker()).toBeEnabled();await assertOn(other);
    expect(handles(await boxes())).toEqual(handles(before));
    expect(await settings()).toMatchObject({moduleDisplayId:other.id,showDesktopSchedule:false,layoutSnap:false,topmostWidgets:['tasks'],dockFrames:{calendar:{displayId:other.id,x:.12,y:.07,width:.4,height:.82}}});
    await expect(manager.locator('.spatial-frame[data-module="calendar"]')).toBeVisible();
    // Invoke the actual tray submenu callback, without moving the OS pointer.
    await app.evaluate((_e,name)=>{const menu=globalThis.__testTray.items.find(i=>i.label==='切换组件屏幕');menu.submenu.items.find(i=>i.label===name.replace(/&/g,'&&')).click();},primaryLabel);
    await expect(picker()).toHaveValue(String(p.id));await assertOn(p);
    for(const item of await boxes())expect(item.bounds).toEqual(before.find(w=>w.key===item.key).bounds);
    await picker().selectOption(String(other.id));await expect(picker()).toBeEnabled();await assertOn(other);
    // Simulate disconnect/reconnect inside the fixture only. Keep the saved preference.
    await app.evaluate(({screen},id)=>{const original=screen.getAllDisplays.bind(screen),external=original().find(d=>d.id===id);
      globalThis.__restoreScreen=()=>{screen.getAllDisplays=original;screen.emit('display-added',{},external);};
      screen.getAllDisplays=()=>original().filter(d=>d.id!==id);screen.emit('display-removed',{},external);
    },other.id);
    if(displays.length===2)await expect(picker()).toHaveCount(0);
    await assertOn(p);expect((await settings()).moduleDisplayId).toBe(other.id);
    await app.evaluate(()=>globalThis.__restoreScreen());await expect(picker()).toHaveValue(String(other.id));await assertOn(other);
    await manager.evaluate(()=>window.wallnote.desktopControl('disable'));await picker().selectOption(String(p.id));await expect(picker()).toBeEnabled();
    expect(await manager.evaluate(()=>window.wallnote.getDesktopStatus())).toMatchObject({enabled:false,widgets:0});
    await picker().selectOption(String(other.id));await expect(picker()).toBeEnabled();await manager.evaluate(()=>window.wallnote.desktopControl('enable'));await assertOn(other);
    await app.close();app=undefined;await launch(3);await expect(picker()).toHaveValue(String(other.id));await assertOn(other);
    console.log('Display switch passed: workbench and tray, native bounds, stable HWNDs, preserved layout/visibility/pins, stale target, fallback/reconnect, paused mode and restart.');
  }
} finally {await app?.close();}
