import { configureEnvironment } from './environment.mjs';

configureEnvironment();
const { build } = await import('electron-builder');
await build({ win: ['portable'] });
