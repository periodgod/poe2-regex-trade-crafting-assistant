'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_SECTIONS = ['bases', 'modifiers', 'currencies', 'omens', 'rules', 'localization', 'mechanics'];

function readJsonSync(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`数据文件路径越界：${candidate}`);
  }
  return resolved;
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') errors.push('manifest 必须是 JSON 对象。');
  if (Number(manifest?.schemaVersion) !== 2) errors.push('manifest.schemaVersion 必须为 2。');
  if (!manifest?.dataVersion) errors.push('manifest 缺少 dataVersion。');
  if (!manifest?.files || typeof manifest.files !== 'object') errors.push('manifest 缺少 files。');
  for (const section of ALLOWED_SECTIONS) {
    const files = manifest?.files?.[section];
    if (files != null && !Array.isArray(files)) errors.push(`manifest.files.${section} 必须是数组。`);
  }
  return { ok: errors.length === 0, errors };
}

function readSectionFiles(root, manifest, section) {
  const records = [];
  const documents = [];
  for (const relativePath of manifest.files?.[section] || []) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      throw new Error(`manifest.files.${section} 包含无效路径。`);
    }
    const filePath = ensureInside(root, relativePath);
    const document = readJsonSync(filePath);
    if (Number(document.schemaVersion) !== 2) {
      throw new Error(`${relativePath} 的 schemaVersion 不是 2。`);
    }
    if (document.kind !== section) {
      throw new Error(`${relativePath} 的 kind=${document.kind || '缺失'}，预期 ${section}。`);
    }
    const fileRecords = Array.isArray(document.records) ? document.records : [];
    for (const record of fileRecords) {
      records.push({
        ...record,
        _dataFile: relativePath,
        ...(section === 'modifiers' && !record.source && document.sourceType
          ? { source: document.sourceType }
          : {})
      });
    }
    documents.push({ relativePath, ...document, records: undefined, recordCount: fileRecords.length });
  }
  return { records, documents };
}

function duplicateIdErrors(records, label) {
  const errors = [];
  const seen = new Set();
  for (const record of records) {
    if (!record?.id) {
      errors.push(`${label} 存在缺少 id 的记录。`);
      continue;
    }
    if (seen.has(record.id)) errors.push(`${label} id 重复：${record.id}`);
    seen.add(record.id);
  }
  return errors;
}

function validateModifier(modifier) {
  const errors = [];
  if (!modifier.name) errors.push(`词缀 ${modifier.id || '?'} 缺少 name。`);
  if (!['prefix', 'suffix', 'implicit', 'corrupted'].includes(modifier.type)) {
    errors.push(`词缀 ${modifier.id || '?'} 的 type 无效。`);
  }
  if (!modifier.family) errors.push(`词缀 ${modifier.id || '?'} 缺少 family。`);
  if (!modifier.source) errors.push(`词缀 ${modifier.id || '?'} 缺少 source。`);
  if (!Array.isArray(modifier.tiers) || !modifier.tiers.length) {
    errors.push(`词缀 ${modifier.id || '?'} 缺少 tiers。`);
  }
  for (const tier of modifier.tiers || []) {
    if (!Number.isInteger(Number(tier.tier)) || Number(tier.tier) < 1) {
      errors.push(`词缀 ${modifier.id || '?'} 存在无效 tier。`);
    }
    if (!Number.isFinite(Number(tier.level)) || Number(tier.level) < 0) {
      errors.push(`词缀 ${modifier.id || '?'} 存在无效 level。`);
    }
    if (!Number.isFinite(Number(tier.weight)) || Number(tier.weight) <= 0) {
      errors.push(`词缀 ${modifier.id || '?'} 存在无效 weight。`);
    }
  }
  return errors;
}

function validateDataV2(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['数据仓库为空。'] };
  if (Number(data.schemaVersion) !== 2) errors.push('数据仓库 schemaVersion 必须为 2。');
  if (!Array.isArray(data.bases)) errors.push('数据仓库缺少 bases。');
  else if (!data.bases.length && data.strictSnapshotRequired !== true) errors.push('数据仓库缺少 bases。');
  if (!Array.isArray(data.modifiers)) errors.push('数据仓库缺少 modifiers。');
  errors.push(...duplicateIdErrors(data.bases || [], '底材'));
  errors.push(...duplicateIdErrors(data.modifiers || [], '词缀'));
  errors.push(...duplicateIdErrors(data.currencies || [], '通货'));
  errors.push(...duplicateIdErrors(data.omens || [], '预兆'));
  for (const base of data.bases || []) {
    if (!base.name) errors.push(`底材 ${base.id || '?'} 缺少 name。`);
    if (!Array.isArray(base.tags)) errors.push(`底材 ${base.id || '?'} 缺少 tags。`);
    if (!Number.isInteger(Number(base.maxPrefixes)) || Number(base.maxPrefixes) < 0) errors.push(`底材 ${base.id || '?'} 的 maxPrefixes 无效。`);
    if (!Number.isInteger(Number(base.maxSuffixes)) || Number(base.maxSuffixes) < 0) errors.push(`底材 ${base.id || '?'} 的 maxSuffixes 无效。`);
  }
  for (const modifier of data.modifiers || []) errors.push(...validateModifier(modifier));
  return { ok: errors.length === 0, errors };
}

function buildIndexes(data) {
  return {
    baseById: new Map(data.bases.map((record) => [record.id, record])),
    modifierById: new Map(data.modifiers.map((record) => [record.id, record])),
    currencyById: new Map(data.currencies.map((record) => [record.id, record])),
    omenById: new Map(data.omens.map((record) => [record.id, record])),
    mechanicById: new Map((data.mechanics || []).map((record) => [record.id, record])),
    essenceById: new Map((data.essences || []).map((record) => [record.id, record])),
    socketableById: new Map((data.socketables || []).map((record) => [record.id, record]))
  };
}

function loadCraftingDataV2Sync(root) {
  const resolvedRoot = path.resolve(root);
  const manifestPath = path.join(resolvedRoot, 'manifest.json');
  const manifest = readJsonSync(manifestPath);
  const manifestValidation = validateManifest(manifest);
  if (!manifestValidation.ok) throw new Error(`manifest 无效：${manifestValidation.errors.join('；')}`);

  const sections = {};
  for (const section of ALLOWED_SECTIONS) sections[section] = readSectionFiles(resolvedRoot, manifest, section);

  const data = {
    schemaVersion: 2,
    dataVersion: manifest.dataVersion,
    game: manifest.game,
    generatedAt: manifest.generatedAt,
    source: manifest.source || null,
    strictSnapshotRequired: manifest.strictSnapshotRequired === true,
    bases: sections.bases.records,
    modifiers: sections.modifiers.records,
    currencies: sections.currencies.records,
    omens: sections.omens.records,
    rules: sections.rules.records,
    localization: sections.localization.records,
    mechanics: sections.mechanics.records,
    essences: [],
    socketables: [],
    documents: Object.fromEntries(ALLOWED_SECTIONS.map((section) => [section, sections[section].documents])),
    root: resolvedRoot
  };
  const validation = validateDataV2(data);
  if (!validation.ok) throw new Error(`data-v2 无效：${validation.errors.join('；')}`);
  data.indexes = buildIndexes(data);
  return data;
}

async function loadCraftingDataV2(root) {
  return loadCraftingDataV2Sync(root);
}

function summarizeDataV2(data) {
  const validation = validateDataV2(data);
  const sourceCounts = {};
  for (const modifier of data?.modifiers || []) {
    sourceCounts[modifier.source || 'unknown'] = (sourceCounts[modifier.source || 'unknown'] || 0) + 1;
  }
  return {
    ...validation,
    schemaVersion: data?.schemaVersion || null,
    dataVersion: data?.dataVersion || null,
    source: data?.source || null,
    strictSnapshotRequired: data?.strictSnapshotRequired === true,
    baseCount: data?.bases?.length || 0,
    modifierCount: data?.modifiers?.length || 0,
    tierCount: (data?.modifiers || []).reduce((sum, modifier) => sum + (modifier.tiers?.length || 0), 0),
    currencyCount: data?.currencies?.length || 0,
    omenCount: data?.omens?.length || 0,
    mechanicCount: data?.mechanics?.length || 0,
    essenceCount: data?.essences?.length || 0,
    socketableCount: data?.socketables?.length || 0,
    modifierSourceCounts: sourceCounts,
    fileCount: Object.values(data?.documents || {}).reduce((sum, docs) => sum + docs.length, 0)
  };
}

function toLegacyCraftingData(data) {
  return {
    schemaVersion: 2,
    dataVersion: data.dataVersion,
    source: data.source,
    strictSnapshotRequired: data.strictSnapshotRequired === true,
    bases: data.bases.map(({ _dataFile, ...record }) => record),
    modifiers: data.modifiers.map(({ _dataFile, ...record }) => record),
    currencies: data.currencies.map(({ _dataFile, ...record }) => record),
    omens: data.omens.map(({ _dataFile, ...record }) => record),
    mechanics: (data.mechanics || []).map(({ _dataFile, ...record }) => record),
    essences: (data.essences || []).map(({ _dataFile, ...record }) => record),
    socketables: (data.socketables || []).map(({ _dataFile, ...record }) => record),
    repositorySummary: summarizeDataV2(data)
  };
}

module.exports = {
  ALLOWED_SECTIONS,
  readJsonSync,
  validateManifest,
  validateDataV2,
  loadCraftingDataV2,
  loadCraftingDataV2Sync,
  summarizeDataV2,
  toLegacyCraftingData
};
