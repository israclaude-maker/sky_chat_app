@echo off
echo ========================================
echo     SkyChat Desktop Setup
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js found: 
node --version

echo.
echo Installing dependencies...
cd /d "%~dp0"
call npm install

if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo ========================================
echo     Setup Complete!
echo ========================================
echo.
echo To run the desktop app:
echo   1. Start Django server first (daphne -b 127.0.0.1 -p 8000 chat_app.asgi:application)
echo   2. Run: npm start
echo.
echo To build executable:
echo   Run: npm run build:win
echo.
pause
