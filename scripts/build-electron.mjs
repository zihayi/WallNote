import { build } from 'esbuild';
import { buildNative } from './build-native.mjs';

export async function buildElectron() {
  await buildNative();
  await build({
    entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outdir: 'dist-electron',
    outExtension: { '.js': '.cjs' },
    external: ['electron'],
    sourcemap: true,
  });
}

if (process.argv[1]?.endsWith('build-electron.mjs')) await buildElectron();
