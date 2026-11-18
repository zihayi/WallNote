import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WifiReceiverView } from '../shared/types';
import { parsePhoneProfile, phoneRequest, type PhoneProfile } from './phone-client';

export class WifiReceiver {
  private child: ChildProcessWithoutNullStreams | null = null;
  private profile: PhoneProfile | null = null;
  private starting: Promise<void> | null = null;
  private stopping = false;
  private error: string | null = null;
  private discoveryAvailable = false;
  private discoveryPort = 0;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly marker: string;
  constructor(private directory: string, private executable: string, private args: string[], private connect: (profile: PhoneProfile) => Promise<unknown>) {
    this.marker = path.join(directory, 'wifi-receiver.json');
  }
  owns(profile: PhoneProfile) { return this.profile?.certificateSha256 === profile.certificateSha256; }
  async autoStart(hasProfile: boolean) {
    let enabled = !hasProfile;
    try { enabled = JSON.parse(await fs.readFile(this.marker, 'utf8')).enabled === true; } catch { /* First launch. */ }
    if (enabled) await this.start().catch(() => undefined);
  }
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child && this.profile) return;
    this.stopping = false; this.error = null;
    this.starting = this.launch().catch(error => {
      this.error = error instanceof Error ? error.message : 'Wi-Fi 接收服务启动失败。';
      throw error;
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  private async launch() {
    const stateDirectory = path.join(this.directory, 'wifi-receiver', 'state');
    const dataDirectory = path.join(this.directory, 'wifi-receiver', 'data');
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(this.marker, JSON.stringify({ enabled: true }));
    const child = spawn(this.executable, [...this.args, '--managed', '--state-dir', stateDirectory, '--data-dir', dataDirectory], { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stdin.on('error', () => undefined);
    child.stderr.resume(); // Never forward private service diagnostics into the renderer.
    child.stdout.setEncoding('utf8');
    child.once('exit', () => {
      if (this.child !== child) return;
      this.child = null; this.profile = null; this.discoveryAvailable = false;
      if (!this.stopping) {
        this.error = 'Wi-Fi 接收服务已退出。';
        if (this.retries++ < 3) this.retryTimer = setTimeout(() => { void this.start().catch(() => undefined); }, 5000);
      }
    });
    try {
      const ready = await new Promise<{ available: boolean; port: number }>((resolve, reject) => {
        let buffer = '';
        const timeout = setTimeout(() => finish(new Error('Wi-Fi 接收服务启动超时。')), 35000);
        const fail = () => finish(new Error('无法启动内置接收服务，请重新安装完整的 WallNote。'));
        const read = (chunk: string) => {
          buffer += chunk;
          if (buffer.length > 16384) return finish(new Error('接收服务启动响应无效。'));
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) {
            try { const data = JSON.parse(line); if (data.ready === true) finish(null, { available: data.discoveryAvailable === true, port: Number(data.discoveryPort) || 0 }); } catch { /* Ordinary service log. */ }
          }
        };
        const finish = (error: Error | null, value = { available: false, port: 0 }) => {
          clearTimeout(timeout); child.off('error', fail); child.off('exit', fail); child.stdout.off('data', read);
          if (error) reject(error); else resolve(value);
        };
        child.once('error', fail); child.once('exit', fail); child.stdout.on('data', read);
      });
      child.stdout.resume();
      const profile = parsePhoneProfile(await fs.readFile(path.join(stateDirectory, 'wallnote-connection.json'), 'utf8'));
      await this.connect(profile);
      this.profile = profile; this.discoveryAvailable = ready.available; this.discoveryPort = ready.port;
      this.error = ready.available ? null : '发现端口 8767 正被占用，请关闭另一份接收服务后重试。';
    } catch (error) {
      if (this.child === child) { this.child = null; this.profile = null; }
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000); timer.unref(); child.once('exit', () => clearTimeout(timer));
      throw error;
    }
  }
  async status(): Promise<WifiReceiverView> {
    const status: WifiReceiverView = { running: !!this.child && !!this.profile, discoveryAvailable: this.discoveryAvailable, discoveryPort: this.discoveryPort, pairingUntil: 0, requests: [], error: this.error };
    if (!this.profile || !this.child) return status;
    try {
      const response = await phoneRequest(this.profile, '/desktop/pairing');
      status.pairingUntil = Number(response.enabledUntil) || 0;
      if (Array.isArray(response.requests)) status.requests = response.requests.flatMap(item => item && typeof item.id === 'string' && /^[a-f0-9]{32}$/.test(item.id) && typeof item.code === 'string' && /^\d{6}$/.test(item.code) ? [{ id: item.id, device: String(item.device).slice(0, 100), code: item.code, expires: Number(item.expires) }] : []);
    } catch { status.error = '无法读取 Wi-Fi 接收服务状态。'; }
    return status;
  }
  async control(command: 'status' | 'pair' | 'approve' | 'reject', id?: string): Promise<WifiReceiverView> {
    if (command === 'status') return this.status();
    if (command === 'pair') { this.retries = 0; await this.start(); }
    if (!this.profile) throw new Error('请先开启 Wi-Fi 配对。');
    if (command === 'pair') await phoneRequest(this.profile, '/desktop/pairing/open', {});
    else {
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('配对请求无效。');
      await phoneRequest(this.profile, `/desktop/pairing/${command}`, { id });
    }
    return this.status();
  }
  async stop(disable = false) {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (disable) { await fs.mkdir(this.directory, { recursive: true }); await fs.writeFile(this.marker, JSON.stringify({ enabled: false })); }
    if (this.starting) await this.starting.catch(() => undefined);
    const child = this.child;
    this.child = null; this.profile = null; this.discoveryAvailable = false;
    if (child) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end('stop\n');
    });
  }
}
