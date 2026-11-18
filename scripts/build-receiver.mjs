import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export async function buildReceiver() {
  const bridge = path.resolve(process.env.CALENDAR_BRIDGE_ROOT || 'receiver');
  const script = path.join(bridge, 'dev/build_receiver.py');
  try { await access(script); } catch { throw new Error('找不到 receiver/dev/build_receiver.py，请检查源码或 CALENDAR_BRIDGE_ROOT。'); }
  const python = process.env.CALENDAR_BUILD_PYTHON || process.env.CALENDAR_PYTHON || 'python';
  await new Promise((resolve, reject) => {
    const child = spawn(python, [script, '--output', path.resolve('dist-native')], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('接收服务打包失败，请在构建用 Python 环境安装 receiver/requirements-build.txt。')));
  });
}

if (process.argv[1]?.endsWith('build-receiver.mjs')) await buildReceiver();
