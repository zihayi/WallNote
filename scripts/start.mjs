import { spawn } from 'node:child_process';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
const { default: electron } = await import('electron');
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('exit', code => process.exit(code ?? 0));
child.on('error', error => { console.error(error); process.exit(1); });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
