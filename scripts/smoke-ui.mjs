import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { access, mkdir } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
const candidates = [process.env.WALLNOTE_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath;
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch { /* Try the next installed browser. */ } }
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('让桌面');
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  expect(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBeTruthy();

  await page.getByRole('button', { name: '新建便签', exact: true }).click();
  await page.getByRole('textbox', { name: '便签标题' }).fill('验收测试便签');
  await page.getByRole('textbox', { name: '便签内容' }).fill('保存、编辑和重启后仍然存在。\n中文内容检查。');
  await page.getByRole('button', { name: '天空蓝', exact: true }).click();
  await page.getByRole('button', { name: '保存便签', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑便签：验收测试便签', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '编辑便签：验收测试便签', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '便签内容' })).toHaveValue(/重启后仍然存在/);
  await page.getByRole('textbox', { name: '便签内容' }).fill('修改后的内容');
  await page.getByRole('button', { name: '保存便签', exact: true }).click();

  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: '搜索关键词' }).fill('修改后的内容');
  await expect(page.getByRole('dialog').getByText('验收测试便签')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /待办清单/ }).click();
  await page.getByRole('textbox', { name: '新待办事项' }).fill('验证任务持久化');
  await page.getByRole('button', { name: '标记新任务为重要', exact: true }).click();
  await page.getByRole('button', { name: '添加待办', exact: true }).click();
  await page.getByRole('checkbox', { name: '验证任务持久化', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '验证任务持久化', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '编辑待办：验证任务持久化', exact: true }).click();
  await page.getByRole('textbox', { name: '编辑待办内容' }).fill('任务内容已编辑');
  await page.getByRole('button', { name: '保存待办', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /待办清单/ }).click();
  await expect(page.getByRole('checkbox', { name: '任务内容已编辑', exact: true })).toBeChecked();
  await page.screenshot({ path: 'test-results/tasks.png', fullPage: true });

  await page.getByRole('button', { name: '壁纸收藏馆', exact: true }).click();
  await expect(page.locator('.wallpaper-card')).toHaveCount(6);
  await page.getByRole('button', { name: '预览壁纸：日落之前', exact: true }).click();
  await page.getByRole('button', { name: '仅在工作台预览', exact: true }).click();
  await page.getByRole('button', { name: '我的工作台', exact: true }).click();
  await expect(page.locator('.wallpaper-hero h2')).toHaveText('日落之前');
  await page.getByRole('button', { name: '壁纸收藏馆', exact: true }).click();
  await page.getByRole('button', { name: '收藏壁纸：日落之前', exact: true }).click();
  await page.getByRole('button', { name: '我的喜欢', exact: true }).click();
  await expect(page.locator('.wallpaper-card')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/wallpapers.png', fullPage: true });

  await page.getByRole('button', { name: /桌面便签/ }).click();
  await page.getByRole('button', { name: '删除便签：验收测试便签', exact: true }).click();
  await page.getByRole('button', { name: '保留', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑便签：验收测试便签', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除便签：验收测试便签', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑便签：验收测试便签', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('switch', { name: '显示桌面待办' }).click();
  await expect(page.getByRole('switch', { name: '显示桌面待办' })).not.toBeChecked();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^WallNote-backup.*\.json$/);
  await page.screenshot({ path: 'test-results/settings.png', fullPage: true });

  await page.getByRole('button', { name: '我的工作台', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
  console.log('UI smoke passed: note CRUD + persistence, search, task edit/completion, wallpaper selection/favorites, backup download, responsive layout.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
