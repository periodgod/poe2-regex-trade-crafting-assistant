'use strict';

const DEFAULT_MAX_FETCH = 10;
const MAX_FETCH_LIMIT = 50;
const DEFAULT_REALM = 'poe2';

const SERVER_PROFILES = {
  'poe2-cn': {
    key: 'poe2-cn',
    game: 'poe2',
    region: 'cn',
    family: 'cn',
    server: 'cn',
    apiVersion: 'trade2',
    realm: 'poe2',
    label: '流放2 国服',
    shortLabel: 'P2国服',
    origin: 'https://poe.game.qq.com',
    sampleUrl: 'https://poe.game.qq.com/trade2/search/poe2/奥杜尔秘符/40o7WjEt9'
  },
  'poe2-intl': {
    key: 'poe2-intl',
    game: 'poe2',
    region: 'intl',
    family: 'official',
    server: 'intl',
    apiVersion: 'trade2',
    realm: 'poe2',
    label: 'Path of Exile 2 国际服',
    shortLabel: 'P2国际',
    origin: 'https://www.pathofexile.com',
    sampleUrl: 'https://www.pathofexile.com/trade2/search/poe2/Standard/abc123?realm=poe2'
  },
  'poe1-cn': {
    key: 'poe1-cn',
    game: 'poe1',
    region: 'cn',
    family: 'cn',
    server: 'cn',
    apiVersion: 'trade',
    realm: 'pc',
    label: '流放1 国服',
    shortLabel: 'P1国服',
    origin: 'https://poe.game.qq.com',
    sampleUrl: 'https://poe.game.qq.com/trade/search/赛季名/搜索ID'
  },
  'poe1-intl': {
    key: 'poe1-intl',
    game: 'poe1',
    region: 'intl',
    family: 'official',
    server: 'intl',
    apiVersion: 'trade',
    realm: 'pc',
    label: 'Path of Exile 1 国际服',
    shortLabel: 'P1国际',
    origin: 'https://www.pathofexile.com',
    sampleUrl: 'https://www.pathofexile.com/trade/search/Standard/abc123'
  }
};

const CURRENCY_DEFS = [
  ['any', ['任意通货', 'any', '不限']],
  ['divine', ['神圣石', '神圣', 'divine', 'divine orb', 'd']],
  ['exalted', ['崇高石', '崇高', 'exalted', 'exalted orb', 'exalt', 'e']],
  ['chaos', ['混沌石', '混沌', 'chaos', 'chaos orb', 'c']],
  ['mirror', ['卡兰德的魔镜', '镜子', 'mirror', 'mirror of kalandra']],
  ['mirror-shard', ['魔镜碎片', 'mirror shard']],
  ['chance', ['机会石', '机会', 'chance', 'chance orb', 'orb of chance']],
  ['regal', ['富豪石', '富豪', 'regal', 'regal orb']],
  ['vaal', ['瓦尔宝珠', '瓦尔', 'vaal', 'vaal orb']],
  ['alchemy', ['点金石', '点金', 'alchemy', 'alchemy orb', 'orb of alchemy']],
  ['annulment', ['剥离石', '剥离', 'annulment', 'orb of annulment']],
  ['alteration', ['改造石', '改造', 'alteration', 'orb of alteration']],
  ['augmentation', ['增幅石', '增幅', 'augmentation', 'orb of augmentation']],
  ['transmutation', ['蜕变石', '蜕变', 'transmutation', 'orb of transmutation']],
  ['scouring', ['重铸石', '重铸', 'scouring', 'orb of scouring']],
  ['fusing', ['链接石', '链接', 'fusing', 'orb of fusing']],
  ['jewellers', ['珠宝匠石', 'jeweller', 'jewellers', "jeweller's orb", 'jewellers orb']],
  ['chromatic', ['幻色石', 'chromatic', 'chromatic orb']],
  ['blessed', ['祝福石', 'blessed', 'blessed orb']],
  ['regret', ['后悔石', 'regret', 'orb of regret']],
  ['gemcutters-prism', ['宝石匠的棱镜', 'gcp', "gemcutter's prism", 'gemcutters prism']],
  ['ancient-orb', ['远古石', 'ancient orb']],
  ['harbingers-orb', ['先驱石', "harbinger's orb", 'harbingers orb']],
  ['engineers-orb', ['工程石', "engineer's orb", 'engineers orb']],
  ['orb-of-horizons', ['地平石', 'orb of horizons', 'horizon orb']],
  ['lesser-jewellers-orb', ['低阶珠宝匠石', "lesser jeweller's orb", 'lesser jewellers orb']],
  ['greater-jewellers-orb', ['高阶珠宝匠石', "greater jeweller's orb", 'greater jewellers orb']],
  ['perfect-jewellers-orb', ['完美珠宝匠石', "perfect jeweller's orb", 'perfect jewellers orb']]
];

const CURRENCY_ALIASES = new Map();
for (const [key, aliases] of CURRENCY_DEFS) {
  CURRENCY_ALIASES.set(key, key);
  for (const alias of aliases) CURRENCY_ALIASES.set(String(alias).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(), key);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function numericOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCurrency(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return CURRENCY_ALIASES.get(key) || key.replace(/\s+/g, '-');
}

function sanitizeCookie(raw) {
  let cookie = String(raw || '').trim();
  if (/^cookie\s*:/i.test(cookie)) cookie = cookie.replace(/^cookie\s*:\s*/i, '').trim();
  return cookie.replace(/[\r\n]+/g, '; ').replace(/;\s*;/g, ';').trim();
}

function buildAuthHeaders(authCookie) {
  const cookie = sanitizeCookie(authCookie);
  return cookie ? { cookie } : {};
}

function normalizeServerKey(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const aliases = {
    'poe2cn': 'poe2-cn',
    'poe2-cn': 'poe2-cn',
    'p2-cn': 'poe2-cn',
    'cn-poe2': 'poe2-cn',
    'poe2-global': 'poe2-intl',
    'poe2-intl': 'poe2-intl',
    'poe2-international': 'poe2-intl',
    'p2-intl': 'poe2-intl',
    'intl-poe2': 'poe2-intl',
    'poe1cn': 'poe1-cn',
    'poe1-cn': 'poe1-cn',
    'p1-cn': 'poe1-cn',
    'cn-poe1': 'poe1-cn',
    'poe1-global': 'poe1-intl',
    'poe1-intl': 'poe1-intl',
    'poe1-international': 'poe1-intl',
    'p1-intl': 'poe1-intl',
    'intl-poe1': 'poe1-intl'
  };
  return aliases[raw] || (SERVER_PROFILES[raw] ? raw : '');
}

function inferProfileFromUrl(url, explicitServerKey = '') {
  const explicit = normalizeServerKey(explicitServerKey);
  const hostname = url.hostname.toLowerCase();
  const isCn = hostname === 'poe.game.qq.com' || hostname.endsWith('.poe.game.qq.com');
  const isIntl = /(^|\.)pathofexile\.com$/i.test(hostname);
  if (!isCn && !isIntl) {
    const error = new Error('当前只支持 poe.game.qq.com、pathofexile.com 的官方集市链接。');
    error.code = 'MARKET_URL_UNSUPPORTED_HOST';
    throw error;
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const isPoe2Path = parts.includes('trade2') || parts.includes('poe2') || url.searchParams.get('realm') === 'poe2';
  const inferred = `${isPoe2Path ? 'poe2' : 'poe1'}-${isCn ? 'cn' : 'intl'}`;
  if (explicit && SERVER_PROFILES[explicit]) {
    const profile = SERVER_PROFILES[explicit];
    if ((profile.region === 'cn') !== isCn) return SERVER_PROFILES[inferred];
    if ((profile.game === 'poe2') !== isPoe2Path) return SERVER_PROFILES[inferred];
    return profile;
  }
  return SERVER_PROFILES[inferred];
}

function parsePoeTradeUrl(input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw) {
    const error = new Error('请先填写官方集市搜索链接。');
    error.code = 'MARKET_URL_REQUIRED';
    throw error;
  }
  let url;
  try { url = new URL(raw); } catch (cause) {
    const error = new Error('链接格式不正确，请粘贴官方集市搜索结果链接。');
    error.code = 'MARKET_URL_INVALID';
    error.cause = cause;
    throw error;
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('只支持 http/https 集市链接。');

  const profile = inferProfileFromUrl(url, options.serverKey || options.realmKey || '');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const searchIndex = parts.indexOf('search');
  if (searchIndex < 0) throw new Error('链接中没有 search 段，请复制搜索结果页链接。');
  const tradeKind = parts.includes('trade2') || profile.apiVersion === 'trade2' ? 'trade2' : 'trade';
  let game = profile.game;
  let league = '';
  let queryId = '';
  let cursor = searchIndex + 1;
  if (parts[cursor] === 'poe2') {
    game = 'poe2';
    cursor += 1;
  }
  league = parts[cursor] || '';
  queryId = parts[cursor + 1] || '';
  if (!league || !queryId) throw new Error('无法从链接中解析赛季或搜索 ID。');

  const origin = `${url.protocol}//${url.host}`;
  const realm = url.searchParams.get('realm') || profile.realm || (game === 'poe2' ? DEFAULT_REALM : 'pc');
  const serverKey = `${game}-${profile.region === 'cn' ? 'cn' : 'intl'}`;
  const resolvedProfile = SERVER_PROFILES[serverKey] || profile;
  const encodedLeague = encodeURIComponent(league);
  const encodedQuery = encodeURIComponent(queryId);
  const gameSegment = game === 'poe2' ? '/poe2' : '';
  const pageUrl = `${origin}/${tradeKind}/search${gameSegment}/${encodedLeague}/${encodedQuery}${profile.region === 'intl' && realm && !(game === 'poe1' && realm === 'pc') ? `?realm=${encodeURIComponent(realm)}` : ''}`;
  return {
    family: resolvedProfile.family,
    server: resolvedProfile.server,
    region: resolvedProfile.region,
    serverKey: resolvedProfile.key,
    serverLabel: resolvedProfile.label,
    apiVersion: tradeKind,
    origin,
    game,
    league,
    queryId,
    realm,
    pageUrl,
    inputUrl: raw,
    original: raw,
    profile: {
      key: resolvedProfile.key,
      label: resolvedProfile.label,
      shortLabel: resolvedProfile.shortLabel,
      game: resolvedProfile.game,
      region: resolvedProfile.region
    }
  };
}

function buildOfficialEndpoints(target) {
  const profile = SERVER_PROFILES[target.serverKey] || (target.server === 'cn'
    ? (target.game === 'poe2' ? SERVER_PROFILES['poe2-cn'] : SERVER_PROFILES['poe1-cn'])
    : (target.game === 'poe2' ? SERVER_PROFILES['poe2-intl'] : SERVER_PROFILES['poe1-intl']));
  const apiVersion = target.apiVersion || profile.apiVersion;
  const base = `${target.origin}/api/${apiVersion}`;
  const league = encodeURIComponent(target.league);
  const query = encodeURIComponent(target.queryId);
  const realmParam = target.realm && !(target.game === 'poe1' && target.realm === 'pc') ? `?realm=${encodeURIComponent(target.realm)}` : '';
  if (target.game === 'poe2') {
    return {
      searchUrl: `${base}/search/poe2/${league}/${query}${realmParam || '?realm=poe2'}`,
      hydratedSearchUrl: `${base}/search/poe2/${league}${realmParam || '?realm=poe2'}`,
      fetchBaseUrl: `${base}/fetch`,
      pageUrl: target.pageUrl
    };
  }
  return {
    searchUrl: `${base}/search/${league}/${query}${realmParam}`,
    hydratedSearchUrl: `${base}/search/${league}${realmParam}`,
    fetchBaseUrl: `${base}/fetch`,
    pageUrl: target.pageUrl
  };
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function extractSearchRows(json) {
  const candidates = [json?.result, json?.results, json?.items, json?.data?.result, json?.data?.results, json?.data?.items, json?.payload?.result, json?.payload?.results, json?.payload?.items];
  for (const value of candidates) {
    const rows = pickArray(value).filter(Boolean);
    if (rows.length) return rows;
  }
  return [];
}

function extractFetchRows(json) {
  return extractSearchRows(json);
}

function extractResultIds(searchPayload) {
  const rows = Array.isArray(searchPayload) ? searchPayload : extractSearchRows(searchPayload);
  return rows.map((entry) => {
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry);
    if (entry && typeof entry === 'object') return entry.id || entry.item?.id || entry.listing?.id || entry.result || entry.uuid || entry.hash || '';
    return '';
  }).filter(Boolean);
}

function looksLikeTradeItem(row) {
  return Boolean(row && typeof row === 'object' && (row.item || row.listing || row.price || row.account));
}

function extractQueryDefinition(json) {
  if (!json || typeof json !== 'object') return null;
  const query = json.query || json.data?.query || json.payload?.query;
  if (!query || typeof query !== 'object') return null;
  return {
    query,
    sort: json.sort || json.data?.sort || json.payload?.sort || query.sort || { price: 'asc' },
    id: json.id || json.data?.id || json.payload?.id || ''
  };
}

function getTotalFromSearch(json, fallback) {
  const candidates = [json?.total, json?.count, json?.data?.total, json?.data?.count, json?.payload?.total, json?.payload?.count];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

async function defaultRequestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Math.min(30000, Number(options.timeoutMs) || 15000)));
  const method = options.method || 'GET';
  const body = options.body == null ? undefined : JSON.stringify(options.body);
  try {
    const response = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) POE-Multi-Realm-Assistant/market-monitor',
        ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!response.ok) {
      const message = json?.error?.message || json?.message || text.slice(0, 300) || response.statusText;
      const error = new Error(response.status === 429 ? `集市接口返回 429: ${message}` : `集市请求失败：HTTP ${response.status} ${message}`);
      error.status = response.status;
      error.body = text.slice(0, 600);
      const retryAfter = Number(response.headers.get('retry-after'));
      error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : (response.status === 429 ? 180 : null);
      error.retryAfterSeconds = error.retryAfter;
      throw error;
    }
    if (!json) throw new Error('集市接口没有返回 JSON，可能是登录态失效、搜索链接失效、临时限流或维护页拦截。');
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function makeRequester(dependencies = {}, monitor = {}) {
  const supplied = dependencies.requestJson;
  return async (url, options = {}) => {
    if (typeof supplied === 'function') return supplied(url, options);
    return defaultRequestJson(url, { ...options, timeoutMs: monitor.timeoutMs });
  };
}

function commonHeaders(target, authCookie) {
  return {
    referer: target.pageUrl || target.inputUrl,
    origin: target.origin,
    'x-requested-with': 'XMLHttpRequest',
    ...buildAuthHeaders(authCookie)
  };
}

function cnGetSearchCandidates(target) {
  const safeLeague = encodeURIComponent(target.league);
  const safeQuery = encodeURIComponent(target.queryId);
  if (target.game === 'poe2') {
    return [
      `${target.origin}/api/trade2/search/${safeLeague}/${safeQuery}?realm=poe2`,
      `${target.origin}/api/trade2/search/poe2/${safeLeague}/${safeQuery}?realm=poe2`
    ];
  }
  return [
    `${target.origin}/api/trade/search/${safeLeague}/${safeQuery}`,
    `${target.origin}/api/trade/search/${safeLeague}/${safeQuery}?realm=pc`
  ];
}

function cnPostSearchCandidates(target) {
  const safeLeague = encodeURIComponent(target.league);
  if (target.game === 'poe2') {
    return [
      `${target.origin}/api/trade2/search/poe2/${safeLeague}?realm=poe2`,
      `${target.origin}/api/trade2/search/${safeLeague}?realm=poe2`,
      `${target.origin}/api/trade/search/${safeLeague}?realm=poe2`
    ];
  }
  return [
    `${target.origin}/api/trade/search/${safeLeague}`,
    `${target.origin}/api/trade/search/${safeLeague}?realm=pc`
  ];
}

async function fetchCnSearch(target, monitor, requestJson) {
  const limit = clampInteger(monitor.maxFetch ?? monitor.limit, 1, MAX_FETCH_LIMIT, DEFAULT_MAX_FETCH);
  const headers = commonHeaders(target, monitor.authCookie || monitor.sessionCookie || monitor.cookie || '');
  const attempts = [];
  const getCandidates = cnGetSearchCandidates(target);
  let lastError = null;
  for (const endpoint of getCandidates) {
    try {
      const json = await requestJson(endpoint, { method: 'GET', headers });
      const rows = extractSearchRows(json);
      const directItems = rows.filter(looksLikeTradeItem);
      const ids = extractResultIds(rows);
      const total = getTotalFromSearch(json, rows.length);
      const rawShape = Array.isArray(json?.result) ? 'result[]' : (json?.result && typeof json.result === 'object' ? 'result{}' : Object.keys(json || {}).join(','));
      attempts.push({ method: 'GET', endpoint, ids: ids.length, directItems: directItems.length, rawRows: rows.length, total, rawShape });
      if (ids.length || directItems.length) return { ids: ids.slice(0, limit), directItems: directItems.slice(0, limit), total, rawRows: rows.length, endpoint, attempts, usedHydratedQuery: false, rawShape };
      const definition = extractQueryDefinition(json);
      if (definition) {
        attempts[attempts.length - 1].hydratedQuery = true;
        return postCnSearchDefinition(target, definition, monitor, requestJson, attempts);
      }
    } catch (error) {
      lastError = error;
      attempts.push({ method: 'GET', endpoint, error: error.message, status: error.status || null });
      if (error.status === 429) throw error;
    }
  }
  if (lastError) throw lastError;
  return { ids: [], directItems: [], total: 0, rawRows: 0, endpoint: getCandidates[0], attempts, usedHydratedQuery: false, rawShape: 'empty' };
}

async function postCnSearchDefinition(target, definition, monitor, requestJson, attempts = []) {
  const limit = clampInteger(monitor.maxFetch ?? monitor.limit, 1, MAX_FETCH_LIMIT, DEFAULT_MAX_FETCH);
  const headers = commonHeaders(target, monitor.authCookie || monitor.sessionCookie || monitor.cookie || '');
  const body = { query: definition.query || {}, sort: definition.sort || definition.query?.sort || { price: 'asc' } };
  const candidates = cnPostSearchCandidates(target);
  let lastError = null;
  for (const endpoint of candidates) {
    try {
      const json = await requestJson(endpoint, { method: 'POST', headers, body });
      const rows = extractSearchRows(json);
      const directItems = rows.filter(looksLikeTradeItem);
      const ids = extractResultIds(rows);
      const total = getTotalFromSearch(json, rows.length);
      const rawShape = Array.isArray(json?.result) ? 'result[]' : (json?.result && typeof json.result === 'object' ? 'result{}' : Object.keys(json || {}).join(','));
      attempts.push({ method: 'POST', endpoint, ids: ids.length, directItems: directItems.length, rawRows: rows.length, total, rawShape });
      if (ids.length || directItems.length) return { ids: ids.slice(0, limit), directItems: directItems.slice(0, limit), total, rawRows: rows.length, endpoint, attempts, usedHydratedQuery: true, rawShape };
    } catch (error) {
      lastError = error;
      attempts.push({ method: 'POST', endpoint, error: error.message, status: error.status || null });
      if (error.status === 429) throw error;
    }
  }
  if (lastError) throw lastError;
  return { ids: [], directItems: [], total: 0, rawRows: 0, endpoint: candidates[0], attempts, usedHydratedQuery: true, rawShape: 'empty' };
}

async function fetchGenericSearch(target, monitor, requestJson) {
  const endpoints = buildOfficialEndpoints(target);
  const headers = commonHeaders(target, monitor.authCookie || monitor.sessionCookie || monitor.cookie || '');
  const searchPayload = await requestJson(endpoints.searchUrl, { method: 'GET', headers });
  const rows = extractSearchRows(searchPayload);
  const directItems = rows.filter(looksLikeTradeItem);
  const ids = extractResultIds(rows);
  const total = getTotalFromSearch(searchPayload, ids.length || directItems.length);
  return {
    ids: ids.slice(0, clampInteger(monitor.maxFetch ?? monitor.limit, 1, MAX_FETCH_LIMIT, DEFAULT_MAX_FETCH)),
    directItems: directItems.slice(0, clampInteger(monitor.maxFetch ?? monitor.limit, 1, MAX_FETCH_LIMIT, DEFAULT_MAX_FETCH)),
    total,
    rawRows: rows.length || ids.length,
    endpoint: endpoints.searchUrl,
    attempts: [{ method: 'GET', endpoint: endpoints.searchUrl, ids: ids.length, directItems: directItems.length, total, rawRows: rows.length || ids.length, rawShape: Array.isArray(searchPayload?.result) ? 'result[]' : 'result' }],
    rawShape: Array.isArray(searchPayload?.result) ? 'result[]' : 'result',
    usedHydratedQuery: false
  };
}

function fetchCandidates(target, ids) {
  const safeIds = ids.map(encodeURIComponent).join(',');
  const safeQuery = encodeURIComponent(target.queryId);
  if (target.server === 'cn') {
    if (target.game === 'poe2') {
      return [
        `${target.origin}/api/trade2/fetch/${safeIds}?query=${safeQuery}&realm=poe2`,
        `${target.origin}/api/trade2/fetch/${safeIds}?query=${safeQuery}`,
        `${target.origin}/api/trade/fetch/${safeIds}?query=${safeQuery}&realm=poe2`
      ];
    }
    return [
      `${target.origin}/api/trade/fetch/${safeIds}?query=${safeQuery}`,
      `${target.origin}/api/trade/fetch/${safeIds}?query=${safeQuery}&realm=pc`
    ];
  }
  const realmParam = target.realm && !(target.game === 'poe1' && target.realm === 'pc') ? `&realm=${encodeURIComponent(target.realm)}` : '';
  return [`${buildOfficialEndpoints(target).fetchBaseUrl}/${safeIds}?query=${safeQuery}${realmParam}`];
}

async function fetchItems(target, ids, monitor, requestJson) {
  if (!ids.length) return { endpoint: null, result: [], rawRows: 0, rawShape: 'no ids' };
  const headers = commonHeaders(target, monitor.authCookie || monitor.sessionCookie || monitor.cookie || '');
  const candidates = fetchCandidates(target, ids);
  let lastError = null;
  for (const endpoint of candidates) {
    try {
      const json = await requestJson(endpoint, { method: 'GET', headers });
      const rows = extractFetchRows(json);
      return { endpoint, result: rows, rawRows: rows.length, rawShape: Array.isArray(json?.result) ? 'result[]' : (json?.result && typeof json.result === 'object' ? 'result{}' : Object.keys(json || {}).join(',')) };
    } catch (error) {
      lastError = error;
      if (error.status === 429) throw error;
    }
  }
  throw lastError || new Error('无法读取集市物品详情。');
}

function getPriceObject(listing) {
  return listing?.price || listing?.indexed_price || listing?.offer || null;
}

function normalizePrice(price) {
  if (!price || typeof price !== 'object') return null;
  const amount = numericOrNull(price.amount ?? price.value);
  const currency = normalizeCurrency(price.currency ?? price.exchange?.currency ?? price.item?.currency);
  if (amount == null || !currency) return null;
  return { amount, currency, rawCurrency: price.currency || currency, type: price.type || price.priceType || '' };
}

function sellerName(listing) {
  return listing?.account?.name || listing?.account?.lastCharacterName || listing?.seller?.name || '未知商家';
}

function isSellerOnline(listing) {
  const online = listing?.account?.online ?? listing?.seller?.online ?? listing?.online;
  if (online === true) return true;
  if (typeof online === 'string') return /online|在线/i.test(online);
  if (online && typeof online === 'object') return true;
  return false;
}

function getWhisper(entry) {
  return entry?.listing?.whisper || entry?.listing?.whisper_token || entry?.whisper || '';
}

function getTradeMode(entry) {
  const listing = entry?.listing || {};
  const explicit = listing.method || listing.tradeMode || listing.type || listing.interaction || entry?.tradeMode;
  if (explicit) return String(explicit);
  if (!getWhisper(entry)) return '商人页签 / 前往藏身处';
  return '私聊交易';
}

function listingToRecord(entry, target) {
  const listing = entry?.listing || {};
  const item = entry?.item || {};
  const price = normalizePrice(getPriceObject(listing));
  const id = entry?.id || listing?.id || item?.id || `${sellerName(listing)}-${item?.name || item?.typeLine || 'item'}`;
  return {
    id,
    itemName: [item.name, item.typeLine].filter(Boolean).join(' ') || item.typeLine || item.name || entry?.name || '未命名物品',
    name: [item.name, item.typeLine].filter(Boolean).join(' ') || item.typeLine || item.name || entry?.name || '未命名物品',
    seller: sellerName(listing),
    online: isSellerOnline(listing),
    price,
    priceText: price ? `${price.amount} ${price.rawCurrency || price.currency}` : '未标价',
    whisper: getWhisper(entry),
    tradeMode: getTradeMode(entry),
    indexed: listing.indexed || '',
    note: listing.note || '',
    pageUrl: target.pageUrl,
    sourceUrl: target.pageUrl,
    serverKey: target.serverKey,
    serverLabel: target.serverLabel,
    raw: entry
  };
}

function normalizeCurrencyList(monitor = {}) {
  const source = monitor.currencies != null ? monitor.currencies : (monitor.priceCurrency != null ? monitor.priceCurrency : monitor.currency);
  const list = Array.isArray(source) ? source : [source || 'any'];
  const normalized = Array.from(new Set(list.map(normalizeCurrency).filter(Boolean)));
  if (!normalized.length || normalized.includes('any')) return [];
  return normalized;
}

function normalizePriceRanges(monitor = {}) {
  const rows = Array.isArray(monitor.priceRanges)
    ? monitor.priceRanges
    : Object.entries(monitor.priceRanges || {}).map(([currency, cfg]) => ({ currency, ...(cfg || {}) }));
  const result = [];
  for (const row of rows) {
    if (!row || row.enabled === false) continue;
    const currency = normalizeCurrency(row.currency || row.key || row.id || '');
    if (!currency || currency === 'any') continue;
    result.push({ currency, min: numericOrNull(row.minPrice ?? row.min), max: numericOrNull(row.maxPrice ?? row.max) });
  }
  return result;
}

function buildDroppedReason(record, monitor = {}) {
  const reasons = [];
  if ((monitor.onlyOnline || monitor.onlineOnly) && !record.online) reasons.push('离线/未知在线状态（商人页签交易请关闭此项）');
  if ((monitor.pricedOnly || monitor.onlyPriced) && !record.price) reasons.push('未标价');
  if ((monitor.exactOnly || monitor.exactPriceOnly) && record.price && !['~price', '~b/o', ''].includes(String(record.price.type || ''))) reasons.push(`不是精确标价：${record.price.type || '未知'}`);
  const priceRanges = normalizePriceRanges(monitor);
  if (priceRanges.length) {
    if (!record.price) return reasons.concat('启用了分通货价格区间，但物品没有价格');
    const range = priceRanges.find(row => row.currency === normalizeCurrency(record.price.currency));
    if (!range) return reasons.concat(`通货不在启用区间内：${record.price.rawCurrency || record.price.currency}`);
    if ((range.min != null || range.max != null) && !Number.isFinite(Number(record.price.amount))) reasons.push('价格不是数字');
    if (range.min != null && record.price.amount < range.min) reasons.push(`低于${record.price.currency}最低价：${record.price.amount} < ${range.min}`);
    if (range.max != null && record.price.amount > range.max) reasons.push(`高于${record.price.currency}最高价：${record.price.amount} > ${range.max}`);
    return reasons;
  }
  const currencies = normalizeCurrencyList(monitor);
  if (currencies.length && record.price && !currencies.includes(normalizeCurrency(record.price.currency))) reasons.push(`通货不匹配：${record.price.rawCurrency || record.price.currency}`);
  const min = numericOrNull(monitor.minPrice);
  const max = numericOrNull(monitor.maxPrice);
  if ((min != null || max != null) && !record.price) reasons.push('设置了价格区间，但物品没有价格');
  if (record.price && min != null && record.price.amount < min) reasons.push(`低于最低价：${record.price.amount} < ${min}`);
  if (record.price && max != null && record.price.amount > max) reasons.push(`高于最高价：${record.price.amount} > ${max}`);
  return reasons;
}

function pricePasses(record, monitor) {
  return buildDroppedReason(record, monitor).length === 0;
}

function filterListings(listings, monitor) {
  return listings.filter(record => pricePasses(record, monitor));
}

async function checkMarketMonitor(monitor, dependencies = {}) {
  const target = parsePoeTradeUrl(monitor.url || monitor.tradeUrl, { serverKey: monitor.serverKey || monitor.realmKey || monitor.profileKey });
  const requestJson = makeRequester(dependencies, monitor);
  const checkedAt = new Date().toISOString();
  const search = target.server === 'cn'
    ? await fetchCnSearch(target, monitor, requestJson)
    : await fetchGenericSearch(target, monitor, requestJson);
  const fetched = search.directItems && search.directItems.length
    ? { endpoint: 'search response direct items', result: search.directItems, rawRows: search.directItems.length, rawShape: 'direct' }
    : await fetchItems(target, search.ids, monitor, requestJson);
  const listings = (fetched.result || []).map(entry => listingToRecord(entry, target));
  const dropped = [];
  const matches = [];
  for (const record of listings) {
    const reasons = buildDroppedReason(record, monitor);
    if (reasons.length) {
      if (dropped.length < 10) dropped.push({ name: record.itemName, price: record.priceText, seller: record.seller, reasons });
    } else {
      matches.push(record);
    }
  }
  return {
    ok: true,
    checkedAt,
    target,
    serverKey: target.serverKey,
    serverLabel: target.serverLabel,
    totalResultCount: search.total,
    fetchedCount: listings.length,
    matchCount: matches.length,
    total: search.total,
    fetched: listings.length,
    matched: matches.length,
    searchIds: search.ids.length,
    searchRows: search.rawRows,
    listings,
    matches,
    items: matches,
    dropped,
    pageUrl: target.pageUrl,
    nextCheckSeconds: clampInteger(monitor.intervalSeconds ?? monitor.intervalSec, 60, 3600, 90),
    debug: {
      searchShape: search.rawShape,
      fetchShape: fetched.rawShape,
      searchPreview: search.ids.slice(0, 3),
      searchAttempts: search.attempts || [],
      usedHydratedQuery: Boolean(search.usedHydratedQuery),
      endpoints: { search: search.endpoint, fetch: fetched.endpoint }
    }
  };
}

module.exports = {
  DEFAULT_MAX_FETCH,
  MAX_FETCH_LIMIT,
  SERVER_PROFILES,
  CURRENCY_DEFS,
  normalizeServerKey,
  inferProfileFromUrl,
  normalizeCurrency,
  normalizeCurrencyList,
  normalizePriceRanges,
  sanitizeCookie,
  parsePoeTradeUrl,
  parseTradeUrl: parsePoeTradeUrl,
  buildOfficialEndpoints,
  normalizePrice,
  extractResultIds,
  extractSearchRows,
  extractFetchRows,
  listingToRecord,
  filterListings,
  buildDroppedReason,
  checkMarketMonitor
};
