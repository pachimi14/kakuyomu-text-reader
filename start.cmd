@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH.
  echo Install it from https://nodejs.org/ and run this again.
  echo.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:7878/"
node server.mjs

echo.
echo Server stopped.
pause
