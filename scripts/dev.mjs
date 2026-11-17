import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { buildElectron } from './build-electron.mjs';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
const { default: electron } = await import('electron');

await buildElectron();
const server = await createServer();
await server.listen();
server.printUrls();
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => close(code ?? 0));
child.on('error', (error) => { console.error(error); close(1); });
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
