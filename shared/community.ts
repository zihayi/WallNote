export type FeedKind = 'opened' | 'merged' | 'opportunity';
export const feedNames: Record<FeedKind, string> = { opened: '新 PR', merged: '已合并', opportunity: '待认领 Issue' };
export interface Subscription { repo: string; label: string }
export interface CommunitySettings { sources: Subscription[]; daily: boolean; time: string; ai: boolean; includeExcerpt?: boolean; model: 'deepseek-flash' | 'deepseek-v4-pro'; focus: string }
export interface FeedItem { repo: string; number: number; kind: FeedKind; title: string; labels: string[]; at: string; summary?: string }
export interface Digest { day: string; at: string; since: string; sources: Subscription[]; items: FeedItem[]; overview?: string; highlights: { source: string; text: string }[]; model: string | null; notices: string[] }
export interface CommunityView { settings: CommunitySettings; reports: Digest[]; busy: boolean; hasKey: boolean; error: string | null; attempt: string }
export const communityDefaults = (): CommunitySettings => ({ sources: [{ repo: 'llvm/llvm-project', label: 'mlir' }, { repo: 'llvm/llvm-project', label: '' }], daily: false, time: '09:00', ai: false, model: 'deepseek-flash', focus: '关注编译器、MLIR 及可以参与的贡献任务。' });
export const emptyCommunity = (): CommunityView => ({ settings: communityDefaults(), reports: [], busy: false, hasKey: false, error: null, attempt: '' });
export const validRepo = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]{1,100}$/i.test(v) && !['.', '..'].includes(v.split('/')[1]);
export const itemId = (item: FeedItem) => `${item.repo.toLowerCase()}#${item.number}`;
export const sourceKey = (s: Subscription) => `${s.repo}:${s.label}`.toLowerCase();
export const sourceName = (s: Subscription) => s.repo.toLowerCase() === 'llvm/llvm-project' ? s.label.toLowerCase() === 'mlir' ? 'MLIR' : s.label || 'LLVM' : s.label ? `${s.repo} / ${s.label}` : s.repo;
export function sourceItems(report: Digest | undefined, filter: string): FeedItem[] {
  if (!report) return [];
  const source = report.sources.find(s => sourceKey(s) === filter);
  return !source ? report.items : report.items.filter(i => i.repo.toLowerCase() === source.repo.toLowerCase() && (!source.label || i.labels.some(l => l.toLowerCase() === source.label.toLowerCase())));
}
export function itemURL(item: FeedItem) {
  if (!validRepo(item.repo) || !Number.isSafeInteger(item.number) || item.number < 1 || !Object.hasOwn(feedNames, item.kind)) throw new Error('来源地址无效。');
  return `https://github.com/${item.repo}/${item.kind === 'opportunity' ? 'issues' : 'pull'}/${item.number}`;
}
export function normalizeSettings(value: CommunitySettings): CommunitySettings {
  if (!value || !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 3) throw new Error('请设置 1–3 个订阅。');
  const sources = value.sources.map(s => {
    const repo = typeof s?.repo === 'string' ? s.repo.trim().toLowerCase() : '';
    const label = typeof s?.label === 'string' ? s.label.trim() : null;
    if (!validRepo(repo) || label === null || !/^[\p{L}\p{N} _+./-]{0,50}$/u.test(label)) throw new Error('请填写 owner/repo 和有效的标签名称。');
    return { repo, label };
  });
  if (new Set(sources.map(s => `${s.repo}:${s.label.toLowerCase()}`)).size !== sources.length) throw new Error('请移除重复订阅。');
  if (typeof value.daily !== 'boolean' || typeof value.ai !== 'boolean' || typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) || typeof value.focus !== 'string' || value.focus.length > 200 || !['deepseek-flash','deepseek-v4-pro'].includes(value.model)) throw new Error('日报时间或 AI 设置无效。');
  return { sources, daily: value.daily, time: value.time, ai: value.ai, includeExcerpt: value.includeExcerpt === true, focus: value.focus.trim(), model: value.model };
}
