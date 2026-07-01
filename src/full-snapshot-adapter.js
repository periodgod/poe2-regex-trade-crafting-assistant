'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateDataV2, summarizeDataV2 } = require('./crafting-data-repository');
const { localizeBaseName, localizeModifierName } = require('./zh-localization');
const { loadChronicleIndex, findChronicleRecord } = require('./chronicle-zh');

let cache = null;

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'unknown';
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 18)}`;
}

function buildIndexes(data) {
  return {
    baseById: new Map(data.bases.map((record) => [record.id, record])),
    modifierById: new Map(data.modifiers.map((record) => [record.id, record])),
    currencyById: new Map(data.currencies.map((record) => [record.id, record])),
    omenById: new Map(data.omens.map((record) => [record.id, record])),
    mechanicById: new Map((data.mechanics || []).map((record) => [record.id, record])),
    essenceById: new Map((data.essences || []).map((record) => [record.id, record])),
    socketableById: new Map((data.socketables || []).map((record) => [record.id, record]))
  };
}

function classTags(itemClass, baseName, sourceBaseId = null) {
  const text = `${itemClass || ''} ${baseName || ''}`.toLowerCase();
  const sourceId = String(sourceBaseId || '');
  const tags = [`pool_${slug(baseName)}`, `class_${slug(itemClass)}`];
  if (/bow|crossbow|sword|axe|mace|staff|wand|sceptre|spear|flail|dagger|claw|quarterstaff|talisman/.test(text)) tags.push('weapon');
  if (/quiver/.test(text)) tags.push('quiver');
  if (/jewel|diamond|emerald|ruby|sapphire/.test(text)) tags.push('jewel');
  if (/body armour|boots|gloves|helmet|shield|buckler|foci|focus/.test(text)) tags.push('armour');
  if (/ring|amulet|belt/.test(text)) tags.push('jewellery');
  if (/shield|buckler|quiver|foci|focus/.test(text)) tags.push('offhand');
  // Craft of Exile 将路石按等级段建池，池名是 Low/Mid/Top/Uber Tier，
  // 并不一定包含 Waystone 单词；233/234/235/245 是这些精确来源底材 ID。
  if (/waystone/.test(text) || ['233', '234', '235', '245'].includes(sourceId)) tags.push('waystone');
  return [...new Set(tags)];
}


function concreteAffixLimits(englishImplicits = [], defaultPrefixes = 3, defaultSuffixes = 3) {
  let maxPrefixes = Number(defaultPrefixes) || 3;
  let maxSuffixes = Number(defaultSuffixes) || 3;
  const adjustments = [];
  for (const line of Array.isArray(englishImplicits) ? englishImplicits : []) {
    const text = String(line || '').trim();
    let match = text.match(/^([+-]\d+)\s+Prefix Modifiers? allowed$/i);
    if (match) {
      const amount = Number(match[1]);
      maxPrefixes = Math.max(0, maxPrefixes + amount);
      adjustments.push({ side: 'prefix', amount, source: text });
      continue;
    }
    match = text.match(/^([+-]\d+)\s+Suffix Modifiers? allowed$/i);
    if (match) {
      const amount = Number(match[1]);
      maxSuffixes = Math.max(0, maxSuffixes + amount);
      adjustments.push({ side: 'suffix', amount, source: text });
      continue;
    }
    match = text.match(/^Can have up to (\d+) Prefix Modifiers?$/i);
    if (match) {
      maxPrefixes = Math.max(0, Number(match[1]));
      adjustments.push({ side: 'prefix', absolute: maxPrefixes, source: text });
      continue;
    }
    match = text.match(/^Can have up to (\d+) Suffix Modifiers?$/i);
    if (match) {
      maxSuffixes = Math.max(0, Number(match[1]));
      adjustments.push({ side: 'suffix', absolute: maxSuffixes, source: text });
    }
  }
  return { maxPrefixes, maxSuffixes, adjustments };
}

function manifestSignature(snapshotRoot) {
  const paths = [
    path.join(snapshotRoot, 'manifest.json'),
    path.join(snapshotRoot, 'by-base', 'index.json'),
    path.join(snapshotRoot, 'base-items.json'),
    path.join(snapshotRoot, 'essences.json'),
    path.join(snapshotRoot, 'socketables.json'),
    path.join(snapshotRoot, 'chronicle-zh.json')
  ].filter((filePath) => fs.existsSync(filePath));
  return paths.map((filePath) => {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  }).join('|');
}

function readExactPoolFiles(snapshotRoot) {
  const indexPath = path.join(snapshotRoot, 'by-base', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (!index || typeof index !== 'object' || Array.isArray(index) || !Object.keys(index).length) {
    throw new Error('by-base/index.json 不是非空底材映射。');
  }
  const pools = [];
  for (const [baseName, fileSlug] of Object.entries(index)) {
    if (!baseName || !/^[a-z0-9_]+$/i.test(fileSlug)) throw new Error(`无效底材池映射：${baseName}`);
    const filePath = path.join(snapshotRoot, 'by-base', `${fileSlug}.mods.json`);
    const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(records)) throw new Error(`${fileSlug}.mods.json 不是数组。`);
    for (const record of records) {
      if (record?.base !== baseName) {
        throw new Error(`${fileSlug}.mods.json 混入其他底材池：预期 ${baseName}，实际 ${record?.base || '缺失'}`);
      }
    }
    pools.push({ baseName, fileSlug, records });
  }
  return pools;
}

function loadFullSnapshotDataV2Sync(snapshotRoot, metadataData) {
  const signature = `${path.resolve(snapshotRoot)}:${manifestSignature(snapshotRoot)}`;
  if (cache?.signature === signature) return cache.data;

  const manifest = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'ready') throw new Error(`完整快照状态不是 ready：${manifest.status || 'missing'}`);
  if (manifest.strictBasePools !== true) throw new Error('快照未声明 strictBasePools=true。');

  const chronicleIndex = loadChronicleIndex(snapshotRoot);
  const chronicleCounts = chronicleIndex.payload?.counts || { targets: 0, matched: 0, unresolved: 0 };
  const chronicleFor = (kind, englishName, sourceId = null) => findChronicleRecord(chronicleIndex, kind, englishName, sourceId);

  let baseMetadata = {};
  let concreteBaseItems = [];
  let rawEssences = [];
  let rawSocketables = [];
  try { baseMetadata = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'base-metadata.json'), 'utf8')); } catch (_error) { baseMetadata = {}; }
  try { concreteBaseItems = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'base-items.json'), 'utf8')); } catch (_error) { concreteBaseItems = []; }
  try { rawEssences = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'essences.json'), 'utf8')); } catch (_error) { rawEssences = []; }
  try { rawSocketables = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'socketables.json'), 'utf8')); } catch (_error) { rawSocketables = []; }
  if (!Array.isArray(concreteBaseItems)) throw new Error('base-items.json 必须是数组。');
  if (!Array.isArray(rawEssences) || !Array.isArray(rawSocketables)) throw new Error('essences.json 或 socketables.json 必须是数组。');
  const itemsBySourceBaseId = new Map();
  for (const item of concreteBaseItems) {
    const sourceBaseId = String(item?.resolvedSourceBaseId || item?.sourceBaseId || '');
    if (!sourceBaseId || !item?.name) continue;
    if (!itemsBySourceBaseId.has(sourceBaseId)) itemsBySourceBaseId.set(sourceBaseId, []);
    itemsBySourceBaseId.get(sourceBaseId).push(item);
  }
  const exactPools = readExactPoolFiles(snapshotRoot);
  const representedSourceBaseIds = new Set(Object.values(baseMetadata).map((entry) => String(entry?.sourceBaseId || '')).filter(Boolean));
  const baseItemIds = new Set();
  for (const item of concreteBaseItems) {
    const id = String(item?.sourceBaseItemId || '');
    const sourceBaseId = String(item?.resolvedSourceBaseId || item?.sourceBaseId || '');
    if (!id || !item?.name) throw new Error('base-items.json 存在缺少 ID 或名称的具体基底。');
    if (baseItemIds.has(id)) throw new Error(`base-items.json 的具体基底 ID 重复：${id}`);
    baseItemIds.add(id);
    if (!representedSourceBaseIds.has(sourceBaseId)) throw new Error(`具体基底 ${item.name} 引用了未建立精确池的底材 ID ${sourceBaseId}。`);
  }
  const bases = [];
  const modifiers = [];
  const baseByPool = new Map();
  const dropped = { unsupportedType: 0, noPositiveWeightTier: 0, malformed: 0 };
  const sourceBreakdown = { normal: 0, desecrated: 0, essence: 0, special: 0 };

  for (const pool of exactPools) {
    const first = pool.records.find((record) => record?.itemClass) || {};
    const localizedBaseName = localizeBaseName(pool.baseName);
    const sourceBase = baseMetadata[pool.baseName] || {};
    const sourceBaseId = String(sourceBase.sourceBaseId || first.sourceBaseId || '');
    const baseItems = (itemsBySourceBaseId.get(sourceBaseId) || []).map((item) => {
      const englishImplicits = Array.isArray(item.implicits) ? item.implicits : [];
      const limits = concreteAffixLimits(englishImplicits, 3, 3);
      return {
        id: item.sourceBaseItemId || null,
        sourceBaseId: item.sourceBaseId || null,
        resolvedSourceBaseId: item.resolvedSourceBaseId || sourceBaseId || null,
        sourceBaseResolution: item.sourceBaseResolution || 'direct',
        name: chronicleFor('base-item', item.name, item.sourceBaseItemId)?.zhName || item.name,
        englishName: item.name,
        chronicleDescriptionLines: chronicleFor('base-item', item.name, item.sourceBaseItemId)?.descriptionLines || [],
        chronicleSourceUrl: chronicleFor('base-item', item.name, item.sourceBaseItemId)?.sourceUrl || null,
        localizationSource: chronicleFor('base-item', item.name, item.sourceBaseItemId) ? 'poe2db.tw/cn' : 'upstream-english',
        dropLevel: Number(item.dropLevel || 0),
        properties: item.properties || null,
        requirements: item.requirements || null,
        implicits: englishImplicits.map((line, index) => localizeModifierName(line, `${item.sourceBaseItemId || 'base'}-implicit-${index + 1}`)),
        englishImplicits,
        maxPrefixes: limits.maxPrefixes,
        maxSuffixes: limits.maxSuffixes,
        affixSlotAdjustments: limits.adjustments,
        changesExplicitSlotLimits: limits.maxPrefixes !== 3 || limits.maxSuffixes !== 3,
        image: item.image || null,
        experience: Number(item.experience || 0),
        externalModifiers: item.externalModifiers || null,
        tagGroup: item.tagGroup || null,
        legacy: Boolean(item.legacy)
      };
    });
    const base = {
      id: `snapshot_${slug(pool.baseName)}`,
      name: localizedBaseName,
      englishName: pool.baseName,
      class: first.itemClass || 'Equipment',
      tags: [...new Set([
        ...classTags(first.itemClass, pool.baseName, sourceBaseId),
        sourceBase.isJewellery ? 'jewellery' : null,
        sourceBase.isMartial ? 'martial' : null
      ].filter(Boolean))],
      maxPrefixes: 3,
      maxSuffixes: 3,
      domain: 'item',
      source: 'full-snapshot-exact-pool',
      sourcePool: pool.baseName,
      sourceFile: `by-base/${pool.fileSlug}.mods.json`,
      sourceBaseId: sourceBaseId || null,
      concreteBaseItemCount: baseItems.length || Number(sourceBase.concreteBaseItemCount || 0),
      concreteBaseItems: baseItems,
      aliases: [...new Set([pool.baseName, localizedBaseName, ...baseItems.flatMap((item) => [item.name, item.englishName])].filter(Boolean))]
    };
    bases.push(base);
    baseByPool.set(pool.baseName, base);

    for (const raw of pool.records) {
      if (!raw || !raw.name || !Array.isArray(raw.tiers)) {
        dropped.malformed += 1;
        continue;
      }
      const type = String(raw.type || '').toLowerCase();
      if (!['prefix', 'suffix'].includes(type)) {
        dropped.unsupportedType += 1;
        continue;
      }
      const tiers = raw.tiers
        .map((tier) => ({
          tier: Number(tier.tier),
          level: Number(tier.ilvl ?? tier.spawnLvl ?? 0),
          spawnLevel: Number(tier.spawnLvl ?? tier.ilvl ?? 0),
          weight: Number(tier.weight),
          tierName: tier.tierName || '',
          externalId: tier.id || '',
          ranges: Array.isArray(tier.ranges) ? tier.ranges : [],
          min: Array.isArray(tier.ranges?.[0]) ? tier.ranges[0][0] : null,
          max: Array.isArray(tier.ranges?.[0]) ? tier.ranges[0][1] : null,
          weightSource: tier.weightSource || 'craftofexile-inferred'
        }))
        .filter((tier) =>
          Number.isInteger(tier.tier) && tier.tier >= 1 &&
          Number.isFinite(tier.level) && tier.level >= 0 &&
          Number.isFinite(tier.weight) && tier.weight > 0 &&
          tier.externalId
        );
      if (!tiers.length) {
        dropped.noPositiveWeightTier += 1;
        continue;
      }
      const families = Array.isArray(raw.families) && raw.families.length
        ? [...new Set(raw.families.map(String).filter(Boolean))]
        : [`family_${stableId('', `${pool.baseName}|${raw.name}`).replace(/^_/, '')}`];
      const family = families[0];
      const source = ['normal', 'desecrated', 'essence', 'special'].includes(raw.source) ? raw.source : 'special';
      const key = `${pool.baseName}|${source}|${type}|${raw.sourceModifierId || raw.name}`;
      sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
      const localizedModifierName = localizeModifierName(raw.name, raw.sourceModifierId || '');
      modifiers.push({
        id: stableId('snapshot_mod', key),
        name: localizedModifierName,
        englishName: raw.name,
        family,
        families,
        type,
        source,
        exclusiveDesecrated: Boolean(raw.exclusiveDesecrated || source === 'desecrated'),
        // 精确底材 ID 是第一准入条件。标签仅用于展示，不参与跨池继承。
        allowedBaseIds: [base.id],
        allowedBaseTags: [],
        excludedBaseTags: [],
        tiers,
        sourceMeta: {
          normalizedPool: pool.baseName,
          itemClass: raw.itemClass || base.class,
          sourceFile: base.sourceFile,
          snapshotUpdatedAt: manifest.updatedAt || null,
          weightSource: 'craftofexile-inferred-exact-base-pool',
          sourceBaseId: raw.sourceBaseId || base.sourceBaseId || null,
          sourceModifierId: raw.sourceModifierId || null,
          sourceGroupId: raw.sourceGroupId || null,
          sourceGroupName: raw.sourceGroupName || null,
          tags: Array.isArray(raw.tags) ? raw.tags : []
        }
      });
    }
  }


  const baseBySourceId = new Map(bases.map((base) => [String(base.sourceBaseId || ''), base]));
  const modifierBySourceKey = new Map();
  for (const modifier of modifiers) {
    const sourceBaseId = String(modifier.sourceMeta?.sourceBaseId || '');
    const sourceModifierId = String(modifier.sourceMeta?.sourceModifierId || '');
    if (sourceBaseId && sourceModifierId) modifierBySourceKey.set(`${sourceBaseId}|${sourceModifierId}`, modifier);
  }
  const essences = rawEssences.map((essence) => {
    const chronicle = chronicleFor('essence', essence.name, essence.id);
    return {
      id: `essence_${essence.id}`,
      sourceId: essence.id,
      name: chronicle?.zhName || essence.name,
      englishName: essence.name,
      chronicleDescriptionLines: chronicle?.descriptionLines || [],
      chronicleSourceUrl: chronicle?.sourceUrl || null,
      localizationSource: chronicle ? 'poe2db.tw/cn' : 'upstream-english',
      corrupted: Boolean(essence.corrupted),
      mode: essence.corrupted ? '稀有物品：移除一个随机显式词缀并加入保证词缀' : '魔法物品：升级为稀有并加入保证词缀',
      tooltip: chronicle?.descriptionLines?.length ? chronicle.descriptionLines : (essence.tooltip || []).map(String),
      effects: (essence.effects || []).map((effect) => {
        const base = baseBySourceId.get(String(effect.resolvedSourceBaseId || effect.sourceBaseId || '')) || null;
        const modifier = base ? modifierBySourceKey.get(`${base.sourceBaseId}|${effect.sourceModifierId}`) : null;
        return {
          baseId: base?.id || null,
          baseName: base?.name || `来源底材编号 ${effect.resolvedSourceBaseId || effect.sourceBaseId || '?'}`,
          sourceBaseId: effect.sourceBaseId || null,
          resolvedSourceBaseId: effect.resolvedSourceBaseId || null,
          modifierId: modifier?.id || null,
          modifierName: modifier?.name || effect.sourceModifierName || `来源词缀 ${effect.sourceModifierId || '?'}`,
          modifierLevel: Number(effect.modifierLevel || 0),
          sourceModifierId: effect.sourceModifierId || null
        };
      }).filter((effect) => effect.baseId)
    };
  }).filter((essence) => essence.effects.length);

  const socketables = rawSocketables.map((entry) => {
    const chronicle = chronicleFor('socketable', entry.name, entry.id);
    return {
      id: `socketable_${entry.id}`,
      sourceId: entry.id,
      type: entry.type,
      name: chronicle?.zhName || entry.name,
      englishName: entry.name,
      chronicleDescriptionLines: chronicle?.descriptionLines || [],
      chronicleSourceUrl: chronicle?.sourceUrl || null,
      localizationSource: chronicle ? 'poe2db.tw/cn' : 'upstream-english',
      image: entry.image || null,
      effects: (entry.effects || []).map((effect) => {
        let compatibleBases = [];
        if (effect.scope === 'class') {
          compatibleBases = (effect.resolvedSourceBaseIds || []).map((id) => baseBySourceId.get(String(id))).filter(Boolean);
        } else if (effect.scope === 'all') compatibleBases = [...bases];
        else if (effect.scope === 'armour') compatibleBases = bases.filter((base) => base.tags.includes('armour'));
        else if (effect.scope === 'weapons') compatibleBases = bases.filter((base) => base.tags.includes('weapon'));
        else if (effect.scope === 'caster') compatibleBases = bases.filter((base) => /魔杖|法杖|权杖|法器|Wand|Staff|Sceptre|Focus/i.test(`${base.name} ${base.englishName || ''}`));
        return {
          scope: effect.scope,
          sourceModifierId: effect.sourceModifierId,
          modifierName: effect.sourceModifierName || `来源词缀 ${effect.sourceModifierId || '?'}`,
          compatibleBaseIds: [...new Set(compatibleBases.map((base) => base.id))]
        };
      }).filter((effect) => effect.compatibleBaseIds.length)
    };
  }).filter((entry) => entry.effects.length);

  const omens = (metadataData.omens || []).map((omen) => {
    const chronicle = chronicleFor('omen', omen.englishName, omen.id);
    return {
      ...omen,
      name: chronicle?.zhName || omen.name || omen.englishName,
      description: chronicle?.descriptionLines?.length ? chronicle.descriptionLines.join('；') : omen.description,
      ruleDescription: omen.description || '',
      chronicleDescriptionLines: chronicle?.descriptionLines || [],
      chronicleSourceUrl: chronicle?.sourceUrl || omen.sourceUrl || null,
      localizationSource: chronicle ? 'poe2db.tw/cn' : (omen.name ? 'bundled-cn' : 'upstream-english')
    };
  });


  const data = {
    schemaVersion: 2,
    dataVersion: `strict-snapshot-${manifest.updatedAt || 'unknown'}`,
    game: 'Path of Exile 2',
    generatedAt: manifest.updatedAt || null,
    source: {
      name: 'PoE2 exact probability snapshot + Chronicle Chinese display layer',
      confidence: 'craftofexile-exact-base-graph + poe2db-cn-localization',
      notice: '概率、T级、冲突组和精确底材关系来自 Craft of Exile 数据图；具体基底、精华、符文、灵魂核心与预兆的中文名称和物品说明优先来自 poe2db.tw/cn（流亡2编年史）。编年史未匹配时保留来源英文，禁止机器翻译专有名称。'
    },
    bases,
    modifiers,
    currencies: metadataData.currencies || [],
    omens,
    rules: metadataData.rules || [],
    localization: metadataData.localization || [],
    mechanics: metadataData.mechanics || [],
    essences,
    socketables,
    documents: metadataData.documents || {},
    root: snapshotRoot,
    snapshotAdapterSummary: {
      exactBasePoolCount: exactPools.length,
      rawModifierPoolCount: exactPools.reduce((sum, pool) => sum + pool.records.length, 0),
      importedModifierPoolCount: modifiers.length,
      importedTierCount: modifiers.reduce((sum, modifier) => sum + modifier.tiers.length, 0),
      concreteBaseItemCount: concreteBaseItems.length,
      essenceCount: essences.length,
      socketableCount: socketables.length,
      emptyBasePoolCount: exactPools.filter((pool) => pool.records.length === 0).length,
      sourceBreakdown,
      chronicle: {
        source: chronicleIndex.payload?.source || 'poe2db.tw/cn',
        targets: Number(chronicleCounts.targets || 0),
        matched: Number(chronicleCounts.matched || 0),
        unresolved: Number(chronicleCounts.unresolved || 0),
        generatedAt: chronicleIndex.payload?.generatedAt || null
      },
      dropped
    }
  };

  const validation = validateDataV2(data);
  if (!validation.ok) throw new Error(`完整快照适配失败：${validation.errors.slice(0, 20).join('；')}`);
  data.indexes = buildIndexes(data);
  cache = { signature, data };
  return data;
}

function summarizeFullSnapshotData(data) {
  return { ...summarizeDataV2(data), snapshotAdapterSummary: data.snapshotAdapterSummary || null };
}

function clearFullSnapshotCache() {
  cache = null;
}

module.exports = {
  slug,
  stableId,
  classTags,
  concreteAffixLimits,
  readExactPoolFiles,
  loadFullSnapshotDataV2Sync,
  summarizeFullSnapshotData,
  clearFullSnapshotCache
};
