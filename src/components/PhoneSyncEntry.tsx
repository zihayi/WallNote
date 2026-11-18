import { useEffect, useState } from 'react';
import { ChevronRight, Smartphone } from 'lucide-react';
import type { Page, PhoneSyncView } from '../../shared/types';
import { PHONE_SYNC, phoneConnection } from '../../shared/phone';
import { api, errorMessage, isDesktop } from '../api';

export function PhoneSyncEntry({ view, widget = false, onError }: { view?: PhoneSyncView; widget?: boolean; onError?: (message: string) => void }) {
  const connection = isDesktop ? phoneConnection(view) : { tone: 'idle', label: '浏览器预览', detail: '配对手机需要 Windows 桌面版。' };
  const open = () => {
    if (widget && isDesktop) void api.desktopControl('showPhoneSync').catch(error => onError?.(errorMessage(error)));
    else location.hash = 'phone-sync';
  };
  return <button type="button" className="phone-sync-entry" data-tone={connection.tone} onClick={open}
    aria-label={`打开手机同步：${connection.label}`} title={`${connection.detail} 点击管理连接。`}>
    <Smartphone size={15} /><strong>{PHONE_SYNC}</strong><span className="phone-entry-state"><i />{connection.label}</span><ChevronRight size={13} />
  </button>;
}

// One destination for the toolbar and native calendar, including a cold manager launch.
// An external deep link waits for an open editor instead of unmounting its unsaved draft.
export function usePhoneSyncLink(manager: boolean, ready: boolean, page: Page, setPage: (page: Page) => void) {
  const [requested, request] = useState(false);
  useEffect(() => {
    if (!manager) return;
    const read = () => request(location.hash === '#phone-sync');
    read(); window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [manager]);
  useEffect(() => {
    if (!requested || !ready) return;
    const navigate = () => {
      if (document.querySelector('[role="dialog"], .task-edit-form')) return false;
      if (page !== 'settings') { setPage('settings'); return true; }
      const section = document.getElementById('phone-sync');
      section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start' });
      history.replaceState(history.state, '', location.href.split('#')[0]);
      request(false); return true;
    };
    if (navigate()) return;
    const observer = new MutationObserver(() => { if (navigate()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [requested, ready, page, setPage]);
}
