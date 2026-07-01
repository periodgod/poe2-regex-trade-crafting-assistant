// ==UserScript==
// @name         POE2 国服商人页签前往藏身处点击助手
// @namespace    local.poe2.cn.market.monitor
// @version      1.4.0
// @description  从本地 POE2 集市监控网页接收任务，在国服官方集市页中点击真正的“前往藏身处”按钮。不会购买物品。
// @match        https://poe.game.qq.com/trade2/search/poe2/*
// @match        https://poe.game.qq.com/trade/search/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOCAL = 'http://127.0.0.1:5177';
  const POLL_MS = 1200;
  const USE_NATIVE_CLICK = true; // Windows 本地坐标点击兜底，比网页 JS click 更接近真实鼠标点击。
  let busy = false;
  let lastClickedTaskId = '';
  let lastReportKey = '';
  let helperBox = null;

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[，。；：]/g, ' ')
      .trim()
      .toLowerCase();
  }

  function extractSearchId(value = '') {
    const text = String(value || '');
    const match = text.match(/\/trade2?\/search\/poe2\/[^\/\s?#]+\/([^\/\s?#]+)/i)
      || text.match(/\/trade\/search\/[^\/\s?#]+\/([^\/\s?#]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function currentSearchId() {
    return extractSearchId(window.location.href);
  }

  function requestJson(method, path, body) {
    const url = LOCAL + path;
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers: { 'content-type': 'application/json' },
          data: body ? JSON.stringify(body) : undefined,
          timeout: 5000,
          onload: (resp) => {
            try {
              resolve(JSON.parse(resp.responseText || '{}'));
            } catch (err) {
              reject(err);
            }
          },
          onerror: reject,
          ontimeout: () => reject(new Error('本地点击助手接口超时'))
        });
      });
    }
    return fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(r => r.json());
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
  }

  function elementText(el) {
    return normalizeText(el && (el.innerText || el.textContent || ''));
  }

  function getClickable(el) {
    if (!el || !(el instanceof Element)) return el;
    return el.closest('button, a, [role="button"], .btn, .button, [ng-click], [data-action], [data-event]') || el;
  }

  function rectArea(el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function ownOrCompactText(el) {
    return String(el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function targetButtonScore(el) {
    const text = ownOrCompactText(el);
    const rect = el.getBoundingClientRect();
    const area = rectArea(el);
    let score = 0;
    if (/^前往\s*藏身处$/.test(text)) score += 60;
    else if (/前往\s*藏身处/.test(text)) score += 25;
    if (el.matches('button, a, [role="button"], .btn, .button, [ng-click], [data-action], [data-event]')) score += 20;
    if (rect.width >= 40 && rect.width <= 220 && rect.height >= 18 && rect.height <= 70) score += 18;
    if (area > 0 && area < 18000) score += 8;
    if (area > 35000) score -= 40; // 结果卡片/大容器不能当按钮点。
    if (rect.left > window.innerWidth * 0.45) score += 5;
    if (!isVisible(el)) score -= 100;
    return score;
  }

  function findHideoutButtons() {
    // 之前的问题就是这里：父级卡片 div 也包含“前往藏身处”，脚本可能点到卡片中央，游戏当然不会传送。
    // v1.2 改成只保留真正的小按钮/链接，并剔除包含其它候选按钮的大祖先节点。
    const raw = Array.from(document.querySelectorAll('button, a, [role="button"], .btn, .button, [ng-click], [data-action], [data-event], div, span'))
      .filter(isVisible)
      .filter(el => /前往\s*藏身处/.test(el.innerText || el.textContent || ''))
      .map(el => getClickable(el))
      .filter(Boolean)
      .filter(isVisible);

    const unique = Array.from(new Set(raw));
    const withoutAncestors = unique.filter(el => {
      const area = rectArea(el);
      return !unique.some(other => other !== el && el.contains(other) && rectArea(other) > 0 && rectArea(other) < area * 0.75);
    });

    return withoutAncestors
      .map(el => ({ el, score: targetButtonScore(el), area: rectArea(el), text: ownOrCompactText(el) }))
      .filter(row => row.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.area - b.area))
      .map(row => row.el);
  }

  function ancestorTextScores(button, task) {
    const taskName = normalizeText(task.name || '');
    const seller = normalizeText(task.seller || '');
    const priceText = normalizeText(task.priceText || '');
    const priceNumber = String(task.priceAmount || (priceText.match(/\d+(?:\.\d+)?/) || [''])[0] || '');
    const priceCurrency = normalizeText(task.priceCurrency || priceText.replace(priceNumber, ''));
    const nameParts = taskName.split(' ').filter(Boolean);

    let best = { score: 0, text: '', node: button };
    let node = button;
    for (let depth = 0; node && depth < 12; depth += 1, node = node.parentElement) {
      const text = elementText(node);
      let score = 0;
      if (taskName && text.includes(taskName)) score += 12;
      for (const part of nameParts) {
        if (part.length >= 2 && text.includes(part)) score += 2;
      }
      if (seller && text.includes(seller)) score += 5;
      if (priceText && text.includes(priceText)) score += 8;
      if (priceNumber && text.includes(priceNumber)) score += 4;
      if (priceCurrency && text.includes(priceCurrency)) score += 2;
      if (/神圣石|divine/i.test(text) && /神圣|divine/i.test(priceText)) score += 2;
      if (/前往\s*藏身处/.test(text)) score += 1;
      if (score > best.score) best = { score, text, node };
    }
    return best;
  }

  function pageWindowFor(el) {
    try { return el?.ownerDocument?.defaultView || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window); } catch (_) {}
    try { return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window; } catch (_) {}
    return window;
  }

  function makeSafeMouseEvent(type, x, y, el) {
    // 用页面原生 Window 构造事件，避免 Tampermonkey 隔离环境导致 PointerEvent/MouseEvent 异常。
    const pageWin = pageWindowFor(el);
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: Math.round((window.screenX || window.screenLeft || 0) + x),
      screenY: Math.round((window.screenY || window.screenTop || 0) + y),
      button: 0,
      buttons: type.includes('down') ? 1 : 0
    };
    try {
      const PointerCtor = pageWin.PointerEvent || window.PointerEvent;
      if (type.startsWith('pointer') && typeof PointerCtor === 'function') {
        return new PointerCtor(type, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      }
    } catch (_) {}
    try {
      const MouseCtor = pageWin.MouseEvent || window.MouseEvent;
      return new MouseCtor(type.replace(/^pointer/, 'mouse'), base);
    } catch (_) {
      return null;
    }
  }

  function dispatchDomClick(el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const pointEl = document.elementFromPoint(x, y);
    const pointClickable = getClickable(pointEl || el);
    const targets = Array.from(new Set([pointClickable, el].filter(Boolean)));
    const types = ['pointerover', 'mouseover', 'pointerenter', 'mouseenter', 'pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const target of targets) {
      try { target.focus?.(); } catch (_) {}
      for (const type of types) {
        const evt = makeSafeMouseEvent(type, x, y, target);
        if (!evt) continue;
        try { target.dispatchEvent(evt); } catch (_) {}
      }
      try { if (typeof target.click === 'function') target.click(); } catch (_) {}
    }
  }

  function screenPointForElement(el) {
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const borderX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const chromeY = Math.max(0, window.outerHeight - window.innerHeight - borderX);
    return {
      x: Math.round(window.screenX + borderX + clientX),
      y: Math.round(window.screenY + chromeY + clientY),
      clientX: Math.round(clientX),
      clientY: Math.round(clientY)
    };
  }

  async function nativeClick(el, task) {
    const point = screenPointForElement(el);
    return requestJson('POST', '/api/native-click', {
      taskId: task.id,
      x: point.x,
      y: point.y,
      pageUrl: window.location.href
    });
  }

  function ensureHelperBox() {
    if (helperBox || !document.body) return helperBox;
    helperBox = document.createElement('div');
    helperBox.id = 'poe2-cn-hideout-click-helper-status';
    helperBox.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
      'max-width:360px', 'padding:10px 12px', 'border:1px solid rgba(163,230,53,.8)',
      'background:rgba(15,23,42,.92)', 'color:#e2e8f0', 'font:12px/1.45 system-ui, sans-serif',
      'border-radius:12px', 'box-shadow:0 10px 30px rgba(0,0,0,.35)', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(helperBox);
    return helperBox;
  }

  function setStatus(text, level = 'info') {
    const box = ensureHelperBox();
    if (!box) return;
    const color = level === 'ok' ? '#a3e635' : (level === 'warn' ? '#fbbf24' : (level === 'err' ? '#fb7185' : '#bfdbfe'));
    box.innerHTML = `<strong style="color:${color}">POE2 点击助手</strong><br>${String(text).replace(/[<>]/g, '')}`;
  }

  function isTaskForThisPage(task) {
    const taskSearchId = task.sourceSearchId || extractSearchId(task.sourceUrl || '');
    const pageSearchId = currentSearchId();
    if (!taskSearchId || !pageSearchId) return true;
    return taskSearchId === pageSearchId;
  }

  async function clickHideout(task) {
    const attempts = 16;
    let lastReason = '页面中没有找到“前往藏身处”按钮';
    for (let i = 0; i < attempts; i += 1) {
      const buttons = findHideoutButtons();
      if (buttons.length) {
        const ranked = buttons.map(button => ({ button, ...ancestorTextScores(button, task) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked[0];
        if (buttons.length === 1 || best.score >= 4) {
          setStatus(`找到按钮，准备点击：${task.name || ''} ${task.priceText || ''}`, 'ok');
          let domClickError = '';
          try {
            dispatchDomClick(best.button);
          } catch (err) {
            domClickError = err.message || String(err);
          }
          let nativeResult = null;
          if (USE_NATIVE_CLICK) {
            try {
              nativeResult = await nativeClick(best.button, task);
            } catch (err) {
              lastReason = `已尝试网页 click${domClickError ? `（DOM 事件异常：${domClickError}）` : ''}，但 Windows 原生坐标点击失败：${err.message || err}`;
              return { clicked: false, reason: lastReason, targetText: (best.text || elementText(best.button)).slice(0, 240), score: best.score };
            }
          }
          const targetText = (best.text || ownOrCompactText(best.button) || elementText(best.button)).slice(0, 240);
          const nativeMessage = nativeResult?.ok
            ? '已执行 Windows 原生坐标点击“前往藏身处”'
            : (nativeResult?.error ? `Windows 原生点击失败，已执行网页点击：${nativeResult.error}` : '已执行网页点击“前往藏身处”');
          return {
            clicked: true,
            reason: `${nativeMessage}；目标按钮文本：${targetText || '未知'}`.slice(0, 260),
            targetText,
            score: best.score,
            pageUrl: window.location.href
          };
        }
        lastReason = `找到 ${buttons.length} 个按钮，但未能可靠匹配目标物品；最高分 ${best.score}`;
      }
      if (i < attempts - 1) {
        window.scrollBy({ top: i % 2 === 0 ? 420 : -180, behavior: 'instant' });
        await wait(420);
      }
    }
    return { clicked: false, reason: lastReason, targetText: '', score: 0, pageUrl: window.location.href };
  }

  async function pollTask() {
    if (busy) return;
    busy = true;
    try {
      const json = await requestJson('GET', '/api/click-hideout');
      const task = json && json.task;
      if (!task || !task.id) {
        setStatus(`已连接本地服务，等待任务。当前搜索ID：${currentSearchId() || '未知'}`);
        return;
      }
      if (task.id === lastClickedTaskId) return;
      if (!isTaskForThisPage(task)) {
        const key = `${task.id}:ignored:${currentSearchId()}`;
        setStatus(`收到任务，但不是当前搜索页。任务ID：${task.sourceSearchId || extractSearchId(task.sourceUrl || '')}，当前页：${currentSearchId()}`, 'warn');
        if (key !== lastReportKey) {
          lastReportKey = key;
          await requestJson('POST', '/api/click-result', { taskId: task.id, ignored: true, reason: '当前官方页搜索ID与点击任务不一致，未消费任务', pageUrl: window.location.href });
        }
        return;
      }
      const result = await clickHideout(task);
      if (result.clicked) lastClickedTaskId = task.id;
      setStatus(result.reason, result.clicked ? 'ok' : 'err');
      await requestJson('POST', '/api/click-result', { taskId: task.id, ...result });
    } catch (err) {
      setStatus(`连接本地服务失败：${err.message || err}`, 'err');
      console.warn('[POE2 hideout click helper]', err);
    } finally {
      busy = false;
    }
  }

  console.info('[POE2 hideout click helper] v1.4 已启动。会显示右下角状态；只点击真正的“前往藏身处”按钮，不会购买物品。');
  setStatus('脚本已启动，正在连接本地服务……');
  setInterval(pollTask, POLL_MS);
  setTimeout(pollTask, 500);
}());
