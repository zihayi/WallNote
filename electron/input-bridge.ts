import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface MousePacket {
  handle: string; type: 'move' | 'down' | 'up' | 'wheel' | 'leave' | 'outside';
  x: number; y: number; delta: number; clickCount: number; leftDown: boolean; rightDown?: boolean; button?: 'left'|'right'; alt?: boolean; shift?: boolean;
}
interface InputTarget { handle: string; scale: number }

export class DesktopInputBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private signature = '';
  private serial = 0;
  private replies = new Map<number,(ok:boolean)=>void>();
  private cancelRequests() { for (const finish of this.replies.values()) finish(false); }
  private request(command: {op:'focus';handle:string} | {op:'check';windows:{handle:string;pinned:boolean}[]}) {
    const child=this.child;
    if(!child?.stdin.writable)return Promise.resolve(false);
    const id=++this.serial;
    return new Promise<boolean>(resolve=>{
      const finish=(ok:boolean)=>{this.replies.delete(id); clearTimeout(timer); resolve(ok);};
      const timer=setTimeout(()=>finish(false),1500);
      this.replies.set(id,finish);
      child.stdin.write(JSON.stringify({...command,id})+'\n',err=>{if(err)finish(false);});
    });
  }
  focus(handle:string) { return this.request({op:'focus',handle}); }
  check(windows:{handle:string;pinned:boolean}[]) { return this.request({op:'check',windows}); }
  constructor(private executable: string, private onMouse: (packet: MousePacket) => void, private onError: (error: Error) => void) {}

  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable, ['bridge', String(process.pid)], { windowsHide: true, stdio: 'pipe' });
      this.child = child;
      this.signature = '';
      let buffer = '', stderr = '', ready = false;
      const timeout = setTimeout(() => { child.kill(); reject(new Error('桌面交互服务启动超时。')); }, 10000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stderr.on('data', data => { stderr = `${stderr}${data}`.slice(-2000); });
      child.stdin.on('error', () => undefined);
      child.stdout.on('data', (data: string) => {
        buffer += data;
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const packet = JSON.parse(line.trim().replace(/^\uFEFF/, ''));
            if (this.child!==child) continue;
            if (packet.ready) { ready = true; clearTimeout(timeout); resolve(); }
            else if (typeof packet.reply==='number') this.replies.get(packet.reply)?.(packet.ok===true);
            else if (typeof packet.handle === 'string' && ['move', 'down', 'up', 'wheel', 'leave','outside'].includes(packet.type)) this.onMouse(packet as MousePacket);
          } catch { /* Ignore non-protocol lines from the bridge. */ }
        }
      });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', () => {
        clearTimeout(timeout);
        const unexpected = this.child === child;
        if (unexpected) { this.child = null; this.signature = ''; this.cancelRequests(); }
        const error = new Error(stderr.trim() || '桌面交互服务已停止。');
        if (!ready) reject(error); else if (unexpected) this.onError(error);
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  setTargets(windows: InputTarget[]) {
    const text = JSON.stringify({ op: 'targets', windows });
    if (this.child && text !== this.signature) { this.signature = text; this.child.stdin.write(`${text}\n`); }
  }
  setMenuProcess(pid:number) { if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify({op:'menu',pid})+'\n'); }
  async stop() {
    const child = this.child; this.child = null; this.signature = '';
    this.cancelRequests();
    if (!child) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => { child.kill(); resolve(); }, 1000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      child.stdin.end();
    });
  }
}
