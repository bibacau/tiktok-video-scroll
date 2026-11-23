@echo off
setlocal
cd /d "%~dp0"
set PORT=8004
echo Stopping TikTok Research Agent...
if not exist data mkdir data
echo stop> data\stop.flag
curl -s -o nul -m 5 -X POST http://127.0.0.1:%PORT%/api/shutdown
rem give it time to stop the session and close Edge
for /l %%i in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  if not exist data\app.pid goto done
)
rem Still running: force it (the app and the Edge it opened)
if not exist data\app.pid goto done
set /p APPPID=<data\app.pid
taskkill /PID %APPPID% /T /F >nul 2>nul
del data\app.pid >nul 2>nul
:done
echo Stopped.
timeout /t 2 >nul
