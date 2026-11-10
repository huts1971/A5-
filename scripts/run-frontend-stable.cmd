@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul

set "ROOT=%~dp0.."
set "FRONTEND=%ROOT%\frontend"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=5173"
set "LOG=%FRONTEND%\frontend-local-server-%PORT%.log"
set "ERR=%FRONTEND%\frontend-local-server-%PORT%.err.log"
set "NODE="

where node >nul 2>nul
if not errorlevel 1 set "NODE=node"
if not defined NODE if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" (
  set "NODE=C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe"
)

cd /d "%ROOT%"
set "FRONTEND_PORT=%PORT%"
if defined NODE (
  "%NODE%" scripts\serve-frontend-static.mjs 1>> "%LOG%" 2>> "%ERR%"
) else (
  set "PYTHON=%ROOT%\backend\.venv\Scripts\python.exe"
  if not exist "!PYTHON!" set "PYTHON=%ROOT%\backend\.venv312\Scripts\python.exe"
  if not exist "!PYTHON!" set "PYTHON=python"
  "!PYTHON!" scripts\serve-frontend-static.py --port "%PORT%" 1>> "%LOG%" 2>> "%ERR%"
)
