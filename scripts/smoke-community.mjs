import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

// Fixture mode intercepts HTTPS in this disposable Electron session, including DeepSeek.
// --live tests just the public GitHub feed; it never configures a key or calls a model.
configureEnvironment();
await mkdir('test-results', {recursive:true});
const directory=await mkdtemp(path.resolve('test-results','community-'));
await writeFile(path.join(directory,'state.json'),JSON.stringify({version:1,notes:[],tasks:[],events:[],wallpapers:[],favorites:[],selectedWallpaperId:'mist',appliedWallpaperId:null,settings:{alwaysOnTop:false,launchAtLogin:false,desktopEnabled:false,layoutVersion:4}}));
const env={...process.env,WALLNOTE_DATA_DIR:directory,WALLNOTE_CREATE_MANAGER:'1',WALLNOTE_SHOW_MANAGER:'0'};
for (const key of ['VITE_DEV_SERVER_URL','WALLNOTE_ENABLE_WIFI_RECEIVER','GH_TOKEN','GITHUB_TOKEN','GITHUB_PERSONAL_ACCESS_TOKEN','DEEPSEEK_API_KEY']) delete env[key];
const live=process.argv.includes('--live');let app;
try {
  app=await electron.launch({...(process.argv.includes('--packaged')?{executablePath:path.resolve('release/win-unpacked/WallNote.exe'),args:[]}:{args:['.']}),env,timeout:45000});
  const page=await app.firstWindow();
  await page.getByRole('navigation').getByRole('button',{name:'社区日报',exact:true}).click();
  await expect(page.getByRole('heading',{name:'你的第一份社区日报'})).toBeVisible();
  if (!live) {
    await app.evaluate(({session})=>{
      globalThis.__communityCalls=0;
      session.defaultSession.protocol.handle('https',async req=>{
        const u=new URL(req.url);const send=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
        if(u.host==='api.deepseek.com'&&u.pathname==='/chat/completions'&&req.method==='POST'&&req.headers.get('Authorization')?.startsWith('Bearer fixture-')) {
          globalThis.__communityCalls++;const body=await req.json();const sources=JSON.parse(body.messages[1].content).sources;
          return send({choices:[{message:{content:JSON.stringify({overview:'模拟全期小结',entries:sources.map(s=>({n:s.n,text:`摘要：${s.title}`})),picks:[1]})}}]});
        }
        if(u.host!=='api.github.com'||u.pathname!=='/search/issues'||req.headers.has('Authorization'))return new Response('',{status:403});
        const q=u.searchParams.get('q'), at=new Date().toISOString(), issue=q.includes('no:assignee'), merged=q.includes('is:merged');
        const row={number:issue?33:merged?22:11,title:issue?'模拟贡献任务':merged?'模拟合并':'模拟新 PR',repository_url:'https://api.github.com/repos/llvm/llvm-project',state:merged?'closed':'open',assignees:[],labels:[{name:'mlir'},{name:'help wanted'}],...(!issue?{pull_request:{merged_at:merged?at:null}}:{}),created_at:at,updated_at:at};
        return send({items:[row,...(!q.includes('label:"mlir"')&&!issue&&!merged?[{...row,number:44,title:'LLVM 独有 PR',labels:[]}]:[])]});
      });
    });
    const fake='fixture-'+randomBytes(15).toString('hex');
    await page.getByRole('button',{name:'订阅设置',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'社区日报设置'});
    await modal.locator('input[type=password]').fill(fake);
    await modal.getByLabel('用 DeepSeek 生成中文导读').check();
    await modal.getByRole('button',{name:'保存设置'}).click();
    await expect(modal).toHaveCount(0);
    expect((await readFile(path.join(directory,'community','deepseek-key.bin'))).includes(Buffer.from(fake))).toBe(false);
    expect(JSON.stringify(await page.evaluate(()=>window.wallnote.getCommunity()))).not.toContain(fake);
  }
  await page.getByRole('button',{name:'生成日报',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.wallnote.getCommunity().then(v=>v.busy)),{timeout:150000}).toBe(false);
  const status=await page.evaluate(()=>window.wallnote.getCommunity());
  expect(status.error).toBeNull();expect(status.reports).toHaveLength(1);const report=status.reports[0];
  if(live) {
    expect(status.hasKey).toBe(false);expect(report.model).toBeNull();
    console.log('Live public GitHub feed:',report.items.length,'unique items;',report.notices.length,'notices; no AI call.');
  } else {
    expect(report.items).toHaveLength(4);await expect(page.getByText('模拟全期小结')).toBeVisible();
    await page.getByRole('button',{name:'加入待办：模拟新 PR'}).click();await page.getByRole('button',{name:'加入待办：模拟新 PR'}).click();
    expect((await page.evaluate(()=>window.wallnote.getState())).tasks).toHaveLength(1);
    await page.getByRole('button',{name:'整理布局',exact:true}).click();
    let studio=page.getByRole('dialog',{name:'整理桌面布局'});
    await studio.getByRole('checkbox',{name:'显示社区日报',exact:true}).check();
    await studio.getByRole('button',{name:'应用布局',exact:true}).click();
    await page.evaluate(()=>window.wallnote.desktopControl('enable'));
    await expect.poll(()=>app.windows().some(w=>w.url().includes('widget=community')),{timeout:30000}).toBe(true);
    const widget=app.windows().find(w=>w.url().includes('widget=community'));
    await page.evaluate(async()=>{const settings=(await window.wallnote.getState()).settings;const d=(await window.wallnote.getLayoutDisplays()).find(d=>d.primary);await window.wallnote.dispatch({type:'layout:apply',ids:settings.canvasModules,frames:{...settings.dockFrames,community:{displayId:d.id,x:0.02,y:0.02,width:260/d.workArea.width,height:260/d.workArea.height}}});});
    await expect(widget.locator('.brief-card-lead')).toContainText('模拟全期小结');
    await expect(widget.locator('.brief-card-list > button')).toHaveCount(2);
    await widget.getByRole('button',{name:'MLIR',exact:true}).click();await expect(widget.locator('.brief-card-list > button')).toHaveCount(1);
    await widget.getByRole('button',{name:/待认领 Issue/}).click();const issue=widget.locator('.brief-card-list > button');await expect(issue).toContainText('模拟贡献任务');
    await issue.hover();await expect(widget.getByRole('tooltip')).toContainText('摘要：模拟贡献任务');
    const tip=await widget.getByRole('tooltip').boundingBox(),card=await widget.locator('.community-panel').boundingBox();expect(tip.y).toBeGreaterThanOrEqual(card.y);expect(tip.y+tip.height).toBeLessThanOrEqual(card.y+card.height+1);
    await widget.getByRole('button',{name:/新 PR/}).first().focus();await expect(widget.getByRole('tooltip')).toHaveCount(0);
    await widget.getByRole('button',{name:'LLVM',exact:true}).click();await widget.getByRole('group',{name:'动态分类'}).getByRole('button',{name:/新 PR/}).click();
    const outside=widget.locator('.brief-card-list button').filter({hasText:'LLVM 独有 PR'});await outside.focus();await expect(widget.getByRole('tooltip')).toContainText('摘要：LLVM 独有 PR');
    await widget.keyboard.press('Escape');await expect(widget.getByRole('tooltip')).toHaveCount(0);expect(await app.evaluate(()=>globalThis.__communityCalls)).toBe(1);
    await expect(widget.evaluate(async()=>{try{await window.wallnote.setCommunityKey(null);return false;}catch{return true;}})).resolves.toBe(true);
    const before=await widget.evaluate(()=>window.wallnote.getDesktopSurface());
    await page.getByRole('button',{name:'整理布局',exact:true}).click();
    studio=page.getByRole('dialog',{name:'整理桌面布局'});
    const tile=studio.getByRole('button',{name:'移动社区日报',exact:true});
    const box=await tile.boundingBox(); const x=box.x+box.width/2,y=box.y+box.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y+60,{steps:8});await page.mouse.up();
    await studio.getByRole('button',{name:'应用布局',exact:true}).click();
    await expect.poll(()=>widget.evaluate(()=>window.wallnote.getDesktopSurface().then(s=>s.bounds.y))).toBeGreaterThan(before.bounds.y);
    await page.reload();
    await expect(page.locator('.spatial-frame > .community-panel')).toBeVisible();
    await page.locator('.spatial-frame .community-panel').getByRole('button',{name:'查看日报'}).evaluate(b=>b.click());
    await expect(page.getByRole('heading',{name:'本期导读'})).toBeVisible();
    expect(JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')).settings.dockFrames.community.y).toBeGreaterThan(0);
    console.log('Community integration passed: protected key storage, source-linked digest, task deduplication, native card arrangement and persisted layout.');
  }
} finally {await app?.close();}
