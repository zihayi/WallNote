import { spawn,execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir,mkdtemp } from 'node:fs/promises';
import { promisify } from 'node:util';
import { strict as assert } from 'node:assert';
import path from 'node:path';

await mkdir('test-results',{recursive:true});const work=await mkdtemp(path.resolve('test-results','drawer-lease-')),exe=path.join(work,'fixture.exe');
await promisify(execFile)(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:exe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll',`/out:${exe}`,path.resolve('native/DesktopDrawer.cs'),path.resolve('tests/DrawerIconFixture.cs')],{windowsHide:true});
const children=[];
function start(...args){const proc=spawn(exe,args,{stdio:'pipe',windowsHide:true});children.push(proc);proc.stderr.resume();const reader=createInterface({input:proc.stdout})[Symbol.asyncIterator]();const closed=new Promise((r,j)=>{proc.on('error',j);proc.on('close',r);});
  const line=async()=>{let timer;try{return await Promise.race([reader.next().then(v=>v.value),new Promise((_,j)=>{timer=setTimeout(()=>j(Error('fixture timeout')),9000);})]);}finally{clearTimeout(timer);}};
  return {proc,closed,line};}
try {
  for(const visible of [true,false]) {
    const plate=start(visible?'visible':'hidden'), args=(await plate.line()).split(' ');
    const check=async expected=>{plate.proc.stdin.write('visible\n');assert.equal(await plate.line(),expected?'yes':'no');};
    await check(visible);let lease=start('hold',...args);assert.equal(await lease.line(),visible?'hidden':'already-hidden');await check(false);
    lease.proc.stdin.end();assert.equal(await lease.closed,0);await check(visible);
    if(visible){lease=start('hold',...args);assert.equal(await lease.line(),'hidden');lease.proc.kill();await lease.closed;await check(false);const repair=start('recover',...args);assert.equal(await repair.closed,0);await check(true);}
    plate.proc.stdin.end();await plate.closed;
  }
  console.log('Icon lease passed on isolated Win32 controls: hide, release on EOF, preserve previously hidden state, recover interrupted helper.');
}finally {for(const p of children)if(p.exitCode===null&&!p.killed)p.kill();}
