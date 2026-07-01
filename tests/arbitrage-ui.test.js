"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "renderer", "arbitrage.html"), "utf8");
const js = fs.readFileSync(path.join(root, "renderer", "arbitrage.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "renderer", "arbitrage-bootstrap.js"), "utf8");
const entry = fs.readFileSync(path.join(root, "renderer", "arbitrage-entry.js"), "utf8");
const css = fs.readFileSync(path.join(root, "renderer", "arbitrage.css"), "utf8");

assert(!/onclick\s*=/.test(html), "arbitrage.html must not use inline onclick handlers");
assert(!/onclick\s*=/.test(js), "dynamic HTML must not emit inline onclick handlers");
assert(html.includes('href="./arbitrage.css"'), "arbitrage stylesheet must use a relative same-origin URL");
assert(html.includes('src="app://local/arbitrage-entry.js?v=1.7.7"'), "single-file arbitrage entry missing");
assert(!html.includes('src="./arbitrage.js'), "separate controller script must not be loaded at runtime");
assert(!html.includes('src="./arbitrage-bootstrap.js'), "separate bootstrap script must not be loaded at runtime");
assert(!bootstrap.includes('document.createElement("script")'), "bootstrap must not dynamically insert the controller script");
assert(bootstrap.includes("bootController"), "bootstrap must explicitly boot the static controller");
assert(entry.includes('window.POE2ArbitrageApp=Object.freeze'), "bundle must contain controller");
assert(entry.includes('window.__POE2_ARBITRAGE_ENTRY_ERROR__'), "bundle must preserve controller execution errors");
assert(html.includes("Content-Security-Policy"), "arbitrage CSP missing");

const count = pattern => (html.match(pattern) || []).length;
assert.equal(count(/<script\b/g), 1, "arbitrage.html must contain exactly one bundled script");
assert.equal(count(/<\/script>/g), 1, "arbitrage.html must contain exactly one closing script tag");
assert.equal(count(/<\/body>/g), 1, "arbitrage.html must contain exactly one closing body tag");
assert.equal(count(/<\/html>/g), 1, "arbitrage.html must contain exactly one closing html tag");
assert.equal(count(/class="edge-card"/g), 10, "the 10 market pairs must be static HTML, not generated at runtime");
assert.equal(count(/id="[A-Za-z]+_to_[A-Za-z]+_target"/g), 20, "all 20 target inputs must exist in HTML");
assert.equal(count(/id="[A-Za-z]+_to_[A-Za-z]+_source"/g), 20, "all 20 source inputs must exist in HTML");

for (const requiredHtml of [
  'id="runtimeStatus"',
  'id="actionStatus"',
  'id="pageErrorBanner"',
  'id="rankingArea"',
  'id="summaryArea"',
  '高级分析 C：纯汇率闭环排行榜',
  '高级分析 D：量化分析总结',
  '所有计算均在本地浏览器中完成',
]) {
  assert(html.includes(requiredHtml), `missing complete arbitrage section or feedback: ${requiredHtml}`);
}

assert(bootstrap.includes('按钮没有被静默忽略'), 'bootstrap must provide click feedback before controller readiness');
assert(bootstrap.includes('首个错误'), 'bootstrap must preserve the first initialization error');
assert(html.includes('data-diagnostic-action="copy"'), 'diagnostic copy button missing');
assert(html.includes('data-diagnostic-action="open-log"'), 'open log button missing');
assert(html.includes('runtimeDiagnosticText'), 'diagnostic text area missing');
assert(!html.includes("restoreDesktopStateWhenLocalEmpty"), "JavaScript tail leaked into arbitrage.html");
assert(css.includes(".runtime-status"), "runtime status styles missing");
assert(css.includes("button[aria-busy=\"true\"]"), "busy button styles missing");

const htmlActions = [...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]);
const dynamicActions = ["verify-step-rate", "verify-step-gold"];
const expected = new Set([...htmlActions, ...dynamicActions]);
for (const action of expected) {
  assert(js.includes(`case "${action}"`), `missing action handler: ${action}`);
}

for (const required of [
  "function validateRequiredDom()",
  "function calculate(options={})",
  "function generateShareJson",
  "function bindActionButtons",
  "function scheduleLiveCalculation",
  "function setActionStatus",
  "function safeStorageGet",
  "function safeStorageSet",
  "function showPageError",
  "window.POE2ArbitrageApp=Object.freeze"
]) {
  assert(js.includes(required), `missing ${required}`);
}

assert(!js.includes("function buildInputCards"), "HTML and JavaScript must not have two competing card renderers");
assert(!js.includes("function makeDirectionBlock"), "market card HTML must have a single source of truth");
assert(js.includes('button.addEventListener("click"'), "fixed buttons must receive direct listeners");
assert(js.includes('nextActionArea.addEventListener("click"'), "dynamic step buttons must use scoped delegation");
assert(!/DOMContentLoaded[\s\S]{0,160}initializeArbitragePage/.test(js), "controller must be booted only by the guarded bootstrap");

console.log("arbitrage-ui tests passed");
