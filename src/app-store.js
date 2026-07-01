'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 4;
const MAX_HISTORY = 200;
const MAX_REGEX_PRESETS = 100;

function defaultStore() {
  return {
    version: STORE_VERSION,
    currencyPrices: {
      transmute: 0.02,
      greater_transmute: 0.1,
      perfect_transmute: 0.5,
      augment: 0.04,
      greater_augment: 0.15,
      perfect_augment: 0.75,
      regal: 0.35,
      greater_regal: 1.5,
      perfect_regal: 5,
      alchemy: 0.1,
      exalt: 1,
      greater_exalt: 4,
      perfect_exalt: 12,
      annul: 2,
      chaos: 1,
      greater_chaos: 4,
      perfect_chaos: 12,
      fracturing: 25,
      prefixOmen: 4,
      suffixOmen: 4,
      essence: 2
    },
    regexPresets: [],
    regexWorkspace: null,
    history: [],
    arbitrageState: null,
    marketMonitorState: null
  };
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function jsonSafeClone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function normalizeArbitrageState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cloned = jsonSafeClone(raw, null);
  if (!cloned || typeof cloned !== 'object') return null;
  return {
    version: Number.isFinite(Number(cloned.version)) ? Number(cloned.version) : 1,
    data: plainObject(cloned.data),
    savedAt: typeof cloned.savedAt === 'string'
      ? cloned.savedAt
      : new Date().toISOString()
  };
}


function normalizeMarketMonitorState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cloned = jsonSafeClone(raw, null);
  if (!cloned || typeof cloned !== 'object') return null;
  const allowedServers = new Set(['poe2-cn', 'poe2-intl', 'poe1-cn', 'poe1-intl']);
  const sanitizeString = (value, fallback = '', max = 2000) => String(value == null || value === '' ? fallback : value).slice(0, max);
  const sanitizeNumberOrBlank = (value) => value === '' || value == null ? '' : (Number.isFinite(Number(value)) ? Number(value) : '');
  const sanitizeCurrencyList = (value, fallback = []) => {
    const rows = Array.isArray(value) ? value : (value ? [value] : fallback);
    return rows.map(item => sanitizeString(item, '', 80)).filter(Boolean).slice(0, 32);
  };
  const sanitizeRanges = (value) => {
    const rows = Array.isArray(value) ? value : Object.entries(plainObject(value)).map(([currency, cfg]) => ({ currency, ...plainObject(cfg) }));
    return rows.slice(0, 40).map((row) => {
      const source = plainObject(row);
      return {
        currency: sanitizeString(source.currency || source.key || source.id, '', 80),
        enabled: source.enabled !== false,
        minPrice: sanitizeNumberOrBlank(source.minPrice ?? source.min),
        maxPrice: sanitizeNumberOrBlank(source.maxPrice ?? source.max)
      };
    }).filter(row => row.currency);
  };
  const monitors = Array.isArray(cloned.monitors)
    ? cloned.monitors.slice(0, 80).map((item, index) => {
      const source = plainObject(item);
      const serverKey = allowedServers.has(source.serverKey) ? source.serverKey : 'poe2-cn';
      const watchName = sanitizeString(source.watchName || source.name || `监控 ${index + 1}`, `监控 ${index + 1}`, 80);
      const currencies = sanitizeCurrencyList(source.currencies, source.priceCurrency || source.currency ? [source.priceCurrency || source.currency] : ['any']);
      return {
        id: sanitizeString(source.id || `monitor-${index + 1}`, `monitor-${index + 1}`, 80).replace(/[^A-Za-z0-9_-]/g, '-'),
        projectType: sanitizeString(source.projectType || 'trade-monitor-package', 'trade-monitor-package', 60),
        serverKey,
        serverLabel: sanitizeString(source.serverLabel || '', '', 80),
        name: watchName,
        watchName,
        url: sanitizeString(source.url || source.tradeUrl || '', '', 2000),
        tradeUrl: sanitizeString(source.tradeUrl || source.url || '', '', 2000),
        currencies,
        priceCurrency: sanitizeString(source.priceCurrency || source.currency || (currencies[0] === 'any' ? '' : currencies[0]), '', 80),
        currency: sanitizeString(source.currency || source.priceCurrency || '', '', 80),
        minPrice: sanitizeNumberOrBlank(source.minPrice),
        maxPrice: sanitizeNumberOrBlank(source.maxPrice),
        priceRanges: sanitizeRanges(source.priceRanges),
        intervalSeconds: Number.isFinite(Number(source.intervalSeconds ?? source.intervalSec)) ? Math.max(10, Math.min(3600, Number(source.intervalSeconds ?? source.intervalSec))) : 90,
        maxFetch: Number.isFinite(Number(source.maxFetch ?? source.limit)) ? Math.max(1, Math.min(50, Number(source.maxFetch ?? source.limit))) : 10,
        pricedOnly: source.pricedOnly !== false,
        onlyPriced: source.onlyPriced !== false && source.pricedOnly !== false,
        onlyOnline: Boolean(source.onlyOnline || source.onlineOnly),
        onlineOnly: Boolean(source.onlineOnly || source.onlyOnline),
        exactOnly: Boolean(source.exactOnly || source.exactPriceOnly),
        exactPriceOnly: Boolean(source.exactPriceOnly || source.exactOnly),
        notifyDesktop: source.notifyDesktop !== false,
        autoOpen: Boolean(source.autoOpen),
        autoCopy: Boolean(source.autoCopy || source.autoCopyWhisper),
        autoCopyWhisper: Boolean(source.autoCopyWhisper || source.autoCopy),
        enabled: source.enabled !== false,
        lastSeenIds: Array.isArray(source.lastSeenIds) ? source.lastSeenIds.slice(0, 200).map(String) : [],
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString()
      };
    })
    : [];
  return {
    version: Number.isFinite(Number(cloned.version)) ? Number(cloned.version) : 2,
    activeId: typeof cloned.activeId === 'string' ? cloned.activeId.slice(0, 80) : (monitors[0]?.id || null),
    monitors,
    savedAt: typeof cloned.savedAt === 'string' ? cloned.savedAt : new Date().toISOString()
  };
}

function normalizeRegexWorkspace(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const source = plainObject(raw);
  const allowedScopes = ['equipment', 'waystone', 'tablet', 'stash', 'advanced'];
  const allowedModes = ['must', 'any', 'exclude'];
  const allowedViews = ['mods', 'uniques', 'bases'];
  const allowedLocales = ['zh', 'en'];
  const allowedSorts = ['source', 'cat'];
  const sanitizeConditions = (value) => Array.isArray(value)
    ? jsonSafeClone(value.slice(0, 250), [])
    : [];

  return {
    schemaVersion: 2,
    scope: allowedScopes.includes(source.scope) ? source.scope : 'equipment',
    locale: allowedLocales.includes(source.locale) ? source.locale : 'zh',
    mode: allowedModes.includes(source.mode) ? source.mode : 'must',
    category: typeof source.category === 'string' ? source.category.slice(0, 80) : '全部',
    affix: typeof source.affix === 'string' ? source.affix.slice(0, 30) : '全部词缀',
    sort: allowedSorts.includes(source.sort) ? source.sort : 'source',
    tabletView: allowedViews.includes(source.tabletView) ? source.tabletView : 'mods',
    must: sanitizeConditions(source.must),
    any: sanitizeConditions(source.any),
    exclude: sanitizeConditions(source.exclude),
    limit: Number.isFinite(Number(source.limit))
      ? Math.max(1, Math.min(5000, Number(source.limit)))
      : 250,
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : new Date().toISOString()
  };
}

function normalizeStore(raw) {
  const base = defaultStore();
  if (!raw || typeof raw !== 'object') return base;

  return {
    version: STORE_VERSION,
    currencyPrices: {
      ...base.currencyPrices,
      ...plainObject(raw.currencyPrices)
    },
    regexPresets: Array.isArray(raw.regexPresets)
      ? jsonSafeClone(raw.regexPresets.slice(0, MAX_REGEX_PRESETS), [])
      : [],
    regexWorkspace: normalizeRegexWorkspace(raw.regexWorkspace),
    history: Array.isArray(raw.history)
      ? jsonSafeClone(raw.history.slice(0, MAX_HISTORY), [])
      : [],
    arbitrageState: normalizeArbitrageState(raw.arbitrageState),
    marketMonitorState: normalizeMarketMonitorState(raw.marketMonitorState)
  };
}

async function parseStoreFile(filePath) {
  const text = await fs.promises.readFile(filePath, 'utf8');
  return normalizeStore(JSON.parse(text));
}

async function readStore(filePath) {
  try {
    return await parseStoreFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        return await parseStoreFile(`${filePath}.bak`);
      } catch (_backupError) {
        return defaultStore();
      }
    }

    try {
      return await parseStoreFile(`${filePath}.bak`);
    } catch (_backupError) {
      return defaultStore();
    }
  }
}

async function writeStore(filePath, store) {
  const normalized = normalizeStore(store);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  const backup = `${filePath}.bak`;

  try {
    await fs.promises.copyFile(filePath, backup);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await fs.promises.writeFile(temporary, JSON.stringify(normalized, null, 2), {
    encoding: 'utf8',
    mode: 0o600
  });
  await fs.promises.rename(temporary, filePath);
  return normalized;
}

async function updateStore(filePath, updater) {
  const store = await readStore(filePath);
  const result = await updater(store) || store;
  return writeStore(filePath, result);
}

function addHistory(store, entry) {
  const normalized = normalizeStore(store);
  normalized.history.unshift({
    id: entry.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: String(entry.type || 'unknown'),
    title: String(entry.title || '未命名记录'),
    createdAt: entry.createdAt || new Date().toISOString(),
    summary: entry.summary || null,
    payload: entry.payload || null
  });
  normalized.history = normalized.history.slice(0, MAX_HISTORY);
  return normalized;
}

module.exports = {
  STORE_VERSION,
  MAX_HISTORY,
  defaultStore,
  normalizeRegexWorkspace,
  normalizeMarketMonitorState,
  normalizeStore,
  readStore,
  writeStore,
  updateStore,
  addHistory
};
