'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCraftingDataV2Sync } = require('../src/crafting-data-repository');
const { loadFullSnapshotDataV2Sync, clearFullSnapshotCache, classTags } = require('../src/full-snapshot-adapter');
const { createItemState } = require('../src/item-state');
const { eligibleModifierEvents } = require('../src/currency-state-machine');

const projectRoot = path.join(__dirname, '..');
assert.ok(classTags('Low Tier (1-5)', 'Low Tier (1-5)', '233').includes('waystone'), 'Craft of Exile 路石等级池必须按来源 ID 识别');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-strict-adapter-'));
try {
  fs.mkdirSync(path.join(temp, 'by-base'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify({
    schemaVersion: 2, status: 'ready', strictBasePools: true, updatedAt: '2026-06-18T00:00:00.000Z'
  }));
  fs.writeFileSync(path.join(temp, 'by-base', 'index.json'), JSON.stringify({ BOW: 'bow', RING: 'ring' }));
  fs.writeFileSync(path.join(temp, 'base-metadata.json'), JSON.stringify({
    BOW: { sourceBaseId: '20', isMartial: true, concreteBaseItemCount: 20 },
    RING: { sourceBaseId: '4', isJewellery: true, concreteBaseItemCount: 30 }
  }));
  fs.writeFileSync(path.join(temp, 'base-items.json'), JSON.stringify([
    { sourceBaseItemId: 'b1', sourceBaseId: 'legacy-bow-id', resolvedSourceBaseId: '20', sourceBaseResolution: 'alias', name: 'Advanced Bow', dropLevel: 60, properties: { physical_damage_min: 10 }, requirements: { level: 60 }, implicits: ['+1 Prefix Modifier allowed', '-1 Suffix Modifier allowed'], image: 'bow.webp', experience: 7, externalModifiers: { x: 1 }, tagGroup: 'weapon', legacy: false },
    { sourceBaseItemId: 'r1', sourceBaseId: '4', name: 'Ruby Ring', dropLevel: 20, properties: null, requirements: { level: 20 }, implicits: ['+% Fire Resistance'], image: 'ring.webp', experience: 0, externalModifiers: null, tagGroup: 'jewellery', legacy: false }
  ]));
  fs.writeFileSync(path.join(temp, 'essences.json'), JSON.stringify([
    { id: 'e1', name: 'Essence of Abrasion', tooltip: ['Bow: Adds Physical Damage'], corrupted: false, effects: [{ sourceBaseId: '20', resolvedSourceBaseId: '20', sourceModifierId: 'p1', sourceModifierName: '#% increased Physical Damage', modifierLevel: 46 }] }
  ]));
  fs.writeFileSync(path.join(temp, 'socketables.json'), JSON.stringify([
    { id: 's1', type: 'rune', name: 'Adept Rune', image: 'rune.webp', effects: [{ scope: 'class', sourceModifierId: 's1', sourceModifierName: '#% increased Attack Speed', sourceBaseIds: ['20'], resolvedSourceBaseIds: ['20'] }] }
  ]));
  fs.writeFileSync(path.join(temp, 'chronicle-zh.json'), JSON.stringify({
    schemaVersion: 1,
    source: 'poe2db.tw/cn',
    generatedAt: '2026-06-18T00:00:00.000Z',
    counts: { targets: 3, matched: 3, unresolved: 0 },
    records: {
      'base-item:b1': { kind: 'base-item', sourceId: 'b1', englishName: 'Advanced Bow', zhName: '进阶弓', descriptionLines: ['战斗武器：附加物理伤害'], sourceUrl: 'https://poe2db.tw/cn/Advanced_Bow' },
      'essence:e1': { kind: 'essence', sourceId: 'e1', englishName: 'Essence of Abrasion', zhName: '磨蚀精华', descriptionLines: ['升级物品并添加保证词缀'], sourceUrl: 'https://poe2db.tw/cn/Essence_of_Abrasion' },
      'socketable:s1': { kind: 'socketable', sourceId: 's1', englishName: 'Adept Rune', zhName: '精通符文', descriptionLines: ['战斗武器：攻击速度提高 8%'], sourceUrl: 'https://poe2db.tw/cn/Adept_Rune' }
    },
    failures: {}
  }));
  fs.writeFileSync(path.join(temp, 'by-base', 'bow.mods.json'), JSON.stringify([
    { base: 'BOW', source: 'normal', type: 'PREFIX', name: '#% increased Physical Damage', itemClass: 'Bow', sourceBaseId: '20', sourceModifierId: 'p1', families: ['LocalPhysical'], tiers: [
      { tier: 1, weight: 50, ilvl: 75, spawnLvl: 75, id: 'bow-phys-t1', ranges: [[120, 139]] },
      { tier: 2, weight: 0, ilvl: 60, spawnLvl: 60, id: 'bow-disabled', ranges: [[100, 119]] }
    ] },
    { base: 'BOW', source: 'normal', type: 'SUFFIX', name: '#% increased Attack Speed', itemClass: 'Bow', sourceBaseId: '20', sourceModifierId: 's1', families: ['LocalAttackSpeed'], tiers: [
      { tier: 1, weight: 100, ilvl: 55, spawnLvl: 55, id: 'bow-speed-t1', ranges: [[18, 20]] }
    ] }
  ]));
  fs.writeFileSync(path.join(temp, 'by-base', 'ring.mods.json'), JSON.stringify([
    { base: 'RING', source: 'normal', type: 'SUFFIX', name: '#% to Fire Resistance', itemClass: 'Ring', sourceBaseId: '4', sourceModifierId: 'r1', families: ['FireResistance', 'ElementalResistance'], tiers: [
      { tier: 1, weight: 500, ilvl: 50, spawnLvl: 50, id: 'ring-fire-t1', ranges: [[36, 40]] }
    ] },
    { base: 'RING', source: 'normal', type: 'PREFIX', name: '# to maximum Life', itemClass: 'Ring', sourceBaseId: '4', sourceModifierId: 'r2', families: ['Life'], tiers: [
      { tier: 1, weight: 500, ilvl: 60, spawnLvl: 60, id: 'ring-life-t1', ranges: [[70, 79]] }
    ] }
  ]));

  const metadata = loadCraftingDataV2Sync(path.join(projectRoot, 'data-v2'));
  const data = loadFullSnapshotDataV2Sync(temp, metadata);
  assert.equal(data.bases.length, 2);
  assert.equal(data.modifiers.length, 4);
  assert.equal(data.essences.length, 1);
  assert.equal(data.socketables.length, 1);
  assert.equal(data.essences[0].effects[0].baseId, data.bases.find((x) => x.sourcePool === 'BOW').id);
  assert.ok(data.socketables[0].effects[0].compatibleBaseIds.includes(data.bases.find((x) => x.sourcePool === 'BOW').id));
  assert.equal(data.source.confidence, 'craftofexile-exact-base-graph + poe2db-cn-localization');
  const bow = data.bases.find((x) => x.sourcePool === 'BOW');
  const ring = data.bases.find((x) => x.sourcePool === 'RING');
  assert.equal(ring.name, '戒指');
  const ringResistance = data.modifiers.find((x) => x.englishName.includes('Fire Resistance'));
  assert.equal(/[A-Za-z]{3,}/.test(ringResistance.name), false, '显示词缀必须汉化');
  assert.deepEqual(ringResistance.allowedBaseIds, [ring.id]);
  const bowState = createItemState(data, { baseId: bow.id, itemLevel: 82, rarity: 'rare' });
  const specialBowState = createItemState(data, { baseId: bow.id, itemLevel: 82, rarity: 'rare', unknownPrefixCount: 4, unknownSuffixCount: 2, metadata: { concreteBaseItemId: 'b1', maxPrefixes: 4, maxSuffixes: 2 } });
  assert.equal(specialBowState.affixes.length, 6);
  const bowEvents = eligibleModifierEvents(data, bowState, { allowedSources: ['normal'] });
  assert.ok(bowEvents.length > 0);
  assert.equal(bowEvents.some((x) => x.modifierId === ringResistance.id), false, '弓不得继承戒指抗性词缀');
  assert.ok(data.modifiers.find((x) => x.englishName.includes('Physical Damage')).tiers.every((tier) => tier.weight > 0));
  assert.equal(data.snapshotAdapterSummary.exactBasePoolCount, 2);
  assert.equal(data.snapshotAdapterSummary.concreteBaseItemCount, 2);
  assert.equal(data.snapshotAdapterSummary.chronicle.matched, 3);
  assert.equal(data.essences[0].name, '磨蚀精华');
  assert.equal(data.socketables[0].name, '精通符文');
  assert.equal(bow.concreteBaseItems[0].name, '进阶弓');
  assert.equal(bow.concreteBaseItems[0].localizationSource, 'poe2db.tw/cn');
  assert.ok(bow.aliases.includes('Advanced Bow'));
  assert.ok(ring.aliases.includes('Ruby Ring'));
  assert.equal(bow.concreteBaseItems[0].dropLevel, 60);
  assert.equal(bow.concreteBaseItems[0].properties.physical_damage_min, 10);
  assert.equal(bow.concreteBaseItems[0].maxPrefixes, 4);
  assert.equal(bow.concreteBaseItems[0].maxSuffixes, 2);
  assert.equal(bow.concreteBaseItems[0].changesExplicitSlotLimits, true);
  assert.equal(bow.concreteBaseItems[0].requirements.level, 60);
  assert.equal(bow.concreteBaseItems[0].image, 'bow.webp');
  assert.equal(bow.concreteBaseItems[0].tagGroup, 'weapon');
  assert.equal(bow.concreteBaseItems[0].sourceBaseId, 'legacy-bow-id');
  assert.equal(bow.concreteBaseItems[0].resolvedSourceBaseId, '20');
  assert.equal(bow.concreteBaseItems[0].sourceBaseResolution, 'alias');

  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-bad-snapshot-'));
  try {
    fs.mkdirSync(path.join(bad, 'by-base'));
    fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify({ status: 'ready', strictBasePools: false }));
    fs.writeFileSync(path.join(bad, 'by-base', 'index.json'), '{}');
    assert.throws(() => loadFullSnapshotDataV2Sync(bad, metadata), /strictBasePools/);
  } finally { fs.rmSync(bad, { recursive: true, force: true }); }
} finally {
  clearFullSnapshotCache();
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('full-snapshot-adapter tests passed');
