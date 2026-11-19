import { createHash } from 'node:crypto';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { emptyDrawer, type DrawerCategory, type DrawerItem, type DrawerView, type IconLeaseState } from '../shared/drawer';
import type { ArtworkSource } from './drawer-artwork';

export interface DrawerRoot { root: string; origin: 'user' | 'public'; ok: boolean; truncated: boolean; entries: { name: string; directory: boolean; stamp?: string }[] }
const docs = new Set('txt md markdown pdf doc docx docm odt rtf xls xlsx xlsm csv tsv ods ppt pptx odp epub mobi pages numbers keynote xps'.split(' '));
const apps = new Set('exe com appref-ms msc url msi msix appx'.split(' '));
function ext(name:string) { return path.extname(name).slice(1).toLowerCase(); }
export function category(name:string, folder:boolean, target?: {name:string;directory:boolean}): DrawerCategory {
  if (folder || target?.directory) return 'folder';
  const e=ext(target?.name || name);
  if (docs.has(e)) return 'document';
  if (apps.has(e) || ext(name)==='lnk' && (!target || !e)) return 'app';
  return 'other';
}

interface Dependencies {
  scan(): Promise<DrawerRoot[]>;
  shortcut(file:string): { target: string; icon?: string; iconIndex?: number } | undefined;
  launch(file:string): Promise<string>;
  reveal(file:string): void;
  icon(source:ArtworkSource): Promise<string>;
  clearIcons?(): void;
  lease(handle:string|null): void;
}

export class FileDrawer {
  private view=emptyDrawer();
  private files=new Map<string,{source:ArtworkSource;signature:string;version:number}>();
  private iconCache=new Map<string,Promise<string>>();
  private iconVersion=0;
  private missingIcons=new Set<string>();
  private watches=new Map<string,FSWatcher>();
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private generation=0;
  private flight?: Promise<DrawerView>;
  private dirty=false;
  private handle:string|null=null;
  private wantsIcons=false;
  private complete=false;

  constructor(private deps:Dependencies, private changed:(view:DrawerView)=>void) {}
  status():DrawerView {return {...this.view,canHide:this.canHide(),items:[...this.view.items]};}
  private emit(){this.changed(this.status());}
  setIconState(state:IconLeaseState){if(state!==this.view.icons){this.view.icons=state;this.emit();}}
  private syncIcons(){this.deps.lease(this.wantsIcons && this.complete ? this.handle : null);}
  surface(handle:string|null, hide:boolean) {
    const prev=this.handle;this.handle=handle;this.wantsIcons=hide;
    if (!handle) {
      if(prev){this.generation++;this.flight=undefined;this.dirty=false;clearTimeout(this.timer);clearInterval(this.poll);for(const w of this.watches.values())w.close();this.watches.clear();this.files.clear();this.iconCache.clear();this.missingIcons.clear();this.deps.clearIcons?.();this.view=emptyDrawer();this.complete=false;this.emit();}
      this.syncIcons();return;
    }
    if(!prev){this.view.enabled=true;this.poll=setInterval(()=>{void this.refresh();},60000);this.poll.unref();void this.refresh();}
    this.syncIcons();
  }
  private schedule=()=>{if(!this.handle)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.flight)this.dirty=true;else void this.refresh();},220);};
  private watchRoots(roots:DrawerRoot[]) {
    const paths=new Set(roots.filter(r=>r.ok).map(r=>r.root));
    for(const [p,w] of this.watches)if(!paths.has(p)){w.close();this.watches.delete(p);}
    for(const p of paths)if(!this.watches.has(p))try {
      const w=watch(p,{persistent:false},this.schedule);this.watches.set(p,w);
      w.on('error',()=>{w.close();if(this.watches.get(p)===w)this.watches.delete(p);});
    }catch{/* A redirected/offline folder may not support notifications; periodic scan remains. */}
  }
  async refresh(renewIcons=false):Promise<DrawerView> {
    if(!this.handle)return this.status();if(this.flight){await this.flight;return renewIcons?this.refresh(true):this.status();}
    const generation=this.generation;this.view.busy=true;this.emit();
    const work=(async()=>{
      try {
        const roots=await this.deps.scan();if(generation!==this.generation)return;
        if(!roots.some(r=>r.ok))throw new Error();
        const files=new Map<string,{source:ArtworkSource;signature:string;version:number}>(),items:DrawerItem[]=[];
        for(const r of roots){
          if(!path.isAbsolute(r.root))continue;
          for(const e of r.entries){
            if(typeof e.name!=='string'||!e.name||e.name==='.'||e.name==='..'||/[\\/:\u0000]/.test(e.name))continue;
            const file=path.join(r.root,e.name),extension=ext(e.name),shortcut=!e.directory&&(extension==='lnk'||extension==='url');
            let target: {name:string;directory:boolean}|undefined;
            const source:ArtworkSource={file,directory:e.directory};
            if(shortcut && extension==='lnk')try{
              const link=this.deps.shortcut(file),name=link?.target;
              source.icon=link?.icon;source.index=link?.iconIndex;source.target=name;
              if(name){let directory=false;if(/^[A-Za-z]:[\\/]/.test(name))directory=(await fs.lstat(name).catch(()=>null))?.isDirectory()===true;target={name,directory};}
            }catch{ /* Broken or virtual shell shortcuts still have a place in the drawer. */ }
            const id=createHash('sha256').update(file.toLowerCase()).digest('hex').slice(0,32);
            if(files.has(id))continue;
            const signature=JSON.stringify([e.stamp,e.directory,source.icon,source.index,source.target]),old=this.files.get(id);
            const version=!renewIcons && old?.signature===signature && !this.missingIcons.has(id) ? old.version : ++this.iconVersion;
            files.set(id,{source,signature,version});items.push({id,name:shortcut?e.name.slice(0,-4)||e.name:e.name,extension,shortcut,origin:r.origin,category:category(e.name,e.directory,target),iconVersion:version});
          }
        }
        if(generation!==this.generation)return;
        items.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})||a.id.localeCompare(b.id));
        for(const [id,old] of this.files)if(files.get(id)?.version!==old.version){this.iconCache.delete(id);this.missingIcons.delete(id);}
        this.files=files;this.watchRoots(roots);this.complete=roots.every(r=>r.ok&&!r.truncated);
        this.view.items=items;this.view.ready=true;this.view.message=this.complete?'':'部分桌面项目未能列出，系统图标保持原状。';
      }catch{if(generation===this.generation){this.complete=false;this.view.message='无法读取桌面，请检查桌面目录后刷新。';}}
    })();
    this.flight=work.finally(()=>{if(generation===this.generation){this.flight=undefined;this.view.busy=false;this.syncIcons();this.emit();if(this.dirty){this.dirty=false;this.schedule();}}}).then(()=>this.status());
    return this.flight;
  }
  private file(id:string) {
    const file=typeof id==='string' && this.files.get(id);
    if(!this.handle || !file)throw new Error('项目已移除或抽屉未开启，请刷新。');
    return file.source.file;
  }
  async currentFile(id:string){
    const file=this.file(id);
    try{await fs.lstat(file);}catch{this.schedule();throw new Error('项目已移动或删除，请刷新抽屉。');}
    if(this.file(id)!==file)throw new Error('项目已变化。');
    return file;
  }
  async open(id:string,reveal:boolean){
    const file=await this.currentFile(id);
    if(reveal){this.deps.reveal(file);return;}
    if(await this.deps.launch(file))throw new Error('Windows 未能打开此项目。可在文件资源管理器中查看。');
  }
  icon(id:string):Promise<string>{
    this.file(id);const entry=this.files.get(id)!;
    const cached=this.iconCache.get(id);if(cached)return cached;
    if(this.iconCache.size>=160)this.iconCache.delete(this.iconCache.keys().next().value!);
    const image=this.deps.icon(entry.source).catch(()=>'').then(png=>{
      if(this.files.get(id)?.version!==entry.version)return '';
      if(!png){this.missingIcons.add(id);this.iconCache.delete(id);}else this.missingIcons.delete(id);
      return png;
    });
    this.iconCache.set(id,image);return image;
  }
  canHide(){return !!this.handle&&this.complete;}
}
