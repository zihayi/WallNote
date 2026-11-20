export const drawerNames = { app: '应用', document: '文档', folder: '文件夹', other: '其他' } as const;
export type DrawerCategory = keyof typeof drawerNames;
export interface DrawerItem { id: string; name: string; category: DrawerCategory; extension: string; shortcut: boolean; iconVersion: number; origin: 'user' | 'public' }
/** Relative to the sender's viewport, independent of the monitor's DPI. */
export interface DrawerPoint { x: number; y: number }
export function isDrawerPoint(p: unknown): p is DrawerPoint {
  if (!p || typeof p !== 'object') return false;
  const {x,y}=p as DrawerPoint; return Number.isFinite(x) && Number.isFinite(y) && x>=0 && y>=0 && x<=1 && y<=1;
}
export type IconLeaseState = 'off' | 'starting' | 'hidden' | 'already-hidden' | 'error';
export interface DrawerView { enabled: boolean; ready: boolean; canHide: boolean; busy: boolean; items: DrawerItem[]; message: string; icons: IconLeaseState }
export const emptyDrawer = (): DrawerView => ({ enabled: false, ready: false, canHide: false, busy: false, items: [], message: '', icons: 'off' });
