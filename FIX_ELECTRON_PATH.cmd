@echo off
setlocal EnableExtensions
cd /d "%~dp0"
chcp 65001 >nul

echo ==========================================================
echo   POE2 Regex, Trade and Crafting Assistant - Fix Electron
echo ==========================================================
echo.

if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] electron.exe was not found:
  echo %CD%\node_modules\electron\dist\electron.exe
  echo Run INSTALL_RUNTIME_DIRECT.cmd first.
  pause
  exit /b 1
)

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$p=Join-Path (Get-Location) 'node_modules\electron\path.txt'; [System.IO.File]::WriteAllText($p,'electron.exe',[System.Text.Encoding]::ASCII); $v=[System.IO.File]::ReadAllText($p); Write-Host ('path.txt=['+$v+'] length='+$v.Length); if($v -cne 'electron.exe'){ exit 1 }"

if errorlevel 1 (
  echo.
  echo [ERROR] Repair failed.
  pause
  exit /b 1
)

echo.
echo [OK] path.txt has been repaired without CR/LF characters.
echo You can now run RUN_APP.cmd.
pause
endlocal
