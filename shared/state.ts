import type { Action, AppState, Note, Task, Wallpaper } from './types';
import { eventError, validDate } from './calendar';

export const builtInWallpapers: Wallpaper[] = [
  { id: 'mist', name: '山野来信', description: '绿色山丘 · 1920 × 1080', category: 'nature', file: 'mist.jpg', colors: ['#59786d', '#a2b4a3', '#dbe1ce'] },
  { id: 'coast', name: '海边散步', description: '海岸风景 · 1920 × 1080', category: 'nature', file: 'coast.jpg', colors: ['#80b7c3', '#d5e6df', '#e9d6b5'] },
  { id: 'dusk', name: '日落之前', description: '日落山景 · 1920 × 1080', category: 'nature', file: 'dusk.jpg', colors: ['#b88b99', '#e9bbad', '#685d84'] },
  { id: 'dunes', name: '风的形状', description: '沙丘风景 · 1920 × 1080', category: 'nature', file: 'dunes.jpg', colors: ['#cb9975', '#e7c8a7', '#9d6d57'] },
  { id: 'bloom', name: '柔光之间', description: '渐变色彩 · 1920 × 1080', category: 'abstract', file: 'bloom.jpg', colors: ['#c0b6db', '#efcfc5', '#a1b7d1'] },
  { id: 'sage', name: '一叶清晨', description: '绿色植物 · 1920 × 1080', category: 'abstract', file: 'sage.jpg', colors: ['#97aa8d', '#dfe3c9', '#617d6c'] },
];

export const noteColors = ['butter', 'lavender', 'mint', 'rose', 'sky'] as const;

export function validWidgetKey(value: unknown): value is string {
  return typeof value === 'string' && (['tasks', 'calendar', 'schedule', 'notes', 'notes-empty'].includes(value) || /^note:[a-zA-Z0-9_-]{1,100}$/.test(value));
}

export function activeDesktopNote(state: AppState): Note | undefined {
  const notes = state.notes.filter(note => note.pinned);
  return notes.find(note => note.id === state.settings.activeDesktopNote) ?? notes[0];
}

export function createNote(): Note {
  return { id: crypto.randomUUID(), title: '', content: '', color: 'butter', pinned: false, updatedAt: new Date().toISOString() };
}

export function createTask(text: string, priority = false): Task {
  return { id: crypto.randomUUID(), text: text.trim(), completed: false, priority, createdAt: new Date().toISOString() };
}

export function createInitialState(): AppState {
  const now = new Date().toISOString();
  return {
    version: 1,
    events: [],
    wallpapers: [],
    favorites: ['mist', 'coast'],
    selectedWallpaperId: 'mist',
    appliedWallpaperId: null,
    settings: { alwaysOnTop: false, launchAtLogin: false, desktopEnabled: true, showDesktopTasks: true, showDesktopCalendar: true, showDesktopSchedule: true, showDesktopNotes: true, glassEnabled: true, topmostWidgets: [], layoutVersion: 4 },
    notes: [
      { id: 'welcome', title: '使用说明', content: '点击显示按钮，将便签加入桌面。\n组件图钉用于置顶；置顶后可移动和缩放。\n\n内容会自动保存，多张便签可用箭头切换。', color: 'butter', pinned: false, updatedAt: now },
      { id: 'inspiration', title: '项目记录', content: '项目：\n负责人：\n截止日期：\n\n备注：', color: 'lavender', pinned: false, updatedAt: now },
      { id: 'little-things', title: '备忘', content: '在这里记录需要保留的信息。', color: 'mint', pinned: false, updatedAt: now },
    ],
    tasks: [
      { id: 'first-wallpaper', text: '选择桌面壁纸', completed: false, priority: true, createdAt: now },
      { id: 'first-note', text: '添加桌面便签', completed: false, priority: false, createdAt: now },
      { id: 'take-break', text: '备份项目文件', completed: false, priority: false, createdAt: now },
      { id: 'welcome-task', text: '安装 WallNote', completed: true, priority: false, createdAt: now },
    ],
  };
}

export function allWallpapers(state: AppState): Wallpaper[] {
  return [...builtInWallpapers, ...state.wallpapers];
}

export function reduceState(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'note:add':
      if (state.notes.some(n => n.id === action.note.id)) return state;
      return { ...state, notes: [action.note, ...state.notes], settings: action.note.pinned ? { ...state.settings, activeDesktopNote: action.note.id } : state.settings };
    case 'note:update':
      return { ...state, notes: state.notes.map(note => note.id === action.id ? { ...note, ...action.changes, updatedAt: Object.keys(action.changes).every(key => key === 'position') ? note.updatedAt : new Date().toISOString() } : note), settings: action.changes.pinned === true ? { ...state.settings, activeDesktopNote: action.id } : action.changes.pinned === false ? { ...state.settings, topmostWidgets: (state.settings.topmostWidgets ?? []).filter(key => key !== `note:${action.id}`) } : state.settings };
    case 'note:delete': return { ...state, notes: state.notes.filter(note => note.id !== action.id), settings: { ...state.settings, topmostWidgets: (state.settings.topmostWidgets ?? []).filter(key => key !== `note:${action.id}`) } };
    case 'note:selectDesktop': {
      if (!state.notes.some(note => note.id === action.id && note.pinned)) throw new Error('该便签未加入桌面。');
      return { ...state, settings: { ...state.settings, activeDesktopNote: action.id } };
    }
    case 'task:add':
      if (!action.task.text.trim() || state.tasks.some(t => t.id === action.task.id)) return state;
      return { ...state, tasks: [action.task, ...state.tasks] };
    case 'task:toggle': return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, completed: !task.completed } : task) };
    case 'task:priority': return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, priority: !task.priority } : task) };
    case 'task:update': return action.text.trim() ? { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, text: action.text.trim() } : task) } : state;
    case 'task:delete': return { ...state, tasks: state.tasks.filter(task => task.id !== action.id) };
    case 'task:clearCompleted': return { ...state, tasks: state.tasks.filter(task => !task.completed) };
    case 'event:add': {
      const message = eventError(action.event);
      if (message) throw new Error(message);
      if ((state.events ?? []).some(event => event.id === action.event.id)) return state;
      return { ...state, events: [...(state.events ?? []), action.event] };
    }
    case 'event:update': {
      if (!(state.events ?? []).some(event => event.id === action.id)) throw new Error('该日程已被删除。');
      return { ...state, events: (state.events ?? []).map(event => {
        if (event.id !== action.id) return event;
        const updated = { ...event, ...action.changes };
        const message = eventError(updated);
        if (message) throw new Error(message);
        return updated;
      }) };
    }
    case 'event:delete': return { ...state, events: (state.events ?? []).filter(event => event.id !== action.id) };
    case 'calendar:select': {
      if (!validDate(action.date)) throw new Error('日期无效。');
      return { ...state, calendarDate: action.date };
    }
    case 'widget:topmost': {
      if (!validWidgetKey(action.key) || typeof action.enabled !== 'boolean') throw new Error('无效的组件置顶设置。');
      const keys = (state.settings.topmostWidgets ?? []).filter(key => key !== action.key);
      const visibility = { tasks: 'showDesktopTasks', calendar: 'showDesktopCalendar', schedule: 'showDesktopSchedule', notes: 'showDesktopNotes' }[action.key];
      return { ...state, appliedWallpaperId: action.enabled ? state.appliedWallpaperId ?? state.selectedWallpaperId : state.appliedWallpaperId, settings: { ...state.settings, ...(action.enabled ? { desktopEnabled: true, ...(visibility ? { [visibility]: true } : {}) } : {}), topmostWidgets: action.enabled ? [...keys, action.key] : keys } };
    }
    case 'wallpaper:favorite': return { ...state, favorites: state.favorites.includes(action.id) ? state.favorites.filter(id => id !== action.id) : [...state.favorites, action.id] };
    case 'wallpaper:select': return allWallpapers(state).some(w => w.id === action.id) ? { ...state, selectedWallpaperId: action.id } : state;
    case 'wallpaper:delete': return {
      ...state, wallpapers: state.wallpapers.filter(w => w.id !== action.id), favorites: state.favorites.filter(id => id !== action.id),
      selectedWallpaperId: state.selectedWallpaperId === action.id ? 'mist' : state.selectedWallpaperId,
      appliedWallpaperId: state.appliedWallpaperId === action.id ? null : state.appliedWallpaperId,
    };
    case 'settings:update': return { ...state, settings: { ...state.settings, ...action.changes } };
    default: throw new Error('不支持的操作');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
function isId(value: unknown): value is string { return isText(value, 100) && /^[a-zA-Z0-9_-]+$/.test(value); }

export function validPosition(value: unknown): boolean {
  return value === undefined || (isRecord(value) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) && Number(value.width) >= 240 && Number(value.width) <= 2000 && Number(value.height) >= 200 && Number(value.height) <= 2000);
}

export function isValidState(value: unknown): value is AppState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.tasks) || !Array.isArray(value.wallpapers) || !Array.isArray(value.favorites)) return false;
  if (value.notes.length > 500 || value.tasks.length > 5000 || value.wallpapers.length > 500) return false;
  if (!isRecord(value.settings) || (value.settings.desktopEnabled !== undefined && typeof value.settings.desktopEnabled !== 'boolean') || (value.settings.showDesktopTasks !== undefined && typeof value.settings.showDesktopTasks !== 'boolean') || !validPosition(value.settings.tasksPosition)) return false;
  if (['showDesktopCalendar', 'showDesktopSchedule', 'showDesktopNotes', 'glassEnabled'].some(key => value.settings && isRecord(value.settings) && value.settings[key] !== undefined && typeof value.settings[key] !== 'boolean')) return false;
  if (['calendarPosition', 'schedulePosition', 'notesPosition'].some(key => !validPosition((value.settings as Record<string, unknown>)[key]))) return false;
  if (value.calendarDate !== undefined && !validDate(value.calendarDate)) return false;
  if (value.settings.layoutVersion !== undefined && (!Number.isInteger(value.settings.layoutVersion) || Number(value.settings.layoutVersion) < 1)) return false;
  if (value.settings.activeDesktopNote !== undefined && !isId(value.settings.activeDesktopNote)) return false;
  if (value.settings.topmostWidgets !== undefined && (!Array.isArray(value.settings.topmostWidgets) || value.settings.topmostWidgets.length > 510 || !value.settings.topmostWidgets.every(validWidgetKey) || new Set(value.settings.topmostWidgets).size !== value.settings.topmostWidgets.length)) return false;
  if (value.events !== undefined && (!Array.isArray(value.events) || value.events.length > 10000 || !value.events.every(event => isRecord(event) && isId(event.id) && isText(event.title, 120) && event.title.trim().length > 0 && validDate(event.date) && isText(event.start, 5) && isText(event.end, 5) && isText(event.description, 5000) && noteColors.includes(event.color as Note['color']) && eventError(event as unknown as import('./types').ScheduleEvent) === null) || new Set(value.events.map(event => event.id)).size !== value.events.length)) return false;
  const notesValid = value.notes.every(n => isRecord(n) && isId(n.id) && isText(n.title, 120) && isText(n.content, 50000) && noteColors.includes(n.color as Note['color']) && typeof n.pinned === 'boolean' && isText(n.updatedAt, 50) && Number.isFinite(Date.parse(n.updatedAt)) && (n.position === undefined || (isRecord(n.position) && ['x', 'y', 'width', 'height'].every(k => typeof n.position === 'object' && Number.isFinite((n.position as Record<string, unknown>)[k])) && Number(n.position.width) >= 240 && Number(n.position.width) <= 2000 && Number(n.position.height) >= 200 && Number(n.position.height) <= 2000)));
  const tasksValid = value.tasks.every(t => isRecord(t) && isId(t.id) && isText(t.text, 500) && t.text.trim().length > 0 && typeof t.completed === 'boolean' && typeof t.priority === 'boolean' && isText(t.createdAt, 50) && Number.isFinite(Date.parse(t.createdAt)));
  const wallpapersValid = value.wallpapers.every(w => isRecord(w) && isId(w.id) && isText(w.name, 120) && isText(w.description, 500) && w.category === 'imported' && typeof w.file === 'string' && /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|bmp)$/i.test(w.file) && Array.isArray(w.colors) && w.colors.every(c => typeof c === 'string' && /^#[\da-fA-F]{6}$/.test(c)));
  const ids = [...builtInWallpapers.map(w => w.id), ...value.wallpapers.map(w => isRecord(w) ? w.id : '')];
  const unique = (items: unknown[]) => new Set(items).size === items.length;
  return notesValid && tasksValid && wallpapersValid && unique(value.notes.map(n => n.id)) && unique(value.tasks.map(t => t.id)) && unique(ids) && value.favorites.every(id => typeof id === 'string' && ids.includes(id)) && unique(value.favorites) && typeof value.selectedWallpaperId === 'string' && ids.includes(value.selectedWallpaperId) && (value.appliedWallpaperId === null || (typeof value.appliedWallpaperId === 'string' && ids.includes(value.appliedWallpaperId))) && isRecord(value.settings) && typeof value.settings.alwaysOnTop === 'boolean' && typeof value.settings.launchAtLogin === 'boolean';
}
