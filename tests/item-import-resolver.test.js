'use strict';

const assert = require('node:assert/strict');
const { parseItemText } = require('../src/item-parser');
const { resolveImportedItem, semanticDescriptor } = require('../src/item-import-resolver');

const text = `物品类别: 护甲
稀有度: 稀有
苍空 防身甲
邪恶束衣
--------
品质: +20% (augmented)
能量护盾: 496 (augmented)
--------
需求： 等级 65, 121 智慧
--------
插槽: S S 
--------
物品等级: 82
--------
冰霜抗性 +36% (rune)
--------
{ 亵渎的 前缀属性 "女男爵的" (等阶：7) }
+35 (34-37) 精魂
{ 亵渎的 前缀属性 "脉冲的" (等阶：6) — 能量护盾 }
+42 (42-47) 能量护盾上限
{ 亵渎的 前缀属性 "坚不可摧的" (等阶：2) — 能量护盾 }
能量护盾提高 94 (92-100)%
{ 亵渎的 后缀属性 "巴曼斯之" (等阶：1) — 混沌, 抗性 }
混沌抗性 +25 (24-27)%
{ 亵渎的 后缀属性 "提耶须之" (等阶：1) — 元素, 火焰, 抗性 }
火焰抗性 +42 (41-45)%
{ 亵渎的 后缀属性 "独角鲸之" (等阶：6) — 元素, 冰霜, 抗性 }
冰霜抗性 +18 (16-20)%
--------
被腐化
--------
引路石掉落`;

const parsed = parseItemText(text);
assert.equal(parsed.ok, true);
assert.equal(parsed.item.mods.filter((entry) => entry.affixType).length, 6);
assert.deepEqual(parsed.item.mods.find((entry) => entry.affixName === '女男爵的').rollRanges, [[34, 37]]);
assert.equal(parsed.item.mods.find((entry) => entry.affixName === '女男爵的').template, '# 精魂');

const base = {
  id: 'body-int',
  name: '胸甲（智慧）',
  englishName: 'Body Armour (INT)',
  aliases: ['Body Armour (INT)', '胸甲（智慧）'],
  tags: ['armour'],
  concreteBaseItems: [{ id: 'evil-vestment', name: '邪恶束衣', englishName: 'Vile Vestments' }]
};

function modifier(id, name, englishName, type, source, tier, range, family) {
  return {
    id,
    name,
    englishName,
    type,
    source,
    family,
    families: [family],
    allowedBaseIds: [base.id],
    tiers: [{ tier, level: 1, ranges: [range], tierName: '' }],
    sourceMeta: { sourceModifierId: id.replace(/^m/, '') }
  };
}

const data = {
  bases: [base],
  modifiers: [
    modifier('m5076', '+# 精魂', '+# to Spirit', 'prefix', 'normal', 7, [34, 37], 'spirit'),
    modifier('m5066', '+# 最大能量护盾', '+# to maximum Energy Shield', 'prefix', 'normal', 6, [42, 47], 'flat-es'),
    modifier('m5069', '最大能量护盾提高 #%', '#% increased maximum Energy Shield', 'prefix', 'normal', 2, [92, 100], 'percent-es'),
    modifier('m5041', '+#% 混沌抗性', '+#% to Chaos Resistance', 'suffix', 'normal', 1, [24, 27], 'chaos-res'),
    modifier('m5037', '+#% 火焰抗性', '+#% to Fire Resistance', 'suffix', 'normal', 1, [41, 45], 'fire-res'),
    modifier('m5038', '+#% 冰霜抗性', '+#% to Cold Resistance', 'suffix', 'normal', 6, [16, 20], 'cold-res'),
    // 同 T 级、同区间的干扰候选，必须依靠元素语义排除。
    modifier('m5039', '+#% 闪电抗性', '+#% to Lightning Resistance', 'suffix', 'normal', 1, [41, 45], 'lightning-res')
  ]
};

const resolved = resolveImportedItem(data, parsed.item);
assert.equal(resolved.ok, true);
assert.equal(resolved.base.id, base.id);
assert.equal(resolved.concreteBase.id, 'evil-vestment');
assert.equal(resolved.counts.prefix, 3);
assert.equal(resolved.counts.suffix, 3);
assert.equal(resolved.counts.matched, 6);
assert.equal(resolved.counts.unresolved, 0);
assert.equal(resolved.state.quality, 20);
assert.equal(resolved.state.sockets, 2);
assert.equal(resolved.state.flags.corrupted, true);
assert.equal(resolved.state.flags.desecrated, true);
assert.ok(resolved.matches.every((entry) => entry.source === 'normal'));
assert.deepEqual(new Set(resolved.matches.map((entry) => entry.modifierId)), new Set(['m5076', 'm5066', 'm5069', 'm5041', 'm5037', 'm5038']));
assert.ok(resolved.matches.every((entry) => entry.method === 'semantic-and-range' || entry.method === 'exact-template'));

const rawEs = semanticDescriptor('能量护盾提高 94 (92-100)%');
const sourceEs = semanticDescriptor('#% increased maximum Energy Shield');
assert.deepEqual([...rawEs.tokens].sort(), [...sourceEs.tokens].sort());

// 多行混合词缀必须只算一个显式词缀。
const hybrid = parseItemText(`物品类别: 武器
稀有度: 稀有
测试武器
长棍
--------
物品等级: 82
--------
{ 前缀属性 "混合的" (等阶：1) }
物理伤害提高 100 (90-110)%
命中值 +120 (100-130)
--------`);
assert.equal(hybrid.ok, true);
assert.equal(hybrid.item.mods.filter((entry) => entry.affixType).length, 1);
assert.equal(hybrid.item.mods.find((entry) => entry.affixType).lines.length, 2);
assert.deepEqual(hybrid.item.mods.find((entry) => entry.affixType).rollRanges, [[90, 110], [100, 130]]);

console.log('item-import-resolver tests passed');
