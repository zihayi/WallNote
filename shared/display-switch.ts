import type { AppState } from './types';
import type { ModuleId } from './modules';
import { assignedModules, displayedHome, moduleHome, toFrame, type DockFrame, type DockFrames, type LayoutDisplay } from './snap-layout';

type Settings=AppState['settings'];

export function displayName(display:LayoutDisplay,index:number):string {
  const kind=display.internal===undefined?'屏幕':display.internal?'内置屏幕':'外接屏幕';
  const name=display.label?.trim();
  return `${kind} ${index+1}${name?` · ${name}`:''}${display.primary?'（主屏）':''}`;
}

// null indicates a split layout. Use the actual fallback screen if a display is unplugged.
export function groupDisplayId(settings:Settings,displays:LayoutDisplay[],ids=assignedModules(settings)):number|null {
  if(!displays.length)return null;
  if(!ids.length)return (displays.find(d=>d.id===settings.moduleDisplayId)??displays.find(d=>d.primary)??displays[0]).id;
  const first=displayedHome(settings,ids[0],displays).display.id;
  for(const id of ids.slice(1))if(displayedHome(settings,id,displays).display.id!==first)return null;
  return first;
}

export function frameOnDisplay(settings:Settings,id:ModuleId,displays:LayoutDisplay[],targetId:number,preset=false):DockFrame {
  let frame=settings.dockFrames?.[id];
  if(!frame){const home=(preset?moduleHome:displayedHome)(settings,id,displays);frame=toFrame(home.rect,home.display,id);}
  return {...frame,displayId:targetId};
}

export function switchModuleScreen(settings:Settings,targetId:number,displays:LayoutDisplay[]):Settings {
  if(!Number.isSafeInteger(targetId) || !displays.some(d=>d.id===targetId))throw new Error('所选屏幕已断开，请重新选择。');
  // Preserve normalized custom frames exactly; repeatedly switching between unlike
  // work areas must not accumulate rounding/minimum-size adjustments. Presets reflow.
  let moved:DockFrames|undefined;
  let floating:DockFrames|undefined;
  for(const id of assignedModules(settings)){
    const frame=settings.dockFrames?.[id];
    const legacy=!frame && settings.moduleDisplayId===undefined && settings.topmostWidgets?.includes(id) && settings[`${id}Position`];
    if((frame && frame.displayId!==targetId) || legacy){
      moved??={...settings.dockFrames};
      moved[id]=frameOnDisplay(settings,id,displays,targetId);
    }
    const float = settings.floatingFrames?.[id];
    if (float && float.displayId !== targetId) { floating ??= { ...settings.floatingFrames }; floating[id] = { ...float, displayId: targetId }; }
  }
  if(settings.moduleDisplayId===targetId && !moved && !floating)return settings;
  return {...settings,moduleDisplayId:targetId,...(moved?{dockFrames:moved}:{}),...(floating?{floatingFrames:floating}:{})};
}
