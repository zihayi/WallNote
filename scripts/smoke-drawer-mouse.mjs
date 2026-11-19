import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

// Synthetic icons and a stubbed open action. --physical additionally exercises the
// Explorer-layer mouse bridge; only unobstructed points inside our own fixture are used.
configureEnvironment();await mkdir('test-results',{recursive:true});const profile=await mkdtemp(path.resolve('test-results','drawer-mouse-'));
const physical=process.argv.includes('--physical'), packaged=process.argv.includes('--packaged');
const run=promisify(execFile),compiler=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const probe=path.join(profile,'DrawerMenuProbe.exe'), mouse=path.join(profile,'DesktopInput.exe');
const wpf=path.join(path.dirname(compiler),'WPF');
await run(compiler,['/nologo','/target:winexe','/platform:x64','/reference:System.Management.dll',...['UIAutomationClient','UIAutomationTypes','WindowsBase'].map(n=>`/reference:${path.join(wpf,n+'.dll')}`),`/out:${probe}`,path.resolve('tests/DrawerMenuProbe.cs')],{windowsHide:true});
if(physical)await run(compiler,['/nologo','/target:exe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',`/out:${mouse}`,path.resolve('tests/DesktopInput.cs'),path.resolve('native/DesktopInputBridge.cs')],{windowsHide:true});
const folder=path.join(profile,'drawer-fixture','user');await mkdir(folder,{recursive:true});await mkdir(path.join(profile,'drawer-fixture','public'));
for(const name of ['Alpha.txt','Beta.txt']) await writeFile(path.join(folder,name),'local QA file');
await writeFile(path.join(profile,'state.json'),JSON.stringify({version:1,notes:[],tasks:[],events:[],wallpapers:[],favorites:[],selectedWallpaperId:'mist',appliedWallpaperId:null,settings:{alwaysOnTop:false,launchAtLogin:false,desktopEnabled:true,layoutVersion:4,canvasModules:['drawer'],dockFrames:{drawer:{displayId:0,x:.36,y:.25,width:.31,height:.45}}}}));
const env={...process.env,WALLNOTE_DATA_DIR:profile,WALLNOTE_CREATE_MANAGER:'1',WALLNOTE_SHOW_MANAGER:'0'};for(const k of ['VITE_DEV_SERVER_URL','WALLNOTE_ENABLE_WIFI_RECEIVER','ELECTRON_RUN_AS_NODE','GITHUB_PERSONAL_ACCESS_TOKEN','DEEPSEEK_API_KEY'])delete env[k];
const binary=process.env.WALLNOTE_TEST_INSTALLED_EXE || (packaged?path.resolve('release/win-unpacked/WallNote.exe'):'');
const helper=binary?path.join(path.dirname(binary),'resources/native/WallNote.DesktopHost.exe'):path.resolve('dist-native/WallNote.DesktopHost.exe');
const native=async(...args)=>JSON.parse((await run(helper,args.map(String),{windowsHide:true})).stdout.replace(/^\uFEFF/,''));
let app,shown=false;
try{
  app=await electron.launch({...(binary?{executablePath:binary,args:[]}:{args:['.']}),env,timeout:45000});await app.firstWindow();
  await expect.poll(()=>app.windows().some(p=>p.url().includes('widget=drawer')),{timeout:30000}).toBe(true);
  const widget=app.windows().find(p=>p.url().includes('widget=drawer')),manager=app.windows().find(p=>p.url().startsWith('file:')&&!new URL(p.url()).search);
  const owner=await app.evaluate(({shell})=>{globalThis.__opens=[];shell.openPath=async p=>{globalThis.__opens.push(p);return '';};return process.pid;});
  await widget.evaluate(()=>{window.__testRight=[];for(const type of ['mousedown','mouseup','contextmenu'])document.addEventListener(type,e=>{if(e.button===2)window.__testRight.push(type);},true);});
  await widget.getByRole('group',{name:'文件分类'}).getByRole('button',{name:/文档/}).evaluate(b=>b.click());
  const alpha=widget.getByRole('button',{name:'选择Alpha.txt'}),beta=widget.getByRole('button',{name:'选择Beta.txt'});await expect(alpha).toBeVisible();
  const bw=await app.browserWindow(widget),handle=await bw.evaluate(w=>w.getNativeWindowHandle().readBigUInt64LE().toString());await bw.dispose();
  if(physical){
    await native('show-desktop');shown=true;await new Promise(r=>setTimeout(r,650));
    const [icon]=await native('icon-rects');if(icon){const route=await native('route-check',handle,owner,Math.round(icon.x+icon.width/2),Math.round(icon.y+icon.height/2));expect(route).toMatchObject({allowed:false,iconPriority:true});}
  }
  async function act(locator,mode){
    if(!physical){if(mode==='double')await locator.dblclick();else await locator.click({button:mode==='right'?'right':'left'});return;}
    const {window:w}=await native('inspect',handle),b=await locator.boundingBox(),[vw,vh]=await widget.evaluate(()=>[innerWidth,innerHeight]);
    for(const [fx,fy] of [[.5,.5],[.25,.75],[.75,.25]]){
      const x=w.bounds.x+Math.round((b.x+b.width*fx)*w.bounds.width/vw),y=w.bounds.y+Math.round((b.y+b.height*fy)*w.bounds.height/vh);
      if(w.child && !(await native('route-check',handle,owner,x,y)).allowed)continue;
      await run(mouse,[mode,x,y,...(w.child?[`desktop:${handle}`]:[]),owner].map(String),{windowsHide:true});return;
    }
    throw Error('Test icon obscured; no input sent.');
  }
  for(const pinned of [false,true]){
    if(pinned){await manager.evaluate(()=>window.wallnote.dispatch({type:'widget:topmost',key:'drawer',enabled:true}));await expect.poll(async()=>(await native('inspect',handle)).window.topmost).toBe(true);}
    const before=await app.evaluate(()=>globalThis.__opens.length);
    await act(alpha,'click');await expect(alpha).toHaveAttribute('aria-pressed','true');expect(await app.evaluate(()=>globalThis.__opens.length)).toBe(before);
    try { await Promise.all([run(probe,[String(owner)],{windowsHide:true,timeout:18000}),act(beta,'right')]); }
    catch(err) {console.error('Test selection / right events / status:',await beta.getAttribute('aria-pressed'),await widget.evaluate(()=>window.__testRight),await widget.locator('.widget-error').allTextContents());throw err;}
    await expect(beta).toHaveAttribute('aria-pressed','true');await expect(alpha).toHaveAttribute('aria-pressed','false');expect(await app.evaluate(()=>globalThis.__opens.length)).toBe(before);
    await act(beta,'double');await expect.poll(()=>app.evaluate(()=>globalThis.__opens.length)).toBe(before+1);expect(await app.evaluate(()=>globalThis.__opens.at(-1))).toBe(path.join(folder,'Beta.txt'));
  }
  // Invoke a real shell verb on a test .lnk: its target can only create the QA marker.
  expect(await app.evaluate(({shell},{lnk,exe})=>shell.writeShortcutLink(lnk,{target:exe,args:'fixture-marker'}),{lnk:path.join(folder,'Fixture.lnk'),exe:probe})).toBe(true);
  await widget.evaluate(()=>window.wallnote.refreshDrawer());await widget.getByRole('group',{name:'文件分类'}).getByRole('button',{name:/应用/}).evaluate(b=>b.click());
  const fixture=widget.getByRole('button',{name:'选择Fixture',exact:true});await expect(fixture).toBeVisible();
  await Promise.all([run(probe,[String(owner),'open'],{windowsHide:true,timeout:18000}),act(fixture,'right')]);
  await expect.poll(()=>readFile(path.join(profile,'menu-opened.txt'),'utf8').catch(()=>''),{timeout:10000}).toBe('ok');
  console.log(`Drawer ${physical?'Windows mouse':'renderer input'} passed: select, right-click real Shell menu / cancel, double-click opens once, unpinned and pinned.`);
}finally{if(shown)await native('restore-desktop');await app?.close();}
