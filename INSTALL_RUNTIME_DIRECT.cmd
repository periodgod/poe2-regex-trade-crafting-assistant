@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
chcp 65001 >nul

echo ==========================================================
echo   POE2 正则、交易与做装助手 - Electron 安装器 v1.7.7
echo ==========================================================
echo.
echo 项目目录：
echo %PROJECT_DIR%
echo.

rem Windows 从 ZIP 预览中双击 CMD 时，只会把被双击的文件复制到 Temp。
echo(%PROJECT_DIR% | %SystemRoot%\System32\findstr.exe /I /C:"\AppData\Local\Temp\" >nul
if not errorlevel 1 goto :ZIP_PREVIEW_ERROR

echo(%PROJECT_DIR% | %SystemRoot%\System32\findstr.exe /I /C:".zip." >nul
if not errorlevel 1 goto :ZIP_PREVIEW_ERROR

rem 一次收集缺失文件，循环结束后再跳转，避免在括号块内 exit /b 后继续执行。
set "MISSING_FILE="
for %%F in (
  package.json
  main.js
  preload.js
  VERIFY_ELECTRON_CHECKSUM.ps1
  renderer\index.html
  src\item-parser.js
) do (
  if not exist "%PROJECT_DIR%%%F" if not defined MISSING_FILE set "MISSING_FILE=%%F"
)
if defined MISSING_FILE goto :MISSING_PROJECT_ERROR

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found.
  pause
  exit /b 1
)

where curl.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows curl.exe was not found.
  pause
  exit /b 1
)

for /f "delims=" %%A in ('node -p "require('./package.json').devDependencies.electron"') do set "ELECTRON_VERSION=%%A"
for /f "delims=" %%A in ('node -p "process.arch"') do set "NODE_ARCH=%%A"

if not defined ELECTRON_VERSION (
  echo [ERROR] ELECTRON_VERSION is empty.
  pause
  exit /b 1
)

if /I "%NODE_ARCH%"=="x64" (
  set "ELECTRON_ARCH=x64"
) else if /I "%NODE_ARCH%"=="arm64" (
  set "ELECTRON_ARCH=arm64"
) else if /I "%NODE_ARCH%"=="ia32" (
  set "ELECTRON_ARCH=ia32"
) else (
  echo [ERROR] Unsupported architecture: %NODE_ARCH%
  pause
  exit /b 1
)

set "FILE_NAME=electron-v%ELECTRON_VERSION%-win32-%ELECTRON_ARCH%.zip"
set "CACHE_DIR=%PROJECT_DIR%.runtime-cache"
set "ZIP_PATH=%CACHE_DIR%\%FILE_NAME%"
set "MIRROR_URL=https://npmmirror.com/mirrors/electron/v%ELECTRON_VERSION%/%FILE_NAME%"
set "OFFICIAL_URL=https://github.com/electron/electron/releases/download/v%ELECTRON_VERSION%/%FILE_NAME%"
set "OFFICIAL_RETRY_URL=%OFFICIAL_URL%?poe2_retry=%RANDOM%%RANDOM%"
set "VERIFY_SCRIPT=%PROJECT_DIR%VERIFY_ELECTRON_CHECKSUM.ps1"
set "VERIFIED_MARKER=%CACHE_DIR%\%FILE_NAME%.verified"
set "DOWNLOAD_PART=%ZIP_PATH%.download.part"
set "OFFICIAL_ZIP_PATH=%CACHE_DIR%\official-%FILE_NAME%"
set "OFFICIAL_PART=%OFFICIAL_ZIP_PATH%.part"

if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"

echo Electron version: %ELECTRON_VERSION%
echo Architecture:     %ELECTRON_ARCH%
echo File:             %FILE_NAME%
echo.

if not defined POE2_NPM_LOGLEVEL set "POE2_NPM_LOGLEVEL=info"

echo [1/4] Installing npm package files without Electron post-install...
echo npm log level: %POE2_NPM_LOGLEVEL%
call npm install --ignore-scripts --no-audit --no-fund --loglevel=%POE2_NPM_LOGLEVEL% --registry=https://registry.npmmirror.com

if errorlevel 1 (
  echo.
  echo [WARN] China npm registry failed. Retrying official registry...
  call npm install --ignore-scripts --no-audit --no-fund --loglevel=%POE2_NPM_LOGLEVEL% --registry=https://registry.npmjs.org/
)

if errorlevel 1 (
  echo.
  echo [ERROR] JavaScript dependency installation failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Preparing Electron %ELECTRON_VERSION% for Windows %ELECTRON_ARCH%...

if exist "%ZIP_PATH%" (
  for %%F in ("%ZIP_PATH%") do set "ZIP_SIZE=%%~zF"
  if !ZIP_SIZE! GTR 1048576 (
    echo Reusing cached ZIP:
    echo %ZIP_PATH%
    echo Cached size: !ZIP_SIZE! bytes
  ) else (
    echo Cached ZIP is too small and will be replaced.
    del /q "!ZIP_PATH!" 2>nul
    del /q "%VERIFIED_MARKER%" 2>nul
  )
)

if not exist "%ZIP_PATH%" (
  echo Download URL:
  echo %MIRROR_URL%
  echo.
  echo The following line is the real download progress bar.
  echo.

  del /q "%DOWNLOAD_PART%" 2>nul
  curl.exe -L --fail --retry 3 --retry-delay 2 --progress-bar ^
    -o "%DOWNLOAD_PART%" "%MIRROR_URL%"

  if errorlevel 1 (
    del /q "%DOWNLOAD_PART%" 2>nul
    echo.
    echo [WARN] China Electron mirror failed. Retrying GitHub...
    echo %OFFICIAL_URL%
    curl.exe -L --fail --retry 3 --retry-delay 2 --progress-bar ^
      -o "%DOWNLOAD_PART%" "%OFFICIAL_URL%"

    if errorlevel 1 (
      del /q "%DOWNLOAD_PART%" 2>nul
      echo.
      echo [ERROR] Electron ZIP download failed.
      pause
      exit /b 1
    )
  )

  move /y "%DOWNLOAD_PART%" "%ZIP_PATH%" >nul
  if errorlevel 1 (
    echo [ERROR] Failed to move the completed Electron download into the runtime cache.
    del /q "%DOWNLOAD_PART%" 2>nul
    pause
    exit /b 1
  )
)

echo.
echo [3/4] Verifying Electron download (SHA-256, or signed-binary fallback)...

if not exist "%VERIFY_SCRIPT%" (
  echo [ERROR] Checksum verifier is missing:
  echo %VERIFY_SCRIPT%
  echo.
  echo Installation has been stopped. The ZIP will NOT be extracted.
  pause
  exit /b 22
)

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ^
  -File "%VERIFY_SCRIPT%" ^
  -ZipPath "%ZIP_PATH%" ^
  -FileName "%FILE_NAME%" ^
  -Version "%ELECTRON_VERSION%" ^
  -CacheDir "%CACHE_DIR%"

set "VERIFY_EXIT=%ERRORLEVEL%"

if not "%VERIFY_EXIT%"=="0" (
  echo.
  echo [WARN] The cached or mirror Electron ZIP did not pass official verification.
  echo It will be deleted and downloaded again directly from the official GitHub release.
  echo.
  del /q "%VERIFIED_MARKER%" 2>nul
  rem The rejected cache may be temporarily locked by antivirus. Do not depend on deleting it.
  del /q "%ZIP_PATH%" 2>nul
  del /q "%OFFICIAL_ZIP_PATH%" 2>nul
  del /q "%OFFICIAL_PART%" 2>nul

  echo Official download URL:
  echo %OFFICIAL_URL%
  curl.exe -L --fail --retry 4 --retry-delay 2 --proto "=https" --tlsv1.2 ^
    -H "Cache-Control: no-cache" -H "Pragma: no-cache" --progress-bar ^
    -o "%OFFICIAL_PART%" "%OFFICIAL_RETRY_URL%"

  if errorlevel 1 (
    del /q "%OFFICIAL_PART%" 2>nul
    echo.
    echo [ERROR] Official Electron ZIP download failed.
    echo No unverified file has been installed or executed.
    pause
    exit /b 1
  )

  move /y "%OFFICIAL_PART%" "%OFFICIAL_ZIP_PATH%" >nul
  if errorlevel 1 (
    del /q "%OFFICIAL_PART%" 2>nul
    echo.
    echo [ERROR] Failed to place the official Electron ZIP in the runtime cache.
    pause
    exit /b 1
  )

  set "ZIP_PATH=%OFFICIAL_ZIP_PATH%"
  echo.
  echo Re-verifying the official download...
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ^
    -File "%VERIFY_SCRIPT%" ^
    -ZipPath "!ZIP_PATH!" ^
    -FileName "%FILE_NAME%" ^
    -Version "%ELECTRON_VERSION%" ^
    -CacheDir "%CACHE_DIR%"

  set "VERIFY_EXIT=%ERRORLEVEL%"
  if not "!VERIFY_EXIT!"=="0" (
    echo.
    echo [ERROR] The official Electron download still failed integrity verification.
    echo The invalid ZIP has been removed and will not be installed or executed.
    del /q "!ZIP_PATH!" 2>nul
    del /q "%VERIFIED_MARKER%" 2>nul
    pause
    exit /b !VERIFY_EXIT!
  )
)

> "%VERIFIED_MARKER%" echo verified %DATE% %TIME%

echo.
echo [4/4] Extracting verified Electron runtime...

if not exist "%VERIFIED_MARKER%" (
  echo [ERROR] Verification marker is missing. Extraction refused.
  pause
  exit /b 23
)

if exist "node_modules\electron\dist" rmdir /s /q "node_modules\electron\dist"
mkdir "node_modules\electron\dist"

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '%ZIP_PATH%' -DestinationPath 'node_modules\electron\dist' -Force; exit 0"

set "EXTRACT_EXIT=%ERRORLEVEL%"
if not "%EXTRACT_EXIT%"=="0" (
  echo.
  echo [ERROR] Failed to extract Electron runtime.
  rmdir /s /q "node_modules\electron\dist" 2>nul
  pause
  exit /b %EXTRACT_EXIT%
)

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$p=Join-Path (Get-Location) 'node_modules\\electron\\path.txt'; [System.IO.File]::WriteAllText($p,'electron.exe',[System.Text.Encoding]::ASCII); $v=[System.IO.File]::ReadAllText($p); if($v -cne 'electron.exe'){ exit 1 }"

if errorlevel 1 (
  echo.
  echo [ERROR] Failed to create a clean electron path.txt file.
  pause
  exit /b 24
)

if not exist "node_modules\\electron\\dist\\electron.exe" (
  echo.
  echo [ERROR] electron.exe was not found after extraction.
  rmdir /s /q "node_modules\electron\dist" 2>nul
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo Installation completed successfully.
echo ==========================================================
echo Electron:
echo %PROJECT_DIR%node_modules\electron\dist\electron.exe
echo.
echo You may now run RUN_APP.cmd from this same project folder.
pause
endlocal
exit /b 0

:ZIP_PREVIEW_ERROR
cls
echo ==========================================================
echo [需要先解压整个 ZIP，当前没有安装失败]
echo ==========================================================
echo.
echo 当前路径位于 Windows 临时目录：
echo %PROJECT_DIR%
echo.
echo 这不表示压缩包缺少 package.json。
echo Windows 在 ZIP 预览中只临时复制了你双击的 CMD，
echo package.json、main.js、renderer 和 src 没有一起复制出来。
echo.
echo 正确操作：
echo   1. 关闭当前窗口。
echo   2. 在“下载”文件夹中右键完整 ZIP。
echo   3. 选择“全部解压”。
echo   4. 进入解压后的项目文件夹。
echo   5. 双击 START_HERE.cmd 或 RUN_APP.cmd。
echo.
echo 现在为你打开“下载”文件夹。
start "" explorer.exe "%USERPROFILE%\Downloads"
echo.
pause
endlocal
exit /b 20

:MISSING_PROJECT_ERROR
cls
echo ==========================================================
echo [项目文件不完整]
echo ==========================================================
echo.
echo 缺少文件：%MISSING_FILE%
echo 项目目录：%PROJECT_DIR%
echo.
echo 请确认你进入的是“全部解压”得到的项目文件夹，
echo 而不是 ZIP 预览窗口或只复制了单个 CMD 的目录。
echo.
pause
endlocal
exit /b 21
