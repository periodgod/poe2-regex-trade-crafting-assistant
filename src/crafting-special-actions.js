'use strict';

const {
  cloneItemState,
  addAffix,
  removeAffix,
  validateItemState,
  modifierFamilies,
  affixFamilies
} = require('./item-state');
const { seededRandom } = require('./currency-state-machine');

const SOCKETABLE_CRAFT_TYPES = new Set(['alloy']);
const SOCKETABLE_EQUIP_TYPES = new Set(['rune', 'soulcore', 'idol', 'abyssal_eye', 'augment', 'socketable']);
const SOCKETABLE_REFERENCE_TYPES = new Set(['flux']);

function indexesFor(data) {
  return data.indexes || {
    baseById: new Map((data.bases || []).map((entry) => [entry.id, entry])),
    modifierById: new Map((data.modifiers || []).map((entry) => [entry.id, entry])),
    essenceById: new Map((data.essences || []).map((entry) => [entry.id, entry])),
    socketableById: new Map((data.socketables || []).map((entry) => [entry.id, entry])),
    omenById: new Map((data.omens || []).map((entry) => [entry.id, entry]))
  };
}

function compatibleEssenceEffect(essence, state) {
  return (essence?.effects || []).find((effect) => effect.baseId === state.baseId) || null;
}

function compatibleSocketableEffect(entry, state) {
  return (entry?.effects || []).find((effect) => (effect.compatibleBaseIds || []).includes(state.baseId)) || null;
}

function resolveSourceModifier(data, state, effect) {
  const indexes = indexesFor(data);
  if (effect?.modifierId && indexes.modifierById.has(effect.modifierId)) return indexes.modifierById.get(effect.modifierId);
  const sourceModifierId = String(effect?.sourceModifierId || '');
  if (!sourceModifierId) return null;
  return (data.modifiers || []).find((modifier) =>
    String(modifier.sourceMeta?.sourceModifierId || '') === sourceModifierId &&
    (modifier.allowedBaseIds || []).includes(state.baseId)
  ) || null;
}

function resolveGuaranteedTier(modifier, effect, itemLevel) {
  const available = (modifier?.tiers || [])
    .filter((tier) => Number(tier.level) <= Number(itemLevel))
    .sort((left, right) => Number(left.tier) - Number(right.tier));
  if (!available.length) return null;
  const requestedLevel = Number(effect?.modifierLevel);
  if (Number.isFinite(requestedLevel)) {
    const exact = available.find((tier) => Number(tier.level) === requestedLevel);
    if (exact) return exact;
    const notAboveRequested = available
      .filter((tier) => Number(tier.level) <= requestedLevel)
      .sort((left, right) => Number(right.level) - Number(left.level) || Number(left.tier) - Number(right.tier));
    if (notAboveRequested.length) return notAboveRequested[0];
  }
  return available[0];
}

function guaranteedAffix(data, state, effect, source, actionId) {
  const modifier = resolveSourceModifier(data, state, effect);
  if (!modifier) {
    throw new Error(`当前严格快照无法把保证效果“${effect?.modifierName || effect?.sourceModifierName || '未知词缀'}”映射到当前底材词缀；不会伪造结果。`);
  }
  const tier = resolveGuaranteedTier(modifier, effect, state.itemLevel);
  if (!tier) throw new Error(`${modifier.name} 在当前物品等级不可用。`);
  return {
    modifierId: modifier.id,
    tier: Number(tier.tier),
    type: modifier.type,
    source,
    poolSource: modifier.source || source,
    min: tier.min ?? null,
    max: tier.max ?? null,
    metadata: {
      specialActionId: actionId,
      guaranteed: true,
      sourceModifierId: effect?.sourceModifierId || modifier.sourceMeta?.sourceModifierId || null,
      requestedModifierLevel: Number(effect?.modifierLevel || 0) || null
    }
  };
}

function matchingOmens(data, state, triggerCategory) {
  const indexes = indexesFor(data);
  return (state.activeOmens || [])
    .map((id) => indexes.omenById.get(id))
    .filter(Boolean)
    .filter((omen) => {
      const categories = Array.isArray(omen.triggerCategory) ? omen.triggerCategory : [omen.triggerCategory];
      return categories.filter(Boolean).includes(triggerCategory);
    });
}

function essenceRemovalRule(data, state) {
  const omens = matchingOmens(data, state, 'essence-replace');
  const sides = [...new Set(omens.map((omen) => omen.effect?.removeSide).filter(Boolean))];
  if (sides.length > 1) return { conflict: true, omens, sides };
  return { conflict: false, omens, removeSide: sides[0] || null };
}

function removableCandidates(state, removeSide = null) {
  return (state.affixes || []).filter((affix) =>
    ['prefix', 'suffix'].includes(affix.type) &&
    !affix.locked && !affix.fractured &&
    (!removeSide || affix.type === removeSide)
  );
}

function addGuaranteedAfterOptionalRemoval(data, state, affixInput, removal = null) {
  let next = cloneItemState(state);
  let removed = null;
  if (removal) {
    const result = removeAffix(data, next, removal.instanceId);
    next = result.state;
    removed = result.removed;
  }
  next = addAffix(data, next, affixInput);
  return { state: next, removed, added: next.affixes[next.affixes.length - 1] };
}

function previewEssence(data, state, essenceId) {
  const essence = indexesFor(data).essenceById.get(essenceId);
  if (!essence) return { ok: false, reason: `未知精华：${essenceId}` };
  if (state.flags?.mirrored) return { ok: false, reason: '镜像物品不能使用精华。' };
  if (state.flags?.corrupted) return { ok: false, reason: '腐化物品不能使用精华。' };
  const effect = compatibleEssenceEffect(essence, state);
  if (!effect) return { ok: false, reason: `${essence.name} 对当前精确底材没有保证词缀记录。` };

  let affixInput;
  try { affixInput = guaranteedAffix(data, state, effect, 'essence', essence.id); }
  catch (error) { return { ok: false, reason: error.message }; }

  if (!essence.corrupted) {
    if (state.rarity !== 'magic') return { ok: false, reason: `${essence.name} 只能用于魔法物品。` };
    try {
      const upgraded = cloneItemState(state);
      upgraded.rarity = 'rare';
      const result = addGuaranteedAfterOptionalRemoval(data, upgraded, affixInput);
      return {
        ok: true,
        kind: 'essence',
        exact: true,
        deterministic: true,
        action: essence,
        effect,
        outcomes: [{ probability: 1, state: result.state, added: result.added, removed: null }],
        summary: `升级为稀有并保证加入：${result.added.name} T${result.added.tier}`
      };
    } catch (error) {
      return { ok: false, reason: `保证词缀无法加入当前物品：${error.message}` };
    }
  }

  if (state.rarity !== 'rare') return { ok: false, reason: `${essence.name} 只能用于稀有物品。` };
  const rule = essenceRemovalRule(data, state);
  if (rule.conflict) return { ok: false, reason: '同时激活了互相冲突的左旋与右旋结晶预兆，请只保留一个。' };
  const candidates = removableCandidates(state, rule.removeSide);
  if (!candidates.length) return { ok: false, reason: rule.removeSide ? `当前没有可移除的${rule.removeSide === 'prefix' ? '前缀' : '后缀'}。` : '当前没有可移除的显式词缀。' };
  const outcomes = [];
  const rejected = [];
  for (const candidate of candidates) {
    try {
      const result = addGuaranteedAfterOptionalRemoval(data, state, affixInput, candidate);
      outcomes.push({ state: result.state, added: result.added, removed: result.removed });
    } catch (error) {
      rejected.push({ instanceId: candidate.instanceId, name: candidate.name, reason: error.message });
    }
  }
  if (!outcomes.length) return { ok: false, reason: '移除任一候选词缀后都无法合法加入保证词缀；通常是词缀组冲突。' };
  const probability = 1 / outcomes.length;
  return {
    ok: true,
    kind: 'essence',
    exact: rejected.length === 0,
    deterministic: false,
    action: essence,
    effect,
    removalSide: rule.removeSide,
    consumedOmenIds: rule.omens.map((omen) => omen.id),
    outcomes: outcomes.map((outcome) => ({ ...outcome, probability })),
    rejected,
    probabilityCaveat: rejected.length
      ? `有 ${rejected.length} 个随机移除候选会导致保证词缀组冲突，已从可执行结果中排除；此时不宣称为游戏精确概率。`
      : null,
    summary: `随机移除 1 条${rule.removeSide ? (rule.removeSide === 'prefix' ? '前缀' : '后缀') : '显式词缀'}，再保证加入 ${outcomes[0].added.name}`
  };
}

function consumeOmens(state, ids) {
  if (!ids?.length) return;
  const consumed = new Set(ids);
  state.activeOmens = (state.activeOmens || []).filter((id) => !consumed.has(id));
}

function appendHistory(state, entry) {
  if (!Array.isArray(state.history)) state.history = [];
  state.history.push({ at: new Date().toISOString(), ...entry });
}

function applyEssence(data, state, essenceId, options = {}) {
  const preview = previewEssence(data, state, essenceId);
  if (!preview.ok) throw new Error(preview.reason);
  const rng = seededRandom(Number(options.seed) || Date.now());
  const index = preview.outcomes.length === 1 ? 0 : Math.min(preview.outcomes.length - 1, Math.floor(rng() * preview.outcomes.length));
  const selected = preview.outcomes[index];
  const next = cloneItemState(selected.state);
  consumeOmens(next, preview.consumedOmenIds || []);
  appendHistory(next, {
    action: 'essence',
    essenceId,
    removed: selected.removed?.instanceId || null,
    added: selected.added?.instanceId || null,
    consumedOmens: preview.consumedOmenIds || [],
    exactProbability: preview.exact
  });
  const validation = validateItemState(data, next);
  if (!validation.ok) throw new Error(`精华执行后状态无效：${validation.errors.join('；')}`);
  return { ok: true, state: next, action: preview.action, added: selected.added, removed: selected.removed, consumedOmens: preview.consumedOmenIds || [], exact: preview.exact, probabilityCaveat: preview.probabilityCaveat || null };
}

function socketableMode(entry) {
  const type = String(entry?.type || '').toLowerCase();
  if (SOCKETABLE_CRAFT_TYPES.has(type)) return 'craft';
  if (SOCKETABLE_EQUIP_TYPES.has(type)) return 'socket';
  if (SOCKETABLE_REFERENCE_TYPES.has(type)) return 'reference';
  return 'socket';
}

function previewSocketable(data, state, socketableId, options = {}) {
  const entry = indexesFor(data).socketableById.get(socketableId);
  if (!entry) return { ok: false, reason: `未知增幅器或合金：${socketableId}` };
  const effect = compatibleSocketableEffect(entry, state);
  if (!effect) return { ok: false, reason: `${entry.name} 与当前精确底材不兼容。` };
  const mode = socketableMode(entry);
  if (mode === 'reference') return { ok: false, reason: `${entry.name} 的目标不是装备做装状态（例如卡古兰技能宝石），这里只展示资料，不伪造装备结果。` };
  if (state.flags?.mirrored) return { ok: false, reason: '镜像物品不能执行该操作。' };
  if (state.flags?.corrupted) return { ok: false, reason: '腐化物品不能执行该操作。' };

  if (mode === 'craft') {
    if (state.rarity !== 'rare') return { ok: false, reason: `${entry.name} 只能用于稀有物品。` };
    let affixInput;
    try { affixInput = guaranteedAffix(data, state, effect, 'special', entry.id); }
    catch (error) { return { ok: false, reason: error.message }; }
    const candidates = removableCandidates(state);
    if (!candidates.length) return { ok: false, reason: '当前没有可移除的显式词缀。' };
    const outcomes = [];
    const rejected = [];
    for (const candidate of candidates) {
      try {
        const result = addGuaranteedAfterOptionalRemoval(data, state, affixInput, candidate);
        outcomes.push({ state: result.state, added: result.added, removed: result.removed });
      } catch (error) {
        rejected.push({ instanceId: candidate.instanceId, name: candidate.name, reason: error.message });
      }
    }
    if (!outcomes.length) return { ok: false, reason: '所有随机移除结果都会与合金保证词缀冲突。' };
    const probability = 1 / outcomes.length;
    return {
      ok: true,
      kind: 'alloy',
      mode,
      exact: rejected.length === 0,
      action: entry,
      effect,
      outcomes: outcomes.map((outcome) => ({ ...outcome, probability })),
      rejected,
      probabilityCaveat: rejected.length ? `有 ${rejected.length} 个随机候选因词缀组冲突被排除，不宣称为游戏精确概率。` : null,
      summary: `随机移除 1 条显式词缀，再保证加入 ${outcomes[0].added.name}`
    };
  }

  const capacity = Math.max(0, Number(state.augmentSocketCapacity || 0));
  if (!capacity) return { ok: false, reason: '请先填写当前物品的增幅器插槽容量。' };
  const slotIndex = Math.max(0, Math.min(capacity - 1, Number(options.slotIndex) || 0));
  const current = (state.installedAugments || []).find((augment) => Number(augment.slotIndex) === slotIndex) || null;
  return {
    ok: true,
    kind: 'socketable',
    mode,
    exact: true,
    deterministic: true,
    action: entry,
    effect,
    slotIndex,
    replacing: current,
    outcomes: [{ probability: 1, state: cloneItemState(state), added: null, removed: null }],
    summary: `${current ? `替换插槽 ${slotIndex + 1} 中的 ${current.name}` : `放入空插槽 ${slotIndex + 1}`}；效果：${entry.chronicleDescriptionLines?.[0] || effect.modifierName || '见编年史说明'}`
  };
}

function applySocketable(data, state, socketableId, options = {}) {
  const preview = previewSocketable(data, state, socketableId, options);
  if (!preview.ok) throw new Error(preview.reason);
  if (preview.mode === 'craft') {
    const rng = seededRandom(Number(options.seed) || Date.now());
    const index = preview.outcomes.length === 1 ? 0 : Math.min(preview.outcomes.length - 1, Math.floor(rng() * preview.outcomes.length));
    const selected = preview.outcomes[index];
    const next = cloneItemState(selected.state);
    appendHistory(next, { action: 'alloy', socketableId, removed: selected.removed?.instanceId || null, added: selected.added?.instanceId || null, exactProbability: preview.exact });
    const validation = validateItemState(data, next);
    if (!validation.ok) throw new Error(`合金执行后状态无效：${validation.errors.join('；')}`);
    return { ok: true, state: next, action: preview.action, added: selected.added, removed: selected.removed, exact: preview.exact, probabilityCaveat: preview.probabilityCaveat || null };
  }

  const next = cloneItemState(state);
  const slotIndex = preview.slotIndex;
  const installed = Array.isArray(next.installedAugments) ? next.installedAugments : [];
  const previousIndex = installed.findIndex((entry) => Number(entry.slotIndex) === slotIndex);
  const record = {
    slotIndex,
    id: preview.action.id,
    name: preview.action.name,
    type: preview.action.type,
    effectText: preview.action.chronicleDescriptionLines?.join('；') || preview.effect.modifierName || '',
    sourceUrl: preview.action.chronicleSourceUrl || null
  };
  let replaced = null;
  if (previousIndex >= 0) {
    replaced = installed[previousIndex];
    installed[previousIndex] = record;
  } else installed.push(record);
  next.installedAugments = installed.sort((left, right) => Number(left.slotIndex) - Number(right.slotIndex));
  appendHistory(next, { action: 'socketable', socketableId, slotIndex, replaced: replaced?.id || null });
  const validation = validateItemState(data, next);
  if (!validation.ok) throw new Error(`镶嵌后状态无效：${validation.errors.join('；')}`);
  return { ok: true, state: next, action: preview.action, installed: record, replaced, exact: true };
}

function previewSpecialAction(data, state, payload = {}) {
  const kind = String(payload.kind || '');
  if (kind === 'essence') return previewEssence(data, state, String(payload.actionId || ''));
  if (kind === 'socketable') return previewSocketable(data, state, String(payload.actionId || ''), payload);
  return { ok: false, reason: `未知特殊做装类型：${kind}` };
}

function applySpecialAction(data, state, payload = {}) {
  const kind = String(payload.kind || '');
  if (kind === 'essence') return applyEssence(data, state, String(payload.actionId || ''), payload);
  if (kind === 'socketable') return applySocketable(data, state, String(payload.actionId || ''), payload);
  throw new Error(`未知特殊做装类型：${kind}`);
}

module.exports = {
  SOCKETABLE_CRAFT_TYPES,
  SOCKETABLE_EQUIP_TYPES,
  SOCKETABLE_REFERENCE_TYPES,
  socketableMode,
  compatibleEssenceEffect,
  compatibleSocketableEffect,
  resolveSourceModifier,
  resolveGuaranteedTier,
  previewEssence,
  applyEssence,
  previewSocketable,
  applySocketable,
  previewSpecialAction,
  applySpecialAction
};
