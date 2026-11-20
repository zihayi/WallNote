import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

// Synthetic icons and a stubbed open action. --physical additionally exercises the
// Explorer-layer mouse bridge; only unobstructed points inside our own fixture are used.
configureEnvironment();await mkdir('test-results',{recursive:true});const profile=await mkdtemp(path.resolve('test-results','drawer-mouse-'));
const physical=process.argv.includes('--physical'), interact=physical||process.argv.includes('--menu-input'), packaged=process.argv.includes('--packaged');
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
  if(env.WALLNOTE_MENU_TRACE==='1')app.process().stdout.on('data',s=>{for(const line of s.toString().split(/\r?\n/))if(line.startsWith('[menu timing]'))console.log(line);});
  await expect.poll(()=>app.windows().some(p=>p.url().includes('widget=drawer')),{timeout:30000}).toBe(true);
  const widget=app.windows().find(p=>p.url().includes('widget=drawer')),manager=app.windows().find(p=>p.url().startsWith('file:')&&!new URL(p.url()).search);
  const owner=await app.evaluate(({shell})=>{globalThis.__opens=[];shell.openPath=async p=>{globalThis.__opens.push(p);return '';};return process.pid;});
  await widget.evaluate(()=>{
    window.__testRight=[];for(const type of ['mousedown','mouseup','contextmenu'])document.addEventListener(type,e=>{if(e.button===2)window.__testRight.push(type);},true);
    new MutationObserver(m=>{if(m.some(v=>Array.from(v.addedNodes).some(n=>n.nodeType===1&&n.matches('.drawer-menu'))))requestAnimationFrame(()=>{window.__menuFrame=Date.now();});}).observe(document.body,{childList:true,subtree:true});
  });
  expect(await app.evaluate(({shell},{lnk,exe})=>shell.writeShortcutLink(lnk,{target:exe,args:'fixture-marker'}),{lnk:path.join(folder,'Fixture.lnk'),exe:probe})).toBe(true);
  await widget.evaluate(()=>window.wallnote.refreshDrawer());
  const tab=name=>widget.getByRole('group',{name:'文件分类'}).getByRole('button',{name}).evaluate(b=>b.click());
  const alpha=widget.getByRole('button',{name:'选择Alpha.txt'}),beta=widget.getByRole('button',{name:'选择Beta.txt'}),fixture=widget.getByRole('button',{name:'选择Fixture',exact:true});
  const bw=await app.browserWindow(widget),handle=await bw.evaluate(w=>w.getNativeWindowHandle().readBigUInt64LE().toString());await bw.dispose();
  if(physical){
    // Keep the disposable fixture away from any installed instance's primary-screen cards.
    const secondary=await manager.evaluate(async()=>(await window.wallnote.getLayoutDisplays()).find(d=>!d.primary));
    if(secondary)await manager.evaluate(id=>window.wallnote.dispatch({type:'layout:apply',ids:['drawer'],frames:{drawer:{displayId:id,x:.36,y:.25,width:.31,height:.45}}}),secondary.id);
    await native('show-desktop');shown=true;await new Promise(r=>setTimeout(r,650));
    const {bounds}= (await native('inspect',handle)).window;
    for(const [x,y] of [[bounds.x,bounds.y],[bounds.x-1,bounds.y+40]])expect((await native('route-check',handle,owner,x,y)).allowed).toBe(false);
    const icons=(await native('probe')).windows.find(w=>w.className==='SysListView32'&&w.visible);
    const point=icons&&(await run(probe,['icon-point',icons.handle],{windowsHide:true,timeout:5000})).stdout.trim();
    if(point){const [x,y]=point.split(' ').map(Number);
      try{await native('position',handle,owner,x-48,y-48,bounds.width,bounds.height);
        expect(await native('route-check',handle,owner,x,y)).toMatchObject({allowed:true,hitClass:'SysListView32'});
      }finally{await native('position',handle,owner,bounds.x,bounds.y,bounds.width,bounds.height);}
      console.log('Card takes priority over a real Explorer icon (geometry only).');
    }else console.log('No exposed Explorer icon for the optional overlap check.');
  }
  const plate=await app.evaluate(({BrowserWindow,screen})=>{
    const a=screen.getPrimaryDisplay().workArea;
    const w=new BrowserWindow({x:a.x+8,y:a.y+8,width:50,height:40,show:false,frame:false,thickFrame:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#486753',webPreferences:{sandbox:true}});
    globalThis.__drawerPlate=w;w.showInactive();return w.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  async function act(locator,mode){
    if(!physical){if(mode==='double')await locator.dblclick();else await locator.click({button:mode==='right'?'right':'left'});return;}
    const {window:w}=await native('inspect',handle),b=await locator.boundingBox(),[vw,vh]=await widget.evaluate(()=>[innerWidth,innerHeight]);
    const missed=[];for(const [fx,fy] of [[.5,.5],[.25,.75],[.75,.25]]){
      const x=w.bounds.x+Math.round((b.x+b.width*fx)*w.bounds.width/vw),y=w.bounds.y+Math.round((b.y+b.height*fy)*w.bounds.height/vh);
      if(w.child){const route=await native('route-check',handle,owner,x,y);if(!route.allowed){missed.push({x,y,...route});continue;}}
      const {stdout}=await run(mouse,[mode,x,y,...(w.child?[`desktop:${handle}`]:[]),owner].map(String),{windowsHide:true});
      if(process.env.WALLNOTE_MOUSE_TRACE==='1')console.log(mode,x,y,stdout.trim());
      if(mode==='right')return Number(/releaseMs=(\d+)/.exec(stdout)?.[1]);return;
    }
    throw Error('Test control obscured; no input sent: '+JSON.stringify(missed));
  }
  // Finish moving/restoring the trigger mouse before a second process moves it
  // onto a menu item. The two OS injectors must not race for the same cursor.
  async function menu(locator,...args){
    // CDP can click a covered renderer without activating *any* Windows app.
    // Start that case in our own foreground, as a real user gesture would.
    if(!physical)await app.evaluate(()=>globalThis.__drawerPlate.focus());
    await act(locator,'right');
    const quick=widget.getByRole('menu',{name:'文件操作'});
    await expect(quick).toBeVisible();
    await act(quick.getByRole('menuitem',{name:'Windows 文件菜单'}),'click');
    return run(probe,[String(owner),...args],{windowsHide:true,timeout:18000});
  }
  if(process.argv.includes('--timing')){
    // Observe an existing release as well as the current build, without OS mouse injection.
    const samples=[];
    await widget.evaluate(()=>{
      document.addEventListener('click',e=>{if(e.target.closest('[role=menuitem]')?.textContent.includes('Windows'))window.__requestedAt=Date.now();},true);
      document.addEventListener('contextmenu',e=>{if(e.shiftKey)window.__requestedAt=Date.now();},true);
    });
    const coldQuick=process.argv.includes('--cold-quick');
    for(const [i,kind] of [coldQuick?'quick':'direct','quick','quick','quick','quick','quick'].entries()){
      const link=i===5,tile=link?fixture:i%2===0?alpha:beta;
      await tab(link?/应用/:/文档/);await expect(tile).toBeVisible();
      const observer=run(probe,[String(owner),'popup-time'],{windowsHide:true,timeout:15000});
      await new Promise((resolve,reject)=>{observer.child.stdout.on('data',s=>{if(s.toString().includes('ready'))resolve();});observer.then(()=>reject(Error('Observer exited before ready')),reject);});
      await app.evaluate(()=>globalThis.__drawerPlate.focus());
      if(kind==='direct')await tile.click({button:'right',modifiers:['Shift']});
      else {await tile.click({button:'right'});await widget.getByRole('menuitem',{name:'Windows 文件菜单'}).click();}
      const {stdout}=await observer.catch(async e=>{console.error({i,kind,completed:samples,requested:await widget.evaluate(()=>window.__requestedAt),quick:await widget.locator('.drawer-menu').count(),errors:await widget.locator('.widget-error').allTextContents()});throw e;});const match=/visible=(\d+) pid=(\d+)/.exec(stdout);expect(match).toBeTruthy();
      const ms=Number(match[1])-await widget.evaluate(()=>window.__requestedAt);expect(ms).toBeGreaterThanOrEqual(0);
      samples.push({kind,file:link?'lnk':'txt',ms,pid:Number(match[2])});
    }
    const {version}=await manager.evaluate(()=>window.wallnote.getInfo());
    await writeFile(`test-results/native-menu-${version}-${binary?'packaged':'build'}${coldQuick?'-cold-quick':''}.json`,JSON.stringify(samples,null,2));
    console.log('DOM request to visible, foreground Windows file menu (ms):',samples);
    if(process.argv.includes('--check-idle')){
      expect(new Set(samples.map(s=>s.pid)).size).toBe(1);
      const pid=samples[0].pid;
      const alive=()=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
      expect(alive()).toBe(true);await expect.poll(alive,{timeout:22000}).toBe(false);
      console.log('The reused Shell host exited after the idle period.');
    }
  }else for(const pinned of [false,true]){
    if(pinned){await manager.evaluate(()=>window.wallnote.dispatch({type:'widget:topmost',key:'drawer',enabled:true}));await expect.poll(async()=>(await native('inspect',handle)).window.topmost).toBe(true);}
    await tab(/文档/);await expect(alpha).toBeVisible();
    const before=await app.evaluate(()=>globalThis.__opens.length);
    await act(alpha,'click');await expect(alpha).toHaveAttribute('aria-pressed','true');expect(await app.evaluate(()=>globalThis.__opens.length)).toBe(before);
    const release=await act(beta,'right');const quick=widget.getByRole('menu',{name:'文件操作'});
    try{await expect(quick.getByRole('menuitem',{name:'打开',exact:true})).toBeFocused();}
    catch(e){console.error({pinned,release,widget:await native('inspect',handle),state:await widget.evaluate(async()=>({status:await window.wallnote.getDesktopStatus(),right:window.__testRight,frame:window.__menuFrame,selected:document.querySelector('.drawer-tile[aria-pressed=true]')?.getAttribute('aria-label')}))});throw e;}
    if(physical){const elapsed=(await widget.evaluate(()=>window.__menuFrame))-release;expect(Number.isFinite(elapsed)).toBe(true);console.log(`${pinned?'Pinned':'Embedded'} release to first quick-menu frame: ${elapsed} ms`);}
    await widget.keyboard.press('Escape');await expect(quick).toHaveCount(0);await expect(beta).toBeFocused();
    await beta.press('Shift+F10');await expect(quick).toBeVisible();await widget.keyboard.press('Escape');
    try {
      if(physical){
        // Outside the popup but still inside a card: dismiss it in one press.
        const {bounds}= (await native('inspect',handle)).window,b=await alpha.boundingBox(),[vw,vh]=await widget.evaluate(()=>[innerWidth,innerHeight]);
        await menu(beta,'outside-card',handle,String(bounds.x+Math.round((b.x+b.width/2)*bounds.width/vw)),String(bounds.y+Math.round((b.y+b.height/2)*bounds.height/vh)));
      }
      for(const cancel of (interact?[['escape'],['outside',plate]]:[[]]))await menu(beta,...cancel);
    }catch(err){console.error({pinned,plate:(await native('inspect',plate)).window,selected:await beta.getAttribute('aria-pressed'),right:await widget.evaluate(()=>window.__testRight),errors:await widget.locator('.widget-error').allTextContents()});throw err;}
    await expect(beta).toHaveAttribute('aria-pressed','true');await expect(alpha).toHaveAttribute('aria-pressed','false');expect(await app.evaluate(()=>globalThis.__opens.length)).toBe(before);
    await act(beta,'double');await expect.poll(()=>app.evaluate(()=>globalThis.__opens.length)).toBe(before+1);expect(await app.evaluate(()=>globalThis.__opens.at(-1))).toBe(path.join(folder,'Beta.txt'));
    await tab(/应用/);await expect(fixture).toBeVisible();
    const marker=path.join(profile,'menu-opened.txt');await rm(marker,{force:true});
    await menu(fixture,interact?'mouse-open':'open');
    await expect.poll(()=>readFile(marker,'utf8').catch(()=>''),{timeout:10000}).toBe('ok');
    expect(await app.evaluate(()=>globalThis.__opens.length)).toBe(before+1);
    console.log(`${pinned?'Pinned':'Embedded'}: select, cancel, reopen, double-click once and ${interact?'Windows mouse':'UIA'} Open passed.`);
  }
}finally{try{await app?.close();}finally{if(shown)await native('restore-desktop');}}
