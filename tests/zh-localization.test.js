'use strict';
const assert = require('node:assert/strict');
const { localizeBaseName, localizeModifierName } = require('../src/zh-localization');

assert.equal(localizeBaseName('Body Armour (STR/DEX/INT)'), '胸甲（力量/敏捷/智慧）');
assert.equal(localizeBaseName('Delirium Precursor Tablet'), '惊悸迷雾先驱石板');
assert.equal(localizeModifierName('+# to Strength', '5033'), '+# 力量');
assert.equal(localizeModifierName('+#% to Fire Resistance', '5037'), '+#% 火焰抗性');
assert.equal(localizeModifierName('Adds # to # Physical Damage to Attacks', '5045'), '攻击附加 # 至 # 物理伤害');
assert.equal(localizeModifierName('#% increased Attack Speed', '5092'), '攻击速度提高 #%');
assert.equal(localizeModifierName('Damage Penetrates #% Cold Resistance', '5269'), '伤害穿透 #% 冰霜抗性');
assert.equal(localizeModifierName('Gain #% of Damage as Extra Fire Damage', '5158'), '获得等同于伤害 #% 的额外火焰伤害');

for (const text of [
  localizeModifierName('Minions deal #% increased Damage', '5272'),
  localizeModifierName('Area contains an additional Essence', '5366'),
  localizeModifierName('Monsters deal #% of Damage as Extra Lightning', '5399')
]) {
  assert.ok(text.length > 0);
  assert.equal(/[A-Za-z]{3,}/.test(text), false, `汉化结果不应残留英文：${text}`);
}
console.log('zh-localization tests passed');
