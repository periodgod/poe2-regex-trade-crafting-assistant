'use strict';
const path = require('node:path');
const { loadCraftingDataV2Sync, summarizeDataV2 } = require('../src/crafting-data-repository');
try {
  const data = loadCraftingDataV2Sync(path.join(__dirname, '..', 'data-v2'));
  const summary = summarizeDataV2(data);
  if (!summary.ok) throw new Error(summary.errors.join('; '));
  console.log(JSON.stringify(summary, null, 2));
  console.log('data-v2 validation passed');
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
