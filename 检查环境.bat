@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "HAS_ERROR=0"
set "HAS_WARN=0"

echo zrb-14 environment check
echo Project root: %ROOT%
echo.

echo [1/5] Project files
call :need_dir "%BACKEND%" "backend"
call :need_dir "%FRONTEND%" "frontend"
call :need_file "%BACKEND%\requirements.txt" "backend\requirements.txt"
call :need_file "%FRONTEND%\dist\index.html" "frontend\dist\index.html"
call :need_file "%ROOT%START-HERE.bat" "START-HERE.bat"
echo.

echo [2/5] Python 3.10-3.13
call :find_python
echo.

echo [3/5] Node.js
call :find_node
echo.

echo [4/5] Backend venv and env file
if exist "%BACKEND%\.venv\Scripts\python.exe" (
  "%BACKEND%\.venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 14) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo [MISMATCH] backend\.venv exists but uses an unsupported Python version.
    echo            Recreate backend\.venv with Python 3.11 or 3.12.
    set "HAS_ERROR=1"
  ) else (
    for /f "delims=" %%V in ('"%BACKEND%\.venv\Scripts\python.exe" --version 2^>^&1') do echo [OK] backend\.venv %%V
  )
) else (
  echo [INFO] backend\.venv is missing. Run init script first.
  set "HAS_WARN=1"
)

if exist "%BACKEND%\.env" (
  echo [OK] backend\.env exists
) else (
  echo [INFO] backend\.env is missing. Init script can copy backend\.env.example.
  set "HAS_WARN=1"
)
echo.

echo [5/5] Common ports
call :check_port 8001
call :check_port 5173
call :check_port 5174
echo.

if "%HAS_ERROR%"=="1" (
  echo Result: required checks failed. Fix missing items before init/start.
  if /I not "%~1"=="nopause" pause
  exit /b 1
)

if "%HAS_WARN%"=="1" (
  echo Result: basic files are OK, with notes above. Follow README deployment steps.
) else (
  echo Result: environment looks ready to start.
)

if /I not "%~1"=="nopause" pause
exit /b 0

:need_dir
if exist "%~1\" (
  echo [OK] %~2
) else (
  echo [MISSING] %~2
  set "HAS_ERROR=1"
)
exit /b 0

:need_file
if exist "%~1" (
  echo [OK] %~2
) else (
  echo [MISSING] %~2
  set "HAS_ERROR=1"
)
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
  for /f "delims=" %%V in ('%PYTHON_CMD% --version 2^>^&1') do echo [OK] %%V
) else (
  echo [MISSING] Python 3.10-3.13 was not found.
  echo           Install Python 3.11 or 3.12 and enable Add python.exe to PATH.
  echo           Python 3.14 is not supported by the pinned backend dependencies.
  set "HAS_ERROR=1"
)
exit /b 0

:find_node
set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"
if not defined NODE_EXE if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" (
  set "NODE_EXE=C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe"
)

if defined NODE_EXE (
  for /f "delims=" %%V in ('"%NODE_EXE%" --version 2^>^&1') do echo [OK] Node.js %%V
) else (
  echo [MISSING] Node.js was not found. Static frontend server requires Node.js.
  echo           Install Node.js 18 or newer.
  set "HAS_ERROR=1"
)
exit /b 0

:check_port
set "PORT=%~1"
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [BUSY] Port %PORT% is in use. Run stop script before a clean restart.
  set "HAS_WARN=1"
) else (
  echo [OK] Port %PORT% is free
)
exit /b 0
