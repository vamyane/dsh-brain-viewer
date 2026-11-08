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
