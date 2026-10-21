/**
 * dsh-brain 浏览器半边（模板）。
 * build.mjs 会把 gzip+base64 的 brain.html 塞进 APP_GZIP_B64，打开面板时才解压成 Blob。
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
    var appHtmlPromise = null;

    /** 懒解压：只有第一次打开面板时才把 gzip 解开成 HTML。 */
    function loadAppHtml() {
      if (appHtmlPromise !== null) return appHtmlPromise;
      appHtmlPromise = new Promise(function (resolve, reject) {
        try {
          var bin = atob(APP_GZIP_B64);
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
      return appHtmlPromise;
    }

    var NS = "dsh-brain-viewer";
    var MESSAGES = {
      zh: {
        "app.name": "AI 大脑",
        "panel.title": "🧠 AI 大脑 · 关系图谱",
        "panel.hint": "关系图谱：悬停高亮、拖拽回弹、神经放电",
        "panel.close": "关闭",
        "panel.popout": "新窗口打开",
        "panel.loading": "正在解压图谱…",
        "panel.error": "图谱加载失败，刷新页面重试",
      },
      en: {
        "app.name": "AI Brain",
        "panel.title": "🧠 AI Brain · Relationship Graph",
        "panel.hint": "Relationship graph: hover, drag, synapse pulses",
        "panel.close": "Close",
        "panel.popout": "Open in new window",
        "panel.loading": "Unpacking graph…",
        "panel.error": "Failed to load the graph. Refresh and retry.",
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
      var state = react.useState({ status: "idle", url: null });
      var view = state[0];
      var setView = state[1];

      react.useEffect(function () {
        if (!open || view.status !== "idle") return;
        setView({ status: "loading", url: null });
        loadAppHtml().then(
          function (html) {
            var blob = new Blob([html], { type: "text/html;charset=utf-8" });
            setView({ status: "ready", url: URL.createObjectURL(blob) });
          },
          function () {
            setView({ status: "error", url: null });
          }
        );
      }, [open, view.status]);

      react.useEffect(function () {
        if (!open) return undefined;
        var onKey = function (ev) {
          if (ev.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [open]);

      if (!open) return null;

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
        react.createElement("span", { style: { fontSize: "12px", color: "#8b93a7", flex: "1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, t("panel.hint")),
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
            },
          },
          view.status === "error" ? t("panel.error") : t("panel.loading")
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
