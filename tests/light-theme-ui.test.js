'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer/light-theme.css'), 'utf8');
for (const token of ['#f8fafc', '#ffffff', '#a3e635', '#1e293b', '#e2e8f0']) {
  assert.ok(css.toLowerCase().includes(token), `missing light UI token: ${token}`);
}
for (const file of ['index.html','crafting-planner.html','arbitrage.html','regex-generator.html','market-monitor.html']) {
  const html = fs.readFileSync(path.join(root, 'renderer', file), 'utf8');
  assert.ok(html.includes('light-theme.css'), `${file} does not load light theme`);
}
const home = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
assert.equal((home.match(/class="module-icon"/g) || []).length, 4);
const craft = fs.readFileSync(path.join(root, 'renderer/crafting-planner.html'), 'utf8');
assert.ok(craft.includes('class="card analysis-sidebar"'));
assert.ok(css.includes('position: sticky'));
assert.ok(css.includes('transition:'));
console.log('light-theme-ui tests passed');
