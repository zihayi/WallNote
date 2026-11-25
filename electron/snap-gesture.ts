import { screen } from 'electron';
import { spawn } from 'node:child_process';
import { snapDrag, type DragMode, type Guides, type Rect, type LayoutDisplay } from '../shared/snap-layout';
import type { ModuleId } from '../shared/modules';

export function layoutDisplays(): LayoutDisplay[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(d => ({ id: d.id, workArea: d.workArea, primary: d.id === primary, label:d.label, internal:d.internal }));
}

// One short-lived helper bound to *this* HWND. Never move a WorkerW child with
// BrowserWindow.setBounds (on Windows those coordinates can be parent-local).
export function startSnapGesture(executable: string, handle: string, id: ModuleId, start: Rect, anchor: {x:number;y:number}, mode: DragMode, bypass: boolean,
  peers: () => Rect[], preview: (rect: Rect, guides: Guides) => void, done: (rect: Rect, display: LayoutDisplay, commit: boolean, failed: boolean) => void) {
  const child = spawn(executable, ['arrange', handle, String(process.pid)], { windowsHide:true, stdio:'pipe' });
  child.stderr.resume();
  const anchorScreen = { x:start.x+anchor.x, y:start.y+anchor.y }, origin = screen.getDisplayMatching(start);
  let display = origin, latest = start, previous = '', active = true, moved = false, commit = false, disposed = false;
  let timer: ReturnType<typeof setInterval>, timeout: ReturnType<typeof setTimeout>;
  let resolveSettled!: () => void;
  const settled=new Promise<void>(resolve=>{resolveSettled=resolve;});
  function write(rect: Rect, final = false) {
    const p = screen.dipToScreenRect(null,rect);
    const line = [p.x,p.y,p.width,p.height,display.scaleFactor].join(' ');
    if (child.stdin.writable && !child.stdin.destroyed) {
      if (final) child.stdin.end(line+'\n');
      else if (!child.stdin.writableNeedDrain) child.stdin.write((line===previous?'.':line)+'\n');
      else return;
    }
    previous=line;
  }
  function sample() {
    const pt=screen.getCursorScreenPoint(), dx=pt.x-anchorScreen.x, dy=pt.y-anchorScreen.y;
    if (!moved && Math.max(Math.abs(dx),Math.abs(dy))<4) return;
    moved=true;display=mode==='move'?screen.getDisplayNearestPoint(pt):origin;
    const a=display.workArea, nearby=peers().filter(r=>screen.getDisplayMatching(r).id===display.id);
    const next=snapDrag(start,dx,dy,mode,a,nearby,id,bypass);
    latest=next.rect; write(latest); preview(latest,{...next.guides,displayId:display.id});
  }
  function finish(cancel=false) {
    if(!active)return;
    active=false;clearInterval(timer);clearTimeout(timeout);
    if(cancel){latest=start;display=origin;} else sample();
    commit=!cancel&&moved;
    write(latest,true);
    // Ensure a failed/hung helper cannot keep the gesture alive indefinitely.
    timeout=setTimeout(()=>child.kill(),1500); timeout.unref();
  }
  let output='';
  child.stdout.setEncoding('utf8'); child.stdout.on('data',(data:string)=>{
    output+=data;const lines=output.split('\n');output=lines.pop()??'';
    for(const s of lines){if(s.trim()==='cancel')finish(true);else if(s.trim()==='release')finish(false);}
  });
  function closed(ok:boolean){
    if(disposed)return;disposed=true;active=false;clearInterval(timer);clearTimeout(timeout);
    const finalDisplay=ok?display:origin;
    try { done(ok?latest:start,{id:finalDisplay.id,workArea:finalDisplay.workArea,primary:finalDisplay.id===screen.getPrimaryDisplay().id},ok&&commit,!ok); }
    finally {resolveSettled();}
  }
  child.stdin.on('error',()=>{ /* close/error below releases the gesture */ });
  child.on('error',()=>closed(false));child.on('close',code=>closed(code===0));
  timer=setInterval(()=>{if(!active)return;sample();if(!moved&&child.stdin.writable&&!child.stdin.writableNeedDrain)child.stdin.write('.\n');},16);
  timeout=setTimeout(()=>finish(true),120000);timeout.unref();
  return {finish, settled, abort(){commit=false;active=false;clearInterval(timer);clearTimeout(timeout);child.kill();}};
}
