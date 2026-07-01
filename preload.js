'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  openArbitrageAssistant: () => ipcRenderer.invoke('assistant:open'),
  openMarketMonitor: () => ipcRenderer.invoke('market:open'),
  getArbitrageState: () => ipcRenderer.invoke('arbitrage:state-get'),
  saveArbitrageState: (data) => ipcRenderer.invoke('arbitrage:state-save', data || {}),
  getMarketMonitorState: () => ipcRenderer.invoke('market:state-get'),
  saveMarketMonitorState: (data) => ipcRenderer.invoke('market:state-save', data || {}),
  checkMarketMonitor: (payload) => ipcRenderer.invoke('market:check', payload || {}),
  openMarketExternal: (url) => ipcRenderer.invoke('market:open-external', url),
  reportRuntimeDiagnostic: (payload) => ipcRenderer.invoke('diagnostics:report', payload || {}),
  getRuntimeDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  openRuntimeLog: () => ipcRenderer.invoke('diagnostics:open-log'),

  openRegexGenerator: () => ipcRenderer.invoke('regex:open'),
  generateRegex: (payload) => ipcRenderer.invoke('regex:generate', payload || {}),
  testRegex: (payload) => ipcRenderer.invoke('regex:test', payload || {}),
  listRegexPresets: () => ipcRenderer.invoke('regex:presets-list'),
  saveRegexPreset: (payload) => ipcRenderer.invoke('regex:preset-save', payload || {}),
  deleteRegexPreset: (presetId) => ipcRenderer.invoke('regex:preset-delete', presetId),
  getRegexWorkspace: () => ipcRenderer.invoke('regex:workspace-get'),
  saveRegexWorkspace: (workspace) => ipcRenderer.invoke('regex:workspace-save', workspace || {}),
  recordRegexResult: (payload) => ipcRenderer.invoke('regex:record-result', payload || {}),

  openCraftingPlanner: () => ipcRenderer.invoke('craft:open'),
  getCraftingContext: () => ipcRenderer.invoke('craft:context'),
  readCraftingItemClipboard: () => ipcRenderer.invoke('craft:read-item-clipboard'),
  analyzeCraft: (payload) => ipcRenderer.invoke('craft:analyze', payload || {}),
  createCraftingState: (payload) => ipcRenderer.invoke('craft:state-create', payload || {}),
  previewCraftingCurrency: (payload) => ipcRenderer.invoke('craft:currency-preview', payload || {}),
  applyCraftingCurrency: (payload) => ipcRenderer.invoke('craft:currency-apply', payload || {}),
  previewCraftingSpecialAction: (payload) => ipcRenderer.invoke('craft:special-preview', payload || {}),
  applyCraftingSpecialAction: (payload) => ipcRenderer.invoke('craft:special-apply', payload || {}),
  previewDesecratedReveal: (payload) => ipcRenderer.invoke('craft:desecrated-reveal-preview', payload || {}),
  applyDesecratedReveal: (payload) => ipcRenderer.invoke('craft:desecrated-reveal-apply', payload || {}),
  saveCurrencyPrices: (prices) => ipcRenderer.invoke('craft:prices-save', prices || {}),
  updateFullPoe2Data: () => ipcRenderer.invoke('craft:update-full-snapshot'),
  onCraftingDataUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('craft:data-update-progress', listener);
    return () => ipcRenderer.removeListener('craft:data-update-progress', listener);
  },

  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy-text', text),
  exportHistory: () => ipcRenderer.invoke('history:export'),
  clearHistory: () => ipcRenderer.invoke('history:clear')
});
