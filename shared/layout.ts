import type { DesktopSurface } from './types';

type Bounds = DesktopSurface['bounds'];

export function plannerLayout(area: Bounds): Record<'schedule' | 'calendar' | 'tasks' | 'notes', Bounds> {
  const padding = Math.min(40, Math.max(20, area.width * .025));
  const usable = area.width - padding * 2;
  const left = Math.min(350, Math.max(250, usable * .25));
  const right = Math.min(330, Math.max(250, usable * .25));
  const middle = Math.min(520, Math.max(280, usable - left - right - 40));
  const gap = Math.max(12, (usable - left - middle - right) / 2);
  const height = Math.min(800, Math.max(420, area.height - 48));
  const top = area.y + Math.max(24, (area.height - height) / 2);
  const tasksHeight = Math.round((height - 20) * .47);
  const make = (x: number, y: number, width: number, h: number): Bounds => ({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(h) });
  return {
    schedule: make(area.x + padding, top, left, height),
    calendar: make(area.x + padding + left + gap, top, middle, height),
    tasks: make(area.x + area.width - padding - right, top, right, tasksHeight),
    notes: make(area.x + area.width - padding - right, top + tasksHeight + 20, right, height - tasksHeight - 20),
  };
}
