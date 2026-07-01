'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const os = require('node:os');
const { syncChronicleLocalization, makeChronicleUrl } = require('../src/chronicle-zh');

const COE_DATA_REPOSITORY = 'Ruined-buil/CraftofExile2Data';
const FALLBACK_COE_DATA_COMMIT = '3f571076ed9cb6570f6c425185a570565b0760a8';
const DEFAULT_ROOT = path.join(__dirname, '..', 'data-snapshot');
const MAX_REDIRECTS = 5;
const SOURCE_FILES = [
  { name: 'summary.json', maxBytes: 2 * 1024 * 1024 },
  { name: 'bases.json', maxBytes: 8 * 1024 * 1024 },
  { name: 'base_items.json', maxBytes: 40 * 1024 * 1024 },
  { name: 'modifiers.json', maxBytes: 40 * 1024 * 1024 },
  { name: 'modifier_types.json', maxBytes: 8 * 1024 * 1024 },
  { name: 'modifier_groups.json', maxBytes: 2 * 1024 * 1024 },
  { name: 'modifier_tiers.json', maxBytes: 240 * 1024 * 1024 },
  { name: 'lang_base.json', maxBytes: 4 * 1024 * 1024, shape: 'object' },
  { name: 'lang_mod.json', maxBytes: 16 * 1024 * 1024, shape: 'object' },
  { name: 'essences.json', maxBytes: 24 * 1024 * 1024 },
  { name: 'socketables.json', maxBytes: 32 * 1024 * 1024 }
];

// Craft of Exile 0.5.0 的 base_items.json 仍保留少量旧来源 ID：
// 230/231/232 是路石低/中/高阶池的旧 ID，而 bases.json 已改为 233/234/235。
// 这些是来源数据中的 ID 迁移，不是可以任意猜测的跨池继承。
const KNOWN_BASE_ID_ALIASES = Object.freeze({
  '230': '233',
  '231': '234',
  '232': '235'
});

// 51 是来源 concrete base item 表中的三属性护甲池，但 0.5.0 的 bases/lang_base
// 快照漏掉了这一行。它不能被合并到任一双属性护甲池，否则会重新引入跨底材词缀污染。
const KNOWN_SYNTHETIC_BASES = Object.freeze({
  '51': Object.freeze({
    id_bgroup: '2',
    id_base: '51',
    name_base: 'Body Armour (STR/DEX/INT)',
    is_jewellery: '0',
    base_type: 'source-orphan',
    has_childs: '0',
    master_base: null,
    unique_notable: '0',
    enchant: null,
    is_legacy: '0',
    is_martial: '1'
  })
});


function sleepSync(milliseconds) {
  if (!milliseconds) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function removeWithRetry(target, options = {}) {
  if (!target || !fs.existsSync(target)) return;
  const retries = Number.isInteger(options.retries) ? options.retries : 8;
  const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 150;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(target, {
        recursive: options.recursive !== false,
        force: true,
        maxRetries: 3,
        retryDelay
      });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code) || attempt === retries) break;
      sleepSync(retryDelay * (attempt + 1));
    }
  }
  if (lastError) throw lastError;
}

function createTemporaryWorkspace(options = {}, destinationParent = null) {
  const candidates = [
    options.workspaceRoot,
    os.tmpdir(),
    destinationParent
  ].filter(Boolean).map((entry) => path.resolve(entry));
  const attempted = [];
  for (const root of [...new Set(candidates)]) {
    try {
      fs.mkdirSync(root, { recursive: true });
      return fs.mkdtempSync(path.join(root, 'poe2-strict-snapshot-'));
    } catch (error) {
      attempted.push(`${root}: ${error.code || error.message}`);
    }
  }
  throw new Error(`无法创建严格快照临时目录：${attempted.join('；')}`);
}

function renameWithRetry(source, destination, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 8;
  const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 150;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code) || attempt === retries) break;
      sleepSync(retryDelay * (attempt + 1));
    }
  }
  throw lastError;
}

function installSnapshotDirectory(sourceRoot, destinationRoot) {
  const destinationParent = path.dirname(destinationRoot);
  fs.mkdirSync(destinationParent, { recursive: true });
  const staging = path.join(destinationParent, `poe2-install-${process.pid}-${crypto.randomBytes(5).toString('hex')}`);
  const backup = `${destinationRoot}.backup-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  let movedExisting = false;
  try {
    removeWithRetry(staging);
    fs.cpSync(sourceRoot, staging, { recursive: true, force: false, errorOnExist: true });
    validateAndCount(staging);
    if (fs.existsSync(destinationRoot)) {
      renameWithRetry(destinationRoot, backup);
      movedExisting = true;
    }
    renameWithRetry(staging, destinationRoot);
    if (movedExisting) removeWithRetry(backup);
  } catch (error) {
    try { removeWithRetry(staging); } catch (_cleanupError) { /* 保留原错误。 */ }
    if (movedExisting && !fs.existsSync(destinationRoot) && fs.existsSync(backup)) {
      try { renameWithRetry(backup, destinationRoot); } catch (_restoreError) { /* 由调用者报告原错误。 */ }
    }
    throw error;
  } finally {
    if (fs.existsSync(backup) && fs.existsSync(destinationRoot)) {
      try { removeWithRetry(backup); } catch (_error) { /* 下次清理。 */ }
    }
  }
}

function writeFailureRecord(errorRoot, failure) {
  if (!errorRoot) return;
  try {
    fs.mkdirSync(errorRoot, { recursive: true });
    fs.writeFileSync(path.join(errorRoot, 'last-update-error.json'), JSON.stringify(failure, null, 2));
  } catch (_error) {
    // 失败记录不能覆盖真正的下载/校验错误。
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function requestBuffer(url, options = {}, redirects = 0) {
  const maxBytes = Number(options.maxBytes || 4 * 1024 * 1024);
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'poe2-regex-trade-crafting-assistant/1.7.0',
        Accept: options.accept || 'application/json,application/octet-stream;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity'
      },
      timeout: Number(options.timeout || 60_000)
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error(`重定向过多：${url}`));
        return resolve(requestBuffer(new URL(response.headers.location, url).toString(), options, redirects + 1));
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`下载失败 HTTP ${status}：${url}`));
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared && declared > maxBytes) {
        response.resume();
        return reject(new Error(`远程文件超过安全上限：${declared} bytes`));
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) request.destroy(new Error(`下载内容超过安全上限：${maxBytes} bytes`));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout', () => request.destroy(new Error(`下载超时：${url}`)));
    request.on('error', reject);
  });
}

async function fetchJson(url, options = {}) {
  const buffer = await requestBuffer(url, options);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`JSON 解析失败：${url}：${error.message}`);
  }
}

async function resolveSourceCommit() {
  try {
    const payload = await fetchJson(`https://api.github.com/repos/${COE_DATA_REPOSITORY}/commits/main`, {
      maxBytes: 2 * 1024 * 1024,
      timeout: 30_000
    });
    const sha = String(payload?.sha || '');
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
  } catch (_error) {
    // GitHub API 不可用时使用已核验的 0.5.0 快照提交；仍通过文件结构和数量校验。
  }
  return FALLBACK_COE_DATA_COMMIT;
}

function writeBufferAtomic(destination, buffer, options = {}) {
  const retries = Number.isInteger(options.retries) ? options.retries : 12;
  const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 180;
  const transientCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EEXIST']);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const part = path.join(
      parent,
      `${path.basename(destination)}.download-${process.pid}-${crypto.randomBytes(6).toString('hex')}.part`
    );
    let descriptor = null;
    try {
      descriptor = fs.openSync(part, 'wx');
      fs.writeFileSync(descriptor, buffer);
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;

      if (fs.existsSync(destination)) removeWithRetry(destination, { recursive: false });
      renameWithRetry(part, destination, { retries, retryDelay });
      const stat = fs.statSync(destination);
      if (stat.size !== buffer.length) {
        throw new Error(`原子写入长度不一致：${stat.size}/${buffer.length} bytes`);
      }
      return { bytes: stat.size };
    } catch (error) {
      lastError = error;
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_closeError) { /* 保留原错误。 */ }
      }
      try { removeWithRetry(part, { recursive: false, retries: 3, retryDelay: 80 }); } catch (_cleanupError) { /* 下次使用随机文件名。 */ }
      if (!transientCodes.has(error.code) || attempt === retries) break;
      sleepSync(retryDelay * (attempt + 1));
    }
  }
  const code = lastError?.code ? ` (${lastError.code})` : '';
  throw new Error(`无法安全写入下载文件${code}：${destination}：${lastError?.message || '未知错误'}`);
}

async function downloadToFile(url, destination, options = {}) {
  // 原先直接把网络响应流写入最终 JSON 文件。Windows Defender、索引器或
  // 上一次失败连接可能短暂占用该路径，随后镜像重试就会得到 EPERM。
  // 现在先完整下载到内存，再写入随机 .part 文件，关闭句柄后原子改名。
  // 即使某个镜像中途失败，也不会留下或复用被占用的 base_items.json。
  const buffer = await requestBuffer(url, {
    maxBytes: Number(options.maxBytes || 50 * 1024 * 1024),
    timeout: Number(options.timeout || 90_000),
    accept: 'application/octet-stream,application/json;q=0.9,*/*;q=0.8'
  });
  if (!buffer.length) throw new Error(`下载内容为空：${url}`);
  return writeBufferAtomic(destination, buffer, options);
}

function sourceUrls(commit, fileName) {
  // 一次快照的九个文件必须来自同一个 ref。不同镜像只改变传输路径，
  // 不能在同一次更新中把固定提交与 main 的文件混用。
  const ref = String(commit || '').trim();
  if (!ref) return [];
  return [
    `https://raw.githubusercontent.com/${COE_DATA_REPOSITORY}/${ref}/data/${fileName}`,
    `https://github.com/${COE_DATA_REPOSITORY}/raw/${ref}/data/${fileName}`,
    `https://cdn.jsdelivr.net/gh/${COE_DATA_REPOSITORY}@${ref}/data/${fileName}`,
    `https://fastly.jsdelivr.net/gh/${COE_DATA_REPOSITORY}@${ref}/data/${fileName}`,
    `https://testingcf.jsdelivr.net/gh/${COE_DATA_REPOSITORY}@${ref}/data/${fileName}`
  ];
}

async function downloadSourceFile(commit, file, destination) {
  const attempts = [];
  for (const url of sourceUrls(commit, file.name)) {
    try {
      const result = await downloadToFile(url, destination, file);
      return { ...result, url, attempts };
    } catch (error) {
      attempts.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`所有镜像均下载失败：${attempts.join('；')}`);
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'unknown';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function inferSyntheticBaseName(baseId, items = []) {
  const known = KNOWN_SYNTHETIC_BASES[String(baseId)];
  if (known?.name_base) return known.name_base;

  const evidence = items.map((item) => [
    item?.name_bitem,
    item?.imgurl,
    item?.tgb
  ].filter(Boolean).join(' ')).join(' ');

  if (/BodyStrDexInt|body\s*armou?r.*str.*dex.*int/i.test(evidence)) {
    return 'Body Armour (STR/DEX/INT)';
  }
  if (/waystone/i.test(evidence)) return `Waystone Source Pool ${baseId}`;
  return `Unlisted Source Base ${baseId}`;
}

function buildEffectiveBaseGraph(sourceBases, baseItems, tierRows, languageBases) {
  const bases = sourceBases.map((entry) => ({ ...entry }));
  const baseById = new Map(bases.map((entry) => [String(entry.id_base), entry]));
  const itemsByRawBase = new Map();
  for (const item of Array.isArray(baseItems) ? baseItems : []) {
    const id = String(item?.id_base || '');
    if (!itemsByRawBase.has(id)) itemsByRawBase.set(id, []);
    itemsByRawBase.get(id).push(item);
  }

  const referencedIds = new Set([
    ...itemsByRawBase.keys(),
    ...(Array.isArray(tierRows) ? tierRows.map((row) => String(row?.base_id || '')) : [])
  ].filter(Boolean));
  const resolutionBySourceId = new Map(bases.map((entry) => [String(entry.id_base), String(entry.id_base)]));
  const aliasResolutions = [];
  const syntheticBases = [];
  const usedNames = new Set(bases.map((entry) => String(entry.name_base || languageBases[String(entry.id_base)] || '').trim()).filter(Boolean));

  for (const rawId of [...referencedIds].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))) {
    if (baseById.has(rawId)) continue;

    const aliasTarget = KNOWN_BASE_ID_ALIASES[rawId];
    if (aliasTarget && baseById.has(aliasTarget)) {
      resolutionBySourceId.set(rawId, aliasTarget);
      aliasResolutions.push({ sourceBaseId: rawId, resolvedSourceBaseId: aliasTarget, reason: 'known-source-id-migration' });
      continue;
    }

    const template = KNOWN_SYNTHETIC_BASES[rawId] || {};
    let name = inferSyntheticBaseName(rawId, itemsByRawBase.get(rawId) || []);
    if (usedNames.has(name)) name = `${name} [source ${rawId}]`;
    usedNames.add(name);

    const synthetic = {
      id_bgroup: String(template.id_bgroup || ''),
      id_base: rawId,
      name_base: name,
      is_jewellery: String(template.is_jewellery || '0'),
      base_type: template.base_type || 'source-orphan',
      has_childs: String(template.has_childs || '0'),
      master_base: template.master_base ?? null,
      unique_notable: String(template.unique_notable || '0'),
      enchant: template.enchant ?? null,
      is_legacy: String(template.is_legacy || '0'),
      is_martial: String(template.is_martial || '0'),
      syntheticFromSourceReferences: true
    };
    bases.push(synthetic);
    baseById.set(rawId, synthetic);
    resolutionBySourceId.set(rawId, rawId);
    syntheticBases.push({
      sourceBaseId: rawId,
      name,
      concreteBaseItemCount: (itemsByRawBase.get(rawId) || []).length,
      referencedByTierRows: (Array.isArray(tierRows) ? tierRows : []).some((row) => String(row?.base_id || '') === rawId),
      reason: KNOWN_SYNTHETIC_BASES[rawId] ? 'known-upstream-omission' : 'unlisted-source-reference'
    });
  }

  return {
    bases,
    baseById,
    resolutionBySourceId,
    aliasResolutions,
    syntheticBases,
    itemsByRawBase
  };
}

function normalizeFamilies(modifier) {
  const values = [];
  if (modifier?.modgroup) values.push(String(modifier.modgroup));
  if (Array.isArray(modifier?.modgroups)) values.push(...modifier.modgroups.map(String));
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length ? unique : [`coe_modifier_${modifier.id_modifier}`];
}

function normalizeModifierSource(modifier, groupById) {
  const groupId = String(modifier?.id_mgroup || '1');
  const groupName = String(groupById.get(groupId)?.name_mgroup || (groupId === '1' ? 'Base' : `Group ${groupId}`));
  const normalized = groupName.toLowerCase();
  if (groupId === '1' || normalized === 'base') return { source: 'normal', groupId, groupName };
  if (groupId === '10' || normalized.includes('desecrat')) return { source: 'desecrated', groupId, groupName };
  if (groupId === '13' || normalized.includes('essence')) return { source: 'essence', groupId, groupName };
  return { source: 'special', groupId, groupName };
}

function inferModifierTags(modifierName, sourceTags = []) {
  const text = String(modifierName || '').toLowerCase();
  // Craft of Exile 的 mtype 标签是类型关系，不保证能直接表示三位巫妖专属归属。
  // 三类巫妖标签必须互斥，因此只按词缀名称中的 Amanamu/Kurgal/Ulaman 判定。
  const lichTags = new Set(['amanamu_mod', 'kurgal_mod', 'ulaman_mod']);
  const tags = new Set(sourceTags
    .map((tag) => String(tag).toLowerCase())
    .filter((tag) => tag && !lichTags.has(tag)));
  const addWhen = (tag, pattern) => { if (pattern.test(text)) tags.add(tag); };
  if (/amanamu/.test(text)) tags.add('amanamu_mod');
  else if (/kurgal/.test(text)) tags.add('kurgal_mod');
  else if (/ulaman/.test(text)) tags.add('ulaman_mod');
  addWhen('life', /\blife\b/);
  addWhen('mana', /\bmana\b/);
  addWhen('physical', /physical/);
  addWhen('fire', /\bfire\b|flammability|ignite/);
  addWhen('cold', /\bcold\b|freeze|chill/);
  addWhen('lightning', /lightning|shock/);
  addWhen('chaos', /chaos|poison/);
  addWhen('attack', /attack/);
  addWhen('caster', /spell|cast/);
  addWhen('speed', /speed/);
  addWhen('attribute', /attribute|strength|dexterity|intelligence/);
  addWhen('minion', /minion/);
  addWhen('defences', /armour|armor|evasion|energy shield|block|stun threshold/);
  return [...tags];
}


function flattenNestedEssenceEffects(value, output = []) {
  if (Array.isArray(value)) {
    for (const entry of value) flattenNestedEssenceEffects(entry, output);
  } else if (value && typeof value === 'object' && (value.mod != null || value.id != null)) {
    output.push(value);
  }
  return output;
}

function normalizeEssenceRecords(sourceEssences, resolutionBySourceId, modifierNameById = new Map()) {
  return (Array.isArray(sourceEssences) ? sourceEssences : []).map((essence) => {
    const effects = [];
    for (const [rawBaseId, nested] of Object.entries(essence?.tiers || {})) {
      const sourceBaseId = String(rawBaseId);
      const resolvedSourceBaseId = String(resolutionBySourceId.get(sourceBaseId) || sourceBaseId);
      for (const effect of flattenNestedEssenceEffects(nested)) {
        effects.push({
          sourceBaseId,
          resolvedSourceBaseId,
          sourceModifierId: effect.mod != null ? String(effect.mod) : null,
          sourceModifierName: effect.mod != null ? (modifierNameById.get(String(effect.mod)) || null) : null,
          externalModifierId: effect.id != null ? String(effect.id) : null,
          modifierLevel: Number(effect.ilvl || 0)
        });
      }
    }
    const name = String(essence?.name_essence || '').trim();
    return {
      id: String(essence?.id_essence || ''),
      name,
      tooltip: Array.isArray(essence?.tooltip) ? essence.tooltip.map(String) : [],
      corrupted: String(essence?.corrupt || '0') === '1' || /perfect|corrupt/i.test(name),
      effects
    };
  }).filter((entry) => entry.id && entry.name);
}

function normalizeSocketableRecords(sourceSocketables, resolutionBySourceId, modifierNameById = new Map()) {
  const normalizeModId = (value) => value == null || value === '' ? null : String(value);
  return (Array.isArray(sourceSocketables) ? sourceSocketables : []).map((socketable) => {
    const effects = [];
    const mods = socketable?.mods || {};
    for (const scope of ['all', 'armour', 'weapons', 'caster']) {
      const sourceModifierId = normalizeModId(mods[scope]);
      if (sourceModifierId) effects.push({ scope, sourceModifierId, sourceModifierName: modifierNameById.get(sourceModifierId) || null, sourceBaseIds: [], resolvedSourceBaseIds: [] });
    }
    for (const entry of Array.isArray(mods.class) ? mods.class : []) {
      const sourceBaseIds = (Array.isArray(entry?.bases) ? entry.bases : []).map(String);
      effects.push({
        scope: 'class',
        baseGroupId: entry?.bgroup == null ? null : String(entry.bgroup),
        sourceModifierId: normalizeModId(entry?.mod),
        sourceModifierName: normalizeModId(entry?.mod) ? (modifierNameById.get(normalizeModId(entry?.mod)) || null) : null,
        sourceBaseIds,
        resolvedSourceBaseIds: [...new Set(sourceBaseIds.map((id) => String(resolutionBySourceId.get(id) || id)))]
      });
    }
    return {
      id: String(socketable?.id_socketable || ''),
      type: String(socketable?.stype || 'socketable'),
      name: String(socketable?.name_socketable || '').trim(),
      image: socketable?.imgurl || null,
      effects: effects.filter((entry) => entry.sourceModifierId)
    };
  }).filter((entry) => entry.id && entry.name);
}


function buildChronicleTargets(normalizedBaseItems, normalizedEssences, normalizedSocketables, options = {}) {
  const targets = [];
  const add = (kind, sourceId, englishName, sourceUrl = null) => {
    const name = String(englishName || '').trim();
    if (!name) return;
    targets.push({
      key: `${kind}:${sourceId || name}`,
      kind,
      sourceId: sourceId == null ? null : String(sourceId),
      englishName: name,
      sourceUrl: sourceUrl || makeChronicleUrl(name)
    });
  };

  // 先同步做装界面最关键的预兆、精华和插槽强化物，再处理数量较大的具体基底。
  const omenFile = path.join(__dirname, '..', 'data-v2', 'omens', 'core.json');
  try {
    const omens = readJson(omenFile).records || [];
    for (const omen of omens) add('omen', omen.id, omen.englishName, omen.sourceUrl || null);
  } catch (_error) {
    // 内置预兆资料缺失时不阻止严格概率快照生成。
  }
  for (const essence of normalizedEssences || []) add('essence', essence.id, essence.name);
  for (const socketable of normalizedSocketables || []) add('socketable', socketable.id, socketable.name);
  if (options.includeBaseItems !== false) {
    for (const item of normalizedBaseItems || []) {
      if (item.legacy && options.includeLegacy !== true) continue;
      add('base-item', item.sourceBaseItemId, item.name);
    }
  }
  return targets;
}

function normalizeCraftOfExileData(sourceRoot, outputRoot) {
  const summary = readJson(path.join(sourceRoot, 'summary.json'));
  const sourceBases = readJson(path.join(sourceRoot, 'bases.json'));
  const baseItems = readJson(path.join(sourceRoot, 'base_items.json'));
  const modifiers = readJson(path.join(sourceRoot, 'modifiers.json'));
  const modifierTypes = readJson(path.join(sourceRoot, 'modifier_types.json'));
  const modifierGroups = readJson(path.join(sourceRoot, 'modifier_groups.json'));
  const tierRows = readJson(path.join(sourceRoot, 'modifier_tiers.json'));
  const languageBases = readJson(path.join(sourceRoot, 'lang_base.json'));
  const languageModifiers = readJson(path.join(sourceRoot, 'lang_mod.json'));
  const sourceEssences = readJson(path.join(sourceRoot, 'essences.json'));
  const sourceSocketables = readJson(path.join(sourceRoot, 'socketables.json'));

  if (!Array.isArray(sourceBases) || sourceBases.length < 60) throw new Error('Craft of Exile bases.json 数量异常。');
  if (!Array.isArray(modifiers) || modifiers.length < 1000) throw new Error('Craft of Exile modifiers.json 数量异常。');
  if (!Array.isArray(tierRows) || tierRows.length < 15000) throw new Error('Craft of Exile modifier_tiers.json 数量异常。');
  if (!languageBases || typeof languageBases !== 'object' || Array.isArray(languageBases)) throw new Error('Craft of Exile lang_base.json 格式异常。');
  if (!languageModifiers || typeof languageModifiers !== 'object' || Array.isArray(languageModifiers)) throw new Error('Craft of Exile lang_mod.json 格式异常。');
  if (!Array.isArray(sourceEssences)) throw new Error('Craft of Exile essences.json 格式异常。');
  if (!Array.isArray(sourceSocketables)) throw new Error('Craft of Exile socketables.json 格式异常。');

  const effectiveBaseGraph = buildEffectiveBaseGraph(sourceBases, baseItems, tierRows, languageBases);
  const bases = effectiveBaseGraph.bases;
  const baseById = effectiveBaseGraph.baseById;
  const resolutionBySourceId = effectiveBaseGraph.resolutionBySourceId;
  const modifierById = new Map(modifiers.map((entry) => [String(entry.id_modifier), entry]));
  const languageBaseEntries = Object.entries(languageBases);
  const languageModifierEntries = Object.entries(languageModifiers);
  const itemsByBase = new Map();
  for (const item of Array.isArray(baseItems) ? baseItems : []) {
    const sourceId = String(item.id_base);
    const resolvedId = String(resolutionBySourceId.get(sourceId) || sourceId);
    if (!itemsByBase.has(resolvedId)) itemsByBase.set(resolvedId, []);
    itemsByBase.get(resolvedId).push({
      sourceBaseItemId: String(item.id_bitem || ''),
      sourceBaseId: sourceId,
      resolvedSourceBaseId: resolvedId,
      sourceBaseResolution: sourceId === resolvedId
        ? (effectiveBaseGraph.syntheticBases.some((entry) => entry.sourceBaseId === sourceId) ? 'synthetic' : 'direct')
        : 'alias',
      name: String(item.name_bitem || '').trim(),
      dropLevel: Number(item.drop_level || 0),
      properties: item.properties || null,
      requirements: item.requirements || null,
      implicits: Array.isArray(item.implicits) ? item.implicits : [],
      image: item.imgurl || null,
      experience: Number(item.exp || 0),
      externalModifiers: item.exmods || null,
      tagGroup: item.tgb || null,
      legacy: String(item.is_legacy || '0') === '1'
    });
  }
  const typeById = new Map((Array.isArray(modifierTypes) ? modifierTypes : []).map((entry) => [String(entry.id_mtype), entry]));
  const groupById = new Map((Array.isArray(modifierGroups) ? modifierGroups : []).map((entry) => [String(entry.id_mgroup), entry]));
  if (!groupById.has('1')) groupById.set('1', { id_mgroup: '1', name_mgroup: 'Base' });
  if (!groupById.has('10')) groupById.set('10', { id_mgroup: '10', name_mgroup: 'Desecrated' });
  if (!groupById.has('13')) groupById.set('13', { id_mgroup: '13', name_mgroup: 'Essence' });

  const sourceProblems = [];
  const uniqueCount = (records, key) => new Set(records.map((entry) => String(entry?.[key] || ''))).size;
  if (uniqueCount(sourceBases, 'id_base') !== sourceBases.length) sourceProblems.push('bases.json 存在重复或空 id_base');
  const normalizedBaseNames = sourceBases.map((entry) => String(entry?.name_base || languageBases[String(entry?.id_base || '')] || '').trim());
  if (normalizedBaseNames.some((name) => !name)) sourceProblems.push('bases.json 存在空 name_base');
  if (new Set(normalizedBaseNames).size !== normalizedBaseNames.length) sourceProblems.push('bases.json 存在重复 name_base，按名称建立索引会丢池');
  if (uniqueCount(baseItems, 'id_bitem') !== baseItems.length) sourceProblems.push('base_items.json 存在重复或空 id_bitem');
  if (uniqueCount(modifiers, 'id_modifier') !== modifiers.length) sourceProblems.push('modifiers.json 存在重复或空 id_modifier');
  if (languageBaseEntries.length !== sourceBases.length) sourceProblems.push(`lang_base.json 数量 ${languageBaseEntries.length}/${sourceBases.length}`);
  if (languageModifierEntries.length !== modifiers.length) sourceProblems.push(`lang_mod.json 数量 ${languageModifierEntries.length}/${modifiers.length}`);
  for (const [id, name] of languageBaseEntries) {
    if (!baseById.has(String(id))) sourceProblems.push(`lang_base.json 含未知底材 ID ${id}`);
    if (!String(name || '').trim()) sourceProblems.push(`lang_base.json 的底材 ${id} 名称为空`);
  }
  for (const [id, name] of languageModifierEntries) {
    if (!modifierById.has(String(id))) sourceProblems.push(`lang_mod.json 含未知词缀 ID ${id}`);
    if (!String(name || '').trim()) sourceProblems.push(`lang_mod.json 的词缀 ${id} 名称为空`);
  }
  for (const base of sourceBases) if (!(String(base.id_base) in languageBases)) sourceProblems.push(`lang_base.json 缺少底材 ${base.id_base}`);
  for (const modifier of modifiers) if (!(String(modifier.id_modifier) in languageModifiers)) sourceProblems.push(`lang_mod.json 缺少词缀 ${modifier.id_modifier}`);
  for (const item of baseItems) {
    if (!item?.id_bitem || !String(item.name_bitem || '').trim()) sourceProblems.push(`具体基底缺少 ID 或名称：${item?.id_bitem || '?'}`);
    const rawBaseId = String(item?.id_base || '');
    const resolvedBaseId = String(resolutionBySourceId.get(rawBaseId) || '');
    if (!resolvedBaseId || !baseById.has(resolvedBaseId)) sourceProblems.push(`具体基底 ${item?.id_bitem || '?'} 引用了无法解析的底材 ${item?.id_base || '?'}`);
  }
  const expected = summary?.counts || {};
  const exactChecks = [
    ['bases', sourceBases.length], ['base_items', baseItems.length], ['modifiers', modifiers.length],
    ['modifier_types', modifierTypes.length], ['tier_rows', tierRows.length],
    ['language_bases', languageBaseEntries.length], ['language_mods', languageModifierEntries.length],
    ['essences', sourceEssences.length], ['socketables', sourceSocketables.length]
  ];
  for (const [key, actual] of exactChecks) {
    if (expected[key] != null && Number(expected[key]) !== actual) sourceProblems.push(`${key} 数量 ${actual}/${expected[key]}`);
  }
  if (sourceProblems.length) throw new Error(`Craft of Exile 原始数据完整性校验失败：${sourceProblems.slice(0, 20).join('；')}`);

  const grouped = new Map();
  let ignoredUnknownBase = 0;
  let ignoredUnknownModifier = 0;
  let ignoredUnsupportedAffix = 0;
  let ignoredInvalidTier = 0;
  for (const row of tierRows) {
    const rawBaseId = String(row.base_id);
    const baseId = String(resolutionBySourceId.get(rawBaseId) || rawBaseId);
    const modifierId = String(row.modifier_id);
    const base = baseById.get(baseId);
    const modifier = modifierById.get(modifierId);
    if (!base) { ignoredUnknownBase += 1; continue; }
    if (!modifier) { ignoredUnknownModifier += 1; continue; }
    const affix = String(modifier.affix || '').toLowerCase();
    if (!['prefix', 'suffix'].includes(affix)) { ignoredUnsupportedAffix += 1; continue; }
    const itemLevel = Number(row.item_level);
    const weight = Number(row.weighting);
    if (!Number.isFinite(itemLevel) || itemLevel < 0 || !Number.isFinite(weight)) {
      ignoredInvalidTier += 1;
      continue;
    }
    const key = `${baseId}\u0000${modifierId}`;
    let group = grouped.get(key);
    if (!group) {
      group = { baseId, modifierId, base, modifier, rawBaseIds: new Set(), rows: [] };
      grouped.set(key, group);
    }
    group.rawBaseIds.add(rawBaseId);
    group.rows.push({
      itemLevel,
      weight,
      statRanges: Array.isArray(row.stat_ranges) ? row.stat_ranges : [],
      tierOrder: Number(row.tier_order || 0),
      alias: row.alias || null
    });
  }

  // 为来源中的每一个有效底材都建立精确池；同时保留来源漏行后补建的独立池，
  // 并将已确认的旧 ID 映射到其新 ID。没有前后缀记录的底材写入空数组，
  // 绝不为了凑数量把它合并进相似武器/防具池。
  const poolMap = new Map(bases.map((base) => {
    const baseId = String(base.id_base);
    return [baseId, {
      baseName: String(base.name_base || languageBases[baseId] || `Base ${baseId}`).trim(),
      base,
      records: []
    }];
  }));
  for (const group of grouped.values()) {
    const baseName = String(group.base.name_base || languageBases[group.baseId] || `Base ${group.baseId}`).trim();
    const pool = poolMap.get(group.baseId);
    if (!pool) continue;
    const rows = group.rows.sort((left, right) =>
      right.itemLevel - left.itemLevel || left.tierOrder - right.tierOrder || right.weight - left.weight
    );
    const families = normalizeFamilies(group.modifier);
    const sourceInfo = normalizeModifierSource(group.modifier, groupById);
    const mtypeIds = String(group.modifier.mtypes || '').split('|').filter(Boolean);
    const sourceTags = mtypeIds.map((id) => typeById.get(id)?.poedb_id || typeById.get(id)?.name_mtype).filter(Boolean);
    const canonicalModifierName = String(group.modifier.name_modifier || languageModifiers[group.modifierId] || `Modifier ${group.modifierId}`);
    const tags = inferModifierTags(canonicalModifierName, sourceTags);
    const record = {
      base: baseName,
      type: String(group.modifier.affix).toUpperCase(),
      name: canonicalModifierName,
      languageName: String(languageModifiers[group.modifierId] || canonicalModifierName),
      itemClass: baseName,
      sourceBaseId: group.baseId,
      sourceTierBaseIds: [...group.rawBaseIds].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)),
      sourceModifierId: group.modifierId,
      families,
      tags,
      source: sourceInfo.source,
      sourceGroupId: sourceInfo.groupId,
      sourceGroupName: sourceInfo.groupName,
      exclusiveDesecrated: sourceInfo.source === 'desecrated',
      tiers: rows.map((row, index) => ({
        tier: index + 1,
        weight: row.weight,
        ilvl: row.itemLevel,
        spawnLvl: row.itemLevel,
        tierName: row.alias || '',
        id: `coe:${group.modifierId}:${group.baseId}:${row.itemLevel}:${index + 1}`,
        ranges: row.statRanges,
        weightSource: 'craftofexile-inferred'
      }))
    };
    pool.records.push(record);
  }

  const byBaseDir = path.join(outputRoot, 'by-base');
  fs.mkdirSync(byBaseDir, { recursive: true });
  const index = {};
  let modifierPools = 0;
  let modifierTiers = 0;
  let positiveWeightTiers = 0;
  let zeroWeightTiers = 0;
  const baseMetadata = {};
  for (const [baseId, pool] of [...poolMap.entries()].sort((a, b) => a[1].baseName.localeCompare(b[1].baseName))) {
    const fileSlug = `coe_${baseId}_${slug(pool.baseName)}`;
    index[pool.baseName] = fileSlug;
    pool.records.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    fs.writeFileSync(path.join(byBaseDir, `${fileSlug}.mods.json`), JSON.stringify(pool.records, null, 2));
    modifierPools += pool.records.length;
    for (const record of pool.records) {
      modifierTiers += record.tiers.length;
      positiveWeightTiers += record.tiers.filter((tier) => tier.weight > 0).length;
      zeroWeightTiers += record.tiers.filter((tier) => tier.weight <= 0).length;
    }
    baseMetadata[pool.baseName] = {
      sourceBaseId: baseId,
      sourceBaseAliases: effectiveBaseGraph.aliasResolutions
        .filter((entry) => entry.resolvedSourceBaseId === baseId)
        .map((entry) => entry.sourceBaseId),
      syntheticFromSourceReferences: Boolean(pool.base.syntheticFromSourceReferences),
      baseGroupId: String(pool.base.id_bgroup || ''),
      isJewellery: String(pool.base.is_jewellery || '0') === '1',
      isMartial: String(pool.base.is_martial || '0') === '1',
      baseType: pool.base.base_type || null,
      languageName: String(languageBases[baseId] || pool.baseName),
      concreteBaseItemCount: (itemsByBase.get(baseId) || []).length,
      hasCraftableExplicitPool: pool.records.some((record) => record.tiers.some((tier) => Number(tier.weight) > 0))
    };
  }
  fs.writeFileSync(path.join(byBaseDir, 'index.json'), JSON.stringify(index, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'base-metadata.json'), JSON.stringify(baseMetadata, null, 2));
  const normalizedBaseItems = [...itemsByBase.values()].flat()
    .filter((item) => item.name)
    .sort((left, right) => left.name.localeCompare(right.name) || left.sourceBaseItemId.localeCompare(right.sourceBaseItemId));
  fs.writeFileSync(path.join(outputRoot, 'base-items.json'), JSON.stringify(normalizedBaseItems, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'modifier-groups.json'), JSON.stringify([...groupById.values()], null, 2));
  const modifierNameById = new Map(modifiers.map((entry) => [String(entry.id_modifier), String(languageModifiers[String(entry.id_modifier)] || entry.name_modifier || '')]));
  const normalizedEssences = normalizeEssenceRecords(sourceEssences, resolutionBySourceId, modifierNameById);
  const normalizedSocketables = normalizeSocketableRecords(sourceSocketables, resolutionBySourceId, modifierNameById);
  fs.writeFileSync(path.join(outputRoot, 'essences.json'), JSON.stringify(normalizedEssences, null, 2));
  fs.writeFileSync(path.join(outputRoot, 'socketables.json'), JSON.stringify(normalizedSocketables, null, 2));

  const sourceBreakdown = { normal: { pools: 0, tiers: 0, positiveWeightTiers: 0 }, desecrated: { pools: 0, tiers: 0, positiveWeightTiers: 0 }, essence: { pools: 0, tiers: 0, positiveWeightTiers: 0 }, special: { pools: 0, tiers: 0, positiveWeightTiers: 0 } };
  for (const pool of poolMap.values()) {
    for (const record of pool.records) {
      const bucket = sourceBreakdown[record.source] || sourceBreakdown.special;
      bucket.pools += 1;
      bucket.tiers += record.tiers.length;
      bucket.positiveWeightTiers += record.tiers.filter((tier) => Number(tier.weight) > 0).length;
    }
  }

  const counts = {
    sourceBases: sourceBases.length,
    effectiveBases: bases.length,
    synthesizedBasePools: effectiveBaseGraph.syntheticBases.length,
    aliasedSourceBaseIds: effectiveBaseGraph.aliasResolutions.length,
    syntheticBaseDetails: effectiveBaseGraph.syntheticBases,
    baseAliasDetails: effectiveBaseGraph.aliasResolutions,
    sourceBaseItems: Array.isArray(baseItems) ? baseItems.length : 0,
    sourceModifiers: modifiers.length,
    sourceModifierTypes: Array.isArray(modifierTypes) ? modifierTypes.length : 0,
    sourceModifierGroups: Array.isArray(modifierGroups) ? modifierGroups.length : 0,
    sourceTierRows: tierRows.length,
    sourceLanguageBases: languageBaseEntries.length,
    sourceLanguageModifiers: languageModifierEntries.length,
    sourceEssences: sourceEssences.length,
    sourceSocketables: sourceSocketables.length,
    normalizedEssences: normalizedEssences.length,
    normalizedSocketables: normalizedSocketables.length,
    exactBasePools: Object.keys(index).length,
    modifierPools,
    modifierTiers,
    positiveWeightTiers,
    zeroWeightTiers,
    emptyBasePools: [...poolMap.values()].filter((pool) => !pool.records.some((record) => record.tiers.some((tier) => Number(tier.weight) > 0))).length,
    ignoredUnknownBase,
    ignoredUnknownModifier,
    ignoredUnsupportedAffix,
    ignoredInvalidTier,
    sourceBreakdown
  };
  const minimumModifierPools = Math.max(800, Math.floor(counts.sourceModifiers * 0.6));
  const minimumPositiveTiers = Math.max(8000, Math.floor(counts.sourceTierRows * 0.4));
  const coverageProblems = [];
  if (counts.exactBasePools !== counts.effectiveBases) coverageProblems.push(`精确池 ${counts.exactBasePools}/${counts.effectiveBases}`);
  if (counts.modifierPools < minimumModifierPools) coverageProblems.push(`词缀组 ${counts.modifierPools}/${minimumModifierPools}`);
  if (counts.positiveWeightTiers < minimumPositiveTiers) coverageProblems.push(`正权重T级 ${counts.positiveWeightTiers}/${minimumPositiveTiers}`);
  if (counts.sourceBaseItems && normalizedBaseItems.length !== counts.sourceBaseItems) coverageProblems.push(`具体基底 ${normalizedBaseItems.length}/${counts.sourceBaseItems}`);
  if (counts.ignoredUnknownBase) coverageProblems.push(`未知底材 T 级行 ${counts.ignoredUnknownBase}`);
  if (counts.ignoredUnknownModifier) coverageProblems.push(`未知词缀 T 级行 ${counts.ignoredUnknownModifier}`);
  if (counts.ignoredInvalidTier) coverageProblems.push(`无效 T 级行 ${counts.ignoredInvalidTier}`);
  if (!counts.sourceBreakdown.normal.positiveWeightTiers) coverageProblems.push('普通词缀正权重池为空');
  if (!counts.sourceBreakdown.desecrated.positiveWeightTiers) coverageProblems.push('亵渎词缀正权重池为空');
  if (coverageProblems.length) {
    throw new Error(`严格词缀池覆盖不足：${coverageProblems.join('；')}。审计统计：${JSON.stringify(counts)}`);
  }
  return { counts, summary };
}

function validateAndCount(snapshotRoot) {
  const manifestPath = path.join(snapshotRoot, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (manifest.status !== 'ready' || manifest.strictBasePools !== true) throw new Error('快照未声明严格底材池。');
  const index = readJson(path.join(snapshotRoot, 'by-base', 'index.json'));
  const baseNames = Object.keys(index);
  if (baseNames.length < 60) throw new Error('严格底材池数量不足。');
  let modifierPools = 0;
  let modifierTiers = 0;
  let positiveWeightTiers = 0;
  for (const [baseName, fileSlug] of Object.entries(index)) {
    const records = readJson(path.join(snapshotRoot, 'by-base', `${fileSlug}.mods.json`));
    if (!Array.isArray(records)) throw new Error(`${baseName} 的词缀池不是数组。`);
    for (const record of records) {
      if (record.base !== baseName) throw new Error(`${baseName} 池混入 ${record.base || '未知'}。`);
      if (!['PREFIX', 'SUFFIX'].includes(record.type)) throw new Error(`${baseName} 存在非显式词缀。`);
      if (!['normal', 'desecrated', 'essence', 'special'].includes(record.source)) throw new Error(`${record.name} 的来源分组无效：${record.source || '缺失'}。`);
      if (!Array.isArray(record.families) || !record.families.length) throw new Error(`${record.name} 缺少词缀组。`);
      if (!Array.isArray(record.tiers) || !record.tiers.length) throw new Error(`${record.name} 缺少 T 级。`);
      modifierPools += 1;
      modifierTiers += record.tiers.length;
      for (const tier of record.tiers) {
        if (!tier.id || !Number.isFinite(Number(tier.ilvl)) || !Number.isFinite(Number(tier.weight))) {
          throw new Error(`${record.name} 存在无效 T 级。`);
        }
        if (Number(tier.weight) > 0) positiveWeightTiers += 1;
      }
    }
  }
  const expectedBases = Number(manifest.counts?.effectiveBases || manifest.counts?.sourceBases || 0);
  if (expectedBases && baseNames.length !== expectedBases) throw new Error(`精确底材池数量不完整：${baseNames.length}/${expectedBases}。`);
  if (modifierPools < 800 || positiveWeightTiers < 8000 || modifierTiers < positiveWeightTiers) {
    throw new Error(`严格词缀池有效记录不足：词缀组 ${modifierPools}，T级 ${modifierTiers}，正权重T级 ${positiveWeightTiers}。`);
  }
  const baseItemsPath = path.join(snapshotRoot, 'base-items.json');
  const concreteBaseItems = fs.existsSync(baseItemsPath) ? readJson(baseItemsPath) : [];
  if (!Array.isArray(concreteBaseItems)) throw new Error('base-items.json 不是数组。');
  if (manifest.counts?.sourceBaseItems && concreteBaseItems.length !== Number(manifest.counts.sourceBaseItems)) {
    throw new Error(`具体基底索引不完整：${concreteBaseItems.length}/${manifest.counts.sourceBaseItems}。`);
  }
  const baseMetadata = readJson(path.join(snapshotRoot, 'base-metadata.json'));
  const representedSourceBaseIds = new Set(Object.values(baseMetadata).map((entry) => String(entry?.sourceBaseId || '')).filter(Boolean));
  const concreteIds = new Set();
  for (const item of concreteBaseItems) {
    const itemId = String(item?.sourceBaseItemId || '');
    const sourceBaseId = String(item?.resolvedSourceBaseId || item?.sourceBaseId || '');
    if (!itemId || !String(item?.name || '').trim()) throw new Error('具体基底存在空 ID 或名称。');
    if (concreteIds.has(itemId)) throw new Error(`具体基底 ID 重复：${itemId}。`);
    concreteIds.add(itemId);
    if (!representedSourceBaseIds.has(sourceBaseId)) throw new Error(`具体基底 ${item.name} 引用了没有精确池的底材 ${sourceBaseId}。`);
  }

  const essencesPath = path.join(snapshotRoot, 'essences.json');
  const socketablesPath = path.join(snapshotRoot, 'socketables.json');
  const normalizedEssences = fs.existsSync(essencesPath) ? readJson(essencesPath) : [];
  const normalizedSocketables = fs.existsSync(socketablesPath) ? readJson(socketablesPath) : [];
  if (!Array.isArray(normalizedEssences) || !Array.isArray(normalizedSocketables)) throw new Error('精华或符文索引格式错误。');
  if (manifest.counts?.sourceEssences != null && normalizedEssences.length !== Number(manifest.counts.sourceEssences)) throw new Error(`精华索引不完整：${normalizedEssences.length}/${manifest.counts.sourceEssences}。`);
  if (manifest.counts?.sourceSocketables != null && normalizedSocketables.length !== Number(manifest.counts.sourceSocketables)) throw new Error(`符文索引不完整：${normalizedSocketables.length}/${manifest.counts.sourceSocketables}。`);
  for (const essence of normalizedEssences) if (!essence.id || !essence.name || !Array.isArray(essence.effects)) throw new Error('精华索引存在无效记录。');
  for (const socketable of normalizedSocketables) if (!socketable.id || !socketable.name || !Array.isArray(socketable.effects)) throw new Error('符文索引存在无效记录。');

  const rawSourceDirectory = manifest.files?.rawSourceDirectory;
  if (rawSourceDirectory) {
    const rawRoot = path.join(snapshotRoot, rawSourceDirectory);
    for (const sourceFile of SOURCE_FILES) {
      const rawPath = path.join(rawRoot, sourceFile.name);
      if (!fs.existsSync(rawPath)) throw new Error(`原始审计数据缺失：${sourceFile.name}。`);
      const raw = readJson(rawPath);
      if (sourceFile.name === 'summary.json') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('原始审计数据格式错误：summary.json。');
      } else if (sourceFile.shape === 'object') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`原始审计数据格式错误：${sourceFile.name}。`);
      } else if (!Array.isArray(raw)) throw new Error(`原始审计数据格式错误：${sourceFile.name}。`);
    }
    const rawSummary = readJson(path.join(rawRoot, 'summary.json'));
    const rawCounts = {
      sourceBases: readJson(path.join(rawRoot, 'bases.json')).length,
      sourceBaseItems: readJson(path.join(rawRoot, 'base_items.json')).length,
      sourceModifiers: readJson(path.join(rawRoot, 'modifiers.json')).length,
      sourceModifierTypes: readJson(path.join(rawRoot, 'modifier_types.json')).length,
      sourceModifierGroups: readJson(path.join(rawRoot, 'modifier_groups.json')).length,
      sourceTierRows: readJson(path.join(rawRoot, 'modifier_tiers.json')).length,
      sourceLanguageBases: Object.keys(readJson(path.join(rawRoot, 'lang_base.json'))).length,
      sourceLanguageModifiers: Object.keys(readJson(path.join(rawRoot, 'lang_mod.json'))).length,
      sourceEssences: readJson(path.join(rawRoot, 'essences.json')).length,
      sourceSocketables: readJson(path.join(rawRoot, 'socketables.json')).length
    };
    for (const [key, actual] of Object.entries(rawCounts)) {
      if (manifest.counts?.[key] != null && Number(manifest.counts[key]) !== actual) {
        throw new Error(`原始审计数据与清单不一致：${key} ${actual}/${manifest.counts[key]}。`);
      }
    }
    if (rawSummary?.counts?.bases != null && Number(rawSummary.counts.bases) !== rawCounts.sourceBases) {
      throw new Error(`summary.json 与 bases.json 数量不一致：${rawSummary.counts.bases}/${rawCounts.sourceBases}。`);
    }
    if (rawSummary?.counts?.language_bases != null && Number(rawSummary.counts.language_bases) !== rawCounts.sourceLanguageBases) {
      throw new Error(`summary.json 与 lang_base.json 数量不一致：${rawSummary.counts.language_bases}/${rawCounts.sourceLanguageBases}。`);
    }
    if (rawSummary?.counts?.language_mods != null && Number(rawSummary.counts.language_mods) !== rawCounts.sourceLanguageModifiers) {
      throw new Error(`summary.json 与 lang_mod.json 数量不一致：${rawSummary.counts.language_mods}/${rawCounts.sourceLanguageModifiers}。`);
    }
    if (rawSummary?.counts?.essences != null && Number(rawSummary.counts.essences) !== rawCounts.sourceEssences) throw new Error(`summary.json 与 essences.json 数量不一致：${rawSummary.counts.essences}/${rawCounts.sourceEssences}。`);
    if (rawSummary?.counts?.socketables != null && Number(rawSummary.counts.socketables) !== rawCounts.sourceSocketables) throw new Error(`summary.json 与 socketables.json 数量不一致：${rawSummary.counts.socketables}/${rawCounts.sourceSocketables}。`);
  }
  return { exactBasePools: baseNames.length, modifierPools, modifierTiers, positiveWeightTiers, concreteBaseItems: concreteBaseItems.length };
}

async function updateFullData(options = {}) {
  const destinationRoot = path.resolve(options.destinationRoot || DEFAULT_ROOT);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const parent = path.dirname(destinationRoot);
  const errorRoot = path.resolve(options.errorRoot || parent);
  fs.mkdirSync(parent, { recursive: true });
  let temporary = null;
  const downloaded = {};
  const errors = [];
  try {
    temporary = createTemporaryWorkspace(options, parent);
    const sourceRoot = path.join(temporary, 'source-downloads');
    const preferredCommit = options.sourceCommit || await resolveSourceCommit();
    if (!/^[0-9a-f]{40}$/i.test(preferredCommit)) throw new Error('无法解析 Craft of Exile 数据提交版本。');
    const candidateCommits = options.sourceCommit
      ? [preferredCommit]
      : [...new Set([preferredCommit, FALLBACK_COE_DATA_COMMIT])];
    const sourceAttemptErrors = [];
    let sourceCommit = null;

    // 当前 main 提交下载不完整时，整组回退到已核验提交；绝不逐文件混合版本。
    for (const candidateCommit of candidateCommits) {
      removeWithRetry(sourceRoot);
      fs.mkdirSync(sourceRoot, { recursive: true });
      for (const key of Object.keys(downloaded)) delete downloaded[key];
      try {
        for (let index = 0; index < SOURCE_FILES.length; index += 1) {
          const file = SOURCE_FILES[index];
          const target = path.join(sourceRoot, file.name);
          onProgress({ phase: 'download', index: index + 1, total: SOURCE_FILES.length, name: file.name, sourceCommit: candidateCommit });
          const result = await downloadSourceFile(candidateCommit, file, target);
          downloaded[file.name] = { url: result.url, bytes: result.bytes, sha256: sha256File(target), failedMirrors: result.attempts };
        }
        sourceCommit = candidateCommit;
        break;
      } catch (error) {
        sourceAttemptErrors.push(`${candidateCommit}: ${error.message}`);
        onProgress({ phase: 'source-fallback', sourceCommit: candidateCommit, error: error.message });
      }
    }
    if (!sourceCommit) {
      errors.push(...sourceAttemptErrors);
      throw new Error(`所有一致版本的来源快照均下载失败：${sourceAttemptErrors.join('；')}`);
    }

    onProgress({ phase: 'normalize', total: SOURCE_FILES.length, sourceCommit });
    const normalized = normalizeCraftOfExileData(sourceRoot, temporary);
    let chronicle = {
      schemaVersion: 1,
      source: 'poe2db.tw/cn',
      generatedAt: new Date().toISOString(),
      counts: { targets: 0, matched: 0, unresolved: 0, reused: 0, fetched: 0, failed: 0 },
      records: {},
      failures: {}
    };
    const chroniclePath = path.join(temporary, 'chronicle-zh.json');
    if (options.chronicleEnabled === true) {
      const targets = buildChronicleTargets(
        readJson(path.join(temporary, 'base-items.json')),
        readJson(path.join(temporary, 'essences.json')),
        readJson(path.join(temporary, 'socketables.json')),
        {
        includeBaseItems: options.chronicleIncludeBaseItems !== false,
        includeLegacy: options.chronicleIncludeLegacy === true
      });
      chronicle = await syncChronicleLocalization({
        targets,
        destination: chroniclePath,
        previousPath: options.chronicleCachePath || null,
        concurrency: options.chronicleConcurrency || 4,
        retries: options.chronicleRetries == null ? 1 : options.chronicleRetries,
        timeout: options.chronicleTimeout || 25_000,
        force: options.chronicleForce === true,
        fetchText: options.chronicleFetchText,
        onProgress
      });
    } else {
      fs.writeFileSync(chroniclePath, `${JSON.stringify(chronicle, null, 2)}
`, 'utf8');
    }
    const rawSourceRoot = path.join(temporary, 'raw-source');
    renameWithRetry(sourceRoot, rawSourceRoot);
    const sourceMetadata = {
      repository: COE_DATA_REPOSITORY,
      commit: sourceCommit,
      directSource: normalized.summary.source || 'https://www.craftofexile.com/?game=poe2',
      craftOfExileVersion: normalized.summary.current_version || null,
      fetchedAtUtc: normalized.summary.fetched_at_utc || null,
      sourceCounts: normalized.summary.counts || null,
      caveat: normalized.summary.caveat || 'PoE2 weightings are community inferred.',
      downloaded,
      sourceAttemptErrors,
      rawSourceDirectory: 'raw-source',
      rawSourceFiles: SOURCE_FILES.map((entry) => entry.name)
    };
    fs.writeFileSync(path.join(temporary, 'source-metadata.json'), JSON.stringify(sourceMetadata, null, 2));

    const manifest = {
      schemaVersion: 2,
      status: 'ready',
      strictBasePools: true,
      updatedAt: new Date().toISOString(),
      source: 'Craft of Exile exact probability graph + PoE2DB CN Chronicle display layer',
      sourceCommit,
      sourceVersion: normalized.summary.current_version || null,
      counts: { ...normalized.counts, chronicleTargets: chronicle.counts?.targets || 0, chronicleMatched: chronicle.counts?.matched || 0, chronicleUnresolved: chronicle.counts?.unresolved || 0 },
      files: { byBaseIndex: 'by-base/index.json', baseMetadata: 'base-metadata.json', baseItems: 'base-items.json', modifierGroups: 'modifier-groups.json', essences: 'essences.json', socketables: 'socketables.json', chronicleChinese: 'chronicle-zh.json', sourceMetadata: 'source-metadata.json', rawSourceDirectory: 'raw-source' },
      errors: []
    };
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(temporary, 'README.md'), '# PoE2 strict crafting snapshot\n\n概率、T级和精确底材关系来自 Craft of Exile 数据图；具体基底、精华、符文、灵魂核心和预兆的中文名称/物品说明由 poe2db.tw/cn（流亡2编年史）覆盖，写入 chronicle-zh.json。未在编年史匹配的专有名称保留来源英文，禁止用机器翻译伪造中文。\n');

    const verified = validateAndCount(temporary);
    manifest.counts = { ...manifest.counts, ...verified };
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2));

    onProgress({ phase: 'install', counts: manifest.counts, destinationRoot });
    installSnapshotDirectory(temporary, destinationRoot);
    removeWithRetry(temporary);
    temporary = null;
    onProgress({ phase: 'done', counts: manifest.counts, destinationRoot });
    return manifest;
  } catch (error) {
    if (temporary) {
      try { removeWithRetry(temporary); } catch (_cleanupError) { /* 不覆盖原错误。 */ }
    }
    const failure = {
      schemaVersion: 2,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      destinationRoot,
      errors: errors.length ? errors : [error.message]
    };
    writeFailureRecord(errorRoot, failure);
    throw error;
  }
}

if (require.main === module) {
  updateFullData({
    destinationRoot: process.argv[2] || DEFAULT_ROOT,
    chronicleEnabled: true,
    chronicleIncludeBaseItems: true,
    onProgress: (event) => {
      if (event.phase === 'download') console.log(`[${event.index}/${event.total}] 下载 ${event.name}`);
      else if (event.phase === 'normalize') console.log('正在按精确底材重建词缀池……');
      else if (event.phase === 'chronicle-start') console.log(`正在同步流亡2编年史中文：${event.pending} 个待更新，${event.cached} 个缓存命中`);
      else if (event.phase === 'chronicle') console.log(`编年史中文 ${event.completed}/${event.total}：${event.name}`);
      else if (event.phase === 'chronicle-done') console.log(`编年史中文完成：${JSON.stringify(event.counts)}`);
      else if (event.phase === 'done') console.log(`更新完成：${JSON.stringify(event.counts)}`);
    }
  }).catch((error) => {
    console.error(`更新失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  COE_DATA_REPOSITORY,
  FALLBACK_COE_DATA_COMMIT,
  SOURCE_FILES,
  KNOWN_BASE_ID_ALIASES,
  KNOWN_SYNTHETIC_BASES,
  slug,
  inferSyntheticBaseName,
  buildEffectiveBaseGraph,
  normalizeFamilies,
  normalizeModifierSource,
  inferModifierTags,
  flattenNestedEssenceEffects,
  normalizeEssenceRecords,
  normalizeSocketableRecords,
  buildChronicleTargets,
  normalizeCraftOfExileData,
  validateAndCount,
  requestBuffer,
  writeBufferAtomic,
  downloadToFile,
  sourceUrls,
  downloadSourceFile,
  resolveSourceCommit,
  createTemporaryWorkspace,
  installSnapshotDirectory,
  removeWithRetry,
  updateFullData
};
