import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { category, FileDrawer, type DrawerRoot } from '../electron/file-drawer';
import { createInitialState, reduceState } from '../shared/state';
import { shownModules } from '../shared/snap-layout';
import { isDrawerPoint } from '../shared/drawer';

const dirs:string[]=[];const drawers:FileDrawer[]=[];
afterEach(async()=>{for(const d of drawers.splice(0))d.surface(null,false);for(const d of dirs.splice(0))await fs.rm(d,{recursive:true,force:true});});
describe('desktop file drawer',()=>{
  it('accepts only bounded viewport-relative Windows menu anchors',()=>{
    expect(isDrawerPoint({x:0,y:1})).toBe(true);expect(isDrawerPoint({x:-1,y:.5})).toBe(false);expect(isDrawerPoint({x:NaN,y:0})).toBe(false);
  });
  it('classifies documents, applications, shortcuts and folders independently of case or dotted folder names',()=>{
    expect(category('a.PDF',false)).toBe('document');expect(category('bundle.pdf',true)).toBe('folder');
    expect(category('tool.LNK',false,{name:'editor.exe',directory:false})).toBe('app');expect(category('link.lnk',false,{name:'papers.2026',directory:true})).toBe('folder');
    expect(category('link.lnk',false,{name:'sheet.xlsx',directory:false})).toBe('document');expect(category('image.PNG',false)).toBe('other');
  });
  it('indexes only when enabled; opens only current entries, retains source distinctions and releases icons on scan failure and close',async()=>{
    await fs.mkdir('test-results',{recursive:true});const root=await fs.mkdtemp(path.resolve('test-results','drawer-unit-'));dirs.push(root);
    const user=path.join(root,'user'),pub=path.join(root,'public');await Promise.all([fs.mkdir(user),fs.mkdir(pub)]);
    const file=path.join(user,'notes.txt');await fs.writeFile(file,'sample');await fs.writeFile(path.join(pub,'notes.txt'),'other');
    const scan=vi.fn<()=>Promise<DrawerRoot[]>>().mockResolvedValue([{origin:'user',root:user,ok:true,truncated:false,entries:[{name:'notes.txt',directory:false},{name:'../outside',directory:false}]},{origin:'public',root:pub,ok:true,truncated:false,entries:[{name:'notes.txt',directory:false}]}]);
    const launch=vi.fn(async()=>''),reveal=vi.fn(),lease=vi.fn();const d=new FileDrawer({scan,shortcut:()=>undefined,launch,reveal,icon:async()=>'',lease},()=>{});drawers.push(d);
    await d.refresh();expect(scan).not.toHaveBeenCalled();d.surface('42',false);await d.refresh();expect(d.status().items).toHaveLength(2);expect(d.canHide()).toBe(true);
    const id=d.status().items.find(i=>i.origin==='user')!.id;expect(JSON.stringify(d.status())).not.toContain(root);
    await d.open(id,false);expect(launch).toHaveBeenCalledWith(file);await d.open(id,true);expect(reveal).toHaveBeenCalledWith(file);
    await expect(d.open(file,false)).rejects.toThrow();await fs.unlink(file);await expect(d.open(id,false)).rejects.toThrow();expect(launch).toHaveBeenCalledTimes(1);
    d.surface('42',true);expect(lease).toHaveBeenLastCalledWith('42');scan.mockRejectedValueOnce(new Error('private path'));
    await d.refresh();expect(d.canHide()).toBe(false);expect(lease).toHaveBeenLastCalledWith(null);expect(d.status().message).not.toContain('private path');
    d.surface(null,false);expect(d.status().items).toEqual([]);await expect(d.open(id,true)).rejects.toThrow();
  });
  it('does not hide icons on upgrade or merely enabling the new module, and clears the preference when it is removed',()=>{
    const state=createInitialState();expect(shownModules(state.settings)).not.toContain('drawer');
    const on=reduceState(state,{type:'layout:apply',ids:['drawer'],frames:{}});expect(on.settings.hideIconsWithDrawer).not.toBe(true);
    const hidden=reduceState(on,{type:'settings:update',changes:{hideIconsWithDrawer:true}});
    expect(reduceState(hidden,{type:'layout:apply',ids:['calendar'],frames:{}}).settings.hideIconsWithDrawer).toBe(false);
    expect(reduceState(hidden,{type:'settings:update',changes:{showDesktopDrawer:false}}).settings.hideIconsWithDrawer).toBe(false);
  });
  it('shares in-flight icons, retries a miss, and prevents stale results overwriting newer artwork',async()=>{
    await fs.mkdir('test-results',{recursive:true});const root=await fs.mkdtemp(path.resolve('test-results','drawer-icon-'));dirs.push(root);
    let stamp='1', finish:(value:string)=>void=()=>{};
    const icon=vi.fn<()=>Promise<string>>().mockResolvedValueOnce('').mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue('new-art');
    const d=new FileDrawer({scan:async()=>[{root,origin:'user',ok:true,truncated:false,entries:[{name:'A.lnk',directory:false,stamp}]}],shortcut:()=>({target:'sample.exe',icon:'private-icon.dll',iconIndex:3}),launch:async()=>'',reveal:()=>{},icon,lease:()=>{}},()=>{});drawers.push(d);
    d.surface('42',false);await d.refresh();const item=d.status().items[0],id=item.id;
    expect(await d.icon(id)).toBe('');await d.refresh();expect(d.status().items[0].iconVersion).not.toBe(item.iconVersion);
    const slow=d.icon(id);expect(d.icon(id)).toBe(slow);stamp='2';await d.refresh();
    expect(await d.icon(id)).toBe('new-art');finish('old-art');expect(await slow).toBe('');
    const version=d.status().items[0].iconVersion;await d.refresh();expect(d.status().items[0].iconVersion).toBe(version);
    expect(await d.icon(id)).toBe('new-art');expect(icon).toHaveBeenCalledTimes(3);await d.refresh(true);expect(d.status().items[0].iconVersion).not.toBe(version);
    expect(JSON.stringify(d.status())).not.toContain('private-icon.dll');
  });
});
