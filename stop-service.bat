@echo off
setlocal

set "ROOT=%~dp0"
call "%ROOT%stop-local.bat"
exit /b %ERRORLEVEL%
