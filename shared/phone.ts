import type { PhoneSyncView } from './types';

export function emptyPhoneSync(): PhoneSyncView {
  return { configured: false, connected: false, phoneOnline: false, canWrite: false, device: '', lastSync: null, calendarId: null, calendars: [], pending: 0, error: null, items: {} };
}
