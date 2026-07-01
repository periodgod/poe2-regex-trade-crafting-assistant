const assert = require('assert');
const { parseTradeUrl, normalizeCurrency, passFilters, mockItems, sanitizeCookie, sanitizeClickTask } = require('./server');

const cnParsed = parseTradeUrl('https://poe.game.qq.com/trade2/search/poe2/%E5%A5%A5%E6%9D%9C%E5%B0%94%E7%A7%98%E7%AC%A6/YBORoROFY');
assert.equal(cnParsed.server, 'cn');
assert.equal(cnParsed.origin, 'https://poe.game.qq.com');
assert.equal(cnParsed.realm, 'poe2');
assert.equal(cnParsed.league, '奥杜尔秘符');
assert.equal(cnParsed.queryId, 'YBORoROFY');

assert.throws(() => parseTradeUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/abc123'), /国服专用/);

assert.equal(normalizeCurrency('神圣石'), 'divine');
assert.equal(normalizeCurrency('Exalted Orb'), 'exalted');
assert.equal(normalizeCurrency('完美珠宝匠石'), 'perfect-jewellers-orb');
assert.equal(normalizeCurrency('宝石匠的棱镜'), 'gemcutters-prism');

const fake = {
  listing: {
    account: { online: { league: '奥杜尔秘符' } },
    price: { type: '~price', amount: 1.2, currency: '神圣石' }
  },
  item: { name: 'test' }
};
assert.equal(passFilters(fake, { currency: 'divine', minPrice: 1, maxPrice: 2, onlineOnly: true, pricedOnly: true, exactOnly: true }), true);
assert.equal(passFilters(fake, { currency: 'exalted', minPrice: 1, maxPrice: 2 }), false);
assert.equal(passFilters(fake, { currency: 'divine', minPrice: 2 }), false);
assert.equal(mockItems().length, 5);
assert.equal(sanitizeCookie('a=1\r\nb=2'), 'a=1b=2');
assert.equal(sanitizeCookie('Cookie: POESESSID=abc; POETOKEN=def'), 'POESESSID=abc; POETOKEN=def');
console.log('All tests passed.');
const { extractSearchRows, extractFetchRows, buildDroppedReason } = require('./server');
assert.deepEqual(extractSearchRows({ result: { a: 'id-a', b: 'id-b' } }), ['id-a', 'id-b']);
assert.equal(extractFetchRows({ result: { a: { id: 'a' }, b: { id: 'b' } } }).length, 2);
assert.equal(buildDroppedReason(fake, { currency: 'divine', minPrice: 20, maxPrice: 30 }).some(x => x.includes('低于最低价')), true);

const merchantTabItem = { listing: { price: { type: '~b/o', amount: 19, currency: '神圣石' } }, item: { name: '硫石 风环' } };
assert.equal(passFilters(merchantTabItem, { currency: 'divine', minPrice: 1, maxPrice: 100, onlineOnly: false, pricedOnly: true }), true);
assert.equal(passFilters(merchantTabItem, { currency: 'divine', minPrice: 1, maxPrice: 100, onlineOnly: true, pricedOnly: true }), false);

const task = sanitizeClickTask({ tradeUrl: 'https://poe.game.qq.com/trade2/search/poe2/x/y', item: { name: '硫石 风环 潜能之戒', seller: '风雨九年#2150', priceText: '19 divine', price: { amount: 19, currency: '神圣石' } } });
assert.equal(task.name, '硫石 风环 潜能之戒');
assert.equal(task.priceAmount, 19);
assert.equal(task.priceCurrency, '神圣石');
assert.equal(task.sourceSearchId, 'y');
console.log('Click task tests passed.');

assert.equal(passFilters(fake, { currency: ['divine', 'exalted'], minPrice: 1, maxPrice: 2, onlineOnly: true, pricedOnly: true }), true);
assert.equal(passFilters(fake, { currencies: ['chaos', 'exalted'], minPrice: 1, maxPrice: 2, onlineOnly: true, pricedOnly: true }), false);
assert.equal(passFilters(fake, { currencies: ['any'], minPrice: 1, maxPrice: 2, onlineOnly: true, pricedOnly: true }), true);
console.log('Multi-currency tests passed.');

assert.equal(passFilters(fake, {
  priceRanges: [
    { currency: 'divine', enabled: true, minPrice: 1, maxPrice: 2 },
    { currency: 'exalted', enabled: true, minPrice: 10, maxPrice: 50 }
  ],
  onlineOnly: true,
  pricedOnly: true
}), true);
assert.equal(passFilters(fake, {
  priceRanges: [
    { currency: 'divine', enabled: true, minPrice: 2, maxPrice: 3 },
    { currency: 'exalted', enabled: true, minPrice: 10, maxPrice: 50 }
  ],
  onlineOnly: true,
  pricedOnly: true
}), false);
assert.equal(passFilters(merchantTabItem, {
  priceRanges: [
    { currency: 'divine', enabled: true, minPrice: 18, maxPrice: 20 },
    { currency: 'exalted', enabled: true, minPrice: 1, maxPrice: 5 }
  ],
  onlineOnly: false,
  pricedOnly: true
}), true);
console.log('Per-currency price range tests passed.');
