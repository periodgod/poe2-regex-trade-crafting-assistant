const $ = (id) => document.getElementById(id);

const state = {
  timer: null,
  timers: [],
  running: false,
  mode: 'idle',
  checkCount: 0,
  lastItems: [],
  monitorResults: new Map(),
  monitorStats: new Map(),
  openedOnce: new Set(),
  copiedOnce: new Set(),
  hideoutOnce: new Set(),
  schedulerToken: 0,
  cooldownUntil: 0
};

// 国服集市登录态属于同一个账号，同一时间并发刷新多个搜索页容易触发 429。
// 因此所有项目包统一进入一个串行队列，逐个刷新；即使每个项目都写了 60 秒，也不会并发请求。
const GLOBAL_REQUEST_GAP_MS = 65000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 180000;

const STORAGE_KEY = 'poe2.cn.market.monitor.web.projects.v16';
const LEGACY_KEYS = ['poe2.cn.market.monitor.web.saved.v15', 'poe2.cn.market.monitor.web.saved.v13', 'poe2.cn.market.monitor.web.saved.v9'];

const fields = [
  'tradeUrl', 'tradeUrls', 'watchName', 'sessionCookie', 'currency', 'minPrice', 'maxPrice', 'limit', 'intervalSec',
  'onlineOnly', 'pricedOnly', 'exactOnly', 'notifyDesktop', 'autoCopy', 'autoHideout', 'autoOpen'
];


const CURRENCY_DEFS = [
  ['divine', '神圣石 Divine'],
  ['exalted', '崇高石 Exalted'],
  ['chaos', '混沌石 Chaos'],
  ['chance', '机会石 Chance'],
  ['regal', '富豪石 Regal'],
  ['vaal', '瓦尔宝珠 Vaal'],
  ['alchemy', '点金石 Alchemy'],
  ['annulment', '剥离石 Annulment'],
  ['lesser-jewellers-orb', '低阶珠宝匠石'],
  ['greater-jewellers-orb', '高阶珠宝匠石'],
  ['perfect-jewellers-orb', '完美珠宝匠石'],
  ['gemcutters-prism', '宝石匠的棱镜'],
  ['mirror', '卡兰德的魔镜']
];

function currencyTextByValue(value) {
  if (!value || value === 'any') return '任意通货';
  const hit = CURRENCY_DEFS.find(row => row[0] === value);
  return hit ? hit[1] : value;
}

function splitTradeUrls(value) {
  return String(value || '')
    .split(/[\n,，]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function getTradeUrls() {
  const many = splitTradeUrls($('tradeUrls')?.value || '');
  if (many.length) return Array.from(new Set(many));
  const one = ($('tradeUrl')?.value || '').trim();
  return one ? [one] : [];
}

function renderPriceRangeRows() {
  const box = $('priceRangeRows');
  if (!box) return;
  box.innerHTML = CURRENCY_DEFS.map(([value, label]) => `
    <div class="price-range-row" data-currency="${escapeHtml(value)}">
      <label><input type="checkbox" class="range-enabled" data-currency="${escapeHtml(value)}">${escapeHtml(label)}</label>
      <input type="number" min="0" step="0.01" class="range-min" data-currency="${escapeHtml(value)}" placeholder="最低">
      <input type="number" min="0" step="0.01" class="range-max" data-currency="${escapeHtml(value)}" placeholder="最高">
    </div>`).join('');
  updatePriceRangeRowState();
}

function updatePriceRangeRowState() {
  document.querySelectorAll('.price-range-row').forEach(row => {
    const enabled = row.querySelector('.range-enabled')?.checked;
    row.classList.toggle('enabled', Boolean(enabled));
  });
}

function getPriceRanges() {
  return Array.from(document.querySelectorAll('.price-range-row')).map(row => {
    const currency = row.dataset.currency;
    const enabled = row.querySelector('.range-enabled')?.checked || false;
    const minPrice = row.querySelector('.range-min')?.value ?? '';
    const maxPrice = row.querySelector('.range-max')?.value ?? '';
    return { currency, enabled, minPrice, maxPrice };
  }).filter(row => row.enabled);
}

function setPriceRanges(ranges) {
  const rows = Array.isArray(ranges)
    ? ranges
    : Object.entries(ranges || {}).map(([currency, cfg]) => ({ currency, ...(cfg || {}) }));
  const map = new Map(rows.map(row => [row.currency, row]));
  document.querySelectorAll('.price-range-row').forEach(row => {
    const currency = row.dataset.currency;
    const cfg = map.get(currency) || {};
    const enabled = row.querySelector('.range-enabled');
    const min = row.querySelector('.range-min');
    const max = row.querySelector('.range-max');
    if (enabled) enabled.checked = Boolean(cfg.enabled);
    if (min) min.value = cfg.minPrice ?? cfg.min ?? '';
    if (max) max.value = cfg.maxPrice ?? cfg.max ?? '';
  });
  updatePriceRangeRowState();
}

function clearPriceRanges() {
  setPriceRanges([]);
}

function priceRangeLabel(ranges) {
  const rows = Array.isArray(ranges) ? ranges.filter(row => row.enabled !== false) : [];
  if (!rows.length) return '';
  return rows.map(row => {
    const min = row.minPrice ?? row.min ?? '';
    const max = row.maxPrice ?? row.max ?? '';
    return `${currencyTextByValue(row.currency)} ${min || '不限'}-${max || '不限'}`;
  }).join(' / ');
}

function expandConfigs(cfg) {
  const urls = Array.isArray(cfg.tradeUrls) && cfg.tradeUrls.length ? cfg.tradeUrls : (cfg.tradeUrl ? [cfg.tradeUrl] : []);
  return urls.map((url, idx) => ({
    ...cfg,
    tradeUrl: url,
    tradeUrls: urls,
    watchName: urls.length > 1 ? `${cfg.watchName || '批量监控'} #${idx + 1}` : (cfg.watchName || '未命名监控')
  }));
}

function getSelectedCurrencies() {
  const select = $('currency');
  if (!select) return ['any'];
  const values = Array.from(select.selectedOptions || []).map(option => option.value).filter(Boolean);
  if (!values.length || values.includes('any')) return ['any'];
  return Array.from(new Set(values));
}

function setSelectedCurrencies(values) {
  const select = $('currency');
  if (!select) return;
  const list = Array.isArray(values) ? values : [values || 'any'];
  const normalized = !list.length || list.includes('any') ? ['any'] : list;
  Array.from(select.options).forEach(option => {
    option.selected = normalized.includes(option.value);
  });
}

function currencyLabel(values) {
  const list = Array.isArray(values) ? values : [values || 'any'];
  if (!list.length || list.includes('any')) return '任意通货';
  const map = new Map(Array.from(($('currency')?.options || [])).map(opt => [opt.value, opt.textContent.trim()]));
  return list.map(v => map.get(v) || v).join(' / ');
}

function readConfig() {
  const currencies = getSelectedCurrencies();
  const tradeUrls = getTradeUrls();
  return {
    tradeUrl: tradeUrls[0] || $('tradeUrl').value.trim(),
    tradeUrls,
    watchName: $('watchName').value.trim() || '未命名监控',
    authCookie: $('sessionCookie') ? $('sessionCookie').value.trim() : '',
    limit: Number($('limit').value || 10),
    intervalSec: Math.max(60, Number($('intervalSec').value || 90)),
    filters: {
      currency: currencies,
      currencies,
      priceRanges: getPriceRanges(),
      minPrice: $('minPrice').value,
      maxPrice: $('maxPrice').value,
      onlineOnly: $('onlineOnly').checked,
      pricedOnly: $('pricedOnly').checked,
      exactOnly: $('exactOnly').checked
    },
    actions: {
      notifyDesktop: $('notifyDesktop').checked,
      autoCopy: $('autoCopy').checked,
      autoHideout: $('autoHideout') ? $('autoHideout').checked : false,
      autoOpen: $('autoOpen').checked
    }
  };
}

function writeConfig(cfg) {
  $('tradeUrl').value = cfg.tradeUrl || '';
  if ($('tradeUrls')) $('tradeUrls').value = Array.isArray(cfg.tradeUrls) ? cfg.tradeUrls.join('\n') : '';
  $('watchName').value = cfg.watchName || '';
  $('limit').value = cfg.limit || 10;
  $('intervalSec').value = cfg.intervalSec || 90;
  setSelectedCurrencies(cfg.filters?.currencies || cfg.filters?.currency || 'any');
  setPriceRanges(cfg.filters?.priceRanges || []);
  $('minPrice').value = cfg.filters?.minPrice ?? '';
  $('maxPrice').value = cfg.filters?.maxPrice ?? '';
  $('onlineOnly').checked = cfg.filters?.onlineOnly ?? false;
  $('pricedOnly').checked = cfg.filters?.pricedOnly ?? true;
  $('exactOnly').checked = cfg.filters?.exactOnly ?? false;
  $('notifyDesktop').checked = cfg.actions?.notifyDesktop ?? true;
  $('autoCopy').checked = cfg.actions?.autoCopy ?? false;
  if ($('autoHideout')) $('autoHideout').checked = cfg.actions?.autoHideout ?? false;
  $('autoOpen').checked = cfg.actions?.autoOpen ?? false;
}

function setError(text) {
  const box = $('errorBox');
  if (!text) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  box.classList.remove('hidden');
  box.textContent = text;
}

function appendError(text) {
  if (!text) return;
  const box = $('errorBox');
  box.classList.remove('hidden');
  box.textContent = box.textContent ? `${box.textContent}\n${text}` : text;
}

function setMetric(id, value) { $(id).textContent = String(value); }
function setRunState(text) { $('runState').textContent = text; }

function updateControls() {
  $('startBtn').disabled = state.running;
  $('startSavedBtn').disabled = state.running;
  $('stopBtn').disabled = !state.running;
  $('testBtn').disabled = state.running;
  $('mockBtn').disabled = state.running;
}

function formatTime(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function requestDesktopPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

async function notifyHit(count, first, cfg) {
  if (!cfg?.actions?.notifyDesktop || !('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission().catch(() => 'denied');
  if (Notification.permission !== 'granted') return;
  const prefix = cfg.watchName ? `【${cfg.watchName}】` : '';
  const body = first ? `${first.name}\n${first.priceText} · ${first.seller}` : `命中 ${count} 条`;
  new Notification(`${prefix}POE2 集市命中：${count} 条`, { body });
}

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function buildCopyText(item) {
  if (!item) return '';
  if (item.whisper) return item.whisper;
  return [
    item._monitorName ? `监控：${item._monitorName}` : '',
    item.name || '未知物品',
    item.priceText ? `价格：${item.priceText}` : '',
    item.seller ? `商家：${item.seller}` : '',
    item.indexed ? `上架：${formatTime(item.indexed)}` : '',
    '国服商人页签：可通过本地点击助手在已打开的官方集市页中点击“前往藏身处”；进入后仍需手动确认是否购买。'
  ].filter(Boolean).join('\n');
}

async function sendHideoutTask(item) {
  if (!item) throw new Error('没有可发送的物品');
  const tradeUrl = item._tradeUrl || readConfig().tradeUrl;
  const json = await postJson('/api/click-hideout', {
    tradeUrl,
    item: {
      id: item.id,
      name: item.name,
      seller: item.seller,
      priceText: item.priceText,
      price: item.price,
      tradeMode: item.tradeMode,
      indexed: item.indexed
    }
  });
  return json;
}

function decorateItems(items, cfg, monitorId) {
  return (items || []).map((item, index) => ({
    ...item,
    _key: `${monitorId}:${item.id || index}`,
    _monitorId: monitorId,
    _monitorName: cfg.watchName || '未命名监控',
    _tradeUrl: cfg.tradeUrl || ''
  }));
}

function collectAllItems() {
  const combined = [];
  for (const rows of state.monitorResults.values()) combined.push(...rows);
  state.lastItems = combined;
  return combined;
}

function renderResults(items, meta = {}) {
  const list = $('resultList');
  if (!items || !items.length) {
    list.className = 'result-list empty';
    list.textContent = '没有命中当前价格条件的物品';
    return;
  }
  list.className = 'result-list';
  list.innerHTML = items.map((item, index) => {
    const onlineClass = item.online ? 'online' : 'offline';
    const onlineText = item.online ? '在线' : '离线/未知';
    const whisperSafe = escapeHtml(item.whisper || '');
    return `
      <article class="result-item" data-index="${index}">
        <div>
          <h3>${escapeHtml(item.name || '未知物品')}</h3>
          <div class="result-meta">
            ${item._monitorName ? `<span class="pill monitor-pill">监控：${escapeHtml(item._monitorName)}</span>` : ''}
            <span class="pill ${onlineClass}">${onlineText}</span>
            ${item.tradeMode ? `<span class="pill">${escapeHtml(item.tradeMode)}</span>` : ''}
            <span class="pill">商家：${escapeHtml(item.seller || '未知')}</span>
            <span class="pill">上架：${escapeHtml(formatTime(item.indexed))}</span>
            ${meta.mock ? '<span class="pill">模拟数据</span>' : ''}
          </div>
          ${whisperSafe ? `<p class="sub whisper">${whisperSafe}</p>` : ''}
        </div>
        <div class="result-actions">
          <div class="price">${escapeHtml(item.priceText || '未标价')}</div>
          <button data-action="copy" data-index="${index}" class="secondary">复制物品信息</button>
          <button data-action="hideout" data-index="${index}" class="lime">模拟点击前往藏身处</button>
          <button data-action="open" data-index="${index}" class="ghost">打开集市页</button>
        </div>
      </article>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    const message = json?.error || `请求失败：${response.status}`;
    const hint = json?.hint ? `\n\n处理方式：${json.hint}` : '';
    const err = new Error(message + hint);
    err.status = json?.status || response.status;
    err.retryAfterSeconds = Number(json?.retryAfterSeconds || json?.retryAfter || 0) || null;
    throw err;
  }
  return json;
}

function buildDiag(json) {
  const baseDiag = json.mock
    ? '模拟数据'
    : `搜索返回 ${json.searchIds ?? 0} 个ID / 详情返回 ${json.fetched ?? 0} 条 / 过滤后 ${json.matched ?? 0} 条`;
  const attempts = json.debug?.searchAttempts || [];
  const attemptDiag = (!json.mock && attempts.length)
    ? `。接口尝试：${attempts.map(a => a.error ? `${a.method || 'GET'}失败` : `${a.method || 'GET'}:${a.ids || 0}ID/${a.rawShape || '-'}${a.hydratedQuery ? '/查询定义' : ''}`).join('，')}`
    : '';
  const hydratedDiag = json.debug?.usedHydratedQuery ? '。已读取保存搜索定义并二次 POST 执行搜索' : '';
  const dropDiag = json.dropped?.length ? `。未命中原因示例：${json.dropped[0].reasons.join('、')}` : '';
  return baseDiag + hydratedDiag + attemptDiag + dropDiag;
}

async function runCheckForConfig(cfg, { mock = false, monitorId = 'current', silent = false } = {}) {
  const endpoint = mock ? '/api/mock' : '/api/check';
  const payload = {
    tradeUrl: cfg.tradeUrl,
    authCookie: cfg.authCookie || ($('sessionCookie') ? $('sessionCookie').value.trim() : ''),
    limit: cfg.limit,
    filters: cfg.filters
  };

  try {
    const json = await postJson(endpoint, payload);
    const decorated = decorateItems(json.items || [], cfg, monitorId);
    state.monitorResults.set(monitorId, decorated);
    state.monitorStats.set(monitorId, { fetched: Number(json.fetched || 0), matched: decorated.length });
    const combined = collectAllItems();
    state.checkCount += 1;
    setMetric('checkCount', state.checkCount);
    setMetric('fetchedCount', Array.from(state.monitorStats.values()).reduce((n, row) => n + Number(row.fetched || 0), 0));
    setMetric('matchedCount', combined.length);
    setMetric('lastChecked', formatTime(json.checkedAt));

    const prefix = state.mode === 'multi' ? `【${cfg.watchName || '未命名监控'}】` : '';
    const diag = `${prefix}${buildDiag(json)}`;
    $('resultHint').textContent = state.mode === 'multi'
      ? `项目包监控中，共 ${state.monitorResults.size} 个项目包；最近检查：${diag}`
      : diag;

    renderResults(combined, { mock: json.mock });

    if (decorated.length > 0) {
      await notifyHit(decorated.length, decorated[0], cfg);
      if (cfg.actions?.autoCopy && !state.copiedOnce.has(monitorId)) {
        await copyText(buildCopyText(decorated[0]));
        state.copiedOnce.add(monitorId);
      }
      if (cfg.actions?.autoHideout && !state.hideoutOnce.has(monitorId)) {
        try {
          await sendHideoutTask(decorated[0]);
          $('resultHint').textContent += `。已向官方集市页点击助手发送【${cfg.watchName || '未命名监控'}】第一条“前往藏身处”任务`;
          state.hideoutOnce.add(monitorId);
        } catch (err) {
          appendError(`【${cfg.watchName || '未命名监控'}】发送前往藏身处点击任务失败：${err.message || err}`);
        }
      }
      if (cfg.actions?.autoOpen && !state.openedOnce.has(monitorId) && cfg.tradeUrl) {
        window.open(cfg.tradeUrl, '_blank', 'noopener,noreferrer');
        state.openedOnce.add(monitorId);
      }
    }
    return json;
  } catch (err) {
    if (!silent) appendError(`【${cfg.watchName || '未命名监控'}】${err.message || String(err)}`);
    setMetric('lastChecked', new Date().toLocaleString());
    throw err;
  }
}

async function runCheck({ mock = false } = {}) {
  const cfg = readConfig();
  setRunState(mock ? '模拟测试中' : '检查中');
  setError('');
  state.mode = 'single';
  try {
    await runCheckForConfig(cfg, { mock, monitorId: 'current' });
    setRunState(state.running ? '监控中' : '已完成');
  } catch {
    setRunState(state.running ? '监控中，最近一次失败' : '检查失败');
  }
}

function clearTimers() {
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  state.timers.forEach(timer => window.clearTimeout(timer));
  state.timers = [];
}

function delay(ms) {
  return new Promise(resolve => {
    const timer = window.setTimeout(() => {
      state.timers = state.timers.filter(item => item !== timer);
      resolve();
    }, Math.max(0, ms));
    state.timers.push(timer);
  });
}

function parseRetrySeconds(err) {
  if (Number.isFinite(Number(err?.retryAfterSeconds)) && Number(err.retryAfterSeconds) > 0) {
    return Number(err.retryAfterSeconds);
  }
  const match = String(err?.message || '').match(/等待\s*(\d+)\s*秒/);
  if (match) return Number(match[1]);
  return null;
}

async function runSerialScheduler(configs, label = '项目包监控') {
  const token = ++state.schedulerToken;
  const authCookie = $('sessionCookie') ? $('sessionCookie').value.trim() : '';
  const entries = configs.map((cfg, idx) => {
    const interval = Math.max(60, Number(cfg.intervalSec || 90));
    return {
      cfg: { ...cfg, authCookie },
      monitorId: `${cfg.id || 'project'}-${idx}`,
      nextDue: Date.now() + idx * GLOBAL_REQUEST_GAP_MS,
      intervalMs: interval * 1000,
      index: idx,
      failures: 0
    };
  });

  $('resultHint').textContent = `${label}采用单账号串行队列：${entries.length} 个项目包轮流刷新，每次国服请求至少间隔 ${Math.round(GLOBAL_REQUEST_GAP_MS / 1000)} 秒，避免多个项目同时抢同一个账号导致 429。`;

  while (state.running && token === state.schedulerToken) {
    const now = Date.now();
    entries.sort((a, b) => a.nextDue - b.nextDue || a.index - b.index);
    const entry = entries[0];
    const cooldownWait = Math.max(0, state.cooldownUntil - now);
    const dueWait = Math.max(0, entry.nextDue - now);
    const wait = Math.max(cooldownWait, dueWait);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      const name = entry.cfg.watchName || `项目包 ${entry.index + 1}`;
      setRunState(cooldownWait > 0
        ? `${label}：国服限流冷却中，${seconds} 秒后继续`
        : `${label}：等待 ${seconds} 秒后检查 ${name}`);
      await delay(Math.min(wait, 1000));
      continue;
    }

    const name = entry.cfg.watchName || `项目包 ${entry.index + 1}`;
    const position = entries.findIndex(row => row === entry) + 1;
    setRunState(`${label}：正在检查 ${name}（串行 ${position}/${entries.length}）`);
    try {
      await runCheckForConfig(entry.cfg, { monitorId: entry.monitorId });
      entry.failures = 0;
      setRunState(`${label}：轮询中，刚检查 ${name}`);
    } catch (err) {
      entry.failures += 1;
      const isRateLimited = err?.status === 429 || /429|rate limit/i.test(String(err?.message || ''));
      if (isRateLimited) {
        const retrySeconds = parseRetrySeconds(err) || Math.round(DEFAULT_RATE_LIMIT_PAUSE_MS / 1000);
        const pauseMs = Math.max(retrySeconds * 1000, GLOBAL_REQUEST_GAP_MS);
        state.cooldownUntil = Date.now() + pauseMs;
        appendError(`【单账号串行队列】国服 429 限流，已暂停所有项目包 ${Math.ceil(pauseMs / 1000)} 秒；不会继续并发重试。`);
      }
      setRunState(`${label}：轮询中，${name} 最近一次失败`);
    }

    entry.nextDue = Date.now() + Math.max(entry.intervalMs, GLOBAL_REQUEST_GAP_MS);
    if (state.running && token === state.schedulerToken) {
      await delay(GLOBAL_REQUEST_GAP_MS);
    }
  }
}

function resetRuntime({ keepResults = false } = {}) {
  state.checkCount = 0;
  state.openedOnce.clear();
  state.copiedOnce.clear();
  state.hideoutOnce.clear();
  if (!keepResults) {
    state.monitorResults.clear();
    state.monitorStats.clear();
    state.lastItems = [];
    renderResults([]);
  }
  setMetric('checkCount', 0);
  setMetric('fetchedCount', 0);
  setMetric('matchedCount', 0);
  setMetric('lastChecked', '-');
}

function startMonitor() {
  if (state.running) return;
  const cfg = readConfig();
  const configs = expandConfigs(cfg).filter(item => item.tradeUrl);
  if (!configs.length) {
    setError('请先填写至少一个国服官方集市链接。');
    return;
  }
  requestDesktopPermission();
  setError('');
  resetRuntime();
  state.running = true;
  state.mode = configs.length > 1 ? 'multi' : 'single';
  state.cooldownUntil = 0;
  updateControls();
  setRunState(configs.length > 1 ? `临时串行监控中（${configs.length}个链接）` : '临时监控中');
  runSerialScheduler(configs, configs.length > 1 ? `临时串行监控（${configs.length}项）` : '临时监控')
    .catch(err => {
      appendError(`串行监控异常停止：${err.message || err}`);
      stopMonitor();
    });
}

function getSelectedSavedConfigs() {
  const ids = Array.from(document.querySelectorAll('.saved-check:checked')).map(el => el.value);
  const list = getSaved();
  return list.filter(item => ids.includes(item.id));
}

function normalizeProjectConfigs(selected) {
  const normalized = [];
  selected.forEach((cfg) => {
    const urls = Array.isArray(cfg.tradeUrls) && cfg.tradeUrls.length ? cfg.tradeUrls : (cfg.tradeUrl ? [cfg.tradeUrl] : []);
    if (urls.length <= 1) {
      normalized.push({ ...cfg, tradeUrl: urls[0] || cfg.tradeUrl || '', tradeUrls: [] });
      return;
    }
    urls.forEach((url, idx) => {
      normalized.push({
        ...cfg,
        id: `${cfg.id || 'project'}-${idx}`,
        tradeUrl: url,
        tradeUrls: [],
        watchName: `${cfg.watchName || '批量项目'} #${idx + 1}`
      });
    });
  });
  return normalized.filter(cfg => cfg.tradeUrl);
}

function startSavedMonitors() {
  if (state.running) return;
  const selected = getSelectedSavedConfigs();
  const configs = normalizeProjectConfigs(selected);
  if (!configs.length) {
    setError('请先添加并勾选至少一个监控项目包。');
    return;
  }
  requestDesktopPermission();
  setError('');
  resetRuntime();
  state.running = true;
  state.mode = 'multi';
  state.cooldownUntil = 0;
  updateControls();
  setRunState(`项目包串行监控中（${configs.length}项）`);
  runSerialScheduler(configs, `项目包串行监控（${configs.length}项）`)
    .catch(err => {
      appendError(`项目包串行监控异常停止：${err.message || err}`);
      stopMonitor();
    });
}

function stopMonitor() {
  state.running = false;
  state.schedulerToken += 1;
  state.cooldownUntil = 0;
  clearTimers();
  updateControls();
  setRunState('已停止');
}

function getSaved() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    }
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function setSaved(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  renderSaved();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveCurrent() {
  const cfg = readConfig();
  const configs = expandConfigs(cfg).filter(item => item.tradeUrl);
  if (!configs.length) {
    setError('添加前请先填写至少一个国服官方集市链接。');
    return;
  }
  const list = getSaved();
  const now = new Date().toISOString();
  const packages = configs.map((item, idx) => ({
    id: makeId(),
    createdAt: now,
    projectType: 'trade-monitor-package',
    ...item,
    tradeUrls: [],
    watchName: item.watchName || (configs.length > 1 ? `监控项目 #${idx + 1}` : '未命名监控'),
    authCookie: ''
  }));
  setSaved([...packages, ...list].slice(0, 80));
  setError('');
  $('resultHint').textContent = `已添加 ${packages.length} 个监控项目包。请在右侧勾选项目包后点击“启动勾选项目包”。`;
}

function renderSaved() {
  const list = getSaved();
  const box = $('savedList');
  if (!list.length) {
    box.className = 'saved-list empty';
    box.textContent = '暂无项目包';
    return;
  }
  box.className = 'saved-list';
  box.innerHTML = list.map(item => {
    const ranges = priceRangeLabel(item.filters?.priceRanges || []);
    const cur = ranges || `${currencyLabel(item.filters?.currencies || item.filters?.currency || 'any')} · ${item.filters?.minPrice || '不限'} - ${item.filters?.maxPrice || '不限'}`;
    const urlCount = Array.isArray(item.tradeUrls) && item.tradeUrls.length ? item.tradeUrls.length : (item.tradeUrl ? 1 : 0);
    return `
      <div class="saved-item" data-id="${escapeHtml(item.id)}">
        <label class="saved-check-row">
          <input class="saved-check" type="checkbox" value="${escapeHtml(item.id)}" checked>
          <span>
            <strong>${escapeHtml(item.watchName || '未命名监控')}<span class="url-count-pill">项目包</span></strong>
            <small>${escapeHtml(cur)} · 每 ${escapeHtml(item.intervalSec || 90)} 秒 · ${escapeHtml(formatTime(item.createdAt))}</small>
          </span>
        </label>
        <div class="saved-actions">
          <button data-saved-action="load" data-id="${escapeHtml(item.id)}" class="secondary">加载</button>
          <button data-saved-action="delete" data-id="${escapeHtml(item.id)}" class="danger">删除</button>
        </div>
      </div>`;
  }).join('');
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    if (json.ok) {
      $('serverDot').className = 'dot ok';
      $('serverStatus').textContent = '本地服务正常';
      return;
    }
    throw new Error('bad');
  } catch {
    $('serverDot').className = 'dot bad';
    $('serverStatus').textContent = '本地服务异常';
  }
}

function resetAll() {
  fields.forEach(id => {
    const el = $(id);
    if (!el) return;
    if (id === 'currency') setSelectedCurrencies(['any']);
    else if (el.type === 'checkbox') el.checked = ['pricedOnly', 'notifyDesktop'].includes(id);
    else el.value = id === 'limit' ? '10' : id === 'intervalSec' ? '90' : '';
  });
  clearPriceRanges();
  setError('');
}

function toggleSavedChecks() {
  const checks = Array.from(document.querySelectorAll('.saved-check'));
  if (!checks.length) return;
  const shouldCheck = checks.some(ch => !ch.checked);
  checks.forEach(ch => { ch.checked = shouldCheck; });
}

function bind() {
  $('testBtn').addEventListener('click', () => runCheck());
  $('mockBtn').addEventListener('click', () => runCheck({ mock: true }));
  $('startBtn').addEventListener('click', startMonitor);
  $('startSavedBtn').addEventListener('click', startSavedMonitors);
  $('toggleSavedBtn').addEventListener('click', toggleSavedChecks);
  $('stopBtn').addEventListener('click', stopMonitor);
  $('saveBtn').addEventListener('click', saveCurrent);
  $('clearBtn').addEventListener('click', resetAll);
  $('currency').addEventListener('change', () => {
    const values = getSelectedCurrencies();
    if (values.includes('any')) setSelectedCurrencies(['any']);
  });
  if ($('clearPriceRangesBtn')) $('clearPriceRangesBtn').addEventListener('click', clearPriceRanges);
  if ($('priceRangeRows')) $('priceRangeRows').addEventListener('change', updatePriceRangeRowState);
  $('clearResultsBtn').addEventListener('click', () => {
    state.monitorResults.clear();
    state.monitorStats.clear();
    state.lastItems = [];
    renderResults([]);
    $('resultList').textContent = '暂无结果';
  });

  $('savedList').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-saved-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const list = getSaved();
    const item = list.find(x => x.id === id);
    if (btn.dataset.savedAction === 'load' && item) writeConfig(item);
    if (btn.dataset.savedAction === 'delete') setSaved(list.filter(x => x.id !== id));
  });

  $('resultList').addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const item = state.lastItems[Number(btn.dataset.index)];
    if (action === 'copy') {
      const ok = await copyText(buildCopyText(item));
      btn.textContent = ok ? '已复制' : '复制失败';
      setTimeout(() => { btn.textContent = '复制物品信息'; }, 1200);
    }
    if (action === 'hideout') {
      try {
        await sendHideoutTask(item);
        btn.textContent = '已发送点击任务';
        $('resultHint').textContent += `。已发送【${item?._monitorName || '当前监控'}】“前往藏身处”点击任务；请保持对应官方集市页打开并安装点击助手脚本`;
      } catch (err) {
        btn.textContent = '发送失败';
        setError(`发送前往藏身处点击任务失败：${err.message || err}`);
      }
      setTimeout(() => { btn.textContent = '模拟点击前往藏身处'; }, 1600);
    }
    if (action === 'open') {
      const url = item?._tradeUrl || readConfig().tradeUrl;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  $('notifyDesktop').addEventListener('change', () => {
    if ($('notifyDesktop').checked) requestDesktopPermission();
  });
}

renderPriceRangeRows();
bind();
renderSaved();
renderResults([]);
updateControls();
checkHealth();
