import type { PhoneSyncView } from './types';

export const PHONE_SYNC = '手机同步';

/** Display alias only. Addresses, provider/calendar IDs and meaningful calendar names stay distinct. */
export function phoneCalendarLabel(name?: string): string {
  const label = name?.trim();
  return !label || /^(?:local(?:[\s_-]*account)?|本地(?:帐户|账户|帐号|账号)|未命名日历)$/i.test(label) ? PHONE_SYNC : label;
}

export function phoneConnection(view?: PhoneSyncView) {
  if (view?.error) return { tone: 'error', label: '连接异常', detail: view.error } as const;
  if (!view?.configured) return { tone: 'idle', label: '未连接', detail: '在同一 Wi-Fi 下配对手机，即可同步日历。' } as const;
  if (!view.connected) return { tone: 'error', label: '服务未连接', detail: '尚未连上接收服务，请检查连接后重试。' } as const;
  if (view.phoneOnline) return { tone: 'online', label: '手机在线', detail: view.device || '已收到手机心跳。' } as const;
  if (!view.device && !view.lastSync) return { tone: 'waiting', label: '等待手机', detail: '接收服务已就绪，等待手机首次连接。' } as const;
  return { tone: 'waiting', label: '手机离线', detail: `${view.device || '已配对手机'} · 打开手机日历助手即可重连。` } as const;
}

export function emptyPhoneSync(): PhoneSyncView {
  return { configured: false, connected: false, phoneOnline: false, canWrite: false, device: '', lastSync: null, calendarId: null, calendars: [], pending: 0, error: null, items: {} };
}
