import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dateKey, validDate } from '../shared/calendar';
import { emptyCommunity, itemId, itemURL, normalizeSettings, type CommunitySettings, type CommunityView, type Digest } from '../shared/community';
import { collectFeed, summarize, type FetchJSON } from './community-feed';

interface Vault { seal(value: string): Promise<Buffer>; unseal(value: Buffer): Promise<string> }
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
function validReport(d: Digest): boolean {
  if (!d || !validDate(d.day) || !Number.isFinite(Date.parse(d.at)) || !Number.isFinite(Date.parse(d.since)) || !Array.isArray(d.sources) || !Array.isArray(d.items) || d.items.length > 72 || !Array.isArray(d.highlights) || d.highlights.length > 6 || !Array.isArray(d.notices) || d.notices.length > 20 || !d.notices.every(n => typeof n === 'string' && n.length <= 500) || (d.model !== null && typeof d.model !== 'string')) return false;
  normalizeSettings({ ...emptyCommunity().settings, sources: d.sources });
  const ids = new Set<string>();
  if (d.overview !== undefined && (typeof d.overview !== 'string' || d.overview.length > 110)) return false;
  for (const i of d.items) {
    itemURL(i);
    if (i.summary !== undefined && (typeof i.summary !== 'string' || i.summary.length > 160)) return false;
    if (!Number.isFinite(Date.parse(i.at)) || !i.title || typeof i.title !== 'string' || i.title.length > 240 || !Array.isArray(i.labels) || i.labels.length > 12 || !i.labels.every(l => typeof l === 'string' && l.length <= 60)) return false;
    ids.add(itemId(i));
  }
  return d.highlights.every(h => h && ids.has(h.source) && typeof h.text === 'string' && h.text.length <= 400);
}

export class CommunityAssistant {
  private view = emptyCommunity();
  private stateFile: string;
  private keyFile: string;
  private timer?: ReturnType<typeof setInterval>;
  private lifetime = new AbortController();
  private until = 0;
  private active?: Promise<CommunityView>;

  constructor(private dir: string, private fetcher: FetchJSON, private vault: Vault, private changed: (view: CommunityView) => void, private clock = () => new Date()) {
    this.stateFile = path.join(dir, 'community.json'); this.keyFile = path.join(dir, 'deepseek-key.bin');
  }
  status(): CommunityView { return structuredClone(this.view); }
  private emit() { this.changed(this.status()); }
  async start() {
    try { await fs.mkdir(this.dir, { recursive: true }); }
    catch { this.view.error = '无法创建社区日报数据目录，请检查本机数据目录权限。'; return; }
    try {
      if ((await fs.stat(this.stateFile)).size > 4_000_000) throw new Error();
      const obj = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      const settings = normalizeSettings(obj.settings);
      if (obj.version !== 1 || !Array.isArray(obj.reports) || obj.reports.length > 7 || !obj.reports.every(validReport) || (obj.attempt !== '' && !validDate(obj.attempt))) throw new Error();
      Object.assign(this.view, { settings, reports: obj.reports, attempt: obj.attempt, error: typeof obj.error === 'string' ? obj.error.slice(0, 500) : null });
    } catch (error) {
      if (!absent(error)) { await fs.copyFile(this.stateFile, `${this.stateFile}.recovery-${Date.now()}`).catch(() => undefined); this.view.error = '日报缓存无法读取，请重新检查订阅。'; }
    }
    try { this.view.hasKey = (await fs.stat(this.keyFile)).isFile(); } catch { this.view.hasKey = false; }
    this.timer = setInterval(() => { void this.tick(); }, 30000); this.timer.unref(); void this.tick();
  }
  async stop() { clearInterval(this.timer); this.lifetime.abort(); await this.active?.catch(() => undefined); }
  private async atomic(file: string, bytes: string | Buffer) {
    await fs.writeFile(`${file}.tmp`, bytes, { mode: 0o600 }); await fs.rename(`${file}.tmp`, file);
  }
  private save(next = this.view) {
    const { settings, reports, attempt, error } = next;
    return this.atomic(this.stateFile, JSON.stringify({ version: 1, settings, reports, attempt, error }));
  }
  private exclusive(fn: () => Promise<void>): Promise<CommunityView> {
    if (this.active || this.lifetime.signal.aborted) throw new Error('正在处理日报，请稍后再试。');
    this.view.busy = true; this.emit();
    const work = Promise.resolve().then(fn).finally(() => { this.active = undefined; this.view.busy = false; this.emit(); });
    return this.active = work.then(() => this.status());
  }
  configure(input: CommunitySettings) {
    const settings = normalizeSettings(input);
    return this.exclusive(async () => { await this.save({ ...this.view, settings }); this.view.settings = settings; });
  }
  key(value: string | null) {
    if (value !== null && (typeof value !== 'string' || !/^[A-Za-z0-9._-]{12,256}$/.test(value))) throw new Error('密钥格式无效。');
    return this.exclusive(async () => {
      if (value === null) await fs.rm(this.keyFile, { force: true });
      else { try { await this.atomic(this.keyFile, await this.vault.seal(value)); } catch { throw new Error('系统加密存储不可用，密钥未保存。'); } }
      this.view.hasKey = value !== null;
    });
  }
  async tick() {
    const now = this.clock(), time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    if (!this.active && !this.lifetime.signal.aborted && this.view.settings.daily && time >= this.view.settings.time && dateKey(now) > this.view.attempt && +now >= this.until) await this.run().catch(() => undefined);
  }
  run() {
    if (+this.clock() < this.until) throw new Error('刚刚刷新过，请一分钟后再试。');
    return this.exclusive(async () => {
      const now = this.clock(), settings = this.view.settings, signal = this.lifetime.signal;
      // Claim the local day before network/paid work, including after restart or sleep.
      this.until = +now + 60000; this.view.attempt = dateKey(now); this.view.error = null;
      try {
        await this.save();
        const excerpts = new Map<string,string>();
        const report = await collectFeed(settings, now, this.fetcher, signal, excerpts);
        if (settings.ai && report.items.length && !signal.aborted) {
          let secret: string | undefined;
          try { if (this.view.hasKey) secret = await this.vault.unseal(await fs.readFile(this.keyFile)); } catch { /* Never expose the decryption error. */ }
          if (!secret) report.notices.push('未配置可用的 DeepSeek 密钥，本期保留 GitHub 原始动态。');
          else try { await summarize(report, settings, secret, this.fetcher, signal, excerpts); }
          catch (error) { report.notices.push((error as Error).message + ' 已保留原始动态。'); }
        }
        signal.throwIfAborted();
        const reports = [report, ...this.view.reports.filter(d => d.day !== report.day)].slice(0, 7);
        await this.save({ ...this.view, reports }); this.view.reports = reports;
      } catch (error) {
        if (!signal.aborted) { this.view.error = (error as Error).message.slice(0, 500); await this.save().catch(() => undefined); }
      }
    });
  }
  item(day: string, id: string) {
    const item = this.view.reports.find(d => d.day === day)?.items.find(i => itemId(i) === id);
    if (!item) throw new Error('来源已不在日报中，请刷新页面。');
    return item;
  }
}
