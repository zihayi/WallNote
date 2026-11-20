import type { AppState } from './types';

export const slots = ['left', 'center', 'upper', 'lower'] as const;
export type Slot = typeof slots[number];
export const modules = {
  schedule: { name: '时间安排', flag: 'showDesktopSchedule', tall: true, minimum: {width:280,height:360} },
  calendar: { name: '日历', flag: 'showDesktopCalendar', tall: true, minimum: {width:330,height:550} },
  tasks: { name: '待办', flag: 'showDesktopTasks', tall: false },
  notes: { name: '便签', flag: 'showDesktopNotes', tall: false },
  community: { name: '社区日报', flag: 'showDesktopCommunity', tall: false },
  drawer: { name: '文件抽屉', flag: 'showDesktopDrawer', tall: false },
} as const;
export type ModuleId = keyof typeof modules;
export type ModuleFlag = typeof modules[ModuleId]['flag'];
export const moduleIds = Object.keys(modules) as ModuleId[];
export const moduleFlags = moduleIds.map(id=>modules[id].flag);
export const modulePositions = moduleIds.map(id=>`${id}Position` as const);
export type ModuleSlots = Record<Slot, ModuleId | null>;
export const slotNames: Record<Slot, string> = { left: '左栏', center: '中栏', upper: '右上', lower: '右下' };
export const defaultSlots = { left: 'schedule', center: 'calendar', upper: 'tasks', lower: 'notes' } as const;
const fits = (slot: Slot, id: ModuleId | null) => !id || !modules[id].tall || slot === 'left' || slot === 'center';
export function validSlots(value: unknown): value is ModuleSlots {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== slots.length) return false;
  const ids = new Set<string>();
  return slots.every(slot => {
    const id = (value as ModuleSlots)[slot];
    if (id === null) return true;
    if (typeof id !== 'string' || !Object.hasOwn(modules, id) || !fits(slot, id) || ids.has(id)) return false;
    ids.add(id); return true;
  });
}
export function assignSlot(current: ModuleSlots, slot: Slot, id: ModuleId | null): ModuleSlots | null {
  const next = { ...current }, old = id && slots.find(s => current[s] === id);
  if (old) next[old] = current[slot];
  next[slot] = id;
  return validSlots(next) ? next : null;
}
export function visibleModule(settings: AppState['settings'], slot: Slot) {
  const id = (settings.moduleSlots ?? defaultSlots)[slot];
  return id && settings[modules[id].flag] !== false ? id : null;
}
