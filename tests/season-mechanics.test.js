'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadCraftingDataV2Sync } = require('../src/crafting-data-repository');
const { localizeModifierName, localizeBaseName, localizeConcreteBaseName, localizeEssenceName, localizeSocketableName } = require('../src/zh-localization');
const { SOURCE_FILES } = require('../scripts/update-poe2-full-data');
const { concreteAffixLimits } = require('../src/full-snapshot-adapter');

const root = path.resolve(__dirname, '..');
const data = loadCraftingDataV2Sync(path.join(root, 'data-v2'));
assert.equal(data.mechanics.length, 6);
assert.ok(data.mechanics.some((record) => record.id === 'desecration_current'));
assert.ok(data.mechanics.some((record) => record.id === 'essence_current'));
assert.ok(data.mechanics.some((record) => record.id === 'rune_current'));
assert.ok(data.omens.some((record) => record.id === 'omen_sinistral_crystallisation'));
assert.ok(data.omens.some((record) => record.id === 'omen_dextral_crystallisation'));
assert.ok(SOURCE_FILES.some((entry) => entry.name === 'essences.json'));
assert.ok(SOURCE_FILES.some((entry) => entry.name === 'socketables.json'));

const core = JSON.parse(fs.readFileSync(path.join(root, 'data-v2/currencies/core.json'), 'utf8')).records;
for (const id of ['gnawed_collarbone','gnawed_jawbone','gnawed_rib']) {
  const record = core.find((entry) => entry.id === id);
  assert.equal(record.lowTier, true);
  assert.equal(record.maxItemLevel, 64);
}
for (const id of ['ancient_collarbone','ancient_jawbone','ancient_rib']) {
  const record = core.find((entry) => entry.id === id);
  assert.equal(record.minModifierLevel, 40);
  assert.equal(record.maxItemLevel, undefined);
  assert.match(record.description, /不是目标物品等级/);
}

assert.equal(localizeBaseName('Quarterstaff'), '长棍');
assert.equal(localizeBaseName('Wand'), '魔杖');
assert.equal(localizeModifierName('+# to Level of all Projectile Skills', '5073'), '所有投射物技能等级 +#');
assert.equal(localizeModifierName('Minions deal #% increased Damage', '5272').includes('特殊机制'), false);
assert.equal(/[A-Za-z]{3,}/.test(localizeModifierName('Triggered Spells deal #% increased Spell Damage', '5276')), false);
assert.match(localizeConcreteBaseName('Azure Amulet', 'Amulet', '16'), /项链|蔚蓝/);
assert.match(localizeEssenceName('Perfect Essence of Alacrity', '2'), /完美.*精华/);
assert.match(localizeSocketableName('Adept Rune', 'rune', '65'), /符文/);
assert.deepEqual(concreteAffixLimits(['+1 Prefix Modifier allowed', '-1 Suffix Modifier allowed']), { maxPrefixes: 4, maxSuffixes: 2, adjustments: [{ side: 'prefix', amount: 1, source: '+1 Prefix Modifier allowed' }, { side: 'suffix', amount: -1, source: '-1 Suffix Modifier allowed' }] });

const plannerHtml = fs.readFileSync(path.join(root, 'renderer/crafting-planner.html'), 'utf8');
const plannerJs = fs.readFileSync(path.join(root, 'renderer/crafting-planner.js'), 'utf8');
for (const id of ['concreteBaseSelect','concreteBaseDetails','mechanicsOverview','currentBaseAvailabilitySection','essenceSelect','socketableSelect','showLegacyBones','currencyCategoryFilter','currencyCatalogMeta']) {
  assert.ok(plannerHtml.includes(`id="${id}"`), `missing current-season UI: ${id}`);
}
for (const fn of ['renderConcreteBases','renderConcreteBaseDetails','renderSeasonMechanics','renderEssences','renderSocketables','unifiedCatalogEntries','renderCurrencyCatalog']) {
  assert.ok(plannerJs.includes(`function ${fn}`), `missing renderer function ${fn}`);
}
assert.ok(plannerHtml.includes('同一精确池内的大多数普通具体基底共享随机显式词缀池与基础权重'));
assert.ok(plannerJs.includes('concreteBaseChangesSlotLimits'));
assert.ok(plannerJs.includes('特殊槽位规则'));

for (const id of ['operationKindSelect','augmentSocketCapacityInput','augmentSlotSelect','operationDetails']) {
  assert.ok(plannerHtml.includes(`id="${id}"`), `missing integrated state-machine UI: ${id}`);
}
assert.ok(plannerJs.includes('previewCraftingSpecialAction'));
assert.ok(plannerJs.includes('applyCraftingSpecialAction'));
assert.ok(plannerJs.includes("kind === 'essence'"));
assert.ok(plannerHtml.indexOf('id="stateMachineSection"') < plannerHtml.indexOf('id="seasonMechanicsSection"'), 'reference section must remain below the state machine');
assert.ok(plannerHtml.indexOf('id="revealMessage"') < plannerHtml.indexOf('id="currentBaseAvailabilitySection"'), 'current-base availability must be directly below desecration reveal');
assert.ok(plannerHtml.indexOf('id="currentBaseAvailabilitySection"') < plannerHtml.indexOf('id="currencyCatalog"'), 'availability selectors must remain above the unified catalog');
assert.ok(plannerHtml.includes('全部精华、全部符文 / 灵魂核心 / 其他插槽强化物及全部预兆统一展示'));
assert.equal(plannerHtml.includes('id="ritualOmenList"'), false);
for (const source of ['context.data?.essences', 'context.data?.socketables', 'context.data?.omens']) assert.ok(plannerJs.includes(source), `unified catalog missing ${source}`);
console.log('season-mechanics tests passed');
