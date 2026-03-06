@echo off
echo Starting SkyChat Desktop...
echo.

REM Start Django server in background
echo [1/2] Starting Django server...
cd /d "%~dp0\.."
start "SkyChat Server" cmd /c ".\venv\Scripts\activate && daphne -b 127.0.0.1 -p 8000 chat_app.asgi:application"

REM Wait for server to start
echo Waiting for server to start...
timeout /t 3 /nobreak >nul

REM Start Electron app
echo [2/2] Starting Desktop app...
cd /d "%~dp0"
call npm start

REM When electron closes, also close the server
taskkill /FI "WindowTitle eq SkyChat Server*" /F >nul 2>&1
