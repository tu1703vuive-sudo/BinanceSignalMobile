@echo off
cd /d "%~dp0"
echo Dung bot Cloudflare binance-signal-paper. Khong xoa so lich su cu.
echo Dang dung tai khoan Wrangler da dang nhap tren may nay.
call npx --yes wrangler@4.163.0 deploy --config dung-bot-cu/wrangler.jsonc
if errorlevel 1 (
  echo Chua dung duoc bot. Xem loi phia tren.
  pause
  exit /b 1
)
echo Dang yeu cau Worker huy alarm con lai...
powershell -NoProfile -Command "try { $r = Invoke-RestMethod 'https://binance-signal-paper.tu1703vuive.workers.dev/health'; if ($r.stopped -ne $true) { throw 'Chua xac nhan stopped=true' }; Write-Host 'DA XAC NHAN: paper trading da dung.' } catch { Write-Host 'Da deploy nhung chua doc duoc xac nhan. Mo URL Worker de kiem tra stopped=true.'; exit 1 }"
if errorlevel 1 (
  pause
  exit /b 1
)
echo App v3.9.0 khong can Cloudflare hoac Vercel.
pause
