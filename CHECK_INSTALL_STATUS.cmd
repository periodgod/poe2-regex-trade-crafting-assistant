@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================================
echo   POE2 Regex, Trade and Crafting Assistant - Runtime Status
echo ==========================================================
echo.

if exist "node_modules\electron\dist\electron.exe" (
  echo [OK] Electron runtime is installed.
  for %%F in ("node_modules\electron\dist\electron.exe") do echo      electron.exe size: %%~zF bytes
) else (
  echo [WAIT] Electron runtime is not installed yet.
)

if exist "node_modules" (
  echo [OK] node_modules exists.
  powershell.exe -NoProfile -Command ^
    "$s=(Get-ChildItem -LiteralPath 'node_modules' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum;" ^
    "if($null -eq $s){$s=0}; Write-Host ('     node_modules total: {0:N2} MB' -f ($s/1MB))"
) else (
  echo [WAIT] node_modules does not exist.
)

if exist ".runtime-cache" (
  powershell.exe -NoProfile -Command ^
    "$s=(Get-ChildItem -LiteralPath '.runtime-cache' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum;" ^
    "if($null -eq $s){$s=0}; Write-Host ('     direct-download cache: {0:N2} MB' -f ($s/1MB))"
)

echo.
echo Active Node/npm related processes:
tasklist | findstr /I "node.exe npm.exe electron.exe curl.exe"
if errorlevel 1 echo None found.

echo.
echo Electron cache:
echo %LOCALAPPDATA%\electron\Cache
if exist "%LOCALAPPDATA%\electron\Cache" (
  powershell.exe -NoProfile -Command ^
    "$s=(Get-ChildItem -LiteralPath $env:LOCALAPPDATA'\electron\Cache' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum;" ^
    "if($null -eq $s){$s=0}; Write-Host ('     cache total: {0:N2} MB' -f ($s/1MB))"
) else (
  echo      Cache directory does not exist yet.
)

echo.
pause
endlocal
