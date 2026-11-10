@echo off
setlocal

set "ROOT=%~dp0"

if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
  echo Run init script first.
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

"%ROOT%backend\.venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)" >nul 2>nul
if errorlevel 1 (
  echo Start failed: backend\.venv is using an unsupported Python version.
  echo Please recreate backend\.venv with Python 3.11 or 3.12, then run init script again.
  echo Python 3.14 is not supported by the pinned backend dependencies.
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

if not exist "%ROOT%frontend\dist\index.html" (
  echo Missing frontend\dist\index.html. The package is incomplete or frontend was not built.
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

if not exist "%ROOT%backend\.env" (
  echo Note: backend\.env is missing.
  echo The launcher may copy backend\.env.example, but real model/TTS/map features need keys.
  echo.
)

call "%ROOT%START-HERE.bat"
exit /b %ERRORLEVEL%
