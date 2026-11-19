import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CommunityAssistant } from '../electron/community';
import { collectFeed, searchURL, summarize, type FetchJSON } from '../electron/community-feed';
import { communityDefaults, itemId, itemURL, normalizeSettings } from '../shared/community';
import { assignSlot, defaultSlots, validSlots, visibleModule } from '../shared/modules';
import { createInitialState, isValidState } from '../shared/state';

const base = communityDefaults(), now = new Date(2026,10,19,9,1);
const row = { number: 17, title: 'Add a dialect verifier', state: 'open', repository_url: 'https://api.github.com/repos/llvm/llvm-project', labels: [{name:'mlir'}], pull_request: {}, created_at: now.toISOString(), updated_at: now.toISOString() };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), {status});
const publicData: FetchJSON = async url => {
  const q = new URL(url).searchParams.get('q')!;
  const issue = { ...row, number: 23, pull_request: undefined, labels: [{name:'mlir'},{name:'good first issue'}], assignees: [] };
  return json({ items: q.includes('is:issue') ? [issue, { ...issue, number: 24, assignees:[{login:'owner'}] }] : q.includes('is:merged') ? [{ ...row, number: 19, state:'closed', pull_request:{merged_at:now.toISOString()} }] : [row, {...row, repository_url:'https://api.github.com/repos/other/repo',number:20}] });
};
const dirs:string[] = [], services:CommunityAssistant[]=[];
afterEach(async()=>{for(const s of services.splice(0))await s.stop(); for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
async function sandbox() {const dir=path.resolve('test-results');await fs.mkdir(dir,{recursive:true}); const d=await fs.mkdtemp(path.join(dir,'community-'));dirs.push(d);return d;}
const vault = {seal:async (_: string)=>Buffer.from('fake-encrypted-fixture'),unseal:async (_: Buffer)=>'synthetic-test-key'};
function create(dir:string, f:FetchJSON, clock:()=>Date) {const s=new CommunityAssistant(dir,f,vault,()=>{},clock);services.push(s);return s;}

describe('community assistant',()=>{
  it('scopes searches to public subscriptions, distinguishes opportunities and deduplicates overlapping MLIR results',async()=>{
    const s=normalizeSettings(base), fetcher=vi.fn(publicData);
    const report=await collectFeed(s,now,fetcher,new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(6); expect(report.items).toHaveLength(3);
    expect(report.items.map(i=>i.kind).sort()).toEqual(['merged','opened','opportunity']);
    expect(new URL(searchURL(s.sources[0],'merged',report.since,report.at)).searchParams.get('q')).toContain('label:"mlir"');
    for(const [url,init] of fetcher.mock.calls){expect(new URL(url).origin).toBe('https://api.github.com');expect(init.credentials).toBe('omit');expect(new Headers(init.headers).has('Authorization')).toBe(false);}
    expect(()=>normalizeSettings({...s,sources:[{repo:'https://evil.test/path',label:''}]})).toThrow();
    expect(()=>normalizeSettings({...s,sources:[{repo:'llvm/llvm-project',label:'mlir" org:x'}]})).toThrow();
    expect(()=>itemURL({...report.items[0],repo:'llvm/..'})).toThrow();
  });
  it('accepts only model references to collected sources and discards model-provided URLs',async()=>{
    const report=await collectFeed(base,now,publicData,new AbortController().signal);
    const fake=vi.fn<FetchJSON>().mockResolvedValue(json({choices:[{message:{content:JSON.stringify({overview:'本期关注验证器。',entries:[{n:1,text:'新增验证。',url:'file:///bad'},{n:200,text:'不存在'},{n:1,text:'重复引用'}],picks:[200,1,1]})}}]}));
    await summarize(report,base,'synthetic-test-key',fake,new AbortController().signal);
    expect(report.highlights).toEqual([{source:itemId(report.items[0]),text:'新增验证。'}]);expect(JSON.stringify(report)).not.toContain('file:');
    expect(report.overview).toBe('本期关注验证器。');expect(report.items[0].summary).toBe('新增验证。');expect(report.items[1].summary).toBeUndefined();expect(report.notices.join('')).toContain('1/3');
    const [url,init]=fake.mock.calls[0];expect(url).toBe('https://api.deepseek.com/chat/completions');expect(JSON.parse(String(init.body)).tools).toBeUndefined();expect(init.redirect).toBe('error');
  });
  it('retains legacy daily caches and never forwards a public description without an explicit opt-in',async()=>{
    const dir=await sandbox(), old=await collectFeed(base,now,publicData,new AbortController().signal);
    old.highlights=[{source:itemId(old.items[0]),text:'旧导读'}];old.model=base.model;
    await fs.writeFile(path.join(dir,'community.json'),JSON.stringify({version:1,settings:base,reports:[old],attempt:'',error:null}));
    const s=create(dir,publicData,()=>now);await s.start();expect(s.status().reports[0].highlights).toEqual(old.highlights);
    for(const opt of [false,true]) {
      const settings={...base,ai:true,includeExcerpt:opt};const excerpts=new Map<string,string>();
      const fresh=await collectFeed(settings,now,async()=>json({items:[{...row,body:'公开说明 <!--omit--> ```excluded```'}]}),new AbortController().signal,excerpts);
      const fake=vi.fn<FetchJSON>().mockResolvedValue(json({choices:[{message:{content:JSON.stringify({overview:'测试',entries:[{n:1,text:'该条摘要'}],picks:[1]})}}]}));
      await summarize(fresh,settings,'test-placeholder',fake,new AbortController().signal,excerpts);
      expect(String(fake.mock.calls[0][1].body).includes('公开说明')).toBe(opt);expect(String(fake.mock.calls[0][1].body)).not.toContain('excluded');expect(JSON.stringify(fresh)).not.toContain('公开说明');
    }
  });
  it('claims a local day across concurrent ticks and restarts, uses paid AI only when enabled, retains last good data offline',async()=>{
    const dir=await sandbox();let clock=new Date(2026,10,19,8,55),paid=0,offline=false;
    const fetcher=vi.fn<FetchJSON>(async (url,init)=>{if(offline) return json({},429);if(url.includes('deepseek.com')){paid++;return json({error:'private provider body'},401);}return publicData(url,init);});
    const service=create(dir,fetcher,()=>clock);await service.start();await service.configure({...base,daily:true,ai:true});await service.key('synthetic-test-key');
    await service.tick();expect(fetcher).not.toHaveBeenCalled();clock=now;
    await Promise.all([service.tick(),service.tick()]);expect(paid).toBe(1);expect(service.status().reports[0].items).toHaveLength(3);expect(service.status().reports[0].notices.join('')).toContain('密钥无效');
    expect((await fs.readFile(path.join(dir,'community.json'),'utf8'))+JSON.stringify(service.status())).not.toContain('synthetic-test-key');
    expect(await fs.readFile(path.join(dir,'deepseek-key.bin'),'utf8')).toBe('fake-encrypted-fixture');
    await service.stop();const resumed=create(dir,fetcher,()=>clock);await resumed.start();await resumed.tick();expect(paid).toBe(1);expect(fetcher).toHaveBeenCalledTimes(7);
    clock=new Date(2026,10,20,13);offline=true;await resumed.tick();expect(fetcher).toHaveBeenCalledTimes(8);expect(resumed.status().reports[0].day).toBe('2026-11-19');expect(resumed.status().error).toContain('受限');
    await resumed.key(null);expect(resumed.status().hasKey).toBe(false);await expect(fs.stat(path.join(dir,'deepseek-key.bin'))).rejects.toThrow();
  });
  it('can fetch public items without a credential or AI invocation, including empty results',async()=>{
    const f=vi.fn<FetchJSON>(async()=>json({items:[]}));const s=create(await sandbox(),f,()=>now);await s.start();await s.run(); const d=s.status().reports[0];expect(d.items).toEqual([]);expect(d.at).toBe(now.toISOString());expect(d.model).toBe(null);expect(f.mock.calls.every(([url])=>url.startsWith('https://api.github.com/'))).toBe(true);
  });
});
describe('module slots',()=>{
  it('preserves the legacy layout, supports swaps and empty slots, and refuses duplicate or short calendar placements',()=>{
    const state=createInitialState();expect(visibleModule(state.settings,'lower')).toBe('notes');
    const custom=assignSlot(defaultSlots,'upper','community')!;
    expect(assignSlot(custom,'left','calendar')).toMatchObject({left:'calendar',center:'schedule'});
    expect(assignSlot(custom,'upper','calendar')).toBeNull();expect(validSlots({...custom,lower:'community'})).toBe(false);
    expect(isValidState({...state,settings:{...state.settings,moduleSlots:custom}})).toBe(true);
    expect(visibleModule({...state.settings,moduleSlots:custom,showDesktopCommunity:false},'upper')).toBeNull();
    expect(assignSlot(custom,'lower',null)?.lower).toBeNull();
  });
});
