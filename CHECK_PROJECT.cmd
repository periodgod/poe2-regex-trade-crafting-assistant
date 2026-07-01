@echo off
setlocal EnableExtensions
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
chcp 65001 >nul

echo(%PROJECT_DIR% | %SystemRoot%\System32\findstr.exe /I /C:"\AppData\Local\Temp\" >nul
if not errorlevel 1 goto :ZIP_PREVIEW_ERROR
echo(%PROJECT_DIR% | %SystemRoot%\System32\findstr.exe /I /C:".zip." >nul
if not errorlevel 1 goto :ZIP_PREVIEW_ERROR

echo [1/3] 检查 Node.js……
where node >nul 2>nul
if errorlevel 1 goto :NODE_MISSING

echo [2/3] 检查完整项目文件……
set "MISSING_FILE="
for %%F in (
  package.json main.js preload.js VERIFY_ELECTRON_CHECKSUM.ps1
  renderer\index.html renderer\app.js renderer\regex-generator.html renderer\regex-generator.js
  renderer\arbitrage.html renderer\crafting-planner.html renderer\crafting-planner.js
  src\item-state.js src\currency-state-machine.js src\full-snapshot-adapter.js
  scripts\update-poe2-full-data.js
  data-v2\manifest.json data-catalog\manifest.json data-snapshot\manifest.json
) do (
  if not exist "%%F" if not defined MISSING_FILE set "MISSING_FILE=%%F"
)
if defined MISSING_FILE goto :MISSING_PROJECT_ERROR

echo [3/3] 执行完整自动检查……
call npm run check
if errorlevel 1 goto :CHECK_FAILED

echo.
echo [OK] 项目文件与自动测试全部通过。
pause
endlocal
exit /b 0

:ZIP_PREVIEW_ERROR
echo [ERROR] 当前路径是 Windows ZIP 预览临时目录。
echo 请右键完整 ZIP，选择“全部解压”，再运行本脚本。
start "" explorer.exe "%USERPROFILE%\Downloads"
pause
endlocal
exit /b 20

:NODE_MISSING
echo [ERROR] 未找到 Node.js 22 或更高版本。
pause
endlocal
exit /b 1

:MISSING_PROJECT_ERROR
echo [ERROR] 缺少项目文件：%MISSING_FILE%
echo 这通常表示你没有“全部解压”ZIP。
pause
endlocal
exit /b 21

:CHECK_FAILED
echo [ERROR] 项目检查失败。
pause
endlocal
exit /b 1
