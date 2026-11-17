export type NoteColor = 'butter' | 'lavender' | 'mint' | 'rose' | 'sky';
export type Page = 'dashboard' | 'wallpapers' | 'notes' | 'tasks' | 'settings';

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  updatedAt: string;
  position?: { x: number; y: number; width: number; height: number };
}

export interface Task {
  id: string;
  text: string;
  completed: boolean;
  priority: boolean;
  createdAt: string;
}

export interface Wallpaper {
  id: string;
  name: string;
  description: string;
  category: 'nature' | 'abstract' | 'imported';
  file: string;
  colors: string[];
}

export interface AppState {
  version: 1;
  notes: Note[];
  tasks: Task[];
  wallpapers: Wallpaper[];
  favorites: string[];
  selectedWallpaperId: string;
  appliedWallpaperId: string | null;
  settings: { alwaysOnTop: boolean; launchAtLogin: boolean; desktopEnabled?: boolean; showDesktopTasks?: boolean; tasksPosition?: Note['position'] };
}

export type Action =
  | { type: 'note:add'; note: Note }
  | { type: 'note:update'; id: string; changes: Partial<Pick<Note, 'title' | 'content' | 'color' | 'pinned' | 'position'>> }
  | { type: 'note:delete'; id: string }
  | { type: 'task:add'; task: Task }
  | { type: 'task:toggle'; id: string }
  | { type: 'task:priority'; id: string }
  | { type: 'task:update'; id: string; text: string }
  | { type: 'task:delete'; id: string }
  | { type: 'task:clearCompleted' }
  | { type: 'wallpaper:favorite'; id: string }
  | { type: 'wallpaper:select'; id: string }
  | { type: 'wallpaper:delete'; id: string }
  | { type: 'settings:update'; changes: Partial<AppState['settings']> };

export interface AppInfo { version: string; platform: string; dataPath: string; desktop: boolean }

export interface DesktopStatus {
  enabled: boolean;
  active: boolean;
  displays: number;
  widgets: number;
  error: string | null;
}

export type DesktopCommand = 'enable' | 'disable' | 'showManager' | 'showDesktop' | 'resetLayout' | 'quit';

export interface WallNoteAPI {
  getState(): Promise<AppState>;
  dispatch(action: Action): Promise<AppState>;
  importWallpapers(): Promise<{ state: AppState; count: number }>;
  applyWallpaper(id: string): Promise<AppState>;
  onStateChange(callback: (state: AppState) => void): () => void;
  getInfo(): Promise<AppInfo>;
  openDataFolder(): Promise<void>;
  exportBackup(): Promise<boolean>;
  restoreBackup(): Promise<AppState | null>;
  getDesktopStatus(): Promise<DesktopStatus>;
  desktopControl(command: DesktopCommand): Promise<DesktopStatus>;
  onDesktopStatus(callback: (status: DesktopStatus) => void): () => void;
  focusDesktopWidget(): void;
  manipulateDesktopWidget(mode: 'move' | 'resize'): void;
  finishDesktopManipulation(): void;
  windowAction(action: 'minimize' | 'maximize' | 'close'): void;
}
