'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  loadCraftingDataV2Sync,
  summarizeDataV2,
  toLegacyCraftingData
} = require('../src/crafting-data-repository');

const root = path.join(__dirname, '..', 'data-v2');
const data = loadCraftingDataV2Sync(root);
const summary = summarizeDataV2(data);
assert.equal(summary.ok, true);
assert.equal(summary.schemaVersion, 2);
assert.equal(summary.strictSnapshotRequired, true);
assert.equal(summary.baseCount, 0);
assert.equal(summary.modifierCount, 0);
assert.equal(summary.tierCount, 0);
assert.ok(summary.currencyCount >= 10);
assert.ok(summary.omenCount >= 4);
assert.deepEqual(summary.modifierSourceCounts, {});
assert.ok(data.indexes.currencyById.has('chaos'));
assert.equal(data.indexes.currencyById.get('greater_exalt').minModifierLevel, 35);
const legacy = toLegacyCraftingData(data);
assert.equal(legacy.schemaVersion, 2);
assert.equal(legacy.bases.length, 0);
assert.equal(legacy.modifiers.length, 0);
console.log('crafting-data-repository tests passed');
