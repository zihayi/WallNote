import { nativeImage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Wallpaper } from '../shared/types';

// A blurred thumbnail is shared by all widgets. Avoid allocating a full-screen GPU blur
// surface in every transparent window on every repaint.
export class WallpaperCache {
  private pending = new Map<string, Promise<string>>();
  constructor(private directory: string, private source: (wallpaper: Wallpaper) => string) {}

  blur(wallpaper: Wallpaper): Promise<string> {
    const previous = this.pending.get(wallpaper.id);
    if (previous) return previous;
    const result = this.prepare(wallpaper).catch(error => { this.pending.delete(wallpaper.id); throw error; });
    this.pending.set(wallpaper.id, result);
    return result;
  }

  private async prepare(wallpaper: Wallpaper): Promise<string> {
    const file = path.join(this.directory, `${wallpaper.id}-blur-v1.jpg`);
    try { await fs.access(file); return file; } catch { /* Generate only once. */ }
    await fs.mkdir(this.directory, { recursive: true });
    const image = nativeImage.createFromBuffer(await fs.readFile(this.source(wallpaper)));
    if (image.isEmpty()) throw new Error('无法读取壁纸图片。');
    const original = image.getSize();
    const width = Math.min(640, original.width);
    const small = image.resize({ width, quality: 'best' });
    const size = small.getSize();
    const bitmap = small.toBitmap();
    const temporary = Buffer.allocUnsafe(bitmap.length);
    const radius = Math.max(2, Math.round(width / 640 * 8));
    for (let pass = 0; pass < 3; pass++) {
      boxBlur(bitmap, temporary, size.width, size.height, radius, true);
      boxBlur(temporary, bitmap, size.width, size.height, radius, false);
    }
    const blurred = nativeImage.createFromBitmap(bitmap, size).toJPEG(88);
    const staging = `${file}.tmp`;
    await fs.writeFile(staging, blurred);
    await fs.rename(staging, file);
    return file;
  }

  async remove(id: string) {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    if (pending) await pending.catch(() => undefined);
    await fs.unlink(path.join(this.directory, `${id}-blur-v1.jpg`)).catch(() => undefined);
  }
}

function boxBlur(input: Buffer, output: Buffer, width: number, height: number, radius: number, horizontal: boolean) {
  const lines = horizontal ? height : width, length = horizontal ? width : height;
  const step = horizontal ? 4 : width * 4, row = horizontal ? width * 4 : 4;
  const count = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const start = line * row;
    let blue = 0, green = 0, red = 0;
    for (let i = -radius; i <= radius; i++) {
      const offset = start + Math.max(0, Math.min(length - 1, i)) * step;
      blue += input[offset]; green += input[offset + 1]; red += input[offset + 2];
    }
    for (let i = 0; i < length; i++) {
      const offset = start + i * step;
      output[offset] = Math.round(blue / count); output[offset + 1] = Math.round(green / count); output[offset + 2] = Math.round(red / count); output[offset + 3] = 255;
      const leave = start + Math.max(0, i - radius) * step;
      const enter = start + Math.min(length - 1, i + radius + 1) * step;
      blue += input[enter] - input[leave]; green += input[enter + 1] - input[leave + 1]; red += input[enter + 2] - input[leave + 2];
    }
  }
}
