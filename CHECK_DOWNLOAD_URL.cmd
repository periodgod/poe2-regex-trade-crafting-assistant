@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul

for /f "delims=" %%A in ('node -p "require('./package.json').devDependencies.electron"') do set "ELECTRON_VERSION=%%A"
for /f "delims=" %%A in ('node -p "process.arch"') do set "NODE_ARCH=%%A"

set "FILE_NAME=electron-v%ELECTRON_VERSION%-win32-%NODE_ARCH%.zip"
set "MIRROR_URL=https://npmmirror.com/mirrors/electron/v%ELECTRON_VERSION%/%FILE_NAME%"
set "OFFICIAL_URL=https://github.com/electron/electron/releases/download/v%ELECTRON_VERSION%/%FILE_NAME%"

echo Electron version: [%ELECTRON_VERSION%]
echo Architecture:     [%NODE_ARCH%]
echo File name:        [%FILE_NAME%]
echo.
echo Mirror:
echo %MIRROR_URL%
echo.
echo Official:
echo %OFFICIAL_URL%
echo.

if "%ELECTRON_VERSION%"=="" (
  echo [ERROR] Version is empty.
) else (
  echo [OK] Version is not empty.
)

pause
endlocal
