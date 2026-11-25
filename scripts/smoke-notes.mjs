import { chromium, expect } from '@playwright/test';
import { preview } from 'vite';
import { access, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

await mkdir('test-results', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
const candidates = [process.env.WALLNOTE_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath, browser;
for (const candidate of candidates) { try { await access(candidate); executablePath = candidate; break; } catch {} }
const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: '#628ae1' } }).png().toBuffer();
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const nav = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
  const panel = () => page.locator('.floating-note');
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('wallnote.preview.v1')));
  await page.goto('http://127.0.0.1:4175');
  await expect(page.getByRole('combobox', { name: '选择便签' }).locator('option')).toHaveCount(4);
  await page.getByRole('combobox', { name: '选择便签' }).selectOption({ label: '使用说明' });
  await expect(panel().getByRole('textbox', { name: '便签标题' })).toHaveValue('使用说明');
  await panel().getByRole('textbox', { name: '便签内容' }).fill('切换前的编辑内容');
  await panel().getByRole('button', { name: '新建便签', exact: true }).click();
  await panel().getByRole('textbox', { name: '便签标题' }).fill('图片与颜色');
  await panel().getByLabel('自定义便签背景色').fill('#24374b');
  await expect.poll(async () => (await state()).notes.find(note => note.title === '图片与颜色')?.backgroundColor).toBe('#24374b');
  await expect(panel().getByRole('textbox', { name: '便签标题' })).toHaveCSS('color', 'rgb(255, 255, 255)');
  await panel().getByLabel('插入便签图片').setInputFiles({ name: '插入.png', mimeType: 'image/png', buffer: png });
  await expect(panel().getByRole('img', { name: '插入.png' })).toBeVisible();
  await panel().getByRole('textbox', { name: '便签内容' }).evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)), data = new DataTransfer();
    data.items.add(new File([bytes], '粘贴.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await expect(panel().getByRole('img', { name: '粘贴.png' })).toBeVisible();
  await expect.poll(async () => (await state()).notes.find(note => note.title === '图片与颜色')?.images?.length).toBe(2);
  await panel().getByRole('combobox', { name: '选择便签' }).selectOption('welcome');
  await expect(panel().getByRole('textbox', { name: '便签内容' })).toHaveValue('切换前的编辑内容');
  await panel().getByRole('combobox', { name: '选择便签' }).selectOption({ label: '图片与颜色' });
  await page.reload();
  await expect(panel().getByRole('textbox', { name: '便签标题' })).toHaveValue('图片与颜色');
  await expect(panel().locator('.note-images img')).toHaveCount(2);
  await panel().getByRole('button', { name: '移除图片：插入.png' }).click();
  await expect(panel().locator('.note-images img')).toHaveCount(1);
  await page.getByRole('button', { name: '偏好设置', exact: true }).click();
  await page.getByRole('switch', { name: '毛玻璃背景' }).click();
  await nav('工作台').click();
  await expect(panel().locator('.frost-tint')).toHaveCSS('background-color', 'rgb(36, 55, 75)');
  await panel().getByRole('button', { name: '薄荷绿', exact: true }).click();
  await expect(panel().locator('.frost-tint')).toHaveCSS('background-color', 'rgb(234, 242, 231)');

  // A failed autosave must block navigation until the latest edit can be saved.
  await page.evaluate(() => { window.__setItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('测试保存失败'); }; });
  await panel().getByRole('textbox', { name: '便签内容' }).fill('失败后仍需保留的最新内容');
  await expect(panel().getByRole('alert')).toContainText('测试保存失败');
  await panel().getByRole('combobox', { name: '选择便签' }).selectOption('welcome');
  await expect(panel().getByRole('textbox', { name: '便签标题' })).toHaveValue('图片与颜色');
  await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; delete window.__setItem; });
  await panel().getByRole('combobox', { name: '选择便签' }).selectOption('welcome');
  await expect(panel().getByRole('textbox', { name: '便签标题' })).toHaveValue('使用说明');
  await panel().getByRole('combobox', { name: '选择便签' }).selectOption({ label: '图片与颜色' });
  await expect(panel().getByRole('textbox', { name: '便签内容' })).toHaveValue('失败后仍需保留的最新内容');

  await panel().getByRole('button', { name: '删除当前便签' }).click();
  await panel().getByRole('button', { name: '取消', exact: true }).click();
  await expect(panel().locator('.note-images img')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/note-controls.png', fullPage: true });
  while ((await state()).notes.length) {
    await panel().getByRole('button', { name: '删除当前便签' }).click();
    await panel().getByRole('button', { name: '确认删除便签' }).click();
  }
  await expect(page.locator('.empty-notes-panel').getByRole('button', { name: '新建便签' })).toBeVisible();
  await page.locator('.empty-notes-panel').getByRole('button', { name: '新建便签' }).click();
  await expect(panel().getByRole('textbox', { name: '便签标题' })).toHaveValue('新建便签');
  expect(errors).toEqual([]);
  console.log('Note UI passed: all titles, create/delete/empty state, color contrast and solid background, file/paste images, reload, text preservation and save-failure navigation guard.');
} finally { await browser?.close(); await new Promise(resolve => server.httpServer.close(resolve)); }
