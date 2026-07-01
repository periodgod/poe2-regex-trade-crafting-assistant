'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

assert.ok(fs.existsSync(path.join(root, 'package-lock.json')));
const main = read('main.js');
const preload = read('preload.js');
const arbitrage = read('renderer/arbitrage.html');
const arbitrageBootstrap = read('renderer/arbitrage-bootstrap.js');
const arbitrageJs = read('renderer/arbitrage.js');
const arbitrageEntry = read('renderer/arbitrage-entry.js');
const arbitrageSource = arbitrage + '\n' + arbitrageJs;
for (const forbidden of [
  'globalShortcut', 'market-search-cache', 'price-search', 'price-checker', 'price-overlay', 'price-result',
  'getPricePreferences', 'savePricePreferences', 'data-center', 'auth:', 'providers:list', 'trade:open', 'safeStorage', 'session.fromPartition'
]) {
  assert.equal(main.includes(forbidden), false, `main.js 残留 ${forbidden}`);
  assert.equal(preload.includes(forbidden), false, `preload.js 残留 ${forbidden}`);
}
assert.ok(main.includes("require('./src/full-snapshot-adapter')"));
assert.ok(main.includes("ipcMain.handle('craft:update-full-snapshot'"));
assert.ok(fs.existsSync(path.join(root, 'src/snapshot-storage.js')));
assert.ok(main.includes('createSnapshotInstallTarget'));
assert.ok(main.includes("workspaceRoot: path.join(userDataRoot, 'snapshot-work')"));
assert.ok(main.includes('activateSnapshot(userDataRoot'));
assert.equal(main.includes('function getPoe2SnapshotWriteRoot'), false);
const updater = read('scripts/update-poe2-full-data.js');
assert.ok(updater.includes('createTemporaryWorkspace'));
assert.ok(updater.includes('os.tmpdir()'));
assert.ok(updater.includes('installSnapshotDirectory'));
assert.ok(updater.includes('writeBufferAtomic'));
assert.ok(updater.includes('.download-'));
assert.ok(updater.includes("path.join(temporary, 'source-downloads')"));
assert.equal(updater.includes("path.join(temporary, '.source')"), false);
assert.equal(updater.includes("path.join(parent, '.poe2-strict-snapshot-')"), false);

for (const key of [
  'e_to_c', 'c_to_e', 'e_to_d', 'd_to_e', 'c_to_d', 'd_to_c',
  'e_to_E', 'E_to_e', 'c_to_E', 'E_to_c', 'd_to_E', 'E_to_d',
  'e_to_C', 'C_to_e', 'c_to_C', 'C_to_c', 'd_to_C', 'C_to_d',
  'E_to_C', 'C_to_E'
]) {
  assert.ok(arbitrageSource.includes(`id="${key}_target"`), `兑换助手缺少 ${key}_target`);
  assert.ok(arbitrageSource.includes(`id="${key}_source"`), `兑换助手缺少 ${key}_source`);
}
assert.ok(arbitrageSource.includes('左：目标物品'));
assert.ok(arbitrageJs.includes('fiveResourceRatioInputV10'));
assert.ok(arbitrageJs.includes('fiveResourceRatioInputV9'));
assert.ok(arbitrage.includes('src="app://local/arbitrage-entry.js?v=1.7.7"'));
assert.equal(arbitrage.includes('src="./arbitrage.js'), false);
assert.equal(arbitrage.includes('src="./arbitrage-bootstrap.js'), false);
assert.ok(arbitrageEntry.includes('window.__POE2_ARBITRAGE_ENTRY_VERSION__ = "1.7.7"'));
assert.ok(arbitrageEntry.includes('window.POE2ArbitrageApp=Object.freeze'));
assert.ok(arbitrageEntry.includes('bootController'));
assert.ok(arbitrageBootstrap.includes('bootController'))
assert.ok(!arbitrageBootstrap.includes('document.createElement("script")'));
assert.equal(/onclick\s*=/.test(arbitrage), false, '兑换助手不得使用内联 onclick');
assert.ok(arbitrage.includes('href="./arbitrage.css"'));
assert.ok(arbitrageJs.includes('window.POE2ArbitrageApp=Object.freeze'));
assert.ok(arbitrageJs.includes('bindActionButtons'));

const invokeChannels = [...preload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)/g)].map((m) => m[1]);
const handledChannels = new Set([...main.matchAll(/ipcMain\.handle\(['"]([^'"]+)/g)].map((m) => m[1]));
for (const channel of invokeChannels) assert.ok(handledChannels.has(channel), `IPC handler missing: ${channel}`);

const removedFiles = [
  'renderer/price-checker.html', 'renderer/price-checker.js', 'renderer/price-overlay.html', 'renderer/price-overlay.js',
  'renderer/price-result.html', 'renderer/price-result.js', 'renderer/data-center.html', 'renderer/data-center.js',
  'src/market-search-cache.js', 'src/providers.js', 'data/poe2-crafting-v1.json',
  'data-v2/bases/equipment.json', 'data-v2/bases/maps.json', 'data-v2/modifiers/normal.json'
];
for (const file of removedFiles) assert.equal(fs.existsSync(path.join(root, file)), false, file);

const snapshot = JSON.parse(read('data-snapshot/manifest.json'));
assert.equal(snapshot.schemaVersion, 2);
assert.ok(['not-downloaded', 'ready'].includes(snapshot.status));
if (snapshot.status === 'ready') {
  assert.equal(snapshot.strictBasePools, true);
  assert.ok(Number(snapshot.counts?.exactBasePools || 0) >= 60);
  assert.ok(Number(snapshot.counts?.concreteBaseItems || 0) >= 1000);
  assert.ok(Number(snapshot.counts?.modifierTiers || 0) >= 10000);
} else {
  assert.equal(snapshot.strictBasePools, false);
}

const currencyRules = JSON.parse(read('data-v2/currencies/core.json')).records;
assert.ok(currencyRules.length >= 29);
assert.equal(currencyRules.filter((currency) => currency.implementationStatus === 'ready').length, 29);
assert.ok(currencyRules.every((currency) => ['ready', 'reference-only'].includes(currency.implementationStatus)));
assert.equal(currencyRules.find((currency) => currency.id === 'altered_collarbone').implementationStatus, 'reference-only');
assert.ok(currencyRules.every((currency) => Array.isArray(currency.inputRarities) && currency.inputRarities.length));
assert.equal(currencyRules.find((x) => x.id === 'greater_exalt').minModifierLevel, 35);
assert.equal(currencyRules.find((x) => x.id === 'perfect_exalt').minModifierLevel, 50);
assert.equal(currencyRules.find((x) => x.id === 'fracturing').minExplicitAffixes, 4);

const { loadPoe2CatalogSync, summarizePoe2Catalog } = require('../src/poe2-catalog-repository');
const catalog = loadPoe2CatalogSync(path.join(root, 'data-catalog'), path.join(root, 'data-snapshot'));
const summary = summarizePoe2Catalog(catalog);
assert.equal(summary.coreCurrencyCount, 37);
assert.equal(summary.abyssalBoneCount, 12);
assert.equal(summary.currencyCount, 79);
assert.equal(catalog.probabilityPolicy.allowEstimatedWeights, false);
const coreCatalog = JSON.parse(read('data-catalog/currencies/core.json')).records;
assert.equal(coreCatalog.length, 37);
assert.ok(coreCatalog.every((currency) => currency.usage && currency.usage.simulatorSupport));
const boneCatalog = JSON.parse(read('data-catalog/currencies/abyssal-bones.json')).records;
assert.equal(boneCatalog.length, 12);
assert.equal(boneCatalog.filter((currency) => currency.usage?.simulatorSupport === 'full-state-machine').length, 11);
assert.equal(boneCatalog.filter((currency) => currency.usage?.simulatorSupport === 'reference-only').length, 1);
assert.equal(currencyRules.find((x) => x.id === 'preserved_vertebrae').allowedBaseTags[0], 'waystone');

const installer = read('INSTALL_RUNTIME_DIRECT.cmd');
const verboseInstaller = read('INSTALL_RUNTIME_VERBOSE.cmd');
const downloadUrlChecker = read('CHECK_DOWNLOAD_URL.cmd');
const verifier = read('VERIFY_ELECTRON_CHECKSUM.ps1');
assert.equal(fs.readFileSync(path.join(root, 'INSTALL_RUNTIME_DIRECT.cmd')).subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), false, 'CMD 不得带 UTF-8 BOM');
assert.ok(installer.includes('goto :ZIP_PREVIEW_ERROR'), 'ZIP 临时目录必须使用明确跳转');
assert.ok(installer.includes(':MISSING_PROJECT_ERROR'), '必须有独立缺文件错误分支');
assert.equal(/if not errorlevel 1 \([\s\S]{0,500}?exit \/b 20/.test(installer), false, '不得在临时目录括号块内 exit /b 后继续执行');
const runWrapper = read('RUN_APP.cmd');
const startWrapper = read('START_HERE.cmd');
const runPowerShell = read('RUN_APP.ps1');
const startPowerShell = read('START_HERE.ps1');
assert.ok(runWrapper.includes('RUN_APP.ps1'), 'RUN_APP.cmd 必须调用 Unicode 安全的 PowerShell 启动器');
assert.ok(startWrapper.includes('START_HERE.ps1'), 'START_HERE.cmd 必须调用 Unicode 安全的 PowerShell 菜单');
assert.ok(runPowerShell.includes('AppData') && runPowerShell.includes('Temp'), 'PowerShell 启动器必须检测 ZIP 临时目录');
assert.ok(startPowerShell.includes('AppData') && startPowerShell.includes('Temp'), 'PowerShell 菜单必须检测 ZIP 临时目录');
for (const cmdName of fs.readdirSync(root).filter((name) => name.endsWith('.cmd'))) {
  const bytes = fs.readFileSync(path.join(root, cmdName));
  const bareLf = bytes.toString('binary').replace(/\r\n/g, '').includes('\n');
  assert.equal(bareLf, false, `${cmdName} 必须使用 Windows CRLF 换行`);
}
assert.ok(fs.existsSync(path.join(root, 'START_HERE.cmd')));
assert.ok(installer.includes("require('./package.json').devDependencies.electron"), 'Electron 版本必须由 package.json 动态读取');
assert.ok(installer.includes('npm install --ignore-scripts'), '必须先禁止 Electron postinstall 自动执行');
assert.ok(installer.includes('VERIFY_ELECTRON_CHECKSUM.ps1'));
assert.ok(installer.includes('OFFICIAL_PART'), '校验失败后必须使用独立的官方临时文件');
assert.ok(installer.includes('The cached or mirror Electron ZIP did not pass official verification.'));
assert.ok(installer.includes('Re-verifying the official download...'));
assert.ok(installer.includes('del /q "%ZIP_PATH%"'), '错误缓存必须删除');
assert.ok(installer.includes('-o "%DOWNLOAD_PART%"'), '首次下载不得直接写入最终 ZIP');
assert.ok(verboseInstaller.includes('INSTALL_RUNTIME_DIRECT.cmd'), '详细日志安装也必须复用安全安装流程');
assert.equal(verboseInstaller.includes('npm install --no-audit'), false, '详细日志安装不得重新启用 Electron postinstall');
assert.ok(downloadUrlChecker.includes("require('./package.json').devDependencies.electron"), '下载地址检查器也必须动态读取 Electron 版本');
assert.ok(verifier.includes('Get-FileHash'));
assert.ok(verifier.includes('Get-AuthenticodeSignature'));
assert.ok(verifier.includes('Test-ZipEntrySafety'));
assert.ok(verifier.includes('api.github.com/repos/electron/electron/releases/tags/'));
assert.ok(verifier.includes('asset.digest'));
assert.ok(verifier.includes('does not match requested Electron'));
assert.ok(verifier.includes('is extracted to a temporary probe directory but is not executed'));
assert.equal(/Start-Process\s+.*electron|&\s*\$exe/.test(verifier), false, '校验阶段不得执行下载到的 electron.exe');

const sourceFiles = [];
assert.ok(fs.existsSync(path.join(root, 'src/zh-localization.js')));
assert.ok(read('src/full-snapshot-adapter.js').includes("require('./zh-localization')"));
assert.ok(read('renderer/crafting-planner.html').includes('严格底材分池'));
assert.equal(read('renderer/crafting-planner.html').includes('Strict Base Pools'), false);

for (const folder of ['renderer', 'src']) {
  for (const name of fs.readdirSync(path.join(root, folder))) {
    if (/\.(js|html|css)$/.test(name)) sourceFiles.push(`${folder}/${name}`);
  }
}
for (const file of sourceFiles) {
  const source = read(file);
  for (const forbidden of ['price-checker', 'price-overlay', 'price-result', 'market-search-cache', 'login-panel']) {
    assert.equal(source.includes(forbidden), false, `${file} 残留 ${forbidden}`);
  }
}
console.log('project-integrity tests passed');
