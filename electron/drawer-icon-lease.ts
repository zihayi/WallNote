import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import type { IconLeaseState } from '../shared/drawer';

/** The helper owns the temporary hide: EOF, parent death or drawer HWND destruction releases it. */
export class DrawerIconLease {
  private desired: string | null = null;
  private active?: { child: ChildProcessWithoutNullStreams; handle: string; closed: Promise<void>; releasing:boolean };
  private queue: Promise<void> = Promise.resolve();
  private recovery: Promise<void> = Promise.resolve();
  constructor(private executable: string, private changed: (s: IconLeaseState) => void, private isolated = false) {}

  set(handle: string | null) {
    if (this.desired === handle) return;
    this.desired = handle;
    // Close immediately on removal/disable, even if a new acquire is queued.
    if (this.active && this.active.handle !== handle) this.release();
    this.queue = this.queue.then(() => this.sync()).catch(() => this.changed('error'));
  }
  private release() { if(this.active&&!this.active.releasing){this.active.releasing=true;this.active.child.stdin.end();} }
  private async sync() {
    await this.recovery;
    if (this.active && (this.active.releasing || this.active.handle !== this.desired)) { const closed=this.active.closed;this.release();await closed; }
    const handle = this.desired;
    if (!handle) { this.changed('off'); return; }
    if (this.active) return;
    // Isolated test profiles never modify the user's Explorer view.
    if (this.isolated) { this.changed('error'); return; }
    this.changed('starting');
    const child = spawn(this.executable, ['drawer-lease',handle,String(process.pid)], { windowsHide:true, stdio:'pipe' });
    child.stdin.on('error',()=>{}); child.stderr.resume(); child.stdout.setEncoding('utf8');
    let output='';
    child.stdout.on('data',(s:string)=>{output+=s;const lines=output.split('\n');output=lines.pop()??'';
      for(const line of lines) if(this.desired===handle && (line.trim()==='hidden'||line.trim()==='already-hidden')) this.changed(line.trim() as IconLeaseState);
    });
    const closed=new Promise<void>(resolve=>{
      child.once('error',()=>{if(this.desired===handle)this.changed('error');});
      child.once('close',code=>{
        if(this.active?.child===child)this.active=undefined;
        this.changed(this.desired===handle?'error':'off');
        // A killed helper may not reach its finally block. The native recovery only
        // restores a marked shell icon view while no other lease owns the mutex.
        if(code!==0)this.recovery=promisify(execFile)(this.executable,['drawer-recover'],{windowsHide:true,timeout:5000}).then(()=>{},()=>{});
        void this.recovery.then(resolve);
      });
    });
    this.active={child,handle,closed,releasing:false};
  }
  async stop(){this.set(null);await this.queue;if(this.active){const closed=this.active.closed;this.release();await closed;}await this.recovery;}
}
