'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  clipboard,
  shell
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { parseItemText } = require('./src/item-parser');
const { resolveImportedItem } = require('./src/item-import-resolver');
const { generatePoeQuery, testPoeQuery } = require('./src/regex-engine');
const { analyzeCraft } = require('./src/crafting-engine');
const {
  loadCraftingDataV2Sync,
  toLegacyCraftingData,
  summarizeDataV2
} = require('./src/crafting-data-repository');
const { createItemState, affixCounts } = require('./src/item-state');
const {
  canApplyCurrency,
  applyCurrencySample,
  previewCurrencyOutcomes,
  buildDesecratedRevealOptions,
  applyDesecratedReveal
} = require('./src/currency-state-machine');
const {
  previewSpecialAction,
  applySpecialAction
} = require('./src/crafting-special-actions');
const { checkMarketMonitor } = require('./src/market-monitor');
const {
  readStore: readAppStoreFile,
  updateStore: updateAppStoreFile,
  addHistory
} = require('./src/app-store');
const { updateFullData } = require('./scripts/update-poe2-full-data');
const {
  resolveSnapshotReadRoot,
  createSnapshotInstallTarget,
  activateSnapshot,
  cleanupOldSnapshots
} = require('./src/snapshot-storage');
const {
  loadFullSnapshotDataV2Sync,
  summarizeFullSnapshotData,
  clearFullSnapshotCache
} = require('./src/full-snapshot-adapter');
const {
  initializeRuntimeLogger,
  getRuntimeLogPath,
  appendRuntimeLog,
  readRuntimeLogTail
} = require('./src/runtime-logger');

app.commandLine.appendSwitch('log-level', '2');
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false
  }
}]);

const RENDERER_ROOT = path.join(__dirname, 'renderer');
const APP_STORE_FILENAME = 'assistant-store.json';
const BUILTIN_CRAFTING_DATA_V2_ROOT = path.join(__dirname, 'data-v2');
const LOCAL_DATA_SNAPSHOT_ROOT = path.join(__dirname, 'data-snapshot');
const BUILTIN_REGEX_PRESETS_PATH = path.join(__dirname, 'data', 'regex-presets.json');
const CURRENCY_CATALOG_PATHS = [
  path.join(__dirname, 'data-catalog', 'currencies', 'core.json'),
  path.join(__dirname, 'data-catalog', 'currencies', 'catalysts.json'),
  path.join(__dirname, 'data-catalog', 'currencies', 'splinters.json'),
  path.join(__dirname, 'data-catalog', 'currencies', 'abyssal-bones.json')
];

let mainWindow = null;
let arbitrageWindow = null;
let regexWindow = null;
let craftingWindow = null;
let marketWindow = null;
let fullDataUpdatePromise = null;


function errorDetails(error) {
  if (!error) return '';
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error, null, 2);
  } catch (_jsonError) {
    return String(error);
  }
}

function rendererConsolePayload(args) {
  // Electron 40 passes a details object; older versions pass level/message/line/sourceId.
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    const details = args[0];
    return {
      level: details.level || 'info',
      message: details.message || '',
      lineNumber: details.lineNumber || 0,
      sourceId: details.sourceId || ''
    };
  }
  return {
    level: ['debug', 'info', 'warning', 'error'][Number(args[0])] || String(args[0] || 'info'),
    message: String(args[1] || ''),
    lineNumber: Number(args[2] || 0),
    sourceId: String(args[3] || '')
  };
}

function attachWindowDiagnostics(window, windowName) {
  const contents = window.webContents;
  appendRuntimeLog('info', `window:${windowName}`, '创建窗口');

  contents.on('did-start-loading', () => {
    appendRuntimeLog('info', `window:${windowName}`, '开始加载页面', contents.getURL());
  });
  contents.on('did-finish-load', () => {
    appendRuntimeLog('info', `window:${windowName}`, '页面加载完成', contents.getURL());
  });
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    appendRuntimeLog('error', `window:${windowName}`, '页面加载失败', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });
  contents.on('console-message', (...callbackArgs) => {
    let args;
    const first = callbackArgs[0];
    const second = callbackArgs[1];
    if (first && typeof first === 'object' && typeof first.message === 'string' && typeof first.level === 'string') {
      // Electron current API: callback receives the details object directly.
      args = [first];
    } else if (second && typeof second === 'object' && typeof second.message === 'string') {
      // Compatibility with builds that provide an Event before details.
      args = [second];
    } else {
      // Deprecated API: Event, level, message, line, sourceId.
      args = callbackArgs.slice(1);
    }
    const payload = rendererConsolePayload(args);
    appendRuntimeLog(payload.level, `renderer:${windowName}`, payload.message, {
      sourceId: payload.sourceId,
      lineNumber: payload.lineNumber,
      url: contents.getURL()
    });
  });
  contents.on('preload-error', (_event, preloadPath, error) => {
    appendRuntimeLog('error', `preload:${windowName}`, `预加载脚本失败：${preloadPath}`, errorDetails(error));
  });
  contents.on('render-process-gone', (_event, details) => {
    appendRuntimeLog('error', `renderer:${windowName}`, '渲染进程退出', details);
  });
  contents.on('unresponsive', () => {
    appendRuntimeLog('warning', `renderer:${windowName}`, '窗口无响应', contents.getURL());
  });
}

function mimeType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon'
  };
  return types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const requestUrl = new URL(request.url);
    const pathname = decodeURIComponent(requestUrl.pathname || '/index.html');
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const root = path.resolve(RENDERER_ROOT);
    const resolvedPath = path.resolve(RENDERER_ROOT, relativePath);
    if (resolvedPath !== path.join(root, 'index.html') && !resolvedPath.startsWith(`${root}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const body = await fs.promises.readFile(resolvedPath);
      if (/\.(?:js|html|css)$/i.test(resolvedPath)) {
        appendRuntimeLog('debug', 'protocol', `提供资源 ${relativePath}`, {
          bytes: body.length,
          mime: mimeType(resolvedPath)
        });
      }
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mimeType(resolvedPath),
          'Content-Length': String(body.length),
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        }
      });
    } catch (error) {
      appendRuntimeLog('error', 'protocol', `资源不存在：${relativePath}`, errorDetails(error));
      return new Response('Not found', { status: 404 });
    }
  });
}

function assistantStorePath() {
  return path.join(app.getPath('userData'), APP_STORE_FILENAME);
}

async function readAssistantStore() {
  return readAppStoreFile(assistantStorePath());
}

async function updateAssistantStore(updater) {
  return updateAppStoreFile(assistantStorePath(), updater);
}

async function readBundledJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
}

async function requestExternalJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Math.min(30000, Number(options.timeoutMs) || 12000)));
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': `POE2-Desktop-Assistant/${app.getVersion()} local-market-monitor`
      }
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`集市请求失败：HTTP ${response.status}`);
      error.status = response.status;
      error.body = text.slice(0, 600);
      error.retryAfter = response.headers.get('retry-after') || null;
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      const error = new Error('集市接口没有返回 JSON，可能是搜索链接失效或被临时限流。');
      error.cause = cause;
      error.body = text.slice(0, 600);
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function safeExternalHttpUrl(value) {
  const url = new URL(String(value || ''));
  if (!/^https?:$/.test(url.protocol)) throw new Error('只能打开 http/https 链接。');
  return url.toString();
}

function readSnapshotManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  } catch (_error) {
    return { status: 'missing', errors: [] };
  }
}

function getPoe2SnapshotResolution() {
  return resolveSnapshotReadRoot({
    userDataRoot: app.getPath('userData'),
    bundledRoot: LOCAL_DATA_SNAPSHOT_ROOT
  });
}

function getPoe2SnapshotReadRoot() {
  return getPoe2SnapshotResolution().root;
}

function getMetadataRepository() {
  return loadCraftingDataV2Sync(BUILTIN_CRAFTING_DATA_V2_ROOT);
}

function getStrictCraftingRepository(snapshotRoot = getPoe2SnapshotReadRoot()) {
  const metadata = getMetadataRepository();
  const manifest = readSnapshotManifest(snapshotRoot);
  if (manifest.status !== 'ready') {
    const error = new Error('严格词缀快照尚未安装。为避免武器错误继承防具/首饰词缀，做装模拟已暂停。请先更新完整数据。');
    error.code = 'CRAFT_DATA_NOT_READY';
    error.snapshot = manifest;
    throw error;
  }
  try {
    return loadFullSnapshotDataV2Sync(snapshotRoot, metadata);
  } catch (cause) {
    const error = new Error(`严格词缀快照校验失败：${cause.message}。系统不会回退到演示词缀池。`);
    error.code = 'CRAFT_DATA_INVALID';
    error.snapshot = manifest;
    throw error;
  }
}

function strictCraftingContext() {
  const metadata = getMetadataRepository();
  const resolution = getPoe2SnapshotResolution();
  const snapshotRoot = resolution.root;
  const manifest = readSnapshotManifest(snapshotRoot);
  try {
    const data = getStrictCraftingRepository(snapshotRoot);
    return {
      dataReady: true,
      data: toLegacyCraftingData(data),
      repositorySummary: summarizeFullSnapshotData(data),
      snapshot: manifest,
      snapshotStorage: {
        source: resolution.source,
        pointerRecovered: Boolean(resolution.pointerRecovered)
      },
      dataError: null
    };
  } catch (error) {
    return {
      dataReady: false,
      data: {
        schemaVersion: 2,
        dataVersion: metadata.dataVersion,
        source: metadata.source,
        bases: [],
        modifiers: [],
        currencies: metadata.currencies,
        omens: metadata.omens
      },
      repositorySummary: {
        ...summarizeDataV2(metadata),
        baseCount: 0,
        modifierCount: 0,
        tierCount: 0,
        strictPoolRequired: true
      },
      snapshot: manifest,
      snapshotStorage: {
        source: resolution.source,
        pointerRecovered: Boolean(resolution.pointerRecovered),
        missingFiles: resolution.missingFiles || []
      },
      dataError: error.message
    };
  }
}

function createSeededRandom(seedValue) {
  let state = (Number(seedValue) || Date.now()) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function serializeCraftingState(state) {
  return { ...state, counts: affixCounts(state) };
}

async function getRegexPresets() {
  const [bundled, store] = await Promise.all([
    readBundledJson(BUILTIN_REGEX_PRESETS_PATH),
    readAssistantStore()
  ]);
  return [
    ...(bundled.presets || []).map((preset) => ({ ...preset, userDefined: false })),
    ...(store.regexPresets || []).map((preset) => ({ ...preset, userDefined: true }))
  ];
}

async function recordAssistantHistory(entry) {
  return updateAssistantStore((store) => addHistory(store, entry));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#0b1018',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  attachWindowDiagnostics(mainWindow, 'main');
  mainWindow.loadURL('app://local/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function localToolWindowOptions({ width, height, minWidth, minHeight }) {
  return {
    width,
    height,
    minWidth,
    minHeight,
    backgroundColor: '#081018',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  };
}

function openSingletonLocalTool(kind) {
  const definitions = {
    regex: { page: 'regex-generator.html', options: { width: 1600, height: 980, minWidth: 1180, minHeight: 760 } },
    crafting: { page: 'crafting-planner.html', options: { width: 1500, height: 960, minWidth: 1080, minHeight: 740 } },
    market: { page: 'market-monitor.html', options: { width: 1460, height: 940, minWidth: 1080, minHeight: 720 } }
  };
  const definition = definitions[kind];
  if (!definition) throw new Error(`未知本地工具：${kind}`);
  const existing = kind === 'regex' ? regexWindow : (kind === 'crafting' ? craftingWindow : marketWindow);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return { ok: true, reused: true };
  }
  const window = new BrowserWindow(localToolWindowOptions(definition.options));
  if (kind === 'regex') regexWindow = window;
  else if (kind === 'crafting') craftingWindow = window;
  else marketWindow = window;
  attachWindowDiagnostics(window, kind);
  window.loadURL(`app://local/${definition.page}?v=1.8.0`);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (kind === 'regex') regexWindow = null;
    else if (kind === 'crafting') craftingWindow = null;
    else marketWindow = null;
  });
  return { ok: true, reused: false };
}

function openArbitrageWindow() {
  if (arbitrageWindow && !arbitrageWindow.isDestroyed()) {
    arbitrageWindow.focus();
    return { ok: true };
  }
  arbitrageWindow = new BrowserWindow(localToolWindowOptions({ width: 1400, height: 900, minWidth: 980, minHeight: 700 }));
  attachWindowDiagnostics(arbitrageWindow, 'arbitrage');
  arbitrageWindow.loadURL('app://local/arbitrage.html?v=1.8.0');
  arbitrageWindow.once('ready-to-show', () => arbitrageWindow.show());
  arbitrageWindow.on('closed', () => { arbitrageWindow = null; });
  return { ok: true };
}

function trustedRenderer(event) {
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'app:' && url.hostname === 'local';
  } catch (_error) {
    return false;
  }
}

function requireTrustedRenderer(event) {
  if (!trustedRenderer(event)) throw new Error('拒绝来自非本地页面的调用。');
}

function strictDataOrThrow() {
  return getStrictCraftingRepository();
}

function registerIpcHandlers() {
  ipcMain.handle('clipboard:read-text', (event) => {
    requireTrustedRenderer(event);
    return { text: clipboard.readText('clipboard') };
  });
  ipcMain.handle('clipboard:copy-text', (event, text) => {
    requireTrustedRenderer(event);
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('regex:open', (event) => {
    requireTrustedRenderer(event);
    return openSingletonLocalTool('regex');
  });
  ipcMain.handle('regex:generate', async (event, payload) => {
    requireTrustedRenderer(event);
    const result = generatePoeQuery(payload || {});
    if (result?.query) {
      await recordAssistantHistory({
        type: 'regex',
        title: `正则生成 · ${payload?.scope || 'equipment'}`,
        summary: result.query,
        payload: { input: payload, result }
      });
    }
    return result;
  });
  ipcMain.handle('regex:test', (event, payload) => {
    requireTrustedRenderer(event);
    return testPoeQuery(payload || {});
  });
  ipcMain.handle('regex:presets-list', async (event) => {
    requireTrustedRenderer(event);
    return getRegexPresets();
  });
  ipcMain.handle('regex:preset-save', async (event, payload) => {
    requireTrustedRenderer(event);
    const source = payload && typeof payload === 'object' ? payload : {};
    const body = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
      ? { ...source.payload, id: source.id, name: source.name || source.payload.name, description: source.description || source.payload.description }
      : source;
    const id = String(body?.id || `user-${Date.now()}`).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
    const conditionArray = (value) => Array.isArray(value) ? JSON.parse(JSON.stringify(value.slice(0, 250))) : [];
    const preset = {
      id,
      name: String(body?.name || '未命名预设').slice(0, 80),
      description: String(body?.description || '').slice(0, 240),
      format: String(body?.format || 'merged-regex-v2'),
      schemaVersion: Number(body?.schemaVersion || 2),
      scope: String(body?.scope || body?.category || 'equipment').slice(0, 40),
      category: String(body?.category || body?.scope || 'equipment').slice(0, 40),
      locale: ['zh', 'en'].includes(body?.locale) ? body.locale : 'zh',
      tabletView: ['mods', 'uniques', 'bases'].includes(body?.tabletView) ? body.tabletView : 'mods',
      must: conditionArray(body?.must),
      any: conditionArray(body?.any),
      exclude: conditionArray(body?.exclude),
      numeric: conditionArray(body?.numeric),
      characterLimit: Number.isFinite(Number(body?.characterLimit ?? body?.limit))
        ? Math.max(1, Math.min(5000, Number(body.characterLimit ?? body.limit)))
        : 250,
      updatedAt: new Date().toISOString()
    };
    await updateAssistantStore((store) => {
      const index = store.regexPresets.findIndex((entry) => entry.id === id);
      if (index >= 0) store.regexPresets[index] = preset;
      else store.regexPresets.unshift(preset);
      return store;
    });
    return { ok: true, preset };
  });
  ipcMain.handle('regex:preset-delete', async (event, presetId) => {
    requireTrustedRenderer(event);
    await updateAssistantStore((store) => {
      store.regexPresets = store.regexPresets.filter((preset) => preset.id !== presetId);
      return store;
    });
    return { ok: true };
  });
  ipcMain.handle('regex:workspace-get', async (event) => {
    requireTrustedRenderer(event);
    return (await readAssistantStore()).regexWorkspace;
  });
  ipcMain.handle('regex:workspace-save', async (event, workspace) => {
    requireTrustedRenderer(event);
    const updated = await updateAssistantStore((store) => {
      store.regexWorkspace = { ...(workspace || {}), savedAt: new Date().toISOString() };
      return store;
    });
    return { ok: true, workspace: updated.regexWorkspace };
  });
  ipcMain.handle('regex:record-result', async (event, payload) => {
    requireTrustedRenderer(event);
    await recordAssistantHistory({
      type: 'regex-copy',
      title: `复制正则 · ${payload?.scope || 'unknown'}`,
      summary: String(payload?.query || '').slice(0, 400),
      payload
    });
    return { ok: true };
  });

  ipcMain.handle('craft:open', (event) => {
    requireTrustedRenderer(event);
    return openSingletonLocalTool('crafting');
  });
  ipcMain.handle('craft:context', async (event) => {
    requireTrustedRenderer(event);
    const [context, store, ...currencyDocuments] = await Promise.all([
      Promise.resolve(strictCraftingContext()),
      readAssistantStore(),
      ...CURRENCY_CATALOG_PATHS.map((filePath) => readBundledJson(filePath))
    ]);
    const currencyCatalog = currencyDocuments.flatMap((document) => document.records || []);
    return {
      ...context,
      prices: store.currencyPrices,
      currencyCatalog,
      stateMachineAvailable: context.dataReady,
      updateRunning: Boolean(fullDataUpdatePromise)
    };
  });
  ipcMain.handle('craft:read-item-clipboard', (event) => {
    requireTrustedRenderer(event);
    const text = clipboard.readText('clipboard');
    if (!text.trim()) throw new Error('剪贴板为空。请先在游戏中复制物品文本。');
    const parsed = parseItemText(text);
    if (!parsed.ok) throw new Error(parsed.error || parsed.message || '无法识别剪贴板中的物品。');
    const resolution = resolveImportedItem(strictDataOrThrow(), parsed.item);
    return { ...parsed, resolution };
  });
  ipcMain.handle('craft:state-create', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload || {});
    return {
      ok: true,
      state: serializeCraftingState(state),
      availability: data.currencies.map((currency) => ({ id: currency.id, name: currency.name, ...canApplyCurrency(data, state, currency.id) }))
    };
  });
  ipcMain.handle('craft:currency-preview', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload?.state || {});
    const currencyId = String(payload?.currencyId || '');
    const preview = previewCurrencyOutcomes(data, state, currencyId, {
      samples: payload?.samples,
      seed: payload?.seed
    });
    const limit = Math.max(1, Math.min(100, Number(payload?.limit) || 30));
    return {
      ...preview,
      state: serializeCraftingState(state),
      outcomes: (preview.outcomes || []).slice(0, limit).map((entry) => ({
        ...entry,
        state: serializeCraftingState(entry.state)
      }))
    };
  });
  ipcMain.handle('craft:currency-apply', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload?.state || {});
    const currencyId = String(payload?.currencyId || '');
    const seed = Number(payload?.seed) || Date.now();
    const result = applyCurrencySample(data, state, currencyId, { rng: createSeededRandom(seed), putrefactionCount: payload?.putrefactionCount });
    return {
      ok: true,
      seed,
      currency: result.currency,
      state: serializeCraftingState(result.state),
      added: result.added,
      removed: result.removed,
      fractured: result.fractured || [],
      consumedOmens: result.consumedOmens
    };
  });

  ipcMain.handle('craft:special-preview', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload?.state || {});
    const preview = previewSpecialAction(data, state, payload || {});
    const limit = Math.max(1, Math.min(100, Number(payload?.limit) || 50));
    return {
      ...preview,
      state: serializeCraftingState(state),
      outcomes: (preview.outcomes || []).slice(0, limit).map((entry) => ({
        ...entry,
        state: serializeCraftingState(entry.state)
      }))
    };
  });
  ipcMain.handle('craft:special-apply', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload?.state || {});
    const seed = Number(payload?.seed) || Date.now();
    const result = applySpecialAction(data, state, { ...(payload || {}), seed });
    return {
      ...result,
      seed,
      state: serializeCraftingState(result.state)
    };
  });

  ipcMain.handle('craft:desecrated-reveal-preview', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload?.state || {});
    const result = buildDesecratedRevealOptions(data, state, {
      instanceId: payload?.instanceId,
      seed: payload?.seed,
      rerollIndex: payload?.rerollIndex
    });
    return { ...result, state: serializeCraftingState(state) };
  });
  ipcMain.handle('craft:desecrated-reveal-apply', async (event, payload) => {
    requireTrustedRenderer(event);
    const data = strictDataOrThrow();
    const state = createItemState(data, payload?.state || {});
    const result = applyDesecratedReveal(data, state, {
      instanceId: payload?.instanceId,
      seed: payload?.seed,
      rerollIndex: payload?.rerollIndex,
      modifierId: payload?.modifierId,
      tier: payload?.tier
    });
    return { ...result, state: serializeCraftingState(result.state) };
  });

  ipcMain.handle('craft:analyze', async (event, payload) => {
    requireTrustedRenderer(event);
    const [data, store] = await Promise.all([Promise.resolve(strictDataOrThrow()), readAssistantStore()]);
    const result = analyzeCraft(toLegacyCraftingData(data), payload?.input || {}, {
      ...(payload?.options || {}),
      prices: { ...store.currencyPrices, ...(payload?.options?.prices || {}) }
    });
    await recordAssistantHistory({
      type: 'craft',
      title: `做装方案 · ${result.input.baseName}`,
      summary: result.bestStrategy
        ? `${result.bestStrategy.name}，成功率 ${(result.bestStrategy.successRate * 100).toFixed(2)}%`
        : '没有可达路线',
      payload: result
    });
    return result;
  });
  ipcMain.handle('craft:prices-save', async (event, prices) => {
    requireTrustedRenderer(event);
    const cleaned = {};
    for (const [key, value] of Object.entries(prices || {})) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) cleaned[key] = number;
    }
    const store = await updateAssistantStore((current) => {
      current.currencyPrices = { ...current.currencyPrices, ...cleaned };
      return current;
    });
    return { ok: true, prices: store.currencyPrices };
  });
  ipcMain.handle('craft:update-full-snapshot', async (event) => {
    requireTrustedRenderer(event);
    if (fullDataUpdatePromise) throw new Error('完整数据正在更新，请勿重复启动。');
    const userDataRoot = app.getPath('userData');
    const installTarget = createSnapshotInstallTarget(userDataRoot);
    const sender = event.sender;
    const currentSnapshot = getPoe2SnapshotResolution();
    const currentChroniclePath = currentSnapshot?.ready
      ? path.join(currentSnapshot.root, 'chronicle-zh.json')
      : null;
    fullDataUpdatePromise = updateFullData({
      destinationRoot: installTarget.destinationRoot,
      errorRoot: installTarget.errorRoot,
      workspaceRoot: path.join(userDataRoot, 'snapshot-work'),
      chronicleEnabled: true,
      chronicleIncludeBaseItems: true,
      chronicleIncludeLegacy: false,
      chronicleConcurrency: 4,
      chronicleRetries: 1,
      chronicleCachePath: currentChroniclePath && fs.existsSync(currentChroniclePath) ? currentChroniclePath : null,
      onProgress: (progress) => {
        if (!sender.isDestroyed()) sender.send('craft:data-update-progress', progress);
      }
    });
    try {
      const manifest = await fullDataUpdatePromise;
      if (!sender.isDestroyed()) sender.send('craft:data-update-progress', { phase: 'activate' });
      activateSnapshot(userDataRoot, installTarget.destinationRoot);
      clearFullSnapshotCache();
      const activated = getPoe2SnapshotResolution();
      if (!activated.ready || path.resolve(activated.root) !== path.resolve(installTarget.destinationRoot)) {
        throw new Error('严格快照已经生成，但激活校验失败。旧快照仍保持不变。');
      }
      cleanupOldSnapshots(userDataRoot, installTarget.destinationRoot, 3);
      await recordAssistantHistory({
        type: 'data-update',
        title: '更新严格 PoE2 词缀池',
        summary: `${manifest.counts.exactBasePools} 个精确底材池 / ${manifest.counts.modifierPools} 组词缀 / 编年史中文 ${manifest.counts.chronicleMatched || 0}/${manifest.counts.chronicleTargets || 0}`
      });
      return { ok: true, manifest, storage: { source: 'user-data-versioned' } };
    } finally {
      fullDataUpdatePromise = null;
    }
  });

  ipcMain.handle('history:export', async (event) => {
    requireTrustedRenderer(event);
    return { text: JSON.stringify({ exportedAt: new Date().toISOString(), history: (await readAssistantStore()).history }, null, 2) };
  });
  ipcMain.handle('history:clear', async (event) => {
    requireTrustedRenderer(event);
    await updateAssistantStore((store) => { store.history = []; return store; });
    return { ok: true };
  });
  ipcMain.handle('arbitrage:state-get', async (event) => {
    requireTrustedRenderer(event);
    return (await readAssistantStore()).arbitrageState;
  });
  ipcMain.handle('arbitrage:state-save', async (event, data) => {
    requireTrustedRenderer(event);
    const updated = await updateAssistantStore((store) => {
      store.arbitrageState = { version: 1, data: data && typeof data === 'object' ? data : {}, savedAt: new Date().toISOString() };
      return store;
    });
    return { ok: true, savedAt: updated.arbitrageState?.savedAt || null };
  });
  ipcMain.handle('market:open', (event) => {
    requireTrustedRenderer(event);
    return openSingletonLocalTool('market');
  });
  ipcMain.handle('market:state-get', async (event) => {
    requireTrustedRenderer(event);
    return (await readAssistantStore()).marketMonitorState;
  });
  ipcMain.handle('market:state-save', async (event, data) => {
    requireTrustedRenderer(event);
    const updated = await updateAssistantStore((store) => {
      store.marketMonitorState = {
        version: 2,
        activeId: typeof data?.activeId === 'string' ? data.activeId : null,
        monitors: Array.isArray(data?.monitors) ? data.monitors.map((entry) => {
          const clean = entry && typeof entry === 'object' ? { ...entry } : {};
          delete clean.sessionCookie;
          delete clean.authCookie;
          delete clean.cookie;
          return clean;
        }) : [],
        savedAt: new Date().toISOString()
      };
      return store;
    });
    return { ok: true, savedAt: updated.marketMonitorState?.savedAt || null, state: updated.marketMonitorState };
  });
  ipcMain.handle('market:check', async (event, payload) => {
    requireTrustedRenderer(event);
    const monitor = payload && typeof payload === 'object' ? payload : {};
    try {
      const result = await checkMarketMonitor(monitor);
      await recordAssistantHistory({
        type: 'market-monitor',
        title: `集市监控 · ${monitor.name || '未命名'}`,
        summary: `匹配 ${result.matchCount}/${result.fetchedCount}，总结果 ${result.totalResultCount}`,
        payload: {
          monitor: { ...monitor, lastSeenIds: undefined },
          checkedAt: result.checkedAt,
          matchCount: result.matchCount,
          totalResultCount: result.totalResultCount
        }
      });
      return result;
    } catch (error) {
      appendRuntimeLog('warning', 'market-monitor', error.message, errorDetails(error));
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: error.message,
        code: error.code || null,
        status: error.status || null,
        retryAfter: error.retryAfter || error.retryAfterSeconds || null,
        body: error.body || null
      };
    }
  });
  ipcMain.handle('market:open-external', async (event, url) => {
    requireTrustedRenderer(event);
    const safeUrl = safeExternalHttpUrl(url);
    await shell.openExternal(safeUrl);
    return { ok: true, url: safeUrl };
  });
  ipcMain.handle('diagnostics:report', (event, payload) => {
    requireTrustedRenderer(event);
    const data = payload && typeof payload === 'object' ? payload : { message: String(payload || '') };
    appendRuntimeLog(data.level || 'error', data.scope || 'renderer', data.message || '渲染器诊断', data.detail || data.stack || '');
    return { ok: true, logPath: getRuntimeLogPath() };
  });
  ipcMain.handle('diagnostics:get', (event) => {
    requireTrustedRenderer(event);
    return {
      ok: true,
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      currentUrl: event.senderFrame.url,
      userData: app.getPath('userData'),
      logPath: getRuntimeLogPath(),
      logTail: readRuntimeLogTail(96000)
    };
  });
  ipcMain.handle('diagnostics:open-log', (event) => {
    requireTrustedRenderer(event);
    const logPath = getRuntimeLogPath();
    if (!logPath) throw new Error('运行日志尚未初始化。');
    shell.showItemInFolder(logPath);
    return { ok: true, logPath };
  });
  ipcMain.handle('assistant:open', (event) => {
    requireTrustedRenderer(event);
    return openArbitrageWindow();
  });
}

app.whenReady().then(async () => {
  initializeRuntimeLogger(app.getPath('userData'));
  appendRuntimeLog('info', 'main', '应用启动', {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userData: app.getPath('userData'),
    appPath: app.getAppPath()
  });

  process.on('uncaughtException', (error) => {
    appendRuntimeLog('fatal', 'main', '未捕获异常', errorDetails(error));
  });
  process.on('unhandledRejection', (reason) => {
    appendRuntimeLog('error', 'main', '未处理的 Promise 拒绝', errorDetails(reason));
  });

  await registerAppProtocol();
  registerIpcHandlers();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error) => {
  try {
    if (!getRuntimeLogPath()) initializeRuntimeLogger(app.getPath('userData'));
    appendRuntimeLog('fatal', 'main', '应用初始化失败', errorDetails(error));
  } finally {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  appendRuntimeLog('info', 'main', '所有窗口已关闭');
  if (process.platform !== 'darwin') app.quit();
});
