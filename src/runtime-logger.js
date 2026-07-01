'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const MAX_DETAIL_LENGTH = 24000;
let logFilePath = null;

function stringify(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.stack || `${value.name || 'Error'}: ${value.message || String(value)}`;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return util.inspect(value, { depth: 5, breakLength: 120 });
  }
}

function cleanText(value) {
  const text = stringify(value).replace(/\u0000/g, '').trim();
  return text.length > MAX_DETAIL_LENGTH
    ? `${text.slice(0, MAX_DETAIL_LENGTH)}\n…（日志内容已截断）`
    : text;
}

function initializeRuntimeLogger(userDataRoot) {
  const logsRoot = path.join(userDataRoot, 'logs');
  fs.mkdirSync(logsRoot, { recursive: true });
  logFilePath = path.join(logsRoot, 'runtime.log');
  return logFilePath;
}

function getRuntimeLogPath() {
  return logFilePath;
}

function appendRuntimeLog(level, scope, message, detail) {
  if (!logFilePath) return false;
  const timestamp = new Date().toISOString();
  const header = `[${timestamp}] [${String(level || 'INFO').toUpperCase()}] [${scope || 'app'}] ${cleanText(message)}`;
  const detailText = cleanText(detail);
  const line = detailText ? `${header}\n${detailText}\n` : `${header}\n`;
  try {
    fs.appendFileSync(logFilePath, line, 'utf8');
    return true;
  } catch (_error) {
    return false;
  }
}

function readRuntimeLogTail(maxBytes = 64000) {
  if (!logFilePath || !fs.existsSync(logFilePath)) return '';
  try {
    const stat = fs.statSync(logFilePath);
    const bytes = Math.max(1024, Math.min(Number(maxBytes) || 64000, 512000));
    const start = Math.max(0, stat.size - bytes);
    const length = stat.size - start;
    const fd = fs.openSync(logFilePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      const text = buffer.toString('utf8');
      return start > 0 ? `…（仅显示日志末尾 ${bytes} 字节）\n${text}` : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return `读取日志失败：${error.message}`;
  }
}

module.exports = {
  initializeRuntimeLogger,
  getRuntimeLogPath,
  appendRuntimeLog,
  readRuntimeLogTail
};
