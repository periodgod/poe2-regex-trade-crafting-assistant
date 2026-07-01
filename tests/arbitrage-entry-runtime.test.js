'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'arbitrage-entry.js'), 'utf8');
const documentListeners = new Map();
const stubElement = () => ({
  dataset: {}, hidden: false, textContent: '', value: '', checked: false,
  addEventListener() {}, removeEventListener() {}, querySelector() { return null; },
  querySelectorAll() { return []; }, closest() { return null; },
  appendChild() {}, remove() {}, select() {}
});
const document = {
  readyState: 'loading',
  body: stubElement(),
  getElementById() { return stubElement(); },
  querySelectorAll() { return []; },
  createElement() { return stubElement(); },
  execCommand() { return true; },
  addEventListener(type, callback) { documentListeners.set(type, callback); }
};
const window = {
  document,
  desktopApi: null,
  addEventListener() {},
  setTimeout,
  clearTimeout
};
window.window = window;
const context = vm.createContext({
  window, document,
  location: { href: 'app://local/arbitrage.html?v=1.7.7' },
  navigator: { userAgent: 'test-electron' },
  console,
  setTimeout,
  clearTimeout,
  URL,
  Object,
  Array,
  Map,
  Set,
  Math,
  Date,
  JSON,
  Number,
  String,
  Boolean,
  RegExp,
  Error,
  Promise
});
vm.runInContext(source, context, { filename: 'arbitrage-entry.js' });
assert.equal(window.__POE2_ARBITRAGE_ENTRY_VERSION__, '1.7.7');
assert.equal(window.__POE2_ARBITRAGE_ENTRY_ERROR__, undefined);
assert.equal(typeof window.POE2ArbitrageApp, 'object');
assert.equal(typeof window.POE2ArbitrageApp.boot, 'function');
assert.equal(typeof documentListeners.get('DOMContentLoaded'), 'function');
console.log('arbitrage-entry runtime test passed');
