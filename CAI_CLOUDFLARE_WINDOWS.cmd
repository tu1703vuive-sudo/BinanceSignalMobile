@echo off
chcp 65001 >nul
cd /d "%~dp0cloudflare"
where node >nul 2>nul
if errorlevel 1 goto missing
call npm ci
if errorlevel 1 goto failed
call npm run setup
if errorlevel 1 goto failed
call npm run login
if errorlevel 1 goto failed
call npm run deploy
if errorlevel 1 goto failed
echo.
echo Hoan tat. Mo cloudflare\connection.txt de ket noi app.
pause
exit /b 0
:missing
echo Can cai Node.js 24 LTS truoc: https://nodejs.org/
pause
exit /b 1
:failed
echo Chua hoan tat. Xem thong bao loi o tren; khong can nang cap goi tra phi.
pause
exit /b 1
