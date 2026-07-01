'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveInside(root, relativePath) {
  const base = path.resolve(root);
  const target = path.resolve(root, relativePath);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error(`资料仓库路径越界：${relativePath}`);
  }
  return target;
}

function loadPoe2CatalogSync(root, snapshotRoot = null) {
  const manifest = readJson(path.join(root, 'manifest.json'));
  if (Number(manifest.schemaVersion) !== 1) throw new Error('data-catalog schemaVersion 必须为 1。');
  const load = (key) => readJson(resolveInside(root, manifest.files[key]));
  const equipment = load('equipmentClasses');
  const coreCurrencies = load('coreCurrencies');
  const catalysts = load('catalysts');
  const splinters = load('splinters');
  const abyssalBones = load('abyssalBones');
  const currencyGroups = load('currencyGroups');
  const modifierFamilies = load('coreModifierFamilies');
  const modifierSources = load('modifierSources');
  const snapshotManifestPath = snapshotRoot ? path.join(snapshotRoot, 'manifest.json') : null;
  const snapshot = snapshotManifestPath && fs.existsSync(snapshotManifestPath)
    ? readJson(snapshotManifestPath)
    : { status: 'missing', files: {} };
  return {
    manifest,
    equipmentClasses: equipment.records || [],
    coreCurrencies: coreCurrencies.records || [],
    catalysts: catalysts.records || [],
    splinters: splinters.records || [],
    abyssalBones: abyssalBones.records || [],
    currencies: [...(coreCurrencies.records || []), ...(catalysts.records || []), ...(splinters.records || []), ...(abyssalBones.records || [])],
    currencyGroups: currencyGroups.groups || [],
    modifierFamilies: modifierFamilies.records || [],
    modifierSources: modifierSources.sources || [],
    probabilityPolicy: modifierSources.probabilityPolicy || {},
    bundledStatus: modifierSources.bundledStatus || {},
    snapshot
  };
}

function summarizeSnapshot(snapshot) {
  const files = snapshot?.files && typeof snapshot.files === 'object' ? snapshot.files : {};
  return {
    status: snapshot?.status || 'missing',
    updatedAt: snapshot?.updatedAt || null,
    fileCount: Object.keys(files).length,
    modifierPoolCount: Number(snapshot?.counts?.modifierPools || 0),
    modifierTierCount: Number(snapshot?.counts?.modifierTiers || 0),
    modifierFamilyCount: Number(snapshot?.counts?.modifierFamilies || 0),
    essenceCount: Number(snapshot?.counts?.essences || 0),
    rawModRows: Number(snapshot?.counts?.rawModRows || 0),
    stackableCurrencyIndex: Number(snapshot?.counts?.stackableCurrencyIndex || 0),
    catalystIndex: Number(snapshot?.counts?.catalystIndex || 0),
    poe2dbEssenceIndex: Number(snapshot?.counts?.poe2dbEssenceIndex || 0),
    errors: Array.isArray(snapshot?.errors) ? snapshot.errors : []
  };
}

function summarizePoe2Catalog(catalog) {
  return {
    schemaVersion: catalog?.manifest?.schemaVersion || null,
    catalogVersion: catalog?.manifest?.catalogVersion || null,
    coreCurrencyCount: catalog?.coreCurrencies?.length || 0,
    catalystCount: catalog?.catalysts?.length || 0,
    splinterCount: catalog?.splinters?.length || 0,
    abyssalBoneCount: catalog?.abyssalBones?.length || 0,
    currencyCount: catalog?.currencies?.length || 0,
    equipmentClassCount: catalog?.equipmentClasses?.length || 0,
    coreModifierFamilyCount: catalog?.modifierFamilies?.length || 0,
    currencyGroupCount: catalog?.currencyGroups?.length || 0,
    sourceCount: catalog?.modifierSources?.length || 0,
    probabilityPolicy: catalog?.probabilityPolicy || {},
    snapshot: summarizeSnapshot(catalog?.snapshot)
  };
}

function searchCatalog(catalog, query = '') {
  const needle = String(query || '').trim().toLowerCase();
  const includes = (...parts) => !needle || parts.some((part) => String(part || '').toLowerCase().includes(needle));
  return {
    currencies: (catalog.currencies || []).filter((record) => includes(record.nameZh, record.nameEn, record.effectZh, record.kind)),
    equipmentClasses: (catalog.equipmentClasses || []).filter((record) => includes(record.nameZh, record.nameEn, record.group, ...(record.tags || []))),
    modifierFamilies: (catalog.modifierFamilies || []).filter((record) => includes(record.nameZh, record.templateEn, record.group, record.id))
  };
}

module.exports = {
  loadPoe2CatalogSync,
  summarizeSnapshot,
  summarizePoe2Catalog,
  searchCatalog
};
