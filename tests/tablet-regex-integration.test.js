'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'renderer', 'regex-generator.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const cutoff = source.lastIndexOf("$$('#scopeList");
assert.ok(cutoff > 0, 'Unable to isolate renderer definitions');

const context = {
  window: { desktopApi: null },
  localStorage: { getItem: () => null, setItem: () => {} },
  console,
  setTimeout,
  clearTimeout,
  Blob: function Blob() {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  FileReader: function FileReader() {}
};
vm.createContext(context);
vm.runInContext(`${source.slice(0, cutoff)}\n;globalThis.__regexTest={TABLET_DB,WAYSTONE_MOD_DB,parseTabletText,tabletPattern,parseTemplate,numberPattern,outputString,state};`, context);

const { TABLET_DB, WAYSTONE_MOD_DB, parseTabletText, tabletPattern, parseTemplate } = context.__regexTest;
assert.equal(TABLET_DB.mods.length, 83);
assert.equal(TABLET_DB.uniques.length, 10);
assert.equal(TABLET_DB.bases.length, 8);
assert.equal(TABLET_DB.mods.filter((entry) => entry.affix === '前缀').length, 13);
assert.equal(TABLET_DB.mods.filter((entry) => entry.affix === '后缀').length, 70);

assert.equal(WAYSTONE_MOD_DB.length, 111, 'waystone modifier catalog should mirror PoE2DB CN /111 rows');
const t1Poison = WAYSTONE_MOD_DB.find((entry) => entry.zhPattern === '怪物的击中有 (27—33)% 的几率造成中毒');
assert.ok(t1Poison, 'T1 poison waystone mod missing');
const t1PoisonParsed = parseTemplate({ text: t1Poison.zhPattern });
assert.equal(t1PoisonParsed.vars[0].sourceMin, 27);
assert.equal(t1PoisonParsed.vars[0].sourceMax, 33);
const t1PoisonPattern = tabletPattern({ entry: { text: t1Poison.zhPattern }, values: { v1: { min: '27', max: '33' } } });
assert.equal(new RegExp(t1PoisonPattern).test('怪物的击中有 33 (27-33)% 的几率造成中毒'), true);
assert.equal(new RegExp(t1PoisonPattern).test('怪物的击中有 20 (20-26)% 的几率造成中毒'), false);
const burningGround = WAYSTONE_MOD_DB.find((entry) => entry.zhPattern === '区域内有点燃地面');
assert.ok(burningGround, 'fixed burning-ground waystone mod missing');
assert.equal(parseTemplate({ text: burningGround.zhPattern }).vars.length, 0, 'fixed waystone mods should not request numeric input');


const magicTablet = `物品类别: 石板
稀有度: 魔法
制图师之 霸主石板
--------
物品等级: 82
--------
{ 基底属性 }
强化一张地图中的地图首领
剩余次数：10
--------
{ 后缀属性 "制图师之" (等阶：1) }
地图内找到的引路石数量提高 31 (30-40)%`;
const parsedMagic = parseTabletText(magicTablet);
assert.equal(parsedMagic.base.name, '霸主石板');
assert.equal(parsedMagic.rarity, '魔法');
assert.ok(parsedMagic.hits.some((entry) => entry.id === 's53'), 'middle-number suffix should be recognized');

const clearSkies = `物品类别: 石板
稀有度: 传奇
万里晴空
惊悸迷雾石板
--------
物品等级: 82
--------
{ 基底属性 }
为一张地图增加惊悸迷雾之镜
剩余次数：5
--------
{ 传奇属性 }
你地图中的惊悸迷雾永不消散 — 数值不可调整
{ 传奇属性 }
根据与镜子的距离，地图内的惊悸迷雾填充速度减慢 2 (10--10)%`;
const parsedUnique = parseTabletText(clearSkies);
assert.equal(parsedUnique.unique.name, '万里晴空');
assert.equal(parsedUnique.base.name, '惊悸迷雾石板');
assert.equal(parsedUnique.rarity, '传奇');

const unique = TABLET_DB.uniques.find((entry) => entry.name === '万里晴空');
const uniqueEntry = { id: 'unique-clear-skies-1', text: unique.attrs[1], affix: '传奇', cat: '传奇属性' };
const uniquePattern = tabletPattern({ entry: uniqueEntry, values: {} }, true);
assert.equal(new RegExp(uniquePattern, 'm').test(clearSkies), true, 'unique middle-number text should match copied item text');

console.log('tablet regex integration tests passed');

function makeElement() {
  return {
    value: '',
    innerHTML: '',
    textContent: '',
    className: '',
    dataset: {},
    style: {},
    files: [],
    classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    appendChild() {},
    remove() {},
    select() {},
    click() {},
    setAttribute() {},
    addEventListener() {}
  };
}

const domContext = {
  window: { desktopApi: null },
  document: {
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    body: makeElement(),
    execCommand: () => true
  },
  navigator: { clipboard: { writeText: async () => {}, readText: async () => '' } },
  localStorage: { getItem: () => null, setItem: () => {} },
  console,
  setTimeout,
  clearTimeout,
  Blob: function Blob() {},
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
  FileReader: function FileReader() {}
};
vm.createContext(domContext);
assert.doesNotThrow(() => vm.runInContext(source, domContext), 'full renderer should initialize with a DOM-like environment');
