import type { NoteImage } from './types';

export const MAX_NOTE_IMAGES = 8;
export const MAX_IMAGE_DATA = 2 * 1024 * 1024;
export const MAX_NOTE_IMAGE_DATA = 8 * 1024 * 1024;
export const MAX_TOTAL_NOTE_IMAGE_DATA = 64 * 1024 * 1024;

export function validImageData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_IMAGE_DATA && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}

export function validNoteImages(value: unknown): value is NoteImage[] | undefined {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_NOTE_IMAGES) return false;
  let size = 0;
  const ids = new Set<string>();
  return value.every(image => {
    if (!image || typeof image !== 'object' || typeof image.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(image.id) || ids.has(image.id) || typeof image.name !== 'string' || image.name.length > 200 || !validImageData(image.dataUrl)) return false;
    ids.add(image.id); size += image.dataUrl.length;
    return size <= MAX_NOTE_IMAGE_DATA;
  });
}
