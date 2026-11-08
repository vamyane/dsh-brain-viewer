/**
 * dsh-brain 浏览器半边（模板）。
 * build.mjs 会把两段 gzip+base64 塞进来：
 *   - APP_GZIP_B64   : app/viewer.html（不含数据）
 *   - GRAPH_GZIP_B64 : brain/graph.json（构建时的数据快照，作为 fallback）
 *
 * 打开面板时在「页面上下文」里 fetch /api/dsh-brain/graph（同源、带登录态），
 * 拿到最新数据后注入 viewer.html，再交给 iframe 渲染；
 * 宿主路由不可用（未注册 / 400 / 401）时自动退回快照，保证面板一定能打开。
 *
 * v0.4.0 起面板 header 多一条「复盘入库」工具条：
 *   GET  /api/dsh-brain/ingest/status → 今天已入库 N 条 / 最近记忆日期 / 可见会话数
 *   POST /api/dsh-brain/ingest/run    → 扫描今天的 DSH 会话，写 episode 记忆并重建图谱
 * 同样在「页面上下文」fetch，iframe 里不发任何 /api 请求。
 *
 * 两个槽位：
 *  - sidebar.footer.action：左侧栏底部的「🧠 AI 大脑」按钮
 *  - shell.overlay：点开后盖在整页上的全屏面板，里面用 iframe(Blob URL) 载入图谱
 */
window.__ModuleLoader__.load({
  id: "dsh-brain-viewer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    var APP_GZIP_B64 = __BRAIN_GZIP_B64__;
    var GRAPH_GZIP_B64 = __GRAPH_GZIP_B64__;
    var viewerHtmlPromise = null;

    /** 相对路径：在页面上下文里 fetch，天然带登录态；iframe 里不再发请求。 */
    function graphApiUrl() {
      return "/api/dsh-brain/graph";
    }

    function ingestStatusUrl() {
      return "/api/dsh-brain/ingest/status";
    }

    function ingestRunUrl() {
      return "/api/dsh-brain/ingest/run";
    }

    /** 统一取 JSON：非 2xx 也要把宿主返回的 error/hint 带出来给用户看。 */
    function fetchJson(url, init) {
      var options = { cache: "no-store", credentials: "same-origin" };
      if (init) {
        for (var key in init) {
          if (Object.prototype.hasOwnProperty.call(init, key)) options[key] = init[key];
        }
      }
      return fetch(url, options).then(function (response) {
        return response.text().then(function (text) {
          var data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch (error) {
            data = { error: "返回不是 JSON：" + text.slice(0, 120) };
          }
          if (!data || typeof data !== "object") data = { error: "宿主返回了空数据" };
          if (!response.ok && !data.error) data.error = "HTTP " + response.status;
          return data;
        });
      });
    }

    function loadIngestStatus() {
      return fetchJson(ingestStatusUrl());
    }

    function runIngest() {
      return fetchJson(ingestRunUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
    }

    function fillTemplate(template, values) {
      return String(template).replace(/\{(\w+)\}/g, function (match, key) {
        return values && values[key] !== undefined && values[key] !== null ? String(values[key]) : "—";
      });
    }

    function decodeGzip(b64) {
      return new Promise(function (resolve, reject) {
        try {
          var bin = atob(b64);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          if (typeof DecompressionStream === "undefined") {
            reject(new Error("当前浏览器不支持 DecompressionStream"));
            return;
          }
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
          new Response(stream).text().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    }

    /** viewer.html 只解压一次；数据每次打开都重新拿。 */
    function loadViewerHtml() {
      if (viewerHtmlPromise !== null) return viewerHtmlPromise;
      viewerHtmlPromise = decodeGzip(APP_GZIP_B64);
      return viewerHtmlPromise;
    }

    function parseGraph(text) {
      var data = JSON.parse(text);
      if (!data || !data.nodes || !data.nodes.length) throw new Error("图谱数据为空");
      return data;
    }

    /** 先请求宿主路由拿实时数据，失败则退回构建时快照。 */
    function loadGraphText() {
      return fetch(graphApiUrl(), { cache: "no-store", credentials: "same-origin" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.text();
        })
        .then(function (text) {
          parseGraph(text);
          return { text: text, source: "api" };
        })
        .catch(function (liveError) {
          return decodeGzip(GRAPH_GZIP_B64).then(function (text) {
            try {
              parseGraph(text);
            } catch (snapshotError) {
              throw liveError;
            }
            return { text: text, source: "snapshot" };
          });
        });
    }

    /** 组装最终 HTML：把数据与 API 地址注入 viewer 的 bootstrap 占位符。 */
    function loadPanelHtml() {
      return Promise.all([loadViewerHtml(), loadGraphText()]).then(function (results) {
        var html = results[0];
        var graph = results[1];
        if (html.indexOf("/*__BRAIN_API_BOOTSTRAP__*/") < 0) {
          throw new Error("viewer 模板缺少 bootstrap 注入点");
        }
        var safe = graph.text
          .replace(/<\//g, "<\\/")
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029");
        var bootstrap = "window.__BRAIN_DATA__ = " + safe + ";\n" +
          "window.__BRAIN_API__ = " + JSON.stringify(graphApiUrl()) + ";\n" +
          "window.__BRAIN_SOURCE__ = " + JSON.stringify(graph.source) + ";";
        return { html: html.replace("/*__BRAIN_API_BOOTSTRAP__*/", bootstrap), source: graph.source };
      });
    }

    var NS = "dsh-brain-viewer";
    var MESSAGES = {
      zh: {
        "app.name": "AI 大脑",
        "panel.title": "🧠 AI 大脑 · 关系图谱",
        "panel.hint": "关系图谱：悬停高亮、拖拽回弹、神经放电",
        "panel.close": "关闭",
        "panel.refresh": "刷新数据",
        "panel.popout": "新窗口打开",
        "panel.loading": "正在加载图谱…",
        "panel.error": "图谱加载失败",
        "panel.live": "实时",
        "panel.snapshot": "快照",
        "ingest.label": "复盘入库",
        "ingest.tip": "把今天的 DSH 会话压缩成 episode 记忆写进 vault，并重建图谱",
        "ingest.button": "复盘入库",
        "ingest.busy": "入库中…",
        "ingest.loading": "读取入库状态…",
        "ingest.status": "今天已入库 {count} 条 · 最近记忆 {latest} · 可见会话 {sessions}",
        "ingest.statusNoIngest": "今天已入库 0 条 · 最近记忆 {latest} · 可见会话 {sessions}",
        "ingest.result": "写入 {written} 条 · 更新 {updated} · 跳过 {skipped} · 节点 {nodes}",
        "ingest.resultDry": "预览：将写入 {written} 条 · 更新 {updated}",
        "ingest.empty": "今天没有可入库的会话",
        "ingest.unconfigured": "未配置真实 vault，自动入库不可用",
        "ingest.statusFailed": "入库状态读取失败",
        "ingest.failed": "复盘入库失败",
        "ingest.rebuildFailed": "笔记已写入，但图谱重建失败",
      },
      en: {
        "app.name": "AI Brain",
        "panel.title": "🧠 AI Brain · Relationship Graph",
        "panel.hint": "Relationship graph: hover, drag, synapse pulses",
        "panel.close": "Close",
        "panel.refresh": "Refresh data",
        "panel.popout": "Open in new window",
        "panel.loading": "Loading graph…",
        "panel.error": "Failed to load the graph",
        "panel.live": "live",
        "panel.snapshot": "snapshot",
        "ingest.label": "Session ingest",
        "ingest.tip": "Compress today's DSH sessions into an episode memory in the vault and rebuild the graph",
        "ingest.button": "Session ingest",
        "ingest.busy": "Ingesting…",
        "ingest.loading": "Reading ingest status…",
        "ingest.status": "{count} ingested today · latest {latest} · {sessions} sessions visible",
        "ingest.statusNoIngest": "{count} ingested today · latest {latest} · {sessions} sessions visible",
        "ingest.result": "Wrote {written} · updated {updated} · skipped {skipped} · nodes {nodes}",
        "ingest.resultDry": "Preview: would write {written} · update {updated}",
        "ingest.empty": "No sessions to ingest today",
        "ingest.unconfigured": "No real vault configured; auto-ingest is unavailable",
        "ingest.statusFailed": "Failed to read ingest status",
        "ingest.failed": "Session ingest failed",
        "ingest.rebuildFailed": "Notes were written, but the graph rebuild failed",
      },
    };

    function translateFactory(locale) {
      if (locale !== undefined && locale !== null && typeof locale.bind === "function") {
        try {
          return locale.bind(NS);
        } catch (error) {
          /* fallback below */
        }
      }
      return function (key) {
        return (MESSAGES.zh[key] !== undefined ? MESSAGES.zh[key] : key);
      };
    }

    /* ---------------- 开合状态 ---------------- */
    var store = { open: false };
    var listeners = new Set();
    var getOpen = function () { return store.open; };
    var subscribe = function (cb) {
      listeners.add(cb);
      return function () { listeners.delete(cb); };
    };
    var setOpen = function (v) {
      if (store.open !== v) {
        store.open = v;
        listeners.forEach(function (cb) { cb(); });
      }
    };
    var useOpen = function () { return react.useSyncExternalStore(subscribe, getOpen); };

    /* ---------------- 全屏面板 ---------------- */
    function BrainPanel(props) {
      var t = props.t;
      var open = useOpen();
      var state = react.useState({ status: "idle", url: null, error: "", source: "" });
      var view = state[0];
      var setView = state[1];
      var reloadState = react.useState(0);
      var reload = reloadState[0];
      var setReload = reloadState[1];

      /* ---------- 复盘入库（v0.4.0）：状态与动作都在页面上下文里 fetch ---------- */
      var ingestState = react.useState({ phase: "idle", info: null, message: "", error: "" });
      var ingest = ingestState[0];
      var setIngest = ingestState[1];

      function applyIngestStatus(info) {
        if (!info) {
          setIngest({ phase: "error", info: null, message: "", error: t("ingest.statusFailed") });
          return;
        }
        if (info.ok === false) {
          setIngest({ phase: "ready", info: info, message: "", error: info.hint || info.error || t("ingest.unconfigured") });
          return;
        }
        setIngest({ phase: "ready", info: info, message: "", error: "" });
      }

      function refreshIngestStatus() {
        setIngest(function (previous) {
          return {
            phase: "loading",
            info: previous && previous.info,
            message: previous && previous.message,
            error: previous && previous.error,
          };
        });
        loadIngestStatus().then(applyIngestStatus, function (error) {
          setIngest({
            phase: "error",
            info: null,
            message: "",
            error: t("ingest.statusFailed") + "：" + String(error && error.message ? error.message : error),
          });
        });
      }

      function startIngest() {
        setIngest(function (previous) {
          return { phase: "running", info: previous && previous.info, message: "", error: "" };
        });
        runIngest().then(
          function (result) {
            if (!result || result.ok !== true) {
              setIngest(function (previous) {
                return {
                  phase: "ready",
                  info: previous && previous.info,
                  message: "",
                  error: (result && (result.hint || result.error)) || t("ingest.failed"),
                };
              });
              return;
            }
            var nodes = result.nodes === undefined || result.nodes === null ? "—" : result.nodes;
            var message = fillTemplate(result.dryRun ? t("ingest.resultDry") : t("ingest.result"), {
              written: result.written || 0,
              updated: result.updated || 0,
              skipped: result.skipped || 0,
              nodes: nodes,
            });
            if (result.written === 0 && result.updated === 0 && result.skipped === 0) message = t("ingest.empty");
            if (result.graph && result.graph.ok === false) message += " · " + t("ingest.rebuildFailed");
            setIngest({ phase: "done", info: null, message: message, error: "" });
            if ((result.written || 0) + (result.updated || 0) > 0) {
              setReload(function (value) { return value + 1; });
            }
            loadIngestStatus().then(function (info) {
              setIngest(function (previous) {
                return {
                  phase: "done",
                  info: info && info.ok ? info : previous && previous.info,
                  message: previous && previous.message,
                  error: previous && previous.error,
                };
              });
            });
          },
          function (error) {
            setIngest(function (previous) {
              return {
                phase: "ready",
                info: previous && previous.info,
                message: "",
                error: t("ingest.failed") + "：" + String(error && error.message ? error.message : error),
              };
            });
          }
        );
      }

      react.useEffect(function () {
        if (!open) return undefined;
        refreshIngestStatus();
        return undefined;
      }, [open]);

      react.useEffect(function () {
        if (!open) return undefined;
        var cancelled = false;
        setView(function (previous) {
          if (previous && previous.url) URL.revokeObjectURL(previous.url);
          return { status: "loading", url: null, error: "", source: "" };
        });
        loadPanelHtml().then(
          function (result) {
            if (cancelled) return;
            var blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
            setView({ status: "ready", url: URL.createObjectURL(blob), error: "", source: result.source });
          },
          function (error) {
            if (cancelled) return;
            setView({
              status: "error",
              url: null,
              error: String(error && error.message ? error.message : error),
              source: "",
            });
          }
        );
        return function () { cancelled = true; };
      }, [open, reload]);

      react.useEffect(function () {
        if (!open) return undefined;
        var onKey = function (ev) {
          if (ev.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [open]);

      if (!open) return null;

      var hint = t("panel.hint");
      if (view.source === "api") hint += " · " + t("panel.live");
      else if (view.source === "snapshot") hint += " · " + t("panel.snapshot");

      var ingestInfo = ingest.info;
      var ingestStatusText;
      if (ingest.phase === "idle" || ingest.phase === "loading") {
        ingestStatusText = t("ingest.loading");
      } else if (ingestInfo && ingestInfo.ok === true) {
        ingestStatusText = fillTemplate(t("ingest.status"), {
          count: ingestInfo.todayIngested || 0,
          latest: ingestInfo.latestMemoryDate || "—",
          sessions: ingestInfo.visibleSessions === undefined || ingestInfo.visibleSessions === null ? "—" : ingestInfo.visibleSessions,
        });
      } else if (ingest.phase === "error") {
        ingestStatusText = t("ingest.statusFailed");
      } else {
        ingestStatusText = t("ingest.unconfigured");
      }

      var ingestBusy = ingest.phase === "running" || ingest.phase === "loading";
      var toolbar = react.createElement(
        "div",
        {
          style: {
            display: "flex", alignItems: "center", gap: "12px",
            padding: "6px 16px", background: "#0d1420",
            borderBottom: "1px solid #1c2434", flex: "none",
            fontSize: "12px", color: "#8b93a7",
          },
        },
        react.createElement("span", { style: { color: "#93c5fd", fontWeight: 600, whiteSpace: "nowrap" } }, "📥 " + t("ingest.label")),
        react.createElement(
          "span",
          {
            title: ingestStatusText,
            style: { flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
          },
          ingestStatusText
        ),
        ingest.error
          ? react.createElement(
              "span",
              {
                title: ingest.error,
                style: { color: "#f87171", maxWidth: "46%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              },
              ingest.error
            )
          : null,
        ingest.message ? react.createElement("span", { style: { color: "#86efac", whiteSpace: "nowrap" } }, ingest.message) : null,
        react.createElement(
          "button",
          {
            onClick: startIngest,
            disabled: ingestBusy || (ingestInfo && ingestInfo.ok === false),
            title: t("ingest.tip"),
            style: {
              background: ingestBusy ? "#334155" : "#1e3a5f",
              border: "1px solid #2e4a6b", borderRadius: "8px",
              color: "#dbeafe", fontSize: "12px",
              cursor: ingestBusy ? "wait" : "pointer",
              padding: "4px 10px", whiteSpace: "nowrap",
            },
          },
          ingestBusy ? t("ingest.busy") : t("ingest.button")
        )
      );

      var header = react.createElement(
        "div",
        {
          style: {
            display: "flex", alignItems: "center", gap: "12px",
            padding: "10px 16px", background: "#111827",
            borderBottom: "1px solid #222a3a", flex: "none",
          },
        },
        react.createElement("span", { style: { fontSize: "15px", fontWeight: 600, color: "#e6e0d4" } }, t("panel.title")),
        react.createElement("span", { style: { fontSize: "12px", color: "#8b93a7", flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, hint),
        react.createElement("button", {
          onClick: function () { setReload(function (value) { return value + 1; }); },
          title: t("panel.refresh"),
          style: {
            background: "transparent", border: "1px solid #2e384b", borderRadius: "8px",
            color: "#b8b2a6", fontSize: "12px", cursor: "pointer", padding: "4px 8px",
          },
        }, "↻"),
        view.url !== null
          ? react.createElement("a", {
              href: view.url, target: "_blank", rel: "noreferrer",
              style: { fontSize: "12px", color: "#93c5fd", textDecoration: "none", padding: "4px 8px" },
            }, t("panel.popout"))
          : null,
        react.createElement("button", {
          onClick: function () { setOpen(false); },
          title: t("panel.close"),
          style: {
            background: "transparent", border: "none", color: "#8f8a97",
            fontSize: "16px", cursor: "pointer", padding: "4px 10px", borderRadius: "8px",
          },
        }, "✕")
      );

      var body;
      if (view.status === "ready") {
        body = react.createElement("iframe", {
          title: "dsh-brain",
          src: view.url,
          style: { flex: "1", border: "none", width: "100%", background: "#0a101d" },
        });
      } else {
        body = react.createElement(
          "div",
          {
            style: {
              flex: "1", display: "flex", alignItems: "center", justifyContent: "center",
              color: view.status === "error" ? "#f87171" : "#8b93a7", fontSize: "13px",
              padding: "0 24px", textAlign: "center",
            },
          },
          view.status === "error" ? t("panel.error") + (view.error ? "：" + view.error : "") : t("panel.loading")
        );
      }

      return react.createElement(
        "div",
        {
          role: "dialog",
          "aria-label": t("panel.title"),
          onClick: function (ev) { if (ev.target === ev.currentTarget) setOpen(false); },
          style: {
            position: "fixed", inset: "0", zIndex: 99999, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(8,11,20,.62)",
          },
        },
        react.createElement(
          "div",
          {
            style: {
              width: "min(1400px, 96vw)", height: "90vh", background: "#0a101d",
              borderRadius: "16px", display: "flex", flexDirection: "column",
              overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,.55)",
              border: "1px solid #222a3a",
            },
          },
          header,
          toolbar,
          body
        )
      );
    }

    /* ---------------- 左侧栏底部按钮 ---------------- */
    function BrainToggle(props) {
      var t = props.t;
      var open = useOpen();
      var showLabel = props.wide !== false;
      return react.createElement(
        "button",
        {
          onClick: function () { setOpen(!open); },
          title: t("panel.hint"),
          style: {
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            gap: "6px", cursor: "pointer", border: "1px solid #2e384b",
            borderRadius: "999px", background: open ? "#7c2d12" : "transparent",
            color: open ? "#fff" : "#b8b2a6", padding: "6px 10px", fontSize: "13px",
            maxWidth: "100%", overflow: "hidden",
          },
        },
        react.createElement("span", { style: { fontSize: "15px", lineHeight: 1 } }, "🧠"),
        showLabel
          ? react.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t("app.name"))
          : null
      );
    }

    /* ---------------- 插件入口 ---------------- */
    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined || slots === null) return;
      var locale = ctx.get("locale");
      var t = translateFactory(locale);

      if (locale !== undefined && locale !== null && typeof locale.register === "function") {
        ctx.effect(function () {
          return locale.register(NS, MESSAGES);
        }, "dsh-brain: locale dictionaries");
      }

      slots.inject("shell.overlay", function () {
        return slots.register(
          { name: "shell.overlay", id: "dsh-brain.panel", order: 20, locale: NS },
          function (props) {
            return react.createElement(BrainPanel, { t: (props && props.t) || t });
          }
        );
      });

      slots.inject("sidebar.footer.action", function () {
        return slots.register(
          { name: "sidebar.footer.action", id: "dsh-brain.toggle", order: 10, label: function () { return t("app.name"); }, locale: NS },
          function (props) {
            return react.createElement(BrainToggle, { t: (props && props.t) || t, wide: props && props.wide });
          }
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  },
});
