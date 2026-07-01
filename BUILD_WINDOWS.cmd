@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================================
echo   POE2 Regex, Trade and Crafting Assistant - Builder
echo ==========================================================
echo.
echo electron-builder is NOT installed during normal startup.
echo It will be downloaded only now because you requested an EXE build.
echo.

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Install and run the application first using RUN_APP.cmd.
  pause
  exit /b 1
)

call npm run check
if errorlevel 1 (
  echo [ERROR] Source check failed.
  pause
  exit /b 1
)

set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
call npx --yes electron-builder@26.0.12 --win nsis portable

if errorlevel 1 (
  echo.
  echo [ERROR] Windows build failed.
  pause
  exit /b 1
)

echo.
echo Build completed. Check the dist folder.
pause
endlocal
