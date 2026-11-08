/**
 * dsh-brain 宿主半边。
 *
 * v0.3.0 起，图谱数据不再内嵌进 client.js，而是走宿主 Fetch 路由实时读磁盘：
 *
 *   GET  /api/dsh-brain/graph              → brain/graph.json（或配置里的 graphPath）
 *   GET  /api/dsh-brain/ingest/status      → 今天已入库条数 / 最近记忆日期 / 可见会话数（v0.4.0）
 *   POST /api/dsh-brain/ingest/run         → 扫描 ~/.dsh/sessions 今天的会话 → 写 episode 笔记 → 重建图谱（v0.4.0）
 *
 * 好处：写一条记忆 → build_graph.py 更新 graph.json → 重新打开面板就是最新，
 * 不需要重新打包 client.js，也不需要刷新 DSH 页面。
 *
 * 路由挂在 connection 服务的共享 /api 通道上：Host/Origin 栅栏与登录态由 Connection
 * 统一处理（未认证的请求在进入 handler 之前就被拒），插件自己不做鉴权。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getIngestStatus, runIngest } from "./ingest.js";

/** 稳定插件名（组合行按 id 引用，name 供运行时标识）。 */
export const name = "dsh-brain-viewer";

/** 需要 connection 服务提供带鉴权的 /api Fetch 路由。 */
export const inject = ["connection"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(HERE, "..");
/** 包里自带的数据（演示数据，或 rebuild 后用自己知识库重建的数据）。 */
const DEFAULT_GRAPH = path.join(PLUGIN_ROOT, "brain", "graph.json");
/** 本地覆盖：把 graphPath 指到真正的 vault 产物（例如 ai-brain/graph.json）。 */
const CONFIG_NAME = "brain-viewer.config.json";

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

function graphPath() {
  const file = path.join(dshHome(), CONFIG_NAME);
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cfg && typeof cfg.graphPath === "string" && cfg.graphPath.trim()) {
      return path.resolve(cfg.graphPath.trim());
    }
  } catch {
    /* 没有配置文件、或配置坏了 → 用包内数据 */
  }
  return DEFAULT_GRAPH;
}

/** 文件没变就复用上次读到的字符串，避免每次开面板都重新读 + 校验 3 MB JSON。 */
let cache = { file: "", mtimeMs: -1, text: "" };

function readGraph() {
  const file = graphPath();
  const stat = fs.statSync(file);
  if (cache.file === file && cache.mtimeMs === stat.mtimeMs) return cache.text;
  const text = fs.readFileSync(file, "utf8");
  JSON.parse(text); // 坏数据直接报出来，不把语法错误藏进面板
  cache = { file, mtimeMs: stat.mtimeMs, text };
  return text;
}

function reply(status, body) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(status, error, hint) {
  return reply(status, JSON.stringify({ ok: false, error: String(error ?? "未知错误"), hint }));
}

/** 读 POST body：读失败/非 JSON 就当空对象，不因为坏 body 500。 */
async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/**
 * 注册宿主路由。cordis 的 ctx.effect 会统一回收注册；没有 effect 的环境直接注册。
 * @param {import("@deepseek-ai/cordis").Context} ctx - 插件上下文。
 */
export function apply(ctx) {
  const register = (route, label) => {
    const install = () => ctx.connection.fetch.register(route);
    if (typeof ctx.effect === "function") ctx.effect(install, label);
    else install();
  };

  register(
    {
      path: "/api/dsh-brain/graph",
      methods: ["GET"],
      fetch: async () => {
        try {
          return reply(200, readGraph());
        } catch (error) {
          const file = graphPath();
          return reply(500, JSON.stringify({
            error: `读不到图谱数据：${String(error?.message ?? error)}（${file}）`,
            hint: "在插件目录跑 node tools/rebuild.mjs --demo 或 --workspace 你的目录；" +
              `或把 ${path.join(dshHome(), CONFIG_NAME)} 的 graphPath 指到已有的 graph.json`,
          }));
        }
      },
    },
    "dsh-brain: graph route"
  );

  register(
    {
      path: "/api/dsh-brain/ingest/status",
      methods: ["GET"],
      fetch: async () => {
        try {
          return reply(200, JSON.stringify(getIngestStatus()));
        } catch (error) {
          return fail(500, error, "检查 ~/.dsh/brain-viewer.config.json 里的 vaultPath / graphPath 是否可读");
        }
      },
    },
    "dsh-brain: ingest status route"
  );

  register(
    {
      path: "/api/dsh-brain/ingest/run",
      methods: ["POST"],
      // 需要读 JSON body：Connection 默认按流透传，声明 buffered 才能 request.json()
      requestBody: "buffered",
      fetch: async (request) => {
        try {
          const body = await readJsonBody(request);
          const result = runIngest({
            dryRun: body.dryRun === true,
            date: typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined,
            includeSubagent: body.includeSubagent === true,
          });
          return reply(200, JSON.stringify(result));
        } catch (error) {
          return fail(500, error, "先确认 vaultPath 可写、build_graph.py 与 python 可用");
        }
      },
    },
    "dsh-brain: ingest run route"
  );
}
