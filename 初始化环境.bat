@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"

echo A5 AI Guide environment init
echo Project root: %ROOT%
echo.

if not exist "%BACKEND%\requirements.txt" (
  echo Init failed: missing backend\requirements.txt
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

call :find_python
if not defined PYTHON_CMD (
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

cd /d "%BACKEND%"

set "RECREATE_VENV=0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)" >nul 2>nul
  if errorlevel 1 set "RECREATE_VENV=1"
)

if "%RECREATE_VENV%"=="1" (
  echo [1/3] Existing backend\.venv belongs to another Python install or is unsupported.
  echo       Recreating it with the local Python runtime...
  rmdir /s /q ".venv"
  if exist ".venv" (
    echo Init failed: could not remove the unusable backend\.venv.
    if /I not "%~1"=="nopause" pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating backend\.venv
  %PYTHON_CMD% -m venv .venv
  if errorlevel 1 (
    echo Init failed: could not create virtual environment.
    if /I not "%~1"=="nopause" pause
    exit /b 1
  )
) else (
  echo [1/3] backend\.venv is usable, keeping it.
)

echo [2/3] Installing backend dependencies
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo Init failed: pip upgrade failed.
  if /I not "%~1"=="nopause" pause
  exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Init failed: dependency install failed. Check network or pip source.
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

echo [3/3] Preparing backend\.env
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo Created backend\.env from backend\.env.example
  ) else (
    echo backend\.env.example was not found. Create backend\.env manually.
  )
) else (
  echo backend\.env already exists, not overwritten.
)

echo.
echo Init completed.
echo Next: edit backend\.env, fill the keys you need, then run start script.

if /I not "%~1"=="nopause" pause
exit /b 0

:find_python
set "PYTHON_CMD="
for %%V in (3.13 3.12 3.11 3.10) do (
  if not defined PYTHON_CMD (
    py -%%V -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=py -%%V"
  )
)
if not defined PYTHON_CMD (
  python -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=python"
)

if defined PYTHON_CMD (
  for /f "delims=" %%V in ('%PYTHON_CMD% --version 2^>^&1') do echo Using %%V
) else (
  echo Init failed: Python 3.10-3.13 was not found.
  echo Install Python 3.11 or 3.12 and enable Add python.exe to PATH.
  echo Python 3.14 is not supported by the pinned backend dependencies.
)
exit /b 0
