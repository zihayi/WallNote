import { _electron as electron, expect } from '@playwright/test';
import { mkdir,mkdtemp,writeFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();await mkdir('test-results',{recursive:true});const dir=await mkdtemp(path.resolve('test-results','file-drawer-'));
const user=path.join(dir,'drawer-fixture','user'),pub=path.join(dir,'drawer-fixture','public');await Promise.all([mkdir(user,{recursive:true}),mkdir(pub,{recursive:true})]);
await Promise.all([writeFile(path.join(user,'Report.pdf'),'fixture'),writeFile(path.join(pub,'Demo.exe'),'not an executable'),mkdir(path.join(user,'Folder.txt')),writeFile(path.join(user,'Picture.png'),'fixture'),writeFile(path.join(user,'desktop.ini'),'fixture')]);
await writeFile(path.join(dir,'state.json'),JSON.stringify({version:1,notes:[],tasks:[],events:[],wallpapers:[],favorites:[],selectedWallpaperId:'mist',appliedWallpaperId:null,settings:{alwaysOnTop:false,launchAtLogin:false,desktopEnabled:true,layoutVersion:4,canvasModules:['drawer']}}));
const env={...process.env,WALLNOTE_DATA_DIR:dir,WALLNOTE_CREATE_MANAGER:'1'};for(const k of ['WALLNOTE_ENABLE_WIFI_RECEIVER','VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE','GITHUB_PERSONAL_ACCESS_TOKEN','DEEPSEEK_API_KEY'])delete env[k];let app;
try {
  app=await electron.launch({...(process.argv.includes('--packaged')?{executablePath:path.resolve('release/win-unpacked/WallNote.exe'),args:[]}:{args:['.']}),env,timeout:45000});await app.firstWindow();
  await expect.poll(()=>app.windows().some(p=>p.url().includes('widget=drawer')),{timeout:30000}).toBe(true);
  const panel=app.windows().find(p=>p.url().includes('widget=drawer')),manager=app.windows().find(p=>p.url().startsWith('file:')&&!new URL(p.url()).search);
  const state=()=>panel.evaluate(()=>window.wallnote.getDrawer());
  await expect.poll(async()=>(await state()).items.length).toBe(4);
  await expect(panel.getByRole('switch',{name:'隐藏桌面图标'})).not.toBeChecked();
  await expect(panel.getByRole('button',{name:'选择Demo.exe',exact:true})).toBeVisible();
  const tabs=panel.getByRole('group',{name:'文件分类'});await tabs.getByRole('button',{name:/文档/}).evaluate(b=>b.click());
  await expect(panel.getByRole('button',{name:'选择Report.pdf',exact:true})).toBeVisible();
  await writeFile(path.join(user,'New.md'),'fixture');await expect.poll(async()=>(await state()).items.length,{timeout:7000}).toBe(5);
  await unlink(path.join(user,'New.md'));await expect.poll(async()=>(await state()).items.length,{timeout:7000}).toBe(4);
  await tabs.getByRole('button',{name:/文件夹/}).evaluate(b=>b.click());await expect(panel.getByRole('button',{name:'选择Folder.txt'})).toBeVisible();
  await tabs.getByRole('button',{name:/其他/}).evaluate(b=>b.click());await expect(panel.getByRole('button',{name:'选择Picture.png'})).toBeVisible();
  expect(await panel.evaluate(async()=>{try{await window.wallnote.openDrawerItem('arbitrary/path');return false;}catch{return true;}})).toBe(true);
  // Stub the OS action on this test-owned process: nothing is actually launched.
  await app.evaluate(({shell})=>{globalThis.__openedDrawer=[];globalThis.__revealedDrawer=[];shell.openPath=async p=>{globalThis.__openedDrawer.push(p);return '';};shell.showItemInFolder=p=>{globalThis.__revealedDrawer.push(p);};});
  const tile=panel.getByRole('button',{name:'选择Picture.png',exact:true});
  await tile.click();await expect(tile).toHaveAttribute('aria-pressed','true');expect(await app.evaluate(()=>globalThis.__openedDrawer)).toEqual([]);
  await tile.dblclick();await expect.poll(()=>app.evaluate(()=>globalThis.__openedDrawer)).toEqual([path.join(user,'Picture.png')]);
  await tile.focus();await panel.keyboard.press('Enter');await expect.poll(()=>app.evaluate(()=>globalThis.__openedDrawer.length)).toBe(2);
  await panel.keyboard.press('Escape');await expect(tile).toHaveAttribute('aria-pressed','false');
  await tile.click({button:'right'});const quick=panel.getByRole('menu',{name:'文件操作'});
  await quick.getByRole('menuitem',{name:'打开所在位置'}).click();await expect(quick).toHaveCount(0);
  expect(await app.evaluate(()=>globalThis.__revealedDrawer)).toEqual([path.join(user,'Picture.png')]);
  await tile.press('Shift+F10');await quick.getByRole('menuitem',{name:'打开',exact:true}).press('Enter');
  await expect.poll(()=>app.evaluate(()=>globalThis.__openedDrawer.length)).toBe(3);
  expect(await panel.evaluate(async()=>{try{await window.wallnote.showDrawerMenu('arbitrary/path',{x:.5,y:.5},false);return false;}catch{return true;}})).toBe(true);
  await panel.getByRole('button',{name:'收起文件抽屉'}).evaluate(b=>b.click());await expect.poll(()=>manager.evaluate(()=>window.wallnote.getDrawer().then(v=>v.enabled))).toBe(false);
  expect((await manager.evaluate(()=>window.wallnote.getDrawer())).items).toHaveLength(0);
  console.log('File drawer passed: native filesystem scan, four categories, watch, scoped open, hide opt-in and cleanup. Synthetic desktop only.');
}finally{await app?.close();}
