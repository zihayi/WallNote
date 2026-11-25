export type NoteColor = 'butter' | 'lavender' | 'mint' | 'rose' | 'sky';
import type { CommunityView, CommunitySettings } from './community';
import type { ModuleFlag, ModuleId, ModuleSlots } from './modules';
import type { DockFrame, DockFrames, DragMode, Guides, LayoutDisplay } from './snap-layout';
import type { DrawerView, DrawerPoint } from './drawer';
export type Page = 'dashboard' | 'wallpapers' | 'notes' | 'tasks' | 'calendar' | 'settings' | 'community';

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  backgroundColor?: string | null;
  images?: NoteImage[];
  pinned: boolean;
  updatedAt: string;
  position?: { x: number; y: number; width: number; height: number };
}

export interface NoteImage { id: string; name: string; dataUrl: string }

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
    moduleSlots?: ModuleSlots; hideIconsWithDrawer?: boolean; drawerMenuMode?: 'windows'|'quick';
    canvasModules?: ModuleId[]; dockFrames?: DockFrames; layoutSnap?: boolean;
    floatingFrames?: DockFrames;
    moduleDisplayId?: number;
    glassEnabled?: boolean;
    topmostWidgets?: string[];
    layoutVersion?: number;
    activeDesktopNote?: string;
  } & Partial<Record<ModuleFlag,boolean> & Record<`${ModuleId}Position`,Note['position']>>;
}

export type Action =
  | { type: 'note:add'; note: Note }
  | { type: 'note:update'; id: string; changes: Partial<Pick<Note, 'title' | 'content' | 'color' | 'backgroundColor' | 'images' | 'pinned' | 'position'>> }
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
  | { type: 'layout:place'; id: ModuleId; frame: DockFrame; floating?: boolean }
  | { type: 'layout:apply'; ids: ModuleId[]; frames: DockFrames; snap?: boolean }
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

export type DesktopCommand = 'enable' | 'disable' | 'showManager' | 'showPhoneSync' | 'showCommunity' | 'showDesktop' | 'resetLayout' | 'quit';

export interface WallNoteAPI {
  copyNoteImage(dataUrl: string): Promise<void>;
  getDrawer(): Promise<DrawerView>;
  refreshDrawer(): Promise<DrawerView>;
  openDrawerItem(id: string, reveal?: boolean): Promise<void>;
  showDrawerMenu(id: string, anchor: DrawerPoint, extended: boolean,ticket?:string): Promise<void>;
  prepareDrawerMenu(id:string,ticket:string): Promise<void>;
  discardDrawerMenu(ticket:string): Promise<void>;
  drawerIcon(id: string): Promise<string>;
  setDrawerIcons(hide: boolean): Promise<void>;
  onDrawer(callback: (view: DrawerView) => void): () => void;
  getCommunity(): Promise<CommunityView>;
  configureCommunity(settings: CommunitySettings): Promise<CommunityView>;
  setCommunityKey(key: string | null): Promise<CommunityView>;
  refreshCommunity(): Promise<CommunityView>;
  communityItem(action: 'open' | 'task', day: string, id: string): Promise<void>;
  onCommunity(callback: (view: CommunityView) => void): () => void;
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
  getLayoutDisplays(): Promise<LayoutDisplay[]>;
  onLayoutDisplaysChange(callback:(displays:LayoutDisplay[])=>void):()=>void;
  switchModuleDisplay(displayId:number):Promise<void>;
  onLayoutGuides(callback: (guides: Guides) => void): () => void;
  onLayoutSaveError(callback: () => void): () => void;
  manipulateDesktopWidget(mode: DragMode, anchor: {x:number;y:number}, bypass: boolean): void;
  finishDesktopManipulation(cancel?: boolean): void;
  windowAction(action: 'minimize' | 'maximize' | 'close'): void;
}
