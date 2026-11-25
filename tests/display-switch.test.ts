import { describe, expect, it } from 'vitest';
import { groupDisplayId, switchModuleScreen } from '../shared/display-switch';
import { displayedHome, moduleHome, toFrame, type LayoutDisplay } from '../shared/snap-layout';
import { createInitialState, isValidState } from '../shared/state';
import type { AppState } from '../shared/types';

const laptop:LayoutDisplay={id:0,primary:true,internal:true,workArea:{x:0,y:0,width:1280,height:752}};
const external:LayoutDisplay={id:19,primary:false,internal:false,workArea:{x:-1920,y:-120,width:1920,height:1040}};
const displays=[external,laptop]; // Neither the array index nor primary implies screen type.

describe('switching component screens',()=>{
  it('moves the preset as a group and remembers the preferred screen over unplug/reconnect',()=>{
    const before=createInitialState().settings,next=switchModuleScreen(before,external.id,displays);
    expect(next.dockFrames).toBeUndefined();expect(next.canvasModules).toBeUndefined();
    expect(groupDisplayId(next,displays)).toBe(external.id);
    expect(moduleHome(next,'drawer',displays).display).toEqual(external); // Includes a newly assigned module.
    const oldRect=moduleHome(next,'calendar',displays).rect;
    expect(oldRect.x).toBeLessThan(0);expect(moduleHome(next,'calendar',[laptop])).toEqual(moduleHome(before,'calendar',[laptop]));
    expect(next.moduleDisplayId).toBe(external.id);expect(moduleHome(next,'calendar',displays).rect).toEqual(oldRect);
    expect(switchModuleScreen(next,external.id,displays)).toBe(next);
  });
  it('preserves custom frames, hidden modules, pins and snap without rounding drift',()=>{
    const before:AppState['settings']={...createInitialState().settings,canvasModules:['tasks','calendar'],showDesktopTasks:false,layoutSnap:false,topmostWidgets:['calendar'],dockFrames:{
      tasks:{displayId:external.id,x:.81,y:.75,width:.19,height:.25},calendar:{displayId:laptop.id,x:.12,y:.1,width:.34,height:.64},
      drawer:{displayId:external.id,x:0,y:0,width:.4,height:.4},
    }};
    const original=structuredClone(before);
    expect(groupDisplayId(before,displays)).toBeNull();const next=switchModuleScreen(before,laptop.id,displays);
    expect(next).toMatchObject({showDesktopTasks:false,layoutSnap:false,topmostWidgets:['calendar'],canvasModules:['tasks','calendar']});
    expect(next.dockFrames!.drawer).toBe(before.dockFrames!.drawer);
    expect(groupDisplayId(next,displays)).toBe(laptop.id);
    const r=moduleHome(next,'tasks',displays).rect;expect(r.width).toBeGreaterThanOrEqual(260);expect(r.x+r.width).toBeLessThanOrEqual(laptop.workArea.width);
    expect(switchModuleScreen(next,external.id,displays).dockFrames!.tasks).toEqual(original.dockFrames!.tasks);
    expect(before).toEqual(original);
  });
  it('converts legacy pinned coordinates from their own monitor, not from the primary',()=>{
    const rect={x:-1640,y:90,width:530,height:360};
    const old={...createInitialState().settings,topmostWidgets:['tasks'],tasksPosition:rect};
    const next=switchModuleScreen(old,laptop.id,displays);
    expect(next.dockFrames?.tasks).toEqual({...toFrame(rect,external,'tasks'),displayId:laptop.id});
    expect(displayedHome(next,'tasks',displays).display.id).toBe(laptop.id);
    const back=switchModuleScreen(next,external.id,displays);
    expect(displayedHome(back,'tasks',displays).rect).toEqual(rect);
    // A DIP snapshot from quitting on the fallback mustn't override the preferred display.
    const preset={...next,dockFrames:undefined,moduleDisplayId:external.id,tasksPosition:{...rect,x:100}};
    expect(displayedHome(preset,'tasks',displays).display.id).toBe(external.id);
  });
  it('rejects stale selections, handles no modules, and accepts old profiles without a preference',()=>{
    const state=createInitialState();expect(isValidState(state)).toBe(true);
    expect(()=>switchModuleScreen(state.settings,external.id,[laptop])).toThrow('断开');
    expect(groupDisplayId(state.settings,[])).toBeNull();
    const next=switchModuleScreen({...state.settings,canvasModules:[],desktopEnabled:false},external.id,displays);
    expect(next.canvasModules).toEqual([]);expect(next.desktopEnabled).toBe(false);expect(groupDisplayId(next,displays)).toBe(external.id);
    expect(isValidState({...state,settings:next})).toBe(true);
    expect(isValidState({...state,settings:{...next,moduleDisplayId:'19'}})).toBe(false);
  });
});
