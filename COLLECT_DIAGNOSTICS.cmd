@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
chcp 65001 >nul
set "OUT=%PROJECT_DIR%poe2-diagnostics.txt"
set "RUNTIME_LOG=%APPDATA%\poe2-regex-trade-crafting-assistant\logs\runtime.log"
set "LAUNCHER_LOG=%PROJECT_DIR%logs\launcher-latest.log"

> "%OUT%" echo POE2 Assistant Diagnostics v1.7.7
>>"%OUT%" echo Collected: %DATE% %TIME%
>>"%OUT%" echo Project: %PROJECT_DIR%
>>"%OUT%" echo Runtime log: %RUNTIME_LOG%
>>"%OUT%" echo.

>>"%OUT%" echo ===== Node / npm / Electron =====
where node >>"%OUT%" 2>&1
node --version >>"%OUT%" 2>&1
where npm >>"%OUT%" 2>&1
call npm --version >>"%OUT%" 2>&1
node -e "const p=require('./package.json'); console.log('requiredElectron='+p.devDependencies.electron); try{console.log('installedElectron='+require('./node_modules/electron/package.json').version)}catch(e){console.log('installedElectron=MISSING')}" >>"%OUT%" 2>&1
if exist "node_modules\electron\dist\electron.exe" (
  "node_modules\electron\dist\electron.exe" --version >>"%OUT%" 2>&1
) else (
  >>"%OUT%" echo electron.exe=MISSING
)

>>"%OUT%" echo.
>>"%OUT%" echo ===== Critical files =====
for %%F in (renderer\arbitrage.html renderer\arbitrage.js renderer\arbitrage-bootstrap.js main.js preload.js package.json) do (
  if exist "%%F" (
    for %%S in ("%%F") do >>"%OUT%" echo %%F size=%%~zS
    certutil -hashfile "%%F" SHA256 >>"%OUT%" 2>&1
  ) else (
    >>"%OUT%" echo %%F MISSING
  )
)

>>"%OUT%" echo.
>>"%OUT%" echo ===== npm run check =====
call npm run check >>"%OUT%" 2>&1

>>"%OUT%" echo.
>>"%OUT%" echo ===== runtime.log =====
if exist "%RUNTIME_LOG%" (
  type "%RUNTIME_LOG%" >>"%OUT%"
) else (
  >>"%OUT%" echo runtime.log MISSING
)

>>"%OUT%" echo.
>>"%OUT%" echo ===== launcher-latest.log =====
if exist "%LAUNCHER_LOG%" (
  type "%LAUNCHER_LOG%" >>"%OUT%"
) else (
  >>"%OUT%" echo launcher-latest.log MISSING
)

echo.
echo 诊断包已生成：
echo %OUT%
start "" explorer.exe /select,"%OUT%"
pause
endlocal
exit /b 0
