'use strict';

const api = window.desktopApi;
const $ = (id) => document.getElementById(id);

const SERVER_PROFILES = {
  'poe2-cn': { label: '流放2 国服', shortLabel: 'P2国服', sampleUrl: 'https://poe.game.qq.com/trade2/search/poe2/奥杜尔秘符/40o7WjEt9', cookieLabel: '国服登录 Cookie' },
  'poe2-intl': { label: 'Path of Exile 2 国际服', shortLabel: 'P2国际', sampleUrl: 'https://www.pathofexile.com/trade2/search/poe2/Standard/abc123?realm=poe2', cookieLabel: '国际服 POESESSID / Cookie' },
  'poe1-cn': { label: '流放1 国服', shortLabel: 'P1国服', sampleUrl: 'https://poe.game.qq.com/trade/search/赛季名/搜索ID', cookieLabel: '国服登录 Cookie' },
  'poe1-intl': { label: 'Path of Exile 1 国际服', shortLabel: 'P1国际', sampleUrl: 'https://www.pathofexile.com/trade/search/Standard/abc123', cookieLabel: '国际服 POESESSID / Cookie' }
};

const CURRENCY_DEFS = [
  ['divine', '神圣石 Divine'],
  ['exalted', '崇高石 Exalted'],
  ['chaos', '混沌石 Chaos'],
  ['mirror', '卡兰德的魔镜'],
  ['chance', '机会石 Chance'],
  ['regal', '富豪石 Regal'],
  ['vaal', '瓦尔宝珠 Vaal'],
  ['alchemy', '点金石 Alchemy'],
  ['annulment', '剥离石 Annulment'],
  ['alteration', '改造石 Alteration'],
  ['augmentation', '增幅石 Augmentation'],
  ['transmutation', '蜕变石 Transmutation'],
  ['scouring', '重铸石 Scouring'],
  ['fusing', '链接石 Fusing'],
  ['jewellers', '珠宝匠石 Jeweller'],
  ['chromatic', '幻色石 Chromatic'],
  ['blessed', '祝福石 Blessed'],
  ['regret', '后悔石 Regret'],
  ['gemcutters-prism', '宝石匠的棱镜 GCP'],
  ['ancient-orb', '远古石 Ancient'],
  ['lesser-jewellers-orb', '低阶珠宝匠石'],
  ['greater-jewellers-orb', '高阶珠宝匠石'],
  ['perfect-jewellers-orb', '完美珠宝匠石']
];

const GLOBAL_REQUEST_GAP_MS = 65000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 180000;

const state = {
  projects: [],
  running: false,
  timers: [],
  schedulerToken: 0,
  cooldownUntil: 0,
  checkCount: 0,
  monitorResults: new Map(),
  monitorStats: new Map(),
  copiedOnce: new Set(),
  openedOnce: new Set()
};

function uniqueId() {
  return `project-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function setStatus(message, tone = '') {
  $('statusBanner').textContent = message;
  $('statusBanner').className = `status-banner ${tone}`.trim();
  $('runState').textContent = message;
}

function setMetric(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value);
}

function splitTradeUrls(value) {
  return String(value || '').split(/[\n,，]+/).map(v => v.trim()).filter(Boolean);
}

function getTradeUrlsFromForm() {
  const many = splitTradeUrls($('bulkUrlsInput').value);
  if (many.length) return Array.from(new Set(many));
  const one = $('tradeUrlInput').value.trim();
  return one ? [one] : [];
}

function getSelectedCurrencies() {
  const select = $('currencySelect');
  const values = Array.from(select.selectedOptions || []).map(option => option.value).filter(Boolean);
  if (!values.length || values.includes('any')) return ['any'];
  return values;
}

function setSelectedCurrencies(values) {
  const normalized = Array.isArray(values) ? values : [values || 'any'];
  Array.from($('currencySelect').options).forEach(option => {
    option.selected = normalized.includes(option.value) || (!normalized.length && option.value === 'any');
  });
}

function currencyText(value) {
  if (!value || value === 'any') return '任意通货';
  const hit = CURRENCY_DEFS.find(row => row[0] === value);
  return hit ? hit[1] : value;
}

function renderPriceRangeRows() {
  $('priceRangeRows').innerHTML = CURRENCY_DEFS.map(([value, label]) => `
    <div class="price-range-row" data-currency="${escapeHtml(value)}">
      <label><input type="checkbox" class="range-enabled" data-currency="${escapeHtml(value)}">${escapeHtml(label)}</label>
      <input type="number" min="0" step="0.01" class="range-min" placeholder="最低">
      <input type="number" min="0" step="0.01" class="range-max" placeholder="最高">
    </div>`).join('');
  updatePriceRangeRowState();
}

function updatePriceRangeRowState() {
  document.querySelectorAll('.price-range-row').forEach(row => {
    row.classList.toggle('enabled', Boolean(row.querySelector('.range-enabled')?.checked));
  });
}

function getPriceRanges() {
  return Array.from(document.querySelectorAll('.price-range-row')).map(row => ({
    currency: row.dataset.currency,
    enabled: Boolean(row.querySelector('.range-enabled')?.checked),
    minPrice: row.querySelector('.range-min')?.value ?? '',
    maxPrice: row.querySelector('.range-max')?.value ?? ''
  })).filter(row => row.enabled);
}

function setPriceRanges(ranges) {
  const rows = Array.isArray(ranges) ? ranges : Object.entries(ranges || {}).map(([currency, cfg]) => ({ currency, ...(cfg || {}) }));
  const map = new Map(rows.map(row => [row.currency, row]));
  document.querySelectorAll('.price-range-row').forEach(row => {
    const cfg = map.get(row.dataset.currency) || {};
    const enabled = row.querySelector('.range-enabled');
    const min = row.querySelector('.range-min');
    const max = row.querySelector('.range-max');
    if (enabled) enabled.checked = Boolean(cfg.enabled);
    if (min) min.value = cfg.minPrice ?? cfg.min ?? '';
    if (max) max.value = cfg.maxPrice ?? cfg.max ?? '';
  });
  updatePriceRangeRowState();
}

function priceRangeLabel(ranges) {
  if (!ranges || !ranges.length) return '';
  return ranges.map(row => `${currencyText(row.currency)} ${row.minPrice || '不限'}–${row.maxPrice || '不限'}`).join(' / ');
}

function currentServerKey() {
  return $('serverSelect')?.value || 'poe2-cn';
}

function currentServerLabel(serverKey = currentServerKey()) {
  return SERVER_PROFILES[serverKey]?.label || serverKey || '未知区服';
}

function shortServerLabel(serverKey = currentServerKey()) {
  return SERVER_PROFILES[serverKey]?.shortLabel || currentServerLabel(serverKey);
}

function updateServerHelp() {
  const profile = SERVER_PROFILES[currentServerKey()] || SERVER_PROFILES['poe2-cn'];
  const tradeUrl = $('tradeUrlInput');
  const cookie = $('sessionCookieInput');
  const hint = $('serverHint');
  const cookieHint = $('cookieHint');
  if (tradeUrl) tradeUrl.placeholder = profile.sampleUrl;
  if (cookie) cookie.placeholder = `${profile.cookieLabel}，可只填 POESESSID=... 或完整 Cookie 请求头；不要把 Cookie 发给别人。`;
  if (hint) hint.textContent = `当前区服：${profile.label}。请粘贴该区服官方集市搜索结果页链接；批量添加可以混合四区服链接，程序会按链接自动识别。`;
  if (cookieHint) cookieHint.textContent = `仅测试或监控当前会话时使用，不写入项目包、不保存到本地文件。国际服推荐只填 POESESSID；国服可复制 Request Headers 中 Cookie 整行。`;
}

function formBaseConfig() {
  return {
    serverKey: currentServerKey(),
    serverLabel: currentServerLabel(),
    watchName: $('projectNameInput').value.trim() || '未命名监控',
    currencies: getSelectedCurrencies(),
    priceCurrency: getSelectedCurrencies()[0] === 'any' ? '' : getSelectedCurrencies()[0],
    minPrice: $('minPriceInput').value,
    maxPrice: $('maxPriceInput').value,
    priceRanges: getPriceRanges(),
    maxFetch: Math.max(1, Math.min(50, Number($('maxFetchInput').value) || 10)),
    intervalSeconds: Math.max(60, Math.min(3600, Number($('intervalInput').value) || 90)),
    pricedOnly: $('pricedOnlyInput').checked,
    exactOnly: $('exactOnlyInput').checked,
    exactPriceOnly: $('exactOnlyInput').checked,
    onlineOnly: $('onlineOnlyInput').checked,
    notifyDesktop: $('notifyInput').checked,
    autoCopy: $('autoCopyInput').checked,
    autoOpen: $('autoOpenInput').checked
  };
}

function buildProjectsFromForm() {
  const urls = getTradeUrlsFromForm();
  const base = formBaseConfig();
  if (!urls.length) throw new Error('请先填写至少一个官方集市链接。');
  return urls.map((url, idx) => ({
    id: uniqueId(),
    projectType: 'trade-monitor-package',
    ...base,
    watchName: urls.length > 1 ? `${base.watchName} #${idx + 1}` : base.watchName,
    url,
    tradeUrl: url,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function writeConfig(project) {
  if (!project) return;
  if ($('serverSelect')) $('serverSelect').value = project.serverKey || 'poe2-cn';
  updateServerHelp();
  $('tradeUrlInput').value = project.url || project.tradeUrl || '';
  $('bulkUrlsInput').value = '';
  $('projectNameInput').value = project.watchName || '';
  setSelectedCurrencies(project.currencies || project.priceCurrency || project.currency || 'any');
  $('minPriceInput').value = project.minPrice ?? '';
  $('maxPriceInput').value = project.maxPrice ?? '';
  $('maxFetchInput').value = project.maxFetch || project.limit || 10;
  $('intervalInput').value = project.intervalSeconds || project.intervalSec || 90;
  $('pricedOnlyInput').checked = project.pricedOnly !== false;
  $('exactOnlyInput').checked = Boolean(project.exactOnly || project.exactPriceOnly);
  $('onlineOnlyInput').checked = Boolean(project.onlineOnly);
  $('notifyInput').checked = project.notifyDesktop !== false;
  $('autoCopyInput').checked = Boolean(project.autoCopy || project.autoCopyWhisper);
  $('autoOpenInput').checked = Boolean(project.autoOpen);
  setPriceRanges(project.priceRanges || []);
}

async function saveProjects() {
  const result = await api.saveMarketMonitorState({ version: 2, activeId: null, monitors: state.projects });
  if (result?.state?.monitors) state.projects = result.state.monitors;
  renderProjectList();
}

function renderProjectList() {
  const box = $('projectList');
  if (!state.projects.length) {
    box.className = 'monitor-list empty';
    box.textContent = '暂无项目包。先在左侧填写一个物品，然后点击“添加为监控项目”。';
    return;
  }
  box.className = 'monitor-list';
  box.innerHTML = state.projects.map(project => {
    const rangeText = priceRangeLabel(project.priceRanges) || `${project.minPrice || '不限'}–${project.maxPrice || '不限'} ${currencyText((project.currencies || [project.priceCurrency || 'any'])[0])}`;
    return `<div class="saved-item" data-id="${escapeHtml(project.id)}">
      <label class="saved-check-row">
        <input class="project-check" type="checkbox" value="${escapeHtml(project.id)}" checked>
        <span>
          <strong>${escapeHtml(project.watchName || project.name || '未命名监控')}<span class="url-count-pill">${escapeHtml(shortServerLabel(project.serverKey || 'poe2-cn'))}</span><span class="url-count-pill">项目包</span></strong>
          <small>${escapeHtml(project.url || project.tradeUrl || '')}</small>
        </span>
      </label>
      <div class="saved-meta">
        <span>${escapeHtml(rangeText)}</span>
        <span>${escapeHtml(currentServerLabel(project.serverKey || 'poe2-cn'))}</span>
        <span>${escapeHtml(project.maxFetch || 10)} 条</span>
        <span>${escapeHtml(project.intervalSeconds || 90)} 秒</span>
      </div>
      <div class="saved-actions">
        <button data-action="load" data-id="${escapeHtml(project.id)}" class="btn small" type="button">加载</button>
        <button data-action="delete" data-id="${escapeHtml(project.id)}" class="btn small danger" type="button">删除</button>
      </div>
    </div>`;
  }).join('');
}

function selectedProjects() {
  const ids = Array.from(document.querySelectorAll('.project-check:checked')).map(el => el.value);
  return state.projects.filter(project => ids.includes(project.id));
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

function clearTimers() {
  state.timers.forEach(timer => window.clearTimeout(timer));
  state.timers = [];
}

function parseRetrySeconds(resultOrError) {
  const value = resultOrError?.retryAfter || resultOrError?.retryAfterSeconds;
  if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
  const match = String(resultOrError?.message || resultOrError?.error || '').match(/(\d+)\s*秒/);
  return match ? Number(match[1]) : null;
}

function priceText(price) {
  if (!price) return '未标价';
  return `${price.amount} ${price.rawCurrency || price.currency}`;
}

function itemInfoText(item, project) {
  return [
    `监控项目：${project.watchName || ''}`,
    `物品：${item.itemName || item.name || ''}`,
    `价格：${item.priceText || priceText(item.price)}`,
    `商家：${item.seller || ''}`,
    `交易模式：${item.tradeMode || '商人页签 / 前往藏身处'}`,
    `链接：${item.pageUrl || project.url || ''}`
  ].filter(Boolean).join('\n');
}

async function runCheckForProject(project, { monitorId = project.id, manual = false } = {}) {
  const authCookie = $('sessionCookieInput').value.trim();
  const payload = { ...project, authCookie, sessionCookie: authCookie, cookie: authCookie };
  const result = await api.checkMarketMonitor(payload);
  state.checkCount += 1;
  setMetric('checkCount', state.checkCount);
  setMetric('lastChecked', new Date().toLocaleTimeString());

  if (!result?.ok) {
    const err = new Error(result?.message || result?.error || '集市检查失败');
    err.status = result?.status;
    err.retryAfter = result?.retryAfter;
    throw err;
  }

  const items = (result.matches || result.items || []).map(item => ({ ...item, monitorName: project.watchName, sourceProjectId: project.id, pageUrl: item.pageUrl || result.pageUrl || project.url }));
  state.monitorResults.set(monitorId, items);
  state.monitorStats.set(monitorId, { project, result });
  setMetric('fetchedCount', result.fetchedCount ?? result.fetched ?? 0);
  setMetric('matchedCount', Array.from(state.monitorResults.values()).flat().length);
  $('resultSummary').textContent = `搜索返回 ${result.searchIds ?? result.totalResultCount ?? 0} 个ID / 详情返回 ${result.fetchedCount ?? 0} 条 / 过滤后 ${result.matchCount ?? 0} 条。${result.debug?.usedHydratedQuery ? '已读取保存搜索定义并二次 POST 执行搜索。' : ''}`;
  renderResults();
  await handleMatchedActions(items, project, manual);
  return result;
}

async function handleMatchedActions(items, project, manual) {
  if (!items.length) return;
  const fresh = items.filter(item => !state.copiedOnce.has(`${project.id}:${item.id}`));
  const first = fresh[0] || items[0];
  setStatus(`发现命中：${project.watchName || '项目包'} · ${first.itemName || first.name || '物品'} · ${first.priceText || priceText(first.price)}`, 'good');
  if (project.notifyDesktop && window.Notification && Notification.permission !== 'denied') {
    if (Notification.permission === 'default') await Notification.requestPermission();
    if (Notification.permission === 'granted') new Notification(`${shortServerLabel(project.serverKey)} 集市命中`, { body: `${project.watchName || ''} · ${first.itemName || first.name || ''} · ${first.priceText || priceText(first.price)}` });
  }
  if (project.autoCopy && first) {
    await api.copyText(itemInfoText(first, project));
    state.copiedOnce.add(`${project.id}:${first.id}`);
  }
  if (project.autoOpen && first && !state.openedOnce.has(`${project.id}:${first.id}`)) {
    state.openedOnce.add(`${project.id}:${first.id}`);
    await api.openMarketExternal(first.pageUrl || project.url);
  }
}

function renderResults() {
  const rows = Array.from(state.monitorResults.values()).flat();
  const box = $('resultList');
  $('errorBox').classList.add('hidden');
  if (!rows.length) {
    box.className = 'result-list empty';
    box.textContent = '暂无结果';
    setMetric('matchedCount', 0);
    return;
  }
  box.className = 'result-list';
  box.innerHTML = rows.map((row, idx) => `<article class="result-row">
    <div>
      <h3>${escapeHtml(row.itemName || row.name || '未命名物品')} <small>· ${escapeHtml(row.monitorName || '')}</small></h3>
      <div class="meta">
        <span class="pill price">${escapeHtml(row.priceText || priceText(row.price))}</span>
        <span class="pill">${escapeHtml(row.tradeMode || '商人页签 / 前往藏身处')}</span>
        <span class="pill">${escapeHtml(row.seller || '未知商家')}</span>
      </div>
    </div>
    <div class="row-actions">
      <button class="btn small" data-result-action="copy" data-index="${idx}" type="button">复制物品信息</button>
      <button class="btn small" data-result-action="open" data-index="${idx}" type="button">打开对应集市页</button>
    </div>
  </article>`).join('');
  box.querySelectorAll('button[data-result-action]').forEach(button => {
    button.addEventListener('click', () => {
      const item = rows[Number(button.dataset.index)];
      const project = state.projects.find(p => p.id === item.sourceProjectId) || {};
      if (button.dataset.resultAction === 'copy') api.copyText(itemInfoText(item, project)).catch(reportError);
      if (button.dataset.resultAction === 'open') api.openMarketExternal(item.pageUrl || project.url).catch(reportError);
    });
  });
  setMetric('matchedCount', rows.length);
}

function appendError(message) {
  const box = $('errorBox');
  box.classList.remove('hidden');
  box.textContent = [box.textContent, message].filter(Boolean).join('\n');
}

async function runSerialScheduler(projects, label = '项目包串行监控') {
  const token = ++state.schedulerToken;
  const entries = projects.map((project, index) => ({
    project,
    monitorId: `${project.id}-${index}`,
    index,
    nextDue: Date.now() + index * GLOBAL_REQUEST_GAP_MS,
    intervalMs: Math.max(Number(project.intervalSeconds || 90) * 1000, GLOBAL_REQUEST_GAP_MS)
  }));
  $('resultSummary').textContent = `${label}：${entries.length} 个项目包轮流刷新，每次请求至少间隔 ${Math.round(GLOBAL_REQUEST_GAP_MS / 1000)} 秒，避免四区服 API 限流。`;
  while (state.running && token === state.schedulerToken) {
    const now = Date.now();
    entries.sort((a, b) => a.nextDue - b.nextDue || a.index - b.index);
    const entry = entries[0];
    const cooldownWait = Math.max(0, state.cooldownUntil - now);
    const dueWait = Math.max(0, entry.nextDue - now);
    const wait = Math.max(cooldownWait, dueWait);
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      setStatus(cooldownWait > 0 ? `${label}：区服限流冷却中，${seconds} 秒后继续` : `${label}：等待 ${seconds} 秒后检查 ${entry.project.watchName || '项目包'}`);
      await delay(Math.min(wait, 1000));
      continue;
    }
    try {
      setStatus(`${label}：正在检查 ${entry.project.watchName || '项目包'}（串行 ${entries.indexOf(entry) + 1}/${entries.length}）`);
      await runCheckForProject(entry.project, { monitorId: entry.monitorId });
    } catch (error) {
      const is429 = error.status === 429 || /429|rate limit/i.test(String(error.message || ''));
      if (is429) {
        const pauseMs = Math.max((parseRetrySeconds(error) || Math.round(DEFAULT_RATE_LIMIT_PAUSE_MS / 1000)) * 1000, GLOBAL_REQUEST_GAP_MS);
        state.cooldownUntil = Date.now() + pauseMs;
        appendError(`集市 429 限流：已暂停所有项目包 ${Math.ceil(pauseMs / 1000)} 秒，队列不会并发重试。`);
      } else {
        appendError(`【${entry.project.watchName || '项目包'}】${error.message || error}`);
      }
    }
    entry.nextDue = Date.now() + entry.intervalMs;
    if (state.running && token === state.schedulerToken) await delay(GLOBAL_REQUEST_GAP_MS);
  }
}

async function addProjectsFromForm() {
  const projects = buildProjectsFromForm();
  state.projects.unshift(...projects);
  await saveProjects();
  setStatus(`已添加 ${projects.length} 个监控项目包。请在右侧勾选后启动。`, 'good');
}

async function testCurrentProject() {
  const project = buildProjectsFromForm()[0];
  setStatus('正在测试当前项目……');
  await runCheckForProject(project, { monitorId: 'manual-test', manual: true });
}

async function startSelectedProjects() {
  const projects = selectedProjects();
  if (!projects.length) {
    setStatus('请先勾选至少一个监控项目包。', 'warn');
    return;
  }
  state.running = true;
  state.schedulerToken += 1;
  state.monitorResults.clear();
  state.monitorStats.clear();
  renderResults();
  $('startSelectedButton').disabled = true;
  $('stopButton').disabled = false;
  setStatus(`项目包串行监控中（${projects.length}项）`);
  runSerialScheduler(projects, `项目包串行监控（${projects.length}项）`).catch(reportError);
}

function stopMonitoring() {
  state.running = false;
  state.schedulerToken += 1;
  clearTimers();
  $('startSelectedButton').disabled = false;
  $('stopButton').disabled = true;
  setStatus('监控已停止。');
}

function clearForm() {
  $('tradeUrlInput').value = '';
  $('bulkUrlsInput').value = '';
  if ($('serverSelect')) $('serverSelect').value = 'poe2-cn';
  updateServerHelp();
  $('projectNameInput').value = '';
  setSelectedCurrencies(['any']);
  $('minPriceInput').value = '';
  $('maxPriceInput').value = '';
  $('maxFetchInput').value = '10';
  $('intervalInput').value = '90';
  $('pricedOnlyInput').checked = true;
  $('exactOnlyInput').checked = false;
  $('onlineOnlyInput').checked = false;
  $('notifyInput').checked = true;
  $('autoCopyInput').checked = false;
  $('autoOpenInput').checked = false;
  setPriceRanges([]);
}

function bindEvents() {
  $('addProjectButton').addEventListener('click', () => addProjectsFromForm().catch(reportError));
  $('testButton').addEventListener('click', () => testCurrentProject().catch(reportError));
  $('startSelectedButton').addEventListener('click', () => startSelectedProjects().catch(reportError));
  $('stopButton').addEventListener('click', stopMonitoring);
  $('clearFormButton').addEventListener('click', clearForm);
  $('clearResultsButton').addEventListener('click', () => { state.monitorResults.clear(); renderResults(); $('resultSummary').textContent = '结果已清空。'; });
  $('selectAllButton').addEventListener('click', () => document.querySelectorAll('.project-check').forEach(el => { el.checked = true; }));
  $('clearProjectsButton').addEventListener('click', async () => {
    if (!confirm('确认清空所有监控项目包吗？')) return;
    state.projects = [];
    await saveProjects();
  });
  $('projectList').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const project = state.projects.find(item => item.id === id);
    if (button.dataset.action === 'load') writeConfig(project);
    if (button.dataset.action === 'delete') {
      state.projects = state.projects.filter(item => item.id !== id);
      await saveProjects();
    }
  });
  $('priceRangeRows').addEventListener('change', updatePriceRangeRowState);
  $('serverSelect')?.addEventListener('change', updateServerHelp);
}

function reportError(error) {
  console.error(error);
  const message = error?.message || String(error);
  setStatus(message, 'bad');
  appendError(message);
  if (api?.reportRuntimeDiagnostic) api.reportRuntimeDiagnostic({ level: 'error', scope: 'market-monitor', message, stack: error?.stack || '' });
}

async function boot() {
  if (!api) throw new Error('请通过桌面应用启动。');
  renderPriceRangeRows();
  updateServerHelp();
  const saved = await api.getMarketMonitorState();
  state.projects = Array.isArray(saved?.monitors) ? saved.monitors : [];
  renderProjectList();
  renderResults();
  bindEvents();
}

boot().catch(reportError);
