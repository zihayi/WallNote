import { screen, type BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { DesktopSurface } from '../shared/types';
import type { DrawerPoint } from '../shared/drawer';

const idleMs = 15_000, buildTimeoutMs = 12_000;
const unavailable = () => new Error('Windows 文件菜单不可用。请打开文件所在位置后重试。');
interface Request {
  id:number; closed:()=>void; resolve:()=>void; reject:(e:Error)=>void;
  timeout:ReturnType<typeof setTimeout>;
}
interface Host { child:ChildProcessWithoutNullStreams; retired:boolean; request?:Request; idle?:ReturnType<typeof setTimeout> }
interface Item { file:string; stamp:string }
interface Intent { win:BrowserWindow; ticket:string; seq:number; host?:Host; item?:Item }
const encode=(file:string)=>Buffer.from(file,'utf8').toString('base64');

/** One warm STA for a burst of file menus. Each invocation gets fresh Shell items, verbs and IDs. */
export class DrawerMenu {
  private host?:Host;
  private intent?:Intent;
  private serial=0;
  private active?:()=>void;
  private stopped=false;
  constructor(private helper:string, private setTracking:(active:boolean)=>Promise<void>, private trackProcess:(pid:number)=>void=()=>{}) {}

  private retire(h:Host) {
    if(this.host===h)this.host=undefined;
    if(this.intent?.host===h)this.intent=undefined;
    clearTimeout(h.idle);
    if(h.retired)return;
    h.retired=true;
    // A selected verb may still own a property sheet or delayed clipboard data.
    // EOF asks the STA to exit once those references are released, not to kill the verb.
    h.child.stdin.end();
  }
  private armIdle(h:Host) {
    clearTimeout(h.idle);
    if(!h.retired)h.idle=setTimeout(()=>{if(!this.active && !h.request)this.retire(h);},idleMs).unref();
  }
  private acquire() {
    if(this.host && !this.host.request)return this.host;
    if(this.host)this.retire(this.host); // Previous popup closed; its Shell verb hasn't returned.
    const child=spawn(this.helper,['drawer-menu-host',String(process.pid)],{windowsHide:true,stdio:'pipe'});
    const h:Host={child,retired:false};this.host=h;
    const finish=(error?:Error)=>{
      const r=h.request;h.request=undefined;
      if(r){clearTimeout(r.timeout);r.closed();if(error)r.reject(error);else r.resolve();}
    };
    const lost=()=>{this.retire(h);finish(unavailable());};
    child.once('error',lost);child.once('close',lost);child.stdin.on('error',lost);
    child.stderr.resume();
    createInterface({input:child.stdout}).on('line',line=>{
      const [state,value,...stages]=line.trim().split(' '),r=h.request;
      if(!r || Number(value)!==r.id)return;
      if(state==='profile' && process.env.WALLNOTE_MENU_TRACE==='1' && stages.length===4 && stages.every(s=>/^\d+$/.test(s)))console.info(`[menu timing] parse/bind/query/foreground (ms): ${stages.join('/')}`);
      if(state==='tracking')clearTimeout(r.timeout); // A visible menu may stay open indefinitely.
      else if(state==='closed'){clearTimeout(r.timeout);r.closed();}
      else if(state==='done'){finish();this.armIdle(h);}
      else if(state==='failed')lost();
    });
    return h;
  }
  async prepare(win:BrowserWindow,ticket:string,lookup:()=>Promise<Item>) {
    if(this.active || this.stopped || win.isDestroyed())return;
    if(this.intent)this.discard(this.intent.win,this.intent.ticket);
    const intent:Intent=this.intent={win,ticket,seq:++this.serial};
    let item:Item;
    try {item=await lookup();}catch(e){if(this.intent===intent)this.intent=undefined;throw e;}
    if(this.intent!==intent || win.isDestroyed() || this.stopped)return;
    const h=this.acquire();intent.host=h;intent.item=item;this.armIdle(h);
    h.child.stdin.write(`prepare ${intent.seq} ${win.getNativeWindowHandle().readBigUInt64LE()} ${encode(item.file)}\n`);
  }
  discard(win:BrowserWindow,ticket:string) {
    const i=this.intent;if(!i || i.win!==win || i.ticket!==ticket)return;
    this.intent=undefined;
    if(i.host && !i.host.retired)i.host.child.stdin.write(`drop ${i.seq}\n`);
  }
  release() { this.intent=undefined;this.active?.();if(this.host)this.retire(this.host); }
  stop() { this.stopped=true;this.release(); }

  async show(win:BrowserWindow,surface:DesktopSurface|null,item:Item,anchor:DrawerPoint,extended:boolean,ticket?:string) {
    if(this.active || this.stopped || win.isDestroyed())return;
    const h=this.acquire();clearTimeout(h.idle);
    const i=this.intent;this.intent=undefined; // A preparation belongs to one gesture in one window.
    const prepared=!extended && i && i.host===h && i.win===win && i.ticket===ticket && i.item?.file===item.file && i.item.stamp===item.stamp ? i.seq : 0;
    const closed=()=>{
      if(this.active!==closed)return;
      this.active=undefined;this.trackProcess(0);void this.setTracking(false);
    };
    this.active=closed;
    try {
      await this.setTracking(true);
      if(this.active!==closed || win.isDestroyed())return;
      if(h.retired)throw unavailable();
      const b=surface?.bounds??win.getContentBounds();
      const pt=screen.dipToScreenPoint({x:b.x+Math.round(anchor.x*b.width),y:b.y+Math.round(anchor.y*b.height)});
      const handle=win.getNativeWindowHandle().readBigUInt64LE(),id=++this.serial;
      if(h.child.pid)this.trackProcess(h.child.pid);
      await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>{
          // No tracking/selection yet: a hung extension must not lock desktop input forever.
          h.request=undefined;this.retire(h);h.child.kill();closed();reject(new Error('Windows 文件菜单响应超时，请重试。'));
        },buildTimeoutMs).unref();
        h.request={id,closed,resolve,reject,timeout};
        h.child.stdin.write(`show ${id} ${handle} ${pt.x} ${pt.y} ${extended?1:0} ${prepared} ${encode(item.file)}\n`);
      });
    } finally {closed();if(this.host===h && !this.active && !h.request)this.armIdle(h);}
  }
}
