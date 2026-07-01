@echo off
setlocal EnableExtensions
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"
chcp 65001 >nul

echo(%PROJECT_DIR% | %SystemRoot%\System32\findstr.exe /I /C:"\AppData\Local\Temp\" >nul
if not errorlevel 1 goto :ZIP_PREVIEW_ERROR
if not exist "%PROJECT_DIR%INSTALL_RUNTIME_DIRECT.cmd" goto :MISSING_PROJECT_ERROR
if not exist "%PROJECT_DIR%package.json" goto :MISSING_PROJECT_ERROR

echo ==========================================================
echo   POE2 助手 - 详细日志安全安装器 v1.7.7
echo ==========================================================
echo.
echo 此入口复用 INSTALL_RUNTIME_DIRECT.cmd 的完整校验流程，
echo 仅把 npm 日志级别改为 verbose。
echo.
set "POE2_NPM_LOGLEVEL=verbose"
call "%PROJECT_DIR%INSTALL_RUNTIME_DIRECT.cmd"
set "INSTALL_EXIT=%ERRORLEVEL%"
endlocal & exit /b %INSTALL_EXIT%

:ZIP_PREVIEW_ERROR
echo [ERROR] 你正在 ZIP 预览的临时目录中运行脚本。
echo 请右键 ZIP，选择“全部解压”，再运行 START_HERE.cmd。
start "" explorer.exe "%USERPROFILE%\Downloads"
pause
endlocal
exit /b 20

:MISSING_PROJECT_ERROR
echo [ERROR] 完整项目文件不存在。请重新“全部解压”完整 ZIP。
pause
endlocal
exit /b 21
