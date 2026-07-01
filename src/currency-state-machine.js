'use strict';

const {
  cloneItemState,
  affixCounts,
  addAffix,
  removeAffix,
  validateItemState,
  modifierAllowedOnBase,
  modifierFamilies,
  affixFamilies,
  effectiveAffixLimits,
  stateKey
} = require('./item-state');

function indexesFor(data) {
  return data.indexes || {
    baseById: new Map((data.bases || []).map((entry) => [entry.id, entry])),
    modifierById: new Map((data.modifiers || []).map((entry) => [entry.id, entry])),
    currencyById: new Map((data.currencies || []).map((entry) => [entry.id, entry])),
    omenById: new Map((data.omens || []).map((entry) => [entry.id, entry]))
  };
}

function omenTriggers(omen, actionId, currency = null) {
  if (!omen) return false;
  const ids = Array.isArray(omen.triggerCurrency) ? omen.triggerCurrency : [omen.triggerCurrency];
  if (ids.filter(Boolean).includes(actionId)) return true;
  const categories = Array.isArray(omen.triggerCategory) ? omen.triggerCategory : [omen.triggerCategory];
  return Boolean(currency && categories.filter(Boolean).includes(currency.category));
}

function omenAppliesToBase(data, state, omen) {
  const allowedTags = omen?.effect?.allowedBaseTags || [];
  if (!allowedTags.length) return true;
  const base = indexesFor(data).baseById.get(state.baseId);
  const tags = new Set(base?.tags || []);
  return allowedTags.some((tag) => tags.has(tag));
}

function activeOmenEffects(data, state, actionId, currency = null) {
  const indexes = indexesFor(data);
  const effects = [];
  for (const omenId of state.activeOmens || []) {
    const omen = indexes.omenById.get(omenId);
    if (!omenTriggers(omen, actionId, currency) || !omenAppliesToBase(data, state, omen)) continue;
    effects.push({ omenId, ...omen.effect });
  }
  return effects;
}

function effectiveRule(data, state, currency) {
  const rule = { ...currency };
  for (const effect of activeOmenEffects(data, state, currency.id, currency)) {
    if (effect.forceSide) rule.forceSide = effect.forceSide;
    if (effect.addCountOverride != null) rule.addCount = Number(effect.addCountOverride);
    if (effect.removeRule) rule.removeRule = effect.removeRule;
    if (effect.removeSource) rule.removeSource = effect.removeSource;
    if (effect.removeSide) rule.removeSide = effect.removeSide;
    if (effect.replaceAllWithUnrevealed) rule.replaceAllWithUnrevealed = true;
    if (effect.maxUnrevealed != null) rule.maxUnrevealed = Number(effect.maxUnrevealed);
    if (effect.guaranteedTag) rule.guaranteedTag = effect.guaranteedTag;
    if (Array.isArray(effect.blockedTags)) rule.blockedTags = [...new Set([...(rule.blockedTags || []), ...effect.blockedTags])];
    if (effect.disableMinimumModifierLevel) rule.disableMinimumModifierLevel = true;
    if (effect.excludeExclusiveDesecrated) rule.excludeExclusiveDesecrated = true;
    if (effect.consumeCatalystQualityForWeight) {
      rule.consumeCatalystQualityForWeight = true;
      rule.catalystWeighting = true;
    }
  }
  return rule;
}

function baseMatchesCurrency(base, currency) {
  const tags = new Set(base?.tags || []);
  const allowedIds = currency.allowedBaseIds || [];
  if (allowedIds.length && !allowedIds.includes(base?.id)) return false;
  const requiredTags = currency.allowedBaseTags || [];
  if (requiredTags.length && !requiredTags.some((tag) => tags.has(tag))) return false;
  const excludedTags = currency.excludedBaseTags || [];
  if (excludedTags.some((tag) => tags.has(tag))) return false;
  return true;
}

function sideLimits(base, rarity, state = null) {
  if (rarity === 'normal') return { prefix: 0, suffix: 0, total: 0 };
  const effective = effectiveAffixLimits(state, base);
  if (rarity === 'magic') {
    const prefix = Math.min(1, effective.maxPrefixes);
    const suffix = Math.min(1, effective.maxSuffixes);
    return { prefix, suffix, total: prefix + suffix };
  }
  const prefix = effective.maxPrefixes;
  const suffix = effective.maxSuffixes;
  return { prefix, suffix, total: prefix + suffix };
}

function removableAffixes(state, rule = {}) {
  return state.affixes.filter((affix) => {
    if (!['prefix', 'suffix'].includes(affix.type) || affix.locked || affix.fractured) return false;
    if (rule.removeSource && affix.source !== rule.removeSource) return false;
    if (rule.removeSide && affix.type !== rule.removeSide) return false;
    return true;
  });
}

function hasFracturedAffix(state) {
  return state.affixes.some((affix) => affix.fractured);
}

function hasFeasibleAddSequence(data, state, rule, remaining) {
  const count = Math.max(0, Number(remaining || 0));
  if (count === 0) return true;
  const working = cloneItemState(state);
  if (rule.outputRarity) working.rarity = rule.outputRarity;

  const search = (current, needed) => {
    if (needed <= 0) return true;
    const events = eligibleModifierEvents(data, current, {
      ...rule,
      allowedSources: rule.allowedSources || ['normal'],
      catalystWeighting: Boolean(rule.catalystWeighting)
    });
    // T 级不会改变槽位或词缀组冲突，因此每个 modifierId 只需尝试一个代表事件。
    const representatives = new Map();
    for (const event of events) {
      if (!representatives.has(String(event.modifierId))) representatives.set(String(event.modifierId), event);
    }
    for (const event of representatives.values()) {
      try {
        const next = addAffix(data, current, {
          modifierId: event.modifierId,
          tier: event.tier,
          source: event.source,
          poolSource: event.source,
          type: event.type,
          min: event.min,
          max: event.max
        });
        if (search(next, needed - 1)) return true;
      } catch (_error) {
        // 某个候选因复合词缀组或槽位校验失败时，继续尝试其他候选。
      }
    }
    return false;
  };

  return search(working, count);
}

function canApplyCurrency(data, state, currencyId) {
  const indexes = indexesFor(data);
  const currency = indexes.currencyById.get(currencyId);
  if (!currency) return { ok: false, reason: `未知通货或动作：${currencyId}` };
  if (currency.implementationStatus && currency.implementationStatus !== 'ready') {
    return { ok: false, reason: `${currency.name} 仅保留规则目录；缺少可验证的随机分布，状态机不会伪造结果。` };
  }
  const base = indexes.baseById.get(state.baseId);
  if (!base) return { ok: false, reason: `未知底材：${state.baseId}` };
  if (state.flags?.mirrored && !currency.allowMirrored) return { ok: false, reason: '镜像物品不能被修改。' };
  if (state.flags?.corrupted && !currency.allowCorrupted) return { ok: false, reason: '腐化物品不能使用该通货。' };
  if (!baseMatchesCurrency(base, currency)) return { ok: false, reason: `${currency.name} 不能用于当前底材类别。` };
  if (!currency.inputRarities?.includes(state.rarity)) return { ok: false, reason: `${currency.name} 不能用于 ${state.rarity} 物品。` };
  if (currency.maxItemLevel != null && Number(state.itemLevel) > Number(currency.maxItemLevel)) {
    return { ok: false, reason: `${currency.name} 只能用于物品等级不高于 ${currency.maxItemLevel} 的物品。` };
  }
  if (currency.minItemLevel != null && Number(state.itemLevel) < Number(currency.minItemLevel)) {
    return { ok: false, reason: `${currency.name} 需要物品等级至少 ${currency.minItemLevel}。` };
  }

  const counts = affixCounts(state);
  const rule = effectiveRule(data, state, currency);
  const resultingRarity = rule.outputRarity || state.rarity;
  const limits = sideLimits(base, resultingRarity, state);
  const totalLimit = Math.min(limits.total, Number(rule.maxTotalAffixes ?? limits.total));
  const minExplicit = Number(rule.minExplicitAffixes ?? 0);
  const maxExplicit = rule.maxExplicitAffixes == null ? Infinity : Number(rule.maxExplicitAffixes);

  if (counts.explicit < minExplicit) return { ok: false, reason: `至少需要 ${minExplicit} 条显式词缀。` };
  if (counts.explicit > maxExplicit) return { ok: false, reason: `显式词缀不能超过 ${maxExplicit} 条。` };
  if (rule.requiresNoFracturedAffix && hasFracturedAffix(state)) return { ok: false, reason: '该通货不能用于已有破裂词缀的物品。' };

  if (rule.category === 'desecrate') {
    if (counts.desecrated > 0 || state.flags?.desecrated) return { ok: false, reason: '已有亵渎词缀的物品不能再次亵渎。' };
    if (rule.replaceAllWithUnrevealed) return { ok: true, currency, rule };
    if (rule.forceSide === 'prefix' && counts.prefix >= limits.prefix && counts.explicit < totalLimit) {
      return { ok: false, reason: '预兆强制增加前缀，但前缀槽已满且物品并未满词缀。' };
    }
    if (rule.forceSide === 'suffix' && counts.suffix >= limits.suffix && counts.explicit < totalLimit) {
      return { ok: false, reason: '预兆强制增加后缀，但后缀槽已满且物品并未满词缀。' };
    }
    const removalRule = rule.forceSide ? { removeSide: rule.forceSide } : {};
    if (counts.explicit >= totalLimit && !removableAffixes(state, removalRule).length) {
      return { ok: false, reason: '词缀已满，但没有符合当前预兆方向的可随机移除词缀。' };
    }
    return { ok: true, currency, rule };
  }

  if (rule.category === 'add') {
    const addCount = Number(rule.addCount || 0);
    if (counts.explicit + addCount > totalLimit) {
      return { ok: false, reason: `词缀槽位不足：需要 ${addCount} 个空位。` };
    }
    // 方向预兆与“下一次增加两条词缀”的预兆可以同时生效。
    // 不能只检查总槽位：两条都被强制为前缀/后缀时，对应一侧也必须有足够空位。
    if (rule.forceSide === 'prefix' && counts.prefix + addCount > limits.prefix) {
      return { ok: false, reason: `前缀槽位不足：当前效果需要连续增加 ${addCount} 条前缀。` };
    }
    if (rule.forceSide === 'suffix' && counts.suffix + addCount > limits.suffix) {
      return { ok: false, reason: `后缀槽位不足：当前效果需要连续增加 ${addCount} 条后缀。` };
    }
    if (!hasFeasibleAddSequence(data, state, rule, addCount)) {
      return { ok: false, reason: '当前底材、物品等级、词缀组、预兆方向与来源限制下，没有足够的合法新增词缀组合。' };
    }
  }
  if (rule.category === 'reroll' && Number(rule.addCount || 0) > totalLimit) {
    return { ok: false, reason: `通货结果需要 ${rule.addCount} 条词缀，但当前底材上限为 ${totalLimit}。` };
  }
  if ((rule.category === 'remove' || rule.category === 'replace') && !removableAffixes(state, rule).length) {
    return { ok: false, reason: rule.removeSource === 'desecrated' ? '物品没有可移除的亵渎词缀。' : '物品没有可随机移除的非锁定、非破裂显式词缀。' };
  }
  if (rule.category === 'fracture') {
    if (counts.explicit < Number(rule.minExplicitAffixes || 4)) return { ok: false, reason: '破裂石需要至少 4 条显式词缀的稀有物品。' };
    if (hasFracturedAffix(state)) return { ok: false, reason: '破裂石不能用于已有破裂词缀的物品。' };
    if (!fractureCandidates(state).length) return { ok: false, reason: '没有可破裂的非亵渎显式词缀；亵渎词缀可计入 4 条门槛，但自身不能被破裂。' };
  }
  return { ok: true, currency, rule };
}

function normalizeTag(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function modifierMatchesCatalystTag(modifier, targetTag) {
  const target = normalizeTag(targetTag);
  if (!target) return false;
  const haystack = [
    modifier?.name,
    modifier?.family,
    ...(modifier?.families || []),
    ...(modifier?.sourceMeta?.tags || []),
    ...(modifier?.tags || [])
  ].map(normalizeTag).filter(Boolean);
  if (haystack.some((value) => value.includes(target) || target.includes(value))) return true;
  const groups = {
    defences: ['defence', 'armor', 'armour', 'evasion', 'energyshield'],
    attribute: ['attribute', 'strength', 'dexterity', 'intelligence'],
    caster: ['caster', 'cast', 'spell'],
    attack: ['attack'],
    speed: ['speed'],
    physical: ['physical'],
    fire: ['fire'], cold: ['cold'], lightning: ['lightning'], chaos: ['chaos'],
    life: ['life'], mana: ['mana'], minion: ['minion']
  };
  return (groups[target] || [target]).some((needle) => haystack.some((value) => value.includes(needle)));
}

function catalystWeightMultiplier(state, modifier, enabled) {
  if (!enabled) return 1;
  const quality = Math.max(0, Math.min(40, Number(state.catalyst?.quality || 0)));
  const tag = state.catalyst?.modifierTag;
  if (!quality || !tag || !modifierMatchesCatalystTag(modifier, tag)) return 1;
  // 已知锚点：20 品质=5倍、40 品质=7.5倍。中间品质按锚点分段线性插值，并在结果中明确记录。
  return 1 + Math.min(quality, 20) * 0.2 + Math.max(0, quality - 20) * 0.125;
}

function eligibleModifierEvents(data, state, options = {}) {
  const indexes = indexesFor(data);
  const base = indexes.baseById.get(state.baseId);
  if (!base) throw new Error(`未找到底材：${state.baseId}`);
  const counts = affixCounts(state);
  const limits = sideLimits(base, state.rarity, state);
  const families = new Set();
  for (const affix of state.affixes.filter((entry) => entry.type === 'prefix' || entry.type === 'suffix')) {
    affixFamilies(affix).forEach((family) => families.add(family));
  }
  const forceSide = options.forceSide || 'both';
  const minModifierLevel = options.disableMinimumModifierLevel ? 0 : Math.max(0, Number(options.minModifierLevel) || 0);
  const allowedSources = new Set(options.allowedSources || ['normal']);
  const requiredTags = new Set(options.requiredTags || []);
  const excludedTags = new Set(options.excludedTags || []);
  const events = [];

  for (const modifier of data.modifiers || []) {
    const modifierSource = modifier.source || 'normal';
    if (!allowedSources.has(modifierSource)) continue;
    if (!['prefix', 'suffix'].includes(modifier.type)) continue;
    if (!modifierAllowedOnBase(modifier, base)) continue;
    const tags = new Set([...(modifier.sourceMeta?.tags || []), ...(modifier.tags || [])]);
    if (requiredTags.size && ![...requiredTags].some((tag) => tags.has(tag))) continue;
    if ([...excludedTags].some((tag) => tags.has(tag))) continue;
    const candidateFamilies = modifierFamilies(modifier);
    if (candidateFamilies.some((family) => families.has(family))) continue;
    if (modifier.type === 'prefix' && (forceSide === 'suffix' || counts.prefix >= limits.prefix)) continue;
    if (modifier.type === 'suffix' && (forceSide === 'prefix' || counts.suffix >= limits.suffix)) continue;

    const eligibleTiers = (modifier.tiers || [])
      .filter((tier) => Number(tier.level) <= Number(state.itemLevel) && Number(tier.weight) > 0)
      .sort((left, right) => Number(left.tier) - Number(right.tier) || Number(right.level) - Number(left.level));
    if (!eligibleTiers.length) continue;
    let selectedTiers = minModifierLevel > 0
      ? eligibleTiers.filter((tier) => Number(tier.level) >= minModifierLevel)
      : eligibleTiers;
    let minimumLevelFallback = false;
    if (!selectedTiers.length && minModifierLevel > 0) {
      // 高阶/完美通货与远古骨材：不能让一个词缀家族完全消失；改用该家族当前物等可用的最高级 T 级。
      selectedTiers = [eligibleTiers[0]];
      minimumLevelFallback = true;
    }

    for (const tier of selectedTiers) {
      const rawWeight = Number(tier.weight);
      const multiplier = catalystWeightMultiplier(state, modifier, Boolean(options.catalystWeighting));
      events.push({
        modifierId: modifier.id,
        name: modifier.name,
        family: modifier.family,
        families: candidateFamilies,
        type: modifier.type,
        source: modifierSource,
        exclusiveDesecrated: Boolean(modifier.exclusiveDesecrated || modifierSource === 'desecrated'),
        tags: [...tags],
        tier: Number(tier.tier),
        modifierLevel: Number(tier.level),
        minimumLevelFallback,
        requestedMinimumModifierLevel: minModifierLevel,
        weight: rawWeight * multiplier,
        rawWeight,
        weightMultiplier: multiplier,
        catalystWeighting: multiplier > 1,
        min: tier.min ?? null,
        max: tier.max ?? null
      });
    }
  }
  return events;
}

function weightedChoice(events, rng = Math.random) {
  const total = events.reduce((sum, event) => sum + Number(event.weight || 0), 0);
  if (!(total > 0)) return null;
  let cursor = rng() * total;
  for (const event of events) {
    cursor -= Number(event.weight || 0);
    if (cursor <= 0) return event;
  }
  return events[events.length - 1] || null;
}

function weightedChoiceWithoutReplacement(events, count, rng = Math.random, initial = []) {
  const chosen = [...initial];
  const used = new Set(chosen.map((event) => String(event.modifierId)));
  let remaining = events.filter((event) => !used.has(String(event.modifierId)));
  while (chosen.length < count && remaining.length) {
    const event = weightedChoice(remaining, rng);
    if (!event) break;
    chosen.push(event);
    used.add(String(event.modifierId));
    remaining = remaining.filter((entry) => !used.has(String(entry.modifierId)));
  }
  return chosen;
}

function consumeTriggeredOmens(data, state, actionId, currency = null) {
  const indexes = indexesFor(data);
  const consumed = [];
  const remaining = [];
  for (const omenId of state.activeOmens || []) {
    const omen = indexes.omenById.get(omenId);
    if (omenTriggers(omen, actionId, currency) && omenAppliesToBase(data, state, omen)) consumed.push(omenId);
    else remaining.push(omenId);
  }
  state.activeOmens = remaining;
  return consumed;
}

function appendHistory(state, entry) {
  state.history.push({ at: new Date().toISOString(), ...entry });
}

function sampleAdd(data, state, rule, currency, rng) {
  let next = cloneItemState(state);
  if (rule.outputRarity) next.rarity = rule.outputRarity;
  const added = [];
  for (let index = 0; index < Number(rule.addCount || 0); index += 1) {
    const event = weightedChoice(eligibleModifierEvents(data, next, {
      ...rule,
      allowedSources: rule.allowedSources || ['normal'],
      catalystWeighting: Boolean(rule.catalystWeighting)
    }), rng);
    if (!event) throw new Error(`${currency.name} 在当前底材、物等、词缀组、槽位与最低词缀等级规则下没有可用结果。`);
    next = addAffix(data, next, {
      modifierId: event.modifierId,
      tier: event.tier,
      source: event.source,
      poolSource: event.source,
      type: event.type,
      min: event.min,
      max: event.max,
      metadata: {
        currencyId: currency.id,
        rawWeight: event.rawWeight,
        weightMultiplier: event.weightMultiplier,
        minimumLevelFallback: event.minimumLevelFallback,
        requestedMinimumModifierLevel: event.requestedMinimumModifierLevel,
        catalystWeighting: event.catalystWeighting
      }
    });
    added.push(next.affixes[next.affixes.length - 1]);
  }
  return { state: next, added, removed: [] };
}

function chooseRemoval(state, rule, rng) {
  const candidates = removableAffixes(state, rule);
  if (!candidates.length) return null;
  if (rule.removeRule === 'lowest_level') {
    const minimum = Math.min(...candidates.map((affix) => Number(affix.modifierLevel ?? (affix.unrevealed ? 1 : 0))));
    const lowest = candidates.filter((affix) => Number(affix.modifierLevel ?? (affix.unrevealed ? 1 : 0)) === minimum);
    return lowest[Math.floor(rng() * lowest.length)] || lowest[0];
  }
  return candidates[Math.floor(rng() * candidates.length)] || candidates[0];
}

function sampleRemove(data, state, rule, currency, rng) {
  let next = cloneItemState(state);
  const removed = [];
  for (let index = 0; index < Number(rule.removeCount || 0); index += 1) {
    const chosen = chooseRemoval(next, rule, rng);
    if (!chosen) throw new Error(`${currency.name} 没有可移除词缀。`);
    const result = removeAffix(data, next, chosen.instanceId);
    next = result.state;
    removed.push(result.removed);
  }
  return { state: next, added: [], removed };
}

function sampleReroll(data, state, rule, currency, rng) {
  let next = cloneItemState(state);
  const removed = [];
  if (rule.retainExisting === false) {
    // 重铸类通货不会改写已经破裂/锁定的显式词缀。普通显式词缀被移除，
    // 然后把物品补到通货规定的“结果总词缀数”，而不是在保留词缀之外再额外增加。
    const retained = [];
    for (const affix of next.affixes) {
      const explicit = ['prefix', 'suffix'].includes(affix.type);
      if (!explicit || affix.fractured || affix.locked) retained.push(affix);
      else removed.push(affix);
    }
    next.affixes = retained;
    next.flags.desecrated = next.affixes.some((affix) => affix.source === 'desecrated');
  }
  if (rule.outputRarity) next.rarity = rule.outputRarity;
  const targetExplicit = Number(rule.addCount || 0);
  const existingExplicit = affixCounts(next).explicit;
  const requiredAdds = rule.retainExisting === false
    ? Math.max(0, targetExplicit - existingExplicit)
    : targetExplicit;
  const addResult = sampleAdd(data, next, { ...rule, addCount: requiredAdds }, currency, rng);
  return { state: addResult.state, added: addResult.added, removed };
}

function sampleReplace(data, state, rule, currency, rng) {
  const removeResult = sampleRemove(data, state, rule, currency, rng);
  const addResult = sampleAdd(data, removeResult.state, { ...rule, addCount: rule.addCount || 1 }, currency, rng);
  return { state: addResult.state, added: addResult.added, removed: removeResult.removed };
}

function fractureCandidates(state) {
  return removableAffixes(state).filter((affix) => affix.source !== 'desecrated');
}

function sampleFracture(_data, state, _rule, currency, rng) {
  const next = cloneItemState(state);
  const candidates = fractureCandidates(next);
  const chosen = candidates[Math.floor(rng() * candidates.length)] || candidates[0];
  if (!chosen) throw new Error(`${currency.name} 没有可破裂词缀。`);
  const target = next.affixes.find((affix) => affix.instanceId === chosen.instanceId);
  target.fractured = true;
  target.locked = true;
  return { state: next, added: [], removed: [], fractured: [target] };
}

function availableDesecrationSides(data, state, rule) {
  const base = indexesFor(data).baseById.get(state.baseId);
  const counts = affixCounts(state);
  const limits = sideLimits(base, state.rarity, state);
  const sides = [];
  for (const side of ['prefix', 'suffix']) {
    if (rule.forceSide && rule.forceSide !== side) continue;
    if (counts[side] < limits[side]) sides.push(side);
  }
  return sides;
}

function chooseDesecrationSideByPool(data, state, rule, rng) {
  const sides = availableDesecrationSides(data, state, rule);
  if (!sides.length) return null;
  const weightedSides = sides.map((side) => {
    const minModifierLevel = rule.disableMinimumModifierLevel ? 0 : Number(rule.minModifierLevel || 0);
    const normal = eligibleModifierEvents(data, state, { forceSide: side, minModifierLevel, allowedSources: ['normal'] });
    const exclusive = rule.excludeExclusiveDesecrated ? [] : eligibleModifierEvents(data, state, {
      forceSide: side,
      minModifierLevel,
      allowedSources: ['desecrated'],
      excludedTags: rule.blockedTags || []
    });
    return { side, weight: [...normal, ...exclusive].reduce((sum, event) => sum + event.weight, 0) || 1 };
  });
  return weightedChoice(weightedSides, rng)?.side || sides[0];
}

function sampleDesecrate(data, state, rule, currency, rng) {
  let next = cloneItemState(state);
  const removed = [];
  const added = [];
  const base = indexesFor(data).baseById.get(state.baseId);
  const limits = sideLimits(base, state.rarity, state);
  const totalLimit = limits.total;

  if (rule.replaceAllWithUnrevealed) {
    const removableExplicit = next.affixes.filter((affix) => ['prefix', 'suffix'].includes(affix.type) && !affix.fractured);
    removed.push(...removableExplicit);
    next.affixes = next.affixes.filter((affix) => !['prefix', 'suffix'].includes(affix.type) || affix.fractured);
    next.flags.corrupted = true;
    const existing = affixCounts(next);
    const missingPrefixes = Math.max(0, limits.prefix - existing.prefix);
    const missingSuffixes = Math.max(0, limits.suffix - existing.suffix);
    const count = missingPrefixes + missingSuffixes;
    next.metadata.maxDesecratedModifiers = count;
    next.metadata.putrefaction = true;
    next.metadata.putrefactionModel = 'fills-all-non-fractured-explicit-slots';
    for (let index = 0; index < missingPrefixes; index += 1) {
      next = addAffix(data, next, {
        unrevealedDesecrated: true,
        type: 'prefix',
        metadata: {
          boneId: currency.id,
          boneMinModifierLevel: 0,
          putrefaction: true,
          excludeExclusiveDesecrated: true,
          disableMinimumModifierLevel: true
        }
      });
      added.push(next.affixes[next.affixes.length - 1]);
    }
    for (let index = 0; index < missingSuffixes; index += 1) {
      next = addAffix(data, next, {
        unrevealedDesecrated: true,
        type: 'suffix',
        metadata: {
          boneId: currency.id,
          boneMinModifierLevel: 0,
          putrefaction: true,
          excludeExclusiveDesecrated: true,
          disableMinimumModifierLevel: true
        }
      });
      added.push(next.affixes[next.affixes.length - 1]);
    }
    return { state: next, added, removed };
  }

  const counts = affixCounts(next);
  let side;
  if (counts.explicit >= totalLimit) {
    const chosen = chooseRemoval(next, rule.forceSide ? { removeSide: rule.forceSide } : {}, rng);
    if (!chosen) throw new Error('词缀已满，但没有符合当前方向的可随机移除词缀。');
    side = chosen.type;
    const result = removeAffix(data, next, chosen.instanceId);
    next = result.state;
    removed.push(result.removed);
  } else {
    side = chooseDesecrationSideByPool(data, next, rule, rng);
    if (!side) throw new Error(`${currency.name} 没有可用的前缀或后缀槽位。`);
  }

  next.metadata.maxDesecratedModifiers = 1;
  next = addAffix(data, next, {
    unrevealedDesecrated: true,
    type: side,
    metadata: {
      boneId: currency.id,
      boneMinModifierLevel: rule.disableMinimumModifierLevel ? 0 : Number(rule.minModifierLevel || 0),
      guaranteedTag: rule.guaranteedTag || null,
      blockedTags: rule.blockedTags || [],
      disableMinimumModifierLevel: Boolean(rule.disableMinimumModifierLevel),
      excludeExclusiveDesecrated: Boolean(rule.excludeExclusiveDesecrated)
    }
  });
  added.push(next.affixes[next.affixes.length - 1]);
  return {
    state: next,
    added,
    removed,
    probabilityCaveat: counts.explicit < totalLimit && !rule.forceSide
      ? '亵渎前后缀方向按当前可揭示词缀池总权重动态选择；具体专属词缀权重来自社区推导数据。'
      : null
  };
}

function consumeCatalystIfRequired(result, rule) {
  if (!rule.consumeCatalystQualityForWeight) return null;
  const catalyst = result.state.catalyst;
  const consumed = catalyst && Number(catalyst.quality || 0) > 0 ? { ...catalyst } : null;
  if (catalyst) result.state.catalyst = null;
  return consumed;
}

function applyCurrencySample(data, state, currencyId, options = {}) {
  const check = canApplyCurrency(data, state, currencyId);
  if (!check.ok) throw new Error(check.reason);
  const rng = options.rng || Math.random;
  const { currency, rule } = check;
  let result;
  if (rule.category === 'add') result = sampleAdd(data, state, rule, currency, rng);
  else if (rule.category === 'remove') result = sampleRemove(data, state, rule, currency, rng);
  else if (rule.category === 'reroll') result = sampleReroll(data, state, rule, currency, rng);
  else if (rule.category === 'replace') result = sampleReplace(data, state, rule, currency, rng);
  else if (rule.category === 'fracture') result = sampleFracture(data, state, rule, currency, rng);
  else if (rule.category === 'desecrate') result = sampleDesecrate(data, state, rule, currency, rng);
  else throw new Error(`尚未实现通货类别：${rule.category}`);

  const consumedCatalyst = consumeCatalystIfRequired(result, rule);
  const consumedOmens = consumeTriggeredOmens(data, result.state, currencyId, currency);
  appendHistory(result.state, {
    action: 'currency',
    currencyId,
    currencyName: currency.name,
    added: result.added.map((affix) => affix.instanceId),
    removed: result.removed.map((affix) => affix.instanceId),
    fractured: (result.fractured || []).map((affix) => affix.instanceId),
    consumedOmens,
    consumedCatalyst,
    probabilityCaveat: result.probabilityCaveat || null
  });
  const validation = validateItemState(data, result.state);
  if (!validation.ok) throw new Error(`通货应用后状态无效：${validation.errors.join('；')}`);
  return { ...result, currency, consumedOmens, consumedCatalyst };
}

function enumerateSingleAddOutcomes(data, state, currencyId) {
  const check = canApplyCurrency(data, state, currencyId);
  if (!check.ok) return { ok: false, reason: check.reason, outcomes: [] };
  const { currency, rule } = check;
  if (rule.category !== 'add' || Number(rule.addCount || 0) !== 1) {
    return { ok: false, reason: '当前精确枚举只支持一次增加 1 条词缀的通货。', outcomes: [] };
  }
  const startingState = cloneItemState(state);
  if (rule.outputRarity) startingState.rarity = rule.outputRarity;
  const events = eligibleModifierEvents(data, startingState, {
    ...rule,
    allowedSources: rule.allowedSources || ['normal'],
    catalystWeighting: Boolean(rule.catalystWeighting)
  });
  const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
  if (!(totalWeight > 0) || !events.length) {
    return { ok: false, reason: '当前状态没有正权重的合法新增词缀。', outcomes: [] };
  }
  const outcomes = events.map((event) => {
    const next = addAffix(data, startingState, {
      modifierId: event.modifierId,
      tier: event.tier,
      source: event.source,
      poolSource: event.source,
      type: event.type,
      min: event.min,
      max: event.max,
      metadata: {
        currencyId,
        rawWeight: event.rawWeight,
        weightMultiplier: event.weightMultiplier,
        minimumLevelFallback: event.minimumLevelFallback,
        catalystWeighting: event.catalystWeighting
      }
    });
    const wrapper = { state: next };
    const consumedCatalyst = consumeCatalystIfRequired(wrapper, rule);
    const consumedOmens = consumeTriggeredOmens(data, wrapper.state, currencyId, currency);
    return {
      event,
      probability: totalWeight > 0 ? event.weight / totalWeight : 0,
      state: wrapper.state,
      consumedCatalyst,
      consumedOmens
    };
  });
  return { ok: true, currency, totalWeight, outcomes };
}

function seededRandom(seedValue) {
  let value = (Number(seedValue) || 1) >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function affixLabel(affix) {
  if (!affix) return '未知';
  if (affix.unrevealed) return `未揭示亵渎${affix.type === 'prefix' ? '前缀' : '后缀'}`;
  if (affix.unknown) return affix.type === 'prefix' ? '未识别前缀' : '未识别后缀';
  return `${affix.name || affix.modifierId}${affix.tier ? ` T${affix.tier}` : ''}`;
}

function summarizeSampleResult(result) {
  const added = (result.added || []).map(affixLabel);
  const removed = (result.removed || []).map(affixLabel);
  const fractured = (result.fractured || []).map(affixLabel);
  const parts = [];
  if (removed.length) parts.push(`移除：${removed.join('、')}`);
  if (added.length) parts.push(`新增：${added.join('、')}`);
  if (fractured.length) parts.push(`破裂：${fractured.join('、')}`);
  return parts.join('；') || '状态未改变';
}

function resultSignature(result) {
  const encode = (affix) => affix.unrevealed ? `unrevealed:${affix.type}` : affix.unknown ? `unknown:${affix.type}` : `${affix.modifierId}:T${affix.tier}:${affix.source}`;
  const added = (result.added || []).map(encode).sort();
  const removed = (result.removed || []).map(encode).sort();
  const fractured = (result.fractured || []).map(encode).sort();
  return `${stateKey(result.state)}|A=${added.join(',')}|R=${removed.join(',')}|F=${fractured.join(',')}`;
}

function previewCurrencyOutcomes(data, state, currencyId, options = {}) {
  const check = canApplyCurrency(data, state, currencyId);
  if (!check.ok) return { ok: false, exact: false, reason: check.reason, outcomes: [] };

  const exact = enumerateSingleAddOutcomes(data, state, currencyId);
  if (exact.ok) {
    const outcomes = exact.outcomes
      .sort((left, right) => right.probability - left.probability)
      .map((entry) => ({
        event: entry.event,
        summary: `新增：${entry.event.name} T${entry.event.tier}`,
        probability: entry.probability,
        occurrences: null,
        added: [entry.event],
        removed: [],
        fractured: [],
        state: entry.state
      }));
    return { ok: true, exact: true, currency: exact.currency, totalWeight: exact.totalWeight, sampleCount: null, failedSamples: 0, outcomeCount: outcomes.length, outcomes };
  }

  const sampleCount = Math.max(200, Math.min(20000, Math.floor(Number(options.samples) || 5000)));
  const rng = options.rng || seededRandom(options.seed || 20260618);
  const grouped = new Map();
  let failedSamples = 0;
  let firstFailure = null;
  for (let index = 0; index < sampleCount; index += 1) {
    try {
      const result = applyCurrencySample(data, state, currencyId, { rng });
      const signature = resultSignature(result);
      const current = grouped.get(signature);
      if (current) current.occurrences += 1;
      else grouped.set(signature, {
        summary: summarizeSampleResult(result), occurrences: 1,
        added: result.added || [], removed: result.removed || [], fractured: result.fractured || [], state: result.state,
        probabilityCaveat: result.probabilityCaveat || null
      });
    } catch (error) {
      failedSamples += 1;
      firstFailure ||= error.message;
    }
  }
  const successfulSamples = sampleCount - failedSamples;
  const outcomes = [...grouped.values()]
    .map((entry) => ({ ...entry, probability: successfulSamples > 0 ? entry.occurrences / successfulSamples : 0 }))
    .sort((left, right) => right.probability - left.probability || left.summary.localeCompare(right.summary));
  return {
    ok: successfulSamples > 0, exact: false, currency: check.currency,
    reason: successfulSamples > 0 ? null : (firstFailure || '没有生成有效结果。'),
    totalWeight: null, sampleCount, failedSamples, outcomeCount: outcomes.length, outcomes
  };
}

function findUnrevealedDesecrated(state, instanceId = null) {
  return state.affixes.find((affix) => affix.unrevealed && affix.source === 'desecrated' && (!instanceId || affix.instanceId === instanceId)) || null;
}

function revealWorkingState(data, state, placeholder) {
  const next = cloneItemState(state);
  next.affixes = next.affixes.filter((affix) => affix.instanceId !== placeholder.instanceId);
  next.flags.desecrated = next.affixes.some((affix) => affix.source === 'desecrated');
  const validation = validateItemState(data, next);
  if (!validation.ok) throw new Error(`构建揭示词缀池失败：${validation.errors.join('；')}`);
  return next;
}

function buildDesecratedRevealOptions(data, state, options = {}) {
  const placeholder = findUnrevealedDesecrated(state, options.instanceId);
  if (!placeholder) return { ok: false, reason: '没有未揭示的亵渎词缀。', options: [] };
  const effects = activeOmenEffects(data, state, 'reveal_desecrated');
  const canReroll = effects.some((effect) => effect.allowRerollOnce);
  const rerollIndex = Math.max(0, Number(options.rerollIndex || 0));
  if (rerollIndex > 1) return { ok: false, reason: '深渊回响预兆最多只允许重骰一次。', options: [] };
  if (rerollIndex > 0 && !canReroll) return { ok: false, reason: '没有激活深渊回响预兆，不能重骰揭示选项。', options: [] };

  const working = revealWorkingState(data, state, placeholder);
  const forceSide = placeholder.type;
  const metadata = placeholder.metadata || {};
  const minModifierLevel = metadata.disableMinimumModifierLevel ? 0 : Math.max(0, Number(metadata.boneMinModifierLevel || 0));
  const blockedTags = [...new Set(metadata.blockedTags || [])];
  const normal = eligibleModifierEvents(data, working, { forceSide, minModifierLevel, allowedSources: ['normal'] });
  let exclusive = metadata.excludeExclusiveDesecrated
    ? []
    : eligibleModifierEvents(data, working, { forceSide, minModifierLevel, allowedSources: ['desecrated'], excludedTags: blockedTags });

  const guaranteedTag = metadata.guaranteedTag || null;
  const seed = (Number(options.seed) || 20260618) + (rerollIndex * 104729);
  const rng = options.rng || seededRandom(seed);
  const chosen = [];
  let guaranteedTagUnavailable = false;

  if (guaranteedTag) {
    const tagged = exclusive.filter((event) => event.tags.includes(guaranteedTag));
    const guaranteed = weightedChoice(tagged, rng);
    if (guaranteed) chosen.push(guaranteed);
    else {
      // 巫妖预兆会被消耗；若当前底材没有对应巫妖词缀，只显示普通词缀，且另外两位巫妖仍被屏蔽。
      guaranteedTagUnavailable = true;
      exclusive = [];
    }
  } else if (!metadata.excludeExclusiveDesecrated) {
    const base = indexesFor(data).baseById.get(state.baseId);
    const baseTags = new Set(base?.tags || []);
    const requiresExclusive = Number(state.itemLevel) >= 65 && !baseTags.has('jewel') && !baseTags.has('waystone') && exclusive.length > 0;
    if (requiresExclusive) {
      const guaranteed = weightedChoice(exclusive, rng);
      if (guaranteed) chosen.push(guaranteed);
    }
  }

  if (!normal.length && !exclusive.length && !chosen.length) {
    return { ok: false, reason: '当前底材、词缀类型与物等下没有可揭示结果。', options: [] };
  }
  const combined = [...normal, ...exclusive];
  const offers = weightedChoiceWithoutReplacement(combined, 3, rng, chosen);
  const normalWeight = normal.reduce((sum, event) => sum + event.weight, 0);
  const exclusiveWeight = exclusive.reduce((sum, event) => sum + event.weight, 0);
  return {
    ok: offers.length > 0,
    placeholder,
    options: offers,
    canReroll,
    rerollIndex,
    poolSummary: {
      normalEvents: normal.length,
      exclusiveEvents: exclusive.length,
      normalWeight,
      exclusiveWeight,
      minModifierLevel,
      forceSide,
      guaranteedTag,
      guaranteedTagUnavailable,
      blockedTags,
      excludeExclusiveDesecrated: Boolean(metadata.excludeExclusiveDesecrated),
      minimumLevelFallbackEvents: [...normal, ...exclusive].filter((event) => event.minimumLevelFallback).length,
      weightSource: '社区推导权重；亵渎专属、巫妖预兆与腐败预兆规则会在加权抽取前生效'
    }
  };
}

function applyDesecratedReveal(data, state, selection = {}) {
  const preview = buildDesecratedRevealOptions(data, state, selection);
  if (!preview.ok) throw new Error(preview.reason);
  const selected = preview.options.find((event) =>
    event.modifierId === selection.modifierId && Number(event.tier) === Number(selection.tier)
  );
  if (!selected) throw new Error('所选词缀不在当前揭示选项中；请使用相同种子重新预览。');
  let next = cloneItemState(state);
  const index = next.affixes.findIndex((affix) => affix.instanceId === preview.placeholder.instanceId);
  if (index < 0) throw new Error('未揭示词缀已不存在。');
  next.affixes.splice(index, 1);
  next.flags.desecrated = next.affixes.some((affix) => affix.source === 'desecrated');
  next = addAffix(data, next, {
    modifierId: selected.modifierId,
    tier: selected.tier,
    type: selected.type,
    source: 'desecrated',
    poolSource: selected.source,
    min: selected.min,
    max: selected.max,
    metadata: {
      revealedAtWell: true,
      exclusiveDesecrated: selected.source === 'desecrated',
      originalPoolSource: selected.source,
      revealSeed: Number(selection.seed) || 20260618,
      rerollIndex: Number(selection.rerollIndex || 0),
      minimumLevelFallback: selected.minimumLevelFallback
    }
  });
  const consumedOmens = consumeTriggeredOmens(data, next, 'reveal_desecrated');
  appendHistory(next, {
    action: 'reveal-desecrated',
    placeholder: preview.placeholder.instanceId,
    selected: `${selected.modifierId}:T${selected.tier}`,
    exclusive: selected.source === 'desecrated',
    consumedOmens
  });
  const validation = validateItemState(data, next);
  if (!validation.ok) throw new Error(`揭示后状态无效：${validation.errors.join('；')}`);
  return { ok: true, state: next, selected, consumedOmens, poolSummary: preview.poolSummary };
}

function modifierProbabilityReport(data, state, options = {}) {
  const events = eligibleModifierEvents(data, state, options);
  const totalWeight = events.reduce((sum, event) => sum + event.weight, 0);
  const byModifier = new Map();
  for (const event of events) {
    const current = byModifier.get(event.modifierId) || { modifierId: event.modifierId, name: event.name, type: event.type, source: event.source, weight: 0, tiers: [] };
    current.weight += event.weight;
    current.tiers.push({ tier: event.tier, level: event.modifierLevel, weight: event.weight, minimumLevelFallback: event.minimumLevelFallback });
    byModifier.set(event.modifierId, current);
  }
  return {
    totalWeight,
    eventCount: events.length,
    modifiers: [...byModifier.values()]
      .map((entry) => ({ ...entry, probability: totalWeight > 0 ? entry.weight / totalWeight : 0 }))
      .sort((a, b) => b.probability - a.probability)
  };
}

module.exports = {
  modifierAllowedOnBase,
  activeOmenEffects,
  effectiveRule,
  baseMatchesCurrency,
  canApplyCurrency,
  eligibleModifierEvents,
  weightedChoice,
  weightedChoiceWithoutReplacement,
  applyCurrencySample,
  enumerateSingleAddOutcomes,
  previewCurrencyOutcomes,
  removableAffixes,
  hasFracturedAffix,
  fractureCandidates,
  buildDesecratedRevealOptions,
  applyDesecratedReveal,
  modifierProbabilityReport,
  catalystWeightMultiplier,
  modifierMatchesCatalystTag,
  seededRandom
};
