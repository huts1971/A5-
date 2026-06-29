@echo off
setlocal
set "ROOT=%~dp0.."
set "AVATAR=%ROOT%\avatar-service"
set "PYTHON=%AVATAR%\.venv\Scripts\python.exe"

cd /d "%AVATAR%"
"%PYTHON%" -m uvicorn avatar_service.main:app --host 127.0.0.1 --port 8283 1>> "%AVATAR%\avatar-local-server-8283.log" 2>> "%AVATAR%\avatar-local-server-8283.err.log"
