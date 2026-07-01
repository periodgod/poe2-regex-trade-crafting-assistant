'use strict';

const assert = require('node:assert/strict');
const { makeStrictData } = require('./strict-test-data');
const {
  createItemState,
  validateItemState,
  affixCounts,
  addAffix,
  removeAffix,
  hasTarget,
  stateKey,
  modifierAllowedOnBase
} = require('../src/item-state');

const data = makeStrictData();
const bow = data.indexes.baseById.get('bow');
const ring = data.indexes.baseById.get('ring');
assert.equal(modifierAllowedOnBase(data.indexes.modifierById.get('bow_cold'), bow), true);
assert.equal(modifierAllowedOnBase(data.indexes.modifierById.get('ring_fire_res'), bow), false);
assert.equal(modifierAllowedOnBase(data.indexes.modifierById.get('ring_fire_res'), ring), true);

let state = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  affixes: [{ modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_speed', tier: 2 }]
});
assert.equal(validateItemState(data, state).ok, true);
assert.deepEqual(affixCounts(state), { prefix: 1, suffix: 1, implicit: 0, corrupted: 0, explicit: 2, unknownPrefix: 0, unknownSuffix: 0, unknownExplicit: 0, desecrated: 0, unrevealedDesecrated: 0, total: 2 });
assert.equal(hasTarget(state, { id: 'bow_phys', minimumTier: 1 }), false);
assert.equal(hasTarget(state, { id: 'bow_phys', minimumTier: 2 }), true);
const key = stateKey(state);
state = addAffix(data, state, { modifierId: 'bow_cold', tier: 2 });
assert.notEqual(stateKey(state), key);
const removed = removeAffix(data, state, state.affixes.find((x) => x.modifierId === 'bow_cold').instanceId);
assert.equal(removed.removed.modifierId, 'bow_cold');


const unresolved = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  affixes: [{ modifierId: 'bow_phys', tier: 2 }],
  unknownPrefixCount: 1,
  unknownSuffixCount: 2
});
assert.deepEqual(affixCounts(unresolved), { prefix: 2, suffix: 2, implicit: 0, corrupted: 0, explicit: 4, unknownPrefix: 1, unknownSuffix: 2, unknownExplicit: 3, desecrated: 0, unrevealedDesecrated: 0, total: 4 });
assert.equal(unresolved.affixes.filter((affix) => affix.unknown).length, 3);
assert.equal(validateItemState(data, unresolved).ok, true);

assert.throws(() => createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', affixes: [{ modifierId: 'ring_fire_res', tier: 1 }]
}), /不属于底材/);

assert.throws(() => createItemState(data, {
  baseId: 'ring', itemLevel: 82, rarity: 'rare',
  affixes: [{ modifierId: 'ring_fire_res', tier: 1 }, { modifierId: 'ring_cold_res', tier: 1 }]
}), /词缀组冲突/);

assert.throws(() => createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'magic',
  affixes: [{ modifierId: 'bow_phys', tier: 2 }, { modifierId: 'bow_cold', tier: 2 }]
}), /前缀超过 magic 稀有度上限/);

const unrevealed = createItemState(data, {
  baseId: 'bow', itemLevel: 82, rarity: 'rare',
  affixes: [{ unrevealedDesecrated: true, type: 'suffix' }]
});
assert.equal(unrevealed.affixes[0].modifierLevel, 1, '未揭示亵渎词缀按削切预兆规则视为词缀等级 1');

console.log('item-state tests passed');
