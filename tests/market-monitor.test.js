'use strict';

const assert = require('node:assert/strict');
const {
  normalizeCurrency,
  parsePoeTradeUrl,
  buildOfficialEndpoints,
  extractResultIds,
  filterListings,
  checkMarketMonitor,
  normalizeServerKey
} = require('../src/market-monitor');

assert.equal(normalizeCurrency('神圣石'), 'divine');
assert.equal(normalizeCurrency('Exalted Orb'), 'exalted');
assert.equal(normalizeCurrency('混沌'), 'chaos');
assert.equal(normalizeCurrency('Orb of Alteration'), 'alteration');
assert.equal(normalizeServerKey('poe2-global'), 'poe2-intl');

const poe1Cn = parsePoeTradeUrl('https://poe.game.qq.com/trade/search/S27/xyz987');
assert.equal(poe1Cn.serverKey, 'poe1-cn');
assert.equal(poe1Cn.apiVersion, 'trade');
assert.equal(poe1Cn.game, 'poe1');
assert.ok(buildOfficialEndpoints(poe1Cn).searchUrl.includes('/api/trade/search/S27/xyz987'));

const poe1Intl = parsePoeTradeUrl('https://www.pathofexile.com/trade/search/Standard/p1abc');
assert.equal(poe1Intl.serverKey, 'poe1-intl');
assert.equal(poe1Intl.realm, 'pc');
assert.ok(buildOfficialEndpoints(poe1Intl).fetchBaseUrl.endsWith('/api/trade/fetch'));

const target = parsePoeTradeUrl('https://www.pathofexile.com/trade2/search/poe2/Dawn%20of%20the%20Hunt/abc123?realm=pc');
assert.equal(target.apiVersion, 'trade2');
assert.equal(target.game, 'poe2');
assert.equal(target.league, 'Dawn of the Hunt');
assert.equal(target.queryId, 'abc123');
const endpoints = buildOfficialEndpoints(target);
assert.ok(endpoints.searchUrl.includes('/api/trade2/search/poe2/'));
assert.ok(endpoints.fetchBaseUrl.endsWith('/api/trade2/fetch'));

assert.deepEqual(extractResultIds({ result: ['a', { id: 'b' }, null] }), ['a', 'b']);

const records = [
  { id: '1', online: true, price: { amount: 9, currency: 'divine' } },
  { id: '2', online: false, price: { amount: 7, currency: 'divine' } },
  { id: '3', online: true, price: { amount: 2, currency: 'exalted' } },
  { id: '4', online: true, price: null }
];
assert.deepEqual(filterListings(records, { priceCurrency: '神圣石', minPrice: 5, maxPrice: 10, onlyOnline: true }).map((x) => x.id), ['1']);

(async () => {
  const calls = [];
  const result = await checkMarketMonitor({
    url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/queryid?realm=pc',
    priceCurrency: 'divine',
    minPrice: 5,
    maxPrice: 10,
    onlyOnline: true,
    maxFetch: 2
  }, {
    requestJson: async (url) => {
      calls.push(url);
      if (url.includes('/search/')) return { result: ['r1', 'r2', 'r3'] };
      return {
        result: [
          { id: 'r1', item: { name: 'A', typeLine: 'Ring' }, listing: { price: { amount: 6, currency: 'divine', type: '~price' }, account: { name: 'seller', online: {} }, whisper: '@seller hi' } },
          { id: 'r2', item: { typeLine: 'Ring' }, listing: { price: { amount: 12, currency: 'divine', type: '~price' }, account: { name: 'seller2', online: {} } } }
        ]
      };
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.totalResultCount, 3);
  assert.equal(result.fetchedCount, 2);
  assert.equal(result.matchCount, 1);
  assert.equal(result.matches[0].seller, 'seller');
  console.log('market-monitor tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
