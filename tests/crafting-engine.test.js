'use strict';
const assert = require('node:assert/strict');
const { makeStrictData } = require('./strict-test-data');
const { validateCraftingData, probabilitySummary, analyzeCraft, availableEvents } = require('../src/crafting-engine');

const data = makeStrictData();
assert.equal(validateCraftingData(data).ok, true);
const input = {
  baseId: 'bow', itemLevel: 82, rarity: 'rare', prefixCount: 1, suffixCount: 1,
  existingModifiers: [{ id: 'bow_phys', tier: 2 }, { id: 'bow_speed', tier: 2 }],
  targets: [{ id: 'bow_cold', minimumTier: 2 }]
};
const events = availableEvents(data, input);
assert.ok(events.length > 0);
assert.ok(events.every((event) => event.modifierId.startsWith('bow_')));
assert.equal(events.some((event) => event.modifierId === 'ring_fire_res'), false);
const result = probabilitySummary(data, input, 'exalt');
assert.ok(result.totalWeight > 0);
assert.ok(result.desiredWeight > 0);
assert.ok(result.probability > 0 && result.probability <= 1);
const blocked = probabilitySummary(data, {
  ...input,
  existingModifiers: [{ id: 'bow_cold', tier: 2 }, { id: 'bow_speed', tier: 2 }]
}, 'exalt');
assert.equal(blocked.perTarget[0].existing, true);

const analysis = analyzeCraft(data, input, {
  trials: 1000,
  seed: 42,
  prices: { exalt: 1, prefixOmen: 2, suffixOmen: 2, transmute: 0.1, augment: 0.1, regal: 0.2 }
});
assert.equal(analysis.nextRolls.length, 3);
assert.ok(analysis.strategies.length >= 1);
assert.ok(analysis.bestStrategy);
assert.equal(Object.hasOwn(analysis, 'buyOrCraft'), false);
console.log('crafting-engine tests passed');
