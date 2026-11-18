import { configureEnvironment } from './environment.mjs';
import { buildReceiver } from './build-receiver.mjs';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

configureEnvironment();
await buildReceiver();
const { build, Platform, Arch } = await import('electron-builder');
const artifacts = await build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never' });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const name = `WallNote-Setup-${version}-x64.exe`;
const setup = artifacts.find(file => path.basename(file) === name);
if (!setup) throw new Error(`未生成安装程序 ${name}`);
const hash = createHash('sha256');
for await (const chunk of createReadStream(setup)) hash.update(chunk);
await writeFile(`${setup}.sha256`, `${hash.digest('hex')}  ${name}\n`, 'ascii');
console.log(`Windows 安装包：${setup}`);
