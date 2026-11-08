#!/usr/bin/env node
/**
 * 离线 E2E：把「会话自动复盘入库」整条链路跑一遍，全部在系统临时目录里的
 * vault 副本上做，**不碰真实 vault**。
 *
 * 覆盖：
 *   1. 多帧 zstd 会话解码（DSH v4 每次追加一帧）
 *   2. 启发式抽取：标题 / 用户意图 / 助手最终结论 / 工具统计
 *   3. status：今天已入库 0 条、最近记忆日期、可见会话数（排除子会话/范围外）
 *   4. run：写入 1 篇 episode → 调 python build_graph.py 重建 → 节点数 +1
 *   5. 幂等：第二次 run 不写不重复；同一 session 追加内容后原地更新
 *   6. 子会话 / 昨日会话 / 无用户文本会话被跳过；dryRun 不落盘
 *   7. 未配置真实 vault 时拒绝写入（不污染包内演示 vault）
 *
 * 用法：node test/ingest.e2e.mjs
 * 依赖：python 可用（可用 DSH_BRAIN_PYTHON 指定）；没有 python 时降级为「只测写入与幂等」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import url from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(here, "..");
const AI_BRAIN = path.join(PLUGIN_ROOT, "..");
const ingest = await import(url.pathToFileURL(path.join(PLUGIN_ROOT, "lib", "ingest.js")));

const errors = [];
const lines = [];
const ok = (name, detail) => {
  lines.push(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail) => {
  errors.push(name);
  lines.push(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
};
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(name, JSON.stringify(actual));
  else fail(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
};
const bool = (name, value, detail = "") => {
  if (value) ok(name, detail);
  else fail(name, detail);
};
const sha = (files) => {
  const hash = crypto.createHash("sha256");
  for (const file of files.sort()) hash.update(file).update(fs.readFileSync(file));
  return hash.digest("hex").slice(0, 16);
};
const mdFiles = (root) => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-brain-ingest-"));
const home = path.join(tmpRoot, "home");
const brain = path.join(tmpRoot, "brain");
const vault = path.join(brain, "vault");
const sessions = path.join(tmpRoot, "sessions");
const workspace = path.join(tmpRoot, "workspace");
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(brain, { recursive: true });

// 用 ai-brain 的脚本 + 插件自带的演示 vault 搭一个独立的临时知识库
for (const name of ["build_graph.py", "viewer_template.html", "brain_shape.json"]) {
  fs.copyFileSync(path.join(AI_BRAIN, name), path.join(brain, name));
}
fs.cpSync(path.join(PLUGIN_ROOT, "brain", "vault"), vault, { recursive: true });
// 基线 graph.json（与演示 vault 对应），用来验证 rebuilt 后节点数 +1
fs.copyFileSync(path.join(PLUGIN_ROOT, "brain", "graph.json"), path.join(brain, "graph.json"));
const python = process.env.DSH_BRAIN_PYTHON || "python";
// stdio: "ignore" 而不是默认 pipe：沙箱里捕获子进程输出会被拒，测「能不能跑」不需要输出
const pythonOk = spawnSync(python, ["--version"], { stdio: "ignore" }).status === 0;
fs.writeFileSync(
  path.join(home, "brain-viewer.config.json"),
  JSON.stringify({ graphPath: path.join(brain, "graph.json"), sessionsPath: sessions, python }, null, 2),
  "utf8"
);

const today = ingest.localDate(Date.now());
const yesterday = ingest.localDate(Date.now() - 24 * 3600 * 1000);

/* ---------------- 造会话文件（多帧 zstd：每条事件一帧） ---------------- */
function event(type, data, time, extra = {}) {
  return { type, ...(time ? { time } : {}), data, ...extra };
}
function writeSession(sid, events, options = {}) {
  const dir = path.join(sessions, options.slug || "--e2e-workspace--", sid);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "session.v4.jsonl.zstd");
  const frames = events.map((item) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(item) + "\n", "utf8")));
  fs.writeFileSync(file, Buffer.concat(frames));
  if (options.mtime) fs.utimesSync(file, options.mtime, options.mtime);
  return file;
}

const now = Date.now();
const header = (sid, extra = {}) => ({
  type: "session",
  version: 4,
  id: sid,
  createdAt: now - 2 * 3600 * 1000,
  cwd: workspace,
  isSeeded: false,
  ...extra,
});

const mainSessionId = "session-e2etest-1111";
const mainEvents = [
  header(mainSessionId),
  event("turn/start", { turn: 1 }, now - 7000_000),
  event("step/start", { turn: 1, step: 1 }, now - 6990_000),
  event("user/message", {
    content: [{ type: "text", text: "把会话自动复盘入库做进 AI 大脑插件，顺便补测试。" }],
    source: { kind: "user" },
    role: "user",
  }, now - 6980_000),
  event("assistant/message", {
    turn: 1, step: 1,
    message: {
      role: "assistant",
      content: [
        { type: "reasoning", text: "先读插件结构，再加 host 路由。" },
        { type: "text", text: "已完成 Brain Ingest：新增两条宿主路由、面板按钮、幂等测试。" },
      ],
    },
  }, now - 6000_000),
  event("tool/call", { name: "read", callId: "c1" }, now - 5990_000),
  event("tool/call", { name: "pwsh", callId: "c2" }, now - 5980_000),
  event("session/title", { title: "会话复盘入库", source: { kind: "provider" } }, now - 5970_000),
  event("turn/end", { turn: 1, reason: { kind: "completed" } }, now - 5960_000),
];
const mainFile = writeSession(mainSessionId, mainEvents);

writeSession(
  "session-e2etest-2222",
  [
    header("session-e2etest-2222", { createdAt: now - 48 * 3600 * 1000 }),
    event("user/message", { content: [{ type: "text", text: "昨天的会话不该进今天的复盘。" }] }, now - 47 * 3600 * 1000),
    event("assistant/message", { message: { content: [{ type: "text", text: "好。" }] } }, now - 47 * 3600 * 1000 + 1000),
  ],
  { mtime: (now - 24 * 3600 * 1000) / 1000 }
);

writeSession("session-e2etest-3333", [
  header("session-e2etest-3333", { origin: "subagent", delegationDepth: 1, parentSession: mainSessionId }),
  event("user/message", { content: [{ type: "text", text: "子会话的任务提示不该单独入库。" }] }, now - 1000_000),
  event("assistant/message", { message: { content: [{ type: "text", text: "收到。" }] } }, now - 999_000),
]);

writeSession("session-e2etest-4444", [
  header("session-e2etest-4444"),
  event("system/message", { message: { content: [{ type: "text", text: "只有系统消息，没有真人输入。" }] } }, now - 500_000),
]);

/* ---------------- 1. 多帧 zstd 解码 + 解析 ---------------- */
lines.push("— 1. 多帧 zstd 会话解码与启发式解析 —");
const raw = fs.readFileSync(mainFile);
const frames = ingest.splitZstdFrames(raw);
eq("多帧 zstd 帧数", frames.length, mainEvents.length);
const text = ingest.decodeSessionText(raw);
const parsed = ingest.parseSessionLog(text);
eq("会话头 id", parsed.header.id, mainSessionId);
eq("用户意图条数", parsed.userTexts.length, 1);
eq("轮数 / 步骤 / 工具调用", [parsed.turns, parsed.steps, parsed.toolCalls], [1, 1, 2]);
eq("工具统计", parsed.toolCounts, { read: 1, pwsh: 1 });
bool("助手最终结论取 text 段（忽略 reasoning）", parsed.assistantFinalText.startsWith("已完成 Brain Ingest"), parsed.assistantFinalText);
eq("会话标题回退", parsed.title, "会话复盘入库");
const single = zlib.zstdCompressSync(Buffer.from(JSON.stringify(header("session-single")) + "\n"));
fs.writeFileSync(path.join(tmpRoot, "single.zstd"), single);
eq("单帧会话也能解", ingest.parseSessionLog(ingest.readSessionFile(path.join(tmpRoot, "single.zstd"))).header.id, "session-single");

/* ---------------- 2. 笔记生成 ---------------- */
lines.push("— 2. episode 笔记生成 —");
const titles = ingest.scanVaultInfo(vault).titles;
const links = ingest.pickLinks(titles, { limit: 3 });
bool("自动关联至少 2 条已有笔记", links.length >= 2, JSON.stringify(links));
const note = ingest.buildEpisodeNote(parsed, {
  date: today,
  sessionId: mainSessionId,
  slug: "--e2e-workspace--",
  cwd: workspace,
  links,
});
bool("frontmatter 有 source 标记", note.content.includes(`source: ${ingest.INGEST_SOURCE}`));
bool("frontmatter 有 session 字段", note.content.includes(`session: ${mainSessionId}`));
bool("frontmatter date 正确", note.content.includes(`date: ${today}`));
bool("文件名带日期 + 短 id", note.relPath.includes(today) && note.relPath.includes("e2etest"), note.relPath);
const linkMatches = note.content.match(/\[\[([^\]]+)\]\]/g) || [];
bool("正文双链 ≥2", linkMatches.length >= 2, linkMatches.join(" "));
bool("双链目标都存在于 vault", links.every((title) => titles.has(title)), JSON.stringify(links));
bool("第一行是摘要（图谱 excerpt 用）", note.content.split("---\n")[2].trim().startsWith("会话复盘："), "");

/* ---------------- 3. status ---------------- */
lines.push("— 3. status 逻辑 —");
const status0 = ingest.getIngestStatus({ home });
bool("status ok", status0.ok === true);
eq("今天已入库初始 0 条", status0.todayIngested, 0);
eq("可见会话（排除子会话）", status0.visibleSessions, 2);
eq("今日会话文件数（含子/空会话）", status0.sessionsActiveToday, 3);
bool("最近记忆日期非空", Boolean(status0.latestMemoryDate), status0.latestMemoryDate);

/* ---------------- 4. run 全链路 ---------------- */
lines.push("— 4. run：写入 + 重建图谱 —");
const beforeMd = mdFiles(vault);
const beforeHash = sha(beforeMd);
const beforeNodes = ingest.readGraphNodes(path.join(brain, "graph.json"));
const first = ingest.runIngest({ home });
bool("run ok", first.ok === true, JSON.stringify(first.warnings));
eq("写入 1 条", first.written, 1);
eq("更新 0 条", first.updated, 0);
eq("跳过 1 条（无用户文本的会话）", first.skipped, 1);
bool("子会话被忽略", first.ignored >= 1, `ignored=${first.ignored}`);
const afterMd = mdFiles(vault);
eq("vault 只新增 1 篇 md", afterMd.length - beforeMd.length, 1);
const newFiles = afterMd.filter((file) => !beforeMd.includes(file));
bool("新文件在 episodes/<月>/ 下", newFiles.length === 1 && newFiles[0].includes(`episodes${path.sep}${today.slice(0, 7)}`), newFiles[0]);
const oldHash = sha(beforeMd);
eq("已有记忆文件未被改动", oldHash, beforeHash);
const noteContent = fs.readFileSync(newFiles[0], "utf8");
bool("落盘内容 = 生成内容", noteContent === note.content);
if (pythonOk) {
  bool("图谱已重建", first.graph && first.graph.ok === true, JSON.stringify(first.graph && { nodes: first.graph.nodes, ms: first.graph.ms }));
  eq("节点数 +1", first.nodes, (beforeNodes || 0) + 1);
  const graph = JSON.parse(fs.readFileSync(path.join(brain, "graph.json"), "utf8"));
  const relSuffix = `episodes/${today.slice(0, 7)}/${path.basename(newFiles[0])}`;
  const node = graph.nodes.find((item) => String(item.p).replace(/\\/g, "/").endsWith(relSuffix));
  bool("图谱里有这篇笔记节点", Boolean(node), node && node.t);
  const graphTitles = new Set(graph.nodes.map((item) => item.t));
  bool("双链在图谱里都解析到了", links.every((title) => graphTitles.has(title)), JSON.stringify(links));
  bool("笔记节点有连线", node && node.d > 0, node && `deg=${node.d}`);
} else {
  lines.push("  … 没有 python，跳过 build_graph.py 实测（写入/幂等仍验证）");
}

/* ---------------- 5. 幂等 ---------------- */
lines.push("— 5. 幂等：重复 run 不重复写 —");
const statBefore = fs.statSync(newFiles[0]);
const second = ingest.runIngest({ home });
eq("第二次 written / updated / skipped", [second.written, second.updated, second.skipped], [0, 0, 2]);
eq("文件 mtime 未变（没有重写）", fs.statSync(newFiles[0]).mtimeMs, statBefore.mtimeMs);
eq("文件内容未变", fs.readFileSync(newFiles[0], "utf8"), noteContent);
eq("md 数量不变", mdFiles(vault).length, afterMd.length);

/* ---------------- 6. 会话追加 → 原地更新 ---------------- */
lines.push("— 6. 同一 session 追加内容 → 原地更新 —");
const appendFrames = [
  event("user/message", { content: [{ type: "text", text: "再补一版：面板要显示今天入库条数。" }] }, now - 3000_000),
  event("assistant/message", { message: { content: [{ type: "text", text: "已补状态行与按钮。" }] } }, now - 2990_000),
].map((item) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(item) + "\n", "utf8")));
fs.appendFileSync(mainFile, Buffer.concat(appendFrames));
const third = ingest.runIngest({ home });
eq("追加后 written / updated / skipped", [third.written, third.updated, third.skipped], [0, 1, 1]);
eq("仍是同一篇笔记", mdFiles(vault).length, afterMd.length);
const updatedContent = fs.readFileSync(newFiles[0], "utf8");
bool("内容已更新（2 个用户请求）", updatedContent.includes("2 个用户请求"), "");
bool("旧文件路径未变", updatedContent.includes(`session: ${mainSessionId}`));

/* ---------------- 7. dryRun 不落盘 ---------------- */
lines.push("— 7. dryRun 不落盘 —");
writeSession("session-e2etest-5555", [
  header("session-e2etest-5555"),
  event("user/message", { content: [{ type: "text", text: "这条只在 dryRun 里预览，不应落盘。" }] }, now - 100),
]);
const countBefore = mdFiles(vault).length;
const dry = ingest.runIngest({ home, dryRun: true });
bool("dryRun 返回 would-write", dry.written >= 1 && dry.notes.some((item) => item.status === "would-write"), JSON.stringify({ written: dry.written }));
eq("dryRun 后 md 数量不变", mdFiles(vault).length, countBefore);

/* ---------------- 8. 未配置 vault → 拒绝写入 ---------------- */
lines.push("— 8. 未配置真实 vault 时拒绝写入 —");
const bareHome = path.join(tmpRoot, "bare-home");
fs.mkdirSync(bareHome, { recursive: true });
const bundledVault = path.join(PLUGIN_ROOT, "brain", "vault");
const bundledBefore = mdFiles(bundledVault).length;
const refused = ingest.runIngest({ home: bareHome });
bool("未配置时 ok=false", refused.ok === false, refused.hint || refused.error);
eq("未配置时不写入包内演示 vault", mdFiles(bundledVault).length, bundledBefore);
const bareStatus = ingest.getIngestStatus({ home: bareHome });
bool("未配置时 status.configured=false", bareStatus.configured === false);
bool("未配置时给出配置提示", typeof bareStatus.hint === "string" && bareStatus.hint.includes("vaultPath"));

/* ---------------- 收尾 ---------------- */
if (!process.env.DSH_BRAIN_KEEP_TMP) fs.rmSync(tmpRoot, { recursive: true, force: true });
else lines.push(`  … 临时目录保留：${tmpRoot}`);

console.log(lines.join("\n"));
console.log("");
if (errors.length) {
  console.log(`FAILED (${errors.length}): ${errors.join("; ")}`);
  process.exit(1);
}
console.log(`INGEST E2E OK${pythonOk ? "（含 python 图谱重建）" : "（无 python，仅写入/幂等）"}`);
