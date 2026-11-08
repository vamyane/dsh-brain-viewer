#!/usr/bin/env node
/**
 * tools/ingest.mjs — 命令行手动跑一次「会话自动复盘入库」（不在 DSH 里也能用）。
 *
 * 用法：
 *   node tools/ingest.mjs                  # 扫描今天的 DSH 会话 → 写 episode 笔记 → 重建图谱
 *   node tools/ingest.mjs --dry-run        # 只预览会写/更新哪些笔记，不落盘
 *   node tools/ingest.mjs --status         # 只看状态（今天已入库 N 条 / 最近记忆 / 可见会话）
 *   node tools/ingest.mjs --date 2026-11-08
 *   node tools/ingest.mjs --include-subagent
 *   node tools/ingest.mjs --json           # 机器可读输出
 *
 * vault / 会话目录 / python 都读 ~/.dsh/brain-viewer.config.json：
 *   {
 *     "graphPath": "C:/path/to/ai-brain/graph.json",   // 插件据此推断 ai-brain/vault 与 build_graph.py
 *     "vaultPath": "C:/path/to/ai-brain/vault",        // 也可显式指定
 *     "sessionsPath": "C:/Users/me/.dsh/sessions",     // 默认 ~/.dsh/sessions
 *     "workspaceRoot": "C:/path/to/workspace",         // 默认按 vault 的上级目录推断
 *     "python": "python"
 *   }
 */
import { getIngestStatus, runIngest } from "../lib/ingest.js";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined;
};

const options = {
  date: valueOf("--date"),
  dryRun: has("--dry-run"),
  includeSubagent: has("--include-subagent"),
};
const asJson = has("--json");

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

if (has("--status")) {
  const status = getIngestStatus(options);
  if (asJson) {
    printJson(status);
  } else {
    console.log(`日期        ${status.date}`);
    console.log(`已入库      ${status.todayIngested ?? 0} 条`);
    console.log(`最近记忆    ${status.latestMemoryDate || "—"}`);
    console.log(`可见会话    ${status.visibleSessions ?? "—"}（子会话 ${status.subagentSessions ?? 0} / 今日文件 ${status.sessionsActiveToday ?? 0}）`);
    console.log(`vault       ${status.vaultPath}`);
    console.log(`sessions    ${status.sessionsPath}`);
    if (status.workspaceRoot) console.log(`工作区      ${status.workspaceRoot}`);
    if (status.ok === false) {
      console.error(`\n✘ ${status.error}`);
      if (status.hint) console.error(status.hint);
    }
  }
  process.exit(status.ok === false ? 1 : 0);
}

const result = runIngest(options);
if (asJson) {
  printJson(result);
} else if (result.ok === false) {
  console.error(`✘ ${result.error}`);
  if (result.hint) console.error(result.hint);
} else {
  console.log(
    `${result.dryRun ? "预览" : "完成"}：写入 ${result.written} · 更新 ${result.updated} · 跳过 ${result.skipped} · ` +
      `忽略 ${result.ignored} · 失败 ${result.failed} · 节点 ${result.nodes ?? "—"}${result.dryRun ? "（未落盘）" : ""}`
  );
  console.log(`日期 ${result.date} · 候选会话 ${result.candidates} / 今日文件 ${result.activeToday}`);
  console.log(`vault ${result.vaultPath}`);
  for (const note of result.notes || []) {
    console.log(`  - ${note.status.padEnd(11)} ${note.sessionId}${note.path ? ` → ${note.path}` : ""}`);
  }
  if (result.graph && result.graph.ok) console.log(`图谱已重建：${result.graph.nodes} 节点（${result.graph.ms} ms）`);
  for (const warning of result.warnings || []) console.warn(`! ${warning}`);
}
process.exit(
  result.ok === false || (result.graph && result.graph.rebuilt === true && result.graph.ok === false) ? 1 : 0
);
