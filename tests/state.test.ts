import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { allWallpapers, builtInWallpapers, createInitialState, createNote, createTask, isValidState, reduceState } from '../shared/state';
import { StateStore } from '../electron/store';

const directories: string[] = [];
async function createStore() {
  const root = path.resolve('test-results');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'store-'));
  directories.push(directory);
  return new StateStore(directory);
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('state integrity', () => {
  it('initial state and supported mutations always remain valid', () => {
    let state = createInitialState();
    expect(isValidState(state)).toBe(true);
    const note = createNote();
    state = reduceState(state, { type: 'note:add', note });
    state = reduceState(state, { type: 'note:update', id: note.id, changes: { title: '新灵感', color: 'sky', pinned: true } });
    const task = createTask('  完成验证  ');
    state = reduceState(state, { type: 'task:add', task });
    state = reduceState(state, { type: 'task:toggle', id: task.id });
    expect(state.notes[0].title).toBe('新灵感');
    expect(state.tasks[0]).toMatchObject({ text: '完成验证', completed: true });
    expect(isValidState(state)).toBe(true);
  });

  it('does not drop concurrent edits to different fields or records', () => {
    const state = createInitialState();
    const moved = reduceState(state, { type: 'note:update', id: 'welcome', changes: { position: { x: 25, y: 50, width: 320, height: 310 } } });
    expect(moved.notes[0].updatedAt).toBe(state.notes[0].updatedAt);
    const edited = reduceState(moved, { type: 'note:update', id: 'welcome', changes: { content: 'Updated text' } });
    expect(edited.notes[0].position).toEqual({ x: 25, y: 50, width: 320, height: 310 });
    expect(edited.notes[1]).toEqual(state.notes[1]);
  });

  it('repairs wallpaper references when an imported wallpaper is deleted', () => {
    const state = createInitialState();
    state.wallpapers.push({ id: 'custom', name: 'Local', description: '', category: 'imported', file: 'custom.jpg', colors: [] });
    state.selectedWallpaperId = 'custom'; state.appliedWallpaperId = 'custom'; state.favorites.push('custom');
    const next = reduceState(state, { type: 'wallpaper:delete', id: 'custom' });
    expect(next.selectedWallpaperId).toBe('mist');
    expect(next.appliedWallpaperId).toBeNull();
    expect(next.favorites).not.toContain('custom');
    expect(allWallpapers(next)).toEqual(builtInWallpapers);
    expect(isValidState(next)).toBe(true);
  });

  it('rejects malformed backups, duplicate IDs, and path traversal', () => {
    expect(isValidState(null)).toBe(false);
    expect(isValidState({ version: 1, notes: [null], tasks: [], wallpapers: [], favorites: [] })).toBe(false);
    const duplicate = createInitialState(); duplicate.notes.push(duplicate.notes[0]);
    expect(isValidState(duplicate)).toBe(false);
    const traversal = createInitialState();
    traversal.wallpapers.push({ id: 'evil', name: 'Bad', category: 'imported', description: '', file: '../state.json', colors: [] });
    expect(isValidState(traversal)).toBe(false);
    const overflow = createInitialState(); overflow.notes[0].content = 'a'.repeat(50001);
    expect(isValidState(overflow)).toBe(false);
    const invalidBounds = createInitialState(); invalidBounds.notes[0].position = { x: NaN, y: 0, width: 300, height: 300 };
    expect(isValidState(invalidBounds)).toBe(false);
  });

  it('clears completed tasks without removing pending tasks', () => {
    const state = createInitialState();
    const next = reduceState(state, { type: 'task:clearCompleted' });
    expect(next.tasks).toEqual(state.tasks.filter(task => !task.completed));
    expect(state.tasks).toHaveLength(4);
  });

  it('accepts older backups and validates desktop-mode settings', () => {
    const old = createInitialState();
    delete old.settings.desktopEnabled; delete old.settings.showDesktopTasks;
    expect(isValidState(old)).toBe(true);
    const current = reduceState(old, { type: 'settings:update', changes: { desktopEnabled: true, showDesktopTasks: false, tasksPosition: { x: -500, y: 50, width: 320, height: 380 } } });
    expect(isValidState(current)).toBe(true);
    expect(isValidState({ ...current, settings: { ...current.settings, desktopEnabled: 'yes' } })).toBe(false);
    expect(isValidState({ ...current, settings: { ...current.settings, tasksPosition: { x: 0, y: 0, width: -1, height: 100 } } })).toBe(false);
  });
});

describe('durable local store', () => {
  it('persists note edits and positions across restarts', async () => {
    const first = await createStore(); await first.load();
    const next = reduceState(first.state, { type: 'note:update', id: 'welcome', changes: { content: '恢复后仍然在', backgroundColor: '#123456', images: [{ id: 'image', name: '截图.png', dataUrl: 'data:image/png;base64,aGVsbG8=' }], pinned: true, position: { x: 50, y: 70, width: 350, height: 400 } } });
    await first.save(next);
    const second = new StateStore(first.directory); await second.load();
    expect(second.state).toEqual(next);
    expect(await fs.readdir(first.directory)).toEqual(['state.json']);
  });

  it('preserves the previous file if a save is rejected', async () => {
    const store = await createStore(); await store.load();
    const before = await fs.readFile(store.file, 'utf8');
    await expect(store.save({ ...store.state, version: 2 } as unknown as typeof store.state)).rejects.toThrow();
    expect(await fs.readFile(store.file, 'utf8')).toBe(before);
  });

  it('preserves corrupt data in a recovery file instead of destroying it', async () => {
    const store = await createStore();
    await fs.writeFile(store.file, '{broken user data', 'utf8');
    const recovery = await store.load();
    expect(recovery).toBeTruthy();
    expect(await fs.readFile(recovery!, 'utf8')).toBe('{broken user data');
    expect(isValidState(store.state)).toBe(true);
    expect(JSON.parse(await fs.readFile(store.file, 'utf8'))).toEqual(store.state);
  });
});
