'use strict';

const api = window.desktopApi;

async function run(task) {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await task();
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

(async () => {
  if (!api) throw new Error('请通过桌面应用启动。');
  document.getElementById('openRegexButton').addEventListener('click', () => run(() => api.openRegexGenerator()));
  document.getElementById('openArbitrageButton').addEventListener('click', () => run(() => api.openArbitrageAssistant()));
  document.getElementById('openMarketButton').addEventListener('click', () => run(() => api.openMarketMonitor()));
  document.getElementById('openCraftingButton').addEventListener('click', () => run(() => api.openCraftingPlanner()));
})().catch((error) => {
  console.error(error);
});
