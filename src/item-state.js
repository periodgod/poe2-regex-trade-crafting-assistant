'use strict';

const VALID_RARITIES = new Set(['normal', 'magic', 'rare', 'unique']);
const VALID_AFFIX_TYPES = new Set(['prefix', 'suffix', 'implicit', 'corrupted']);
const VALID_SOURCES = new Set(['normal', 'essence', 'desecrated', 'corrupted', 'implicit', 'unknown', 'special']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function indexesFor(data) {
  return data.indexes || {
    baseById: new Map((data.bases || []).map((entry) => [entry.id, entry])),
    modifierById: new Map((data.modifiers || []).map((entry) => [entry.id, entry])),
    omenById: new Map((data.omens || []).map((entry) => [entry.id, entry]))
  };
}

function modifierFamilies(modifier) {
  const values = Array.isArray(modifier?.families) && modifier.families.length
    ? modifier.families
    : [modifier?.family];
  return [...new Set(values.map(String).filter(Boolean))];
}

function affixFamilies(affix) {
  const values = Array.isArray(affix?.families) && affix.families.length
    ? affix.families
    : [affix?.family];
  return [...new Set(values.map(String).filter(Boolean))];
}

function modifierAllowedOnBase(modifier, base) {
  const allowedIds = Array.isArray(modifier?.allowedBaseIds) ? modifier.allowedBaseIds : [];
  if (allowedIds.length) return allowedIds.includes(base?.id);
  const tags = new Set(base?.tags || []);
  const required = modifier?.allowedBaseTags || [];
  const excluded = modifier?.excludedBaseTags || [];
  if (excluded.some((tag) => tags.has(tag))) return false;
  return !required.length || required.some((tag) => tags.has(tag));
}


function effectiveAffixLimits(state, base) {
  const metadata = state?.metadata && typeof state.metadata === 'object' ? state.metadata : {};
  const prefixOverride = Number(metadata.maxPrefixes);
  const suffixOverride = Number(metadata.maxSuffixes);
  const maxPrefixes = Number.isInteger(prefixOverride) && prefixOverride >= 0
    ? prefixOverride
    : Math.max(0, Number(base?.maxPrefixes ?? 3));
  const maxSuffixes = Number.isInteger(suffixOverride) && suffixOverride >= 0
    ? suffixOverride
    : Math.max(0, Number(base?.maxSuffixes ?? 3));
  return { maxPrefixes, maxSuffixes };
}

function normalizeTier(modifier, tierNumber, itemLevel) {
  const tiers = (modifier?.tiers || [])
    .filter((tier) => Number(tier.level) <= Number(itemLevel))
    .sort((left, right) => Number(left.tier) - Number(right.tier));
  if (!tiers.length) throw new Error(`词缀 ${modifier?.id || '?'} 在物等 ${itemLevel} 不可用。`);
  const requested = tierNumber == null || tierNumber === '' ? null : Number(tierNumber);
  // T1 是最高级。导入文本缺少 T 级时，选择当前物等可用的最高级，并显式标记为推定。
  const selected = Number.isInteger(requested)
    ? tiers.find((tier) => Number(tier.tier) === requested)
    : tiers[0];
  if (!selected) throw new Error(`词缀 ${modifier.id} 不存在 T${tierNumber} 或当前物等不足。`);
  return selected;
}

function normalizePlaceholder(raw, index) {
  const type = String(raw.type || '').toLowerCase();
  if (!['prefix', 'suffix'].includes(type)) throw new Error('占位词缀必须明确标记为前缀或后缀。');
  const unrevealed = Boolean(raw.unrevealed || raw.unrevealedDesecrated);
  const source = unrevealed ? 'desecrated' : String(raw.source || 'unknown');
  if (!VALID_SOURCES.has(source)) throw new Error(`占位词缀来源无效：${source}`);
  return {
    instanceId: String(raw.instanceId || `${unrevealed ? 'unrevealed-desecrated' : 'unknown'}-${type}#${index + 1}`),
    modifierId: null,
    name: String(raw.name || (unrevealed ? '未揭示的亵渎词缀' : (type === 'prefix' ? '未识别前缀' : '未识别后缀'))),
    family: null,
    families: [],
    type,
    tier: null,
    tierAssumed: true,
    modifierLevel: unrevealed ? 1 : null,
    source,
    poolSource: raw.poolSource || null,
    min: null,
    max: null,
    value: raw.value ?? null,
    locked: Boolean(raw.locked),
    fractured: Boolean(raw.fractured),
    unknown: true,
    unrevealed,
    metadata: {
      unresolved: !unrevealed,
      unrevealedDesecrated: unrevealed,
      ...(raw.metadata && typeof raw.metadata === 'object' ? clone(raw.metadata) : {})
    }
  };
}

function normalizeAffix(data, state, raw, index) {
  if (!raw || typeof raw !== 'object') throw new Error(`第 ${index + 1} 条词缀格式无效。`);
  if (raw.unknown === true || raw.unrevealed === true || raw.unrevealedDesecrated === true) {
    return normalizePlaceholder(raw, index);
  }
  const indexes = indexesFor(data);
  const modifier = indexes.modifierById.get(raw.modifierId || raw.id);
  if (!modifier) throw new Error(`未找到词缀：${raw.modifierId || raw.id || '?'}`);
  const base = indexes.baseById.get(state.baseId);
  if (!modifierAllowedOnBase(modifier, base)) {
    throw new Error(`词缀 ${modifier.name || modifier.id} 不属于底材 ${base?.name || state.baseId} 的精确词缀池。`);
  }
  const tier = normalizeTier(modifier, raw.tier, state.itemLevel);
  const type = raw.type || modifier.type;
  if (!VALID_AFFIX_TYPES.has(type)) throw new Error(`词缀 ${modifier.id} 的类型无效。`);
  const source = raw.source || modifier.source || 'unknown';
  if (!VALID_SOURCES.has(source)) throw new Error(`词缀 ${modifier.id} 的 source 无效：${source}`);
  return {
    instanceId: String(raw.instanceId || `${modifier.id}@T${tier.tier}#${index + 1}`),
    modifierId: modifier.id,
    name: modifier.name,
    family: modifier.family,
    families: modifierFamilies(modifier),
    type,
    tier: Number(tier.tier),
    tierAssumed: raw.tier == null,
    modifierLevel: Number(tier.level),
    source,
    poolSource: raw.poolSource || modifier.source || source,
    min: raw.min ?? tier.min ?? null,
    max: raw.max ?? tier.max ?? null,
    value: raw.value ?? null,
    locked: Boolean(raw.locked),
    fractured: Boolean(raw.fractured),
    unknown: false,
    unrevealed: false,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? clone(raw.metadata) : {}
  };
}

function createItemState(data, input = {}) {
  const indexes = indexesFor(data);
  const base = indexes.baseById.get(input.baseId || data.bases?.[0]?.id);
  if (!base) throw new Error(`未找到底材：${input.baseId || '?'}`);
  const itemLevel = Math.max(1, Math.floor(Number(input.itemLevel) || 1));
  const rarity = VALID_RARITIES.has(input.rarity) ? input.rarity : 'normal';
  const skeleton = {
    schemaVersion: 3,
    baseId: base.id,
    baseName: base.name,
    itemLevel,
    rarity,
    quality: Math.max(0, Number(input.quality) || 0),
    sockets: Math.max(0, Math.floor(Number(input.sockets) || 0)),
    supportSockets: Math.max(0, Math.floor(Number(input.supportSockets) || 0)),
    augmentSocketCapacity: Math.max(0, Math.floor(Number(input.augmentSocketCapacity ?? input.metadata?.augmentSocketCapacity) || 0)),
    installedAugments: Array.isArray(input.installedAugments)
      ? input.installedAugments.map((entry, index) => ({
        slotIndex: Math.max(0, Math.floor(Number(entry?.slotIndex) || index)),
        id: String(entry?.id || entry?.socketableId || ''),
        name: String(entry?.name || ''),
        type: String(entry?.type || 'socketable'),
        effectText: String(entry?.effectText || ''),
        sourceUrl: entry?.sourceUrl || null
      })).filter((entry) => entry.id)
      : [],
    catalyst: input.catalyst && typeof input.catalyst === 'object' ? clone(input.catalyst) : null,
    affixes: [],
    flags: {
      corrupted: Boolean(input.flags?.corrupted || input.corrupted),
      desecrated: Boolean(input.flags?.desecrated || input.desecrated),
      mirrored: Boolean(input.flags?.mirrored || input.mirrored),
      sanctified: Boolean(input.flags?.sanctified || input.sanctified)
    },
    activeOmens: Array.isArray(input.activeOmens) ? [...new Set(input.activeOmens.map(String))] : [],
    history: Array.isArray(input.history) ? clone(input.history) : [],
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {}
  };
  const rawAffixes = Array.isArray(input.affixes) ? [...input.affixes] : [];
  const unknownPrefixCount = Math.max(0, Math.floor(Number(input.unknownPrefixCount) || 0));
  const unknownSuffixCount = Math.max(0, Math.floor(Number(input.unknownSuffixCount) || 0));
  for (let index = 0; index < unknownPrefixCount; index += 1) rawAffixes.push({ unknown: true, type: 'prefix' });
  for (let index = 0; index < unknownSuffixCount; index += 1) rawAffixes.push({ unknown: true, type: 'suffix' });
  skeleton.affixes = rawAffixes.map((affix, index) => normalizeAffix(data, skeleton, affix, index));
  if (skeleton.affixes.some((affix) => affix.source === 'desecrated')) skeleton.flags.desecrated = true;
  const validation = validateItemState(data, skeleton);
  if (!validation.ok) throw new Error(`物品状态无效：${validation.errors.join('；')}`);
  return skeleton;
}

function affixCounts(state) {
  const result = {
    prefix: 0, suffix: 0, implicit: 0, corrupted: 0,
    explicit: 0, unknownPrefix: 0, unknownSuffix: 0, unknownExplicit: 0,
    desecrated: 0, unrevealedDesecrated: 0, total: state.affixes.length
  };
  for (const affix of state.affixes) {
    if (result[affix.type] != null) result[affix.type] += 1;
    if (affix.type === 'prefix' || affix.type === 'suffix') {
      result.explicit += 1;
      if (affix.source === 'desecrated') result.desecrated += 1;
      if (affix.unrevealed) result.unrevealedDesecrated += 1;
      if (affix.unknown) {
        result.unknownExplicit += 1;
        if (affix.type === 'prefix') result.unknownPrefix += 1;
        else result.unknownSuffix += 1;
      }
    }
  }
  return result;
}

function validateItemState(data, state) {
  const errors = [];
  const indexes = indexesFor(data);
  const base = indexes.baseById.get(state?.baseId);
  if (!base) errors.push(`底材不存在：${state?.baseId || '?'}`);
  if (!VALID_RARITIES.has(state?.rarity)) errors.push(`稀有度无效：${state?.rarity || '?'}`);
  if (!Number.isInteger(Number(state?.itemLevel)) || Number(state.itemLevel) < 1) errors.push('物品等级无效。');
  if (!Array.isArray(state?.affixes)) errors.push('affixes 必须是数组。');
  if (!Number.isInteger(Number(state?.augmentSocketCapacity)) || Number(state.augmentSocketCapacity) < 0) errors.push('增幅器插槽容量无效。');
  if (!Array.isArray(state?.installedAugments)) errors.push('installedAugments 必须是数组。');
  const augmentSlots = new Set();
  for (const entry of state?.installedAugments || []) {
    const slotIndex = Number(entry?.slotIndex);
    if (!Number.isInteger(slotIndex) || slotIndex < 0) errors.push('增幅器插槽编号无效。');
    if (augmentSlots.has(slotIndex)) errors.push(`增幅器插槽重复：${slotIndex + 1}`);
    augmentSlots.add(slotIndex);
    if (!entry?.id) errors.push(`第 ${slotIndex + 1} 个增幅器缺少 ID。`);
    if (Number.isInteger(slotIndex) && slotIndex >= Number(state.augmentSocketCapacity || 0)) errors.push(`增幅器插槽超出容量：${slotIndex + 1}/${state.augmentSocketCapacity}`);
  }
  const omenById = indexes.omenById || new Map((data.omens || []).map((entry) => [entry.id, entry]));
  for (const omenId of state?.activeOmens || []) {
    if (!omenById.has(omenId)) errors.push(`预兆不存在：${omenId}`);
  }
  const instanceIds = new Set();
  const families = new Set();
  for (const affix of state?.affixes || []) {
    const modifier = affix.unknown ? null : indexes.modifierById.get(affix.modifierId);
    if (!affix.unknown && !modifier) errors.push(`词缀不存在：${affix.modifierId}`);
    else if (modifier && base && !modifierAllowedOnBase(modifier, base)) errors.push(`词缀不属于当前底材池：${modifier.name || affix.modifierId}`);
    if (instanceIds.has(affix.instanceId)) errors.push(`instanceId 重复：${affix.instanceId}`);
    instanceIds.add(affix.instanceId);
    if ((affix.type === 'prefix' || affix.type === 'suffix') && !affix.unknown) {
      const ownFamilies = affixFamilies(affix);
      const conflict = ownFamilies.find((family) => families.has(family));
      if (conflict) errors.push(`词缀组冲突：${conflict}`);
      ownFamilies.forEach((family) => families.add(family));
    }
    if (!VALID_AFFIX_TYPES.has(affix.type)) errors.push(`词缀类型无效：${affix.type}`);
    if (!VALID_SOURCES.has(affix.source)) errors.push(`词缀来源无效：${affix.source}`);
    if (affix.unrevealed && affix.source !== 'desecrated') errors.push('未揭示词缀必须属于 desecrated 来源。');
  }
  if (base) {
    const counts = affixCounts(state);
    const effective = effectiveAffixLimits(state, base);
    const rarityPrefixLimit = state.rarity === 'normal' ? 0 : state.rarity === 'magic' ? Math.min(1, effective.maxPrefixes) : effective.maxPrefixes;
    const raritySuffixLimit = state.rarity === 'normal' ? 0 : state.rarity === 'magic' ? Math.min(1, effective.maxSuffixes) : effective.maxSuffixes;
    if (counts.prefix > rarityPrefixLimit) errors.push(`前缀超过 ${state.rarity} 稀有度上限：${counts.prefix}/${rarityPrefixLimit}`);
    if (counts.suffix > raritySuffixLimit) errors.push(`后缀超过 ${state.rarity} 稀有度上限：${counts.suffix}/${raritySuffixLimit}`);
    const rarityLimit = rarityPrefixLimit + raritySuffixLimit;
    if (counts.explicit > rarityLimit) errors.push(`${state.rarity} 物品显式词缀超过上限：${counts.explicit}/${rarityLimit}`);
    const maxDesecrated = Math.max(1, Number(state.metadata?.maxDesecratedModifiers || 1));
    if (counts.desecrated > maxDesecrated) errors.push(`亵渎词缀超过当前规则上限：${counts.desecrated}/${maxDesecrated}`);
    if (counts.desecrated > 0 && !state.flags?.desecrated) errors.push('存在亵渎词缀但 desecrated 标志未设置。');
  }
  return { ok: errors.length === 0, errors };
}

function cloneItemState(state) { return clone(state); }

function addAffix(data, state, rawAffix) {
  const next = cloneItemState(state);
  next.affixes.push(normalizeAffix(data, next, rawAffix, next.affixes.length));
  if (next.affixes[next.affixes.length - 1].source === 'desecrated') next.flags.desecrated = true;
  const validation = validateItemState(data, next);
  if (!validation.ok) throw new Error(`无法增加词缀：${validation.errors.join('；')}`);
  return next;
}

function removeAffix(data, state, instanceId) {
  const next = cloneItemState(state);
  const index = next.affixes.findIndex((affix) => affix.instanceId === instanceId);
  if (index < 0) throw new Error(`未找到词缀实例：${instanceId}`);
  const [removed] = next.affixes.splice(index, 1);
  next.flags.desecrated = next.affixes.some((affix) => affix.source === 'desecrated');
  const validation = validateItemState(data, next);
  if (!validation.ok) throw new Error(`移除词缀后状态无效：${validation.errors.join('；')}`);
  return { state: next, removed };
}

function hasTarget(state, target) {
  if (!target?.id) return false;
  return state.affixes.some((affix) =>
    affix.modifierId === target.id && Number(affix.tier) <= Number(target.minimumTier || Number.MAX_SAFE_INTEGER)
  );
}

function stateKey(state) {
  const affixes = [...state.affixes]
    .map((affix) => affix.unknown
      ? `${affix.unrevealed ? 'unrevealed' : 'unknown'}:${affix.type}:${affix.source}:${affix.locked ? 1 : 0}:${affix.fractured ? 1 : 0}`
      : `${affix.modifierId}:T${affix.tier}:${affix.source}:${affix.poolSource || ''}:${affix.type}:${affix.fractured ? 1 : 0}`)
    .sort();
  const omens = [...(state.activeOmens || [])].sort().join(',');
  const catalyst = state.catalyst ? `${state.catalyst.id || ''}:${state.catalyst.quality || 0}` : '';
  const augments = [...(state.installedAugments || [])]
    .sort((left, right) => Number(left.slotIndex) - Number(right.slotIndex))
    .map((entry) => `${entry.slotIndex}:${entry.id}`).join(',');
  return [
    state.baseId, state.metadata?.concreteBaseItemId || '', state.metadata?.maxPrefixes ?? '', state.metadata?.maxSuffixes ?? '', state.itemLevel, state.rarity, state.quality || 0, state.sockets || 0, state.supportSockets || 0, state.augmentSocketCapacity || 0, augments,
    state.flags?.corrupted ? 1 : 0, state.flags?.desecrated ? 1 : 0, state.flags?.mirrored ? 1 : 0,
    omens, catalyst, ...affixes
  ].join('|');
}

function fromLegacyInput(data, input = {}) {
  const affixes = [];
  if (Array.isArray(input.existingModifiers)) {
    for (const modifier of input.existingModifiers) affixes.push(modifier);
  } else {
    for (const id of input.existingModifierIds || []) affixes.push({ modifierId: id, tier: null, source: 'unknown' });
  }
  return createItemState(data, {
    baseId: input.baseId,
    itemLevel: input.itemLevel,
    rarity: input.rarity,
    affixes
  });
}

module.exports = {
  VALID_RARITIES,
  VALID_AFFIX_TYPES,
  VALID_SOURCES,
  modifierFamilies,
  affixFamilies,
  modifierAllowedOnBase,
  effectiveAffixLimits,
  normalizeTier,
  createItemState,
  validateItemState,
  affixCounts,
  cloneItemState,
  addAffix,
  removeAffix,
  hasTarget,
  stateKey,
  fromLegacyInput
};
