# Opt-in, Windows only. Use a clean test account. Exercises the real NSIS package,
# its HKCU registration and shortcuts; the app itself uses synthetic loopback data.
param([string]$ScratchParent = [IO.Path]::GetTempPath())
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json).version
$setup = Join-Path $root "release\WallNote-Setup-$version-x64.exe"
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash
if ((Get-Content -LiteralPath "$setup.sha256" -Raw).Trim().Split(' ')[0] -ne $hash) { throw 'Installer checksum mismatch.' }

# Derived by electron-builder from the stable com.wallnote.desktop appId.
$id = 'f533a343-ad66-53bc-8e34-d161c5b5f792'
$arp = "Software\Microsoft\Windows\CurrentVersion\Uninstall\$id"
$registration = "HKCU:\$arp"
$links = @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('DesktopDirectory')) | ForEach-Object { Join-Path $_ 'WallNote.lnk' }
$cache = Join-Path $env:LOCALAPPDATA 'wallnote-updater\installer.exe'
foreach ($path in @("HKCU:\Software\$id", "HKLM:\Software\$id", $registration, "HKLM:\$arp", $cache) + $links) {
  if (Test-Path -LiteralPath $path) { throw "Existing install/shortcut/cache: use a clean account ($path)." }
}
# NSIS uses a directory-scoped process check when PowerShell/CIM is available.
# If its fallback would identify programs by exe name, don't test alongside another copy.
if (Get-Process -Name WallNote -ErrorAction SilentlyContinue) {
  foreach ($system in @('System32', 'SysWOW64')) {
    $ps = Join-Path $env:WINDIR "$system\WindowsPowerShell\v1.0\powershell.exe"
    & $ps -NoProfile -NonInteractive -Command "if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue) -or (Get-ExecutionPolicy -Scope Process) -eq 'Restricted') {exit 1}"
    if ($LASTEXITCODE) { throw 'Close WallNote or use a clean Windows account for the installer test.' }
  }
}
$work = Join-Path (Resolve-Path -LiteralPath $ScratchParent).Path ('wallnote-install-' + [guid]::NewGuid().ToString('N'))
$dir = Join-Path $work 'WallNote'
$exe = Join-Path $dir 'WallNote.exe'
$uninstall = Join-Path $dir 'Uninstall WallNote.exe'
$oldTemp, $oldTmp, $oldBinary = $env:TEMP, $env:TMP, $env:WALLNOTE_TEST_INSTALLED_EXE
$null = New-Item -ItemType Directory -Path $work
function Invoke-Setup([string]$file, [string]$arguments) {
  $p = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -Wait
  if ($p.ExitCode -ne 0) { throw "Installer step failed ($($p.ExitCode)): $file" }
}
try {
  $env:TEMP = $work; $env:TMP = $work
  Invoke-Setup $setup "/S /currentuser /D=$dir"
  $record = Get-ItemProperty -LiteralPath $registration
  if ($record.DisplayName -ne 'WallNote' -or $record.DisplayVersion -ne $version -or $record.UninstallString -notlike "*${uninstall}*") { throw 'Invalid Apps & features entry.' }
  foreach ($file in @($exe, $uninstall, (Join-Path $dir 'resources\native\WallNote.DesktopHost.exe'), (Join-Path $dir 'resources\native\CalendarBridge.Receiver.exe'))) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing installed file: $file" }
  }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($link in $links) {
    if (!(Test-Path -LiteralPath $link) -or $shell.CreateShortcut($link).TargetPath -ne $exe) { throw "Invalid shortcut: $link" }
  }
  $env:WALLNOTE_TEST_INSTALLED_EXE = $exe
  & node (Join-Path $PSScriptRoot 'smoke-wifi.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Installed app or its bundled receiver failed.' }
  Invoke-Setup $setup "/S /currentuser /D=$dir"
  if (!(Test-Path -LiteralPath $exe) -or (Get-ItemProperty -LiteralPath $registration).DisplayVersion -ne $version) { throw 'In-place reinstall failed.' }
} finally {
  try {
    if ((Test-Path -LiteralPath $uninstall) -and (Get-ItemProperty -LiteralPath "HKCU:\Software\$id" -ErrorAction SilentlyContinue).InstallLocation -eq $dir) {
      Invoke-Setup $uninstall "/S /currentuser _?=$dir"
    }
    if ((Test-Path -LiteralPath $registration) -or (Test-Path -LiteralPath $exe) -or @($links | Where-Object { Test-Path -LiteralPath $_ }).Count) { throw 'Uninstall left registered application files or shortcuts.' }
    if ((Test-Path -LiteralPath $cache) -and (Get-FileHash -LiteralPath $cache -Algorithm SHA256).Hash -eq $hash) { Remove-Item -LiteralPath $cache -Force }
  } finally {
    $env:TEMP = $oldTemp; $env:TMP = $oldTmp; $env:WALLNOTE_TEST_INSTALLED_EXE = $oldBinary
    if (!(Test-Path -LiteralPath $registration)) { Remove-Item -LiteralPath $work -Recurse -Force }
  }
}
"Windows installer $version passed: current-user install, shortcuts, Apps & features, installed app and loopback receiver, reinstall and uninstall."
