#!/usr/bin/env node
/**
 * tools/rebuild.mjs — 用本机知识库重建插件里的关系图谱。
 *
 * 用法：
 *   node tools/rebuild.mjs --demo                      # 用内置演示数据重建（发布/试玩）
 *   node tools/rebuild.mjs --workspace "D:/我的工作区"   # 扫描自己的工作区（md / docx / xlsx）
 *
 * 做的事：喂 vault（brain/vault）→ 跑 build_graph.py → 生成 app/brain.html
 *        → 重新内嵌进 lib/client.js。
 * 跑完刷新 DSH 页面（不行就重启一次）即可看到新图谱。
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pluginRoot = path.join(here, "..");
const brainDir = path.join(pluginRoot, "brain");
const python = process.env.DSH_BRAIN_PYTHON || "python";

const args = process.argv.slice(2);
const demo = args.includes("--demo");
const wsIdx = args.indexOf("--workspace");
const workspace = wsIdx >= 0 ? args[wsIdx + 1] : "";

if (!demo && !workspace) {
  console.error("用法：node tools/rebuild.mjs --demo | --workspace <目录>");
  process.exit(1);
}
if (workspace && !fs.existsSync(workspace)) {
  console.error(`工作区不存在：${workspace}`);
  process.exit(1);
}

function run(command, argv, cwd) {
  console.log(`\n$ ${command} ${argv.join(" ")}`);
  const result = spawnSync(command, argv, { cwd, stdio: "inherit", shell: false });
  if (result.error) {
    console.error(`运行失败：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

const pyScript = (name) => path.join(brainDir, name);

if (demo) {
  run(python, [pyScript("seed_demo.py")], pluginRoot);
} else {
  run(python, [pyScript("import_workspace.py"), "--workspace", workspace], pluginRoot);
}
run(python, [pyScript("build_graph.py")], pluginRoot);

const built = path.join(brainDir, "brain.html");
if (!fs.existsSync(built)) {
  console.error("没有生成 brain/brain.html，检查 build_graph.py 输出");
  process.exit(1);
}
fs.mkdirSync(path.join(pluginRoot, "app"), { recursive: true });
// 独立打开用（数据内嵌）
fs.copyFileSync(built, path.join(pluginRoot, "app", "brain.html"));
// 面板用（不含数据，打开时 fetch /api/dsh-brain/graph）
const tpl = fs.readFileSync(path.join(brainDir, "viewer_template.html"), "utf8");
fs.writeFileSync(
  path.join(pluginRoot, "app", "viewer.html"),
  tpl.replace("/*__BRAIN_DATA__*/", ""),
);

run(process.execPath, [path.join(pluginRoot, "build.mjs")], pluginRoot);

console.log("\n✔ 重建完成。数据已写入 brain/graph.json —— 重新打开 DSH 面板即最新（不用刷新页面）。");
console.log("  模板有改动时才需要刷新 DSH 页面。");
