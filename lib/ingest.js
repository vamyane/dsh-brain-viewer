/**
 * dsh-brain ingest core（v0.4.0）—— 会话自动复盘入库。
 *
 * 把本机 DSH 会话（~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd）
 * 里的「今天」压缩成一条 episode 记忆写进 vault，再调 build_graph.py 重建图谱。
 *
 * 设计约束：
 *   - 零第三方依赖（只读 node:fs / node:zlib / node:child_process）；
 *   - 不调用任何外部 LLM，纯启发式抽取（首条用户消息 = 标题，用户意图 + 助手最终结论 = 正文）；
 *   - 幂等：同一个 session + 日期只对应一篇笔记，重复执行只在内容变化时原地更新；
 *   - vault 路径：配置 vaultPath > graphPath 同目录推断（vault/ 或 brain/vault/）> 包内演示 vault；
 *   - 包内演示 vault 不算「已配置」，避免误把真实会话写进公开包的演示数据。
 *
 * 本文件里的多数函数是纯函数（可离线单测），只有 collect/run/status 会碰磁盘。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.join(LIB_DIR, "..");
export const BUNDLED_VAULT = path.join(PACKAGE_ROOT, "brain", "vault");
export const BUNDLED_GRAPH = path.join(PACKAGE_ROOT, "brain", "graph.json");
export const CONFIG_NAME = "brain-viewer.config.json";
export const SESSION_FILE = "session.v4.jsonl.zstd";
/** 自动入库笔记在 frontmatter 里的来源标记（幂等与统计都靠它）。 */
export const INGEST_SOURCE = "dsh-session-ingest";
/** 自动入库笔记默认关联的「枢纽」笔记（存在才用）。 */
export const DEFAULT_LINK_PREFERENCE = [
  "DeepSeek Harness 工作台",
  "关系图谱",
  "双链笔记",
  "知识图谱",
  "AI 大脑",
];
const HUB_KINDS = new Set(["project", "concept", "tool", "person", "decision", "preference", "skill"]);
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SCAN_TTL_MS = 30_000;

/* ------------------------------------------------------------------ 基础工具 */

/** 当前 Node 是否带 zstd 解压（v22.15+/v23.8+；DSH 自带 Node 24 一定有）。 */
export function supportsZstd() {
  return typeof zlib.zstdDecompressSync === "function";
}

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

export function expandHome(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "~") return os.homedir();
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function resolveMaybe(value) {
  const text = expandHome(value);
  return text ? path.resolve(text) : "";
}

/** 本地时区的 YYYY-MM-DD（会话文件按本机日期归档，不能用 UTC）。 */
export function localDate(ms) {
  const date = new Date(ms);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function localTimeText(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeNewlines(text) {
  return String(text || "").replace(/\r\n?/g, "\n");
}

/** 配置读取：坏 JSON 不抛错，按「没配置」处理。 */
export function readConfig(home = dshHome()) {
  const file = path.join(home, CONFIG_NAME);
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    return { file, config: config && typeof config === "object" ? config : {} };
  } catch {
    return { file, config: {} };
  }
}

/**
 * 解析所有用到的路径。优先级：显式 vaultPath > graphPath 同目录推断 > 包内演示 vault。
 * overrides 只给测试/CLI 用（不写进配置文件）。
 */
export function resolvePaths(config = {}, home = dshHome(), overrides = {}) {
  const configuredGraph = resolveMaybe(config.graphPath);
  const explicitGraph = resolveMaybe(overrides.graphPath) || configuredGraph;
  const graphPath = explicitGraph || BUNDLED_GRAPH;

  let vaultPath = resolveMaybe(overrides.vaultPath) || resolveMaybe(config.vaultPath);
  let vaultSource = vaultPath ? "config" : "";
  if (!vaultPath && explicitGraph) {
    // 只有「用户显式配置过 graphPath」才按同目录推断 vault，避免把包内演示数据当成真实库
    const dir = path.dirname(explicitGraph);
    const candidates = [path.join(dir, "vault"), path.join(dir, "brain", "vault")];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) {
      vaultPath = found;
      vaultSource = "graphPath";
    }
  }
  if (!vaultPath) {
    vaultPath = BUNDLED_VAULT;
    vaultSource = "bundled";
  }
  const configured = vaultSource === "config" || vaultSource === "graphPath";

  let graphScript = resolveMaybe(overrides.graphScript) || resolveMaybe(config.graphScript);
  if (!graphScript) {
    const candidates = [
      path.join(path.dirname(vaultPath), "build_graph.py"),
      path.join(PACKAGE_ROOT, "brain", "build_graph.py"),
    ];
    graphScript = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  const python =
    String(overrides.python || config.python || process.env.DSH_BRAIN_PYTHON || "").trim() || "python";
  const sessionsPath =
    resolveMaybe(overrides.sessionsPath) || resolveMaybe(config.sessionsPath) || path.join(home, "sessions");

  let workspaceRoot = "";
  if (config.ingestAllWorkspaces === true) {
    workspaceRoot = "";
  } else if (typeof config.workspaceRoot === "string" && config.workspaceRoot.trim()) {
    workspaceRoot = resolveMaybe(config.workspaceRoot);
  } else if (configured) {
    // .../ai-brain/vault -> .../ai-brain -> 工作区根；只有 vault 在 brain 目录下才推断
    const parentName = path.basename(path.dirname(vaultPath)).toLowerCase();
    if (parentName === "brain" || parentName === "ai-brain" || parentName === "ai_brain") {
      workspaceRoot = path.dirname(path.dirname(vaultPath));
    }
  }

  return {
    home,
    configFile: path.join(home, CONFIG_NAME),
    graphPath,
    vaultPath,
    vaultSource,
    configured,
    graphScript,
    python,
    sessionsPath,
    workspaceRoot,
  };
}

/** 会话 cwd 是否在当前知识库对应的工作区内（Windows 路径大小写不敏感）。 */
export function isSessionInScope(cwd, workspaceRoot) {
  if (!workspaceRoot) return true;
  if (!cwd) return false;
  const root = path.resolve(workspaceRoot).toLowerCase().replace(/[\\/]+$/, "");
  const dir = path.resolve(cwd).toLowerCase().replace(/[\\/]+$/, "");
  return dir === root || dir.startsWith(root + path.sep);
}

/* ------------------------------------------------------------------ zstd 会话解码 */

/**
 * DSH v4 会话是「一帧 zstd = 一次追加」的多帧文件，而 Node 的
 * zstdDecompressSync / createZstdDecompress 都只解第一帧，所以按 magic 切帧。
 * 如果 magic 恰好出现在压缩数据里（极小概率），当前段会解不出来，就向后合并重试。
 */
export function splitZstdFrames(buffer) {
  const starts = [];
  let index = buffer.indexOf(ZSTD_MAGIC, 0);
  while (index !== -1) {
    starts.push(index);
    index = buffer.indexOf(ZSTD_MAGIC, index + 4);
  }
  return starts;
}

/** 把整个会话文件解成 JSONL 文本（自动兼容未压缩的纯 JSONL）。 */
export function decodeSessionText(buffer) {
  if (!buffer || buffer.length === 0) return "";
  const isZstd = buffer.length >= 4 && buffer.subarray(0, 4).equals(ZSTD_MAGIC);
  if (!isZstd) {
    const head = buffer.subarray(0, 64).toString("utf8").trimStart();
    if (head.startsWith("{")) return buffer.toString("utf8");
    throw new Error("无法识别的会话文件格式（既不是 zstd 也不是 JSONL）");
  }
  const starts = splitZstdFrames(buffer);
  if (starts.length === 0) throw new Error("zstd 会话文件里找不到帧头");
  const parts = [];
  let index = 0;
  while (index < starts.length) {
    let next = index + 1;
    let decoded = null;
    while (next <= starts.length && decoded === null) {
      const end = next < starts.length ? starts[next] : buffer.length;
      try {
        decoded = zlib.zstdDecompressSync(buffer.subarray(starts[index], end));
      } catch {
        next += 1;
      }
    }
    if (decoded === null) {
      index += 1;
      continue;
    }
    parts.push(decoded.toString("utf8"));
    index = next;
  }
  return parts.join("");
}

export function readSessionFile(file) {
  return decodeSessionText(fs.readFileSync(file));
}

/** 只解第一帧拿会话头（id / cwd / origin / createdAt），用于快速筛选。 */
export function readSessionHeader(file) {
  const fd = fs.openSync(file, "r");
  let chunk;
  try {
    const size = Math.min(fs.fstatSync(fd).size, 64 * 1024);
    chunk = Buffer.alloc(size);
    fs.readSync(fd, chunk, 0, size, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!chunk.length) return {};
  const second = chunk.indexOf(ZSTD_MAGIC, 4);
  const frame = second === -1 ? chunk : chunk.subarray(0, second);
  let text;
  try {
    text = zlib.zstdDecompressSync(frame).toString("utf8");
  } catch {
    text = readSessionFile(file);
  }
  const firstLine = normalizeNewlines(text)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return {};
  try {
    return JSON.parse(firstLine);
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ 会话内容解析 */

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** 过滤掉系统提示 / 运行时上下文 / 团队消息这类「不是人说的话」。 */
export function isRealUserText(text) {
  const value = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (value.length < 2) return false;
  if (value.startsWith("<")) return false;
  const noisy = [
    "Current runtime context",
    "You are a delegated subagent",
    "You are teammate",
    "Team message from",
    "Instructions from:",
  ];
  return !noisy.some((prefix) => value.startsWith(prefix));
}

export function cleanInline(text, limit = 140) {
  let value = String(text || "").replace(/\r\n?/g, "\n");
  value = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/[`*_>#]/g, "")
    .trim();
  if (limit && value.length > limit) value = value.slice(0, limit).trimEnd() + "…";
  return value;
}

function firstSentenceOf(text, limit = 90) {
  const value = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!value) return "";
  const flat = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"))
    .join(" ");
  const match = flat.match(/^(.{2,}?[。！？!?]|.{2,}?\.(?=\s|$))/u);
  const sentence = (match ? match[1] : flat).trim();
  if (sentence.length <= limit) return sentence;
  return sentence.slice(0, limit).trimEnd() + "…";
}

/**
 * 解析会话 JSONL 文本，抽出标题 / 用户意图 / 助手最终结论 / 工具使用等。
 * @param {string} text
 */
export function parseSessionLog(text) {
  const items = [];
  let badLines = 0;
  for (const raw of normalizeNewlines(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      items.push(JSON.parse(line));
    } catch {
      badLines += 1;
    }
  }

  let header = {};
  const titles = [];
  let providerTitle = "";
  const userTexts = [];
  const assistantTexts = [];
  const toolCounts = {};
  let toolCalls = 0;
  let turns = 0;
  let steps = 0;
  let failedTurns = 0;
  let firstTime = 0;
  let lastTime = 0;

  for (const item of items) {
    if (item.type === "session" && !header.type) header = item;
    if (typeof item.time === "number") {
      if (!firstTime || item.time < firstTime) firstTime = item.time;
      if (item.time > lastTime) lastTime = item.time;
    }
    const data = item.data || {};
    switch (item.type) {
      case "session/title": {
        const title = typeof data.title === "string" ? data.title.trim() : "";
        if (title) {
          titles.push(title);
          if (data.source && data.source.kind === "provider") providerTitle = title;
        }
        break;
      }
      case "user/message": {
        const value = extractText(data.content);
        if (isRealUserText(value)) userTexts.push(value.trim());
        break;
      }
      case "assistant/message": {
        const value = extractText(data.message && data.message.content);
        if (value.trim()) assistantTexts.push(value.trim());
        break;
      }
      case "tool/call": {
        toolCalls += 1;
        const toolName = typeof data.name === "string" ? data.name : "";
        if (toolName) toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
        break;
      }
      case "turn/start":
        turns += 1;
        break;
      case "step/start":
        steps += 1;
        break;
      case "turn/end": {
        const kind = data.reason && data.reason.kind;
        if (kind && kind !== "completed") failedTurns += 1;
        break;
      }
      default:
        break;
    }
  }

  const createdAt = typeof header.createdAt === "number" ? header.createdAt : firstTime;
  return {
    header,
    titles,
    title: providerTitle || titles[titles.length - 1] || "",
    userTexts,
    assistantTexts,
    assistantFinalText: assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : "",
    toolCounts,
    toolCalls,
    turns,
    steps,
    failedTurns,
    badLines,
    createdAt,
    startedAt: createdAt || firstTime || 0,
    lastTime: lastTime || createdAt || 0,
  };
}

/* ------------------------------------------------------------------ 标题 / 文件名 */

export function shortSessionId(sessionId) {
  const compact = String(sessionId || "")
    .replace(/^session-/, "")
    .replace(/[^a-zA-Z0-9]/g, "");
  return compact.slice(0, 8) || "session";
}

export function safeFileStem(title, maxLength = 28) {
  let value = String(title || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (maxLength && value.length > maxLength) value = value.slice(0, maxLength).trim();
  return value || "未命名会话";
}

/** 笔记路径固定按「日期 + 会话短 id」可推导；标题变化时靠 frontmatter 里的 session 字段找回旧文件。 */
export function episodeRelPath(date, title, sessionId) {
  const stem = `${date} · 会话复盘 · ${safeFileStem(title)} (${shortSessionId(sessionId)})`;
  return path.posix.join("episodes", date.slice(0, 7), `${stem}.md`);
}

export function episodeMonthDir(vaultPath, date) {
  return path.join(vaultPath, "episodes", String(date || "").slice(0, 7));
}

/* ------------------------------------------------------------------ 笔记生成 */

function asTitleList(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (value && typeof value[Symbol.iterator] === "function") return [...value];
  return [];
}

export function pickLinks(titles, options = {}) {
  const set = new Set(asTitleList(titles));
  const wanted = options.limit === undefined ? 3 : options.limit;
  const exclude = new Set(options.exclude || []);
  const picks = [];
  const push = (title) => {
    if (!title || picks.includes(title) || exclude.has(title) || !set.has(title)) return;
    if (picks.length < wanted) picks.push(title);
  };
  for (const title of options.preferred || DEFAULT_LINK_PREFERENCE) push(title);
  if (picks.length < wanted) for (const title of options.fallback || []) push(title);
  if (picks.length < 2) {
    for (const title of [...set].sort((a, b) => a.localeCompare(b, "zh"))) {
      push(title);
      if (picks.length >= Math.min(2, wanted)) break;
    }
  }
  return picks;
}

const TITLE_TRIM = "。！？!?.,，、;；:：)]}）】」』\"'”’》";
const TITLE_LEAD = "([{（【「『\"'“‘《";

/** 笔记标题 / 文件名用：去掉首尾标点（避免「标题。。」和文件名里的句号）。 */
export function cleanTitle(text, limit = 40) {
  let value = cleanInline(text, 0).trim();
  let start = 0;
  let end = value.length;
  while (start < end && TITLE_LEAD.includes(value[start])) start += 1;
  while (end > start && TITLE_TRIM.includes(value[end - 1])) end -= 1;
  value = value.slice(start, end).trim();
  if (limit && value.length > limit) value = value.slice(0, limit).trimEnd();
  while (value && TITLE_TRIM.includes(value[value.length - 1])) value = value.slice(0, -1);
  return value || "未命名会话";
}

function listTexts(parsed) {
  return {
    intents: parsed.userTexts.slice(0, 5).map((text) => cleanInline(text, 110)).filter(Boolean),
    conclusions: (() => {
      const out = [];
      for (const text of parsed.assistantTexts.slice(-3)) {
        const line = firstSentenceOf(text, 160);
        if (line && !out.includes(line)) out.push(line);
        if (out.length >= 3) break;
      }
      return out;
    })(),
    tools: Object.entries(parsed.toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}×${count}`)
      .join("、"),
  };
}

/**
 * 把解析结果压成一篇 episode 笔记（frontmatter + 正文 + 双链）。
 * @param {ReturnType<typeof parseSessionLog>} parsed
 * @param {{date:string, sessionId:string, slug?:string, cwd?:string, links?:string[], title?:string}} options
 */
export function buildEpisodeNote(parsed, options) {
  const date = options.date;
  const sessionId = options.sessionId;
  const slug = options.slug || "";
  const cwd = options.cwd || (parsed.header && parsed.header.cwd) || "";
  const rawTitle = options.title || parsed.userTexts[0] || parsed.title || "未命名会话";
  const title = cleanTitle(rawTitle, 40);
  const shortId = shortSessionId(sessionId);
  const { intents, conclusions, tools } = listTexts(parsed);
  const finalText = firstSentenceOf(parsed.assistantFinalText, 80) || "本轮没有捕获到文字结论";
  const relPath = episodeRelPath(date, title, sessionId);
  const links = Array.isArray(options.links) ? options.links.filter(Boolean).slice(0, 4) : [];

  const body = [];
  body.push(
    `会话复盘：${title}。${parsed.userTexts.length} 个用户请求、${parsed.turns} 轮对话、` +
      `${parsed.toolCalls} 次工具调用，最终落点是「${finalText}」。`
  );
  body.push("");
  body.push("## 用户意图");
  if (intents.length) for (const intent of intents) body.push(`- ${intent}`);
  else body.push("- （本会话没有可提取的用户文本）");
  body.push("");
  body.push("## 关键结论");
  if (conclusions.length) for (const conclusion of conclusions) body.push(`- ${conclusion}`);
  else body.push("- （本会话没有捕获到文字结论）");
  body.push("");
  body.push("## 会话信息");
  if (parsed.startedAt || parsed.lastTime) {
    body.push(`- 时间：${localTimeText(parsed.startedAt || parsed.lastTime)} → ${localTimeText(parsed.lastTime || parsed.startedAt)}`);
  }
  body.push(`- 工作区：\`${cwd || "未知"}\``);
  body.push(`- 会话：\`${sessionId}\`${slug ? `（${slug}）` : ""}`);
  if (parsed.steps) body.push(`- 步骤：${parsed.steps}${parsed.failedTurns ? `（${parsed.failedTurns} 个回合非正常结束）` : ""}`);
  if (tools) body.push(`- 工具：${tools}`);
  body.push("");
  body.push(links.length ? `**关联**：${links.map((item) => `[[${item}]]`).join("、")}` : "**关联**：");
  body.push("");

  const front = ["---", "type: episode", `date: ${date}`, "tags: [会话复盘, dsh-session, auto]", `source: ${INGEST_SOURCE}`, `session: ${sessionId}`];
  if (slug) front.push(`workspace: ${slug}`);
  if (parsed.lastTime) front.push(`session_updated: ${new Date(parsed.lastTime).toISOString()}`);
  front.push("---", "");

  return {
    relPath,
    content: front.join("\n") + body.join("\n"),
    title,
    date,
    sessionId,
    shortId,
    links,
  };
}

/* ------------------------------------------------------------------ vault 扫描 */

let scanCache = { key: "", at: 0, info: null };

export function invalidateVaultCache() {
  scanCache = { key: "", at: 0, info: null };
}

function headText(file, bytes = 640) {
  const fd = fs.openSync(file, "r");
  try {
    const size = Math.min(fs.statSync(file).size, bytes);
    const chunk = Buffer.alloc(size);
    fs.readSync(fd, chunk, 0, size, 0);
    return chunk.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseFrontmatter(text) {
  const flat = normalizeNewlines(text);
  if (!flat.startsWith("---")) return {};
  const end = flat.indexOf("\n---", 3);
  if (end < 0) return {};
  const meta = {};
  for (const line of flat.slice(3, end).split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    if (!key) continue;
    meta[key] = line.slice(at + 1).trim();
  }
  return meta;
}

function listVaultNoteFiles(vaultPath) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(full);
    }
  };
  walk(vaultPath);
  return files;
}

/**
 * 扫描 vault：标题索引、枢纽笔记、最近记忆日期、今天已入库条数都从这一次扫描里出。
 * 结果按 vaultPath 缓存 30s；入库写完会主动失效。
 */
export function scanVaultInfo(vaultPath, options = {}) {
  const key = path.resolve(vaultPath);
  const now = Date.now();
  if (options.fresh !== true && scanCache.info && scanCache.key === key && now - scanCache.at < SCAN_TTL_MS) {
    return scanCache.info;
  }
  const notes = [];
  for (const file of listVaultNoteFiles(key)) {
    const head = headText(file);
    const meta = parseFrontmatter(head);
    const title = path.basename(file, path.extname(file));
    const dateMatch = title.match(/^(\d{4}-\d{2}-\d{2})/);
    const kind = (meta.type || "episode").trim() || "episode";
    notes.push({
      file,
      rel: path.relative(key, file).split(path.sep).join("/"),
      title,
      kind,
      date: meta.date || meta.created || meta.updated || (dateMatch ? dateMatch[1] : ""),
      source: meta.source || "",
    });
  }
  notes.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  let latestDate = "";
  for (const note of notes) if (note.date && note.date > latestDate) latestDate = note.date;
  const info = {
    vaultPath: key,
    noteCount: notes.length,
    notes,
    titles: new Set(notes.map((note) => note.title)),
    hubTitles: notes.filter((note) => HUB_KINDS.has(note.kind)).map((note) => note.title),
    latestDate,
  };
  scanCache = { key, at: now, info };
  return info;
}

export function countTodayIngested(info, date) {
  if (!info) return 0;
  // 只统计自动入库写的（source 标记 + 日期匹配），手写记忆不算「已入库」
  return info.notes.filter((note) => note.source === INGEST_SOURCE && note.date === date).length;
}

/* ------------------------------------------------------------------ 会话收集 */

/** 列出 sessions 目录下所有 v4 会话文件。 */
export function listSessionFiles(sessionsPath) {
  const files = [];
  let workspaceDirs;
  try {
    workspaceDirs = fs.readdirSync(sessionsPath, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const workspace of workspaceDirs) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(sessionsPath, workspace.name);
    let sessionDirs;
    try {
      sessionDirs = fs.readdirSync(workspaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessionDirs) {
      if (!session.isDirectory()) continue;
      const file = path.join(workspaceDir, session.name, SESSION_FILE);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      files.push({
        file,
        slug: workspace.name,
        sessionId: session.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  return files;
}

/**
 * 挑出「目标日期」的候选会话：文件 mtime 落在当天 + cwd 在知识库对应工作区内 + 跳过子 agent 会话。
 * @returns {{candidates:Array, ignored:Array, activeToday:Array}}
 */
export function collectDaySessions(files, options = {}) {
  const date = options.date || localDate(Date.now());
  const workspaceRoot = options.workspaceRoot || "";
  const includeSubagent = options.includeSubagent === true;
  const activeToday = (files || []).filter((file) => localDate(file.mtimeMs) === date);
  const candidates = [];
  const ignored = [];
  for (const file of activeToday) {
    let header = {};
    try {
      header = readSessionHeader(file.file);
    } catch (error) {
      ignored.push({ ...file, reason: "unreadable", detail: String(error && error.message ? error.message : error) });
      continue;
    }
    if (!isSessionInScope(header.cwd, workspaceRoot)) {
      ignored.push({ ...file, header, reason: "outside-workspace" });
      continue;
    }
    const isSubagent = header.origin === "subagent" || (typeof header.delegationDepth === "number" && header.delegationDepth > 0);
    if (isSubagent && !includeSubagent) {
      ignored.push({ ...file, header, reason: "subagent" });
      continue;
    }
    candidates.push({ ...file, header });
  }
  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return { candidates, ignored, activeToday };
}

/* ------------------------------------------------------------------ 幂等查找 / 写入 */

/** 在 vault 里按 frontmatter 的 session 字段找今天已有笔记（标题改了也能找回）。 */
export function findEpisodeBySession(vaultPath, date, sessionId) {
  const prefix = `session: ${sessionId}`;
  const dir = episodeMonthDir(vaultPath, date);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const file = path.join(dir, entry.name);
    const head = normalizeNewlines(headText(file, 1024));
    if (!head.includes(INGEST_SOURCE)) continue;
    if (head.split("\n").some((line) => line.trim() === prefix)) return file;
  }
  return "";
}

/** 目标文件名被别的会话占用时追加 " (2)" 之类后缀，绝不覆盖别人的笔记。 */
function uniqueEpisodeRelPath(vaultPath, relPath, sessionId) {
  const marker = `session: ${sessionId}`;
  let candidate = relPath;
  for (let index = 2; index <= 50; index += 1) {
    const full = path.join(vaultPath, candidate.split("/").join(path.sep));
    if (!fs.existsSync(full)) return candidate;
    let head = "";
    try {
      head = normalizeNewlines(headText(full, 1024));
    } catch {
      head = "";
    }
    if (head.split("\n").some((line) => line.trim() === marker)) return candidate;
    candidate = relPath.replace(/\.md$/i, ` (${index}).md`);
  }
  return relPath;
}

function writeEpisode(vaultPath, relPath, content) {
  const file = path.join(vaultPath, relPath.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
  return file;
}

/* ------------------------------------------------------------------ 图谱重建 */

export function readGraphNodes(graphPath) {
  try {
    const data = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    return Array.isArray(data.nodes) ? data.nodes.length : null;
  } catch {
    return null;
  }
}

/** 调 python build_graph.py 重建图谱，返回节点数；失败不抛错，交给调用方展示。 */
export function rebuildGraph(paths, options = {}) {
  const started = Date.now();
  const script = paths.graphScript;
  if (!script || !fs.existsSync(script)) {
    return { rebuilt: false, ok: false, nodes: null, error: `找不到 build_graph.py：${script || "(未配置)"}`, ms: 0 };
  }
  const result = spawnSync(paths.python || "python", [script], {
    cwd: path.dirname(script),
    encoding: "utf8",
    timeout: options.timeoutMs || 120_000,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  const base = { rebuilt: true, ms: Date.now() - started, graphScript: script };
  if (result.error) {
    // 受限沙箱（Windows 命名管道限制）不允许捕获子进程 stdio → 退回 inherit 重跑一次，
    // 输出拿不到但 graph.json 落盘后仍然能读到节点数。
    if (result.error.code === "EPERM" || result.error.code === "EACCES") {
      const retried = spawnSync(paths.python || "python", [script], {
        cwd: path.dirname(script),
        stdio: "ignore",
        timeout: options.timeoutMs || 120_000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      });
      if (!retried.error && retried.status === 0) {
        const scriptGraph = path.join(path.dirname(script), "graph.json");
        let nodes = readGraphNodes(scriptGraph);
        if (nodes === null) nodes = readGraphNodes(paths.graphPath);
        invalidateVaultCache();
        return { ...base, ok: true, ms: Date.now() - started, nodes, graphPath: scriptGraph, output: "(stdio inherited)" };
      }
      return { ...base, ok: false, nodes: null, error: String(retried.error ? retried.error.message : `退出码 ${retried.status}`) };
    }
    return { ...base, ok: false, nodes: null, error: String(result.error.message || result.error) };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || `退出码 ${result.status}`).trim().slice(-800);
    return { ...base, ok: false, nodes: null, error: detail };
  }
  const scriptGraph = path.join(path.dirname(script), "graph.json");
  let nodes = readGraphNodes(scriptGraph);
  if (nodes === null) nodes = readGraphNodes(paths.graphPath);
  if (nodes === null) {
    const match = String(result.stdout || "").match(/节点\s*(\d+)/);
    if (match) nodes = Number(match[1]);
  }
  invalidateVaultCache();
  return { ...base, ok: true, nodes, graphPath: scriptGraph, output: String(result.stdout || "").trim().slice(-600) };
}

/* ------------------------------------------------------------------ 对外主流程 */

function configHint(paths) {
  return (
    `会话自动入库需要指向一个真实 vault：在 ${paths.configFile} 里写 ` +
    `{"vaultPath":"D:/path/to/ai-brain/vault"}（或先配置 graphPath，插件会按 graphPath 同目录推断 vault/）。` +
    `当前用的是插件自带的演示 vault（${paths.vaultPath}），为避免污染演示数据不会写入。`
  );
}

/** GET /api/dsh-brain/ingest/status 的数据源。 */
export function getIngestStatus(options = {}) {
  const home = options.home || dshHome();
  const { config } = readConfig(home);
  const paths = resolvePaths(config, home, options);
  const date = options.date || localDate(Date.now());
  if (!supportsZstd()) {
    return {
      ok: false,
      configured: true,
      date,
      todayIngested: 0,
      error: `当前 Node ${process.version} 没有 zlib.zstdDecompressSync，无法解锁 DSH v4 会话`,
      hint: "会话文件是 zstd 压缩的，需要 Node >= 22.15（或 23.8+）；DSH 运行时自带 Node 24，命令行跑请换新版 node。",
      vaultPath: paths.vaultPath,
    };
  }
  if (!paths.configured && options.force !== true) {
    return {
      ok: false,
      configured: false,
      date,
      vaultPath: paths.vaultPath,
      error: "尚未配置真实 vault，自动入库不可用",
      hint: configHint(paths),
    };
  }
  const info = scanVaultInfo(paths.vaultPath);
  const files = listSessionFiles(paths.sessionsPath);
  const { candidates, ignored, activeToday } = collectDaySessions(files, {
    date,
    workspaceRoot: paths.workspaceRoot,
    includeSubagent: false,
  });
  return {
    ok: true,
    configured: true,
    date,
    todayIngested: countTodayIngested(info, date),
    latestMemoryDate: info.latestDate || "",
    noteCount: info.noteCount,
    visibleSessions: candidates.length,
    subagentSessions: ignored.filter((item) => item.reason === "subagent").length,
    sessionsActiveToday: activeToday.length,
    vaultPath: paths.vaultPath,
    sessionsPath: paths.sessionsPath,
    workspaceRoot: paths.workspaceRoot,
    graphPath: paths.graphPath,
    graphNodes: readGraphNodes(paths.graphPath),
    configFile: paths.configFile,
  };
}

/**
 * POST /api/dsh-brain/ingest/run 的实现：扫描今天 → 写 episode → 重建图谱。
 * @param {{home?:string,date?:string,dryRun?:boolean,includeSubagent?:boolean,force?:boolean,
 *          vaultPath?:string,graphScript?:string,sessionsPath?:string,workspaceRoot?:string,python?:string}} options
 */
export function runIngest(options = {}) {
  const home = options.home || dshHome();
  const { config } = readConfig(home);
  const paths = resolvePaths(config, home, options);
  const date = options.date || localDate(Date.now());
  const dryRun = options.dryRun === true;
  const warnings = [];

  if (!supportsZstd()) {
    return {
      ok: false,
      configured: true,
      date,
      dryRun,
      written: 0,
      updated: 0,
      skipped: 0,
      ignored: 0,
      failed: 0,
      nodes: null,
      vaultPath: paths.vaultPath,
      error: `当前 Node ${process.version} 没有 zlib.zstdDecompressSync，无法解锁 DSH v4 会话`,
      hint: "会话文件是 zstd 压缩的，需要 Node >= 22.15（或 23.8+）；DSH 运行时自带 Node 24。",
    };
  }

  if (!paths.configured && options.force !== true) {
    return {
      ok: false,
      configured: false,
      date,
      dryRun,
      written: 0,
      updated: 0,
      skipped: 0,
      ignored: 0,
      failed: 0,
      nodes: null,
      vaultPath: paths.vaultPath,
      error: "尚未配置真实 vault，自动入库不可用",
      hint: configHint(paths),
    };
  }

  const info = scanVaultInfo(paths.vaultPath);
  const files = listSessionFiles(paths.sessionsPath);
  if (!fs.existsSync(paths.sessionsPath)) {
    warnings.push(`会话目录不存在：${paths.sessionsPath}（配置 sessionsPath，或先在 DSH 里开一次会话）`);
  }
  const { candidates, ignored, activeToday } = collectDaySessions(files, {
    date,
    workspaceRoot: paths.workspaceRoot,
    includeSubagent: options.includeSubagent === true,
  });

  const linkTitles = pickLinks(info.titles, {
    limit: 3,
    fallback: info.hubTitles,
  });

  let written = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const notes = [];

  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = parseSessionLog(readSessionFile(candidate.file));
    } catch (error) {
      failed += 1;
      warnings.push(`${candidate.sessionId} 解析失败：${String(error && error.message ? error.message : error)}`);
      continue;
    }
    if (parsed.userTexts.length === 0) {
      skipped += 1;
      notes.push({ sessionId: candidate.sessionId, status: "no-user-text" });
      continue;
    }
    const note = buildEpisodeNote(parsed, {
      date,
      sessionId: candidate.sessionId,
      slug: candidate.slug,
      cwd: candidate.header && candidate.header.cwd,
      links: (() => {
        const picked = pickLinks(info.titles, {
          limit: 3,
          fallback: info.hubTitles,
          exclude: [cleanTitle(parsed.userTexts[0], 40)],
        });
        return picked.length ? picked : linkTitles;
      })(),
    });
    const existing = findEpisodeBySession(paths.vaultPath, date, candidate.sessionId);
    if (!existing) {
      const relPath = uniqueEpisodeRelPath(paths.vaultPath, note.relPath, candidate.sessionId);
      if (!dryRun) writeEpisode(paths.vaultPath, relPath, note.content);
      written += 1;
      notes.push({ sessionId: candidate.sessionId, status: dryRun ? "would-write" : "written", path: path.join(paths.vaultPath, relPath) });
      continue;
    }
    let current = "";
    try {
      current = fs.readFileSync(existing, "utf8");
    } catch {
      current = "";
    }
    if (normalizeNewlines(current) === normalizeNewlines(note.content)) {
      skipped += 1;
      notes.push({ sessionId: candidate.sessionId, status: "unchanged", path: existing });
    } else {
      if (!dryRun) fs.writeFileSync(existing, note.content, "utf8");
      updated += 1;
      notes.push({ sessionId: candidate.sessionId, status: dryRun ? "would-update" : "updated", path: existing });
    }
  }

  let graph = { rebuilt: false, ok: false, nodes: readGraphNodes(paths.graphPath), ms: 0 };
  if (!dryRun && written + updated > 0) {
    graph = rebuildGraph(paths, options);
    if (!graph.ok) warnings.push(`图谱重建失败：${graph.error || "未知错误"}（笔记已写入，可稍后手动跑 build_graph.py）`);
  }
  invalidateVaultCache();

  return {
    ok: true,
    configured: true,
    date,
    dryRun,
    written,
    updated,
    skipped,
    ignored: ignored.length,
    failed,
    nodes: graph.nodes === undefined ? null : graph.nodes,
    notes,
    graph,
    vaultPath: paths.vaultPath,
    sessionsPath: paths.sessionsPath,
    workspaceRoot: paths.workspaceRoot,
    graphPath: paths.graphPath,
    activeToday: activeToday.length,
    candidates: candidates.length,
    warnings,
  };
}
