@echo off
setlocal
cd /d "%~dp0"
set PORT=8004

rem Files downloaded from the internet (ZIP) carry a "Mark of the Web" that Smart App Control
rem and SmartScreen use to block them. Remove it from every file in this folder.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0.' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>nul

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 (
  echo Node.js 22.18 or newer is required. You have:
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

rem (Re)install dependencies when they changed. Bump STAMP when package.json dependencies change.
set STAMP=node_modules\.deps-v4
if exist node_modules\esbuild rmdir /s /q node_modules
if not exist %STAMP% (
  echo Installing dependencies - takes a minute...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
  echo ok> %STAMP%
)

if not exist data\logs mkdir data\logs
where ffmpeg >nul 2>nul
if errorlevel 1 echo Note: ffmpeg not found - watching works, but video creation needs it: winget install Gyan.FFmpeg
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
