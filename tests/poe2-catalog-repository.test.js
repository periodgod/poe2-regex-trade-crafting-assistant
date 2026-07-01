'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPoe2CatalogSync, summarizePoe2Catalog, searchCatalog } = require('../src/poe2-catalog-repository');
const root = path.join(__dirname, '..');
const catalog = loadPoe2CatalogSync(path.join(root, 'data-catalog'), path.join(root, 'data-snapshot'));
const summary = summarizePoe2Catalog(catalog);
assert.equal(summary.coreCurrencyCount, 37);
assert.equal(summary.abyssalBoneCount, 12);
assert.equal(summary.currencyCount, 79);
assert.ok(summary.equipmentClassCount >= 29);
assert.equal(catalog.probabilityPolicy.allowEstimatedWeights, false);
assert.ok(searchCatalog(catalog, '崇高').currencies.some((item) => item.id === 'exalt'));
assert.ok(searchCatalog(catalog, '颚骨').currencies.some((item) => item.id === 'ancient_jawbone'));
assert.ok(searchCatalog(catalog, 'maximum Life').modifierFamilies.some((item) => item.id === 'max_life'));
assert.ok(searchCatalog(catalog, 'crossbow').equipmentClasses.some((item) => item.id === 'crossbows'));
console.log('poe2-catalog-repository tests passed');
