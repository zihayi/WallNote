import { describe, expect, it } from 'vitest';
import { activeDesktopNote, createInitialState, isValidState, reduceState } from '../shared/state';
import { MAX_NOTE_IMAGES, validNoteImages } from '../shared/note-images';

const image = { id: 'test-image', name: '截图.png', dataUrl: 'data:image/png;base64,aGVsbG8=' };

describe('note selection, appearance and images', () => {
  it('opens a hidden note by title/id without dropping its text or images', () => {
    const state = createInitialState();
    const edited = reduceState(state, { type: 'note:update', id: 'welcome', changes: { backgroundColor: '#123456', images: [image] } });
    const selected = reduceState(edited, { type: 'note:selectDesktop', id: 'welcome' });
    expect(activeDesktopNote(selected)).toMatchObject({ id: 'welcome', pinned: true, content: state.notes[0].content, backgroundColor: '#123456', images: [image] });
    expect(isValidState(selected)).toBe(true);
    expect(isValidState(JSON.parse(JSON.stringify(selected)))).toBe(true);
    expect(isValidState(reduceState(selected, { type: 'note:update', id: 'welcome', changes: { color: 'sky', backgroundColor: null } }))).toBe(true);
  });
  it('selects another note on deletion, then reaches the empty state without stale selection', () => {
    let state = reduceState(createInitialState(), { type: 'note:selectDesktop', id: 'welcome' });
    state = reduceState(state, { type: 'note:delete', id: 'welcome' });
    expect(activeDesktopNote(state)?.id).toBe('inspiration');
    state = reduceState(state, { type: 'note:delete', id: 'inspiration' });
    expect(activeDesktopNote(state)?.id).toBe('little-things');
    state = reduceState(state, { type: 'note:delete', id: 'little-things' });
    expect(state.notes).toEqual([]);
    expect(state.settings.activeDesktopNote).toBeUndefined();
    expect(activeDesktopNote(state)).toBeUndefined();
  });
  it('rejects invalid colors, remote/active images, duplicate IDs and image count overflow', () => {
    const state = createInitialState();
    expect(isValidState(reduceState(state, { type: 'note:update', id: 'welcome', changes: { backgroundColor: 'url(https://example.com)' } }))).toBe(false);
    for (const dataUrl of ['https://example.com/a.png', 'data:image/svg+xml;base64,YQ==', 'data:text/html;base64,YQ==', 'data:image/png;base64,??']) expect(validNoteImages([{ ...image, dataUrl }])).toBe(false);
    expect(validNoteImages([image, image])).toBe(false);
    expect(validNoteImages(Array.from({ length: MAX_NOTE_IMAGES + 1 }, (_, i) => ({ ...image, id: String(i) })))).toBe(false);
    expect(validNoteImages(undefined)).toBe(true);
    expect(validNoteImages([])).toBe(true);
  });
});
