@echo off
echo ============================================
echo Building Standalone SkyChat Desktop App
echo ============================================

:: Create resources directory structure
if not exist "resources\python" mkdir resources\python
if not exist "resources\backend" mkdir resources\backend

echo.
echo Step 1: Copying Python environment...
:: Copy embedded Python (you need to download python-embed first)
:: Download from: https://www.python.org/ftp/python/3.12.0/python-3.12.0-embed-amd64.zip
:: Extract to resources\python

echo NOTE: You need to manually:
echo 1. Download Python embeddable package from python.org
echo 2. Extract it to: desktop\resources\python
echo 3. Install pip and required packages in embedded Python
echo.

echo Step 2: Copying Django backend...
xcopy /E /I /Y "..\accounts" "resources\backend\accounts"
xcopy /E /I /Y "..\chat" "resources\backend\chat"
xcopy /E /I /Y "..\chat_app" "resources\backend\chat_app"
xcopy /E /I /Y "..\calls" "resources\backend\calls"
xcopy /E /I /Y "..\static" "resources\backend\static"
xcopy /E /I /Y "..\templates" "resources\backend\templates" 2>nul
copy "..\manage.py" "resources\backend\"
copy "..\db.sqlite3" "resources\backend\" 2>nul

echo.
echo Step 3: Building Electron app...
call npm run build:win

echo.
echo ============================================
echo Build complete! Check the dist folder.
echo ============================================
pause
