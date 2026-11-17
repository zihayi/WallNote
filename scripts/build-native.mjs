import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function buildNative() {
  if (process.platform !== 'win32') return;
  await mkdir('dist-native', { recursive: true });
  const compiler = path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/platform:x64', '/optimize+', '/reference:System.Web.Extensions.dll', `/out:${path.resolve('dist-native/WallNote.DesktopHost.exe')}`, path.resolve('native/DesktopHost.cs')], { windowsHide: true });
}
if (process.argv[1]?.endsWith('build-native.mjs')) await buildNative();
