'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SNAPSHOT_DIRECTORY_NAME = 'poe2-data-snapshots';
const LEGACY_SNAPSHOT_DIRECTORY_NAME = 'poe2-data-snapshot';
const POINTER_FILENAME = 'poe2-snapshot-current.json';
const REQUIRED_READY_FILES = Object.freeze([
  'manifest.json',
  'by-base/index.json',
  'base-items.json',
  'base-metadata.json',
  'modifier-groups.json'
]);

function sleepSync(milliseconds) {
  if (!milliseconds) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function removeWithRetry(target, options = {}) {
  if (!target || !fs.existsSync(target)) return;
  const retries = Number.isInteger(options.retries) ? options.retries : 8;
  const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 150;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(target, {
        recursive: options.recursive !== false,
        force: true,
        maxRetries: 3,
        retryDelay
      });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code) || attempt === retries) break;
      sleepSync(retryDelay * (attempt + 1));
    }
  }
  if (lastError) throw lastError;
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function inspectSnapshotRoot(root) {
  const resolved = root ? path.resolve(root) : null;
  const manifest = resolved ? readJsonIfPresent(path.join(resolved, 'manifest.json')) : null;
  if (!resolved || !manifest || manifest.status !== 'ready' || manifest.strictBasePools !== true) {
    return { root: resolved, ready: false, manifest: manifest || { status: 'missing' }, missingFiles: [] };
  }
  const missingFiles = REQUIRED_READY_FILES.filter((relative) => !fs.existsSync(path.join(resolved, relative)));
  return { root: resolved, ready: missingFiles.length === 0, manifest, missingFiles };
}

function snapshotsRoot(userDataRoot) {
  return path.join(path.resolve(userDataRoot), SNAPSHOT_DIRECTORY_NAME);
}

function pointerPath(userDataRoot) {
  return path.join(path.resolve(userDataRoot), POINTER_FILENAME);
}

function safeSnapshotPathFromPointer(userDataRoot, pointer) {
  const root = snapshotsRoot(userDataRoot);
  const relative = String(pointer?.relativeDirectory || '').trim();
  if (!relative || path.isAbsolute(relative)) return null;
  const resolved = path.resolve(root, relative);
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

function listReadySnapshots(userDataRoot) {
  const root = snapshotsRoot(userDataRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => inspectSnapshotRoot(path.join(root, entry.name)))
    .filter((entry) => entry.ready)
    .sort((a, b) => {
      const aTime = Date.parse(a.manifest.updatedAt || 0) || 0;
      const bTime = Date.parse(b.manifest.updatedAt || 0) || 0;
      return bTime - aTime;
    });
}

function resolveSnapshotReadRoot({ userDataRoot, bundledRoot }) {
  const pointer = readJsonIfPresent(pointerPath(userDataRoot));
  const pointedRoot = safeSnapshotPathFromPointer(userDataRoot, pointer);
  const legacyRoot = path.join(path.resolve(userDataRoot), LEGACY_SNAPSHOT_DIRECTORY_NAME);
  const readySnapshots = listReadySnapshots(userDataRoot);
  const candidates = [
    pointedRoot,
    ...readySnapshots.map((entry) => entry.root),
    legacyRoot,
    bundledRoot
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const inspected = inspectSnapshotRoot(resolved);
    if (inspected.ready) {
      return {
        ...inspected,
        pointerRecovered: Boolean(pointedRoot && resolved !== path.resolve(pointedRoot)),
        source: resolved === path.resolve(bundledRoot) ? 'bundled' : 'user-data'
      };
    }
  }
  const bundled = inspectSnapshotRoot(bundledRoot);
  return { ...bundled, source: 'bundled', pointerRecovered: false };
}

function createSnapshotInstallTarget(userDataRoot) {
  const root = snapshotsRoot(userDataRoot);
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const nonce = crypto.randomBytes(5).toString('hex');
  return {
    snapshotsRoot: root,
    destinationRoot: path.join(root, `snapshot-${stamp}-${nonce}`),
    errorRoot: path.resolve(userDataRoot)
  };
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    removeWithRetry(filePath, { recursive: false, retries: 5, retryDelay: 100 });
    let lastError = null;
    for (let attempt = 0; attempt <= 6; attempt += 1) {
      try {
        fs.renameSync(temporary, filePath);
        return;
      } catch (error) {
        lastError = error;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 6) break;
        sleepSync(120 * (attempt + 1));
      }
    }
    try {
      fs.copyFileSync(temporary, filePath);
      return;
    } catch (_fallbackError) {
      throw lastError;
    }
  } finally {
    if (fs.existsSync(temporary)) removeWithRetry(temporary, { recursive: false });
  }
}

function activateSnapshot(userDataRoot, snapshotRoot) {
  const inspected = inspectSnapshotRoot(snapshotRoot);
  if (!inspected.ready) {
    throw new Error(`不能激活不完整的严格快照${inspected.missingFiles.length ? `，缺少：${inspected.missingFiles.join('、')}` : ''}`);
  }
  const root = snapshotsRoot(userDataRoot);
  const resolved = path.resolve(snapshotRoot);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('严格快照不在用户数据目录中，拒绝激活。');
  const relativeDirectory = path.relative(root, resolved);
  const pointer = {
    schemaVersion: 1,
    relativeDirectory,
    activatedAt: new Date().toISOString(),
    snapshotUpdatedAt: inspected.manifest.updatedAt || null,
    sourceCommit: inspected.manifest.sourceCommit || null
  };
  writeJsonAtomic(pointerPath(userDataRoot), pointer);
  return pointer;
}

function cleanupOldSnapshots(userDataRoot, activeRoot, keep = 3) {
  const active = path.resolve(activeRoot);
  const ready = listReadySnapshots(userDataRoot);
  const retained = new Set([active, ...ready.slice(0, Math.max(1, keep)).map((entry) => path.resolve(entry.root))]);
  const root = snapshotsRoot(userDataRoot);
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.resolve(root, entry.name);
    if (retained.has(target)) continue;
    try { removeWithRetry(target); } catch (_error) { /* 下次启动再清理，不影响当前快照。 */ }
  }
}

module.exports = {
  SNAPSHOT_DIRECTORY_NAME,
  LEGACY_SNAPSHOT_DIRECTORY_NAME,
  POINTER_FILENAME,
  REQUIRED_READY_FILES,
  inspectSnapshotRoot,
  snapshotsRoot,
  pointerPath,
  safeSnapshotPathFromPointer,
  listReadySnapshots,
  resolveSnapshotReadRoot,
  createSnapshotInstallTarget,
  activateSnapshot,
  cleanupOldSnapshots,
  writeJsonAtomic,
  removeWithRetry
};
