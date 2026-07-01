'use strict';

const assert = require('node:assert/strict');
const { parseItemText } = require('../src/item-parser');

assert.equal(parseItemText('').ok, false);
assert.equal(parseItemText('ordinary clipboard text').ok, false);

const englishItem = parseItemText(`Item Class: Bows
Rarity: Rare
Doom String
Dualstring Bow
--------
Quality: +20% (augmented)
--------
Item Level: 82
--------
Adds 10 to 20 Physical Damage
+95 to Accuracy Rating
--------
Corrupted`);
assert.equal(englishItem.ok, true);
assert.equal(englishItem.item.category, 'equipment');
assert.equal(englishItem.item.name, 'Doom String');
assert.equal(englishItem.item.baseType, 'Dualstring Bow');
assert.equal(englishItem.item.itemLevel, 82);
assert.equal(englishItem.item.quality, 20);
assert.equal(englishItem.item.flags.corrupted, true);
assert.equal(englishItem.item.mods.length, 2);
assert.equal(Object.hasOwn(englishItem, 'searchPreview'), false);

const chineseBow = parseItemText(`物品类别: 弓
稀有度: 稀有
寒锋
双弦弓
--------
物品等级: 82
--------
附加 12 到 21 点冰霜伤害
攻击速度提高 18%`);
assert.equal(chineseBow.ok, true);
assert.equal(chineseBow.item.baseType, '双弦弓');
assert.equal(chineseBow.item.mods.length, 2);

console.log('regression tests passed');
