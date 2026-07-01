$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { & "$env:SystemRoot\System32\chcp.com" 65001 | Out-Null } catch {}

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDir
$logDir = Join-Path $projectDir 'logs'
$launcherLog = Join-Path $logDir 'launcher-latest.log'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Stop-WithMessage([string]$message, [int]$code = 1) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
    Write-Host "启动器日志：$launcherLog"
    exit $code
}

function Invoke-CmdScript([string]$name) {
    $path = Join-Path $projectDir $name
    if (-not (Test-Path -LiteralPath $path)) { Stop-WithMessage "缺少脚本：$name" 21 }
    & "$env:SystemRoot\System32\cmd.exe" /d /c "`"$path`""
    return $LASTEXITCODE
}

$normalized = $projectDir.Replace('/', '\')
if ($normalized -match '\\AppData\\Local\\Temp\\' -or $normalized -match '\.zip\.') {
    Write-Host '[请先完整解压 ZIP，不能直接在压缩包预览窗口运行。]' -ForegroundColor Yellow
    Start-Process explorer.exe (Join-Path $env:USERPROFILE 'Downloads')
    exit 20
}

$required = @('package.json','main.js','preload.js','renderer\index.html')
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectDir $_)) })
if ($missing.Count -gt 0) { Stop-WithMessage "缺少项目文件：$($missing -join '、')。请重新完整解压 ZIP。" 21 }

Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host '  POE2 正则、交易与做装助手 v1.7.7' -ForegroundColor Cyan
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host ''

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node) { Stop-WithMessage '未找到 Node.js。请安装 Node.js 22 或 24 LTS。' }
if (-not $npm) { Stop-WithMessage '未找到 npm。请重新安装 Node.js，并确保勾选 Add to PATH。' }

Write-Host "Node：$(& node.exe --version)"
Write-Host "npm：$(& npm.cmd --version)"

$package = Get-Content -LiteralPath (Join-Path $projectDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$requiredElectron = [string]$package.devDependencies.electron
$electronPackagePath = Join-Path $projectDir 'node_modules\electron\package.json'
$electronExe = Join-Path $projectDir 'node_modules\electron\dist\electron.exe'
$installedElectron = ''
if (Test-Path -LiteralPath $electronPackagePath) {
    try { $installedElectron = [string]((Get-Content -LiteralPath $electronPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch {}
}

if (-not (Test-Path -LiteralPath $electronExe) -or $installedElectron -ne $requiredElectron) {
    Write-Host ''
    Write-Host "Electron 运行库需要安装或更新：要求 $requiredElectron，当前 $($installedElectron | ForEach-Object { if($_){$_}else{'未安装'} })" -ForegroundColor Yellow
    $installCode = Invoke-CmdScript 'INSTALL_RUNTIME_DIRECT.cmd'
    if ($installCode -ne 0 -or -not (Test-Path -LiteralPath $electronExe)) {
        Stop-WithMessage 'Electron 运行库安装失败。请运行 COLLECT_DIAGNOSTICS.cmd 后把 poe2-diagnostics.txt 发回来。'
    }
}

$pathTxt = Join-Path $projectDir 'node_modules\electron\path.txt'
[System.IO.File]::WriteAllText($pathTxt, 'electron.exe', [System.Text.Encoding]::ASCII)

Write-Host ''
Write-Host '[1/2] 检查源码、数据规则和自动测试……' -ForegroundColor Cyan
& npm.cmd run check
if ($LASTEXITCODE -ne 0) { Stop-WithMessage '源码或自动测试检查失败。' }

Write-Host ''
Write-Host '[2/2] 启动应用……' -ForegroundColor Cyan
Write-Host "启动器日志：$launcherLog"
& npm.cmd start 2>&1 | Tee-Object -FilePath $launcherLog
$appCode = $LASTEXITCODE
if ($appCode -ne 0) {
    Write-Host ''
    Write-Host '[ERROR] 应用异常退出。' -ForegroundColor Red
    Write-Host "启动器日志：$launcherLog"
    Write-Host "应用运行日志：$env:APPDATA\poe2-regex-trade-crafting-assistant\logs\runtime.log"
    exit $appCode
}
exit 0
