@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "LOG_DIR=%APPDATA%\poe2-regex-trade-crafting-assistant\logs"
set "LOG_FILE=%LOG_DIR%\runtime.log"

echo ==========================================================
echo   POE2 助手运行日志
echo ==========================================================
echo.
echo 日志文件：
echo %LOG_FILE%
echo.

if exist "%LOG_FILE%" (
  start "" explorer.exe /select,"%LOG_FILE%"
  exit /b 0
)

if exist "%LOG_DIR%" (
  start "" explorer.exe "%LOG_DIR%"
  exit /b 0
)

echo [INFO] 当前还没有生成 runtime.log。
echo 请先运行应用并打开“兑换助手”，然后再次执行本脚本。
pause
endlocal
exit /b 1
