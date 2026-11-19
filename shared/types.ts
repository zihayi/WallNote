export type NoteColor = 'butter' | 'lavender' | 'mint' | 'rose' | 'sky';
export type Page = 'dashboard' | 'wallpapers' | 'notes' | 'tasks' | 'calendar' | 'settings';

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

export interface ScheduleEvent {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  description: string;
  color: NoteColor;
  phone?: { eventId: string; clientId: string; revision: string; calendarName: string; readOnly: boolean; reason: string; location?: string };
}

export interface PhoneSyncItem {
  state: 'queued' | 'delivered' | 'synced' | 'failed' | 'uncertain' | 'changed' | 'conflict';
  message: string;
  linked: boolean;
  revision?: string;
}
export interface PhoneSyncView {
  configured: boolean;
  connected: boolean;
  phoneOnline: boolean;
  canWrite: boolean;
  device: string;
  lastSync: string | null;
  calendarId: string | null;
  calendars: { id: string; name: string; writable: boolean }[];
  pending: number;
  error: string | null;
  items: Record<string, PhoneSyncItem>;
}

export interface WifiReceiverView {
  running: boolean;
  discoveryAvailable: boolean;
  discoveryPort: number;
  pairingUntil: number;
  requests: { id: string; device: string; code: string; expires: number }[];
  error: string | null;
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
  events?: ScheduleEvent[];
  phoneEvents?: ScheduleEvent[];
  phoneSync?: PhoneSyncView;
  calendarDate?: string;
  wallpapers: Wallpaper[];
  favorites: string[];
  selectedWallpaperId: string;
  appliedWallpaperId: string | null;
  settings: {
    alwaysOnTop: boolean; launchAtLogin: boolean; desktopEnabled?: boolean;
    showDesktopTasks?: boolean; showDesktopCalendar?: boolean; showDesktopSchedule?: boolean; showDesktopNotes?: boolean;
    glassEnabled?: boolean;
    topmostWidgets?: string[];
    layoutVersion?: number;
    activeDesktopNote?: string;
    tasksPosition?: Note['position']; calendarPosition?: Note['position']; schedulePosition?: Note['position']; notesPosition?: Note['position'];
  };
}

export type Action =
  | { type: 'note:add'; note: Note }
  | { type: 'note:update'; id: string; changes: Partial<Pick<Note, 'title' | 'content' | 'color' | 'pinned' | 'position'>> }
  | { type: 'note:delete'; id: string }
  | { type: 'note:selectDesktop'; id: string }
  | { type: 'task:add'; task: Task }
  | { type: 'task:toggle'; id: string }
  | { type: 'task:priority'; id: string }
  | { type: 'task:update'; id: string; text: string }
  | { type: 'task:delete'; id: string }
  | { type: 'task:clearCompleted' }
  | { type: 'event:add'; event: ScheduleEvent }
  | { type: 'event:update'; id: string; changes: Partial<Omit<ScheduleEvent, 'id' | 'phone'>>; expectedRevision?: string }
  | { type: 'event:delete'; id: string }
  | { type: 'calendar:select'; date: string }
  | { type: 'widget:topmost'; key: string; enabled: boolean }
  | { type: 'wallpaper:favorite'; id: string }
  | { type: 'wallpaper:select'; id: string }
  | { type: 'wallpaper:delete'; id: string }
  | { type: 'settings:update'; changes: Partial<AppState['settings']> };

export interface AppInfo { version: string; platform: string; dataPath: string; desktop: boolean; supportsLaunchAtLogin: boolean }

export type EventEditorRequest = { id: string } | { date: string; hour: number };
export interface EventEditorData { event: ScheduleEvent; existing: boolean; phoneSync?: PhoneSyncView }

export interface DesktopStatus {
  enabled: boolean;
  active: boolean;
  displays: number;
  widgets: number;
  error: string | null;
}

export interface DesktopSurface {
  bounds: { x: number; y: number; width: number; height: number };
  display: { x: number; y: number; width: number; height: number };
  topmost: boolean;
}

export type DesktopCommand = 'enable' | 'disable' | 'showManager' | 'showPhoneSync' | 'showDesktop' | 'resetLayout' | 'quit';

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
  phoneSyncControl(command: 'connect' | 'refresh' | 'disconnect' | 'calendar', calendarId?: string): Promise<PhoneSyncView>;
  wifiReceiverControl(command: 'status' | 'pair' | 'approve' | 'reject', id?: string): Promise<WifiReceiverView>;
  sendEventToPhone(id: string, expectedRevision?: string): Promise<PhoneSyncView>;
  openDesktopEventEditor(request: EventEditorRequest): Promise<boolean>;
  getEventEditorData(): Promise<EventEditorData>;
  onEditorCloseRequest(callback: () => void): () => void;
  finishEventEditor(): void;
  getDesktopStatus(): Promise<DesktopStatus>;
  desktopControl(command: DesktopCommand): Promise<DesktopStatus>;
  onDesktopStatus(callback: (status: DesktopStatus) => void): () => void;
  getDesktopSurface(): Promise<DesktopSurface | null>;
  onDesktopSurface(callback: (surface: DesktopSurface) => void): () => void;
  focusDesktopWidget(): void;
  manipulateDesktopWidget(mode: 'move' | 'resize'): void;
  finishDesktopManipulation(): void;
  windowAction(action: 'minimize' | 'maximize' | 'close'): void;
}
