// Two local shortcuts share the same target/extension, but have different artwork.
// Assert decoded pixels from the actual drawer tile, not just an IPC result or <img>.
import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const dir = await mkdtemp(path.resolve('test-results', 'drawer-artwork-'));
const user = path.join(dir, 'drawer-fixture', 'user'), pub = path.join(dir, 'drawer-fixture', 'public');
await Promise.all([mkdir(user, { recursive:true }), mkdir(pub, { recursive:true })]);
const colors = { Coral: [216, 39, 62], Jade: [13, 172, 102] };
const iconPath = name => path.join(dir, `图标 ${name}.ico`);
for (const [name, [r,g,b]] of Object.entries(colors)) {
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: {r,g,b,alpha:1} } }).png().toBuffer();
  const header = Buffer.alloc(22); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4); header[6]=64; header[7]=64;
  header.writeUInt16LE(1,10); header.writeUInt16LE(32,12); header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
  await writeFile(iconPath(name), Buffer.concat([header,png]));
}
await writeFile(path.join(dir, 'state.json'), JSON.stringify({version:1,notes:[],tasks:[],events:[],wallpapers:[],favorites:[],selectedWallpaperId:'mist',appliedWallpaperId:null,settings:{alwaysOnTop:false,launchAtLogin:false,desktopEnabled:true,layoutVersion:4,canvasModules:['drawer']}}));
await writeFile(path.join(user,'Game.url'),`[InternetShortcut]\r\nURL=https://example.invalid/\r\nIconFile=${iconPath('Jade')}\r\nIconIndex=0\r\n`);
const env={...process.env,WALLNOTE_DATA_DIR:dir,WALLNOTE_CREATE_MANAGER:'1'};
for(const k of ['WALLNOTE_ENABLE_WIFI_RECEIVER','VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE','GITHUB_PERSONAL_ACCESS_TOKEN','DEEPSEEK_API_KEY'])delete env[k];
let app;
try {
  const binary=process.env.WALLNOTE_TEST_INSTALLED_EXE || (process.argv.includes('--packaged') ? path.resolve('release/win-unpacked/WallNote.exe') : '');
  app=await electron.launch({...(binary?{executablePath:binary,args:[]}:{args:['.']}),env,timeout:45000});
  await app.firstWindow();
  const writeShortcut=(name,icon)=>app.evaluate(({shell},{file,icon})=>shell.writeShortcutLink(file,{target:process.execPath,...(icon?{icon,iconIndex:0}:{})}),{file:path.join(user,`${name}.lnk`),icon});
  for(const name of Object.keys(colors))expect(await writeShortcut(name,iconPath(name))).toBe(true);
  expect(await writeShortcut('DefaultApp')).toBe(true);
  await expect.poll(()=>app.windows().some(w=>w.url().includes('widget=drawer')),{timeout:30000}).toBe(true);
  const panel=app.windows().find(w=>w.url().includes('widget=drawer'));
  await panel.evaluate(()=>window.wallnote.refreshDrawer());
  async function pixels(name) {
    const tile = panel.getByRole('button',{name:`选择${name}`,exact:true});
    await expect(tile).toBeVisible();
    const image = tile.locator('img'); await expect(image).toBeVisible({timeout:10000});
    return image.evaluate(async el=>{await el.decode();const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(el,Math.floor(el.naturalWidth/2),Math.floor(el.naturalHeight/2),1,1,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];});
  }
  const actual={};for(const name of Object.keys(colors))actual[name]=await pixels(name);
  console.log('Synthetic shortcut center pixels:',JSON.stringify(actual));
  for(const [name,c] of Object.entries(colors))expect(actual[name]).toEqual([...c,255]);
  expect(await pixels('Game')).toEqual([...colors.Jade,255]);
  const fallback = panel.getByRole('button',{name:'选择DefaultApp',exact:true}).locator('img');
  await expect(fallback).toBeVisible(); expect(await fallback.evaluate(async img=>{await img.decode();return img.naturalWidth;})).toBe(64);
  // Same item ID: replacing a .lnk and refreshing must repaint an already-mounted tile.
  expect(await writeShortcut('Coral',iconPath('Jade'))).toBe(true);
  await panel.evaluate(()=>window.wallnote.refreshDrawer());
  await expect.poll(()=>pixels('Coral'),{timeout:10000}).toEqual([...colors.Jade,255]);
  console.log('Drawer artwork passed: distinct icons, Unicode .url IconFile, executable fallback, and in-place refresh.');
}finally{await app?.close();}
