'use strict';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateCraftingData(data) {
  const errors = [];
  if (!data || typeof data !== 'object') errors.push('数据必须是 JSON 对象。');
  if (!Array.isArray(data?.bases) || !data.bases.length) errors.push('缺少 bases。');
  if (!Array.isArray(data?.modifiers) || !data.modifiers.length) errors.push('缺少 modifiers。');

  const baseIds = new Set();
  for (const base of data?.bases || []) {
    if (!base?.id || !base?.name) errors.push('底材缺少 id 或 name。');
    if (baseIds.has(base?.id)) errors.push(`底材 id 重复：${base.id}`);
    baseIds.add(base?.id);
  }

  const modIds = new Set();
  for (const mod of data?.modifiers || []) {
    if (!mod?.id || !mod?.name) errors.push('词缀缺少 id 或 name。');
    if (!['prefix', 'suffix'].includes(mod?.type)) errors.push(`词缀 ${mod?.id || '?'} 的类型无效。`);
    if (!mod?.family) errors.push(`词缀 ${mod?.id || '?'} 缺少 family。`);
    if (!Array.isArray(mod?.tiers) || !mod.tiers.length) errors.push(`词缀 ${mod?.id || '?'} 缺少 tiers。`);
    if (modIds.has(mod?.id)) errors.push(`词缀 id 重复：${mod.id}`);
    modIds.add(mod?.id);
    for (const tier of mod?.tiers || []) {
      if (!Number.isFinite(Number(tier.tier)) || Number(tier.tier) < 1) errors.push(`词缀 ${mod.id} 存在无效 T 级。`);
      if (!Number.isFinite(Number(tier.level)) || Number(tier.level) < 0) errors.push(`词缀 ${mod.id} 存在无效物品等级。`);
      if (!Number.isFinite(Number(tier.weight)) || Number(tier.weight) <= 0) errors.push(`词缀 ${mod.id} 存在无效权重。`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function baseById(data, baseId) {
  const base = data.bases.find((entry) => entry.id === baseId);
  if (!base) throw new Error(`未找到底材：${baseId}`);
  return base;
}

function modifierById(data, modId) {
  return data.modifiers.find((entry) => entry.id === modId) || null;
}

function modifierAllowedOnBase(modifier, base) {
  const allowedIds = Array.isArray(modifier.allowedBaseIds) ? modifier.allowedBaseIds : [];
  if (allowedIds.length) return allowedIds.includes(base?.id);
  const required = Array.isArray(modifier.allowedBaseTags) ? modifier.allowedBaseTags : [];
  const excluded = Array.isArray(modifier.excludedBaseTags) ? modifier.excludedBaseTags : [];
  const tags = new Set(base?.tags || []);
  if (excluded.some((tag) => tags.has(tag))) return false;
  if (!required.length) return true;
  return required.some((tag) => tags.has(tag));
}

function modifierFamilies(modifier) {
  const values = Array.isArray(modifier?.families) && modifier.families.length
    ? modifier.families
    : [modifier?.family];
  return [...new Set(values.map(String).filter(Boolean))];
}

function tierMeetsGoal(tierNumber, minimumTier) {
  if (!Number.isFinite(Number(minimumTier))) return true;
  return Number(tierNumber) <= Number(minimumTier);
}

function normalizeInput(data, input = {}) {
  const sourceBase = baseById(data, input.baseId || data.bases[0].id);
  const prefixOverride = Number(input.maxPrefixes);
  const suffixOverride = Number(input.maxSuffixes);
  const base = {
    ...sourceBase,
    maxPrefixes: Number.isInteger(prefixOverride) && prefixOverride >= 0 ? prefixOverride : Number(sourceBase.maxPrefixes || 3),
    maxSuffixes: Number.isInteger(suffixOverride) && suffixOverride >= 0 ? suffixOverride : Number(sourceBase.maxSuffixes || 3)
  };
  const itemLevel = Math.max(1, Math.floor(Number(input.itemLevel) || 1));
  const rarity = ['normal', 'magic', 'rare'].includes(input.rarity) ? input.rarity : 'rare';
  const legacyIds = Array.isArray(input.existingModifierIds) ? input.existingModifierIds : [];
  const rawExisting = Array.isArray(input.existingModifiers)
    ? input.existingModifiers
    : legacyIds.map((id) => ({ id, tier: null, source: 'unknown' }));
  const existingModifiers = [];
  const seen = new Set();
  for (const entry of rawExisting) {
    const id = entry?.id || entry?.modifierId;
    const modifier = modifierById(data, id);
    if (!modifier || seen.has(id)) continue;
    const availableTiers = (modifier.tiers || [])
      .filter((tier) => Number(tier.level) <= itemLevel)
      .sort((left, right) => Number(left.tier) - Number(right.tier));
    if (!availableTiers.length) continue;
    const requested = entry?.tier == null ? null : Number(entry.tier);
    const tier = Number.isInteger(requested)
      ? availableTiers.find((candidate) => Number(candidate.tier) === requested)
      : availableTiers[availableTiers.length - 1];
    if (!tier) continue;
    existingModifiers.push({
      id,
      tier: Number(tier.tier),
      tierAssumed: entry?.tier == null,
      type: modifier.type,
      family: modifier.family,
      families: modifierFamilies(modifier),
      source: entry?.source || modifier.source || 'unknown'
    });
    seen.add(id);
  }
  const existingModifierIds = existingModifiers.map((entry) => entry.id);
  const knownPrefixes = existingModifiers.filter((entry) => entry.type === 'prefix').length;
  const knownSuffixes = existingModifiers.filter((entry) => entry.type === 'suffix').length;
  const prefixCount = Math.max(knownPrefixes, Math.max(0, Math.min(Number(base.maxPrefixes) || 3, Math.floor(Number(input.prefixCount) || 0))));
  const suffixCount = Math.max(knownSuffixes, Math.max(0, Math.min(Number(base.maxSuffixes) || 3, Math.floor(Number(input.suffixCount) || 0))));
  const targets = (Array.isArray(input.targets) ? input.targets : [])
    .map((target) => ({
      id: target.id,
      minimumTier: Math.max(1, Math.floor(Number(target.minimumTier) || 99))
    }))
    .filter((target) => modifierById(data, target.id));

  return {
    base,
    baseId: base.id,
    itemLevel,
    rarity,
    prefixCount,
    suffixCount,
    existingModifierIds,
    existingModifiers,
    targets
  };
}

function existingFamilies(data, existingModifierIds, existingModifiers = null) {
  const out = new Set();
  if (Array.isArray(existingModifiers)) {
    for (const entry of existingModifiers) {
      const values = Array.isArray(entry.families) && entry.families.length ? entry.families : [entry.family];
      values.filter(Boolean).forEach((family) => out.add(family));
    }
    return out;
  }
  for (const id of existingModifierIds) modifierFamilies(modifierById(data, id)).forEach((family) => out.add(family));
  return out;
}

function availableEvents(data, input, { side = 'both', families = null, prefixCount = null, suffixCount = null } = {}) {
  const normalized = input.base ? input : normalizeInput(data, input);
  const base = normalized.base;
  const familySet = families || existingFamilies(data, normalized.existingModifierIds, normalized.existingModifiers);
  const pCount = prefixCount == null ? normalized.prefixCount : prefixCount;
  const sCount = suffixCount == null ? normalized.suffixCount : suffixCount;
  const prefixOpen = pCount < (Number(base.maxPrefixes) || 3);
  const suffixOpen = sCount < (Number(base.maxSuffixes) || 3);

  const events = [];
  for (const modifier of data.modifiers) {
    if (!modifierAllowedOnBase(modifier, base)) continue;
    const candidateFamilies = modifierFamilies(modifier);
    if (candidateFamilies.some((family) => familySet.has(family))) continue;
    if (modifier.type === 'prefix' && (!prefixOpen || side === 'suffix')) continue;
    if (modifier.type === 'suffix' && (!suffixOpen || side === 'prefix')) continue;

    for (const tier of modifier.tiers) {
      if (Number(tier.level) > normalized.itemLevel) continue;
      events.push({
        modifierId: modifier.id,
        modifierName: modifier.name,
        family: modifier.family,
        families: candidateFamilies,
        type: modifier.type,
        tier: Number(tier.tier),
        level: Number(tier.level),
        weight: Number(tier.weight),
        min: tier.min,
        max: tier.max
      });
    }
  }
  return events;
}

function sideForAction(action, normalized) {
  if (action === 'prefixOmen') return 'prefix';
  if (action === 'suffixOmen') return 'suffix';
  if (action === 'augment' && normalized.rarity === 'magic') {
    if (normalized.prefixCount > 0 && normalized.suffixCount === 0) return 'suffix';
    if (normalized.suffixCount > 0 && normalized.prefixCount === 0) return 'prefix';
  }
  return 'both';
}

function targetEventMatch(event, target) {
  return event.modifierId === target.id && tierMeetsGoal(event.tier, target.minimumTier);
}


function actionApplicable(action, normalized) {
  const total = normalized.prefixCount + normalized.suffixCount;
  if (action === 'transmute') return normalized.rarity === 'normal';
  if (action === 'augment') return normalized.rarity === 'magic' && total < 2;
  if (action === 'regal') return normalized.rarity === 'magic';
  if (['exalt', 'prefixOmen', 'suffixOmen'].includes(action)) {
    return normalized.rarity === 'rare' && total < (Number(normalized.base.maxPrefixes) || 3) + (Number(normalized.base.maxSuffixes) || 3);
  }
  return true;
}

function existingTargetSatisfied(normalized, target) {
  const entry = normalized.existingModifiers.find((modifier) => modifier.id === target.id);
  return Boolean(entry && tierMeetsGoal(entry.tier, target.minimumTier));
}

function probabilitySummary(data, input, action = 'exalt') {
  const normalized = normalizeInput(data, input);
  const applicable = actionApplicable(action, normalized);
  const side = sideForAction(action, normalized);
  const events = applicable ? availableEvents(data, normalized, { side }) : [];
  const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
  const unsatisfiedTargets = normalized.targets.filter((target) => !existingTargetSatisfied(normalized, target));

  const desiredEvents = events.filter((event) => unsatisfiedTargets.some((target) => targetEventMatch(event, target)));
  const desiredWeight = desiredEvents.reduce((sum, event) => sum + event.weight, 0);
  const probability = totalWeight > 0 ? desiredWeight / totalWeight : 0;

  const perTarget = normalized.targets.map((target) => {
    const existing = existingTargetSatisfied(normalized, target);
    const matching = existing ? [] : events.filter((event) => targetEventMatch(event, target));
    const weight = matching.reduce((sum, event) => sum + event.weight, 0);
    const existingEntry = normalized.existingModifiers.find((modifier) => modifier.id === target.id) || null;
    return {
      id: target.id,
      name: modifierById(data, target.id)?.name || target.id,
      minimumTier: target.minimumTier,
      existing,
      existingTier: existingEntry?.tier ?? null,
      tierAssumed: Boolean(existingEntry?.tierAssumed),
      weight,
      probability: existing ? 1 : (totalWeight > 0 ? weight / totalWeight : 0)
    };
  });

  return {
    action,
    actionApplicable: applicable,
    side,
    base: { id: normalized.base.id, name: normalized.base.name },
    itemLevel: normalized.itemLevel,
    totalWeight,
    desiredWeight,
    eventCount: events.length,
    desiredEventCount: desiredEvents.length,
    probability,
    expectedAttempts: probability > 0 ? 1 / probability : null,
    perTarget,
    source: data.source || null,
    warnings: [
      ...(!applicable ? [`当前物品状态不能使用 ${action}。`] : []),
      ...(data.source?.confidence === 'low' ? [data.source.notice || '当前使用低可信度数据。'] : []),
      ...(normalized.existingModifiers.some((entry) => entry.tierAssumed) ? ['部分已有词缀未提供 T 级，已按当前物等可用的最低档位保守处理。'] : []),
      ...(unsatisfiedTargets.length > 1 ? ['“命中任一目标”概率不等于一次同时完成全部目标的概率；多词缀请查看模拟路径。'] : [])
    ]
  };
}

function quantileAttempts(probability, quantile) {
  if (!(probability > 0) || probability >= 1) return probability >= 1 ? 1 : null;
  return Math.ceil(Math.log(1 - quantile) / Math.log(1 - probability));
}

function createRng(seed = 20260617) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function weightedChoice(events, rng) {
  const total = events.reduce((sum, event) => sum + event.weight, 0);
  if (!(total > 0)) return null;
  let cursor = rng() * total;
  for (const event of events) {
    cursor -= event.weight;
    if (cursor <= 0) return event;
  }
  return events[events.length - 1] || null;
}

function actionPrice(action, prices) {
  const value = Number(prices?.[action]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function applyAction(data, normalized, state, action, rng) {
  let side = 'both';
  if (action === 'prefixOmen') side = 'prefix';
  if (action === 'suffixOmen') side = 'suffix';
  if (action === 'augment' && state.rarity === 'magic') {
    if (state.prefixCount > 0 && state.suffixCount === 0) side = 'suffix';
    if (state.suffixCount > 0 && state.prefixCount === 0) side = 'prefix';
  }

  const event = weightedChoice(availableEvents(data, normalized, {
    side,
    families: state.families,
    prefixCount: state.prefixCount,
    suffixCount: state.suffixCount
  }), rng);

  if (!event) return false;
  state.families.add(event.family);
  state.modifierIds.add(event.modifierId);
  state.modifierTiers.set(event.modifierId, event.tier);
  if (event.type === 'prefix') state.prefixCount += 1;
  else state.suffixCount += 1;
  if (action === 'transmute') state.rarity = 'magic';
  if (action === 'regal') state.rarity = 'rare';
  return true;
}

function prepareStrategyCandidates(data, normalized) {
  const maxTotal = (Number(normalized.base.maxPrefixes) || 3) + (Number(normalized.base.maxSuffixes) || 3);
  const currentTotal = normalized.prefixCount + normalized.suffixCount;
  const baseSteps = [];
  if (normalized.rarity === 'normal') baseSteps.push('transmute', 'augment', 'regal');
  else if (normalized.rarity === 'magic') {
    if (currentTotal < 2) baseSteps.push('augment');
    baseSteps.push('regal');
  }

  const slotsAfterBase = Math.max(0, maxTotal - currentTotal - baseSteps.length);
  const targetTypes = normalized.targets
    .map((target) => modifierById(data, target.id)?.type)
    .filter(Boolean);
  const prefixTargets = targetTypes.filter((type) => type === 'prefix').length;
  const suffixTargets = targetTypes.filter((type) => type === 'suffix').length;

  const economy = [...baseSteps, ...Array(slotsAfterBase).fill('exalt')];
  const focused = [...baseSteps];
  let p = prefixTargets;
  let s = suffixTargets;
  for (let index = 0; index < slotsAfterBase; index += 1) {
    if (p > 0 && s > 0) {
      if (p >= s) { focused.push('prefixOmen'); p -= 1; }
      else { focused.push('suffixOmen'); s -= 1; }
    } else if (p > 0) { focused.push('prefixOmen'); p -= 1; }
    else if (s > 0) { focused.push('suffixOmen'); s -= 1; }
    else focused.push('exalt');
  }

  const balanced = [...baseSteps];
  for (let index = 0; index < slotsAfterBase; index += 1) {
    if (prefixTargets && index % 2 === 0) balanced.push('prefixOmen');
    else if (suffixTargets && index % 2 === 1) balanced.push('suffixOmen');
    else balanced.push('exalt');
  }

  return [
    { id: 'economy', name: '普通通货路线', actions: economy },
    { id: 'focused', name: '目标前后缀定向路线', actions: focused },
    { id: 'balanced', name: '平衡风险路线', actions: balanced }
  ].filter((strategy, index, list) =>
    list.findIndex((other) => other.actions.join(',') === strategy.actions.join(',')) === index
  );
}

function simulateOneStrategy(data, input, strategy, options = {}) {
  const normalized = normalizeInput(data, input);
  const trials = Math.max(100, Math.min(100000, Math.floor(Number(options.trials) || 10000)));
  const seed = Math.floor(Number(options.seed) || 20260617);
  const rng = createRng(seed + strategy.id.length * 997);
  const prices = options.prices || {};
  const targetSatisfied = (state, target) => {
    if (!state.modifierIds.has(target.id)) return false;
    const rolledTier = state.modifierTiers.get(target.id);
    return rolledTier == null || tierMeetsGoal(rolledTier, target.minimumTier);
  };
  let successes = 0;
  let totalCost = 0;
  let totalUsedActions = 0;

  for (let trial = 0; trial < trials; trial += 1) {
    const state = {
      rarity: normalized.rarity,
      prefixCount: normalized.prefixCount,
      suffixCount: normalized.suffixCount,
      families: existingFamilies(data, normalized.existingModifierIds, normalized.existingModifiers),
      modifierIds: new Set(normalized.existingModifierIds),
      modifierTiers: new Map(normalized.existingModifiers.map((entry) => [entry.id, entry.tier]))
    };
    let cost = 0;
    let used = 0;

    for (const action of strategy.actions) {
      cost += actionPrice(action, prices);
      used += 1;
      const ok = applyAction(data, normalized, state, action, rng);
      if (!ok) break;
      if (normalized.targets.every((target) => targetSatisfied(state, target))) break;
    }

    const success = normalized.targets.every((target) => targetSatisfied(state, target));
    if (success) successes += 1;
    totalCost += cost;
    totalUsedActions += used;
  }

  const successRate = successes / trials;
  const averageCost = totalCost / trials;
  const expectedCostPerSuccess = successes > 0 ? totalCost / successes : null;
  const p50Attempts = quantileAttempts(successRate, 0.5);
  const p75Attempts = quantileAttempts(successRate, 0.75);
  const p90Attempts = quantileAttempts(successRate, 0.9);

  return {
    id: strategy.id,
    name: strategy.name,
    actions: strategy.actions,
    trials,
    successes,
    successRate,
    averageCost,
    averageActions: totalUsedActions / trials,
    expectedCostPerSuccess,
    p50Attempts,
    p75Attempts,
    p90Attempts,
    p50Cost: p50Attempts ? p50Attempts * averageCost : null,
    p75Cost: p75Attempts ? p75Attempts * averageCost : null,
    p90Cost: p90Attempts ? p90Attempts * averageCost : null
  };
}

function analyzeCraft(data, input, options = {}) {
  const validation = validateCraftingData(data);
  if (!validation.ok) throw new Error(`做装数据无效：${validation.errors.join('；')}`);
  const normalized = normalizeInput(data, input);
  if (!normalized.targets.length) throw new Error('请至少选择一个目标词缀。');

  const prices = options.prices || {};
  const nextRolls = ['exalt', 'prefixOmen', 'suffixOmen'].map((action) => {
    const result = probabilitySummary(data, normalized, action);
    const price = actionPrice(action, prices);
    return {
      ...result,
      price,
      expectedCurrencyCost: result.probability > 0 ? price / result.probability : null,
      p50Attempts: quantileAttempts(result.probability, 0.5),
      p75Attempts: quantileAttempts(result.probability, 0.75),
      p90Attempts: quantileAttempts(result.probability, 0.9)
    };
  });

  const strategies = prepareStrategyCandidates(data, normalized)
    .map((strategy) => simulateOneStrategy(data, normalized, strategy, {
      trials: options.trials,
      seed: options.seed,
      prices
    }))
    .sort((left, right) => {
      if (left.expectedCostPerSuccess == null) return 1;
      if (right.expectedCostPerSuccess == null) return -1;
      return left.expectedCostPerSuccess - right.expectedCostPerSuccess;
    });

  const best = strategies.find((strategy) => strategy.expectedCostPerSuccess != null) || null;

  return {
    input: {
      baseId: normalized.baseId,
      baseName: normalized.base.name,
      itemLevel: normalized.itemLevel,
      rarity: normalized.rarity,
      prefixCount: normalized.prefixCount,
      suffixCount: normalized.suffixCount,
      existingModifierIds: normalized.existingModifierIds,
      existingModifiers: normalized.existingModifiers,
      targets: normalized.targets
    },
    source: data.source || null,
    nextRolls,
    strategies,
    bestStrategy: best,
    warnings: [
      ...(data.source?.notice ? [data.source.notice] : []),
      '路径模拟会真实按内置权重逐次抽取词缀，但尚未覆盖全部特殊通货、亵渎、腐化和复杂词缀转换。'
    ]
  };
}

function craftingDataSummary(data) {
  const validation = validateCraftingData(data);
  return {
    ...validation,
    schemaVersion: data?.schemaVersion || null,
    dataVersion: data?.dataVersion || null,
    source: data?.source || null,
    baseCount: Array.isArray(data?.bases) ? data.bases.length : 0,
    modifierCount: Array.isArray(data?.modifiers) ? data.modifiers.length : 0,
    currencyCount: Array.isArray(data?.currencies) ? data.currencies.length : 0,
    omenCount: Array.isArray(data?.omens) ? data.omens.length : 0,
    tierCount: Array.isArray(data?.modifiers)
      ? data.modifiers.reduce((sum, mod) => sum + (Array.isArray(mod.tiers) ? mod.tiers.length : 0), 0)
      : 0
  };
}

module.exports = {
  validateCraftingData,
  craftingDataSummary,
  normalizeInput,
  availableEvents,
  probabilitySummary,
  quantileAttempts,
  simulateOneStrategy,
  analyzeCraft,
  deepClone
};
