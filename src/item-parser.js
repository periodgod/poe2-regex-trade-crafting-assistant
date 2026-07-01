'use strict';

const SEPARATOR_RE = /^-{4,}$/;
const META_RE = /^\{\s*(.+?)\s*\}$/;

const STATUS_PATTERNS = Object.freeze({
  corrupted: /^(?:Corrupted|已腐化|被腐化|已污染)$/i,
  unidentified: /^(?:Unidentified|未鉴定|未鑑定)$/i,
  mirrored: /^(?:Mirrored|已复制|已複製|镜像|鏡像)$/i,
  split: /^(?:Split|已分裂)$/i,
  synthesised: /^(?:Synthesised Item|综合物品|綜合物品)$/i,
  fractured: /^(?:Fractured Item|破裂物品)$/i
});

function normalizeText(input) {
  return String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .trim();
}

function parseNumber(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRarity(raw) {
  const text = String(raw || '').trim();
  const lower = text.toLowerCase();
  if (/通货|通貨|currency/.test(lower)) return 'currency';
  if (/宝石|寶石|gem/.test(lower)) return 'gem';
  if (/传奇|傳奇|unique/.test(lower)) return 'unique';
  if (/稀有|rare/.test(lower)) return 'rare';
  if (/魔法|magic/.test(lower)) return 'magic';
  if (/普通|normal/.test(lower)) return 'normal';
  if (/任务|任務|quest/.test(lower)) return 'quest';
  return lower || 'unknown';
}

function classifyItem(itemClass, rarity, name, baseType) {
  const text = [itemClass, rarity, name, baseType].filter(Boolean).join(' ').toLowerCase();

  if (/引路石|碑牌|地图|地圖|waystone|\bmap\b/.test(text)) return 'map';
  if (/通货|通貨|currency|孕育赠礼|孕育贈禮|incubator|stackable currency/.test(text)) return 'currency';
  if (/宝石|寶石|skill gem|support gem|\bgem\b/.test(text)) return 'gem';
  if (/药剂|藥劑|flask|charm/.test(text)) return 'consumable';
  if (/碎片|fragment|邀请|邀請|invitation|圣甲虫|聖甲蟲|scarab/.test(text)) return 'fragment';
  if (/珠宝|珠寶|jewel/.test(text)) return 'jewel';
  if (/护甲|護甲|武器|头盔|頭盔|手套|鞋|戒指|项链|項鍊|腰带|腰帶|弓|剑|劍|斧|杖|weapon|armour|helmet|gloves|boots|ring|amulet|belt|staff|bow|sword|axe/.test(text)) {
    return 'equipment';
  }
  return 'unknown';
}

function stripModAnnotations(line) {
  return String(line || '')
    .normalize('NFKC')
    .replace(/\s*[（(]\s*(?:augmented|rune|crafted|implicit|fractured|enchant|unscalable|不可调整|無法調整)\s*[)）]/gi, '')
    .replace(/\s*[（(]\s*[-+]?\d+(?:\.\d+)?\s*[-–—~至]\s*[-+]?\d+(?:\.\d+)?(?:\s*[,，]\s*[-+]?\d+(?:\.\d+)?\s*[-–—~至]\s*[-+]?\d+(?:\.\d+)?)?\s*[)）]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function modTemplate(line) {
  return stripModAnnotations(line)
    .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
    .replace(/#\s*%/g, '#%')
    .replace(/\s+/g, ' ')
    .trim();
}

function numericValues(line) {
  const normalized = String(line).replace(/(\d)\s*-\s*(\d)/g, '$1 $2');
  const matches = normalized.match(/[-+]?\d+(?:\.\d+)?/g) || [];
  return matches.map(Number).filter(Number.isFinite);
}

function rollRanges(line) {
  const output = [];
  const normalized = String(line || '').normalize('NFKC');
  const pattern = /[（(]\s*([-+]?\d+(?:\.\d+)?)\s*[-–—~至]\s*([-+]?\d+(?:\.\d+)?)\s*[)）]/g;
  let match;
  while ((match = pattern.exec(normalized))) {
    const left = Number(match[1]);
    const right = Number(match[2]);
    if (Number.isFinite(left) && Number.isFinite(right)) output.push([Math.min(left, right), Math.max(left, right)]);
  }
  return output;
}

function rolledValues(line) {
  return numericValues(String(line || '')
    .replace(/[（(][^()（）]*[)）]/g, ' ')
    .replace(/\s+/g, ' '));
}

function headerValue(line, keys) {
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = line.match(new RegExp(`^(?:${escaped})\\s*[:：]\\s*(.+)$`, 'i'));
  return match ? match[1].trim() : null;
}

function parseModifierMetadata(value) {
  const text = String(value || '').trim();
  if (!text) return { raw: null, affixType: null, tier: null, affixName: null, source: 'unknown', fractured: false };
  const affixType = /前缀|前綴|prefix/i.test(text)
    ? 'prefix'
    : /后缀|後綴|suffix/i.test(text)
      ? 'suffix'
      : null;
  const tierMatch = text.match(/(?:等阶|等階|tier)\s*[:：]?\s*(\d+)/i);
  const nameMatch = text.match(/["“「『]([^"”」』]+)["”」』]/);
  const fractured = /破裂|fractured/i.test(text);
  const source = /亵渎|褻瀆|desecrated/i.test(text)
    ? 'desecrated'
    : /腐化|腐化的|corrupted/i.test(text)
      ? 'corrupted'
      : affixType
        ? 'normal'
        : 'unknown';
  return {
    raw: text,
    affixType,
    tier: tierMatch ? parseNumber(tierMatch[1]) : null,
    affixName: nameMatch ? nameMatch[1].trim() : null,
    source,
    fractured
  };
}

function numberFromProperty(line, keys) {
  const value = headerValue(line, keys);
  if (value == null) return null;
  const match = value.match(/[-+]?\d+(?:\.\d+)?/);
  return match ? parseNumber(match[0]) : null;
}

function statusFlags(lines) {
  const flags = {};
  for (const [key, pattern] of Object.entries(STATUS_PATTERNS)) {
    flags[key] = lines.some((line) => pattern.test(line.trim()));
  }
  return flags;
}

function parseRequirementLine(line) {
  if (!/^(?:需求|需求：|Requirements|Requires)/i.test(line.trim())) return null;
  const level = line.match(/(?:等级|等級|Level)\s*(\d+)/i);
  const strength = line.match(/(\d+)\s*(?:力量|Strength)/i);
  const dexterity = line.match(/(\d+)\s*(?:敏捷|Dexterity)/i);
  const intelligence = line.match(/(\d+)\s*(?:智慧|Intelligence)/i);
  return {
    level: level ? parseNumber(level[1]) : null,
    strength: strength ? parseNumber(strength[1]) : null,
    dexterity: dexterity ? parseNumber(dexterity[1]) : null,
    intelligence: intelligence ? parseNumber(intelligence[1]) : null
  };
}

function looksLikeDescription(line) {
  return /^(?:可在|将此物品|將此物品|右键点击|右鍵點擊|Place into|Can be used|此物品|能在)/i.test(line);
}

function parseItemText(input) {
  const rawText = normalizeText(input);
  if (!rawText) {
    return {
      ok: false,
      error: '剪贴板为空。请在游戏中悬停物品并按 Ctrl+C，再按 Ctrl+D；也可以手动粘贴物品文本。',
      rawText: ''
    };
  }

  const lines = rawText.split('\n').map((line) => line.trimEnd());
  const trimmedLines = lines.map((line) => line.trim());
  const separatorIndexes = [];
  trimmedLines.forEach((line, index) => {
    if (SEPARATOR_RE.test(line)) separatorIndexes.push(index);
  });

  const properties = {};
  const propertyLines = [];
  const descriptions = [];
  const trailingTags = [];
  let itemClass = '';
  let rarityRaw = '';
  let headerEnd = -1;

  trimmedLines.forEach((line, index) => {
    if (!line) return;

    const cls = headerValue(line, ['Item Class', '物品类别', '物品類別', '物品类型', '物品類型']);
    if (cls != null) {
      itemClass = cls;
      headerEnd = Math.max(headerEnd, index);
      return;
    }

    const rarity = headerValue(line, ['Rarity', '稀有度']);
    if (rarity != null) {
      rarityRaw = rarity;
      headerEnd = Math.max(headerEnd, index);
      return;
    }
  });

  const firstSeparator = separatorIndexes.length ? separatorIndexes[0] : lines.length;
  const titleLines = trimmedLines
    .slice(headerEnd + 1, firstSeparator)
    .filter(Boolean)
    .filter((line) => !line.includes(':') && !line.includes('：'));

  const rarity = normalizeRarity(rarityRaw);
  let name = titleLines[0] || '';
  let baseType = titleLines.length > 1 ? titleLines[titleLines.length - 1] : name;

  if (rarity === 'currency' || rarity === 'gem' || rarity === 'normal' || rarity === 'magic') {
    name = titleLines[0] || baseType;
    baseType = titleLines[titleLines.length - 1] || name;
  }

  const mapTierMatch = baseType.match(/(?:引路石|Waystone).*?[（(]?\s*(\d+)\s*阶/i) ||
    rawText.match(/(?:引路石|Waystone).*?[（(]?\s*(\d+)\s*阶/i);
  if (mapTierMatch) properties.mapTier = parseNumber(mapTierMatch[1]);

  let currentMeta = null;
  let afterTitle = false;

  trimmedLines.forEach((line, index) => {
    if (!line) return;
    if (index <= headerEnd || titleLines.includes(line)) return;
    if (SEPARATOR_RE.test(line)) {
      afterTitle = true;
      currentMeta = null;
      return;
    }

    const meta = line.match(META_RE);
    if (meta) {
      currentMeta = meta[1].trim();
      return;
    }

    for (const [key, pattern] of Object.entries(STATUS_PATTERNS)) {
      if (pattern.test(line)) {
        properties[key] = true;
        return;
      }
    }

    const directProperties = [
      ['quality', ['Quality', '品质', '品質']],
      ['itemLevel', ['Item Level', '物品等级', '物品等級']],
      ['sockets', ['Sockets', '插槽']],
      ['armour', ['Armour', '护甲', '護甲']],
      ['evasion', ['Evasion Rating', '闪避值', '閃避值']],
      ['energyShield', ['Energy Shield', '能量护盾', '能量護盾']],
      ['resurrections', ['复活次数', '復活次數']],
      ['itemRarityBonus', ['物品稀有度']],
      ['packSize', ['怪物群规模', '怪物群規模']],
      ['monsterPower', ['怪物效能']],
      ['waystoneDropChance', ['引路石掉落几率', '引路石掉落機率']]
    ];

    let handled = false;
    for (const [field, keys] of directProperties) {
      const value = headerValue(line, keys);
      if (value == null) continue;
      properties[field] = field === 'sockets' ? value : parseNumber((value.match(/[-+]?\d+(?:\.\d+)?/) || [])[0]);
      propertyLines.push({ field, text: line, value: properties[field] });
      handled = true;
      break;
    }
    if (handled) return;

    const requirement = parseRequirementLine(line);
    if (requirement) {
      properties.requirements = requirement;
      properties.requiredLevel = requirement.level;
      propertyLines.push({ field: 'requirements', text: line, value: requirement });
      return;
    }

    const stack = line.match(/^(?:Stack Size|堆叠数量|堆疊數量|堆叠数|堆疊數)\s*[:：]\s*([\d,]+)\s*\/\s*([\d,]+)/i);
    if (stack) {
      properties.stackCurrent = parseNumber(stack[1]);
      properties.stackMax = parseNumber(stack[2]);
      propertyLines.push({ field: 'stack', text: line, value: [properties.stackCurrent, properties.stackMax] });
      return;
    }

    const incubation = line.match(/^需要\s*([\d,]+)\s*(.+)$/);
    if (incubation) {
      properties.incubationAmount = parseNumber(incubation[1]);
      properties.incubationResource = incubation[2].trim();
      propertyLines.push({ field: 'incubation', text: line, value: properties.incubationAmount });
      return;
    }

    if (looksLikeDescription(line)) {
      descriptions.push(line);
      return;
    }

    if (/^(?:引路石掉落|地图掉落|地圖掉落)$/i.test(line)) {
      trailingTags.push(line);
      return;
    }

    if (!afterTitle) return;

    const looksLikeMod = /\d|%|增加|提高|降低|总降|减少|減少|附加|获得|獲得|抗性|伤害|傷害|速度|几率|機率|生命|能量护盾|能量護盾|精魂|暴击|暴擊|命中|闪避|閃避|冰缓|冰緩|流血|晕眩|暈眩|转化|轉化|increased|reduced|added|resistance|damage|speed|chance|life|energy shield/i.test(line);

    if (looksLikeMod) {
      properties.mods ||= [];
      const parsedMetadata = parseModifierMetadata(currentMeta);
      const previous = properties.mods[properties.mods.length - 1];
      // 同一个 { 前缀/后缀属性 } 标题下面可能有多行效果。旧逻辑会把
      // 每一行误算成一个独立词缀，导致前后缀数量和冲突组都错误。
      if (currentMeta && previous && previous.metadata === currentMeta) {
        previous.lines.push(line);
        previous.text = previous.lines.join('\n');
        previous.template = previous.lines.map(modTemplate).join('\n');
        previous.values.push(...numericValues(line));
        previous.rolledValues.push(...rolledValues(line));
        previous.rollRanges.push(...rollRanges(line));
      } else {
        properties.mods.push({
          text: line,
          lines: [line],
          template: modTemplate(line),
          values: numericValues(line),
          rolledValues: rolledValues(line),
          rollRanges: rollRanges(line),
          metadata: currentMeta,
          affixType: parsedMetadata.affixType,
          tier: parsedMetadata.tier,
          affixName: parsedMetadata.affixName,
          source: parsedMetadata.source,
          fractured: parsedMetadata.fractured
        });
      }
      return;
    }

    descriptions.push(line);
  });

  const flags = statusFlags(trimmedLines);
  const category = classifyItem(itemClass, rarityRaw, name, baseType);
  const language = /[\u3400-\u9fff]/.test(rawText) ? 'zh' : 'en';

  // Standard copied item text contains at least an item-class or rarity
  // header. Without either marker, ordinary clipboard text must not be treated
  // as an item merely because it has a non-empty first line.
  if (!itemClass && !rarityRaw) {
    return {
      ok: false,
      error: '没有识别到标准的流放之路物品文本。请在游戏内悬停物品并复制。',
      rawText,
      lines
    };
  }

  const item = {
    language,
    itemClass,
    rarityRaw,
    rarity,
    category,
    name,
    baseType,
    quality: properties.quality ?? null,
    itemLevel: properties.itemLevel ?? null,
    requiredLevel: properties.requiredLevel ?? null,
    mapTier: properties.mapTier ?? null,
    stackCurrent: properties.stackCurrent ?? null,
    stackMax: properties.stackMax ?? null,
    sockets: properties.sockets || '',
    defenses: {
      armour: properties.armour ?? null,
      evasion: properties.evasion ?? null,
      energyShield: properties.energyShield ?? null
    },
    requirements: properties.requirements || null,
    mapProperties: {
      resurrections: properties.resurrections ?? null,
      itemRarityBonus: properties.itemRarityBonus ?? null,
      packSize: properties.packSize ?? null,
      monsterPower: properties.monsterPower ?? null,
      waystoneDropChance: properties.waystoneDropChance ?? null
    },
    incubation: properties.incubationAmount == null ? null : {
      amount: properties.incubationAmount,
      resource: properties.incubationResource || ''
    },
    flags,
    mods: properties.mods || [],
    propertyLines,
    descriptions,
    trailingTags
  };

  return {
    ok: true,
    rawText,
    item
  };
}


module.exports = {
  parseItemText,
  normalizeText,
  parseModifierMetadata,
  modTemplate,
  stripModAnnotations,
  rollRanges
};
