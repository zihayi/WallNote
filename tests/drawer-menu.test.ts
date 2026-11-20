import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach,expect,it,vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { DrawerMenu } from '../electron/drawer-menu';

const launch=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',()=>({spawn:launch}));
vi.mock('electron',()=>({screen:{dipToScreenPoint:(p:unknown)=>p}}));
afterEach(()=>vi.useRealTimers());

class Helper extends EventEmitter {
  stdin=new PassThrough(); stdout=new PassThrough(); stderr=new PassThrough(); lines:string[]=[];
  kill=vi.fn();readonly pid=42;
  constructor(){super();this.stdin.on('data',chunk=>this.lines.push(chunk.toString().trim()));}
  reply(state:string,id:number){this.stdout.write(`${state} ${id}\n`);}
}
function fixture(){
  const helpers:Helper[]=[];
  launch.mockImplementation(()=>{const h=new Helper();helpers.push(h);return h;});
  const tracking=vi.fn(async (_active:boolean)=>{}),menu=new DrawerMenu('helper',tracking);
  const win={isDestroyed:()=>false,getNativeWindowHandle:()=>Buffer.alloc(8),getContentBounds:()=>({x:-100,y:0,width:100,height:100})} as BrowserWindow;
  const item={file:'D:\\一.txt',stamp:'1'};
  return {helpers,menu,tracking,win,item,prepare:(ticket:string)=>menu.prepare(win,ticket,async()=>item),open:(target=item,extended=false,ticket?:string)=>menu.show(win,null,target,{x:.5,y:.5},extended,ticket)};
}

it('preparing cannot enter menu tracking and only the matching gesture consumes its menu once',async()=>{
  vi.useFakeTimers();const {helpers,prepare,tracking,open,item}=fixture();await prepare('gesture');
  expect(helpers).toHaveLength(1);const [h]=helpers;expect(h.lines[0]).toMatch(/^prepare 1 /);expect(tracking).not.toHaveBeenCalled();
  let shown=open(item,false,'gesture');await Promise.resolve();expect(h.lines[1].split(' ').slice(0,7)).toEqual(['show','2','0','-50','50','0','1']);
  h.reply('tracking',2);await vi.advanceTimersByTimeAsync(20000);expect(h.stdin.writableEnded).toBe(false);
  h.reply('closed',2);h.reply('done',2);await shown;
  shown=open({file:'D:\\二.lnk',stamp:'1'},true,'gesture');await Promise.resolve();
  expect(helpers).toHaveLength(1);const fields=h.lines[2].split(' ');expect(fields.slice(5,7)).toEqual(['1','0']);expect(Buffer.from(fields[7],'base64').toString()).toBe('D:\\二.lnk');
  h.reply('done',3);await shown;await vi.advanceTimersByTimeAsync(15000);expect(h.stdin.writableEnded).toBe(true);
});

it.each(['file','stamp','modifier','ticket','window','cancel'])('never adopts prepared commands after a %s mismatch',async mismatch=>{
  const {helpers,menu,win,item,prepare}=fixture();await prepare('t');
  if(mismatch==='cancel')menu.discard(win,'t');
  const target={file:mismatch==='file'?'D:\\b':item.file,stamp:mismatch==='stamp'?'2':item.stamp};
  const request=menu.show(mismatch==='window'?{...win} as BrowserWindow:win,null,target,{x:0,y:0},mismatch==='modifier',mismatch==='ticket'?'old':'t');
  await Promise.resolve();expect(helpers[0].lines.at(-1)?.split(' ')[6]).toBe('0');helpers[0].reply('done',2);await request;menu.stop();
});

it('closing the quick menu during file validation never starts a worker',async()=>{
  const {helpers,menu,win,item}=fixture();let complete!:(v:typeof item)=>void;
  const p=menu.prepare(win,'old',()=>new Promise(r=>{complete=r;}));menu.discard(win,'old');complete(item);await p;expect(helpers).toHaveLength(0);
});

it('a new press can cancel a pending popup, but a late discard cannot cancel a tracking menu',async()=>{
  const {helpers,menu,win,item,open}=fixture();const first=open(item,false,'a');await Promise.resolve();
  menu.discard(win,'a');expect(helpers[0].stdin.writableEnded).toBe(true);
  const second=open(item,false,'b');await Promise.resolve();helpers[1].reply('tracking',2);
  menu.discard(win,'b');expect(helpers[1].stdin.writableEnded).toBe(false);
  helpers[0].reply('done',1);await first;helpers[1].reply('done',2);await second;menu.stop();
});

it('allows a new popup during an earlier property sheet; late completion cannot unlock it',async()=>{
  const {helpers,tracking,open,menu}=fixture();const first=open();await Promise.resolve();helpers[0].reply('closed',1);
  expect(tracking).toHaveBeenLastCalledWith(false);
  const second=open();await Promise.resolve();expect(helpers).toHaveLength(2);
  expect(helpers[0].stdin.writableEnded).toBe(true);expect(helpers[0].kill).not.toHaveBeenCalled();
  helpers[0].reply('done',1);await first;expect(tracking).toHaveBeenLastCalledWith(true);
  await open();expect(helpers).toHaveLength(2);helpers[1].reply('done',2);await second;expect(tracking).toHaveBeenLastCalledWith(false);menu.stop();
});

it('restores input and retries after a crash or hung extension, and discards the idle host on shutdown',async()=>{
  vi.useFakeTimers();const {helpers,tracking,menu,open,prepare}=fixture();
  const first=open();await Promise.resolve();helpers[0].emit('close',1);await expect(first).rejects.toThrow();expect(tracking).toHaveBeenLastCalledWith(false);
  const hung=expect(open()).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(12001);await hung;expect(helpers[1].kill).toHaveBeenCalled();
  const retry=open();await Promise.resolve();helpers[2].reply('done',3);await retry;menu.stop();await prepare('x');
  expect(helpers).toHaveLength(3);expect(helpers[2].stdin.writableEnded).toBe(true);
});
