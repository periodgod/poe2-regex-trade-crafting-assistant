'use strict';

const DEFAULT_LIMIT = 250;

function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
}

function normalizePattern(value, { literal = false } = {}) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  return literal ? escapeRegex(normalized) : normalized;
}

function digitClass(from, to = 9) {
  if (from > to) return '';
  if (from === to) return String(from);
  if (from === 0 && to === 9) return '\\d';
  return `[${from}-${to}]`;
}

/**
 * Generate a regular expression matching non-negative integers >= minimum.
 * The expression intentionally does not consume signs or percent symbols so it
 * can be embedded after a stat label, e.g. `生命.*${numericAtLeast(120)}`.
 */
function numericAtLeast(minimum) {
  const parsed = Number(minimum);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('数值下限必须是大于或等于 0 的有限数字。');
  }

  const min = Math.ceil(parsed);
  if (min === 0) return '\\d+';

  const digits = String(min);
  const alternatives = [digits];

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const current = Number(digits[index]);
    if (current >= 9) continue;
    const prefix = digits.slice(0, index);
    const nextDigit = digitClass(current + 1, 9);
    const suffixLength = digits.length - index - 1;
    const suffix = suffixLength > 0 ? `\\d{${suffixLength}}` : '';
    alternatives.push(`${prefix}${nextDigit}${suffix}`);
  }

  alternatives.push(`\\d{${digits.length + 1},}`);
  const unique = [...new Set(alternatives.filter(Boolean))];
  return unique.length === 1 ? unique[0] : `(?:${unique.join('|')})`;
}

function quoteToken(pattern, excluded = false) {
  const clean = String(pattern ?? '').replace(/"/g, '\\"').trim();
  if (!clean) return '';
  return `"${excluded ? '!' : ''}${clean}"`;
}

function compactAlternatives(patterns) {
  const clean = [...new Set(patterns.map((value) => value.trim()).filter(Boolean))];
  if (!clean.length) return '';
  if (clean.length === 1) return clean[0];
  return clean.join('|');
}

function validatePattern(pattern) {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, 'im');
    return null;
  } catch (error) {
    return error.message;
  }
}

/**
 * Payload schema:
 * {
 *   must: [{ pattern, literal? }],
 *   any: [{ pattern, literal? }],
 *   exclude: [{ pattern, literal? }],
 *   numeric: [{ label, min, group: 'must'|'any', literalLabel? }],
 *   characterLimit?: number
 * }
 */
function generatePoeQuery(payload = {}) {
  const must = Array.isArray(payload.must) ? payload.must : [];
  const any = Array.isArray(payload.any) ? payload.any : [];
  const exclude = Array.isArray(payload.exclude) ? payload.exclude : [];
  const numeric = Array.isArray(payload.numeric) ? payload.numeric : [];
  const characterLimit = Number.isFinite(Number(payload.characterLimit))
    ? Math.max(1, Number(payload.characterLimit))
    : DEFAULT_LIMIT;

  const warnings = [];
  const errors = [];
  const tokens = [];
  const anyPatterns = [];

  const processTextRule = (rule, destination) => {
    const pattern = normalizePattern(rule?.pattern, { literal: Boolean(rule?.literal) });
    if (!pattern) return;
    const invalid = validatePattern(pattern);
    if (invalid) {
      errors.push(`正则“${rule.pattern}”无效：${invalid}`);
      return;
    }
    destination.push(pattern);
  };

  const mustPatterns = [];
  must.forEach((rule) => processTextRule(rule, mustPatterns));
  mustPatterns.forEach((pattern) => tokens.push(quoteToken(pattern)));

  any.forEach((rule) => processTextRule(rule, anyPatterns));

  for (const rule of numeric) {
    const label = normalizePattern(rule?.label, { literal: rule?.literalLabel !== false });
    if (!label && rule?.min !== '' && rule?.min != null) {
      errors.push('数值规则缺少属性名称。');
      continue;
    }
    if (!label) continue;

    try {
      const expression = `${label}.*${numericAtLeast(rule.min)}`;
      if (rule.group === 'any') anyPatterns.push(expression);
      else tokens.push(quoteToken(expression));
    } catch (error) {
      errors.push(`${rule.label || '数值规则'}：${error.message}`);
    }
  }

  const anyExpression = compactAlternatives(anyPatterns);
  if (anyExpression) tokens.push(quoteToken(anyExpression));

  const excludePatterns = [];
  exclude.forEach((rule) => processTextRule(rule, excludePatterns));
  excludePatterns.forEach((pattern) => tokens.push(quoteToken(pattern, true)));

  const query = tokens.filter(Boolean).join(' ');
  if (!query) warnings.push('尚未添加筛选条件。');
  if (query.length > characterLimit) {
    warnings.push(`表达式长度 ${query.length}，超过当前限制 ${characterLimit}。`);
  }

  return {
    ok: errors.length === 0,
    query,
    length: query.length,
    characterLimit,
    withinLimit: query.length <= characterLimit,
    tokens,
    errors,
    warnings
  };
}

function tokenizePoeQuery(query) {
  const input = String(query ?? '').trim();
  if (!input) return [];

  const tokens = [];
  const quoted = /"((?:\\"|[^"])*)"/g;
  let match;
  let lastIndex = 0;

  while ((match = quoted.exec(input)) !== null) {
    const leading = input.slice(lastIndex, match.index).trim();
    if (leading) tokens.push(...leading.split(/\s+/));
    tokens.push(match[1].replace(/\\"/g, '"'));
    lastIndex = quoted.lastIndex;
  }

  const trailing = input.slice(lastIndex).trim();
  if (trailing) tokens.push(...trailing.split(/\s+/));
  return tokens.filter(Boolean);
}

function testPoeQuery(query, text) {
  const tokens = tokenizePoeQuery(query);
  const source = String(text ?? '');
  const details = [];
  let matched = true;

  for (const rawToken of tokens) {
    const excluded = rawToken.startsWith('!');
    const pattern = excluded ? rawToken.slice(1) : rawToken;
    let regex;
    try {
      regex = new RegExp(pattern, 'im');
    } catch (error) {
      return {
        ok: false,
        matched: false,
        error: `无法测试无效正则“${pattern}”：${error.message}`,
        details
      };
    }

    const found = regex.test(source);
    const passed = excluded ? !found : found;
    details.push({ token: rawToken, excluded, found, passed });
    if (!passed) matched = false;
  }

  return { ok: true, matched, details };
}

module.exports = {
  DEFAULT_LIMIT,
  escapeRegex,
  numericAtLeast,
  generatePoeQuery,
  tokenizePoeQuery,
  testPoeQuery
};
