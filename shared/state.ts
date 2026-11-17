import type { Action, AppState, Note, Task, Wallpaper } from './types';

export const builtInWallpapers: Wallpaper[] = [
  { id: 'mist', name: '山野来信', description: '让目光越过山丘，让思绪慢下来。', category: 'nature', file: 'mist.jpg', colors: ['#59786d', '#a2b4a3', '#dbe1ce'] },
  { id: 'coast', name: '海边散步', description: '把海风和晴天，一起留在桌面。', category: 'nature', file: 'coast.jpg', colors: ['#80b7c3', '#d5e6df', '#e9d6b5'] },
  { id: 'dusk', name: '日落之前', description: '今天的最后一束光，也值得珍藏。', category: 'nature', file: 'dusk.jpg', colors: ['#b88b99', '#e9bbad', '#685d84'] },
  { id: 'dunes', name: '风的形状', description: '在安静的沙丘里，找到自己的节奏。', category: 'nature', file: 'dunes.jpg', colors: ['#cb9975', '#e7c8a7', '#9d6d57'] },
  { id: 'bloom', name: '柔光之间', description: '一点温柔的色彩，一整天的好心情。', category: 'abstract', file: 'bloom.jpg', colors: ['#c0b6db', '#efcfc5', '#a1b7d1'] },
  { id: 'sage', name: '一叶清晨', description: '给忙碌的日常，留一小片绿意。', category: 'abstract', file: 'sage.jpg', colors: ['#97aa8d', '#dfe3c9', '#617d6c'] },
];

export const noteColors = ['butter', 'lavender', 'mint', 'rose', 'sky'] as const;

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
    wallpapers: [],
    favorites: ['mist', 'coast'],
    selectedWallpaperId: 'mist',
    appliedWallpaperId: null,
    settings: { alwaysOnTop: false, launchAtLogin: false, desktopEnabled: true, showDesktopTasks: true },
    notes: [
      { id: 'welcome', title: '今天，也要留点时间给自己', content: '窗外的光刚刚好。\n泡一杯喜欢的茶，把想做的事慢慢完成。\n\n不必很快，每一步都算数。', color: 'butter', pinned: false, updatedAt: now },
      { id: 'inspiration', title: '灵感收集箱', content: '✦ 一个干净又有温度的桌面\n✦ 周末想去逛的独立书店\n✦ 下次散步时，记得带上相机', color: 'lavender', pinned: false, updatedAt: now },
      { id: 'little-things', title: '让生活轻一点', content: '整理桌面，也整理心情。\n\n给重要的事留位置，\n给新想法留一点空白。', color: 'mint', pinned: false, updatedAt: now },
    ],
    tasks: [
      { id: 'first-wallpaper', text: '换一张让人心情好的壁纸', completed: false, priority: true, createdAt: now },
      { id: 'first-note', text: '记下今天的第一个灵感', completed: false, priority: false, createdAt: now },
      { id: 'take-break', text: '离开屏幕，散步十分钟', completed: false, priority: false, createdAt: now },
      { id: 'welcome-task', text: '给自己准备一个舒适的工作空间', completed: true, priority: false, createdAt: now },
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
      return { ...state, notes: [action.note, ...state.notes] };
    case 'note:update':
      return { ...state, notes: state.notes.map(note => note.id === action.id ? { ...note, ...action.changes, updatedAt: Object.keys(action.changes).every(key => key === 'position') ? note.updatedAt : new Date().toISOString() } : note) };
    case 'note:delete': return { ...state, notes: state.notes.filter(note => note.id !== action.id) };
    case 'task:add':
      if (!action.task.text.trim() || state.tasks.some(t => t.id === action.task.id)) return state;
      return { ...state, tasks: [action.task, ...state.tasks] };
    case 'task:toggle': return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, completed: !task.completed } : task) };
    case 'task:priority': return { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, priority: !task.priority } : task) };
    case 'task:update': return action.text.trim() ? { ...state, tasks: state.tasks.map(task => task.id === action.id ? { ...task, text: action.text.trim() } : task) } : state;
    case 'task:delete': return { ...state, tasks: state.tasks.filter(task => task.id !== action.id) };
    case 'task:clearCompleted': return { ...state, tasks: state.tasks.filter(task => !task.completed) };
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
  const notesValid = value.notes.every(n => isRecord(n) && isId(n.id) && isText(n.title, 120) && isText(n.content, 50000) && noteColors.includes(n.color as Note['color']) && typeof n.pinned === 'boolean' && isText(n.updatedAt, 50) && Number.isFinite(Date.parse(n.updatedAt)) && (n.position === undefined || (isRecord(n.position) && ['x', 'y', 'width', 'height'].every(k => typeof n.position === 'object' && Number.isFinite((n.position as Record<string, unknown>)[k])) && Number(n.position.width) >= 240 && Number(n.position.width) <= 2000 && Number(n.position.height) >= 200 && Number(n.position.height) <= 2000)));
  const tasksValid = value.tasks.every(t => isRecord(t) && isId(t.id) && isText(t.text, 500) && t.text.trim().length > 0 && typeof t.completed === 'boolean' && typeof t.priority === 'boolean' && isText(t.createdAt, 50) && Number.isFinite(Date.parse(t.createdAt)));
  const wallpapersValid = value.wallpapers.every(w => isRecord(w) && isId(w.id) && isText(w.name, 120) && isText(w.description, 500) && w.category === 'imported' && typeof w.file === 'string' && /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|bmp)$/i.test(w.file) && Array.isArray(w.colors) && w.colors.every(c => typeof c === 'string' && /^#[\da-fA-F]{6}$/.test(c)));
  const ids = [...builtInWallpapers.map(w => w.id), ...value.wallpapers.map(w => isRecord(w) ? w.id : '')];
  const unique = (items: unknown[]) => new Set(items).size === items.length;
  return notesValid && tasksValid && wallpapersValid && unique(value.notes.map(n => n.id)) && unique(value.tasks.map(t => t.id)) && unique(ids) && value.favorites.every(id => typeof id === 'string' && ids.includes(id)) && unique(value.favorites) && typeof value.selectedWallpaperId === 'string' && ids.includes(value.selectedWallpaperId) && (value.appliedWallpaperId === null || (typeof value.appliedWallpaperId === 'string' && ids.includes(value.appliedWallpaperId))) && isRecord(value.settings) && typeof value.settings.alwaysOnTop === 'boolean' && typeof value.settings.launchAtLogin === 'boolean';
}
