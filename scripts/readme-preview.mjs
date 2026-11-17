import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { access, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

// Render the shared desktop components with isolated example data.
await mkdir('docs/images', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
const candidates = [process.env.WALLNOTE_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath;
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch { /* Use another installed browser. */ } }
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-11-17T09:41:00') });
  await page.goto('http://127.0.0.1:4175/?workspace=1');
  await page.locator('.calendar-grid').waitFor();
  await page.evaluate(() => {
    const key = 'wallnote.preview.v1';
    const state = JSON.parse(localStorage.getItem(key));
    const createdAt = new Date().toISOString();
    state.calendarDate = '2026-11-17';
    state.notes = [{ id: 'readme-note', title: '本周安排', content: '周三  14:00 项目讨论\n周五  提交工作总结\n\n出门记得带上充电器。', color: 'butter', pinned: true, updatedAt: createdAt }];
    state.tasks = [
      { id: 'readme-task-1', text: '整理会议记录', completed: false, priority: true, createdAt },
      { id: 'readme-task-2', text: '完成本周工作总结', completed: false, priority: false, createdAt },
      { id: 'readme-task-3', text: '备份项目文件', completed: false, priority: false, createdAt },
      { id: 'readme-task-4', text: '检查本周日程', completed: true, priority: false, createdAt },
    ];
    state.events = [
      { id: 'meeting', title: '项目讨论', date: '2026-11-17', start: '09:00', end: '10:30', description: '会议室 A · 确认本周任务', color: 'mint' },
      { id: 'review', title: '代码评审', date: '2026-11-17', start: '13:30', end: '14:30', description: '桌面日历模块', color: 'lavender' },
      { id: 'notes', title: '整理开发文档', date: '2026-11-17', start: '16:00', end: '17:00', description: '更新使用说明', color: 'sky' },
      { id: 'report', title: '提交工作总结', date: '2026-11-20', start: '16:00', end: '17:00', description: '', color: 'butter' },
      { id: 'next', title: '下周计划', date: '2026-11-23', start: '09:00', end: '09:30', description: '', color: 'mint' },
    ];
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.locator('.calendar-agenda').getByRole('button', { name: '编辑日程：项目讨论', exact: true }).waitFor();
  await page.evaluate(async () => {
    const image = new Image();
    image.src = './wallpapers/mist.jpg';
    await image.decode();
  });
  await sharp(await page.screenshot()).webp({ quality: 94 }).toFile('docs/images/desktop.webp');
  await sharp('public/icon.png').resize(96, 96).png().toFile('docs/images/icon.png');
  console.log('Updated README preview: calendar, hourly schedule, tasks and notes.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
