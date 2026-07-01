'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  makeChronicleUrl,
  extractChronicleRecord,
  syncChronicleLocalization,
  readChronicleFile,
  buildChronicleIndex,
  findChronicleRecord
} = require('../src/chronicle-zh');

const fixture = `<!doctype html><html><body>
<nav>物品 词缀 使命</nav>
<div class="item-box">
<h1>次级风暴符文</h1>
<div>增幅器</div>
<div>堆叠数量: 1 / 10</div>
<div>战斗武器: 附加 1 - 10 闪电伤害</div>
<div>法杖或长杖: 获得相当于伤害 6% 的额外闪电伤害</div>
<div>护甲: 闪电抗性 +10%</div>
<p>放入武器或护甲的一个空的增幅器插槽中，即可将其效果应用于此物品。</p>
<div>Lesser Storm Rune</div>
</div>
<table><tr><td>BaseType</td><td>Lesser Storm Rune</td></tr><tr><td>BaseType</td><td>次级风暴符文</td></tr></table>
</body></html>`;


const compressedTableFixture = `<!doctype html><html><body>
<div>高级行家符文 RuneDexterityGreater</div>
<div>高级行家符文</div>
<div>增幅器</div>
<div>堆叠数量: 1 / 10</div>
<div>所有装备: +12 敏捷</div>
<div>羁绊</div>
<div>战斗武器: 攻击附加物理伤害</div>
<div>法杖或长杖: +80 闪避值</div>
<div>护甲: +20 生命上限</div>
<div>放入任意装备的空置增幅器插槽中。</div>
<div>Greater Adept Rune</div>
<table><tr><td>BaseType</td><td>Greater Adept Rune</td></tr><tr><td>BaseType</td><td>高级行家符文</td></tr><tr><td>Class</td><td>增幅器</td></tr></table>
</body></html>`;
const compressedParsed = extractChronicleRecord(compressedTableFixture, { kind: 'socketable', sourceId: '200', englishName: 'Greater Adept Rune' });
assert.equal(compressedParsed.ok, true);
assert.equal(compressedParsed.zhName, '高级行家符文');

const parsed = extractChronicleRecord(fixture, { kind: 'socketable', sourceId: '5', englishName: 'Lesser Storm Rune' });
assert.equal(parsed.ok, true);
assert.equal(parsed.zhName, '次级风暴符文');
assert.ok(parsed.descriptionLines.some((line) => line.includes('闪电伤害')));
assert.ok(parsed.descriptionLines.every((line) => !line.includes('堆叠数量')));
assert.equal(makeChronicleUrl("Amanamu's Gaze"), 'https://poe2db.tw/cn/Amanamus_Gaze');
const seededIndex = buildChronicleIndex(readChronicleFile(path.join(os.tmpdir(), 'missing-chronicle-file.json')));
assert.equal(findChronicleRecord(seededIndex, 'socketable', 'Adept Rune').zhName, '行家符文');
assert.equal(findChronicleRecord(seededIndex, 'socketable', "Amanamu's Gaze").zhName, '埃曼纳姆的凝视');
for (const [english, chinese] of [
  ['Greater Adept Rune', '高级行家符文'], ['Perfect Resolve Rune', '完美坚毅符文'],
  ['Lesser Robust Rune', '次级健壮符文'], ['Masterwork Rune', '大师符文'],
  ["Aldur's Legacy", '奥杜尔的遗产'], ["Astrid's Creativity", '阿斯特丽德的创造'], ["Serle's Triumph", '瑟尔的凯旋']
]) assert.equal(findChronicleRecord(seededIndex, 'socketable', english).zhName, chinese);

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-chronicle-test-'));
  try {
    const destination = path.join(temp, 'chronicle-zh.json');
    const payload = await syncChronicleLocalization({
      destination,
      targets: [{ key: 'socketable:5', kind: 'socketable', sourceId: '5', englishName: 'Lesser Storm Rune' }],
      concurrency: 1,
      retries: 0,
      fetchText: async () => fixture
    });
    assert.equal(payload.counts.targets, 1);
    assert.equal(payload.counts.matched, 1);
    const stored = readChronicleFile(destination);
    const index = buildChronicleIndex(stored);
    assert.equal(findChronicleRecord(index, 'socketable', 'Lesser Storm Rune', '5').zhName, '次级风暴符文');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('chronicle-zh tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
