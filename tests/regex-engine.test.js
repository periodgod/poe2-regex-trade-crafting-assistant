'use strict';
const assert = require('node:assert/strict');
const { numericAtLeast, generatePoeQuery, testPoeQuery, tokenizePoeQuery } = require('../src/regex-engine');

const n37 = new RegExp(`^(?:${numericAtLeast(37)})$`);
for (const value of ['37', '38', '99', '100', '9999']) assert.equal(n37.test(value), true, value);
for (const value of ['0', '7', '36']) assert.equal(n37.test(value), false, value);

const result = generatePoeQuery({
  must: [{ pattern: '最大生命', literal: true }],
  any: [{ pattern: '火焰抗性', literal: true }, { pattern: '冰霜抗性', literal: true }],
  exclude: [{ pattern: '被腐化', literal: true }],
  numeric: [{ label: '移动速度', min: 30, group: 'must', literalLabel: true }]
});
assert.equal(result.ok, true);
assert.ok(result.query.includes('最大生命'));
assert.ok(result.query.includes('火焰抗性|冰霜抗性'));
assert.ok(result.query.includes('!被腐化'));
assert.ok(tokenizePoeQuery(result.query).length >= 4);

const matching = `最大生命 +120\n冰霜抗性 +42%\n移动速度提高 35%`;
assert.equal(testPoeQuery(result.query, matching).matched, true);
assert.equal(testPoeQuery(result.query, `${matching}\n被腐化`).matched, false);
assert.equal(testPoeQuery(result.query, `最大生命 +120\n移动速度提高 35%`).matched, false);

console.log('regex-engine tests passed');
