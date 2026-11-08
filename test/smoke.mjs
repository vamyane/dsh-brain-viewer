#!/usr/bin/env node
/**
 * 离线冒烟：桩件加载 lib/client.js，验证
 *   - viewer.html 与 graph.json 两段 gzip 都能解开
 *   - 两个槽位注册成功、组件可渲染
 *   - 宿主半边可导入，三条路由都注册上（graph / ingest status / ingest run）
 *   - Brain Ingest 纯函数：多帧 zstd 解码、启发式解析、笔记生成、dryRun 不落盘
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

// --- 4. client.js 里带上了复盘入库的取数逻辑 ---
if (code.includes("/api/dsh-brain/ingest/status") && code.includes("/api/dsh-brain/ingest/run") && code.includes("ingest.tip")) {
  ok("client.js 含复盘入库状态/运行接口与文案");
} else {
  fail("client.js 复盘入库接口");
}

// --- 5. Brain Ingest 纯函数（多帧 zstd / 解析 / 笔记生成） ---
const ingestTmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-brain-smoke-"));
const pluginRoot = path.join(here, "..");
let hostMod = null;
try {
  const ingest = await import(url.pathToFileURL(path.join(pluginRoot, "lib", "ingest.js")));
  const sid = "session-smoke0001";
  const now = Date.now();
  const events = [
    { type: "session", version: 4, id: sid, createdAt: now - 600_000, cwd: pluginRoot },
    { type: "turn/start", time: now - 590_000, data: { turn: 1 } },
    {
      type: "user/message",
      time: now - 580_000,
      data: { content: [{ type: "text", text: "跑一遍冒烟，确认会话复盘入库不会写重复笔记。" }], source: { kind: "user" } },
    },
    {
      type: "assistant/message",
      time: now - 570_000,
      data: { message: { content: [{ type: "reasoning", text: "内部推理" }, { type: "text", text: "冒烟通过：解析、写笔记、幂等都没问题。" }] } },
    },
    { type: "tool/call", time: now - 560_000, data: { name: "read" } },
    { type: "turn/end", time: now - 550_000, data: { turn: 1, reason: { kind: "completed" } } },
  ];
  const sessionFile = path.join(ingestTmp, "sessions", "--smoke--", sid, "session.v4.jsonl.zstd");
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, Buffer.concat(events.map((item) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(item) + "\n", "utf8")))));

  const raw = fs.readFileSync(sessionFile);
  if (ingest.splitZstdFrames(raw).length === events.length) ok(`多帧 zstd 解码（${events.length} 帧）`);
  else fail("多帧 zstd 帧数", String(ingest.splitZstdFrames(raw).length));

  const parsed = ingest.parseSessionLog(ingest.decodeSessionText(raw));
  const parsedOk =
    parsed.header.id === sid &&
    parsed.userTexts.length === 1 &&
    parsed.toolCalls === 1 &&
    parsed.assistantFinalText.startsWith("冒烟通过") &&
    parsed.turns === 1;
  if (parsedOk) ok("会话启发式解析（意图/工具/最终结论/轮数）");
  else fail("会话解析", JSON.stringify({ user: parsed.userTexts.length, tools: parsed.toolCalls, final: parsed.assistantFinalText }));

  const vaultTitles = ingest.scanVaultInfo(path.join(pluginRoot, "brain", "vault")).titles;
  const links = ingest.pickLinks(vaultTitles, { limit: 2 });
  const note = ingest.buildEpisodeNote(parsed, {
    date: ingest.localDate(Date.now()),
    sessionId: sid,
    slug: "--smoke--",
    cwd: pluginRoot,
    links,
  });
  const noteOk =
    links.length >= 2 &&
    note.content.includes(`source: ${ingest.INGEST_SOURCE}`) &&
    note.content.includes(`session: ${sid}`) &&
    note.relPath.startsWith("episodes/") &&
    (note.content.match(/\[\[[^\]]+\]\]/g) || []).length === links.length;
  if (noteOk) ok(`episode 笔记生成（${links.length} 条双链，文件名 ${note.relPath.split("/").pop()}）`);
  else fail("episode 笔记生成", JSON.stringify({ links, relPath: note.relPath }));

  // --- 6. 宿主路由层：三条路由注册 + status/run(dryRun)/graph 返回 ---
  const home = path.join(ingestTmp, "home");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, "brain-viewer.config.json"),
    JSON.stringify({ graphPath: path.join(pluginRoot, "brain", "graph.json"), sessionsPath: path.join(ingestTmp, "sessions") }),
    "utf8"
  );
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    hostMod = await import(url.pathToFileURL(path.join(pluginRoot, "lib", "index.js")));
    const routes = [];
    hostMod.apply({
      connection: { fetch: { register(route) { routes.push(route); return () => {}; } } },
      effect(fn) { const disposer = fn(); return () => { if (typeof disposer === "function") disposer(); }; },
    });
    const byPath = (routePath) => routes.find((route) => route.path === routePath);
    const routeShapeOk =
      routes.length === 3 &&
      byPath("/api/dsh-brain/graph")?.methods?.[0] === "GET" &&
      byPath("/api/dsh-brain/ingest/status")?.methods?.[0] === "GET" &&
      byPath("/api/dsh-brain/ingest/run")?.methods?.[0] === "POST" &&
      byPath("/api/dsh-brain/ingest/run")?.requestBody === "buffered";
    if (routeShapeOk) ok("宿主注册 3 条路由（graph / status / run POST buffered）");
    else fail("宿主路由注册", routes.map((route) => `${route.methods}:${route.path}`).join(","));

    const statusResponse = await byPath("/api/dsh-brain/ingest/status").fetch(new Request("http://local/api/dsh-brain/ingest/status"));
    const statusJson = await statusResponse.json();
    const statusOk =
      statusResponse.status === 200 &&
      statusJson.ok === true &&
      statusJson.visibleSessions === 1 &&
      statusJson.todayIngested === 0 &&
      typeof statusJson.latestMemoryDate === "string" &&
      statusJson.latestMemoryDate.length === 10;
    if (statusOk) ok(`status 路由（可见会话 ${statusJson.visibleSessions} / 最近记忆 ${statusJson.latestMemoryDate}）`);
    else fail("status 路由", JSON.stringify(statusJson).slice(0, 300));

    const runResponse = await byPath("/api/dsh-brain/ingest/run").fetch(
      new Request("http://local/api/dsh-brain/ingest/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      })
    );
    const runJson = await runResponse.json();
    const runOk =
      runResponse.status === 200 &&
      runJson.ok === true &&
      runJson.dryRun === true &&
      runJson.written === 1 &&
      runJson.notes.some((item) => item.status === "would-write");
    if (runOk) ok("POST run 路由 dryRun（预览写入 1 条，不落盘）");
    else fail("POST run 路由", JSON.stringify(runJson).slice(0, 400));

    const afterStatus = ingest.getIngestStatus({ home });
    if (afterStatus.todayIngested === 0) ok("dryRun 没有写任何笔记");
    else fail("dryRun 落盘", `todayIngested=${afterStatus.todayIngested}`);

    const graphResponse = await byPath("/api/dsh-brain/graph").fetch(new Request("http://local/api/dsh-brain/graph"));
    const graphJson = await graphResponse.json();
    if (graphResponse.status === 200 && Array.isArray(graphJson.nodes) && graphJson.nodes.length > 0) {
      ok(`graph 路由仍正常（${graphJson.nodes.length} 节点）`);
    } else {
      fail("graph 路由", String(graphResponse.status));
    }

    const bareHome = path.join(ingestTmp, "bare-home");
    fs.mkdirSync(bareHome, { recursive: true });
    process.env.DSH_HOME = bareHome;
    const bareResponse = await byPath("/api/dsh-brain/ingest/status").fetch(new Request("http://local/api/dsh-brain/ingest/status"));
    const bareJson = await bareResponse.json();
    if (bareJson.ok === false && bareJson.configured === false && typeof bareJson.hint === "string") {
      ok("未配置 vault 时 status 给配置提示（拒绝写入演示库）");
    } else {
      fail("未配置 vault 的 status", JSON.stringify(bareJson).slice(0, 300));
    }
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
  }
} catch (error) {
  fail("Brain Ingest 冒烟", error.message);
} finally {
  fs.rmSync(ingestTmp, { recursive: true, force: true });
}

console.log("");
if (errors.length) { console.log(`FAILED: ${errors.join("; ")}`); process.exit(1); }
console.log("SMOKE OK");
