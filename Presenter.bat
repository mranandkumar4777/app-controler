@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found on this computer.
  echo Presenter needs it to run - install it free from https://nodejs.org
  echo then double-click Presenter.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "server.js" (
  echo.
  echo server.js wasn't found in this folder. Keep Presenter.bat in the
  echo same folder as server.js, presenter.html and remote.html.
  echo.
  pause
  exit /b 1
)

rem If something is already listening on 8787, assume the server is
rem already running from an earlier launch and just open the browser.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8787/' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "Presenter server" cmd /k "node server.js"
  timeout /t 3 /nobreak >nul
)

start "" "http://localhost:8787/"
