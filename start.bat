@echo off
setlocal
cd /d "%~dp0"
set PORT=8004

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Node.js 22.13 or newer is required. You have:
  node -v
  echo Download the current LTS from https://nodejs.org
  pause
  exit /b 1
)

rem Already running? Just open the dashboard.
curl -s -o nul -m 2 http://127.0.0.1:%PORT%/api/info
if not errorlevel 1 (
  echo Already running.
  start "" http://localhost:%PORT%
  exit /b 0
)

if not exist node_modules (
  echo Installing dependencies - first run only, takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

if not exist data\logs mkdir data\logs
echo Starting TikTok Research Agent on port %PORT%...
start "TikTok Research Agent (close with stop.bat)" /min cmd /c scripts\run.bat

rem Wait for the server, then open the dashboard
for /l %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  curl -s -o nul -m 1 http://127.0.0.1:%PORT%/api/info && goto ready
)
echo The app did not start. See data\logs\app.log
pause
exit /b 1

:ready
echo Dashboard: http://localhost:%PORT%
echo On your phone (same Wi-Fi), open the address shown in Settings ^> "Open on your phone".
start "" http://localhost:%PORT%
exit /b 0
