import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { access, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

// Render the real components with isolated sample data, without capturing the user's desktop.
await mkdir('docs/images', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
const candidates = [process.env.WALLNOTE_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try { await access(candidate); executablePath = candidate; break; } catch { /* Use another installed browser. */ }
}
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const background = await context.newPage();
  await background.clock.install({ time: new Date('2026-11-17T09:41:00') });
  await background.goto('http://127.0.0.1:4175/?wallpaper=1');
  await background.locator('.desktop-wallpaper img').waitFor();
  await background.evaluate(() => {
    const key = 'wallnote.preview.v1';
    const state = JSON.parse(localStorage.getItem(key));
    const date = new Date().toISOString();
    state.notes = [{ id: 'readme-note', title: '本周安排', content: '周三  14:00 项目讨论\n周五  提交工作总结\n\n出门记得带上充电器。', color: 'butter', pinned: false, updatedAt: date }];
    state.tasks = [
      { id: 'readme-task-1', text: '整理会议记录', completed: false, priority: true, createdAt: date },
      { id: 'readme-task-2', text: '完成本周工作总结', completed: false, priority: false, createdAt: date },
      { id: 'readme-task-3', text: '备份项目文件', completed: false, priority: false, createdAt: date },
      { id: 'readme-task-4', text: '检查本周日程', completed: true, priority: false, createdAt: date },
    ];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await background.locator('.desktop-wallpaper img').evaluate(async image => { await image.decode(); });
  const wallpaper = await background.screenshot();
  const tasks = await context.newPage();
  await tasks.setViewportSize({ width: 320, height: 380 });
  await tasks.goto('http://127.0.0.1:4175/?widget=tasks');
  await tasks.getByRole('checkbox', { name: '整理会议记录' }).waitFor();
  const taskImage = await tasks.screenshot();
  const note = await context.newPage();
  await note.setViewportSize({ width: 320, height: 310 });
  await note.goto('http://127.0.0.1:4175/?note=readme-note');
  await note.getByRole('textbox', { name: '便签标题' }).waitFor();
  const noteImage = await note.screenshot();
  await sharp(wallpaper).composite([
    { input: taskImage, left: 1250, top: 40 },
    { input: noteImage, left: 1250, top: 445 },
  ]).webp({ quality: 92 }).toFile('docs/images/desktop.webp');
  await sharp('public/icon.png').resize(96, 96).png().toFile('docs/images/icon.png');
  console.log('README images generated in docs/images/.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
