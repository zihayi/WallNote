import type { AppState, DesktopSurface } from './types';
import { plannerLayout } from './layout';
import { defaultSlots, moduleIds, modules, slots, type ModuleId } from './modules';

export type Rect = DesktopSurface['bounds'];
export interface LayoutDisplay { id: number; workArea: Rect; primary: boolean }
/** Fractions of the display's usable area, independent of physical resolution and taskbar size. */
export interface DockFrame { displayId: number; x: number; y: number; width: number; height: number }
export type DockFrames = Partial<Record<ModuleId, DockFrame>>;
export type DragMode = 'move' | 'resize' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'sw'; // resize = SE
export const dragModes: DragMode[] = ['move','resize','n','s','w','e','nw','ne','sw'];
export interface Guides { x?: number; y?: number; displayId?: number }
export { moduleIds };
export const isModule = (id: unknown): id is ModuleId => typeof id === 'string' && Object.hasOwn(modules, id);
const squareMinimum={width:260,height:260};
export const minimum = (id:ModuleId) => { const m=modules[id];return 'minimum' in m?m.minimum:squareMinimum; };
type Settings = AppState['settings'];
export const assignedModules = (s: Settings): ModuleId[] => s.canvasModules ?? slots.map(slot => (s.moduleSlots ?? defaultSlots)[slot]).filter((id): id is ModuleId => id !== null);
export const shownModules = (s: Settings) => assignedModules(s).filter(id => s[modules[id].flag] !== false);
export function validModuleList(v: unknown): v is ModuleId[] { return Array.isArray(v) && v.length <= moduleIds.length && v.every(isModule) && new Set(v).size === v.length; }
export function validFrame(v: unknown): v is DockFrame {
  if (!v || typeof v !== 'object') return false;
  const f=v as DockFrame;
  return Object.keys(f).length===5 && Number.isSafeInteger(f.displayId) && [f.x,f.y,f.width,f.height].every(n=>Number.isFinite(n)&&n>=0&&n<=1) && f.width>0 && f.height>0 && f.x+f.width<=1.000001 && f.y+f.height<=1.000001;
}
export const validFrames = (v: unknown): v is DockFrames => !!v && typeof v==='object' && !Array.isArray(v) && Object.entries(v).every(([k,f])=>isModule(k)&&validFrame(f));
const clamp = (n:number,lo:number,hi:number) => Math.min(Math.max(n,lo),hi);
export function fitRect(rect: Rect, a: Rect, id: ModuleId): Rect {
  const m=minimum(id), width=clamp(Math.round(rect.width),Math.min(m.width,a.width),Math.min(1600,a.width)), height=clamp(Math.round(rect.height),Math.min(m.height,a.height),Math.min(1600,a.height));
  return {x:clamp(Math.round(rect.x),a.x,a.x+a.width-width),y:clamp(Math.round(rect.y),a.y,a.y+a.height-height),width,height};
}
export function toFrame(rect: Rect, display: LayoutDisplay, id: ModuleId): DockFrame {
  const a=display.workArea,r=fitRect(rect,a,id);
  return { displayId:display.id, x:(r.x-a.x)/a.width,y:(r.y-a.y)/a.height,width:r.width/a.width,height:r.height/a.height };
}
export function moduleHome(settings: Settings, id: ModuleId, displays: LayoutDisplay[]): { display: LayoutDisplay; rect: Rect } {
  const f=settings.dockFrames?.[id], display=displays.find(d=>d.id===f?.displayId) ?? displays.find(d=>d.primary) ?? displays[0], a=display.workArea;
  const slot=slots.find(k=>(settings.moduleSlots??defaultSlots)[k]===id);
  const layout=plannerLayout(a);
  const fallback=slot ? layout[defaultSlots[slot]] : {x:a.x+16,y:a.y+16,width:Math.min(400,a.width),height:Math.min(360,a.height)};
  return {display,rect:fitRect(f ? {x:a.x+f.x*a.width,y:a.y+f.y*a.height,width:f.width*a.width,height:f.height*a.height} : fallback,a,id)};
}

/** Only the pre-canvas pinned rectangles are global DIPs. Import a visible legacy
 * float when opening the editor, without modifying a user's old profile on launch. */
export function displayedHome(settings: Settings, id: ModuleId, displays: LayoutDisplay[]) {
  const saved=settings[`${id}Position`];
  if (!saved || settings.dockFrames?.[id] || !settings.topmostWidgets?.includes(id)) return moduleHome(settings,id,displays);
  const overlap=(a:Rect)=>Math.max(0,Math.min(a.x+a.width,saved.x+saved.width)-Math.max(a.x,saved.x))*Math.max(0,Math.min(a.y+a.height,saved.y+saved.height)-Math.max(a.y,saved.y));
  const best=displays.reduce((p,d)=>overlap(d.workArea)>overlap(p.workArea)?d:p,displays.find(d=>d.primary)??displays[0]);
  return {display:best,rect:fitRect(saved,best.workArea,id)};
}

// Work exclusively in global, device-independent pixels. Always use the unsnapped
// pointer delta from the start: pulling away releases a magnet without accumulated drift.
export function snapDrag(start: Rect, dx: number, dy: number, mode: DragMode, area: Rect, peers: Rect[], id: ModuleId, bypass=false): {rect:Rect;guides:Guides} {
  const d=mode==='resize'?'se':mode, m=minimum(id), moving=d==='move', guides:Guides={};
  const axis = (key:'x'|'y',size:'width'|'height',delta:number,low:boolean,high:boolean) => {
    const a=area[key], end=a+area[size], min=Math.min(m[size],area[size]), max=Math.min(1600,area[size]);
    let len=clamp(start[size],min,max), lo=clamp(start[key],a,end-len), hi=lo+len;
    if (moving) {lo=clamp(start[key]+delta,a,end-len);hi=lo+len;}
    else if(low) lo=clamp(start[key]+delta,Math.max(a,hi-max),hi-min);
    else if(high) hi=clamp(start[key]+start[size]+delta,lo+min,Math.min(end,lo+max));
    else return [Math.round(lo),Math.round(len)];
    if (!bypass) {
      let best=10.00001, shift=0, guide:number|undefined;
      const offer=(edge:number,line:number) => {
        const diff=line-edge, cost=Math.abs(diff); if(cost>=best) return;
        const x=lo+(moving||low?diff:0), y=hi+(moving||high?diff:0);
        if(x<a||y>end||y-x<min||y-x>max) return;
        best=cost;shift=diff;guide=line;
      };
      if(moving||low) offer(lo,a); if(moving||high) offer(hi,end);
      if(moving) offer((lo+hi)/2,(a+end)/2);
      for(const p of peers){
        const l=p[key],r=l+p[size];
        if(moving||low){offer(lo,l);offer(lo,r+12);offer(lo,r);}
        if(moving||high){offer(hi,r);offer(hi,l-12);offer(hi,l);}
      }
      if(guide!==undefined){if(moving||low)lo+=shift;if(moving||high)hi+=shift;guides[key]=guide;}
    }
    len=Math.round(hi)-Math.round(lo);return [Math.round(lo),len];
  };
  const [x,width]=axis('x','width',dx,d.includes('w'),d.includes('e'));
  const [y,height]=axis('y','height',dy,d.includes('n'),d.includes('s'));
  return {rect:{x,y,width,height},guides};
}
