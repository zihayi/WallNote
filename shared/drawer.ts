export const drawerNames = { app: '应用', document: '文档', folder: '文件夹', other: '其他' } as const;
export type DrawerCategory = keyof typeof drawerNames;
export interface DrawerItem { id: string; name: string; category: DrawerCategory; extension: string; shortcut: boolean; origin: 'user' | 'public' }
export type IconLeaseState = 'off' | 'starting' | 'hidden' | 'already-hidden' | 'error';
export interface DrawerView { enabled: boolean; ready: boolean; canHide: boolean; busy: boolean; items: DrawerItem[]; message: string; icons: IconLeaseState }
export const emptyDrawer = (): DrawerView => ({ enabled: false, ready: false, canHide: false, busy: false, items: [], message: '', icons: 'off' });
