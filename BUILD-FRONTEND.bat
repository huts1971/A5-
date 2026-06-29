@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"

echo Building frontend static files...
echo Project: %FRONTEND%
echo.

cd /d "%FRONTEND%"
set "VITE_API_BASE_URL=http://127.0.0.1:8001"
set "VITE_AVATAR_SERVICE_URL=http://127.0.0.1:8283"
set "VITE_OPENAVATAR_URL=http://127.0.0.1:8282"
set "VITE_USE_MOCK_API=false"

npm.cmd run build
if errorlevel 1 (
  echo.
  echo Frontend build failed.
  echo Please make sure Node.js 18+ is installed and frontend dependencies are ready.
  pause
  exit /b 1
)

echo.
echo Frontend build finished. You can now run START-HERE.bat.
pause
