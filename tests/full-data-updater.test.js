'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  COE_DATA_REPOSITORY,
  FALLBACK_COE_DATA_COMMIT,
  SOURCE_FILES,
  KNOWN_BASE_ID_ALIASES,
  KNOWN_SYNTHETIC_BASES,
  sourceUrls,
  inferModifierTags,
  buildEffectiveBaseGraph,
  normalizeCraftOfExileData,
  validateAndCount,
  writeBufferAtomic,
  installSnapshotDirectory
} = require('../scripts/update-poe2-full-data');

assert.equal(COE_DATA_REPOSITORY, 'Ruined-buil/CraftofExile2Data');
assert.match(FALLBACK_COE_DATA_COMMIT, /^[0-9a-f]{40}$/);
assert.deepEqual(SOURCE_FILES.map((x) => x.name), [
  'summary.json', 'bases.json', 'base_items.json', 'modifiers.json', 'modifier_types.json', 'modifier_groups.json', 'modifier_tiers.json', 'lang_base.json', 'lang_mod.json', 'essences.json', 'socketables.json'
]);
assert.ok(sourceUrls('a'.repeat(40), 'summary.json').some((url) => url.includes('raw.githubusercontent.com')));
assert.ok(sourceUrls('a'.repeat(40), 'summary.json').some((url) => url.includes('cdn.jsdelivr.net')));
assert.equal(sourceUrls('a'.repeat(40), 'summary.json').some((url) => /\/main\//.test(url) || /@main\//.test(url)), false, '固定提交下载不得与 main 逐文件混用');
assert.deepEqual(inferModifierTags('Kurgal grants Cold Damage', ['amanamu_mod', 'ulaman_mod', 'cold']).sort(), ['cold', 'kurgal_mod']);
assert.deepEqual(inferModifierTags('Amanamu grants Life', ['kurgal_mod', 'life']).sort(), ['amanamu_mod', 'life']);
assert.ok(inferModifierTags('Cold Damage', []).includes('cold'));
assert.equal(KNOWN_BASE_ID_ALIASES['230'], '233');
assert.equal(KNOWN_BASE_ID_ALIASES['231'], '234');
assert.equal(KNOWN_BASE_ID_ALIASES['232'], '235');
assert.equal(KNOWN_SYNTHETIC_BASES['51'].name_base, 'Body Armour (STR/DEX/INT)');


{
  // Windows 上杀毒软件/索引器可能在文件刚创建时短暂返回 EPERM。
  // 原子写入必须改用随机 part 文件并重试，不能把半文件留在最终 JSON 路径。
  const atomicRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-atomic-write-'));
  const destination = path.join(atomicRoot, 'base_items.json');
  const originalOpenSync = fs.openSync;
  let injectedFailures = 2;
  try {
    fs.openSync = function patchedOpenSync(filePath, flags, ...rest) {
      if (String(filePath).includes('.download-') && injectedFailures > 0) {
        injectedFailures -= 1;
        const error = new Error('simulated Windows scanner lock');
        error.code = 'EPERM';
        throw error;
      }
      return originalOpenSync.call(fs, filePath, flags, ...rest);
    };
    const payload = Buffer.from('{"ok":true,"items":[1,2,3]}', 'utf8');
    const result = writeBufferAtomic(destination, payload, { retries: 4, retryDelay: 0 });
    assert.equal(result.bytes, payload.length);
    assert.equal(fs.readFileSync(destination, 'utf8'), payload.toString('utf8'));
    assert.equal(injectedFailures, 0, 'EPERM retry path was not exercised');
    assert.deepEqual(
      fs.readdirSync(atomicRoot).filter((name) => name.endsWith('.part')),
      [],
      'atomic download left a partial file behind'
    );
  } finally {
    fs.openSync = originalOpenSync;
    fs.rmSync(atomicRoot, { recursive: true, force: true });
  }
}

{
  const graph = buildEffectiveBaseGraph(
    [
      { id_base: '233', name_base: 'Low Tier (1-5)' },
      { id_base: '234', name_base: 'Mid Tier (6-10)' },
      { id_base: '235', name_base: 'Top Tier (11-15)' }
    ],
    [
      { id_bitem: '642', id_base: '51', name_bitem: 'Garment', imgurl: 'Armours/BodyArmours/FourBodyStrDexIntBase.webp' },
      { id_bitem: '837', id_base: '230', name_bitem: 'Waystone (Low)' },
      { id_bitem: '838', id_base: '231', name_bitem: 'Waystone (Mid)' },
      { id_bitem: '839', id_base: '232', name_bitem: 'Waystone (Top)' }
    ],
    [{ base_id: '51' }],
    { '233': 'Low Tier (1-5)', '234': 'Mid Tier (6-10)', '235': 'Top Tier (11-15)' }
  );
  assert.equal(graph.resolutionBySourceId.get('230'), '233');
  assert.equal(graph.resolutionBySourceId.get('231'), '234');
  assert.equal(graph.resolutionBySourceId.get('232'), '235');
  assert.equal(graph.resolutionBySourceId.get('51'), '51');
  assert.equal(graph.baseById.get('51').name_base, 'Body Armour (STR/DEX/INT)');
  assert.equal(graph.aliasResolutions.length, 3);
  assert.equal(graph.syntheticBases.length, 1);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-coe-normalize-'));
const source = path.join(temp, 'source');
const output = path.join(temp, 'output');
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(output, { recursive: true });
try {
  // 复刻 0.5.0 快照的数量结构：80/1775/1318/19023，规范化后约 10970 个 T 级。
  // 第 80 个底材只有非显式记录，用于验证合法空池不会再造成 80 -> 79。
  const sourceBaseIds = [
    ...Array.from({ length: 77 }, (_, i) => i + 1).filter((id) => id !== 51),
    233, 234, 235, 245
  ].map(String);
  assert.equal(sourceBaseIds.length, 80);
  const bases = sourceBaseIds.map((baseId, i) => ({
    id_base: baseId,
    id_bgroup: String((i % 13) + 1),
    name_base: i === 0 ? 'Bow'
      : i === 1 ? 'Ring'
        : baseId === '233' ? 'Low Tier (1-5)'
          : baseId === '234' ? 'Mid Tier (6-10)'
            : baseId === '235' ? 'Top Tier (11-15)'
              : baseId === '245' ? 'Uber Tier'
                : `Base ${baseId}`,
    is_jewellery: i === 1 ? '1' : '0',
    is_martial: i === 0 ? '1' : '0',
    base_type: 'master'
  }));
  const modifiers = Array.from({ length: 1318 }, (_, i) => ({
    id_modifier: String(5000 + i),
    affix: i < 1000 ? (i % 2 ? 'suffix' : 'prefix') : 'implicit',
    name_modifier: i === 0 ? '#% increased Physical Damage' : i === 1 ? '#% to Fire Resistance' : `Modifier ${i}`,
    modgroup: `Family${i}`,
    modgroups: [`Family${i}`, `Shared${i % 400}`],
    mtypes: '|1|',
    id_mgroup: i === 39 ? '10' : '1'
  }));

  const supportedRows = [];
  for (const baseId of sourceBaseIds.slice(0, 79)) {
    for (let mod = 0; mod < 40; mod += 1) {
      supportedRows.push({
        modifier_id: String(5000 + mod), base_id: baseId, item_level: 1,
        weighting: 1000, stat_ranges: [[1, 5]], tier_order: 0, alias: null
      });
    }
  }
  while (supportedRows.length < 10970) {
    const i = supportedRows.length;
    const base = sourceBaseIds[i % 79];
    const mod = i % 40;
    supportedRows.push({
      modifier_id: String(5000 + mod), base_id: base, item_level: 2 + (i % 81),
      weighting: 100 + (i % 900), stat_ranges: [[i % 20, (i % 20) + 5]], tier_order: i % 10, alias: null
    });
  }
  for (let i = 0; i < 305; i += 1) supportedRows[i].weighting = 0;
  supportedRows[supportedRows.length - 1].base_id = '51';

  const rows = [...supportedRows];
  while (rows.length < 19023) {
    const i = rows.length;
    rows.push({
      modifier_id: String(6000 + (i % 318)), // implicit，规范化器应审计后忽略
      base_id: '245', item_level: i % 83, weighting: 1000,
      stat_ranges: [[1, 2]], tier_order: 0, alias: null
    });
  }

  const baseItems = Array.from({ length: 1775 }, (_, i) => {
    const base = bases[i % bases.length];
    const orphanCases = [
      { id_base: '51', name_bitem: 'Garment', imgurl: 'Armours/BodyArmours/FourBodyStrDexIntBase.webp' },
      { id_base: '230', name_bitem: 'Low Waystone Item', imgurl: 'Maps/Waystone.webp' },
      { id_base: '231', name_bitem: 'Mid Waystone Item', imgurl: 'Maps/Waystone.webp' },
      { id_base: '232', name_bitem: 'Top Waystone Item', imgurl: 'Maps/Waystone.webp' }
    ];
    const override = orphanCases[i] || {};
    return { id_bitem: String(i + 1), id_base: override.id_base || base.id_base, name_bitem: override.name_bitem || `${base.name_base} Item ${i + 1}`, drop_level: String(i % 83), properties: { armour: i }, requirements: { level: i % 83 }, implicits: ['+# Life'], imgurl: override.imgurl || `item${i}.webp`, exp: String(i), exmods: { test: true }, tgb: 'tag-group' };
  });
  const documents = {
    'summary.json': {
      source: 'https://www.craftofexile.com/emulator?game=poe2',
      current_version: '0.5.0-test',
      counts: { bases: 80, base_items: 1775, modifiers: 1318, modifier_types: 52, tier_rows: 19023, language_bases: 80, language_mods: 1318, essences: 2, socketables: 2 },
      caveat: 'weights inferred'
    },
    'bases.json': bases,
    'base_items.json': baseItems,
    'modifiers.json': modifiers,
    'modifier_types.json': Array.from({ length: 52 }, (_, i) => ({ id_mtype: String(i + 1), poedb_id: i === 0 ? 'physical' : `type_${i + 1}`, name_mtype: i === 0 ? 'Physical' : `Type ${i + 1}` })),
    'modifier_groups.json': [
      { id_mgroup: '1', name_mgroup: 'Base', is_main: '1' },
      { id_mgroup: '10', name_mgroup: 'Desecrated', is_main: '0' },
      { id_mgroup: '13', name_mgroup: 'Essence', is_main: '0' }
    ],
    'modifier_tiers.json': rows,
    'lang_base.json': Object.fromEntries(bases.map((entry) => [entry.id_base, entry.name_base])),
    'lang_mod.json': Object.fromEntries(modifiers.map((entry) => [entry.id_modifier, entry.name_modifier])),
    'essences.json': [
      { id_essence: '1', name_essence: 'Essence of Abrasion', tooltip: ['Bow: Adds # to # Physical Damage'], tiers: { '1': [[{ mod: '5000', id: 'TestEssence', ilvl: '40' }]] }, corrupt: '0' },
      { id_essence: '2', name_essence: 'Perfect Essence of Alacrity', tooltip: ['Bow: #% increased Attack Speed'], tiers: { '1': [[{ mod: '5001', id: 'TestPerfectEssence', ilvl: '50' }]] }, corrupt: '1' }
    ],
    'socketables.json': [
      { id_socketable: '1', stype: 'rune', name_socketable: 'Adept Rune', mods: { all: '5000', armour: null, weapons: null, caster: null, class: [] }, imgurl: 'rune.webp' },
      { id_socketable: '2', stype: 'soulcore', name_socketable: "Amanamu's Gaze", mods: { all: null, armour: null, weapons: null, caster: null, class: [{ bgroup: 7, bases: ['1'], mod: '5001' }] }, imgurl: 'soulcore.webp' }
    ]
  };
  for (const [name, payload] of Object.entries(documents)) fs.writeFileSync(path.join(source, name), JSON.stringify(payload));

  const normalized = normalizeCraftOfExileData(source, output);
  assert.equal(normalized.counts.sourceBases, 80);
  assert.equal(normalized.counts.effectiveBases, 81);
  assert.equal(normalized.counts.exactBasePools, 81);
  assert.equal(normalized.counts.synthesizedBasePools, 1);
  assert.equal(normalized.counts.aliasedSourceBaseIds, 3);
  assert.equal(normalized.counts.sourceBaseItems, 1775);
  assert.equal(normalized.counts.sourceLanguageBases, 80);
  assert.equal(normalized.counts.sourceLanguageModifiers, 1318);
  assert.equal(normalized.counts.sourceEssences, 2);
  assert.equal(normalized.counts.sourceSocketables, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'essences.json'), 'utf8')).length, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'socketables.json'), 'utf8')).length, 2);
  assert.equal(normalized.counts.modifierTiers, 10970);
  assert.equal(normalized.counts.positiveWeightTiers, 10665);
  assert.equal(normalized.counts.zeroWeightTiers, 305);
  assert.equal(normalized.counts.emptyBasePools, 1);
  assert.ok(normalized.counts.modifierPools >= 3000);

  const index = JSON.parse(fs.readFileSync(path.join(output, 'by-base', 'index.json'), 'utf8'));
  assert.ok(index.Bow && index.Ring && index['Uber Tier'] && index['Body Armour (STR/DEX/INT)']);
  const emptyPool = JSON.parse(fs.readFileSync(path.join(output, 'by-base', `${index['Uber Tier']}.mods.json`), 'utf8'));
  assert.deepEqual(emptyPool, []);
  const concrete = JSON.parse(fs.readFileSync(path.join(output, 'base-items.json'), 'utf8'));
  assert.equal(concrete.length, 1775);
  assert.equal(concrete.find((item) => item.sourceBaseItemId === '1').resolvedSourceBaseId, '51');
  assert.equal(concrete.find((item) => item.sourceBaseItemId === '2').resolvedSourceBaseId, '233');
  assert.equal(concrete.find((item) => item.sourceBaseItemId === '3').resolvedSourceBaseId, '234');
  assert.equal(concrete.find((item) => item.sourceBaseItemId === '4').resolvedSourceBaseId, '235');
  assert.equal(concrete[0].tagGroup, 'tag-group');
  assert.ok(concrete[0].externalModifiers);
  assert.ok(normalized.counts.sourceBreakdown.normal.positiveWeightTiers > 0);
  assert.ok(normalized.counts.sourceBreakdown.desecrated.positiveWeightTiers > 0);

  const bowPool = JSON.parse(fs.readFileSync(path.join(output, 'by-base', `${index.Bow}.mods.json`), 'utf8'));
  assert.ok(bowPool.every((record) => record.base === 'Bow' && record.sourceBaseId === '1'));
  assert.ok(bowPool.every((record) => Array.isArray(record.families) && record.families.length));

  // 同时覆盖正式更新器的 raw-source 审计分支：十一份原始文件必须全部存在，
  // lang_base/lang_mod 是对象映射，其余列表文件为数组。
  const rawSource = path.join(output, 'raw-source');
  fs.cpSync(source, rawSource, { recursive: true });
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
    status: 'ready', strictBasePools: true, counts: normalized.counts,
    files: { rawSourceDirectory: 'raw-source' }
  }));
  const verified = validateAndCount(output);
  assert.equal(verified.exactBasePools, 81);
  assert.equal(verified.concreteBaseItems, 1775);
  assert.equal(verified.modifierTiers, 10970);
  const installed = path.join(temp, 'installed-snapshot');
  installSnapshotDirectory(output, installed);
  const installedVerified = validateAndCount(installed);
  assert.deepEqual(installedVerified, verified);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('full-data-updater tests passed');
