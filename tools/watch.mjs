#!/usr/bin/env node
/**
 * tools/watch.mjs — 监听知识来源，变化后自动重建脑形图谱（准实时）。
 *
 * 用法：
 *   node tools/watch.mjs --vault "C:/.../ai-brain/vault"        # 盯一个 Markdown vault（最快）
 *   node tools/watch.mjs --workspace "D:/我的资料"               # 盯原始资料目录（md/docx/xlsx）
 *   node tools/watch.mjs --demo                                # 演示模式：盯插件自带的 demo vault
 *
 * 原理：fs.watch 递归监听 → 防抖 2.5s → 跑 pipeline → 写 app/brain.html → 重新内嵌进 client.js。
 * 生效：刷新 DSH 页面即可看到新图谱（客户端模块是构建时内嵌的，所以不能完全免刷新）。
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
const vaultIdx = args.indexOf("--vault");
const wsIdx = args.indexOf("--workspace");
const vault = vaultIdx >= 0 ? args[vaultIdx + 1] : "";
const workspace = wsIdx >= 0 ? args[wsIdx + 1] : "";

if (!demo && !vault && !workspace) {
  console.error("用法：node tools/watch.mjs --vault <vault目录> | --workspace <资料目录> | --demo");
  process.exit(1);
}

function run(command, argv, cwd) {
  const result = spawnSync(command, argv, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`退出码 ${result.status}`);
}

let busy = false;
let quietUntil = 0;

function rebuild() {
  busy = true;
  const started = Date.now();
  console.log(`\n[${new Date().toLocaleTimeString()}] 检测到变化，开始重建…`);
  try {
    if (demo) {
      run(python, [path.join(brainDir, "seed_demo.py")], pluginRoot);
      run(python, [path.join(brainDir, "build_graph.py")], pluginRoot);
    } else if (vault) {
      run(python, [path.join(brainDir, "build_graph.py"), "--vault", vault], pluginRoot);
    } else {
      run(python, [path.join(brainDir, "import_workspace.py"), "--workspace", workspace], pluginRoot);
      run(python, [path.join(brainDir, "build_graph.py")], pluginRoot);
    }
    fs.copyFileSync(path.join(brainDir, "brain.html"), path.join(pluginRoot, "app", "brain.html"));
    run(process.execPath, [path.join(pluginRoot, "build.mjs")], pluginRoot);
    console.log(`✔ 重建完成（${((Date.now() - started) / 1000).toFixed(1)}s）。刷新 DSH 页面查看。`);
  } catch (error) {
    console.error("✘ 重建失败：", error.message);
  } finally {
    busy = false;
    // 忽略重建过程自己写文件产生的事件，避免自触发死循环
    quietUntil = Date.now() + 4000;
  }
}

const watchDir = demo ? path.join(brainDir, "vault") : vault || workspace;
if (!fs.existsSync(watchDir)) {
  console.error(`监听目录不存在：${watchDir}`);
  process.exit(1);
}

let timer = null;
function schedule() {
  if (busy || Date.now() < quietUntil) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!busy) rebuild();
  }, 2500);
}

console.log(`👀 监听中：${watchDir}`);
console.log("   修改/新增 .md（或 md/docx/xlsx）后会自动重建；Ctrl+C 退出。");
if (args.includes("--start")) rebuild();

fs.watch(watchDir, { recursive: true }, (_event, filename) => {
  if (filename !== null && !/\.(md|markdown|docx|xlsx)$/i.test(String(filename))) return;
  console.log(`   ~ ${filename}`);
  schedule();
});

process.on("SIGINT", () => {
  console.log("\n已停止监听。");
  process.exit(0);
});
