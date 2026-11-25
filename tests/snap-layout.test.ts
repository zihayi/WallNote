import { describe, expect, it } from 'vitest';
import { snapDrag, moduleHome, displayedHome, floatingHome, toFrame, validFrames, shownModules, type LayoutDisplay } from '../shared/snap-layout';
import { createInitialState, isValidState, reduceState } from '../shared/state';

const area={x:0,y:0,width:1440,height:900},p={x:150,y:100,width:340,height:300},peer={x:700,y:240,width:360,height:260};
describe('magnetic desktop layout',()=>{
  it('keeps floating moves and resizes separate from the desktop home across pin toggles', () => {
    const display: LayoutDisplay = { id: 1, primary: true, workArea: area };
    const docked = reduceState(createInitialState(), { type: 'layout:place', id: 'notes', frame: toFrame(p, display, 'notes') });
    const pinned = reduceState(docked, { type: 'widget:topmost', key: 'notes', enabled: true });
    const moved = { x: 600, y: 210, width: 530, height: 460 };
    const resized = reduceState(pinned, { type: 'layout:place', id: 'notes', frame: toFrame(moved, display, 'notes'), floating: true });
    expect(resized.settings.dockFrames).toBe(docked.settings.dockFrames);
    expect(moduleHome(resized.settings, 'notes', [display]).rect).toEqual(p);
    expect(floatingHome(resized.settings, 'notes', [display]).rect).toEqual(moved);
    const unpinned = reduceState(resized, { type: 'widget:topmost', key: 'notes', enabled: false });
    expect(moduleHome(unpinned.settings, 'notes', [display]).rect).toEqual(p);
    expect(floatingHome(unpinned.settings, 'notes', [display]).rect).toEqual(moved);
    expect(isValidState(unpinned)).toBe(true);
    expect(isValidState({ ...unpinned, settings: { ...unpinned.settings, floatingFrames: { notes: { width: -1 } } } })).toBe(false);
  });
  it('snaps to work area, peer spacing, alignment and center; detaches and bypasses without accumulating drift',()=>{
    expect(snapDrag(p,-146,-96,'move',area,[],'notes')).toEqual({rect:{...p,x:0,y:0},guides:{x:0,y:0}});
    const gap=snapDrag(p,200,144,'move',area,[peer],'notes');
    expect(gap.rect.x+gap.rect.width).toBe(peer.x-12); expect(gap.rect.y).toBe(peer.y);
    expect(snapDrag(p,200,144,'move',area,[peer],'notes',true).rect).toEqual({...p,x:350,y:244});
    expect(snapDrag(p,176,158,'move',area,[peer],'notes').guides).toEqual({});
    expect(snapDrag(p,402,202,'move',area,[],'notes').guides).toEqual({x:720,y:450});
  });
  it('resizes from every side with the opposite edge anchored; rejects unreachable snap lines at the minimum size',()=>{
    const nw=snapDrag(p,-150,-100,'nw',area,[],'notes').rect;
    expect(nw).toEqual({x:0,y:0,width:490,height:400});
    for(const mode of ['w','nw','sw'] as const){const r=snapDrag(p,999,0,mode,area,[],'notes').rect;expect(r.x+r.width).toBe(490);expect(r.width).toBe(260);}
    const east=snapDrag(p,212,0,'e',area,[peer],'notes');expect(east.rect.x).toBe(150);expect(east.rect.x+east.rect.width).toBe(700);
    expect(snapDrag(p,0,999,'s',area,[],'notes').rect).toEqual({...p,height:800});
    const min=snapDrag({...p,width:400,height:650},-300,-300,'resize',area,[{x:0,y:0,width:475,height:644}],'calendar');
    expect(min.rect).toEqual({...p,width:330,height:550});expect(min.guides).toEqual({});
  });
  it('round-trips saved dimensions on a negative-origin display and fits them when HDMI is removed',()=>{
    const hdmi:LayoutDisplay={id:42,primary:false,workArea:{x:-1920,y:-80,width:1920,height:1024}};
    const internal={id:1,primary:true,workArea:area};const old={x:-1456,y:144,width:600,height:480};
    const state=reduceState(createInitialState(),{type:'layout:place',id:'community',frame:toFrame(old,hdmi,'community')});
    expect(moduleHome(state.settings,'community',[internal,hdmi]).rect).toEqual(old);
    const back=moduleHome(state.settings,'community',[internal]);expect(back.display.id).toBe(1);expect(back.rect.x).toBe(348);expect(back.rect.y).toBe(197);expect(back.rect.width).toBe(450);
    expect(moduleHome(state.settings,'community',[internal,hdmi]).rect).toEqual(old);
    expect(displayedHome({...state.settings,notesPosition:old,topmostWidgets:['notes']},'notes',[internal,hdmi]).rect).toEqual(old);
  });
  it('preserves old module visibility and rejects corrupt placements before replacing the layout',()=>{
    const state=createInitialState();state.settings.showDesktopTasks=false;expect(shownModules(state.settings)).toEqual(['schedule','calendar','notes']);
    const all=reduceState(state,{type:'layout:apply',ids:['schedule','calendar','tasks','notes','community'],frames:{}});
    expect(isValidState(all)).toBe(true);expect(shownModules(all.settings)).toHaveLength(5);
    const bad={community:{x:0.9,y:0,width:0.2,height:0.5,displayId:1}};expect(validFrames(bad)).toBe(false);
    expect(()=>reduceState(all,{type:'layout:apply',ids:['tasks'],frames:bad})).toThrow();
    expect(isValidState({...all,settings:{...all.settings,dockFrames:bad}})).toBe(false);
  });
});
