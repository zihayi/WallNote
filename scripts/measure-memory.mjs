import { _electron as electron, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configureEnvironment } from './environment.mjs';

configureEnvironment();
await mkdir('test-results', { recursive: true });
const label = (process.argv[2] || 'current').replace(/[^a-z0-9_-]/gi, '');
const profile = await mkdtemp(path.resolve('test-results', 'memory-profile-'));
const env = { ...process.env, WALLNOTE_DATA_DIR: profile, WALLNOTE_SHOW_MANAGER: '0' };
delete env.VITE_DEV_SERVER_URL;
let app;
try {
  app = await electron.launch({ ...(process.argv.includes('--packaged') ? { executablePath: path.resolve('release/win-unpacked/WallNote.exe'), args: [] } : { args: ['.'] }), env, timeout: 60000 });
  const page = await app.firstWindow();
  await expect.poll(() => page.evaluate(() => window.wallnote?.getDesktopStatus()), { timeout: 30000 }).toMatchObject({ active: true, widgets: 4, error: null });
  await new Promise(resolve => setTimeout(resolve, 6000));
  const metadata = await app.evaluate(({ BrowserWindow, screen }) => ({ root: process.pid, displays: screen.getAllDisplays().length, renderers: BrowserWindow.getAllWindows().map(window => ({ id: window.id, renderer: window.webContents.mainFrame.processId, query: new URL(window.webContents.getURL()).search })) }));
  const command = `$all = @(Get-CimInstance Win32_Process); $ids = New-Object 'System.Collections.Generic.HashSet[int]'; [void]$ids.Add(${metadata.root}); do { $changed = $false; foreach ($item in $all) { if ($ids.Contains([int]$item.ParentProcessId) -and -not $ids.Contains([int]$item.ProcessId)) { [void]$ids.Add([int]$item.ProcessId); $changed = $true } } } while ($changed); $rows = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p -and ($_.Name -ne 'WallNote.DesktopHost.exe' -or $_.CommandLine -match ' bridge ')) { $kind = if ($_.Name -eq 'WallNote.DesktopHost.exe') { 'Native' } elseif ($_.CommandLine -match '--type=renderer') { 'Renderer' } elseif ($_.CommandLine -match '--type=gpu-process') { 'GPU' } elseif ($_.CommandLine -match '--type=utility') { 'Utility' } else { 'Main' }; [pscustomobject]@{ pid=$_.ProcessId; kind=$kind; workingSetMB=[math]::Round($p.WorkingSet64/1MB,1); privateMB=[math]::Round($p.PrivateMemorySize64/1MB,1) } } }); ConvertTo-Json -InputObject $rows -Compress`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  const processes = JSON.parse(stdout);
  const report = { label, displays: metadata.displays, rendererCount: processes.filter(item => item.kind === 'Renderer').length, totals: { workingSetMB: Math.round(processes.reduce((sum, item) => sum + item.workingSetMB, 0) * 10) / 10, privateMB: Math.round(processes.reduce((sum, item) => sum + item.privateMB, 0) * 10) / 10 }, processes, windows: metadata.renderers };
  await writeFile(`test-results/memory-${label}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await app?.close(); }
