@echo off
rem Keeps the app running: if it crashes it is restarted after 5 seconds.
rem A normal stop (stop.bat) exits with code 0 and ends this loop.
cd /d "%~dp0\.."
if "%PORT%"=="" set PORT=8004
:loop
if exist data\stop.flag del data\stop.flag
echo [%date% %time%] starting >> data\logs\app.log
call npm start >> data\logs\app.log 2>&1
if %errorlevel%==0 goto end
if exist data\stop.flag goto end
echo [%date% %time%] app exited with code %errorlevel%, restarting in 5s >> data\logs\app.log
timeout /t 5 /nobreak >nul
goto loop
:end
if exist data\stop.flag del data\stop.flag
