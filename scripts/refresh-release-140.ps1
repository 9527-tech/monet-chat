$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$cred = "protocol=https`nhost=github.com`n`n" | & '.\toolchain\git\cmd\git.exe' credential fill
$token = (($cred -split "`n") | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
if (-not $token) { throw 'No GitHub token from credential helper' }

$releaseId = '461344184'
$repo = '9527-tech/monet-chat'
$api = "https://api.github.com/repos/$repo/releases/$releaseId"
$headers = @{ Authorization = "Bearer $token"; 'User-Agent' = 'monet-chat-release'; Accept = 'application/vnd.github+json' }

$assets = @(
  @{ Name = 'MonetChat-1.4.0.apk'; Path = 'release\MonetChat-1.4.0.apk'; Type = 'application/vnd.android.package-archive' },
  @{ Name = 'MonetChat-Setup-1.4.0.exe'; Path = 'release\MonetChat-Setup-1.4.0.exe'; Type = 'application/octet-stream' },
  @{ Name = 'MonetChat-Portable-1.4.0.exe'; Path = 'release\MonetChat-Portable-1.4.0.exe'; Type = 'application/octet-stream' },
  @{ Name = 'MonetChat-1.4.0-linux-x64.tar.gz'; Path = 'release\MonetChat-1.4.0-linux-x64.tar.gz'; Type = 'application/gzip' },
  @{ Name = 'monet-chat-1.4.0-source.zip'; Path = 'release\monet-chat-1.4.0-source.zip'; Type = 'application/zip' },
  @{ Name = 'SHA256SUMS-1.4.0.txt'; Path = 'release\SHA256SUMS-1.4.0.txt'; Type = 'text/plain' }
)

# Refresh checksum manifest from the final files
$lines = foreach ($a in $assets) {
  if ($a.Name -eq 'SHA256SUMS-1.4.0.txt') { continue }
  $h = (Get-FileHash -LiteralPath $a.Path -Algorithm SHA256).Hash
  "$h  $($a.Name)"
}
Set-Content -LiteralPath 'release\SHA256SUMS-1.4.0.txt' -Value $lines -Encoding ascii
Write-Output '--- final checksums ---'
Get-Content 'release\SHA256SUMS-1.4.0.txt'

$existing = Invoke-RestMethod -Uri "$api/assets" -Headers $headers
foreach ($e in $existing) {
  if ($assets.Name -contains $e.name) {
    Write-Output "delete $($e.name) id=$($e.id)"
    Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/$repo/releases/assets/$($e.id)" -Headers $headers
  }
}

foreach ($a in $assets) {
  $size = (Get-Item -LiteralPath $a.Path).Length
  Write-Output "upload $($a.Name) ($size bytes)"
  & curl.exe -sS --fail-with-body --max-time 1200 -X POST `
    -H "Authorization: Bearer $token" `
    -H 'User-Agent: monet-chat-release' `
    -H "Content-Type: $($a.Type)" `
    --data-binary "@$($a.Path)" `
    "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=$($a.Name)" `
    -o "release\upload-$($a.Name).json"
  if ($LASTEXITCODE -ne 0) { throw "upload failed: $($a.Name)" }
  $u = Get-Content "release\upload-$($a.Name).json" -Raw | ConvertFrom-Json
  Write-Output "  ok id=$($u.id) size=$($u.size) state=$($u.state)"
}
Write-Output 'ALL DONE'
