$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { & "$env:SystemRoot\System32\chcp.com" 65001 | Out-Null } catch {}

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDir

function Pause-Menu {
    Write-Host ''
    [void](Read-Host '按 Enter 键继续')
}

function Invoke-PowerShellScript([string]$name) {
    $path = Join-Path $projectDir $name
    if (-not (Test-Path -LiteralPath $path)) { throw "缺少脚本：$name" }
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $path
    return $LASTEXITCODE
}

function Invoke-CmdScript([string]$name) {
    $path = Join-Path $projectDir $name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "缺少脚本：$name"
    }
    & "$env:SystemRoot\System32\cmd.exe" /d /c "`"$path`""
    return $LASTEXITCODE
}

$normalized = $projectDir.Replace('/', '\')
if ($normalized -match '\\AppData\\Local\\Temp\\' -or $normalized -match '\.zip\.') {
    Clear-Host
    Write-Host '==========================================================' -ForegroundColor Yellow
    Write-Host '[不能直接在 ZIP 预览窗口里运行]' -ForegroundColor Yellow
    Write-Host '==========================================================' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '请在下载目录中右键 ZIP，选择“全部解压”，再进入解压后的文件夹运行 START_HERE.cmd。'
    Start-Process explorer.exe (Join-Path $env:USERPROFILE 'Downloads')
    Pause-Menu
    exit 20
}

$required = @('package.json','main.js','preload.js','renderer\index.html')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectDir $_)) })
if ($missing.Count -gt 0) {
    Write-Host "[ERROR] 当前目录不是完整项目目录，缺少：$($missing -join '、')" -ForegroundColor Red
    Write-Host '请重新完整解压 ZIP。'
    Pause-Menu
    exit 21
}

while ($true) {
    Clear-Host
    Write-Host '==========================================================' -ForegroundColor Cyan
    Write-Host '  POE2 正则、交易与做装助手 v1.7.7' -ForegroundColor Cyan
    Write-Host '  Windows 启动器热修复版' -ForegroundColor DarkCyan
    Write-Host '==========================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '[1] 检查项目'
    Write-Host '[2] 更新完整 POE2 数据'
    Write-Host '[3] 安装运行库并启动应用（推荐）'
    Write-Host '[4] 仅安装 Electron 运行库'
    Write-Host '[5] 打开运行日志'
    Write-Host '[6] 收集完整诊断信息'
    Write-Host '[7] 退出'
    Write-Host ''
    $choice = Read-Host '请选择 1 到 7'
    try {
        switch ($choice) {
            '1' { [void](Invoke-CmdScript 'CHECK_PROJECT.cmd'); Pause-Menu }
            '2' { [void](Invoke-CmdScript 'UPDATE_FULL_POE2_DATA.cmd'); Pause-Menu }
            '3' { $code = Invoke-PowerShellScript 'RUN_APP.ps1'; if ($code -ne 0) { Pause-Menu } }
            '4' { [void](Invoke-CmdScript 'INSTALL_RUNTIME_DIRECT.cmd'); Pause-Menu }
            '5' { [void](Invoke-CmdScript 'OPEN_RUNTIME_LOG.cmd'); Pause-Menu }
            '6' { [void](Invoke-CmdScript 'COLLECT_DIAGNOSTICS.cmd'); Pause-Menu }
            '7' { exit 0 }
            default { Write-Host '请输入 1 到 7。' -ForegroundColor Yellow; Start-Sleep -Seconds 1 }
        }
    } catch {
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
        Pause-Menu
    }
}
