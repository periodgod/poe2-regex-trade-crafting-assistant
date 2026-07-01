'use strict';

const assert = require('node:assert/strict');
const { parseItemText } = require('../src/item-parser');

const equipmentText = `物品类别: 护甲
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
火焰抗性 +18% (rune)
冰霜抗性 +18% (rune)
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

const equipment = parseItemText(equipmentText);
assert.equal(equipment.ok, true);
assert.equal(equipment.item.category, 'equipment');
assert.equal(equipment.item.name, '苍空 防身甲');
assert.equal(equipment.item.baseType, '邪恶束衣');
assert.equal(equipment.item.quality, 20);
assert.equal(equipment.item.defenses.energyShield, 496);
assert.equal(equipment.item.requiredLevel, 65);
assert.equal(equipment.item.requirements.intelligence, 121);
assert.equal(equipment.item.itemLevel, 82);
assert.equal(equipment.item.flags.corrupted, true);
assert.ok(equipment.item.mods.some((mod) => mod.text.includes('混沌抗性')));
const firstStructuredMod = equipment.item.mods.find((mod) => mod.text.includes('精魂'));
assert.equal(firstStructuredMod.affixType, 'prefix');
assert.equal(firstStructuredMod.tier, 7);
assert.equal(firstStructuredMod.source, 'desecrated');
assert.equal(firstStructuredMod.affixName, '女男爵的');

const mapText = `物品类别: 引路石
稀有度: 稀有
曲空 羁绊
引路石（ 15 阶）
--------
复活次数: 0 (augmented)
物品稀有度: +37% (augmented)
怪物群规模: +22% (augmented)
怪物效能: +26% (augmented)
引路石掉落几率: +110% (augmented)
--------
物品等级: 82
--------
{ 前缀属性 "穿孔的" (等阶：1) }
怪物的击中有 18 (15-20)% 的几率造成流血
{ 前缀属性 "冲击的" (等阶：1) }
怪物的晕眩积蓄提高 100 (90-100)%
{ 前缀属性 "精确的" (等阶：1) }
怪物的命中值提高 35 (30-40)%
{ 前缀属性 "灭绝的" (等阶：1) }
怪物暴击率提高 230 (200-240)%
+21 (21-25)% 怪物暴击伤害加成
{ 后缀属性 "疲惫之" (等阶：1) }
玩家的冷却回复率总降 28 (30-25)%
{ 后缀属性 "闪避之" (等阶：1) }
怪物具有闪避
{ 后缀属性 "雨雪的" (等阶：1) }
区域内有冰缓地面
{ 后缀属性 "缓冲之" (等阶：1) }
怪物将生命上限的 20 (12-25)% 转化为额外能量护盾上限
--------
可在地图装置中使用，可使你能进入一张地图。引路石只能被使用一次。
--------
被腐化
--------
引路石掉落`;

const map = parseItemText(mapText);
assert.equal(map.ok, true);
assert.equal(map.item.category, 'map');
assert.equal(map.item.name, '曲空 羁绊');
assert.equal(map.item.mapTier, 15);
assert.equal(map.item.itemLevel, 82);
assert.equal(map.item.mapProperties.packSize, 22);
assert.equal(map.item.mapProperties.waystoneDropChance, 110);
assert.equal(map.item.flags.corrupted, true);

const currencyText = `物品类别: 孕育赠礼
稀有度: 通货
印戒孕育赠礼
--------
物品等级: 80
需要 1023 虫巢之血
--------
能在起源之树上培育为戒指
--------
将此物品放入起源之树的戒指孕育槽位中。右键点击即可从起源之树中取回。
--------
引路石掉落`;

const currency = parseItemText(currencyText);
assert.equal(currency.ok, true);
assert.equal(currency.item.category, 'currency');
assert.equal(currency.item.name, '印戒孕育赠礼');
assert.equal(currency.item.itemLevel, 80);
assert.equal(currency.item.incubation.amount, 1023);
assert.equal(currency.item.incubation.resource, '虫巢之血');

assert.equal(Object.hasOwn(equipment, 'searchPreview'), false);

console.log('item-parser tests passed');
