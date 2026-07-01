'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const CHRONICLE_BASE_URL = 'https://poe2db.tw/cn/';
const DEFAULT_TIMEOUT = 25_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_REDIRECTS = 5;

function bundledChronicleRecord(englishName, zhName, descriptionLines = []) {
  return Object.freeze({
    kind: 'socketable', englishName, zhName, descriptionLines,
    sourceUrl: makeChronicleUrl(englishName), source: 'poe2db.tw/cn', verified: true
  });
}

const VERIFIED_CHRONICLE_RECORDS = Object.freeze({
  'socketable:adept rune': bundledChronicleRecord('Adept Rune', '行家符文', [
    '所有装备：+9 敏捷',
    '羁绊：战斗武器的攻击附加 6–10 物理伤害和 1–16 基础闪电伤害；法杖或长杖 +80 闪避值；护甲 +20 生命上限和 +20 魔力上限',
    '放入任意装备的空置增幅器插槽中；放入后无法移除，但可以被其他增幅器替换。'
  ]),
  'socketable:lesser adept rune': bundledChronicleRecord('Lesser Adept Rune', '次级行家符文'),
  'socketable:greater adept rune': bundledChronicleRecord('Greater Adept Rune', '高级行家符文'),
  'socketable:perfect adept rune': bundledChronicleRecord('Perfect Adept Rune', '完美行家符文'),
  'socketable:resolve rune': bundledChronicleRecord('Resolve Rune', '坚毅符文'),
  'socketable:lesser resolve rune': bundledChronicleRecord('Lesser Resolve Rune', '次级坚毅符文'),
  'socketable:greater resolve rune': bundledChronicleRecord('Greater Resolve Rune', '高级坚毅符文'),
  'socketable:perfect resolve rune': bundledChronicleRecord('Perfect Resolve Rune', '完美坚毅符文'),
  'socketable:robust rune': bundledChronicleRecord('Robust Rune', '健壮符文'),
  'socketable:lesser robust rune': bundledChronicleRecord('Lesser Robust Rune', '次级健壮符文'),
  'socketable:greater robust rune': bundledChronicleRecord('Greater Robust Rune', '高级健壮符文'),
  'socketable:perfect robust rune': bundledChronicleRecord('Perfect Robust Rune', '完美健壮符文'),
  'socketable:masterwork rune': bundledChronicleRecord('Masterwork Rune', '大师符文'),
  'socketable:aldurs legacy': bundledChronicleRecord("Aldur's Legacy", '奥杜尔的遗产'),
  'socketable:astrids creativity': bundledChronicleRecord("Astrid's Creativity", '阿斯特丽德的创造'),
  'socketable:serles triumph': bundledChronicleRecord("Serle's Triumph", '瑟尔的凯旋'),
  'socketable:amanamus gaze': bundledChronicleRecord("Amanamu's Gaze", '埃曼纳姆的凝视', [
    '灵魂核心；具体效果按装备部位与严格底材兼容记录显示。'
  ])
});

function decodeHtmlEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…'
  };
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : match);
}

function cleanLine(value) {
  return decodeHtmlEntities(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToLines(html) {
  let text = String(html || '');
  text = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:div|p|li|tr|td|th|dt|dd|h1|h2|h3|h4|h5|section|article|table|thead|tbody)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(text)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

function makeChronicleSlug(englishName) {
  return String(englishName || '')
    .normalize('NFKC')
    .trim()
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function makeChronicleUrl(englishName) {
  return `${CHRONICLE_BASE_URL}${encodeURIComponent(makeChronicleSlug(englishName)).replace(/%5F/gi, '_')}`;
}

function hasChinese(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function normalizeEnglish(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function verifiedRecordFor(target) {
  const kind = target?.kind || 'item';
  return VERIFIED_CHRONICLE_RECORDS[`${kind}:${normalizeEnglish(target?.englishName)}`] || null;
}
const INVALID_CHRONICLE_NAMES = new Set(['羁绊', '增幅器', '装备', '物品', '精华', '预兆', '通货', '可堆叠通货', '名称', '显示物品素质']);
function usableChronicleRecord(record, englishName = '') {
  const zhName = cleanLine(record?.zhName || '');
  if (!zhName || !hasChinese(zhName) || normalizeEnglish(zhName) === normalizeEnglish(englishName) || INVALID_CHRONICLE_NAMES.has(zhName)) return false;
  const normalizedEnglish = normalizeEnglish(englishName || record?.englishName || '');
  if (/\brune\b/.test(normalizedEnglish) && !/符文$/.test(zhName)) return false;
  if (/\bessence\b/.test(normalizedEnglish) && !/精华$/.test(zhName)) return false;
  if (/^omen of\b/.test(normalizedEnglish) && !/预兆$/.test(zhName)) return false;
  return true;
}


function isBoilerplate(line) {
  return /^(?:Image|Edit|Wiki|Wikis Content|Copyright|Sites|News|Community|About Site|US Realm Economy|From To|key val|名称 显示物品素质|名字 显示物品素质|重鑄配方|重铸配方|相同物品|符文组合|Forge Recipe|Used in Three to One|Currency Exchange|NoteCode|DropLevel|Flags|Type Metadata|Tags |Icon |MTX |Base\.base_|Path of Exile|贡品 你的报价)/i.test(line);
}

function isLikelyName(line, englishName) {
  if (!line || !hasChinese(line) || line.length > 48) return false;
  if (isBoilerplate(line) || INVALID_CHRONICLE_NAMES.has(cleanLine(line))) return false;
  if (/[:：。！？,，；;]|\d{2,}%|堆叠数量|需求|等级|放入|按住|使用|提高|增加|减少|附加|获得|护甲|武器|所有装备/.test(line)) return false;
  if (normalizeEnglish(line) === normalizeEnglish(englishName)) return false;
  return true;
}

function baseTypeValue(lines, index) {
  const line = cleanLine(lines[index] || '');
  if (/^BaseType$/i.test(line)) return cleanLine(lines[index + 1] || '');
  if (/^BaseType\s+/i.test(line)) return line.replace(/^BaseType\s+/i, '').trim();
  return '';
}

function extractBaseTypeChinese(lines, englishName) {
  const target = normalizeEnglish(englishName);
  for (let i = 0; i < lines.length; i += 1) {
    const currentValue = baseTypeValue(lines, i);
    if (!currentValue || normalizeEnglish(currentValue) !== target) continue;
    const start = /^BaseType$/i.test(lines[i]) ? i + 2 : i + 1;
    for (let j = start; j < Math.min(lines.length, start + 10); j += 1) {
      const candidate = baseTypeValue(lines, j);
      if (candidate && isLikelyName(candidate, englishName)) return candidate;
      if (/^BaseType$/i.test(lines[j]) && isLikelyName(lines[j + 1], englishName)) return cleanLine(lines[j + 1]);
    }
  }

  // 兼容 HTML 表格被压成单行的页面：BaseType English BaseType 中文 Class ...
  const flattened = lines.join(' ');
  const escapedEnglish = String(englishName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]");
  const inline = flattened.match(new RegExp(`BaseType\\s+${escapedEnglish}\\s+BaseType\\s+(.+?)(?=\\s+(?:Class|Flags|Type|Tags|Icon|MTX|Base\\.base_|$))`, 'i'));
  if (inline) {
    const candidate = cleanLine(inline[1]);
    if (isLikelyName(candidate, englishName)) return candidate;
  }
  return null;
}

function expectedChineseSuffix(englishName) {
  const normalized = normalizeEnglish(englishName);
  if (/\brune\b/.test(normalized)) return '符文';
  if (/\bessence\b/.test(normalized)) return '精华';
  if (/^omen of\b/.test(normalized)) return '预兆';
  return '';
}

function extractHeadingChinese(lines, englishName) {
  const target = normalizeEnglish(englishName);
  const suffix = expectedChineseSuffix(englishName);
  const candidates = [];
  lines.forEach((line, index) => {
    if (!hasChinese(line) || index > 100) return;
    const prefix = cleanLine(line.replace(/\s+[A-Z][A-Za-z0-9_]{4,}.*$/, ''));
    if (prefix !== line && isLikelyName(prefix, englishName)) candidates.push(prefix);
  });
  if (suffix) {
    const matched = candidates.find((candidate) => candidate.endsWith(suffix));
    if (matched) return matched;
  }
  const englishIndex = lines.findIndex((line) => normalizeEnglish(line) === target);
  if (englishIndex >= 0) {
    const nearby = candidates.find((candidate) => lines.indexOf(candidate) < englishIndex);
    if (nearby) return nearby;
  }
  return candidates[0] || null;
}

function extractNameBeforeEnglish(lines, englishName) {
  const target = normalizeEnglish(englishName);
  const suffix = expectedChineseSuffix(englishName);
  const englishIndexes = [];
  lines.forEach((line, index) => {
    if (normalizeEnglish(line) === target) englishIndexes.push(index);
  });
  for (const index of englishIndexes) {
    const candidates = [];
    for (let offset = 1; offset <= 48; offset += 1) {
      const candidate = cleanLine(lines[index - offset] || '');
      if (isLikelyName(candidate, englishName)) candidates.push({ candidate, offset });
    }
    if (suffix) {
      const preferred = candidates.find(({ candidate }) => candidate.endsWith(suffix));
      if (preferred) return preferred.candidate;
    }
    if (candidates.length) return candidates[0].candidate;
  }
  return null;
}

function findPrimaryBlock(lines, chineseName, englishName) {
  if (!chineseName) return [];
  const target = normalizeEnglish(englishName);
  let start = lines.findIndex((line) => line === chineseName);
  if (start < 0) start = lines.findIndex((line) => line.includes(chineseName));
  if (start < 0) return [];
  let end = -1;
  for (let i = start + 1; i < Math.min(lines.length, start + 80); i += 1) {
    if (normalizeEnglish(lines[i]) === target) { end = i; break; }
  }
  if (end < 0) return [];
  const ignored = new Set([chineseName, englishName, '增幅器', '预兆', '通货', '可堆叠通货', '精华', '装备']);
  return lines.slice(start + 1, end)
    .filter((line) => !ignored.has(line))
    .filter((line) => !isBoilerplate(line))
    .filter((line) => !/^堆叠数量/.test(line))
    .filter((line) => !/^需求[：:]?\s*等级/.test(line))
    .filter((line) => line.length <= 240)
    .slice(0, 16);
}

function extractChronicleRecord(html, target = {}) {
  const englishName = String(target.englishName || '').trim();
  if (!englishName) return { ok: false, reason: 'missing-english-name' };
  const lines = htmlToLines(html);
  const normalizedTarget = normalizeEnglish(englishName);
  const hasEnglish = lines.some((line) => normalizeEnglish(line) === normalizedTarget)
    || normalizeEnglish(html).includes(normalizedTarget);
  if (!hasEnglish) return { ok: false, reason: 'page-does-not-match', lines: lines.slice(0, 20) };
  const chineseName = extractBaseTypeChinese(lines, englishName) || extractHeadingChinese(lines, englishName) || extractNameBeforeEnglish(lines, englishName);
  if (!chineseName) return { ok: false, reason: 'chinese-name-not-found', lines: lines.slice(0, 40) };
  const descriptionLines = findPrimaryBlock(lines, chineseName, englishName);
  return {
    ok: true,
    key: target.key || `${target.kind || 'item'}:${target.sourceId || englishName}`,
    kind: target.kind || 'item',
    sourceId: target.sourceId == null ? null : String(target.sourceId),
    englishName,
    zhName: chineseName,
    descriptionLines,
    sourceUrl: target.sourceUrl || makeChronicleUrl(englishName),
    source: 'poe2db.tw/cn',
    fetchedAt: new Date().toISOString()
  };
}

function requestText(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'poe2-regex-trade-crafting-assistant/1.7.7 (+localization-sync)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
        'Accept-Encoding': 'identity'
      },
      timeout: Number(options.timeout || DEFAULT_TIMEOUT)
    }, (response) => {
      const status = Number(response.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error(`编年史重定向过多：${url}`));
        return resolve(requestText(new URL(response.headers.location, url).toString(), options, redirects + 1));
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`编年史 HTTP ${status}：${url}`));
      }
      const chunks = [];
      let bytes = 0;
      const maxBytes = Number(options.maxBytes || 2 * 1024 * 1024);
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) request.destroy(new Error(`编年史页面超过安全上限：${url}`));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('timeout', () => request.destroy(new Error(`编年史请求超时：${url}`)));
    request.on('error', reject);
  });
}

async function fetchChronicleRecord(target, options = {}) {
  const url = target.sourceUrl || makeChronicleUrl(target.englishName);
  const fetchText = options.fetchText || requestText;
  let lastError = null;
  const retries = Number.isInteger(options.retries) ? options.retries : 1;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const html = await fetchText(url, options);
      const parsed = extractChronicleRecord(html, { ...target, sourceUrl: url });
      if (!parsed.ok) throw new Error(`${parsed.reason}：${target.englishName}`);
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error(`无法读取编年史：${target.englishName}`);
}

function applyVerifiedRecords(payload) {
  const next = payload && typeof payload === 'object' ? { ...payload } : {};
  next.records = { ...(next.records || {}) };
  for (const [lookupKey, seed] of Object.entries(VERIFIED_CHRONICLE_RECORDS)) {
    const key = `verified:${lookupKey}`;
    if (!usableChronicleRecord(next.records[key], seed.englishName)) {
      next.records[key] = { ...seed, key, sourceId: null, fetchedAt: 'verified-bundled' };
    }
  }
  return next;
}

function readChronicleFile(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!payload || typeof payload !== 'object' || !payload.records || typeof payload.records !== 'object') throw new Error('invalid');
    return applyVerifiedRecords(payload);
  } catch (_error) {
    return applyVerifiedRecords({
      schemaVersion: 1,
      source: 'poe2db.tw/cn',
      generatedAt: null,
      records: {},
      failures: {}
    });
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function syncChronicleLocalization(options = {}) {
  const targets = Array.isArray(options.targets) ? options.targets.filter((target) => target?.englishName) : [];
  const destination = path.resolve(options.destination);
  const previous = options.previousPath ? readChronicleFile(options.previousPath) : readChronicleFile(destination);
  const records = { ...(previous.records || {}) };
  const failures = { ...(previous.failures || {}) };
  const uniqueTargets = [];
  const seen = new Set();
  for (const target of targets) {
    const key = target.key || `${target.kind || 'item'}:${target.sourceId || target.englishName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTargets.push({ ...target, key });
  }
  for (const target of uniqueTargets) {
    const cached = records[target.key];
    if (usableChronicleRecord(cached, target.englishName)) continue;
    const verified = verifiedRecordFor(target);
    if (verified) {
      records[target.key] = {
        ...verified,
        key: target.key,
        sourceId: target.sourceId == null ? null : String(target.sourceId),
        fetchedAt: verified.fetchedAt || 'verified-bundled'
      };
      delete failures[target.key];
    }
  }
  const pending = uniqueTargets.filter((target) => {
    const cached = records[target.key];
    return options.force === true || !usableChronicleRecord(cached, target.englishName) || normalizeEnglish(cached.englishName) !== normalizeEnglish(target.englishName);
  });
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  const reused = uniqueTargets.length - pending.length;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const makePayload = () => {
    const matched = uniqueTargets.filter((target) => usableChronicleRecord(records[target.key], target.englishName)).length;
    return {
      schemaVersion: 1,
      source: 'poe2db.tw/cn',
      policy: 'Chinese display names and item descriptions are taken from the Chinese Chronicle page. Unresolved entries keep the upstream English name; machine translation is forbidden for named items.',
      generatedAt: new Date().toISOString(),
      counts: {
        targets: uniqueTargets.length,
        matched,
        unresolved: uniqueTargets.length - matched,
        reused,
        fetched: succeeded,
        failed
      },
      records,
      failures
    };
  };

  onProgress({ phase: 'chronicle-start', total: uniqueTargets.length, cached: reused, pending: pending.length });

  // 编年史不可访问时必须快速失败，不能让上千个具体基底逐个等待超时。
  if (pending.length && options.preflight !== false) {
    const fetchText = options.fetchText || requestText;
    try {
      await fetchText(`${CHRONICLE_BASE_URL}Charging_Rune`, {
        ...options,
        timeout: Math.min(Number(options.timeout || DEFAULT_TIMEOUT), 10_000),
        maxBytes: 2 * 1024 * 1024
      });
    } catch (error) {
      const attemptedAt = new Date().toISOString();
      for (const target of pending) {
        failures[target.key] = {
          englishName: target.englishName,
          kind: target.kind || 'item',
          sourceUrl: target.sourceUrl || makeChronicleUrl(target.englishName),
          message: `编年史中文源当前不可访问：${error.message}`,
          attemptedAt
        };
      }
      failed = pending.length;
      completed = pending.length;
      const payload = makePayload();
      writeJsonAtomic(destination, payload);
      onProgress({ phase: 'chronicle-unavailable', error: error.message, counts: payload.counts });
      onProgress({ phase: 'chronicle-done', counts: payload.counts });
      return payload;
    }
  }

  await mapWithConcurrency(pending, Number(options.concurrency || DEFAULT_CONCURRENCY), async (target) => {
    try {
      records[target.key] = await fetchChronicleRecord(target, options);
      delete failures[target.key];
      succeeded += 1;
    } catch (error) {
      failures[target.key] = {
        englishName: target.englishName,
        kind: target.kind || 'item',
        sourceUrl: target.sourceUrl || makeChronicleUrl(target.englishName),
        message: error.message,
        attemptedAt: new Date().toISOString()
      };
      failed += 1;
    } finally {
      completed += 1;
      if (completed === pending.length || completed % 10 === 0) {
        onProgress({ phase: 'chronicle', completed, total: pending.length, succeeded, failed, name: target.englishName });
      }
      // 长时间同步时定期落盘，即使后续异常也保留已经确认的中文结果。
      if (completed % 50 === 0) writeJsonAtomic(destination, makePayload());
    }
  });
  const payload = makePayload();
  writeJsonAtomic(destination, payload);
  onProgress({ phase: 'chronicle-done', counts: payload.counts });
  return payload;
}

function buildChronicleIndex(payload) {
  const byKey = new Map();
  const byKindAndEnglish = new Map();
  const byKindAndSourceId = new Map();
  for (const [key, record] of Object.entries(payload?.records || {})) {
    if (!usableChronicleRecord(record, record.englishName)) continue;
    byKey.set(key, record);
    byKindAndEnglish.set(`${record.kind || 'item'}:${normalizeEnglish(record.englishName)}`, record);
    if (record.sourceId != null) byKindAndSourceId.set(`${record.kind || 'item'}:${String(record.sourceId)}`, record);
  }
  return { payload, byKey, byKindAndEnglish, byKindAndSourceId };
}

function loadChronicleIndex(snapshotRoot) {
  return buildChronicleIndex(readChronicleFile(path.join(snapshotRoot, 'chronicle-zh.json')));
}

function findChronicleRecord(index, kind, englishName, sourceId = null) {
  if (!index) return null;
  if (sourceId != null) {
    const byId = index.byKindAndSourceId.get(`${kind}:${String(sourceId)}`);
    if (byId) return byId;
  }
  return index.byKindAndEnglish.get(`${kind}:${normalizeEnglish(englishName)}`) || null;
}

module.exports = {
  CHRONICLE_BASE_URL,
  VERIFIED_CHRONICLE_RECORDS,
  usableChronicleRecord,
  applyVerifiedRecords,
  decodeHtmlEntities,
  htmlToLines,
  makeChronicleSlug,
  makeChronicleUrl,
  extractChronicleRecord,
  fetchChronicleRecord,
  syncChronicleLocalization,
  readChronicleFile,
  buildChronicleIndex,
  loadChronicleIndex,
  findChronicleRecord
};
