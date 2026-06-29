@echo off
setlocal

for %%P in (5173 5174 5175 5176 8001 5200 8282 8283) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    echo Stopping process %%A on port %%P
    taskkill /T /F /PID %%A >nul 2>nul
  )
)

echo Local ports are clear: 5173, 5174, 5175, 5176, 8001, 5200, 8282, 8283
if /I not "%~1"=="nopause" pause
