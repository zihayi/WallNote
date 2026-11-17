import { existsSync } from 'node:fs';

export function configureEnvironment() {
  // Respect this machine's shared tool-cache convention without requiring a D: drive elsewhere.
  if (existsSync('D:/opencode/cache')) {
    process.env.electron_config_cache ??= 'D:/opencode/cache/electron';
    process.env.ELECTRON_CACHE ??= 'D:/opencode/cache/electron';
    process.env.ELECTRON_BUILDER_CACHE ??= 'D:/opencode/cache/electron-builder';
  }
  delete process.env.ELECTRON_RUN_AS_NODE;
}
