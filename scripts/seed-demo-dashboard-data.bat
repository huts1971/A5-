@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=%BACKEND%\.venv312\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo Backend venv python not found.
  echo Please create backend\.venv first, then run this script again.
  exit /b 1
)

cd /d "%ROOT%"
"%PYTHON%" "%ROOT%\scripts\seed-demo-dashboard-data.py" %*
