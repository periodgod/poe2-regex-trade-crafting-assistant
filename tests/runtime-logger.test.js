'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  initializeRuntimeLogger,
  getRuntimeLogPath,
  appendRuntimeLog,
  readRuntimeLogTail
} = require('../src/runtime-logger');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-runtime-log-'));
try {
  const logPath = initializeRuntimeLogger(root);
  assert.equal(logPath, path.join(root, 'logs', 'runtime.log'));
  assert.equal(getRuntimeLogPath(), logPath);
  assert.equal(appendRuntimeLog('error', 'test', 'controller missing', { version: '1.7.5' }), true);
  const text = readRuntimeLogTail();
  assert.ok(text.includes('[ERROR] [test] controller missing'));
  assert.ok(text.includes('"version": "1.7.5"'));
  assert.ok(fs.existsSync(logPath));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('runtime-logger tests passed');
