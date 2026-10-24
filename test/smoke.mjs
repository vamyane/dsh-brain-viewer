#!/usr/bin/env node
/**
 * 离线冒烟：桩件加载 lib/client.js，验证 gzip 内嵌的 HTML 能解开、
 * 两个槽位注册成功、面板组件可渲染、宿主半边可导入。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const clientPath = path.join(here, "..", "lib", "client.js");
const code = fs.readFileSync(clientPath, "utf8");
const errors = [];
const ok = (name) => console.log(`  ✔ ${name}`);
const fail = (name, detail) => {
  errors.push(name);
  console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`client.js ${(code.length / 1024 / 1024).toFixed(2)} MB`);

// --- 1. gzip 内嵌 HTML 完整 ---
const match = code.match(/var APP_GZIP_B64 = "([^"]+)";/);
if (!match) {
  fail("gzip 数据", "找不到 APP_GZIP_B64");
} else {
  try {
    const html = zlib.gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
    if (html.includes("<!doctype html") && html.includes("关系图谱") && html.includes("</html>")) {
      ok(`gzip 内嵌 viewer.html 完整（解压后 ${(html.length / 1024 / 1024).toFixed(2)} MB）`);
    } else {
      fail("gzip 内嵌内容");
    }
    if (html.includes('"nodes":[{"t"')) fail("内嵌 HTML 不带图谱数据", "数据应该走宿主路由");
    else ok("内嵌 HTML 不含图谱数据（数据走 /api/dsh-brain/graph）");
    if (html.includes("/*__BRAIN_API_BOOTSTRAP__*/")) ok("保留 API 地址注入点");
    else fail("API 地址注入点");
  } catch (error) {
    fail("gzip 解压", error.message);
  }
}

// --- 2. 槽位注册 ---
let captured = null;
globalThis.window = { __ModuleLoader__: { load(info) { captured = info; } } };
const reactStub = {
  createElement(type, props, ...children) { return { type, props: props || {}, children }; },
  useState(initial) { return [initial, () => {}]; },
  useEffect() {},
  useSyncExternalStore(_sub, getSnapshot) { return getSnapshot(); },
};
const requireStub = (id) => {
  if (id === "react") return reactStub;
  throw new Error(`unexpected require: ${id}`);
};
const documentStub = {
  addEventListener() {},
  removeEventListener() {},
  createElement() { return { width: 0, height: 0, getContext() { return { createRadialGradient() { return { addColorStop() {} }; }, fillRect() {} }; } }; },
};
const runner = new Function("window", "require", "Blob", "URL", "document", code);
runner(globalThis.window, requireStub, class Blob {}, { createObjectURL: () => "blob:test" }, documentStub);

if (captured === null) fail("__ModuleLoader__.load 被调用");
else ok("__ModuleLoader__.load 被调用");
if (captured !== null && captured.id === "dsh-brain-viewer") ok("插件 id 正确");
else fail("插件 id", captured && captured.id);

let mod = null;
try {
  mod = captured.factory(requireStub);
  if (typeof mod.apply === "function" && Array.isArray(mod.inject)) ok("factory 返回 apply/inject");
  else fail("factory 返回值");
} catch (error) {
  fail("factory 执行", error.message);
}

const registered = [];
const slots = { inject(_name, factory) { factory(); }, register(options, component) { registered.push({ options, component }); } };
const locale = { register() { return () => {}; }, bind() { return (key) => key; } };
const ctx = { get(name) { return name === "slots" ? slots : name === "locale" ? locale : undefined; }, effect(fn) { const d = fn(); return () => { if (typeof d === "function") d(); }; } };
try {
  mod.apply(ctx);
  const names = registered.map((r) => r.options.name).sort();
  if (JSON.stringify(names) === JSON.stringify(["shell.overlay", "sidebar.footer.action"])) ok("注册 shell.overlay + sidebar.footer.action");
  else fail("槽位注册", JSON.stringify(names));
  for (const r of registered) {
    try { r.component({ t: (k) => k, wide: true }); ok(`组件可渲染：${r.options.id}`); }
    catch (error) { fail(`组件渲染：${r.options.id}`, error.message); }
  }
} catch (error) {
  fail("apply 执行", error.message);
}

let host = null;
try {
  host = await import(url.pathToFileURL(path.join(here, "..", "lib", "index.js")));
  if (host.name === "dsh-brain-viewer" && typeof host.apply === "function") ok("宿主半边 index.js 可导入");
  else fail("宿主半边");
} catch (error) {
  fail("宿主半边导入", error.message);
}

// --- 3. 实时图谱路由（隔离 DSH_HOME，读包内 brain/graph.json） ---
if (host !== null) {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "brain-smoke-"));
  const routes = [];
  const hostCtx = { connection: { fetch: { register(route) { routes.push(route); return () => {}; } } } };
  try {
    host.apply(hostCtx);
    const route = routes[0];
    if (routes.length === 1 && route.path === "/api/dsh-brain/graph" && route.methods.includes("GET")) {
      ok("注册实时图谱路由 /api/dsh-brain/graph");
      const res = await route.fetch();
      const data = JSON.parse(await res.text());
      if (res.status === 200 && Array.isArray(data.nodes) && data.nodes.length > 0) {
        ok(`路由返回图谱（${data.nodes.length} 节点 · ${data.edges.length} 连线）`);
      } else {
        fail("路由返回数据", `status ${res.status}`);
      }
    } else {
      fail("路由注册", JSON.stringify(routes.map((r) => r.path)));
    }
  } catch (error) {
    fail("路由测试", error.message);
  }
}

console.log("");
if (errors.length) { console.log(`FAILED: ${errors.join("; ")}`); process.exit(1); }
console.log("SMOKE OK");
