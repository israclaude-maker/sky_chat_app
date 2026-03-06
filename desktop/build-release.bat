@echo off
echo ========================================
echo   SkyChat Desktop - Production Build
echo ========================================
echo.

set /p SERVER_URL="Enter your live server URL (e.g., https://chat.yourdomain.com): "

if "%SERVER_URL%"=="" (
    echo ERROR: Server URL is required!
    pause
    exit /b 1
)

echo.
echo Updating config.json with: %SERVER_URL%
echo {"serverUrl": "%SERVER_URL%", "appName": "SkyChat"} > config.json

echo.
echo Building Windows executable...
call npm run build:win

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Complete!
echo ========================================
echo.
echo Your installer is in: desktop\dist\
echo.
pause
