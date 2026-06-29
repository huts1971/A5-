@echo off
setlocal
chcp 65001 >nul

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0avatar-service\setup-avatar.ps1"
if errorlevel 1 (
  echo.
  echo LiteAvatar setup failed. Review the error above and README-local-run.md.
  pause
  exit /b 1
)

echo.
echo LiteAvatar setup completed.
pause
