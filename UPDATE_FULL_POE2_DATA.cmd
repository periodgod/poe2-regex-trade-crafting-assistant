@echo off
setlocal EnableExtensions
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
chcp 65001 >nul

echo(%PROJECT_DIR% | %SystemRoot%\System32\findstr.exe /I /C:"\AppData\Local\Temp\" >nul
if not errorlevel 1 goto :ZIP_PREVIEW_ERROR
if not exist "%PROJECT_DIR%package.json" goto :MISSING_PROJECT_ERROR
if not exist "%PROJECT_DIR%scripts\update-poe2-full-data.js" goto :MISSING_PROJECT_ERROR

where node >nul 2>nul
if errorlevel 1 goto :NODE_MISSING

echo [PoE2] 正在下载并校验 Craft of Exile 精确底材、具体基底、词缀和 T 级快照……
node scripts\update-poe2-full-data.js
if errorlevel 1 goto :UPDATE_FAILED

echo.
echo [OK] 完整快照已写入 data-snapshot。
pause
endlocal
exit /b 0

:ZIP_PREVIEW_ERROR
echo [ERROR] 请先右键完整 ZIP，选择“全部解压”，再更新数据。
start "" explorer.exe "%USERPROFILE%\Downloads"
pause
endlocal
exit /b 20

:MISSING_PROJECT_ERROR
echo [ERROR] 当前不是完整项目目录，缺少 package.json 或更新脚本。
pause
endlocal
exit /b 21

:NODE_MISSING
echo [ERROR] 未找到 Node.js 22 或更高版本。
pause
endlocal
exit /b 1

:UPDATE_FAILED
echo.
echo [ERROR] 更新失败。请检查网络、代理或 GitHub 访问状态；旧快照不会被破坏。
pause
endlocal
exit /b 1
