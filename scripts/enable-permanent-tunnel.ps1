$ErrorActionPreference = 'Stop'
$exe = 'C:\Program Files\Tailscale\tailscale.exe'
$exe86 = 'C:\Program Files (x86)\Tailscale\tailscale.exe'

Write-Host ''
Write-Host '  Monet Chat - 一次性启用永久公网地址' -ForegroundColor Cyan
Write-Host '  之后每次打开应用都会自动复用这个地址。' -ForegroundColor DarkGray
Write-Host ''

if (-not (Test-Path $exe) -and -not (Test-Path $exe86)) {
  Write-Host '未检测到 Tailscale，正在通过 winget 安装...' -ForegroundColor Yellow
  winget install --id Tailscale.Tailscale -e --accept-package-agreements --accept-source-agreements
  for ($i = 0; $i -lt 30; $i++) {
    if ((Test-Path $exe) -or (Test-Path $exe86)) { break }
    Start-Sleep -Seconds 2
  }
}

if (-not (Test-Path $exe) -and -not (Test-Path $exe86)) {
  Write-Host '安装未完成。请从 https://tailscale.com/download/windows 手动安装后重跑本脚本。' -ForegroundColor Red
  Read-Host '按回车退出'
  exit 1
}

$ts = if (Test-Path $exe) { $exe } else { $exe86 }
Write-Host '正在登录 Tailscale（会打开浏览器）...' -ForegroundColor Yellow
& $ts up

Write-Host ''
Write-Host '登录完成后，关闭本窗口，重启 Monet Chat。' -ForegroundColor Green
Write-Host '应用会自动启用 Tailscale Funnel，并在“设置 -> 网络”显示永久地址。' -ForegroundColor Green
Read-Host '按回车退出'
