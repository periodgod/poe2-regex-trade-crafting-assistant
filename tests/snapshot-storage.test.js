'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  inspectSnapshotRoot,
  snapshotsRoot,
  pointerPath,
  safeSnapshotPathFromPointer,
  resolveSnapshotReadRoot,
  createSnapshotInstallTarget,
  activateSnapshot,
  cleanupOldSnapshots
} = require('../src/snapshot-storage');
const { createTemporaryWorkspace, removeWithRetry } = require('../scripts/update-poe2-full-data');

function makeReadySnapshot(root, updatedAt, sourceCommit = 'a'.repeat(40)) {
  fs.mkdirSync(path.join(root, 'by-base'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 2,
    status: 'ready',
    strictBasePools: true,
    updatedAt,
    sourceCommit
  }));
  fs.writeFileSync(path.join(root, 'by-base', 'index.json'), '{}');
  fs.writeFileSync(path.join(root, 'base-items.json'), '[]');
  fs.writeFileSync(path.join(root, 'base-metadata.json'), '{}');
  fs.writeFileSync(path.join(root, 'modifier-groups.json'), '{}');
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poe2-snapshot-storage-'));
try {
  const userData = path.join(temp, 'user-data');
  const bundled = path.join(temp, 'bundled');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(bundled, { recursive: true });
  fs.writeFileSync(path.join(bundled, 'manifest.json'), JSON.stringify({ schemaVersion: 2, status: 'not-downloaded', strictBasePools: false }));

  const first = createSnapshotInstallTarget(userData).destinationRoot;
  makeReadySnapshot(first, '2026-06-18T01:00:00.000Z');
  const pointer = activateSnapshot(userData, first);
  assert.equal(pointer.relativeDirectory, path.basename(first));
  assert.ok(fs.existsSync(pointerPath(userData)));
  assert.equal(resolveSnapshotReadRoot({ userDataRoot: userData, bundledRoot: bundled }).root, first);
  assert.equal(inspectSnapshotRoot(first).ready, true);

  const second = createSnapshotInstallTarget(userData).destinationRoot;
  makeReadySnapshot(second, '2026-06-18T02:00:00.000Z', 'b'.repeat(40));
  fs.writeFileSync(pointerPath(userData), JSON.stringify({ relativeDirectory: '../escape' }));
  assert.equal(safeSnapshotPathFromPointer(userData, { relativeDirectory: '../escape' }), null);
  const recovered = resolveSnapshotReadRoot({ userDataRoot: userData, bundledRoot: bundled });
  assert.equal(recovered.root, second, '损坏指针时应自动恢复最新完整快照');

  activateSnapshot(userData, second);
  cleanupOldSnapshots(userData, second, 1);
  assert.ok(fs.existsSync(second));

  const blockedWorkspace = path.join(temp, 'not-a-directory');
  fs.writeFileSync(blockedWorkspace, 'x');
  const workspace = createTemporaryWorkspace({ workspaceRoot: blockedWorkspace }, path.join(temp, 'fallback-parent'));
  assert.ok(fs.existsSync(workspace));
  assert.notEqual(path.dirname(workspace), blockedWorkspace);
  removeWithRetry(workspace);

  const target = createSnapshotInstallTarget(userData);
  assert.ok(path.resolve(target.destinationRoot).startsWith(`${path.resolve(snapshotsRoot(userData))}${path.sep}`));
} finally {
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

console.log('snapshot-storage tests passed');
