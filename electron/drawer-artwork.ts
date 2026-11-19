import { execFile, type ChildProcess } from 'node:child_process';

/** Main-process only. All paths originate from the drawer's current scan, never IPC. */
export interface ArtworkSource { file: string; directory: boolean; target?: string; icon?: string; index?: number }
type Job = { source: ArtworkSource; resolve: (png: string) => void };

export class DrawerArtworkLoader {
  private queue: Job[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private running?: ChildProcess;
  constructor(private executable: string) {}

  load(source: ArtworkSource): Promise<string> {
    return new Promise(resolve => { this.queue.push({source,resolve}); this.schedule(); });
  }
  private schedule() {
    if (this.running || this.timer || !this.queue.length) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.drain(); }, 12);
  }
  private drain() {
    const batch = this.queue.splice(0, 16);
    if (!batch.length) return;
    const child = execFile(this.executable, ['drawer-artwork'], { windowsHide:true, encoding:'utf8', timeout:7000, maxBuffer:2_000_000 }, (err, stdout) => {
      let images: unknown = null;
      if (!err) try { images=JSON.parse(stdout.trim()); } catch { /* Keep category placeholders. */ }
      batch.forEach((job,i) => {
        const b64=Array.isArray(images) && images[i];
        job.resolve(typeof b64==='string' && b64.length<=131072 && b64.startsWith('iVBORw0KGgo') ? 'data:image/png;base64,'+b64 : '');
      });
      if (this.running===child) this.running=undefined;
      this.schedule();
    });
    this.running=child;
    child.stdin?.on('error',()=>{});
    child.stdin?.end(JSON.stringify(batch.map(j=>j.source)), 'utf8');
  }
  clear() {
    clearTimeout(this.timer); this.timer=undefined;
    for (const job of this.queue.splice(0)) job.resolve('');
    this.running?.kill();
  }
}
