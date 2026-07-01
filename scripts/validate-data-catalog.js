'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadPoe2CatalogSync, summarizePoe2Catalog } = require('../src/poe2-catalog-repository');

const root = path.join(__dirname, '..');
const catalogRoot = path.join(root, 'data-catalog');
const catalog = loadPoe2CatalogSync(catalogRoot, path.join(root, 'data-snapshot'));
const summary = summarizePoe2Catalog(catalog);
assert.equal(summary.coreCurrencyCount, 37, '核心通货必须为 37/37');
assert.equal(summary.abyssalBoneCount, 12, '深渊骨材目录必须为 12 条（含异变锁骨资料项）');
assert.equal(summary.currencyCount, 79, '通货资料目录必须为 78 条');
assert.ok(summary.equipmentClassCount >= 29, '装备类别索引不完整');
assert.ok(summary.coreModifierFamilyCount >= 40, '核心词缀家族搜索索引过少');
assert.equal(catalog.probabilityPolicy.allowEstimatedWeights, false, '不得允许估算权重进入正式概率');

const core = JSON.parse(fs.readFileSync(path.join(catalogRoot, 'currencies', 'core.json'), 'utf8')).records;
assert.equal(core.length, 37);
const ids = new Set();
for (const currency of core) {
  assert.ok(currency.id && currency.nameZh && currency.nameEn && currency.effectZh, '核心通货字段不完整');
  assert.ok(!ids.has(currency.id), `核心通货 id 重复：${currency.id}`);
  ids.add(currency.id);
  assert.ok(/^https:\/\//.test(currency.sourceUrl), `核心通货缺少来源：${currency.id}`);
  assert.ok(currency.usage && currency.usage.simulatorSupport, `核心通货缺少结构化使用限制：${currency.id}`);
  assert.ok(Array.isArray(currency.usage.targetTypes), `核心通货缺少目标类型：${currency.id}`);
  assert.equal(typeof currency.usage.requiresUncorrupted, 'boolean', `核心通货缺少腐化限制：${currency.id}`);
  assert.equal(typeof currency.usage.requiresUnmirrored, 'boolean', `核心通货缺少镜像限制：${currency.id}`);
}

const bones = JSON.parse(fs.readFileSync(path.join(catalogRoot, 'currencies', 'abyssal-bones.json'), 'utf8')).records;
assert.equal(bones.length, 12);
assert.equal(bones.filter((currency) => currency.usage.simulatorSupport === 'full-state-machine').length, 11);
assert.equal(bones.filter((currency) => currency.usage.simulatorSupport === 'reference-only').length, 1);

for (const currency of catalog.currencies) {
  assert.ok(currency.usage && currency.usage.simulatorSupport, `资料库通货缺少使用限制：${currency.id}`);
  assert.ok(Array.isArray(currency.usage.targetTypes), `资料库通货缺少目标类型：${currency.id}`);
}

console.log(`data-catalog valid: ${summary.currencyCount} currencies, ${summary.equipmentClassCount} equipment classes, ${summary.coreModifierFamilyCount} core modifier families, snapshot=${summary.snapshot.status}`);
