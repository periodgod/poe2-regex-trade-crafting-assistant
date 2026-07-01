'use strict';

// 将游戏复制出的中文物品文本，解析到严格底材池与来源词缀 ID。
// 这里不依赖“中文词缀名称必须完整抓取”这一前提：优先使用
// 词缀方向、T 级、数值区间和语义签名联合匹配，避免因为游戏中文
// 文案顺序、括号中的可变区间或“上限/最大”等措辞差异而全部失配。

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/[^a-z0-9#%\u3400-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCopyAnnotations(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s*[（(]\s*(?:augmented|rune|crafted|implicit|fractured|enchant|unscalable|不可调整|無法調整)\s*[)）]/gi, '')
    .replace(/\s*[（(]\s*[-+]?\d+(?:\.\d+)?\s*[-–—~至]\s*[-+]?\d+(?:\.\d+)?(?:\s*[,，]\s*[-+]?\d+(?:\.\d+)?\s*[-–—~至]\s*[-+]?\d+(?:\.\d+)?)?\s*[)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalTemplate(value) {
  return stripCopyAnnotations(value)
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/#\s*%/g, '#%')
    .replace(/[：:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function familiesOf(value) {
  const list = Array.isArray(value?.families) && value.families.length ? value.families : [value?.family];
  return [...new Set(list.map(String).filter(Boolean))];
}

function modifierAllowedOnBase(modifier, base) {
  const ids = Array.isArray(modifier?.allowedBaseIds) ? modifier.allowedBaseIds : [];
  if (ids.length) return ids.includes(base?.id);
  const tags = new Set(base?.tags || []);
  const required = modifier?.allowedBaseTags || [];
  const excluded = modifier?.excludedBaseTags || [];
  if (excluded.some((tag) => tags.has(tag))) return false;
  return !required.length || required.some((tag) => tags.has(tag));
}

function inferAttributePoolName(item) {
  const text = normalizedText(`${item?.itemClass || ''} ${item?.baseType || ''}`);
  const classRules = [
    [/十字弩|crossbow/, 'Crossbow'], [/弓|bow/, 'Bow'], [/箭袋|quiver/, 'Quiver'],
    [/混沌魔杖|chaos wand/, 'Chaos Wand'], [/火焰魔杖|fire wand/, 'Fire Wand'], [/冰霜魔杖|cold wand|ice wand/, 'Cold Wand'], [/闪电魔杖|閃電魔杖|lightning wand/, 'Lightning Wand'],
    [/魔杖|wand/, 'Wand'], [/权杖|權杖|sceptre/, 'Sceptre'], [/长杖|長杖|staff/, 'Staff'], [/长棍|長棍|quarterstaff/, 'Quarterstaff'],
    [/匕首|dagger/, 'Dagger'], [/爪|claw/, 'Claw'], [/连枷|連枷|flail/, 'Flail'], [/长矛|長矛|spear/, 'Spear'],
    [/双手斧|雙手斧|two hand axe/, 'Two Hand Axe'], [/单手斧|單手斧|one hand axe/, 'One Hand Axe'],
    [/双手锤|雙手錘|two hand mace/, 'Two Hand Mace'], [/单手锤|單手錘|one hand mace/, 'One Hand Mace'],
    [/双手剑|雙手劍|two hand sword/, 'Two Hand Sword'], [/单手剑|單手劍|one hand sword/, 'One Hand Sword'],
    [/戒指|ring/, 'Ring'], [/项链|項鍊|amulet/, 'Amulet'], [/腰带|腰帶|belt/, 'Belt'], [/护符|護符|charm/, 'Charm'],
    [/盾|shield/, 'Shield'], [/法器|focus|foci/, 'Focus']
  ];
  for (const [pattern, pool] of classRules) if (pattern.test(text)) return pool;

  let armourClass = null;
  if (/胸甲|护甲|護甲|body armour/.test(text)) armourClass = 'Body Armour';
  else if (/头盔|頭盔|helmet/.test(text)) armourClass = 'Helmet';
  else if (/手套|gloves/.test(text)) armourClass = 'Gloves';
  else if (/鞋|长靴|長靴|boots/.test(text)) armourClass = 'Boots';
  if (!armourClass) return null;

  const defenses = item?.defenses || {};
  const attributes = [];
  if (Number(defenses.armour) > 0) attributes.push('STR');
  if (Number(defenses.evasion) > 0) attributes.push('DEX');
  if (Number(defenses.energyShield) > 0) attributes.push('INT');
  return attributes.length ? `${armourClass} (${attributes.join('/')})` : armourClass;
}

function findImportedBase(data, item) {
  const bases = Array.isArray(data?.bases) ? data.bases : [];
  const candidates = [item?.baseType, item?.itemClass, item?.category, item?.typeLine]
    .map(normalizedText)
    .filter(Boolean);

  for (const base of bases) {
    const aliases = Array.isArray(base.aliases) && base.aliases.length
      ? base.aliases
      : [base.name, base.englishName];
    if (aliases.filter(Boolean).some((alias) => candidates.includes(normalizedText(alias)))) {
      return { base, method: 'exact-alias', score: 100 };
    }
  }

  const inferredPool = inferAttributePoolName(item);
  if (inferredPool) {
    const exact = bases.find((base) => [base.name, base.englishName]
      .filter(Boolean)
      .some((name) => normalizedText(name) === normalizedText(inferredPool)));
    if (exact) return { base: exact, method: 'defence-inference', score: 96 };

    const compatible = bases.filter((base) => [base.name, base.englishName]
      .filter(Boolean)
      .some((name) => {
        const left = normalizedText(name);
        const right = normalizedText(inferredPool);
        return left.includes(right) || right.includes(left);
      }));
    if (compatible.length === 1) return { base: compatible[0], method: 'defence-inference-fuzzy', score: 88 };
  }

  let best = null;
  let bestScore = 0;
  for (const base of bases) {
    const aliases = Array.isArray(base.aliases) && base.aliases.length ? base.aliases : [base.name, base.englishName];
    for (const alias of aliases.filter(Boolean)) {
      const baseText = normalizedText(alias);
      for (const candidate of candidates) {
        let score = 0;
        if (candidate.includes(baseText) || baseText.includes(candidate)) score = Math.min(candidate.length, baseText.length);
        const singular = baseText.replace(/s$/, '');
        if (singular && candidate.includes(singular)) score = Math.max(score, singular.length);
        if (score > bestScore) {
          bestScore = score;
          best = base;
        }
      }
    }
  }
  return best && bestScore >= 3 ? { base: best, method: 'fuzzy-alias', score: bestScore } : null;
}

function findConcreteBase(base, item) {
  const target = normalizedText(item?.baseType || item?.typeLine || '');
  if (!target) return null;
  const items = Array.isArray(base?.concreteBaseItems) ? base.concreteBaseItems : [];
  const exact = items.find((entry) => [entry.name, entry.englishName]
    .filter(Boolean)
    .some((name) => normalizedText(name) === target));
  if (exact) return { item: exact, method: 'exact-name' };
  return null;
}

const TERM_RULES = Object.freeze([
  ['energy_shield', /energy\s*shield|能量护盾|能量護盾/i],
  ['spirit', /\bspirit\b|精魂/i],
  ['life', /\blife\b|生命/i],
  ['mana', /\bmana\b|魔力/i],
  ['armour', /\barmou?r\b|护甲|護甲/i],
  ['evasion', /evasion(?:\s*rating)?|闪避(?:值)?|閃避(?:值)?/i],
  ['stun_threshold', /stun\s*threshold|晕眩阈值|暈眩閾值/i],
  ['stun_buildup', /stun\s*buildup|晕眩积蓄|暈眩積蓄/i],
  ['fire', /\bfire\b|火焰/i],
  ['cold', /\bcold\b|\bice\b|冰霜/i],
  ['lightning', /\blightning\b|闪电|閃電/i],
  ['chaos', /\bchaos\b|混沌/i],
  ['physical', /\bphysical\b|物理/i],
  ['elemental', /\belemental\b|元素/i],
  ['resistance', /resistances?|抗性/i],
  ['maximum', /\bmaximum\b|\bmax\b|上限|最大/i],
  ['minimum', /\bminimum\b|最低|最小/i],
  ['damage', /\bdamage\b|伤害|傷害/i],
  ['attack', /\battacks?\b|攻击|攻擊/i],
  ['spell', /\bspells?\b|法术|法術/i],
  ['cast', /\bcast(?:ing)?\b|施法/i],
  ['speed', /\bspeed\b|速度/i],
  ['critical_chance', /critical\s*(?:hit\s*)?chance|暴击率|暴擊率/i],
  ['critical_damage', /critical\s*(?:damage\s*)?bonus|暴击伤害加成|暴擊傷害加成/i],
  ['accuracy', /accuracy(?:\s*rating)?|命中值|命中/i],
  ['regeneration', /regeneration|regenerate|再生/i],
  ['recovery', /recovery|recover|恢复|恢復/i],
  ['block', /\bblock\b|格挡|格擋/i],
  ['rarity', /\brarity\b|稀有度/i],
  ['quantity', /\bquantity\b|数量|數量/i],
  ['strength', /\bstrength\b|力量/i],
  ['dexterity', /\bdexterity\b|敏捷/i],
  ['intelligence', /\bintelligence\b|智慧/i],
  ['attributes', /attributes?|属性|屬性/i],
  ['skill_level', /level\s+of\s+all|技能等级|技能等級/i],
  ['minion', /minions?|召唤生物|召喚生物/i],
  ['projectile', /projectiles?|投射物/i],
  ['area', /area\s+of\s+effect|\barea\b|效果范围|效果範圍|区域|區域/i],
  ['duration', /\bduration\b|持续时间|持續時間/i],
  ['flask', /flasks?|药剂|藥劑/i],
  ['charm', /charms?|护符|護符/i],
  ['poison', /\bpoison\b|中毒/i],
  ['bleeding', /bleeding|流血/i],
  ['ignite', /ignite|点燃|點燃/i],
  ['freeze', /freeze|冻结|凍結/i],
  ['chill', /chill|冰缓|冰緩/i],
  ['shock', /shock|感电|感電/i],
  ['ailment', /ailments?|异常状态|異常狀態/i],
  ['rage', /\brage\b|怒火/i],
  ['thorns', /\bthorns?\b|荆棘|荊棘/i],
  ['movement', /movement|移动|移動/i],
  ['cooldown', /cooldown|冷却|冷卻/i],
  ['charges', /charges?|充能/i],
  ['pierce', /pierce|穿透/i],
  ['penetration', /penetrates?|penetration|穿透/i],
  ['leech', /leech|偷取/i],
  ['recoup', /recoup|补偿|補償/i]
]);

function operationOf(text) {
  const value = String(text || '').toLowerCase();
  if (/总增|總增|\bmore\b/i.test(value)) return 'more';
  if (/总降|總降|\bless\b/i.test(value)) return 'less';
  if (/提高|增加|\bincreased\b/i.test(value)) return 'increased';
  if (/降低|减少|減少|\breduced\b/i.test(value)) return 'reduced';
  if (/附加|\badds?\b|\badded\b/i.test(value)) return 'added';
  if (/获得|獲得|\bgain(?:ed|s)?\b/i.test(value)) return 'gain';
  if (/恢复|恢復|\brecover(?:y|ed|s)?\b/i.test(value)) return 'recover';
  if (/偷取|\bleech(?:es|ed)?\b/i.test(value)) return 'leech';
  if (/穿透|\bpenetrat(?:e|es|ion)\b/i.test(value)) return 'penetration';
  if (/几率|機率|\bchance\b/i.test(value)) return 'chance';
  return 'flat';
}

function semanticDescriptor(value) {
  const template = canonicalTemplate(value);
  const tokens = new Set();
  for (const [token, pattern] of TERM_RULES) if (pattern.test(template)) tokens.add(token);
  const operation = operationOf(template);
  const percent = /%/.test(template);

  // 游戏中文常把“最大能量护盾提高”简写为“能量护盾提高”；
  // 对百分比提升的生命/魔力/能盾忽略 maximum，但最大抗性仍保留。
  if (percent && operation === 'increased' && ['life', 'mana', 'energy_shield'].some((token) => tokens.has(token))) {
    tokens.delete('maximum');
  }

  return {
    template,
    normalized: normalizedText(template),
    tokens,
    operation,
    percent,
    numberSlots: (template.match(/#/g) || []).length,
    lineCount: Math.max(1, String(value || '').split(/\n+/).filter(Boolean).length)
  };
}

function setSimilarity(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function normalizeRanges(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Array.isArray(entry) ? entry.map(Number).filter(Number.isFinite) : [])
    .filter((entry) => entry.length >= 2)
    .map((entry) => [Math.min(entry[0], entry[1]), Math.max(entry[0], entry[1])]);
}

function rangeEvidence(raw, tier) {
  const copied = normalizeRanges(raw?.rollRanges || []);
  const source = normalizeRanges(tier?.ranges || []);
  if (!copied.length || !source.length) return { score: 0, exact: false, compatible: null };
  if (copied.length !== source.length) return { score: -22, exact: false, compatible: false };

  let exact = true;
  let compatible = true;
  for (let index = 0; index < copied.length; index += 1) {
    const [copyMin, copyMax] = copied[index];
    const [sourceMin, sourceMax] = source[index];
    if (Math.abs(copyMin - sourceMin) > 0.001 || Math.abs(copyMax - sourceMax) > 0.001) exact = false;
    const overlaps = Math.max(copyMin, sourceMin) <= Math.min(copyMax, sourceMax);
    if (!overlaps) compatible = false;
  }
  if (exact) return { score: 52, exact: true, compatible: true };
  return compatible ? { score: 16, exact: false, compatible: true } : { score: -36, exact: false, compatible: false };
}

function scoreCandidate(raw, modifier, tier) {
  const rawDescriptor = semanticDescriptor((raw?.lines || [raw?.text || raw?.template || '']).join('\n'));
  const candidateDescriptors = [modifier?.name, modifier?.englishName]
    .filter(Boolean)
    .map(semanticDescriptor);
  let best = { score: -Infinity, descriptor: null, exactTemplate: false, semanticExact: false, similarity: 0 };

  for (const descriptor of candidateDescriptors) {
    let score = 0;
    const exactTemplate = rawDescriptor.normalized && rawDescriptor.normalized === descriptor.normalized;
    if (exactTemplate) score += 125;

    const similarity = setSimilarity(rawDescriptor.tokens, descriptor.tokens);
    const semanticExact = rawDescriptor.tokens.size > 0 && sameSet(rawDescriptor.tokens, descriptor.tokens);
    if (semanticExact) score += 78;
    else score += similarity * 64;

    if (rawDescriptor.operation === descriptor.operation) score += 16;
    else if (rawDescriptor.operation === 'flat' || descriptor.operation === 'flat') score -= 4;
    else score -= 12;

    if (rawDescriptor.percent === descriptor.percent) score += 12;
    else score -= 24;

    if (rawDescriptor.numberSlots === descriptor.numberSlots) score += 7;
    else if (Math.abs(rawDescriptor.numberSlots - descriptor.numberSlots) > 1) score -= 8;

    if (rawDescriptor.lineCount === descriptor.lineCount) score += 4;

    if (score > best.score) best = { score, descriptor, exactTemplate, semanticExact, similarity };
  }

  const range = rangeEvidence(raw, tier);
  let score = best.score + range.score;

  const copiedAffixName = normalizedText(raw?.affixName || '');
  const sourceTierName = normalizedText(tier?.tierName || '');
  const affixNameExact = Boolean(copiedAffixName && sourceTierName && copiedAffixName === sourceTierName);
  if (affixNameExact) score += 70;

  if (raw?.source && modifier?.source && raw.source === modifier.source) score += 6;
  if (raw?.source === 'desecrated' && modifier?.source === 'normal') score += 2;

  return {
    score,
    exactTemplate: best.exactTemplate,
    semanticExact: best.semanticExact,
    similarity: best.similarity,
    rangeExact: range.exact,
    rangeCompatible: range.compatible,
    affixNameExact
  };
}

function availableTier(modifier, rawTier, itemLevel) {
  const tiers = (modifier?.tiers || [])
    .filter((tier) => Number(tier.level) <= Number(itemLevel || 1))
    .sort((left, right) => Number(left.tier) - Number(right.tier));
  if (!tiers.length) return null;
  if (rawTier != null && rawTier !== '') return tiers.find((tier) => Number(tier.tier) === Number(rawTier)) || null;
  return tiers.length === 1 ? tiers[0] : null;
}

function resolveModifier(data, base, raw, itemLevel) {
  if (!raw?.affixType || !['prefix', 'suffix'].includes(raw.affixType)) {
    return { ok: false, reason: 'not-explicit-affix', raw };
  }

  const candidates = [];
  for (const modifier of data?.modifiers || []) {
    if (modifier.type !== raw.affixType || !modifierAllowedOnBase(modifier, base)) continue;
    const tier = availableTier(modifier, raw.tier, itemLevel);
    if (!tier) continue;
    const evidence = scoreCandidate(raw, modifier, tier);
    candidates.push({ modifier, tier, evidence });
  }
  candidates.sort((left, right) => right.evidence.score - left.evidence.score || String(left.modifier.id).localeCompare(String(right.modifier.id)));

  const top = candidates[0];
  const second = candidates[1];
  if (!top) return { ok: false, reason: 'no-tier-compatible-candidate', raw, candidates: [] };

  const margin = second ? top.evidence.score - second.evidence.score : Infinity;
  const strongIdentity = top.evidence.exactTemplate || top.evidence.affixNameExact || top.evidence.semanticExact;
  const strongRangeSemantic = top.evidence.rangeExact && top.evidence.similarity >= 0.55;
  const accepted = (
    (top.evidence.score >= 105 && margin >= 12) ||
    (top.evidence.score >= 132 && strongIdentity) ||
    (top.evidence.score >= 92 && strongRangeSemantic && margin >= 8) ||
    (candidates.length === 1 && top.evidence.score >= 78)
  );

  if (!accepted) {
    return {
      ok: false,
      reason: margin < 8 ? 'ambiguous-candidates' : 'low-confidence',
      raw,
      topScore: Number(top.evidence.score.toFixed(2)),
      margin: Number.isFinite(margin) ? Number(margin.toFixed(2)) : null,
      candidates: candidates.slice(0, 5).map((entry) => ({
        id: entry.modifier.id,
        name: entry.modifier.name,
        englishName: entry.modifier.englishName,
        tier: Number(entry.tier.tier),
        score: Number(entry.evidence.score.toFixed(2))
      }))
    };
  }

  const method = top.evidence.exactTemplate
    ? 'exact-template'
    : top.evidence.affixNameExact
      ? 'affix-name'
      : top.evidence.rangeExact && top.evidence.semanticExact
        ? 'semantic-and-range'
        : top.evidence.rangeExact
          ? 'range-assisted'
          : 'semantic';

  return {
    ok: true,
    raw,
    modifierId: top.modifier.id,
    id: top.modifier.id,
    tier: Number(top.tier.tier),
    type: top.modifier.type,
    // source 表示严格词缀池来源；复制文本中的“亵渎的”保存在 importSource，
    // 避免把普通池词缀错误计作专属亵渎词缀。
    source: top.modifier.source || raw.source || 'normal',
    importSource: raw.source || 'unknown',
    poolSource: top.modifier.source || 'normal',
    family: top.modifier.family,
    families: familiesOf(top.modifier),
    fractured: Boolean(raw.fractured),
    confidence: Math.max(0, Math.min(1, top.evidence.score / 175)),
    score: Number(top.evidence.score.toFixed(2)),
    margin: Number.isFinite(margin) ? Number(margin.toFixed(2)) : null,
    method,
    modifierName: top.modifier.name,
    englishName: top.modifier.englishName,
    sourceModifierId: top.modifier.sourceMeta?.sourceModifierId || null
  };
}

function socketCount(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  return text.split(/\s+/).filter((token) => /[A-Za-z]/.test(token)).length;
}

function resolveImportedItem(data, item) {
  const baseMatch = findImportedBase(data, item);
  if (!baseMatch?.base) {
    return {
      ok: false,
      reason: 'base-not-found',
      base: null,
      matches: [],
      unresolved: (item?.mods || []).filter((mod) => mod.affixType),
      counts: { prefix: 0, suffix: 0, matched: 0, unresolved: 0 }
    };
  }

  const base = baseMatch.base;
  const concreteMatch = findConcreteBase(base, item);
  const explicitMods = (item?.mods || []).filter((mod) => ['prefix', 'suffix'].includes(mod.affixType));
  const matches = [];
  const unresolved = [];

  explicitMods.forEach((raw, rawIndex) => {
    const resolved = resolveModifier(data, base, raw, item?.itemLevel || 1);
    const enriched = { ...resolved, rawIndex };
    if (resolved.ok) matches.push(enriched);
    else unresolved.push(enriched);
  });

  const prefix = explicitMods.filter((mod) => mod.affixType === 'prefix').length;
  const suffix = explicitMods.filter((mod) => mod.affixType === 'suffix').length;
  const copiedDesecrated = explicitMods.some((mod) => mod.source === 'desecrated');

  return {
    ok: true,
    base: {
      id: base.id,
      name: base.name,
      englishName: base.englishName || null,
      method: baseMatch.method,
      score: baseMatch.score
    },
    concreteBase: concreteMatch ? {
      id: concreteMatch.item.id,
      name: concreteMatch.item.name,
      englishName: concreteMatch.item.englishName || null,
      method: concreteMatch.method
    } : null,
    matches,
    unresolved,
    counts: {
      prefix,
      suffix,
      explicit: prefix + suffix,
      matched: matches.length,
      unresolved: unresolved.length
    },
    state: {
      quality: Number(item?.quality || 0),
      sockets: socketCount(item?.sockets),
      flags: {
        corrupted: Boolean(item?.flags?.corrupted),
        desecrated: Boolean(item?.flags?.desecrated || copiedDesecrated),
        mirrored: Boolean(item?.flags?.mirrored)
      }
    },
    ignoredSocketOrEnchantMods: (item?.mods || []).filter((mod) => !mod.affixType).map((mod) => mod.text)
  };
}

module.exports = {
  normalizedText,
  stripCopyAnnotations,
  canonicalTemplate,
  semanticDescriptor,
  inferAttributePoolName,
  findImportedBase,
  resolveModifier,
  resolveImportedItem
};
