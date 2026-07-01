'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const required = [
  'renderer/index.html', 'renderer/app.js', 'renderer/regex-generator.html', 'renderer/regex-generator.css', 'renderer/regex-generator.js',
  'renderer/arbitrage.html', 'renderer/arbitrage-entry.js', 'renderer/market-monitor.html', 'renderer/market-monitor.js', 'renderer/crafting-planner.html', 'renderer/crafting-planner.js',
  'data/regex-presets.json', 'data-v2/manifest.json', 'data-catalog/manifest.json', 'data-snapshot/manifest.json'
];
for (const file of required) assert.equal(fs.existsSync(path.join(root, file)), true, file);
for (const removed of [
  'renderer/price-checker.html', 'renderer/price-checker.js', 'renderer/price-overlay.html', 'renderer/price-overlay.js',
  'renderer/price-result.html', 'renderer/price-result.js', 'renderer/data-center.html', 'renderer/data-center.js',
  'src/market-search-cache.js'
]) assert.equal(fs.existsSync(path.join(root, removed)), false, `应删除 ${removed}`);

const index = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
for (const id of ['openRegexButton', 'openArbitrageButton', 'openMarketButton', 'openCraftingButton']) assert.ok(index.includes(`id="${id}"`), id);
assert.equal((index.match(/class="module-card/g) || []).length, 4);
for (const forbidden of ['官方交易登录', 'providerSelect', 'loginButton', 'importButton', 'tradeButton', 'clearButton']) assert.equal(index.includes(forbidden), false, forbidden);

const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
for (const method of [
  'openRegexGenerator', 'openArbitrageAssistant', 'openMarketMonitor', 'openCraftingPlanner', 'generateRegex', 'getRegexWorkspace',
  'saveRegexWorkspace', 'createCraftingState', 'previewCraftingCurrency', 'applyCraftingCurrency', 'previewCraftingSpecialAction', 'applyCraftingSpecialAction',
  'readCraftingItemClipboard', 'updateFullPoe2Data', 'getArbitrageState', 'saveArbitrageState',
  'reportRuntimeDiagnostic', 'getRuntimeDiagnostics', 'openRuntimeLog', 'getMarketMonitorState', 'saveMarketMonitorState', 'checkMarketMonitor', 'openMarketExternal'
]) assert.ok(preload.includes(method), method);
for (const forbidden of ['getPricePreferences', 'savePricePreferences', 'openPrice', 'getDataCenterState', 'getProviders', 'getAuthStatus', 'openLoginWindow', 'saveManualCookie', 'openTrade']) assert.equal(preload.includes(forbidden), false, forbidden);

const craftingHtml = fs.readFileSync(path.join(root, 'renderer/crafting-planner.html'), 'utf8');
for (const id of ['existingModifierPicker', 'existingTierPicker', 'createStateButton', 'previewCurrencyButton', 'applyCurrencyButton', 'stateView', 'importClipboardButton', 'updateDataButton', 'currencyCatalog', 'operationKindSelect', 'augmentSocketCapacityInput', 'augmentSlotSelect']) assert.ok(craftingHtml.includes(`id="${id}"`), id);
const craftingJs = fs.readFileSync(path.join(root, 'renderer/crafting-planner.js'), 'utf8');
assert.ok(craftingJs.includes('allowedBaseIds'));
assert.ok(craftingJs.includes('readCraftingItemClipboard'));
assert.ok(craftingJs.includes('snapshotAdapterSummary'));
assert.ok(craftingJs.includes('社区推导数据'));
assert.ok(craftingJs.includes('function listValue(value)'));
assert.ok(craftingJs.includes('triggerCurrencies.join'));

const regexHtml = fs.readFileSync(path.join(root, 'renderer/regex-generator.html'), 'utf8');
for (const id of ['scopeList', 'tabletViews', 'identifyBtn', 'readClipboardBtn', 'conditionRoot', 'output']) assert.ok(regexHtml.includes(`id="${id}"`), id);
const regexJs = fs.readFileSync(path.join(root, 'renderer/regex-generator.js'), 'utf8');
for (const text of ['TABLET_DB.mods.length', 'merged-regex-v2', 'getRegexWorkspace', 'parseTabletText', 'raw=p?.payload']) assert.ok(regexJs.includes(text), text);


const marketHtml = fs.readFileSync(path.join(root, 'renderer/market-monitor.html'), 'utf8');
for (const id of ['tradeUrlInput', 'bulkUrlsInput', 'sessionCookieInput', 'currencySelect', 'minPriceInput', 'maxPriceInput', 'addProjectButton', 'startSelectedButton', 'stopButton', 'projectList', 'resultList']) assert.ok(marketHtml.includes(`id="${id}"`), id);
const marketJs = fs.readFileSync(path.join(root, 'renderer/market-monitor.js'), 'utf8');
for (const text of ['checkMarketMonitor', 'openMarketExternal', 'runSerialScheduler', 'priceRanges', 'autoCopy']) assert.ok(marketJs.includes(text), text);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.version, '1.9.0');
assert.equal(pkg.name, 'poe2-regex-trade-crafting-assistant');
console.log('ui-smoke tests passed');
