import { configureEnvironment } from './environment.mjs';
import { buildReceiver } from './build-receiver.mjs';
import { createReadStream } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

configureEnvironment();
await buildReceiver();
const { build, Platform, Arch } = await import('electron-builder');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
// Keep a running unpacked copy intact while building/testing a new installer.
const staging=process.argv.includes('--side-by-side')?path.join('release',`staging-${version}`):undefined;
const artifacts = await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never', ...(staging?{config:{directories:{output:staging}}}:{}) });
const name = `WallNote-Setup-${version}-x64.exe`;
let setup = artifacts.find(file => path.basename(file) === name);
if (!setup) throw new Error(`未生成安装程序 ${name}`);
if(staging){const dest=path.resolve('release',name);await rename(setup,dest);setup=dest;}
const hash = createHash('sha256');
for await (const chunk of createReadStream(setup)) hash.update(chunk);
await writeFile(`${setup}.sha256`, `${hash.digest('hex')}  ${name}\n`, 'ascii');
console.log(`Windows 安装包：${setup}`);
