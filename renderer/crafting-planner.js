'use strict';

const api = window.desktopApi;
const $ = (id) => document.getElementById(id);
let context = null;
let exactAffixes = [];
let sandboxState = null;
let lastAvailability = [];
let stopProgressListener = null;
let lastRevealPreview = null;
let revealRerollIndex = 0;
let importedItemSnapshot = null;

const actionNames = {
  exalt: '崇高石', prefixOmen: '前缀定向预兆 + 崇高石', suffixOmen: '后缀定向预兆 + 崇高石',
  transmute: '蜕变石', augment: '增幅石', regal: '富豪石'
};
const rarityNames = { normal: '普通', magic: '魔法', rare: '稀有', unique: '传奇' };
const targetTypeNames = {
  equipment: '装备', item: '物品', normal_item: '普通物品', unidentified_item: '未鉴定物品',
  martial_weapon: '武术武器', armour: '护甲', ring: '戒指', amulet: '项链', jewel: '珠宝',
  wand: '魔杖', staff: '法杖', sceptre: '权杖', flask: '药剂', skill_gem: '技能宝石',
  mechanic_fragment: '机制碎片'
};
const qualityActionNames = { increase: '增加品质', replace_catalyst_quality: '替换催化品质' };
const basePropertyNames = { physical_damage_min: '物理伤害下限', physical_damage_max: '物理伤害上限', critical_strike_chance: '暴击率', attack_time: '攻击时间', range: '攻击距离', armour: '护甲', evasion: '闪避值', energyshield: '能量护盾', ward: '护卫值', block: '格挡率', increasedmovementspeed: '移动速度修正' };
const sourceNames = { normal: '普通', essence: '精华', desecrated: '亵渎', corrupted: '腐化', implicit: '固有', unknown: '未知', special: '特殊' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(value < 0.01 ? 3 : 2)}%` : '—';
const num = (value, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
const msg = (type, text) => `<div class="message ${type}">${esc(text)}</div>`;

function chronicleBlock(record) {
  const lines = Array.isArray(record?.chronicleDescriptionLines) ? record.chronicleDescriptionLines.filter(Boolean) : [];
  if (!lines.length) return '';
  return `<div class="chronicle-copy">${lines.map((line) => `<div>${esc(line)}</div>`).join('')}</div>`;
}
function localizationBadge(record) {
  return record?.localizationSource === 'poe2db.tw/cn'
    ? '<span class="current-badge">编年史中文</span>'
    : '<span class="current-badge fallback-badge">来源英文</span>';
}

function selectedValues(id) {
  const element = $(id);
  return element ? [...element.selectedOptions].map((option) => option.value) : [];
}
function restoreSelectedValues(id, values) {
  const wanted = new Set(Array.isArray(values) ? values.map(String) : []);
  const element = $(id);
  if (!element) return;
  [...element.options].forEach((option) => { option.selected = wanted.has(String(option.value)); });
}
function restoreSingleValue(id, value) {
  const element = $(id);
  if (!element) return;
  const target = String(value ?? '');
  if ([...element.options].some((option) => String(option.value) === target)) element.value = target;
}
function clearOutcomePreview(reason = '') {
  $('outcomeTable').innerHTML = '';
  $('outcomeMeta').textContent = reason;
  $('revealMessage').innerHTML = '';
}

function currentBase() {
  if (!context?.dataReady) return null;
  return context.data.bases.find((base) => base.id === $('baseSelect').value) || context.data.bases[0] || null;
}
function currentConcreteBase() {
  const base = currentBase();
  if (!base) return null;
  return (base.concreteBaseItems || []).find((item) => String(item.id) === String($('concreteBaseSelect')?.value || '')) || null;
}
function currentAffixLimits() {
  const base = currentBase();
  const concrete = currentConcreteBase();
  return {
    maxPrefixes: Number.isInteger(Number(concrete?.maxPrefixes)) ? Number(concrete.maxPrefixes) : Number(base?.maxPrefixes || 3),
    maxSuffixes: Number.isInteger(Number(concrete?.maxSuffixes)) ? Number(concrete.maxSuffixes) : Number(base?.maxSuffixes || 3)
  };
}
function modifierById(id) { return context?.data?.modifiers?.find((modifier) => modifier.id === id) || null; }
function allowed(modifier, base) {
  const ids = Array.isArray(modifier?.allowedBaseIds) ? modifier.allowedBaseIds : [];
  return Boolean(base && ids.length && ids.includes(base.id));
}
function familiesOf(value) {
  const list = Array.isArray(value?.families) && value.families.length ? value.families : [value?.family];
  return [...new Set(list.filter(Boolean))];
}
function familySummary(value) {
  const count = familiesOf(value).length;
  return count ? `冲突组 ${count} 个` : '无冲突组';
}

function availableTiers(modifier) {
  const itemLevel = Number($('itemLevelInput').value || 1);
  return (modifier?.tiers || []).filter((tier) => Number(tier.level) <= itemLevel).sort((a, b) => Number(a.tier) - Number(b.tier));
}
function setWorkspaceEnabled(enabled) {
  $('craftWorkspace').classList.toggle('disabled-panel', !enabled);
  $('stateMachineSection').classList.toggle('disabled-panel', !enabled);
  for (const id of ['analyzeButton', 'createStateButton', 'previewCurrencyButton', 'applyCurrencyButton', 'importClipboardButton', 'previewRevealButton']) $(id).disabled = !enabled;
}
function renderDataStatus() {
  if (context.dataReady) {
    const summary = context.repositorySummary || {};
    const adapter = summary.snapshotAdapterSummary || {};
    $('dataStatusTitle').textContent = '严格词缀快照已就绪';
    const groups = adapter.sourceBreakdown || {};
    const chronicle = adapter.chronicle || {};
    $('sourceBox').innerHTML = `已加载 <strong>${summary.baseCount || 0}</strong> 个精确底材池、<strong>${adapter.concreteBaseItemCount || 0}</strong> 个具体基底、<strong>${summary.modifierCount || 0}</strong> 组前后缀、<strong>${summary.tierCount || 0}</strong> 个正权重 T 级。词缀来源：普通 ${groups.normal || 0}、亵渎 ${groups.desecrated || 0}、精华 ${groups.essence || 0}、其他特殊 ${groups.special || 0}。<br><strong>流亡2编年史中文覆盖：</strong>${chronicle.matched || 0} / ${chronicle.targets || 0}${chronicle.unresolved ? `，未匹配 ${chronicle.unresolved}` : ''}。<span class="strict-note">概率与 T 级来自严格数据图，权重属于社区推导数据；具体基底、精华、符文、灵魂核心和预兆的名称/物品说明优先取自 poe2db.tw/cn。未匹配项保留来源英文，禁止机器翻译专有名称。</span>${adapter.dropped ? ` 排除：${Object.values(adapter.dropped).reduce((a, b) => a + Number(b || 0), 0)} 组无效记录。` : ''}`;
    $('updateDataButton').textContent = '更新严格数据与编年史中文';
    $('stateMachineDisabled').innerHTML = '';
  } else {
    $('dataStatusTitle').textContent = '严格词缀快照未就绪，模拟已暂停';
    $('sourceBox').textContent = context.dataError || '请先更新完整数据。系统不会使用演示词缀，也不会让武器继承防具或首饰词缀。';
    $('stateMachineDisabled').innerHTML = msg('warn', '严格数据未通过校验，概率计算与通货执行均已禁用。');
  }
  setWorkspaceEnabled(context.dataReady);
}
function renderPrices() {
  const currencies = new Map((context.data.currencies || []).map((currency) => [currency.id, currency.name]));
  const wanted = ['transmute', 'augment', 'regal', 'alchemy', 'exalt', 'annul', 'chaos', 'fracturing', 'prefixOmen', 'suffixOmen', 'essence'];
  $('priceInputs').innerHTML = wanted.filter((id) => Object.hasOwn(context.prices || {}, id)).map((id) => `<div><label>${esc(currencies.get(id) || ({ prefixOmen: '前缀定向组合', suffixOmen: '后缀定向组合', essence: '精华' }[id]) || id)}</label><input data-price="${esc(id)}" type="number" min="0" step="0.01" value="${Number(context.prices[id]) || 0}"></div>`).join('');
}
function readPrices() {
  const out = {};
  document.querySelectorAll('[data-price]').forEach((element) => { out[element.dataset.price] = Math.max(0, Number(element.value) || 0); });
  return out;
}
function renderBases() {
  $('baseSelect').innerHTML = (context.data.bases || []).map((base) => `<option value="${esc(base.id)}">${esc(base.name)} · ${base.concreteBaseItemCount || 0} 个具体基底</option>`).join('');
  renderConcreteBases();
}
function renderConcreteBases(preferredId = '') {
  const base = currentBase();
  const items = base?.concreteBaseItems || [];
  $('concreteBaseSelect').innerHTML = items.length
    ? items.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · 掉落等级 ${Number(item.dropLevel || 0)}</option>`).join('')
    : '<option value="">该精确池没有具体基底记录</option>';
  if (preferredId && items.some((item) => String(item.id) === String(preferredId))) $('concreteBaseSelect').value = String(preferredId);
  renderConcreteBaseDetails();
}
function renderConcreteBaseDetails() {
  const base = currentBase();
  const item = currentConcreteBase();
  if (!base) return void ($('concreteBaseDetails').textContent = '请先选择精确词缀池。');
  const properties = item?.properties && typeof item.properties === 'object'
    ? Object.entries(item.properties).map(([key, value]) => `${basePropertyNames[key] || '基础属性'}：${value}`).join('；')
    : '来源未提供基础属性';
  const implicits = item?.implicits?.length ? item.implicits.join('；') : '无固有词缀或来源未提供';
  const limits = currentAffixLimits();
  const specialLimit = item?.changesExplicitSlotLimits
    ? `<br><b>特殊槽位规则：</b>该具体基底最多 ${limits.maxPrefixes} 条前缀、${limits.maxSuffixes} 条后缀；这会改变多步做装的最终成功率。`
    : `<br>显式槽位：最多 ${limits.maxPrefixes} 条前缀、${limits.maxSuffixes} 条后缀。`;
  $('concreteBaseDetails').innerHTML = `<strong>${esc(item?.name || base.name)}</strong> ${localizationBadge(item)}${chronicleBlock(item)}<br>精确词缀池：${esc(base.name)}。<b>单次随机词缀的候选池和基础权重由精确词缀池决定</b>。同一池内的大多数普通具体基底共享候选池；但固有词缀、特殊前后缀槽位、附魔或来源专属限制会改变可执行步骤与整条做装路线的最终概率。${specialLimit}<br>基础属性：${esc(properties)}<br>固有词缀：${esc(implicits)}`;
}
function clampCounts() {
  const base = currentBase();
  if (!base) return;
  const limits = currentAffixLimits();
  $('prefixCountInput').max = String(limits.maxPrefixes);
  $('suffixCountInput').max = String(limits.maxSuffixes);
  const knownPrefix = exactAffixes.filter((affix) => affix.type === 'prefix').length;
  const knownSuffix = exactAffixes.filter((affix) => affix.type === 'suffix').length;
  $('prefixCountInput').value = String(Math.max(knownPrefix, Math.min(limits.maxPrefixes, Number($('prefixCountInput').value) || 0)));
  $('suffixCountInput').value = String(Math.max(knownSuffix, Math.min(limits.maxSuffixes, Number($('suffixCountInput').value) || 0)));
}
function pruneExactAffixes() {
  const base = currentBase();
  if (!base) { exactAffixes = []; return; }
  const itemLevel = Number($('itemLevelInput').value) || 1;
  const occupiedFamilies = new Set();
  exactAffixes = exactAffixes.filter((affix) => {
    const modifier = modifierById(affix.id);
    if (!modifier || !allowed(modifier, base)) return false;
    const families = familiesOf(modifier);
    if (families.some((family) => occupiedFamilies.has(family))) return false;
    const tier = (modifier.tiers || []).find((entry) => Number(entry.tier) === Number(affix.tier) && Number(entry.level) <= itemLevel);
    if (!tier) return false;
    families.forEach((family) => occupiedFamilies.add(family));
    Object.assign(affix, { type: modifier.type, source: affix.source || modifier.source || 'normal', family: modifier.family, families });
    return true;
  });
  clampCounts();
}
function renderExistingTierPicker() {
  const modifier = modifierById($('existingModifierPicker').value);
  $('existingTierPicker').innerHTML = modifier ? availableTiers(modifier).map((tier) => `<option value="${tier.tier}">T${tier.tier} · 需求等级 ${tier.level} · 权重 ${tier.weight}${tier.ranges?.length ? ` · ${esc(JSON.stringify(tier.ranges))}` : ''}</option>`).join('') : '<option value="">—</option>';
}
function renderExistingPicker() {
  const base = currentBase();
  if (!base) return;
  const current = $('existingModifierPicker').value;
  const usedFamilies = new Set(exactAffixes.flatMap(familiesOf));
  const choices = context.data.modifiers.filter((modifier) => allowed(modifier, base) && availableTiers(modifier).length && !exactAffixes.some((affix) => affix.id === modifier.id) && !familiesOf(modifier).some((family) => usedFamilies.has(family)));
  $('existingModifierPicker').innerHTML = choices.map((modifier) => `<option value="${esc(modifier.id)}">${modifier.type === 'prefix' ? '前缀' : '后缀'} · ${esc(modifier.name)}</option>`).join('') || '<option value="">没有可加入词缀</option>';
  if (choices.some((modifier) => modifier.id === current)) $('existingModifierPicker').value = current;
  renderExistingTierPicker();
}
function renderExactAffixes() {
  $('existingAffixList').innerHTML = exactAffixes.length ? exactAffixes.map((affix, index) => {
    const modifier = modifierById(affix.id);
    return `<div class="affix-row"><div><strong>${esc(modifier?.name || affix.id)}</strong><div class="meta">${affix.type === 'prefix' ? '前缀' : '后缀'} · T${affix.tier} · ${esc(sourceNames[affix.source] || affix.source)} · ${esc(familySummary(affix))}</div></div><button class="icon-btn" data-remove-affix="${index}" title="移除">×</button></div>`;
  }).join('') : '<div class="help empty-box">尚未添加已确认词缀。</div>';
  document.querySelectorAll('[data-remove-affix]').forEach((button) => button.addEventListener('click', () => {
    exactAffixes.splice(Number(button.dataset.removeAffix), 1);
    clampCounts(); renderExactAffixes(); renderExistingPicker(); invalidateSandbox();
  }));
  $('existingCount').textContent = `${exactAffixes.length} 项（前 ${exactAffixes.filter((a) => a.type === 'prefix').length} / 后 ${exactAffixes.filter((a) => a.type === 'suffix').length}）`;
}
function addExistingAffix() {
  const id = $('existingModifierPicker').value;
  const tier = Number($('existingTierPicker').value);
  const modifier = modifierById(id);
  const base = currentBase();
  if (!modifier || !tier || !base) return;
  const sideCount = exactAffixes.filter((affix) => affix.type === modifier.type).length;
  const limits = currentAffixLimits();
  const limit = modifier.type === 'prefix' ? limits.maxPrefixes : limits.maxSuffixes;
  if (sideCount >= limit) return void ($('formMessage').innerHTML = msg('warn', `${modifier.type === 'prefix' ? '前缀' : '后缀'}已达到上限。`));
  const existingFamilies = new Set(exactAffixes.flatMap(familiesOf));
  const conflict = familiesOf(modifier).find((family) => existingFamilies.has(family));
  if (conflict) return void ($('formMessage').innerHTML = msg('warn', '该词缀与当前物品上的已确认词缀属于同一冲突组，不能同时存在。'));
  exactAffixes.push({ id, tier, source: modifier.source || 'normal', type: modifier.type, family: modifier.family, families: familiesOf(modifier) });
  clampCounts(); renderExactAffixes(); renderExistingPicker(); invalidateSandbox();
}
function renderModifiers() {
  if (!context.dataReady) return;
  pruneExactAffixes();
  const base = currentBase();
  const query = $('modSearch').value.trim().toLowerCase();
  const previous = new Map([...document.querySelectorAll('[data-target-id]')].map((row) => [row.dataset.targetId, { checked: row.querySelector('input').checked, tier: row.querySelector('select').value }]));
  const modifiers = context.data.modifiers.filter((modifier) => allowed(modifier, base) && (!query || `${modifier.name} ${modifier.englishName || ''} ${(modifier.sourceMeta?.tags || []).join(' ')}`.toLowerCase().includes(query)));
  $('targetList').innerHTML = modifiers.map((modifier) => {
    const tiers = availableTiers(modifier);
    const prior = previous.get(modifier.id);
    return `<label class="check-card" data-target-id="${esc(modifier.id)}"><input type="checkbox" ${prior?.checked ? 'checked' : ''}><div><strong>${esc(modifier.name)}</strong><div class="meta">${modifier.type === 'prefix' ? '前缀' : '后缀'} · 精确池 ${esc(base.name)} · ${esc(familySummary(modifier))}</div></div><select>${tiers.map((tier) => `<option value="${tier.tier}">T${tier.tier}+</option>`).join('') || '<option value="99">当前物等不可用</option>'}</select></label>`;
  }).join('') || '<div class="help">当前精确底材池在该物等下没有匹配词缀。</div>';
  document.querySelectorAll('[data-target-id]').forEach((row) => {
    const prior = previous.get(row.dataset.targetId);
    if (prior && [...row.querySelector('select').options].some((option) => option.value === prior.tier)) row.querySelector('select').value = prior.tier;
    row.querySelector('input').addEventListener('change', updateTargetCount);
  });
  renderExistingPicker(); renderExactAffixes(); updateTargetCount(); invalidateSandbox();
}
function updateTargetCount() { $('targetCount').textContent = `${document.querySelectorAll('[data-target-id] input:checked').length} 项`; }
function buildInput() {
  clampCounts();
  return {
    baseId: $('baseSelect').value, itemLevel: Number($('itemLevelInput').value) || 1, rarity: $('raritySelect').value,
    prefixCount: Number($('prefixCountInput').value) || 0, suffixCount: Number($('suffixCountInput').value) || 0,
    existingModifiers: exactAffixes.map((affix) => ({ id: affix.id, tier: affix.tier, source: affix.source })),
    concreteBaseItemId: currentConcreteBase()?.id || null,
    concreteBaseName: currentConcreteBase()?.name || null,
    maxPrefixes: currentAffixLimits().maxPrefixes,
    maxSuffixes: currentAffixLimits().maxSuffixes,
    targets: [...document.querySelectorAll('[data-target-id]')].filter((row) => row.querySelector('input').checked).map((row) => ({ id: row.dataset.targetId, minimumTier: Number(row.querySelector('select').value) || 99 }))
  };
}
function stateInputFromForm() {
  const knownPrefix = exactAffixes.filter((affix) => affix.type === 'prefix').length;
  const knownSuffix = exactAffixes.filter((affix) => affix.type === 'suffix').length;
  return {
    baseId: $('baseSelect').value,
    itemLevel: Number($('itemLevelInput').value) || 1,
    rarity: $('raritySelect').value,
    quality: Number(importedItemSnapshot?.quality || 0),
    sockets: Number(importedItemSnapshot?.sockets || 0),
    flags: importedItemSnapshot?.flags || {},
    affixes: exactAffixes.map((affix) => ({
      modifierId: affix.id,
      tier: affix.tier,
      source: affix.source,
      poolSource: affix.poolSource || affix.source,
      type: affix.type,
      fractured: Boolean(affix.fractured),
      locked: Boolean(affix.fractured),
      metadata: {
        imported: Boolean(affix.imported),
        importSource: affix.importSource || null,
        importMethod: affix.method || null,
        importConfidence: affix.confidence ?? null
      }
    })),
    unknownPrefixCount: Math.max(0, (Number($('prefixCountInput').value) || 0) - knownPrefix),
    unknownSuffixCount: Math.max(0, (Number($('suffixCountInput').value) || 0) - knownSuffix),
    activeOmens: [...$('omenSelect').selectedOptions].map((option) => option.value),
    augmentSocketCapacity: Math.max(0, Number($('augmentSocketCapacityInput')?.value) || 0),
    installedAugments: [],
    metadata: {
      concreteBaseItemId: currentConcreteBase()?.id || null,
      concreteBaseName: currentConcreteBase()?.name || null,
      maxPrefixes: currentAffixLimits().maxPrefixes,
      maxSuffixes: currentAffixLimits().maxSuffixes,
      concreteBaseChangesSlotLimits: Boolean(currentConcreteBase()?.changesExplicitSlotLimits),
      importedFromClipboard: Boolean(importedItemSnapshot),
      importedUnresolvedAffixes: Number(importedItemSnapshot?.unresolved || 0)
    }
  };
}
function renderNextRolls(rows) {
  $('nextRollTable').innerHTML = `<table><thead><tr><th>操作</th><th>可用层级</th><th>命中概率</th><th>平均次数</th><th>期望成本</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${esc(actionNames[row.action] || row.action)}${row.actionApplicable === false ? '<div class="meta">当前状态不可用</div>' : ''}</td><td>${row.eventCount} / 权重 ${Math.round(row.totalWeight)}</td><td>${pct(row.probability)}</td><td>${row.expectedAttempts ? num(row.expectedAttempts, 1) : '不可达'}</td><td>${row.expectedCurrencyCost != null ? `${num(row.expectedCurrencyCost)} e` : '—'}</td></tr>`).join('')}</tbody></table>`;
}
function renderStrategies(rows) {
  $('strategyTable').innerHTML = `<table><thead><tr><th>路线</th><th>步骤</th><th>成功率</th><th>平均成本</th><th>每成功期望成本</th></tr></thead><tbody>${rows.map((row, index) => `<tr><td>${index === 0 ? '★ ' : ''}${esc(row.name)}</td><td>${row.actions.map((action) => esc(actionNames[action] || action)).join(' → ') || '无可用步骤'}</td><td>${pct(row.successRate)}</td><td>${num(row.averageCost)} e</td><td>${row.expectedCostPerSuccess != null ? `${num(row.expectedCostPerSuccess)} e` : '模拟未命中'}</td></tr>`).join('')}</tbody></table>`;
}
async function analyze() {
  if (!context.dataReady) return;
  $('formMessage').innerHTML = msg('info', '正在使用当前精确底材池计算……');
  try {
    const result = await api.analyzeCraft({ input: buildInput(), options: { prices: readPrices(), trials: Number($('trialsInput').value) || 20000 } });
    renderNextRolls(result.nextRolls || []); renderStrategies(result.strategies || []);
    $('bestBadge').textContent = result.bestStrategy ? `最优：${result.bestStrategy.name}` : '没有可达路线';
    $('analysisWarnings').innerHTML = (result.warnings || []).map((warning) => msg('warn', warning)).join('');
    $('formMessage').innerHTML = msg('good', '分析完成。');
  } catch (error) { $('formMessage').innerHTML = msg('error', error.message); }
}
function normalizedText(value) { return String(value || '').toLowerCase().replace(/[-+]?\d+(?:\.\d+)?/g, '#').replace(/[^a-z0-9#\u4e00-\u9fff]+/g, ' ').trim(); }
function inferAttributePoolName(item) {
  const text = normalizedText(`${item.itemClass || ''} ${item.baseType || ''}`);
  const classRules = [
    [/十字弩|crossbow/, 'Crossbow'], [/弓|bow/, 'Bow'], [/箭袋|quiver/, 'Quiver'],
    [/混沌法杖|chaos wand/, 'Chaos Wand'], [/火焰法杖|fire wand/, 'Fire Wand'], [/冰霜法杖|cold wand/, 'Cold Wand'], [/闪电法杖|lightning wand/, 'Lightning Wand'],
    [/法杖|wand/, 'Wand'], [/权杖|權杖|sceptre/, 'Sceptre'], [/长杖|長杖|staff/, 'Staff'], [/季度杖|quarterstaff/, 'Quarterstaff'],
    [/匕首|dagger/, 'Dagger'], [/爪|claw/, 'Claw'], [/连枷|連枷|flail/, 'Flail'], [/长矛|長矛|spear/, 'Spear'],
    [/双手斧|雙手斧|two hand axe/, 'Two Hand Axe'], [/单手斧|單手斧|one hand axe/, 'One Hand Axe'], [/斧|axe/, 'Axe'],
    [/双手锤|雙手錘|two hand mace/, 'Two Hand Mace'], [/单手锤|單手錘|one hand mace/, 'One Hand Mace'], [/锤|錘|mace/, 'Mace'],
    [/双手剑|雙手劍|two hand sword/, 'Two Hand Sword'], [/单手剑|單手劍|one hand sword/, 'One Hand Sword'], [/剑|劍|sword/, 'Sword'],
    [/戒指|ring/, 'Ring'], [/项链|項鍊|amulet/, 'Amulet'], [/腰带|腰帶|belt/, 'Belt'], [/护符|護符|charm/, 'Charm'],
    [/箭袋|quiver/, 'Quiver'], [/盾|shield/, 'Shield'], [/法器|focus|foci/, 'Focus']
  ];
  for (const [pattern, pool] of classRules) if (pattern.test(text)) return pool;

  let armourClass = null;
  if (/胸甲|护甲|護甲|body armour/.test(text)) armourClass = 'Body Armour';
  else if (/头盔|頭盔|helmet/.test(text)) armourClass = 'Helmet';
  else if (/手套|gloves/.test(text)) armourClass = 'Gloves';
  else if (/鞋|长靴|長靴|boots/.test(text)) armourClass = 'Boots';
  if (!armourClass) return null;
  const defenses = item.defenses || {};
  const attributes = [];
  if (Number(defenses.armour) > 0) attributes.push('STR');
  if (Number(defenses.evasion) > 0) attributes.push('DEX');
  if (Number(defenses.energyShield) > 0) attributes.push('INT');
  return attributes.length ? `${armourClass} (${attributes.join('/')})` : armourClass;
}
function findImportedBase(item) {
  const candidates = [item.baseType, item.itemClass, item.category, item.typeLine].map(normalizedText).filter(Boolean);
  for (const base of context.data.bases) {
    const aliases = Array.isArray(base.aliases) && base.aliases.length ? base.aliases : [base.name];
    if (aliases.some((alias) => candidates.includes(normalizedText(alias)))) return base;
  }
  const inferredPool = inferAttributePoolName(item);
  if (inferredPool) {
    const exact = context.data.bases.find((base) => [base.name, base.englishName].some((name) => normalizedText(name) === normalizedText(inferredPool)));
    if (exact) return exact;
    const compatible = context.data.bases.filter((base) => [base.name, base.englishName].filter(Boolean).some((name) => normalizedText(name).includes(normalizedText(inferredPool)) || normalizedText(inferredPool).includes(normalizedText(name))));
    if (compatible.length === 1) return compatible[0];
  }
  let best = null; let score = 0;
  for (const base of context.data.bases) {
    const aliases = Array.isArray(base.aliases) && base.aliases.length ? base.aliases : [base.name];
    for (const alias of aliases) {
      const baseText = normalizedText(alias);
      for (const candidate of candidates) {
        let value = 0;
        if (candidate.includes(baseText) || baseText.includes(candidate)) value = Math.min(candidate.length, baseText.length);
        const singular = baseText.replace(/s$/, '');
        if (singular && candidate.includes(singular)) value = Math.max(value, singular.length);
        if (value > score) { score = value; best = base; }
      }
    }
  }
  return score >= 3 ? best : null;
}
function matchImportedModifier(raw, base) {
  if (!raw?.affixType || !base) return null;
  const key = normalizedText(raw.template || raw.text);
  const candidates = context.data.modifiers.filter((modifier) =>
    modifier.type === raw.affixType && allowed(modifier, base) && [modifier.name, modifier.englishName].filter(Boolean).some((name) => normalizedText(name) === key)
  );
  if (candidates.length !== 1) return null;
  const modifier = candidates[0];
  const tiers = availableTiers(modifier);
  const tier = raw.tier && tiers.some((entry) => Number(entry.tier) === Number(raw.tier))
    ? Number(raw.tier)
    : tiers.length === 1
      ? Number(tiers[0].tier)
      : null;
  if (!tier) return null;
  return { id: modifier.id, tier, source: raw.source || modifier.source || 'normal', type: modifier.type, family: modifier.family, families: familiesOf(modifier), fractured: Boolean(raw.fractured) };
}
async function importClipboard() {
  try {
    const parsed = await api.readCraftingItemClipboard();
    const item = parsed.item || parsed;
    const resolution = parsed.resolution || null;
    $('itemLevelInput').value = item.itemLevel || 82;
    $('raritySelect').value = ['normal', 'magic', 'rare'].includes(item.rarity) ? item.rarity : 'rare';

    const matched = resolution?.base?.id
      ? context.data.bases.find((base) => base.id === resolution.base.id)
      : findImportedBase(item);
    if (matched) {
      $('baseSelect').value = matched.id;
      const concreteId = resolution?.concreteBase?.id || '';
      const concrete = concreteId
        ? (matched.concreteBaseItems || []).find((entry) => String(entry.id) === String(concreteId))
        : (matched.concreteBaseItems || []).find((entry) => [entry.name, entry.englishName].some((name) => normalizedText(name) === normalizedText(item.baseType || item.typeLine)));
      renderConcreteBases(concrete?.id || '');
    }

    const mods = item.mods || [];
    const prefix = resolution?.counts?.prefix ?? mods.filter((modifier) => modifier.affixType === 'prefix' || /前缀|prefix/i.test(modifier.metadata || '')).length;
    const suffix = resolution?.counts?.suffix ?? mods.filter((modifier) => modifier.affixType === 'suffix' || /后缀|suffix/i.test(modifier.metadata || '')).length;
    $('prefixCountInput').value = prefix;
    $('suffixCountInput').value = suffix;

    exactAffixes = matched && resolution
      ? (resolution.matches || []).map((entry) => ({
        id: entry.modifierId || entry.id,
        tier: Number(entry.tier),
        source: entry.source || 'normal',
        poolSource: entry.poolSource || entry.source || 'normal',
        importSource: entry.importSource || null,
        type: entry.type,
        family: entry.family,
        families: entry.families || [],
        fractured: Boolean(entry.fractured),
        imported: true,
        method: entry.method || 'resolved',
        confidence: entry.confidence ?? null
      })).filter((entry) => entry.id && entry.tier)
      : matched
        ? mods.map((modifier) => matchImportedModifier(modifier, matched)).filter(Boolean)
        : [];

    importedItemSnapshot = {
      quality: resolution?.state?.quality ?? item.quality ?? 0,
      sockets: resolution?.state?.sockets ?? 0,
      flags: resolution?.state?.flags || item.flags || {},
      unresolved: resolution?.counts?.unresolved ?? Math.max(0, prefix + suffix - exactAffixes.length)
    };

    renderModifiers();
    const unresolved = resolution?.counts?.unresolved ?? Math.max(0, prefix + suffix - exactAffixes.length);
    const methodSummary = resolution?.matches?.length
      ? [...new Set(resolution.matches.map((entry) => ({
        'exact-template': '模板',
        'affix-name': '词缀名',
        'semantic-and-range': '中文语义+数值区间',
        'range-assisted': '数值区间辅助',
        semantic: '中文语义'
      }[entry.method] || '联合特征')))].join('、')
      : '';
    const statusBits = [
      importedItemSnapshot.flags?.corrupted ? '已识别被腐化' : '',
      importedItemSnapshot.flags?.desecrated ? '已识别亵渎来源标记' : '',
      importedItemSnapshot.sockets ? `插槽 ${importedItemSnapshot.sockets}` : ''
    ].filter(Boolean).join('；');
    const unresolvedNames = (resolution?.unresolved || [])
      .slice(0, 4)
      .map((entry) => entry.raw?.affixName || entry.raw?.lines?.join(' / ') || entry.raw?.text || '未知词缀')
      .join('、');

    const text = matched
      ? `已匹配具体底材到精确池：${matched.name}；识别 ${exactAffixes.length}/${prefix + suffix} 条显式词缀${methodSummary ? `（${methodSummary}）` : ''}。${unresolved ? `未确认 ${unresolved} 条，保留为未知占位${unresolvedNames ? `：${unresolvedNames}` : ''}。` : '全部词缀均已确认。'}${statusBits ? ` ${statusBits}。` : ''}`
      : '已导入物等、稀有度和前后缀占位，但无法可靠匹配具体底材，请手动选择精确池。';
    $('formMessage').innerHTML = msg(matched ? (unresolved ? 'warn' : 'good') : 'warn', text);
  } catch (error) { $('formMessage').innerHTML = msg('error', error.message); }
}

function operationKind() { return $('operationKindSelect')?.value || 'currency'; }
function selectedOperation() {
  const kind = operationKind();
  const actionId = $('currencySelect')?.value || '';
  let record = null;
  if (kind === 'currency' || kind === 'desecrate') record = (context.data.currencies || []).find((entry) => entry.id === actionId) || null;
  else if (kind === 'essence') record = (context.data.essences || []).find((entry) => entry.id === actionId) || null;
  else if (kind === 'socketable') record = (context.data.socketables || []).find((entry) => entry.id === actionId) || null;
  return { kind, actionId, record };
}
function updateAugmentSlotOptions() {
  const capacity = Math.max(0, Math.min(12, Number($('augmentSocketCapacityInput')?.value) || 0));
  const previous = $('augmentSlotSelect')?.value || '0';
  $('augmentSlotSelect').innerHTML = capacity
    ? Array.from({ length: capacity }, (_value, index) => `<option value="${index}">插槽 ${index + 1}</option>`).join('')
    : '<option value="0">没有可用插槽</option>';
  restoreSingleValue('augmentSlotSelect', previous);
}
function operationRecords(kind) {
  const showLegacy = Boolean($('showLegacyBones')?.checked);
  const base = currentBase();
  if (kind === 'currency') return (context.data.currencies || []).filter((entry) => entry.category !== 'desecrate' && !entry.dropDisabled && !entry.referenceOnly);
  if (kind === 'desecrate') return (context.data.currencies || []).filter((entry) => entry.category === 'desecrate' && (showLegacy || !entry.lowTier && !entry.dropDisabled && !entry.referenceOnly));
  if (kind === 'essence') return (context.data.essences || []).filter((entry) => essenceCompatibleEffects(entry, base).length);
  if (kind === 'socketable') return (context.data.socketables || []).filter((entry) => socketableCompatible(entry, base).length);
  return [];
}
function operationLabel(kind, record) {
  if (!record) return '不可用';
  if (kind === 'socketable') return `${record.name} · ${socketableTypeName(record.type)}`;
  return `${record.name}${record.description ? ` · ${record.description}` : ''}`;
}
function renderOperationDetails() {
  const { kind, record } = selectedOperation();
  const augmentMode = kind === 'socketable' && record && !['alloy', 'flux'].includes(String(record.type || '').toLowerCase());
  $('augmentControls').hidden = !augmentMode;
  updateAugmentSlotOptions();
  if (!record) return void ($('operationDetails').textContent = '当前底材没有该类型的可用操作。');
  if (kind === 'currency' || kind === 'desecrate') {
    $('operationDetails').innerHTML = `<strong>${esc(record.name)}</strong><br>${esc(record.description || '')}`;
  } else if (kind === 'essence') {
    const effect = essenceCompatibleEffects(record, currentBase())[0];
    $('operationDetails').innerHTML = `<strong>${esc(record.name)}</strong> ${localizationBadge(record)}<br>${esc(record.mode || '')}<br>保证：${esc(effect?.modifierName || '当前严格数据未映射')}`;
  } else {
    const effect = socketableCompatible(record, currentBase())[0];
    const mode = String(record.type || '').toLowerCase() === 'alloy' ? '随机移除 1 条显式词缀并加入保证词缀' : String(record.type || '').toLowerCase() === 'flux' ? '资料项：目标不是装备状态机' : '放入或替换指定增幅器插槽，不占前后缀';
    const chronicle = chronicleBlock(record);
    $('operationDetails').innerHTML = `<strong>${esc(record.name)}</strong> ${localizationBadge(record)}<br>类型：${esc(socketableTypeName(record.type))}<br>${esc(mode)}${chronicle || (effect?.modifierName ? `<br>效果：${esc(effect.modifierName)}` : '')}`;
  }
  renderAvailability();
}
function renderOperationOptions() {
  const prior = $('currencySelect')?.value || '';
  const kind = operationKind();
  const records = operationRecords(kind);
  $('currencySelect').innerHTML = records.length
    ? records.map((record) => `<option value="${esc(record.id)}">${esc(operationLabel(kind, record))}</option>`).join('')
    : '<option value="">当前底材没有可用项目</option>';
  restoreSingleValue('currencySelect', prior || records[0]?.id || '');
  renderOperationDetails();
}
function renderOmensAndCurrencies() {
  const priorOmens = selectedValues('omenSelect');
  $('omenSelect').innerHTML = (context.data.omens || []).map((omen) => `<option value="${esc(omen.id)}">${esc(omen.name)} · ${esc(omen.description || '')}</option>`).join('') || '<option disabled>暂无预兆</option>';
  restoreSelectedValues('omenSelect', priorOmens);
  renderOperationOptions();
}
function renderMechanicsOverview() {
  const records = (context.data.mechanics || []).filter((record) => record.category !== 'season');
  $('mechanicsOverview').innerHTML = records.map((record) => `<article class="mechanic-card"><h3>${esc(record.name)}</h3><div class="help">${esc(record.description || '')}</div>${record.details?.length ? `<ul>${record.details.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>` : ''}</article>`).join('') || '<div class="help">当前快照没有机制说明。</div>';
}
function essenceCompatibleEffects(essence, base) { return (essence?.effects || []).filter((effect) => effect.baseId === base?.id); }
function renderEssences() {
  const base = currentBase();
  const rows = (context.data.essences || []).map((essence) => ({ essence, effects: essenceCompatibleEffects(essence, base) })).filter((row) => row.effects.length);
  $('essenceSelect').innerHTML = rows.map((row) => `<option value="${esc(row.essence.id)}">${esc(row.essence.name)}</option>`).join('') || '<option value="">当前底材没有精华保证词缀</option>';
  renderEssenceDetails();
}
function renderEssenceDetails() {
  const base = currentBase();
  const essence = (context.data.essences || []).find((entry) => entry.id === $('essenceSelect').value);
  const effects = essenceCompatibleEffects(essence, base);
  $('essenceDetails').innerHTML = essence ? `<strong>${esc(essence.name)}</strong> ${localizationBadge(essence)}${chronicleBlock(essence)}<br>${esc(essence.mode)}<br>${effects.map((effect) => `${esc(effect.modifierName)} · 词缀等级 ${effect.modifierLevel}`).join('<br>') || '当前底材没有效果'}<br><span class="help">名称与物品说明取自流亡2编年史；保证词缀、底材匹配和等级仍按严格数据图计算。</span>` : '当前底材没有可用精华记录。';
}
const SOCKETABLE_TYPE_NAMES = {
  rune: '符文',
  soulcore: '灵魂核心',
  alloy: '合金',
  flux: '通量',
  idol: '神像',
  abyssal_eye: '深渊之眼',
  augment: '插槽强化物',
  socketable: '插槽强化物'
};

function socketableTypeName(type) {
  return SOCKETABLE_TYPE_NAMES[String(type || '').toLowerCase()] || '插槽强化物';
}

function socketableCompatible(entry, base) { return (entry?.effects || []).filter((effect) => effect.compatibleBaseIds.includes(base?.id)); }
function renderSocketables() {
  const base = currentBase();
  const rows = (context.data.socketables || []).map((entry) => ({ entry, effects: socketableCompatible(entry, base) })).filter((row) => row.effects.length);
  $('socketableSelect').innerHTML = rows.map((row) => `<option value="${esc(row.entry.id)}">${esc(row.entry.name)}</option>`).join('') || '<option value="">当前底材没有兼容插槽强化物</option>';
  renderSocketableDetails();
}
function renderSocketableDetails() {
  const base = currentBase();
  const entry = (context.data.socketables || []).find((value) => value.id === $('socketableSelect').value);
  const effects = socketableCompatible(entry, base);
  $('socketableDetails').innerHTML = entry ? `<strong>${esc(entry.name)}</strong> ${localizationBadge(entry)}<br>类型：${esc(socketableTypeName(entry.type))}${chronicleBlock(entry)}${entry.chronicleDescriptionLines?.length ? '' : `<br>${effects.map((effect) => esc(effect.modifierName)).join('<br>')}`}<br><span class="help">名称与物品说明优先取自流亡2编年史；兼容底材由严格数据中的来源底材 ID 决定，不占前后缀。</span>` : '当前底材没有兼容的插槽强化物。';
}
function renderSeasonMechanics() { renderMechanicsOverview(); renderEssences(); renderSocketables(); }
function invalidateSandbox() {
  sandboxState = null; lastAvailability = []; lastRevealPreview = null; revealRerollIndex = 0;
  $('stateBadge').textContent = '表单已变化，需重建'; $('stateView').innerHTML = '<div class="help">点击“从当前表单创建状态”。</div>';
  $('stateCounts').textContent = ''; clearOutcomePreview(''); $('currencyMessage').innerHTML = ''; $('revealInstanceSelect').innerHTML = '<option value="">当前没有未揭示词缀</option>'; $('revealOptionSelect').innerHTML = '<option value="">先预览选项</option>'; $('rerollRevealButton').disabled = true; $('applyRevealButton').disabled = true;
}
function renderState(state) {
  sandboxState = state;
  const counts = state.counts || {};
  $('stateBadge').textContent = `${rarityNames[state.rarity] || state.rarity} · ${state.metadata?.concreteBaseName || state.baseName}`;
  $('stateCounts').textContent = `前 ${counts.prefix || 0} / 后 ${counts.suffix || 0} / 总显式 ${counts.explicit || 0}`;
  const omenNames = (state.activeOmens || []).map((id) => (context.data.omens || []).find((omen) => omen.id === id)?.name || id);
  const affixHtml = (state.affixes || []).length ? state.affixes.map((affix) => `<div class="affix-row ${affix.type}"><div><strong>${esc(affix.name)}</strong><div class="meta">${affix.type === 'prefix' ? '前缀' : '后缀'}${affix.unrevealed ? ' · 未揭示亵渎占位' : affix.unknown ? ' · 未解析占位' : ` · T${affix.tier} · 等级 ${affix.modifierLevel} · ${esc(familySummary(affix))}`}</div></div><span class="badge">${affix.fractured ? '破裂' : esc(sourceNames[affix.source] || affix.source)}</span></div>`).join('') : '<div class="help empty-box">没有显式词缀。</div>';
  const installed = state.installedAugments || [];
  const augmentHtml = `<div class="section-title" style="margin-top:14px"><strong>增幅器插槽 ${installed.length}/${Number(state.augmentSocketCapacity || 0)}</strong></div>${Number(state.augmentSocketCapacity || 0) ? Array.from({ length: Number(state.augmentSocketCapacity || 0) }, (_value, index) => { const entry = installed.find((item) => Number(item.slotIndex) === index); return `<div class="affix-row"><div><strong>插槽 ${index + 1}${entry ? ` · ${esc(entry.name)}` : ''}</strong><div class="meta">${entry ? esc(entry.effectText || socketableTypeName(entry.type)) : '空插槽'}</div></div><span class="badge">${entry ? esc(socketableTypeName(entry.type)) : '空'}</span></div>`; }).join('') : '<div class="help">未填写增幅器插槽容量。</div>'}`;
  $('stateView').innerHTML = `<div class="state-summary"><span>物等 ${state.itemLevel}</span><span>${state.flags?.corrupted ? '已腐化' : '未腐化'}</span><span>${state.flags?.desecrated ? '已亵渎' : '未亵渎'}</span><span>${state.flags?.mirrored ? '已镜像' : '未镜像'}</span><span>预兆 ${(state.activeOmens || []).length}${omenNames.length ? ` · ${esc(omenNames.join('、'))}` : ''}</span></div>${affixHtml}${augmentHtml}`;
  restoreSelectedValues('omenSelect', state.activeOmens || []);
  $('augmentSocketCapacityInput').value = String(Number(state.augmentSocketCapacity || 0));
  updateAugmentSlotOptions();
  const unrevealed = (state.affixes || []).filter((affix) => affix.unrevealed && affix.source === 'desecrated');
  $('revealInstanceSelect').innerHTML = unrevealed.length ? unrevealed.map((affix, index) => `<option value="${esc(affix.instanceId)}">${index + 1}. ${affix.type === 'prefix' ? '未揭示前缀' : '未揭示后缀'}</option>`).join('') : '<option value="">当前没有未揭示词缀</option>';
  lastRevealPreview = null; revealRerollIndex = 0; $('revealOptionSelect').innerHTML = '<option value="">先预览选项</option>'; $('rerollRevealButton').disabled = true; $('applyRevealButton').disabled = true;
}
function renderAvailability() {
  const { kind, actionId, record } = selectedOperation();
  if (!record) return void ($('currencyMessage').innerHTML = '');
  if (kind === 'currency' || kind === 'desecrate') {
    const entry = lastAvailability.find((value) => value.id === actionId);
    if (!entry || !sandboxState) return void ($('currencyMessage').innerHTML = msg('info', `${record.name} 已选择；创建物品状态后检查可用性。`));
    $('currencyMessage').innerHTML = entry.ok ? msg('good', `${entry.name} 可用于当前状态。`) : msg('warn', entry.reason || '当前不可用。');
    return;
  }
  const text = kind === 'essence' ? `${record.name} 已接入状态机；预览时会检查稀有度、保证词缀和词缀组冲突。` : `${record.name} 已接入状态机；预览时会检查底材兼容、插槽或合金替换规则。`;
  $('currencyMessage').innerHTML = msg('info', text);
}

async function handleOmenSelectionChange() {
  if (!sandboxState) {
    $('currencyMessage').innerHTML = msg('info', '预兆已更新。创建状态后即可连续做装。');
    return;
  }
  try {
    const result = await api.createCraftingState({ ...statePayload(), activeOmens: selectedValues('omenSelect') });
    lastAvailability = result.availability || [];
    renderState(result.state);
    clearOutcomePreview('已切换预兆，请重新预览或执行通货。');
    renderAvailability();
    $('currencyMessage').innerHTML = msg('info', '已更新激活预兆，当前物品状态已保留。');
  } catch (error) {
    $('currencyMessage').innerHTML = msg('error', error.message);
  }
}
async function createSandboxState() {
  try {
    const result = await api.createCraftingState(stateInputFromForm());
    lastAvailability = result.availability || []; renderState(result.state); renderAvailability();
    $('outcomeTable').innerHTML = ''; $('outcomeMeta').textContent = '状态创建成功';
  } catch (error) { $('currencyMessage').innerHTML = msg('error', error.message); }
}
function statePayload() {
  if (!sandboxState) throw new Error('请先创建物品状态。');
  const state = { ...sandboxState, augmentSocketCapacity: Math.max(0, Number($('augmentSocketCapacityInput')?.value) || 0) };
  delete state.counts;
  return state;
}
function specialActionPayload() {
  const operation = selectedOperation();
  return {
    state: statePayload(),
    kind: operation.kind === 'essence' ? 'essence' : 'socketable',
    actionId: operation.actionId,
    slotIndex: Math.max(0, Number($('augmentSlotSelect')?.value) || 0),
    seed: Number($('seedInput').value) || 20260618,
    limit: 50
  };
}
function outcomeAffixes(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
function renderOperationOutcomes(result) {
  const exactText = result.exact === false ? '含概率限制说明' : '规则可精确枚举';
  $('outcomeMeta').textContent = result.kind ? `${result.summary || ''} · ${exactText}` : (result.exact ? `总权重 ${Math.round(result.totalWeight || 0)}` : `采样 ${result.sampleCount || 0} 次`);
  $('outcomeTable').innerHTML = result.outcomes?.length
    ? `<table><thead><tr><th>结果</th><th>新增/镶嵌</th><th>移除/替换</th><th>概率</th></tr></thead><tbody>${result.outcomes.map((outcome) => {
      const added = outcomeAffixes(outcome.added).map((affix) => esc(`${affix.name || '未知'}${affix.tier ? ` T${affix.tier}` : ''}`)).join('、') || (result.kind === 'socketable' ? esc(result.summary || '确定性镶嵌') : '—');
      const changed = [...outcomeAffixes(outcome.removed).map((affix) => `移除 ${affix.name || '未知'}`), ...outcomeAffixes(outcome.fractured).map((affix) => `破裂 ${affix.name || '未知'}`)].map(esc).join('、') || '—';
      return `<tr><td>${esc(outcome.summary || result.summary || outcome.event?.name || '结果')}</td><td>${added}</td><td>${changed}</td><td>${pct(outcome.probability)}</td></tr>`;
    }).join('')}</tbody></table>`
    : '<div class="help">没有可显示结果。</div>';
}
async function previewCurrency() {
  try {
    const { kind, actionId } = selectedOperation();
    const result = (kind === 'currency' || kind === 'desecrate')
      ? await api.previewCraftingCurrency({ state: statePayload(), currencyId: actionId, limit: 50, samples: 5000, seed: Number($('seedInput').value) || 20260618 })
      : await api.previewCraftingSpecialAction(specialActionPayload());
    if (!result.ok) { $('currencyMessage').innerHTML = msg('warn', result.reason); $('outcomeTable').innerHTML = ''; return; }
    const caveats = [result.probabilityCaveat, ...(result.outcomes || []).map((outcome) => outcome.probabilityCaveat)].filter(Boolean);
    $('currencyMessage').innerHTML = msg('info', `${result.summary || (result.exact ? `精确枚举 ${result.outcomeCount || result.outcomes.length} 个结果。` : `已完成 ${result.sampleCount || 0} 次采样。`)}${caveats.length ? ` ${[...new Set(caveats)].join(' ')}` : ''}`);
    renderOperationOutcomes(result);
  } catch (error) { $('currencyMessage').innerHTML = msg('error', error.message); }
}
async function applyCurrency() {
  try {
    const { kind, actionId } = selectedOperation();
    const result = (kind === 'currency' || kind === 'desecrate')
      ? await api.applyCraftingCurrency({ state: statePayload(), currencyId: actionId, seed: Number($('seedInput').value) || Date.now() })
      : await api.applyCraftingSpecialAction(specialActionPayload());
    renderState(result.state);
    const added = outcomeAffixes(result.added).map((affix) => `${affix.name}${affix.tier ? ` T${affix.tier}` : ''}`).join('、') || (result.installed ? `${result.installed.name}（插槽 ${Number(result.installed.slotIndex) + 1}）` : '无');
    const removed = outcomeAffixes(result.removed).map((affix) => `${affix.name}${affix.tier ? ` T${affix.tier}` : ''}`).join('、') || (result.replaced ? `替换 ${result.replaced.name}` : '无');
    const actionName = result.currency?.name || result.action?.name || selectedOperation().record?.name || '操作';
    $('currencyMessage').innerHTML = msg('good', `${actionName} 已执行（种子 ${result.seed}）。新增/镶嵌：${added}；移除/替换：${removed}。${result.probabilityCaveat ? ` ${result.probabilityCaveat}` : ''}`);
    const refreshed = await api.createCraftingState({ ...statePayload(), activeOmens: sandboxState.activeOmens });
    lastAvailability = refreshed.availability || [];
    renderState(refreshed.state);
    renderAvailability();
    clearOutcomePreview('操作已执行，可继续选择下一步。');
  } catch (error) { $('currencyMessage').innerHTML = msg('error', error.message); }
}

async function previewDesecratedReveal(reroll = false) {
  try {
    if (reroll) revealRerollIndex = 1;
    else revealRerollIndex = 0;
    const result = await api.previewDesecratedReveal({
      state: statePayload(),
      instanceId: $('revealInstanceSelect').value,
      seed: Number($('seedInput').value) || 20260618,
      rerollIndex: revealRerollIndex
    });
    if (!result.ok) { $('revealMessage').innerHTML = msg('warn', result.reason); return; }
    lastRevealPreview = result;
    $('revealOptionSelect').innerHTML = result.options.map((option, index) => `<option value="${esc(`${option.modifierId}|${option.tier}`)}">${index + 1}. ${esc(option.name)} T${option.tier} · ${option.type === 'prefix' ? '前缀' : '后缀'} · ${option.source === 'desecrated' ? '专属亵渎' : '普通词缀'}</option>`).join('');
    $('applyRevealButton').disabled = !result.options.length;
    $('rerollRevealButton').disabled = !result.canReroll || revealRerollIndex > 0;
    const pool = result.poolSummary || {};
    $('revealMessage').innerHTML = msg('info', `已生成 ${result.options.length} 个不重复选项。候选事件：普通 ${pool.normalEvents || 0} / 专属亵渎 ${pool.exclusiveEvents || 0}；候选总权重：普通 ${Math.round(pool.normalWeight || 0)} / 专属 ${Math.round(pool.exclusiveWeight || 0)}；最低词缀等级 ${pool.minModifierLevel || 0}${pool.minimumLevelFallbackEvents ? `，家族等级保底事件 ${pool.minimumLevelFallbackEvents}` : ''}。每次使用通货、移除/新增词缀、改变槽位或触发预兆后，都会重新计算可用词缀、冲突与权重。`);
  } catch (error) { $('revealMessage').innerHTML = msg('error', error.message); }
}
async function applyDesecratedRevealSelection() {
  try {
    if (!lastRevealPreview) throw new Error('请先生成揭示选项。');
    const [modifierId, tierText] = $('revealOptionSelect').value.split('|');
    const result = await api.applyDesecratedReveal({
      state: statePayload(), instanceId: $('revealInstanceSelect').value,
      seed: Number($('seedInput').value) || 20260618, rerollIndex: revealRerollIndex,
      modifierId, tier: Number(tierText)
    });
    renderState(result.state);
    $('revealMessage').innerHTML = msg('good', `已揭示：${result.selected.name} T${result.selected.tier}${result.selected.source === 'desecrated' ? '（专属亵渎词缀）' : '（普通词缀经亵渎获得）'}。`);
    const refreshed = await api.createCraftingState({ ...statePayload(), activeOmens: sandboxState.activeOmens });
    lastAvailability = refreshed.availability || []; renderAvailability();
  } catch (error) { $('revealMessage').innerHTML = msg('error', error.message); }
}

function restrictionBadges(record) {
  const use = record.usage || {};
  const badges = [];
  if (use.targetTypes?.length) badges.push(`目标：${use.targetTypes.map((type) => targetTypeNames[type] || type).join('/')}`);
  if (use.inputRarities?.length) badges.push(`输入稀有度：${use.inputRarities.map((r) => rarityNames[r] || r).join('/')}`);
  if (use.excludedRarities?.length) badges.push(`排除：${use.excludedRarities.map((r) => rarityNames[r] || r).join('/')}`);
  if (use.outputRarity) badges.push(`结果：${rarityNames[use.outputRarity] || use.outputRarity}`);
  if (use.minimumModifierLevel) badges.push(`新增词缀等级 ≥ ${use.minimumModifierLevel}`);
  if (use.minExplicitAffixes != null) badges.push(`至少 ${use.minExplicitAffixes} 条显式`);
  if (use.maxExplicitAffixesBeforeUse != null) badges.push(`使用前至多 ${use.maxExplicitAffixesBeforeUse} 条显式`);
  if (use.rerollToExplicitAffixes != null) badges.push(`重建为 ${use.rerollToExplicitAffixes} 条显式`);
  if (use.addCount != null) badges.push(`新增 ${use.addCount} 条`);
  if (use.removeCount != null) badges.push(`移除 ${use.removeCount} 条`);
  if (use.retainExisting === false) badges.push('不保留原显式词缀');
  if (use.rerollValuesWithinTier) badges.push('仅重骰当前T级数值');
  if (use.requiresOpenAffix) badges.push('需要空余词缀槽');
  if (use.requiresRemovableAffix) badges.push('需要可移除词缀');
  if (use.requiresNoFracturedAffix) badges.push('不能已有破裂词缀');
  if (use.requiredSupportSockets != null) badges.push(`要求 ${use.requiredSupportSockets} 个辅助插槽`);
  if (use.maxSupportSocketsBeforeUse != null) badges.push(`使用前辅助插槽 ≤ ${use.maxSupportSocketsBeforeUse}`);
  if (use.outputSupportSockets != null) badges.push(`结果辅助插槽 ${use.outputSupportSockets}`);
  if (use.requiresAvailableSocketCapacity) badges.push('底材必须仍有插槽容量');
  if (use.qualityAction) badges.push(qualityActionNames[use.qualityAction] || use.qualityAction);
  if (use.modifierTag) badges.push('影响指定类型的词缀');
  if (use.corruptsItem) badges.push('使用后腐化');
  if (use.irreversible) badges.push('不可逆');
  if (use.createsMirroredCopy) badges.push('生成镜像复制品');
  if (use.destroysOnFailure) badges.push('失败摧毁物品');
  if (use.notAppliedToItem || use.directUse === false) badges.push('不可直接作用于装备');
  if (use.combineAtStackSize) badges.push(`满 ${use.combineAtStackSize} 个合成/使用`);
  if (use.requiresUncorrupted) badges.push('仅未腐化');
  if (use.requiresUnmirrored) badges.push('仅未镜像');
  badges.push(use.simulatorSupport === 'ready' ? '状态机已实现' : '仅规则目录');
  return [...new Set(badges)];
}
const CATALOG_CATEGORY_NAMES = {
  currency: '基础通货与机制通货',
  'abyssal-bone': '亵渎材料',
  essence: '精华',
  socketable: '符文与插槽强化物',
  omen: '预兆'
};

function compactLines(lines, limit = 5) {
  return (Array.isArray(lines) ? lines : []).filter(Boolean).slice(0, limit).join('；');
}

function listValue(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== '').map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}
function unifiedCatalogEntries() {
  const base = currentBase();
  const staticCurrencies = (context.currencyCatalog || []).map((record) => ({
    category: record.kind === 'abyssal-bone' ? 'abyssal-bone' : 'currency',
    id: `currency:${record.id}`,
    name: record.nameZh || record.nameEn || record.id,
    englishName: record.nameEn || '',
    summary: record.effectZh || '',
    details: record.usage?.usageNoteZh || '尚未补充使用限制。',
    badges: restrictionBadges(record),
    hiddenLegacy: record.kind === 'abyssal-bone' && record.currentDefault === false,
    localizedRecord: null,
    searchText: `${record.nameZh || ''} ${record.nameEn || ''} ${record.effectZh || ''} ${record.usage?.usageNoteZh || ''} ${(record.aliasesZh || []).join(' ')}`
  }));

  const essences = (context.data?.essences || []).map((record) => {
    const allEffects = record.effects || [];
    const compatible = essenceCompatibleEffects(record, base);
    const effectText = allEffects.map((effect) => effect.modifierName || '').filter(Boolean);
    const summary = compactLines(record.chronicleDescriptionLines) || record.description || record.mode || effectText.slice(0, 4).join('；') || '精华保证词缀资料。';
    const details = base
      ? (compatible.length ? `当前底材可用：${compatible.map((effect) => effect.modifierName).filter(Boolean).join('；') || `${compatible.length} 条保证效果`}` : '当前底材不可用；仍保留在完整精华目录中。')
      : '选择严格底材后显示当前可用性。';
    return {
      category: 'essence', id: `essence:${record.id}`, name: record.name || record.englishName || record.id,
      englishName: record.englishName || '', summary, details,
      badges: ['精华', record.mode || '保证词缀', base ? (compatible.length ? '当前底材可用' : '当前底材不可用') : '等待选择底材', `效果 ${allEffects.length} 条`],
      hiddenLegacy: false, localizedRecord: record,
      searchText: `${record.name || ''} ${record.englishName || ''} ${record.mode || ''} ${record.description || ''} ${compactLines(record.chronicleDescriptionLines, 16)} ${effectText.join(' ')}`
    };
  });

  const socketables = (context.data?.socketables || []).map((record) => {
    const allEffects = record.effects || [];
    const compatible = socketableCompatible(record, base);
    const effectText = allEffects.map((effect) => effect.modifierName || '').filter(Boolean);
    const typeName = socketableTypeName(record.type);
    const summary = compactLines(record.chronicleDescriptionLines) || record.description || effectText.slice(0, 5).join('；') || `${typeName}资料。`;
    const details = base
      ? (compatible.length ? `当前底材可用：${compatible.map((effect) => effect.modifierName).filter(Boolean).join('；') || `${compatible.length} 条兼容效果`}` : '当前底材不可用；仍保留在完整符文与插槽强化物目录中。')
      : '选择严格底材后显示当前可用性。';
    return {
      category: 'socketable', id: `socketable:${record.id}`, name: record.name || record.englishName || record.id,
      englishName: record.englishName || '', summary, details,
      badges: [typeName, base ? (compatible.length ? '当前底材可用' : '当前底材不可用') : '等待选择底材', `效果 ${allEffects.length} 条`],
      hiddenLegacy: false, localizedRecord: record,
      searchText: `${record.name || ''} ${record.englishName || ''} ${typeName} ${record.description || ''} ${compactLines(record.chronicleDescriptionLines, 16)} ${effectText.join(' ')}`
    };
  });

  const omens = (context.data?.omens || []).map((record) => {
    const triggerCurrencies = listValue(record.triggerCurrency);
    return {
      category: 'omen', id: `omen:${record.id}`, name: record.name || record.englishName || record.id,
      englishName: record.englishName || '', summary: record.description || '预兆规则资料。',
      details: record.ruleDescription && record.ruleDescription !== record.description ? `状态机规则：${record.ruleDescription}` : '只在下一次符合条件的操作触发。',
      badges: ['预兆', record.consumed === false ? '触发后不消耗' : '触发后消耗', ...(triggerCurrencies.length ? [`触发操作 ${triggerCurrencies.length} 类`] : [])],
      hiddenLegacy: false, localizedRecord: record.localizationSource ? record : null,
      searchText: `${record.name || ''} ${record.englishName || ''} ${record.description || ''} ${record.ruleDescription || ''} ${triggerCurrencies.join(' ')}`
    };
  });

  return [...staticCurrencies, ...essences, ...socketables, ...omens];
}

function renderUnifiedCatalogCard(entry) {
  const localization = entry.localizedRecord ? ` ${localizationBadge(entry.localizedRecord)}` : '';
  const english = entry.englishName && normalizedText(entry.englishName) !== normalizedText(entry.name)
    ? `<div class="help">${esc(entry.englishName)}</div>` : '';
  const details = entry.details ? `<p class="help">${esc(entry.details)}</p>` : '';
  return `<article class="currency-card" data-catalog-category="${esc(entry.category)}"><span class="catalog-category">${esc(CATALOG_CATEGORY_NAMES[entry.category] || entry.category)}</span><h3>${esc(entry.name)}${localization}</h3>${english}<p>${esc(entry.summary || '')}</p>${details}<div class="restriction-list">${[...new Set(entry.badges || [])].filter(Boolean).map((badge) => `<span>${esc(badge)}</span>`).join('')}</div></article>`;
}

function renderCurrencyCatalog() {
  const query = normalizedText($('currencySearch').value);
  const category = $('currencyCategoryFilter')?.value || 'all';
  const showLegacy = Boolean($('showLegacyBones')?.checked);
  const allEntries = unifiedCatalogEntries();
  const records = allEntries
    .filter((entry) => showLegacy || !entry.hiddenLegacy)
    .filter((entry) => category === 'all' || entry.category === category)
    .filter((entry) => !query || normalizedText(entry.searchText).includes(query))
    .sort((a, b) => (Object.keys(CATALOG_CATEGORY_NAMES).indexOf(a.category) - Object.keys(CATALOG_CATEGORY_NAMES).indexOf(b.category)) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  const hiddenLegacyCount = allEntries.filter((entry) => entry.hiddenLegacy && !showLegacy).length;
  const baseName = currentBase()?.name || '尚未选择底材';
  $('currencyCatalogMeta').textContent = `显示 ${records.length} / ${allEntries.length} 项 · 当前底材：${baseName}${hiddenLegacyCount ? ` · 已折叠 ${hiddenLegacyCount} 项旧版/停用骨材` : ''}`;
  $('currencyCatalog').innerHTML = records.map(renderUnifiedCatalogCard).join('') || '<div class="help">没有匹配的目录项目。</div>';
}
async function loadCraftingContextWithRetry(attempts = 4) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await api.getCraftingContext();
    if (latest?.dataReady) return latest;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
  }
  return latest;
}

async function updateData() {
  $('updateDataButton').disabled = true;
  $('updateProgress').textContent = '正在连接数据源……';
  try {
    await api.updateFullPoe2Data();
    context = await loadCraftingContextWithRetry();
    if (!context?.dataReady) {
      throw new Error(context?.dataError || '严格快照已下载，但做装数据重新加载失败。');
    }
    exactAffixes = []; sandboxState = null; lastAvailability = []; lastRevealPreview = null; importedItemSnapshot = null;
    initializeFromContext();
    $('updateProgress').textContent = '严格数据已安装、激活并重新加载。';
  } catch (error) {
    $('updateProgress').textContent = `更新失败：${error.message}`;
    try {
      context = await api.getCraftingContext();
      initializeFromContext();
    } catch (_reloadError) { /* 保留原始错误。 */ }
  } finally { $('updateDataButton').disabled = false; }
}
function bindEvents() {
  $('baseSelect').addEventListener('change', () => { importedItemSnapshot = null; renderConcreteBases(); renderModifiers(); renderEssences(); renderSocketables(); renderOmensAndCurrencies(); renderCurrencyCatalog(); });
  $('concreteBaseSelect').addEventListener('change', () => { clampCounts(); renderConcreteBaseDetails(); renderExistingPicker(); invalidateSandbox(); });
  $('itemLevelInput').addEventListener('change', renderModifiers);
  $('raritySelect').addEventListener('change', invalidateSandbox);
  $('prefixCountInput').addEventListener('change', clampCounts);
  $('suffixCountInput').addEventListener('change', clampCounts);
  $('modSearch').addEventListener('input', renderModifiers);
  $('existingModifierPicker').addEventListener('change', renderExistingTierPicker);
  $('addExistingButton').addEventListener('click', addExistingAffix);
  $('analyzeButton').addEventListener('click', analyze);
  $('savePricesButton').addEventListener('click', async () => { await api.saveCurrencyPrices(readPrices()); $('formMessage').innerHTML = msg('good', '制作成本参数已保存。'); });
  $('importClipboardButton').addEventListener('click', importClipboard);
  $('updateDataButton').addEventListener('click', updateData);
  $('createStateButton').addEventListener('click', createSandboxState);
  $('previewCurrencyButton').addEventListener('click', previewCurrency);
  $('applyCurrencyButton').addEventListener('click', applyCurrency);
  $('previewRevealButton').addEventListener('click', () => previewDesecratedReveal(false));
  $('rerollRevealButton').addEventListener('click', () => previewDesecratedReveal(true));
  $('applyRevealButton').addEventListener('click', applyDesecratedRevealSelection);
  $('resetStateButton').addEventListener('click', invalidateSandbox);
  $('operationKindSelect').addEventListener('change', renderOperationOptions);
  $('currencySelect').addEventListener('change', renderOperationDetails);
  $('augmentSocketCapacityInput').addEventListener('change', () => { updateAugmentSlotOptions(); if (sandboxState) $('currencyMessage').innerHTML = msg('info', '插槽容量已修改；下一次预览或执行会使用新容量。'); });
  $('augmentSlotSelect').addEventListener('change', renderOperationDetails);
  $('omenSelect').addEventListener('change', handleOmenSelectionChange);
  $('currencySearch').addEventListener('input', renderCurrencyCatalog);
  $('currencyCategoryFilter').addEventListener('change', renderCurrencyCatalog);
  $('essenceSelect').addEventListener('change', renderEssenceDetails);
  $('socketableSelect').addEventListener('change', renderSocketableDetails);
  $('showLegacyBones').addEventListener('change', () => { renderOmensAndCurrencies(); renderCurrencyCatalog(); });
}
function initializeFromContext() {
  renderDataStatus(); renderPrices(); renderOmensAndCurrencies(); renderCurrencyCatalog(); renderSeasonMechanics();
  if (context.dataReady) { renderBases(); renderModifiers(); }
  else {
    $('baseSelect').innerHTML = '<option>请先更新严格数据</option>';
    $('concreteBaseSelect').innerHTML = '<option>请先更新严格数据</option>';
    $('concreteBaseDetails').textContent = '严格数据未就绪。';
    $('existingModifierPicker').innerHTML = '<option>不可用</option>';
    $('existingTierPicker').innerHTML = '<option>不可用</option>';
    $('targetList').innerHTML = '<div class="help">严格数据未就绪。</div>';
  }
}
(async () => {
  if (!api) throw new Error('请通过桌面应用启动做装模拟器。');
  bindEvents();
  stopProgressListener = api.onCraftingDataUpdateProgress((event) => {
    if (event.phase === 'download') $('updateProgress').textContent = `正在下载 ${event.name}（${event.index}/${event.total}）`;
    else if (event.phase === 'normalize') $('updateProgress').textContent = '正在按精确底材重建词缀池……';
    else if (event.phase === 'chronicle-start') $('updateProgress').textContent = `正在同步流亡2编年史中文：缓存 ${event.cached || 0}，待抓取 ${event.pending || 0}`;
    else if (event.phase === 'chronicle') $('updateProgress').textContent = `正在同步编年史中文 ${event.completed}/${event.total}：${event.name || ''}`;
    else if (event.phase === 'chronicle-done') $('updateProgress').textContent = `编年史中文完成：${event.counts.matched}/${event.counts.targets}，未匹配 ${event.counts.unresolved}`;
    else if (event.phase === 'install') $('updateProgress').textContent = '正在安全安装新快照（旧快照仍可用）……';
    else if (event.phase === 'activate') $('updateProgress').textContent = '正在激活并重新加载做装数据……';
    else if (event.phase === 'done') $('updateProgress').textContent = `校验完成：${event.counts.exactBasePools} 个底材池，${event.counts.modifierPools} 组词缀。`;
  });
  context = await loadCraftingContextWithRetry(2);
  initializeFromContext();
})().catch((error) => { $('formMessage').innerHTML = msg('error', error.message); });
window.addEventListener('beforeunload', () => { if (stopProgressListener) stopProgressListener(); });
