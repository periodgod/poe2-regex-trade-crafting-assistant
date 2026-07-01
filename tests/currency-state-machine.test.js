'use strict';

const assert = require('node:assert/strict');
const { makeStrictData } = require('./strict-test-data');
const { createItemState, affixCounts } = require('../src/item-state');
const {
  canApplyCurrency,
  eligibleModifierEvents,
  applyCurrencySample,
  enumerateSingleAddOutcomes,
  previewCurrencyOutcomes,
  buildDesecratedRevealOptions,
  applyDesecratedReveal,
  modifierProbabilityReport,
  fractureCandidates
} = require('../src/currency-state-machine');

const data = makeStrictData();
const rng0 = () => 0;

// 基础稀有度流程与魔法物品 1 前缀 + 1 后缀限制。
const normalBow = createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'normal' });
assert.equal(canApplyCurrency(data, normalBow, 'exalt').ok, false);
const transmute = applyCurrencySample(data, normalBow, 'transmute', { rng: rng0 });
assert.equal(transmute.state.rarity, 'magic');
assert.equal(affixCounts(transmute.state).explicit, 1);
const augmented = applyCurrencySample(data, transmute.state, 'augment', { rng: rng0 });
assert.equal(affixCounts(augmented.state).explicit, 2);
assert.equal(affixCounts(augmented.state).prefix, 1);
assert.equal(affixCounts(augmented.state).suffix, 1);
assert.equal(canApplyCurrency(data, augmented.state, 'augment').ok, false);
const regaled = applyCurrencySample(data, augmented.state, 'regal', { rng: rng0 });
assert.equal(regaled.state.rarity, 'rare');
assert.equal(affixCounts(regaled.state).explicit, 3);

const magicZero = createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'magic' });
assert.equal(canApplyCurrency(data, magicZero, 'augment').ok, false);

// “最低词缀等级”不能把整个词缀家族删掉：无达标 T 级时保留该家族最高可用 T 级。
const low = createItemState(data, { baseId: 'bow', itemLevel: 40, rarity: 'normal' });
const lowPerfect = enumerateSingleAddOutcomes(data, low, 'perfect_transmute');
assert.equal(lowPerfect.ok, true);
assert.ok(lowPerfect.outcomes.length > 0);
assert.ok(lowPerfect.outcomes.some((x) => x.event.minimumLevelFallback));
assert.ok(lowPerfect.outcomes.some((x) => x.event.modifierId === 'bow_light_radius'));
const highPerfect = enumerateSingleAddOutcomes(data, normalBow, 'perfect_transmute');
assert.ok(highPerfect.outcomes.some((x) => x.event.modifierLevel >= 70));
assert.ok(highPerfect.outcomes.some((x) => x.event.minimumLevelFallback));

// 点金、预览和动态池。
const alchemyMagic = createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'magic', affixes: [{ modifierId: 'bow_phys', tier: 2 }] });
const alchemied = applyCurrencySample(data, alchemyMagic, 'alchemy', { rng: () => 0.42 });
assert.equal(alchemied.state.rarity, 'rare');
assert.equal(affixCounts(alchemied.state).explicit, 4);
const exactPreview = previewCurrencyOutcomes(data, normalBow, 'transmute', { seed: 7, samples: 500 });
assert.equal(exactPreview.exact, true);
assert.ok(exactPreview.outcomes.length > 0);
const sampledPreview = previewCurrencyOutcomes(data, alchemyMagic, 'alchemy', { seed: 7, samples: 500 });
assert.equal(sampledPreview.exact, false);
assert.equal(sampledPreview.sampleCount, 500);
assert.ok(Math.abs(sampledPreview.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-9);

const rare = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  affixes: [{ modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_cold', tier: 2 }, { modifierId: 'bow_speed', tier: 2 }]
});
const events = eligibleModifierEvents(data, rare, { allowedSources: ['normal'] });
assert.ok(events.every((x) => x.source === 'normal'));
assert.equal(events.some((x) => x.modifierId === 'ring_fire_res'), false);
assert.equal(events.some((x) => x.source === 'desecrated'), false, '普通通货不得抽取亵渎专属池');
const beforeBlock = modifierProbabilityReport(data, createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'rare' }), { allowedSources: ['normal'] });
const afterBlock = modifierProbabilityReport(data, rare, { allowedSources: ['normal'] });
assert.notEqual(beforeBlock.totalWeight, afterBlock.totalWeight, '已有词缀家族和槽位必须动态改变概率池');
assert.equal(afterBlock.modifiers.some((x) => x.modifierId === 'bow_phys'), false);

const annulled = applyCurrencySample(data, rare, 'annul', { rng: rng0 });
assert.equal(affixCounts(annulled.state).explicit, 2);
const chaos = applyCurrencySample(data, rare, 'chaos', { rng: () => 0.9 });
assert.equal(chaos.removed.length, 1);
assert.equal(chaos.added.length, 1);

// 削切预兆把未揭示亵渎词缀视作词缀等级 1。
const whittlingState = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_whittling'],
  affixes: [{ modifierId: 'bow_phys', tier: 2 }, { unrevealedDesecrated: true, type: 'suffix' }]
});
const whittled = applyCurrencySample(data, whittlingState, 'perfect_chaos', { rng: rng0 });
assert.equal(whittled.removed[0].unrevealed, true);
assert.ok(whittled.consumedOmens.includes('omen_whittling'));

// 破裂：亵渎词缀计入 4 条门槛，但本身不能成为破裂目标。
const fourWithDesecrated = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  affixes: [
    { modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_cold', tier: 2 },
    { modifierId: 'bow_speed', tier: 2 }, { modifierId: 'bow_kurgal_suffix', tier: 1, source: 'desecrated', poolSource: 'desecrated' }
  ]
});
assert.equal(affixCounts(fourWithDesecrated).explicit, 4);
assert.ok(fractureCandidates(fourWithDesecrated).every((x) => x.source !== 'desecrated'));
const fractured = applyCurrencySample(data, fourWithDesecrated, 'fracturing', { rng: () => 0.999 });
assert.notEqual(fractured.fractured[0].source, 'desecrated');
assert.equal(canApplyCurrency(data, fractured.state, 'fracturing').ok, false);

// 骨材限制、普通亵渎揭示和远古最低词缀等级回退。
assert.equal(canApplyCurrency(data, rare, 'gnawed_jawbone').ok, false, '啃噬颚骨只能用于物等 64 以下');
const boneInput = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  affixes: [{ modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_speed', tier: 2 }]
});
const desecrated = applyCurrencySample(data, boneInput, 'ancient_jawbone', { rng: () => 0.999 });
assert.equal(affixCounts(desecrated.state).unrevealedDesecrated, 1);
const revealPreview = buildDesecratedRevealOptions(data, desecrated.state, { seed: 9 });
assert.equal(revealPreview.ok, true);
assert.ok(revealPreview.options.length <= 3);
assert.equal(new Set(revealPreview.options.map((x) => x.modifierId)).size, revealPreview.options.length, '揭示选项不得重复同一词缀的不同 T 级');
assert.ok(revealPreview.poolSummary.minimumLevelFallbackEvents > 0, '远古骨材也必须执行家族保底回退');
const revealed = applyDesecratedReveal(data, desecrated.state, {
  seed: 9,
  modifierId: revealPreview.options[0].modifierId,
  tier: revealPreview.options[0].tier
});
assert.equal(affixCounts(revealed.state).unrevealedDesecrated, 0);
assert.equal(affixCounts(revealed.state).desecrated, 1);

// 巫妖预兆：保证目标、屏蔽另外两位、禁用远古最低等级；无目标时仍消耗且只给普通词缀。
const blackbloodedInput = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_blackblooded'],
  affixes: [{ modifierId: 'bow_speed', tier: 2 }]
});
const blackbloodedBone = applyCurrencySample(data, blackbloodedInput, 'ancient_jawbone', { rng: rng0 });
assert.ok(blackbloodedBone.consumedOmens.includes('omen_blackblooded'));
const blackPlaceholder = blackbloodedBone.state.affixes.find((x) => x.unrevealed);
assert.equal(blackPlaceholder.metadata.boneMinModifierLevel, 0);
const blackOptions = buildDesecratedRevealOptions(data, blackbloodedBone.state, { seed: 3 });
assert.ok(blackOptions.options.some((x) => x.tags.includes('kurgal_mod')));
assert.equal(blackOptions.options.some((x) => x.tags.includes('amanamu_mod') || x.tags.includes('ulaman_mod')), false);
assert.equal(new Set(blackOptions.options.map((x) => x.modifierId)).size, blackOptions.options.length, '巫妖保证选项也不得重复');

const unavailableInput = createItemState(data, {
  baseId: 'ring', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_liege'],
  affixes: [{ modifierId: 'ring_fire_res', tier: 1 }]
});
const unavailableBone = applyCurrencySample(data, unavailableInput, 'ancient_collarbone', { rng: rng0 });
const unavailableOptions = buildDesecratedRevealOptions(data, unavailableBone.state, { seed: 4 });
assert.equal(unavailableOptions.poolSummary.guaranteedTagUnavailable, true);
assert.ok(unavailableOptions.options.every((x) => x.source === 'normal'));

// 腐败预兆：保留破裂词缀、移除其他显式词缀、填满剩余槽、腐化且排除专属词缀。
const putrefactionInput = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_putrefaction'],
  affixes: [
    { modifierId: 'bow_phys', tier: 2, fractured: true, locked: true },
    { modifierId: 'bow_cold', tier: 2 }, { modifierId: 'bow_speed', tier: 2 }, { modifierId: 'bow_crit', tier: 2 }
  ]
});
const putrefied = applyCurrencySample(data, putrefactionInput, 'preserved_jawbone', { rng: rng0 });
assert.equal(putrefied.state.flags.corrupted, true);
assert.equal(putrefied.state.affixes.some((x) => x.modifierId === 'bow_phys' && x.fractured), true);
assert.equal(affixCounts(putrefied.state).explicit, 6);
assert.equal(affixCounts(putrefied.state).unrevealedDesecrated, 5);
assert.equal(putrefied.removed.length, 3);
const putPlaceholder = putrefied.state.affixes.find((x) => x.unrevealed);
const putOptions = buildDesecratedRevealOptions(data, putrefied.state, { instanceId: putPlaceholder.instanceId, seed: 5 });
assert.ok(putOptions.options.every((x) => x.source === 'normal'));
assert.equal(putOptions.poolSummary.excludeExclusiveDesecrated, true);

// 深渊回响只能重骰一次。
const echoesState = createItemState(data, {
  ...desecrated.state,
  activeOmens: ['omen_abyssal_echoes']
});
assert.equal(buildDesecratedRevealOptions(data, echoesState, { seed: 1, rerollIndex: 1 }).ok, true);
assert.equal(buildDesecratedRevealOptions(data, echoesState, { seed: 1, rerollIndex: 2 }).ok, false);
assert.equal(buildDesecratedRevealOptions(data, desecrated.state, { seed: 1, rerollIndex: 1 }).ok, false);

// 催化崇高预兆动态改变对应词缀权重并在应用后消耗全部催化品质。
const catalystState = createItemState(data, {
  baseId: 'ring', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_catalysing_exaltation'],
  catalyst: { id: 'flesh_catalyst', modifierTag: 'life', quality: 20 },
  affixes: [{ modifierId: 'ring_fire_res', tier: 1 }]
});
const catalystOutcomes = enumerateSingleAddOutcomes(data, catalystState, 'exalt');
const lifeOutcome = catalystOutcomes.outcomes.find((x) => x.event.modifierId === 'ring_life' && x.event.tier === 1);
const manaOutcome = catalystOutcomes.outcomes.find((x) => x.event.modifierId === 'ring_mana' && x.event.tier === 1);
assert.equal(lifeOutcome.event.weightMultiplier, 5);
assert.equal(manaOutcome.event.weightMultiplier, 1);
assert.equal(lifeOutcome.state.catalyst, null);
assert.ok(lifeOutcome.consumedOmens.includes('omen_catalysing_exaltation'));
const noOmen = createItemState(data, {
  baseId: 'ring', itemLevel: 82, rarity: 'rare', catalyst: { id: 'flesh_catalyst', modifierTag: 'life', quality: 20 },
  affixes: [{ modifierId: 'ring_fire_res', tier: 1 }]
});
assert.ok(enumerateSingleAddOutcomes(data, noOmen, 'exalt').outcomes.every((x) => x.event.weightMultiplier === 1));

// 左旋崇高预兆同样作用于高阶/完美崇高石。
const sideOmenState = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_sinistral_exaltation'],
  affixes: [{ modifierId: 'bow_speed', tier: 2 }]
});
const sideOutcomes = enumerateSingleAddOutcomes(data, sideOmenState, 'perfect_exalt');
assert.ok(sideOutcomes.outcomes.length > 0);
assert.ok(sideOutcomes.outcomes.every((x) => x.event.type === 'prefix'));


// 点金石必须保留已有破裂词缀，并把最终显式词缀总数补到 4，而不是额外再加 4 条。
const fracturedMagic = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'magic',
  affixes: [
    { modifierId: 'bow_phys', tier: 2, fractured: true, locked: true },
    { modifierId: 'bow_speed', tier: 2 }
  ]
});
const alchemyWithFracture = applyCurrencySample(data, fracturedMagic, 'alchemy', { rng: () => 0.37 });
assert.equal(alchemyWithFracture.state.rarity, 'rare');
assert.equal(affixCounts(alchemyWithFracture.state).explicit, 4);
assert.equal(alchemyWithFracture.state.affixes.some((x) => x.modifierId === 'bow_phys' && x.fractured && x.locked), true);
assert.equal(alchemyWithFracture.removed.some((x) => x.modifierId === 'bow_speed'), true);
assert.equal(alchemyWithFracture.added.length, 3);

// 高阶崇高预兆可与普通/高阶/完美崇高石组合，且两条新词缀分别遵守通货最低等级或家族保底。
const greaterOmenState = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', activeOmens: ['omen_greater_exaltation'],
  affixes: [{ modifierId: 'bow_speed', tier: 2 }]
});
for (const currencyId of ['exalt', 'greater_exalt', 'perfect_exalt']) {
  const result = applyCurrencySample(data, greaterOmenState, currencyId, { rng: () => 0.31 });
  assert.equal(result.added.length, 2, `${currencyId} 应由高阶崇高预兆增加两条词缀`);
  assert.ok(result.consumedOmens.includes('omen_greater_exaltation'));
  if (currencyId !== 'exalt') {
    const minimum = currencyId === 'greater_exalt' ? 35 : 50;
    assert.ok(result.added.every((x) => Number(x.modifierLevel) >= minimum || x.metadata?.minimumLevelFallback));
  }
}

// 高阶崇高预兆与方向预兆叠加时，两条新增词缀都遵守方向；对应一侧不足两个空位时必须在执行前阻止。
const blockedDoublePrefix = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  activeOmens: ['omen_greater_exaltation', 'omen_sinistral_exaltation'],
  affixes: [
    { modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_cold', tier: 2 },
    { modifierId: 'bow_speed', tier: 2 }
  ]
});
assert.equal(canApplyCurrency(data, blockedDoublePrefix, 'exalt').ok, false);
assert.match(canApplyCurrency(data, blockedDoublePrefix, 'exalt').reason, /前缀槽位不足/);

const allowedDoublePrefix = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  activeOmens: ['omen_greater_exaltation', 'omen_sinistral_exaltation'],
  affixes: [
    { modifierId: 'bow_phys', tier: 2 },
    { modifierId: 'bow_speed', tier: 2 }, { modifierId: 'bow_crit', tier: 2 }
  ]
});
const doublePrefixResult = applyCurrencySample(data, allowedDoublePrefix, 'exalt', { rng: () => 0.42 });
assert.equal(doublePrefixResult.added.length, 2);
assert.ok(doublePrefixResult.added.every((affix) => affix.type === 'prefix'));
assert.ok(doublePrefixResult.consumedOmens.includes('omen_greater_exaltation'));
assert.ok(doublePrefixResult.consumedOmens.includes('omen_sinistral_exaltation'));

// 已停止掉落的保存完好的脊椎骨仍可在永久联盟既有物品模拟中用于稀有路石，不能用于装备。
assert.equal(canApplyCurrency(data, rare, 'preserved_vertebrae').ok, false);
const rareWaystone = createItemState(data, {
  baseId: 'waystone', itemLevel: 82, rarity: 'rare',
  affixes: [{ modifierId: 'waystone_pack', tier: 1 }, { modifierId: 'waystone_rarity', tier: 1 }]
});
assert.equal(canApplyCurrency(data, rareWaystone, 'preserved_vertebrae').ok, true);
const vertebraeResult = applyCurrencySample(data, rareWaystone, 'preserved_vertebrae', { rng: () => 0.2 });
assert.equal(affixCounts(vertebraeResult.state).unrevealedDesecrated, 1);
const vertebraeOptions = buildDesecratedRevealOptions(data, vertebraeResult.state, { seed: 17 });
assert.equal(vertebraeOptions.ok, true);
assert.ok(vertebraeOptions.options.length > 0 && vertebraeOptions.options.length <= 3);

// 全部 29 条 ready 规则都必须在符合限制的代表状态上可执行；防止某一档通货或某一种骨材只存在于目录却无法运行。
function representativeState(currencyId) {
  if (['transmute', 'greater_transmute', 'perfect_transmute', 'alchemy'].includes(currencyId)) {
    return createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'normal' });
  }
  if (['augment', 'greater_augment', 'perfect_augment', 'regal', 'greater_regal', 'perfect_regal'].includes(currencyId)) {
    return createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'magic', affixes: [{ modifierId: 'bow_phys', tier: 2 }] });
  }
  if (['exalt', 'greater_exalt', 'perfect_exalt', 'annul', 'chaos', 'greater_chaos', 'perfect_chaos'].includes(currencyId)) {
    return createItemState(data, { baseId: 'bow', itemLevel: 82, rarity: 'rare', affixes: [{ modifierId: 'bow_phys', tier: 2 }] });
  }
  if (currencyId === 'fracturing') {
    return createItemState(data, {
      baseId: 'bow', itemLevel: 82, rarity: 'rare',
      affixes: [
        { modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_cold', tier: 2 },
        { modifierId: 'bow_speed', tier: 2 }, { modifierId: 'bow_crit', tier: 2 }
      ]
    });
  }
  const boneTarget = {
    gnawed_collarbone: ['ring', 'ring_life'], preserved_collarbone: ['ring', 'ring_life'], ancient_collarbone: ['ring', 'ring_life'],
    gnawed_jawbone: ['bow', 'bow_phys', 2], preserved_jawbone: ['bow', 'bow_phys', 1], ancient_jawbone: ['bow', 'bow_phys', 1],
    gnawed_rib: ['armour', 'armour_life'], preserved_rib: ['armour', 'armour_life'], ancient_rib: ['armour', 'armour_life'],
    preserved_cranium: ['jewel', 'jewel_life'], preserved_vertebrae: ['waystone', 'waystone_pack']
  }[currencyId];
  if (boneTarget) {
    return createItemState(data, {
      baseId: boneTarget[0], itemLevel: currencyId.startsWith('gnawed_') ? 64 : 82, rarity: 'rare',
      affixes: [{ modifierId: boneTarget[1], tier: boneTarget[2] || 1 }]
    });
  }
  throw new Error(`测试缺少代表状态：${currencyId}`);
}

const executedCurrencyIds = new Set();
for (const currency of data.currencies.filter((entry) => entry.implementationStatus === 'ready')) {
  const input = representativeState(currency.id);
  const availability = canApplyCurrency(data, input, currency.id);
  assert.equal(availability.ok, true, `${currency.id} 在代表状态上不可用：${availability.reason || ''}`);
  const result = applyCurrencySample(data, input, currency.id, { rng: () => 0.23 });
  assert.ok(result.state && result.currency.id === currency.id, `${currency.id} 未生成有效状态`);
  executedCurrencyIds.add(currency.id);
}
assert.equal(executedCurrencyIds.size, 29);
assert.deepEqual([...executedCurrencyIds].sort(), data.currencies.filter((entry) => entry.implementationStatus === 'ready').map((entry) => entry.id).sort());

console.log('currency-state-machine tests passed');
