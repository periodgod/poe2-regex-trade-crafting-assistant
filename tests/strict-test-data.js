'use strict';

const currencyRules = require('../data-v2/currencies/core.json').records;
const omenRules = require('../data-v2/omens/core.json').records;

function withIndexes(data) {
  data.indexes = {
    baseById: new Map(data.bases.map((x) => [x.id, x])),
    modifierById: new Map(data.modifiers.map((x) => [x.id, x])),
    currencyById: new Map(data.currencies.map((x) => [x.id, x])),
    omenById: new Map(data.omens.map((x) => [x.id, x]))
  };
  return data;
}

function tier(tierNumber, level, weight, min = null, max = null) {
  return { tier: tierNumber, level, weight, min, max, externalId: `tier-${tierNumber}-${level}-${weight}` };
}

function modifier(id, name, type, source, family, baseId, tiers, tags = []) {
  return {
    id, name, type, source, family, families: [family],
    allowedBaseIds: [baseId], allowedBaseTags: [], excludedBaseTags: [], tiers,
    exclusiveDesecrated: source === 'desecrated',
    sourceMeta: { tags }
  };
}

function makeStrictData() {
  const modifiers = [
    modifier('bow_phys', '物理伤害提高 %', 'prefix', 'normal', 'local_phys', 'bow', [tier(1, 75, 50), tier(2, 35, 150), tier(3, 1, 300)], ['physical', 'attack']),
    { ...modifier('bow_cold', '附加冰霜伤害', 'prefix', 'normal', 'local_cold', 'bow', [tier(1, 70, 100), tier(2, 30, 300), tier(3, 1, 600)], ['cold', 'attack']), families: ['local_cold', 'local_elemental_flat'] },
    modifier('bow_life', '攻击获得生命', 'prefix', 'normal', 'life_on_hit', 'bow', [tier(1, 55, 100), tier(2, 1, 400)], ['life', 'attack']),
    modifier('bow_speed', '攻击速度提高 %', 'suffix', 'normal', 'local_attack_speed', 'bow', [tier(1, 60, 100), tier(2, 20, 300), tier(3, 1, 600)], ['speed', 'attack']),
    modifier('bow_crit', '暴击率提高 %', 'suffix', 'normal', 'local_crit', 'bow', [tier(1, 55, 100), tier(2, 1, 400)], ['attack']),
    modifier('bow_light_radius', '照亮范围提高 %', 'suffix', 'normal', 'light_radius', 'bow', [tier(1, 30, 80), tier(2, 1, 200)], []),
    modifier('bow_kurgal_prefix', 'Kurgal 的深渊物理伤害', 'prefix', 'desecrated', 'kurgal_phys', 'bow', [tier(1, 65, 40)], ['kurgal_mod', 'physical']),
    modifier('bow_kurgal_suffix', 'Kurgal 的深渊速度', 'suffix', 'desecrated', 'kurgal_speed', 'bow', [tier(1, 65, 40)], ['kurgal_mod', 'speed']),
    modifier('bow_amanamu_suffix', 'Amanamu 的深渊抗性', 'suffix', 'desecrated', 'amanamu_res', 'bow', [tier(1, 65, 30)], ['amanamu_mod']),
    modifier('bow_ulaman_prefix', 'Ulaman 的深渊力量', 'prefix', 'desecrated', 'ulaman_power', 'bow', [tier(1, 65, 30)], ['ulaman_mod']),
    modifier('bow_desecrated_low', '低等级亵渎荆棘', 'suffix', 'desecrated', 'desecrated_thorns', 'bow', [tier(1, 25, 60), tier(2, 1, 120)], ['physical']),
    modifier('ring_life', '生命上限', 'prefix', 'normal', 'life', 'ring', [tier(1, 60, 100), tier(2, 1, 500)], ['life']),
    modifier('ring_mana', '魔力上限', 'prefix', 'normal', 'mana', 'ring', [tier(1, 60, 100), tier(2, 1, 500)], ['mana']),
    { ...modifier('ring_fire_res', '火焰抗性 %', 'suffix', 'normal', 'fire_res', 'ring', [tier(1, 50, 100), tier(2, 1, 500)], ['fire']), families: ['fire_res', 'elemental_res'] },
    { ...modifier('ring_cold_res', '冰霜抗性 %', 'suffix', 'normal', 'cold_res', 'ring', [tier(1, 50, 100), tier(2, 1, 500)], ['cold']), families: ['cold_res', 'elemental_res'] },
    modifier('ring_speed', '速度提高 %', 'suffix', 'normal', 'speed', 'ring', [tier(1, 50, 100), tier(2, 1, 500)], ['speed']),
    modifier('ring_kurgal', 'Kurgal 的戒指词缀', 'prefix', 'desecrated', 'ring_kurgal', 'ring', [tier(1, 65, 40)], ['kurgal_mod']),
    modifier('waystone_pack', '怪物群规模提高 %', 'prefix', 'normal', 'waystone_pack', 'waystone', [tier(1, 65, 100), tier(2, 1, 500)], []),
    modifier('waystone_quantity', '物品数量提高 %', 'prefix', 'normal', 'waystone_quantity', 'waystone', [tier(1, 65, 100), tier(2, 1, 500)], []),
    modifier('waystone_rarity', '物品稀有度提高 %', 'suffix', 'normal', 'waystone_rarity', 'waystone', [tier(1, 65, 100), tier(2, 1, 500)], []),
    modifier('waystone_difficulty', '区域内怪物伤害提高 %', 'suffix', 'normal', 'waystone_difficulty', 'waystone', [tier(1, 65, 100), tier(2, 1, 500)], []),
    modifier('waystone_desecrated', '深渊怪物群规模提高 %', 'prefix', 'desecrated', 'waystone_desecrated', 'waystone', [tier(1, 65, 40)], []),
    modifier('armour_life', '护甲生命上限', 'prefix', 'normal', 'armour_life', 'armour', [tier(1, 60, 100), tier(2, 1, 500)], ['life']),
    modifier('armour_defence', '护甲提高 %', 'prefix', 'normal', 'armour_defence', 'armour', [tier(1, 50, 100), tier(2, 1, 500)], ['defences']),
    modifier('armour_fire_res', '护甲火焰抗性', 'suffix', 'normal', 'armour_fire_res', 'armour', [tier(1, 50, 100), tier(2, 1, 500)], ['fire']),
    modifier('armour_cold_res', '护甲冰霜抗性', 'suffix', 'normal', 'armour_cold_res', 'armour', [tier(1, 50, 100), tier(2, 1, 500)], ['cold']),
    modifier('armour_desecrated', '护甲亵渎专属词缀', 'suffix', 'desecrated', 'armour_desecrated', 'armour', [tier(1, 65, 40)], ['kurgal_mod']),
    modifier('jewel_life', '珠宝生命提高 %', 'prefix', 'normal', 'jewel_life', 'jewel', [tier(1, 60, 100), tier(2, 1, 500)], ['life']),
    modifier('jewel_damage', '珠宝伤害提高 %', 'prefix', 'normal', 'jewel_damage', 'jewel', [tier(1, 50, 100), tier(2, 1, 500)], ['attack']),
    modifier('jewel_speed', '珠宝速度提高 %', 'suffix', 'normal', 'jewel_speed', 'jewel', [tier(1, 50, 100), tier(2, 1, 500)], ['speed']),
    modifier('jewel_resistance', '珠宝抗性提高 %', 'suffix', 'normal', 'jewel_resistance', 'jewel', [tier(1, 50, 100), tier(2, 1, 500)], ['fire']),
    modifier('jewel_desecrated', '珠宝亵渎专属词缀', 'prefix', 'desecrated', 'jewel_desecrated', 'jewel', [tier(1, 65, 40)], [])
  ];
  return withIndexes({
    schemaVersion: 2,
    dataVersion: 'strict-test',
    source: { confidence: 'test-exact-pools' },
    bases: [
      { id: 'bow', name: '弓', tags: ['weapon', 'martial'], maxPrefixes: 3, maxSuffixes: 3 },
      { id: 'ring', name: '戒指', tags: ['jewellery'], maxPrefixes: 3, maxSuffixes: 3 },
      { id: 'armour', name: '护甲', tags: ['armour'], maxPrefixes: 3, maxSuffixes: 3 },
      { id: 'jewel', name: '珠宝', tags: ['jewel'], maxPrefixes: 3, maxSuffixes: 3 },
      { id: 'waystone', name: '路石', tags: ['waystone'], maxPrefixes: 3, maxSuffixes: 3 }
    ],
    modifiers,
    currencies: JSON.parse(JSON.stringify(currencyRules)),
    omens: JSON.parse(JSON.stringify(omenRules)),
    rules: [],
    localization: []
  });
}

module.exports = { makeStrictData, withIndexes, tier };
