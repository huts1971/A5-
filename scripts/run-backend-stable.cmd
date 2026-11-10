@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%BACKEND%\.venv312\Scripts\python.exe"
set "LOG=%BACKEND%\backend-local-server-8001.log"
set "ERR=%BACKEND%\backend-local-server-8001.err.log"

cd /d "%BACKEND%"
"%PYTHON%" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)" >nul 2>nul
if errorlevel 1 (
  echo Backend start failed: unsupported Python version in %PYTHON% 1>> "%ERR%"
  echo Recreate backend\.venv with Python 3.11 or 3.12, then run init script again. 1>> "%ERR%"
  exit /b 1
)
"%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 1>> "%LOG%" 2>> "%ERR%"
