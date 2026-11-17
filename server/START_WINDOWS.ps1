Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Can cai Node.js 24+ tu nodejs.org truoc.' }
if (-not (Test-Path 'node_modules')) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } }
if (-not (Test-Path '.env')) { node setup.cjs; Write-Host 'Sua server/.env truoc khi cong khai may chu; file chua ma ket noi rieng.' }
while ($true) { npm start; Write-Host 'Bot stopped. Restarting after 5 seconds...'; Start-Sleep -Seconds 5 }
