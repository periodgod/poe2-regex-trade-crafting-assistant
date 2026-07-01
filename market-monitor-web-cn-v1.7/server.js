/*
 * POE2 Market Monitor Web Proxy
 * No dependencies. Requires Node.js >= 18 for global fetch.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const childProcess = require('child_process');

const PORT = Number(process.env.PORT || 5177);
const ROOT = __dirname;

const hideoutClickQueue = [];
const hideoutClickEvents = [];
const MAX_CLICK_QUEUE = 20;
const MAX_CLICK_EVENTS = 50;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // 允许国服官方页面上的 userscript 轮询本地点击任务。
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('请求体太大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseTradeUrl(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('请填写国服官方集市链接');
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('链接格式不正确');
  }

  const hostname = url.hostname.toLowerCase();
  const isCn = hostname === 'poe.game.qq.com';
  if (!isCn) {
    throw new Error('当前测试版已切换为国服专用，只支持 https://poe.game.qq.com/trade2/search/... 链接');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  // 国服 POE2 示例：/trade2/search/poe2/奥杜尔秘符/YBORoROFY
  const tradeIndex = parts.findIndex(p => p === 'trade2' || p === 'trade');
  const tradeKind = tradeIndex >= 0 ? parts[tradeIndex] : 'trade2';
  const searchIndex = parts.indexOf('search');
  if (searchIndex < 0) throw new Error('链接中没有 search 段，请复制搜索结果页链接');

  let realm = 'poe2';
  let league = '';
  let queryId = '';

  if (parts[searchIndex + 1] === 'poe2') {
    realm = 'poe2';
    league = decodeURIComponent(parts[searchIndex + 2] || '');
    queryId = decodeURIComponent(parts[searchIndex + 3] || '');
  } else {
    league = decodeURIComponent(parts[searchIndex + 1] || '');
    queryId = decodeURIComponent(parts[searchIndex + 2] || '');
    realm = url.searchParams.get('realm') || (tradeKind === 'trade2' ? 'poe2' : 'pc');
  }

  if (!league || !queryId) {
    throw new Error('无法从链接中解析赛季或搜索 ID，请确认复制的是国服搜索结果页链接');
  }

  return {
    original: input.trim(),
    server: 'cn',
    origin: 'https://poe.game.qq.com',
    tradeKind,
    realm,
    league,
    queryId
  };
}

function normalizeCurrency(raw) {
  const value = String(raw || '').trim().toLowerCase();
  const cnKey = String(raw || '').trim();
  const map = new Map([
    ['任意通货', 'any'], ['any', 'any'], ['不限', 'any'],
    ['神圣石', 'divine'], ['divine orb', 'divine'], ['divine', 'divine'], ['d', 'divine'],
    ['崇高石', 'exalted'], ['exalted orb', 'exalted'], ['exalted', 'exalted'], ['e', 'exalted'],
    ['混沌石', 'chaos'], ['chaos orb', 'chaos'], ['chaos', 'chaos'], ['c', 'chaos'],
    ['机会石', 'chance'], ['chance orb', 'chance'], ['chance', 'chance'],
    ['瓦尔宝珠', 'vaal'], ['vaal orb', 'vaal'], ['vaal', 'vaal'],
    ['富豪石', 'regal'], ['regal orb', 'regal'], ['regal', 'regal'],
    ['点金石', 'alchemy'], ['orb of alchemy', 'alchemy'], ['alchemy', 'alchemy'],
    ['剥离石', 'annulment'], ['orb of annulment', 'annulment'], ['annulment', 'annulment'],
    ['工匠石', 'artificer'], ['artificer', 'artificer'],
    ['低阶珠宝匠石', 'lesser-jewellers-orb'], ['lesser jeweller\'s orb', 'lesser-jewellers-orb'], ['lesser jewellers orb', 'lesser-jewellers-orb'],
    ['高阶珠宝匠石', 'greater-jewellers-orb'], ['greater jeweller\'s orb', 'greater-jewellers-orb'], ['greater jewellers orb', 'greater-jewellers-orb'],
    ['完美珠宝匠石', 'perfect-jewellers-orb'], ['perfect jeweller\'s orb', 'perfect-jewellers-orb'], ['perfect jewellers orb', 'perfect-jewellers-orb'],
    ['宝石匠的棱镜', 'gemcutters-prism'], ['gemcutter\'s prism', 'gemcutters-prism'], ['gemcutters prism', 'gemcutters-prism'],
    ['卡兰德的魔镜', 'mirror'], ['mirror of kalandra', 'mirror'], ['mirror', 'mirror']
  ]);
  return map.get(cnKey) || map.get(value) || value.replace(/\s+/g, '-');
}


function normalizeCurrencyList(filters = {}) {
  const source = filters.currencies != null ? filters.currencies : filters.currency;
  const list = Array.isArray(source) ? source : [source || 'any'];
  const normalized = Array.from(new Set(list.map(normalizeCurrency).filter(Boolean)));
  if (!normalized.length || normalized.includes('any')) return [];
  return normalized;
}


function normalizePriceRanges(filters = {}) {
  const source = filters.priceRanges;
  if (!source) return [];
  const rows = Array.isArray(source)
    ? source
    : Object.entries(source).map(([currency, cfg]) => ({ currency, ...(cfg || {}) }));
  const normalized = [];
  for (const row of rows) {
    if (!row) continue;
    const enabled = row.enabled !== false;
    const currency = normalizeCurrency(row.currency || row.key || row.id || '');
    if (!enabled || !currency || currency === 'any') continue;
    const minRaw = row.minPrice ?? row.min ?? '';
    const maxRaw = row.maxPrice ?? row.max ?? '';
    const min = minRaw === '' || minRaw == null ? null : Number(minRaw);
    const max = maxRaw === '' || maxRaw == null ? null : Number(maxRaw);
    normalized.push({
      currency,
      min: Number.isFinite(min) ? min : null,
      max: Number.isFinite(max) ? max : null
    });
  }
  const dedup = new Map();
  for (const row of normalized) dedup.set(row.currency, row);
  return Array.from(dedup.values());
}

function priceRangeListToText(rows) {
  if (!rows || !rows.length) return '';
  return rows.map(row => {
    const min = row.min == null ? '不限' : row.min;
    const max = row.max == null ? '不限' : row.max;
    return `${row.currency}:${min}-${max}`;
  }).join(' / ');
}

function currencyListToText(list) {
  if (!list || !list.length) return '任意通货';
  return list.join(' / ');
}

function priceToText(price) {
  if (!price) return '未标价';
  const amount = price.amount ?? '';
  const currency = price.currency ?? '';
  return `${amount} ${currency}`.trim();
}

function isOnline(listing) {
  const online = getOnlineObject(listing || {});
  if (online === true) return true;
  if (typeof online === 'string') return /online|在线/i.test(online);
  if (online && typeof online === 'object') return true;
  return false;
}

function getSeller(listing) {
  const account = listing && listing.account;
  return account ? (account.name || account.lastCharacterName || account.ign || '未知商家') : '未知商家';
}

function getWhisper(item) {
  return item?.listing?.whisper || item?.listing?.whisper_token || item?.whisper || '';
}

function getTradeMode(item) {
  const listing = item?.listing || {};
  const explicit = listing.method || listing.tradeMode || listing.type || listing.interaction || item?.tradeMode;
  if (explicit) return String(explicit);
  // 国服很多“立即购买/前往藏身处”结果没有在线私聊字段，不能按在线状态过滤。
  if (!getWhisper(item)) return '商人页签 / 前往藏身处';
  return '私聊交易';
}

function getItemName(item) {
  const raw = item?.item || {};
  const name = [raw.name, raw.typeLine].filter(Boolean).join(' ').trim();
  return name || raw.typeLine || raw.baseType || '未知物品';
}

function passFilters(item, filters = {}) {
  const listing = item?.listing || {};
  const price = getPriceObject(listing) || null;

  if (filters.onlineOnly && !isOnline(listing)) return false;
  if (filters.pricedOnly && !price) return false;
  if (filters.exactOnly && price && !['~price', '~b/o'].includes(String(price.type || ''))) return false;

  const priceRanges = normalizePriceRanges(filters);
  if (priceRanges.length) {
    if (!price) return false;
    const amount = Number(price.amount);
    const itemCurrency = normalizeCurrency(price.currency || '');
    const range = priceRanges.find(row => row.currency === itemCurrency);
    if (!range) return false;
    if ((range.min != null || range.max != null) && !Number.isFinite(amount)) return false;
    if (range.min != null && amount < range.min) return false;
    if (range.max != null && amount > range.max) return false;
    return true;
  }

  const currencies = normalizeCurrencyList(filters);
  if (currencies.length && price) {
    const itemCurrency = normalizeCurrency(price.currency || '');
    if (!currencies.includes(itemCurrency)) return false;
  }

  const amount = Number(price && price.amount);
  const min = filters.minPrice === '' || filters.minPrice == null ? null : Number(filters.minPrice);
  const max = filters.maxPrice === '' || filters.maxPrice == null ? null : Number(filters.maxPrice);
  if ((min != null || max != null) && !Number.isFinite(amount)) return false;
  if (min != null && Number.isFinite(min) && amount < min) return false;
  if (max != null && Number.isFinite(max) && amount > max) return false;
  return true;
}

function sanitizeCookie(raw) {
  let cookie = String(raw || '').trim();
  if (!cookie) return '';
  // 兼容从 DevTools 直接复制整行：Cookie: a=1; b=2
  cookie = cookie.replace(/^cookie\s*:\s*/i, '');
  // 只允许普通 Cookie 头内容，避免把换行注入到转发请求头里。
  return cookie.replace(/[\r\n]/g, '').slice(0, 16000);
}

function buildAuthHeaders(authCookie) {
  const cookie = sanitizeCookie(authCookie);
  return cookie ? { cookie } : {};
}

function isAuthError(err) {
  return /接口返回\s*401|unauthorized|未授权|登录|login/i.test(String(err && err.message || err));
}


function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function getByPath(root, path) {
  return path.split('.').reduce((obj, key) => (obj && obj[key] != null ? obj[key] : undefined), root);
}

function extractSearchRows(json) {
  const candidates = [
    json?.result,
    json?.results,
    json?.items,
    json?.data?.result,
    json?.data?.results,
    json?.data?.items,
    json?.payload?.result,
    json?.payload?.results,
    json?.payload?.items
  ];
  for (const value of candidates) {
    const rows = pickArray(value).filter(v => v != null);
    if (rows.length) return rows;
  }
  return [];
}

function extractFetchRows(json) {
  const candidates = [
    json?.result,
    json?.results,
    json?.items,
    json?.data?.result,
    json?.data?.results,
    json?.data?.items,
    json?.payload?.result,
    json?.payload?.results,
    json?.payload?.items
  ];
  for (const value of candidates) {
    const rows = pickArray(value).filter(v => v != null);
    if (rows.length) return rows;
  }
  return [];
}

function looksLikeTradeItem(row) {
  return Boolean(row && typeof row === 'object' && (row.item || row.listing || row.price || row.account));
}

function extractSearchIds(rows) {
  return rows.map(row => {
    if (typeof row === 'string' || typeof row === 'number') return String(row);
    if (row && typeof row === 'object') {
      return row.id || row.item?.id || row.listing?.id || row.result || row.uuid || row.hash || '';
    }
    return '';
  }).filter(Boolean);
}

function getTotalFromSearch(json, fallback) {
  const candidates = [json?.total, json?.count, json?.data?.total, json?.data?.count, json?.payload?.total, json?.payload?.count];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function getOnlineObject(listing) {
  return listing?.account?.online || listing?.account?.status || listing?.online || null;
}

function getPriceObject(listing) {
  return listing?.price || listing?.indexed_price || listing?.offer || null;
}

function buildDroppedReason(item, filters = {}) {
  const listing = item?.listing || {};
  const price = getPriceObject(listing);
  const reasons = [];
  if (filters.onlineOnly && !isOnline(listing)) reasons.push('离线/未知在线状态（国服商人页签交易请关闭“只显示在线私聊商家”）');
  if (filters.pricedOnly && !price) reasons.push('未标价');
  if (filters.exactOnly && price && !['~price', '~b/o'].includes(String(price.type || ''))) reasons.push(`不是精确标价：${price.type || '未知'}`);

  const priceRanges = normalizePriceRanges(filters);
  if (priceRanges.length) {
    if (!price) {
      reasons.push(`启用了分通货价格区间，但物品没有价格`);
      return reasons;
    }
    const amount = Number(price.amount);
    const itemCurrency = normalizeCurrency(price.currency || '');
    const range = priceRanges.find(row => row.currency === itemCurrency);
    if (!range) {
      reasons.push(`通货不在启用区间内：${price.currency || '空'} → ${itemCurrency}；允许 ${priceRangeListToText(priceRanges)}`);
      return reasons;
    }
    if ((range.min != null || range.max != null) && !Number.isFinite(amount)) reasons.push(`价格不是数字：${price?.amount ?? '空'}`);
    if (range.min != null && Number.isFinite(amount) && amount < range.min) reasons.push(`低于${itemCurrency}最低价：${amount} < ${range.min}`);
    if (range.max != null && Number.isFinite(amount) && amount > range.max) reasons.push(`高于${itemCurrency}最高价：${amount} > ${range.max}`);
    return reasons;
  }

  const currencies = normalizeCurrencyList(filters);
  if (currencies.length && price) {
    const itemCurrency = normalizeCurrency(price.currency || '');
    if (!currencies.includes(itemCurrency)) reasons.push(`通货不匹配：${price.currency || '空'} → ${itemCurrency}；允许 ${currencyListToText(currencies)}`);
  }
  const amount = Number(price && price.amount);
  const min = filters.minPrice === '' || filters.minPrice == null ? null : Number(filters.minPrice);
  const max = filters.maxPrice === '' || filters.maxPrice == null ? null : Number(filters.maxPrice);
  if ((min != null || max != null) && !Number.isFinite(amount)) reasons.push(`价格不是数字：${price?.amount ?? '空'}`);
  if (min != null && Number.isFinite(min) && amount < min) reasons.push(`低于最低价：${amount} < ${min}`);
  if (max != null && Number.isFinite(max) && amount > max) reasons.push(`高于最高价：${amount} > ${max}`);
  return reasons;
}


function makeRateLimitError(message, retryAfterSeconds) {
  const err = new Error(message || '国服接口返回 429: Rate limit exceeded');
  err.status = 429;
  err.retryAfterSeconds = retryAfterSeconds || 180;
  return err;
}

function extractRetryAfterSeconds(response) {
  const raw = response.headers && response.headers.get && response.headers.get('retry-after');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 180;
}

async function poeRequest(url, headers = {}, options = {}) {
  const method = options.method || 'GET';
  const body = options.body == null ? undefined : JSON.stringify(options.body);
  const response = await fetch(url, {
    method,
    body,
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 POE2-CN-Market-Monitor-Web/1.3',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
      ...headers
    }
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!response.ok) {
    const message = json?.error?.message || json?.message || text.slice(0, 300) || response.statusText;
    if (response.status === 429) {
      throw makeRateLimitError(`国服接口返回 429: ${message}`, extractRetryAfterSeconds(response));
    }
    const err = new Error(`国服接口返回 ${response.status}: ${message}`);
    err.status = response.status;
    throw err;
  }
  if (!json) throw new Error('国服接口返回的不是 JSON，可能被风控页、登录页或维护页拦截');
  return json;
}

function poeFetch(url, headers = {}) {
  return poeRequest(url, headers, { method: 'GET' });
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

function buildSearchPostBody(definition) {
  const query = definition?.query || {};
  const sort = definition?.sort || query.sort || { price: 'asc' };
  // 国服保存链接接口返回的是“查询定义”，不是最终结果；必须把 query/sort 再 POST 一次。
  // 同时保留 query 内已有字段，避免把官方筛选条件丢掉。
  return { query, sort };
}

async function postSearchDefinition(parsed, definition, limit, authCookie, attempts) {
  const safeLeague = encodeURIComponent(parsed.league);
  const apiBase = parsed.origin || 'https://poe.game.qq.com';
  const commonHeaders = {
    'referer': parsed.original,
    'origin': apiBase,
    'x-requested-with': 'XMLHttpRequest',
    ...buildAuthHeaders(authCookie)
  };
  const body = buildSearchPostBody(definition);
  const postCandidates = [
    `${apiBase}/api/trade2/search/poe2/${safeLeague}?realm=poe2`,
    `${apiBase}/api/trade2/search/${safeLeague}?realm=poe2`,
    `${apiBase}/api/trade/search/${safeLeague}?realm=poe2`
  ];
  const sliceLimit = Math.max(1, Math.min(Number(limit || 10), 50));
  let lastError = null;
  let bestEmpty = null;

  for (const endpoint of postCandidates) {
    try {
      const json = await poeRequest(endpoint, commonHeaders, { method: 'POST', body });
      const rows = extractSearchRows(json);
      const directItems = rows.filter(looksLikeTradeItem);
      const ids = extractSearchIds(rows);
      const total = getTotalFromSearch(json, rows.length);
      const rawShape = Array.isArray(json?.result) ? 'result[]' : (json?.result && typeof json.result === 'object' ? 'result{}' : Object.keys(json || {}).join(','));
      attempts.push({ endpoint, method: 'POST', total, rawRows: rows.length, ids: ids.length, directItems: directItems.length, rawShape });
      if (ids.length || directItems.length) {
        return {
          endpoint,
          total,
          rawRows: rows.length,
          ids: ids.slice(0, sliceLimit),
          directItems: directItems.slice(0, sliceLimit),
          rawShape,
          attempts,
          usedHydratedQuery: true
        };
      }
      if (!bestEmpty || total > bestEmpty.total || rows.length > bestEmpty.rawRows) {
        bestEmpty = { endpoint, total, rawRows: rows.length, ids: [], directItems: [], rawShape, attempts, usedHydratedQuery: true };
      }
    } catch (err) {
      lastError = err;
      attempts.push({ endpoint, method: 'POST', error: err.message || String(err), status: err.status || null });
      // 429 后不要继续打其它候选接口，避免越试越被限流。
      if (err.status === 429) throw err;
    }
  }
  if (bestEmpty) return bestEmpty;
  throw lastError || new Error('已读取搜索定义，但无法用 POST 获取结果 ID');
}

async function fetchSearch(parsed, limit, authCookie = '') {
  const safeLeague = encodeURIComponent(parsed.league);
  const safeQuery = encodeURIComponent(parsed.queryId);
  const apiBase = parsed.origin || 'https://poe.game.qq.com';
  const referer = parsed.original;
  const commonHeaders = {
    'referer': referer,
    'origin': apiBase,
    'x-requested-with': 'XMLHttpRequest',
    ...buildAuthHeaders(authCookie)
  };

  // v0.6：先只请求保存搜索链接对应的 GET 接口。
  // 如果返回 id/query，说明只是“搜索定义”，再用 query/sort POST 真正执行搜索。
  // 不再一次性轰炸多个候选接口，避免触发 429。
  const candidates = [
    `${apiBase}/api/trade2/search/${safeLeague}/${safeQuery}?realm=${encodeURIComponent(parsed.realm || 'poe2')}`,
    `${apiBase}/api/trade2/search/poe2/${safeLeague}/${safeQuery}?realm=${encodeURIComponent(parsed.realm || 'poe2')}`
  ];

  const sliceLimit = Math.max(1, Math.min(Number(limit || 10), 50));
  let lastError = null;
  let bestEmpty = null;
  const attempts = [];

  for (const endpoint of candidates) {
    try {
      const json = await poeFetch(endpoint, commonHeaders);
      const rows = extractSearchRows(json);
      const directItems = rows.filter(looksLikeTradeItem);
      const ids = extractSearchIds(rows);
      const total = getTotalFromSearch(json, rows.length);
      const rawShape = Array.isArray(json?.result) ? 'result[]' : (json?.result && typeof json.result === 'object' ? 'result{}' : Object.keys(json || {}).join(','));
      attempts.push({ endpoint, method: 'GET', total, rawRows: rows.length, ids: ids.length, directItems: directItems.length, rawShape });

      if (ids.length || directItems.length) {
        return {
          endpoint,
          total,
          rawRows: rows.length,
          ids: ids.slice(0, sliceLimit),
          directItems: directItems.slice(0, sliceLimit),
          rawShape,
          attempts,
          usedHydratedQuery: false
        };
      }

      const definition = extractQueryDefinition(json);
      if (definition) {
        attempts[attempts.length - 1].hydratedQuery = true;
        return await postSearchDefinition(parsed, definition, limit, authCookie, attempts);
      }

      if (!bestEmpty || total > bestEmpty.total || rows.length > bestEmpty.rawRows) {
        bestEmpty = { endpoint, total, rawRows: rows.length, ids: [], directItems: [], rawShape, attempts, usedHydratedQuery: false };
      }
    } catch (err) {
      lastError = err;
      attempts.push({ endpoint, method: 'GET', error: err.message || String(err), status: err.status || null });
      if (err.status === 429) throw err;
    }
  }

  if (bestEmpty) {
    bestEmpty.attempts = attempts;
    return bestEmpty;
  }
  if (lastError) lastError.attempts = attempts;
  throw lastError || new Error('无法读取国服搜索结果');
}
async function fetchItems(parsed, ids, authCookie = '') {
  if (!ids.length) return { endpoint: null, result: [], rawRows: 0, rawShape: 'no ids' };
  const safeIds = ids.map(encodeURIComponent).join(',');
  const safeQuery = encodeURIComponent(parsed.queryId);
  const apiBase = parsed.origin || 'https://poe.game.qq.com';
  const commonHeaders = {
    'referer': parsed.original,
    'origin': apiBase,
    'x-requested-with': 'XMLHttpRequest',
    ...buildAuthHeaders(authCookie)
  };
  const candidates = [
    `${apiBase}/api/trade2/fetch/${safeIds}?query=${safeQuery}&realm=${encodeURIComponent(parsed.realm || 'poe2')}`,
    `${apiBase}/api/trade2/fetch/${safeIds}?query=${safeQuery}`,
    `${apiBase}/api/trade/fetch/${safeIds}?query=${safeQuery}&realm=${encodeURIComponent(parsed.realm || 'poe2')}`
  ];

  let lastError = null;
  for (const endpoint of candidates) {
    try {
      const json = await poeFetch(endpoint, commonHeaders);
      const rows = extractFetchRows(json);
      return {
        endpoint,
        result: rows,
        rawRows: rows.length,
        rawShape: Array.isArray(json?.result) ? 'result[]' : (json?.result && typeof json.result === 'object' ? 'result{}' : Object.keys(json || {}).join(','))
      };
    } catch (err) {
      lastError = err;
      if (err.status === 429) throw err;
    }
  }
  throw lastError || new Error('无法读取国服物品详情');
}

async function handleCheck(req, res) {
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const parsed = parseTradeUrl(body.tradeUrl);
    const limit = Math.max(1, Math.min(Number(body.limit || 10), 50));
    const authCookie = sanitizeCookie(body.authCookie || body.cookie || '');
    const search = await fetchSearch(parsed, limit, authCookie);
    const fetched = search.directItems && search.directItems.length
      ? { endpoint: 'search response direct items', result: search.directItems, rawRows: search.directItems.length, rawShape: 'direct' }
      : await fetchItems(parsed, search.ids, authCookie);
    const filters = body.filters || {};
    const allRows = fetched.result || [];
    const dropped = [];
    const filtered = allRows.filter(item => {
      const reasons = buildDroppedReason(item, filters);
      if (reasons.length && dropped.length < 10) {
        dropped.push({
          name: getItemName(item),
          price: priceToText(getPriceObject(item?.listing || {})),
          seller: getSeller(item?.listing),
          reasons
        });
      }
      return reasons.length === 0;
    }).map(item => ({
      id: item.id,
      name: getItemName(item),
      seller: getSeller(item.listing),
      online: isOnline(item.listing),
      price: getPriceObject(item.listing || {}) || null,
      priceText: priceToText(getPriceObject(item.listing || {})),
      whisper: getWhisper(item),
      tradeMode: getTradeMode(item),
      indexed: item.listing?.indexed || '',
      icon: item.item?.icon || '',
      raw: item
    }));

    sendJson(res, 200, {
      ok: true,
      parsed,
      checkedAt: new Date().toISOString(),
      endpoints: {
        search: search.endpoint,
        fetch: fetched.endpoint
      },
      authenticated: Boolean(authCookie),
      total: search.total,
      searchRows: search.rawRows,
      searchIds: search.ids.length,
      fetched: allRows.length,
      matched: filtered.length,
      dropped,
      debug: {
        searchShape: search.rawShape,
        fetchShape: fetched.rawShape,
        searchPreview: search.ids.slice(0, 3),
        searchAttempts: search.attempts || [],
        usedHydratedQuery: Boolean(search.usedHydratedQuery)
      },
      items: filtered
    });
  } catch (err) {
    const status = err.status === 429 ? 429 : 400;
    sendJson(res, status, {
      ok: false,
      status,
      retryAfterSeconds: err.status === 429 ? (err.retryAfterSeconds || 180) : null,
      error: err.message || String(err),
      hint: err.status === 429 ? `国服接口触发限流。单账号多项目监控必须串行轮询；当前队列会暂停 ${err.retryAfterSeconds || 180} 秒后继续，期间不要反复手动测试。` : (isAuthError(err) ? '国服接口 401 通常表示该搜索需要登录态。请在浏览器登录 poe.game.qq.com 后，从开发者工具复制该请求的 Cookie，粘贴到页面的“国服登录 Cookie”中再测试。Cookie 只发给本地代理转发，不会保存进预设。' : '如果国服接口拒绝请求，可能是临时风控、维护或搜索链接无效；可以先用“加载模拟数据”测试前端过滤逻辑。')
    });
  }
}


function compactString(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}


function extractTradeSearchId(value = '') {
  const text = String(value || '');
  const match = text.match(/\/trade2?\/search\/poe2\/[^\/\s?#]+\/([^\/\s?#]+)/i)
    || text.match(/\/trade\/search\/[^\/\s?#]+\/([^\/\s?#]+)/i);
  return match ? compactString(decodeURIComponent(match[1]), 120) : '';
}

function sanitizeClickTask(body = {}) {
  const item = body.item || body || {};
  const price = item.price || {};
  const task = {
    id: compactString(body.taskId || item.id || `hideout-${Date.now()}-${Math.random().toString(36).slice(2)}`, 80),
    createdAt: new Date().toISOString(),
    sourceUrl: compactString(body.tradeUrl || body.sourceUrl || item.sourceUrl || '', 1200),
    sourceSearchId: extractTradeSearchId(body.tradeUrl || body.sourceUrl || item.sourceUrl || ''),
    name: compactString(item.name || item.itemName || body.name || '未知物品', 240),
    seller: compactString(item.seller || body.seller || '', 120),
    priceText: compactString(item.priceText || body.priceText || priceToText(price), 80),
    priceAmount: Number.isFinite(Number(price.amount ?? body.priceAmount)) ? Number(price.amount ?? body.priceAmount) : null,
    priceCurrency: compactString(price.currency || body.priceCurrency || '', 80),
    tradeMode: compactString(item.tradeMode || body.tradeMode || '商人页签 / 前往藏身处', 120),
    indexed: compactString(item.indexed || body.indexed || '', 80)
  };
  return task;
}

function enqueueHideoutClick(task) {
  hideoutClickQueue.push(task);
  while (hideoutClickQueue.length > MAX_CLICK_QUEUE) hideoutClickQueue.shift();
  return task;
}

function recordHideoutClickEvent(event) {
  hideoutClickEvents.unshift({ time: new Date().toISOString(), ...event });
  while (hideoutClickEvents.length > MAX_CLICK_EVENTS) hideoutClickEvents.pop();
}

function removeHideoutTask(taskId) {
  if (!taskId) return null;
  const index = hideoutClickQueue.findIndex(task => task.id === taskId);
  if (index < 0) return null;
  const [removed] = hideoutClickQueue.splice(index, 1);
  return removed || null;
}

async function handleHideoutClick(req, res, url) {
  if (req.method === 'POST') {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const task = enqueueHideoutClick(sanitizeClickTask(body));
    recordHideoutClickEvent({ taskId: task.id, status: 'queued', name: task.name, seller: task.seller, priceText: task.priceText, sourceSearchId: task.sourceSearchId });
    return sendJson(res, 200, { ok: true, queued: true, pending: hideoutClickQueue.length, task });
  }
  if (req.method === 'GET') {
    // v1.0 改成广播式读取：不再由第一个打开的官方页直接消费任务。
    // 只有当前官方页真正点击成功后，/api/click-result 才会按 taskId 删除任务。
    const task = hideoutClickQueue[0] || null;
    return sendJson(res, 200, { ok: true, task, pending: hideoutClickQueue.length, events: hideoutClickEvents.slice(0, 10) });
  }
  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
}

async function handleHideoutClickResult(req, res) {
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const clicked = Boolean(body.clicked);
  const taskId = compactString(body.taskId || '', 80);
  const event = {
    taskId,
    status: clicked ? 'clicked' : (body.ignored ? 'ignored' : 'failed'),
    clicked,
    ignored: Boolean(body.ignored),
    reason: compactString(body.reason || '', 240),
    targetText: compactString(body.targetText || '', 240),
    score: Number.isFinite(Number(body.score)) ? Number(body.score) : null,
    pageUrl: compactString(body.pageUrl || '', 500)
  };
  if (clicked && taskId) {
    removeHideoutTask(taskId);
  }
  recordHideoutClickEvent(event);
  return sendJson(res, 200, { ok: true, event, pending: hideoutClickQueue.length, events: hideoutClickEvents.slice(0, 10) });
}

function runPowerShellClick(x, y) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('原生坐标点击仅支持 Windows 本地 Node 环境'));
      return;
    }
    const safeX = Math.max(0, Math.min(10000, Math.round(Number(x))));
    const safeY = Math.max(0, Math.min(10000, Math.round(Number(y))));

    // v1.4: 不再用 -Command + here-string 直接拼 PowerShell。
    // 在部分 Windows/Edge/Tampermonkey 环境里，-Command 会把 C# MemberDefinition 拆坏，
    // 导致 Add-Type/DllImport 语法失败，网页只显示“已执行网页点击”，实际没有传送。
    // 改为 -EncodedCommand（UTF-16LE）后，PowerShell 会完整接收脚本，坐标点击恢复稳定。
    const ps = `
$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Runtime.InteropServices;
public static class Poe2NativeClick {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
Add-Type -TypeDefinition $code -Language CSharp
[Poe2NativeClick]::SetCursorPos(${safeX}, ${safeY}) | Out-Null
Start-Sleep -Milliseconds 80
[Poe2NativeClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Poe2NativeClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "clicked:${safeX},${safeY}"
`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    childProcess.execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = `${stderr || ''}
${stdout || ''}
${err.message || ''}`.trim();
        reject(new Error(msg || 'PowerShell 坐标点击失败'));
        return;
      }
      resolve({ x: safeX, y: safeY, stdout: compactString(stdout || '', 200) });
    });
  });
}

async function handleNativeClick(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const x = Number(body.x);
  const y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return sendJson(res, 400, { ok: false, error: '缺少有效坐标 x/y' });
  }
  try {
    const result = await runPowerShellClick(x, y);
    recordHideoutClickEvent({ taskId: compactString(body.taskId || '', 80), status: 'native-click', clicked: true, reason: `已执行 Windows 原生坐标点击 (${result.x}, ${result.y})` });
    return sendJson(res, 200, { ok: true, result });
  } catch (err) {
    recordHideoutClickEvent({ taskId: compactString(body.taskId || '', 80), status: 'native-click-failed', clicked: false, reason: compactString(err.message || String(err), 240) });
    return sendJson(res, 400, { ok: false, error: err.message || String(err) });
  }
}

function mockItems() {
  const rows = [
    ['完美珠宝匠石', 'TraderOne', true, 1.2, 'divine'],
    ['高阶崇高石', 'TraderTwo', true, 28, 'exalted'],
    ['稀有引路石 15 阶', 'MapSeller', false, 8, 'exalted'],
    ['苍空 防身甲 邪恶束衣', 'ArmourSeller', true, 0.8, 'divine'],
    ['石板：惊悸迷雾', 'TabletBoss', true, 45, 'exalted']
  ];
  return rows.map((r, i) => ({
    id: `mock-${i + 1}`,
    name: r[0],
    seller: r[1],
    online: r[2],
    price: { type: '~price', amount: r[3], currency: r[4] },
    priceText: `${r[3]} ${r[4]}`,
    whisper: i < 2 ? '' : `@${r[1]} Hi, I would like to buy your ${r[0]} listed for ${r[3]} ${r[4]} in Path of Exile 2`,
    tradeMode: i < 2 ? '商人页签 / 前往藏身处' : '私聊交易',
    indexed: new Date(Date.now() - i * 60000).toISOString(),
    icon: '',
    raw: {}
  }));
}

async function handleMock(req, res) {
  try {
    const raw = await readBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const filters = body.filters || {};
    const items = mockItems().filter(item => passFilters({ listing: { account: { online: item.online, name: item.seller }, price: item.price }, item: { name: item.name } }, filters));
    sendJson(res, 200, {
      ok: true,
      mock: true,
      checkedAt: new Date().toISOString(),
      total: 5,
      fetched: 5,
      matched: items.length,
      items
    });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || String(err) });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  filePath = path.normalize(filePath).replace(/^([/\\])+/, '');
  const fullPath = path.join(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return sendJson(res, 204, { ok: true });
  if (req.method === 'POST' && url.pathname === '/api/check') return handleCheck(req, res);
  if (req.method === 'POST' && url.pathname === '/api/mock') return handleMock(req, res);
  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/click-hideout') return handleHideoutClick(req, res, url);
  if (req.method === 'POST' && url.pathname === '/api/click-result') return handleHideoutClickResult(req, res);
  if (req.method === 'POST' && url.pathname === '/api/native-click') return handleNativeClick(req, res);
  if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, time: new Date().toISOString(), clickQueue: hideoutClickQueue.length, clickEvents: hideoutClickEvents.slice(0, 5) });
  if (req.method === 'GET') return serveStatic(req, res);
  sendJson(res, 405, { ok: false, error: 'Method not allowed' });
});

if (require.main === module) {
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`端口 127.0.0.1:${PORT} 已被占用。请先关闭旧版 npm start 窗口，或在管理员/普通 PowerShell 中执行：`);
      console.error(`netstat -ano | findstr :${PORT}`);
      console.error('找到 PID 后执行：taskkill /PID <PID> /F');
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`POE2 国服集市监控网页测试版 v1.7 已启动：http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  parseTradeUrl,
  normalizeCurrency,
  normalizeCurrencyList,
  passFilters,
  mockItems,
  sanitizeCookie,
  extractSearchRows,
  extractFetchRows,
  buildDroppedReason,
  sanitizeClickTask
};
