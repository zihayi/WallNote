import { BrowserWindow, screen } from 'electron';
import { execFile } from 'node:child_process';
import type { DesktopSurface } from '../shared/types';
import type { DrawerPoint } from '../shared/drawer';

/** Owner-bound native menus track outside the card (also when it is a WorkerW child). */
export class DrawerMenu {
  private active?:symbol;
  constructor(private helper:string) {}

  async show(win:BrowserWindow, surface:DesktopSurface|null, file:string, anchor:DrawerPoint, extended:boolean) {
    if(this.active || win.isDestroyed()) return;
    const token=Symbol();this.active=token;
    try {
      const bounds=surface?.bounds ?? win.getContentBounds();
      const pt=screen.dipToScreenPoint({x:bounds.x+Math.round(anchor.x*bounds.width),y:bounds.y+Math.round(anchor.y*bounds.height)});
      const handle=win.getNativeWindowHandle().readBigUInt64LE().toString();
      await new Promise<void>((resolve,reject)=>{
        const child=execFile(this.helper,['drawer-menu',handle,String(process.pid),String(pt.x),String(pt.y),extended?'extended':'normal'],
          {windowsHide:true,maxBuffer:4096},err=>err?reject(new Error('无法打开或执行 Windows 文件菜单。可用图标右上角的定位按钮在资源管理器中操作。')):resolve());
        let output='';child.stdout?.on('data',chunk=>{output+=chunk;if(output.includes('menu-closed')&&this.active===token)this.active=undefined;});
        child.stdin?.on('error',()=>{}); child.stdin?.end(file+'\n','utf8');
      });
    } finally {if(this.active===token)this.active=undefined;}
  }
}
