'use strict';
const assert = require('node:assert/strict');
const { makeStrictData } = require('./strict-test-data');
const { createItemState } = require('../src/item-state');
const {
  previewEssence,
  applyEssence,
  previewSocketable,
  applySocketable
} = require('../src/crafting-special-actions');

const data = makeStrictData();
// Strict snapshot effects point to the same source modifier IDs used by the exact base pool.
for (const modifier of data.modifiers) modifier.sourceMeta.sourceModifierId = modifier.id;
data.essences = [
  {
    id: 'essence_speed', name: '迅捷精华', corrupted: false,
    effects: [{ baseId: 'bow', modifierId: 'bow_speed', modifierName: '攻击速度提高 %', modifierLevel: 20, sourceModifierId: 'bow_speed' }]
  },
  {
    id: 'perfect_cold', name: '完美冰霜精华', corrupted: true,
    effects: [{ baseId: 'bow', modifierId: 'bow_cold', modifierName: '附加冰霜伤害', modifierLevel: 30, sourceModifierId: 'bow_cold' }]
  }
];
data.socketables = [
  {
    id: 'rune_adept', name: '行家符文', type: 'rune',
    effects: [{ compatibleBaseIds: ['bow'], modifierName: '+9 敏捷', sourceModifierId: 'bow_speed' }]
  },
  {
    id: 'alloy_cold', name: '冰霜合金', type: 'alloy',
    effects: [{ compatibleBaseIds: ['bow'], modifierName: '附加冰霜伤害', sourceModifierId: 'bow_cold' }]
  },
  {
    id: 'flux_skill', name: '卡古兰通量', type: 'flux',
    effects: [{ compatibleBaseIds: ['bow'], modifierName: '技能宝石效果', sourceModifierId: 'bow_speed' }]
  }
];
data.indexes.essenceById = new Map(data.essences.map((x) => [x.id, x]));
data.indexes.socketableById = new Map(data.socketables.map((x) => [x.id, x]));

const magic = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'magic',
  affixes: [{ modifierId: 'bow_phys', tier: 2 }]
});
const essencePreview = previewEssence(data, magic, 'essence_speed');
assert.equal(essencePreview.ok, true);
assert.equal(essencePreview.outcomes[0].state.rarity, 'rare');
assert.ok(essencePreview.outcomes[0].state.affixes.some((x) => x.modifierId === 'bow_speed'));
const essenceApplied = applyEssence(data, magic, 'essence_speed', { seed: 1 });
assert.equal(essenceApplied.state.rarity, 'rare');

const rare = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', augmentSocketCapacity: 2,
  affixes: [{ modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_speed', tier: 2 }]
});
const alloyPreview = previewSocketable(data, rare, 'alloy_cold');
assert.equal(alloyPreview.ok, true);
assert.equal(alloyPreview.kind, 'alloy');
assert.ok(alloyPreview.outcomes.every((x) => x.state.affixes.some((a) => a.modifierId === 'bow_cold')));
const alloyApplied = applySocketable(data, rare, 'alloy_cold', { seed: 2 });
assert.ok(alloyApplied.state.affixes.some((x) => x.modifierId === 'bow_cold'));

const runePreview = previewSocketable(data, rare, 'rune_adept', { slotIndex: 1 });
assert.equal(runePreview.ok, true);
assert.equal(runePreview.slotIndex, 1);
const runeApplied = applySocketable(data, rare, 'rune_adept', { slotIndex: 1 });
assert.equal(runeApplied.state.installedAugments[0].name, '行家符文');
assert.equal(runeApplied.state.installedAugments[0].slotIndex, 1);
const replaced = applySocketable(data, runeApplied.state, 'rune_adept', { slotIndex: 1 });
assert.equal(replaced.replaced.name, '行家符文');

const fluxPreview = previewSocketable(data, rare, 'flux_skill');
assert.equal(fluxPreview.ok, false);
assert.match(fluxPreview.reason, /目标不是装备做装状态/);

console.log('crafting-special-actions tests passed');
