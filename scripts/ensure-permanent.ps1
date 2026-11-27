param([switch]$Loop)
$ErrorActionPreference = 'SilentlyContinue'
$root = 'D:\OneDrive\Documents\deepseek-harness\default-workspace\monet-chat'
$ts = 'C:\Program Files\Tailscale\tailscale.exe'

do {
  $healthy = $false
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:4175/api/health' -TimeoutSec 3
    if ($h.ok) { $healthy = $true }
  } catch {}

  if (-not $healthy) {
    Start-Process -FilePath "$root\scripts\permanent-server.cmd" -WindowStyle Hidden
    Start-Sleep -Seconds 5
  }

  if (Test-Path $ts) {
    $status = & $ts funnel status 2>&1 | Out-String
    if ($status -notmatch 'proxy http://127\.0\.0\.1:4175') {
      & $ts funnel --bg --https=443 http://127.0.0.1:4175 2>&1 | Out-Null
    }
  }

  if ($Loop) { Start-Sleep -Seconds 120 }
} while ($Loop)
