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
      session.defaultSession.protocol.handle('https',async req=>{
        const u=new URL(req.url);const send=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
        if(u.host==='api.deepseek.com'&&u.pathname==='/chat/completions'&&req.method==='POST'&&req.headers.get('Authorization')?.startsWith('Bearer fixture-')) return send({choices:[{message:{content:JSON.stringify({highlights:[{n:1,text:'模拟日报导读'}]})}}]});
        if(u.host!=='api.github.com'||u.pathname!=='/search/issues'||req.headers.has('Authorization'))return new Response('',{status:403});
        const q=u.searchParams.get('q'), at=new Date().toISOString(), issue=q.includes('no:assignee'), merged=q.includes('is:merged');
        return send({items:[{number:issue?33:merged?22:11,title:issue?'模拟贡献任务':merged?'模拟合并':'模拟新 PR',repository_url:'https://api.github.com/repos/llvm/llvm-project',state:merged?'closed':'open',assignees:[],labels:[{name:'mlir'},{name:'help wanted'}],...(!issue?{pull_request:{merged_at:merged?at:null}}:{}),created_at:at,updated_at:at}]});
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
    expect(report.items).toHaveLength(3);await expect(page.getByText('模拟日报导读')).toBeVisible();
    await page.getByRole('button',{name:'加入待办：模拟新 PR'}).click();await page.getByRole('button',{name:'加入待办：模拟新 PR'}).click();
    expect((await page.evaluate(()=>window.wallnote.getState())).tasks).toHaveLength(1);
    await page.getByLabel('右上模块').selectOption('community');
    await page.evaluate(()=>window.wallnote.desktopControl('enable'));
    await expect.poll(()=>app.windows().some(w=>w.url().includes('widget=community')),{timeout:30000}).toBe(true);
    const widget=app.windows().find(w=>w.url().includes('widget=community'));
    await expect(widget.locator('.community-panel')).toContainText('模拟日报导读');
    await expect(widget.evaluate(async()=>{try{await window.wallnote.setCommunityKey(null);return false;}catch{return true;}})).resolves.toBe(true);
    const before=await widget.evaluate(()=>window.wallnote.getDesktopSurface());
    await page.getByLabel('右下模块').selectOption('community');
    await expect.poll(()=>widget.evaluate(()=>window.wallnote.getDesktopSurface().then(s=>s.bounds.y))).toBeGreaterThan(before.bounds.y);
    await page.reload();
    await expect(page.locator('.workspace-right > .community-panel')).toBeVisible();
    await page.locator('.workspace-right .community-panel').getByRole('button',{name:'查看日报'}).click();
    await expect(page.getByRole('heading',{name:'本期导读'})).toBeVisible();
    expect(JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')).settings.moduleSlots.lower).toBe('community');
    console.log('Community integration passed: protected key storage, source-linked digest, task deduplication, native card swap and persisted layout.');
  }
} finally {await app?.close();}
