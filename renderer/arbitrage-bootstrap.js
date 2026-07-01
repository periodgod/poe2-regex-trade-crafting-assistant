"use strict";

(() => {
  "use strict";

  const APP_VERSION = "1.7.7";
  const statusBox = document.getElementById("runtimeStatus");
  const statusTitle = document.getElementById("runtimeStatusTitle");
  const statusDetail = document.getElementById("runtimeStatusDetail");
  const diagnosticPanel = document.getElementById("runtimeDiagnosticPanel");
  const diagnosticText = document.getElementById("runtimeDiagnosticText");

  let rootFailure = null;
  let bootPromise = null;
  let lastDiagnostics = null;

  function errorText(error) {
    if (!error) return "未知错误";
    if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
    if (typeof error === "string") return error;
    try {
      return JSON.stringify(error, null, 2);
    } catch (_jsonError) {
      return String(error);
    }
  }

  function shortError(error) {
    const text = errorText(error).trim();
    return text.split(/\r?\n/)[0] || "未知错误";
  }

  function setRuntimeStatus(state, title, detail) {
    if (statusBox) statusBox.dataset.state = state;
    if (statusTitle) statusTitle.textContent = title;
    if (statusDetail) statusDetail.textContent = detail || "";
  }

  function setDiagnosticText(text) {
    if (!diagnosticPanel || !diagnosticText) return;
    diagnosticText.textContent = text || "";
    diagnosticPanel.hidden = !text;
  }

  function buildDiagnosticReport(extra = {}) {
    const controller = window.POE2ArbitrageApp;
    const lines = [
      `POE2 兑换助手 v${APP_VERSION}`,
      `时间：${new Date().toISOString()}`,
      `页面：${location.href}`,
      `document.readyState：${document.readyState}`,
      `控制器对象：${controller ? "存在" : "不存在"}`,
      `boot 函数：${typeof controller?.boot}`,
      `isReady：${Boolean(controller?.isReady?.())}`,
      `User-Agent：${navigator.userAgent}`,
      `单文件入口版本：${window.__POE2_ARBITRAGE_ENTRY_VERSION__ || '未记录'}`,
      `控制器加载时间：${window.__POE2_ARBITRAGE_CONTROLLER_LOADED_AT__ || '未记录'}`,
      `入口捕获错误：${window.__POE2_ARBITRAGE_ENTRY_ERROR__ ? shortError(window.__POE2_ARBITRAGE_ENTRY_ERROR__) : '无'}`
    ];

    if (rootFailure) {
      lines.push(`失败阶段：${rootFailure.stage}`);
      lines.push(`首个错误：${rootFailure.message}`);
      if (rootFailure.stack && rootFailure.stack !== rootFailure.message) {
        lines.push("错误堆栈：");
        lines.push(rootFailure.stack);
      }
    }

    if (lastDiagnostics?.logPath) lines.push(`日志文件：${lastDiagnostics.logPath}`);
    if (lastDiagnostics?.electron) lines.push(`Electron：${lastDiagnostics.electron}`);
    if (lastDiagnostics?.chrome) lines.push(`Chrome：${lastDiagnostics.chrome}`);
    if (lastDiagnostics?.node) lines.push(`Node：${lastDiagnostics.node}`);
    if (lastDiagnostics?.platform) lines.push(`平台：${lastDiagnostics.platform}`);

    for (const [key, value] of Object.entries(extra)) {
      lines.push(`${key}：${typeof value === "string" ? value : errorText(value)}`);
    }
    return lines.join("\n");
  }

  async function reportFailure(stage, error, extra = {}) {
    const stack = errorText(error);
    const failure = {
      stage,
      message: shortError(error),
      stack,
      time: new Date().toISOString()
    };
    if (!rootFailure) rootFailure = failure;

    try {
      if (window.desktopApi?.reportRuntimeDiagnostic) {
        await window.desktopApi.reportRuntimeDiagnostic({
          level: "error",
          scope: `arbitrage:${stage}`,
          message: failure.message,
          detail: buildDiagnosticReport(extra)
        });
      }
    } catch (_reportError) {
      // 页面诊断不能因为日志 IPC 失败而再次崩溃。
    }

    try {
      if (window.desktopApi?.getRuntimeDiagnostics) {
        lastDiagnostics = await window.desktopApi.getRuntimeDiagnostics();
      }
    } catch (_diagnosticsError) {
      lastDiagnostics = null;
    }

    const report = buildDiagnosticReport(extra);
    setDiagnosticText(report);
    return report;
  }

  window.__setArbitrageRuntimeStatus = setRuntimeStatus;

  // 即使主控制器没有成功加载，按钮没有被静默忽略：所有普通业务按钮都必须给出明确反馈。
  document.addEventListener("click", event => {
    const button = event.target.closest?.("button[data-action]");
    if (!button) return;
    if (window.POE2ArbitrageApp?.isReady?.()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (rootFailure) {
      setRuntimeStatus(
        "error",
        "兑换助手初始化失败",
        `${rootFailure.stage}：${rootFailure.message} 下方诊断信息已保留，不会再被按钮点击覆盖。`
      );
      setDiagnosticText(buildDiagnosticReport());
      return;
    }

    setRuntimeStatus(
      "loading",
      "兑换计算模块仍在初始化",
      "页面已经收到点击，但控制器尚未完成初始化。请稍候，或点击“重新初始化”。"
    );
  }, true);

  window.addEventListener("error", event => {
    const message = event?.error || event?.message || "未知脚本错误";
    setRuntimeStatus("error", "兑换助手脚本发生错误", shortError(message));
    void reportFailure("window.error", message, {
      文件: event?.filename || "未知",
      行列: `${event?.lineno || 0}:${event?.colno || 0}`
    });
  });

  window.addEventListener("unhandledrejection", event => {
    const reason = event?.reason || "未知异步错误";
    setRuntimeStatus("error", "兑换助手出现未处理的异步错误", shortError(reason));
    void reportFailure("unhandledrejection", reason);
  });

  async function bootController(force = false) {
    if (bootPromise && !force) return bootPromise;
    if (force) {
      rootFailure = null;
      setDiagnosticText("");
    }

    bootPromise = (async () => {
      try {
        setRuntimeStatus("loading", "正在初始化兑换计算模块", "正在校验控制器、20 个兑换方向和按钮绑定。" );

        if (!window.POE2ArbitrageApp) {
          throw new Error(window.__POE2_ARBITRAGE_ENTRY_ERROR__ ? `兑换控制器执行失败：${shortError(window.__POE2_ARBITRAGE_ENTRY_ERROR__)}` : "兑换控制器没有执行：单文件入口中不存在 window.POE2ArbitrageApp。请打开 runtime.log 查看首个脚本错误。" );
        }
        if (typeof window.POE2ArbitrageApp.boot !== "function") {
          throw new Error("arbitrage.js 已出现，但没有导出 POE2ArbitrageApp.boot。文件可能不完整或与 HTML 版本不匹配。" );
        }

        const diagnostics = await window.POE2ArbitrageApp.boot();
        rootFailure = null;
        setDiagnosticText("");
        setRuntimeStatus(
          "ready",
          "兑换计算模块已就绪",
          `已校验 ${diagnostics.directionCount} 个兑换方向，绑定 ${diagnostics.staticButtonCount} 个固定按钮。`
        );
        return diagnostics;
      } catch (error) {
        setRuntimeStatus("error", "兑换助手初始化失败", shortError(error));
        await reportFailure("bootController", error, {
          controllerLoadedAt: window.__POE2_ARBITRAGE_CONTROLLER_LOADED_AT__ || "未记录",
          controllerVersion: window.__POE2_ARBITRAGE_CONTROLLER_VERSION__ || "未知"
        });
        console.error("兑换助手初始化失败", error);
        return null;
      } finally {
        bootPromise = null;
      }
    })();

    return bootPromise;
  }

  async function copyText(text) {
    if (window.desktopApi?.copyText) {
      await window.desktopApi.copyText(text);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.("button[data-diagnostic-action]");
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.diagnosticAction;

    void (async () => {
      try {
        if (action === "retry") {
          await bootController(true);
          return;
        }
        if (action === "copy") {
          const report = buildDiagnosticReport();
          await copyText(report);
          setRuntimeStatus("warning", "诊断信息已复制", "请把复制的内容发给我，首个错误和运行库版本都会保留。" );
          return;
        }
        if (action === "open-log") {
          if (!window.desktopApi?.openRuntimeLog) {
            throw new Error("当前不是带桌面诊断接口的 Electron 环境，无法自动打开日志文件。请先复制诊断信息。" );
          }
          const result = await window.desktopApi.openRuntimeLog();
          setRuntimeStatus("warning", "日志文件位置已打开", result?.logPath || "请在资源管理器中查看 runtime.log。" );
        }
      } catch (error) {
        setRuntimeStatus("error", "诊断操作失败", shortError(error));
        await reportFailure(`diagnostic:${action}`, error);
      }
    })();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void bootController(); }, { once: true });
  } else {
    void bootController();
  }
})();
