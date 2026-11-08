#!/usr/bin/env node
/**
 * 离线冒烟：桩件加载 lib/client.js，验证
 *   - viewer.html 与 graph.json 两段 gzip 都能解开
 *   - 两个槽位注册成功、组件可渲染
 *   - 宿主半边可导入
 */
import fs from "node:fs";
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

function grab(placeholderName) {
  const match = code.match(new RegExp(`var ${placeholderName} = "([^"]+)";`));
  return match ? match[1] : "";
}

// --- 1. viewer.html ---
const viewerB64 = grab("APP_GZIP_B64");
if (!viewerB64) {
  fail("viewer gzip 数据", "找不到 APP_GZIP_B64");
} else {
  try {
    const html = zlib.gunzipSync(Buffer.from(viewerB64, "base64")).toString("utf8");
    if (html.includes("<script") && html.includes("__BRAIN_API_BOOTSTRAP__")) {
      ok(`viewer.html 完整（${(html.length / 1024).toFixed(1)} KB，含 bootstrap 注入点）`);
    } else {
      fail("viewer.html 内容");
    }
  } catch (error) {
    fail("viewer.html 解压", error.message);
  }
}

// --- 2. graph.json 快照 ---
const graphB64 = grab("GRAPH_GZIP_B64");
if (!graphB64) {
  fail("graph gzip 数据", "找不到 GRAPH_GZIP_B64");
} else {
  try {
    const text = zlib.gunzipSync(Buffer.from(graphB64, "base64")).toString("utf8");
    const data = JSON.parse(text);
    if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
      ok(`graph.json 快照完整（${data.nodes.length} 节点 / ${data.edges.length} 连线）`);
    } else {
      fail("graph.json 结构");
    }
  } catch (error) {
    fail("graph.json 解压", error.message);
  }
}

// --- 3. 槽位注册 ---
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
const runner = new Function("window", "require", "Blob", "URL", "document", code);
runner(globalThis.window, requireStub, class Blob {}, { createObjectURL: () => "blob:test", revokeObjectURL() {} }, { addEventListener() {}, removeEventListener() {} });

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
  const names = registered.map((item) => item.options.name).sort();
  if (JSON.stringify(names) === JSON.stringify(["shell.overlay", "sidebar.footer.action"])) ok("注册 shell.overlay + sidebar.footer.action");
  else fail("槽位注册", JSON.stringify(names));
  for (const item of registered) {
    try { item.component({ t: (key) => key, wide: true }); ok(`组件可渲染：${item.options.id}`); }
    catch (error) { fail(`组件渲染：${item.options.id}`, error.message); }
  }
} catch (error) {
  fail("apply 执行", error.message);
}

try {
  const host = await import(url.pathToFileURL(path.join(here, "..", "lib", "index.js")));
  if (host.name === "dsh-brain-viewer" && typeof host.apply === "function") ok("宿主半边 index.js 可导入");
  else fail("宿主半边");
} catch (error) {
  fail("宿主半边导入", error.message);
}

console.log("");
if (errors.length) { console.log(`FAILED: ${errors.join("; ")}`); process.exit(1); }
console.log("SMOKE OK");
