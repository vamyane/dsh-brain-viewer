#!/usr/bin/env node
/**
 * 从 DSH 的 desktop profile 里移除 dsh-brain-viewer（含旧名 dsh-brain）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const selfPkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

const args = process.argv.slice(2);
const profileIdx = args.indexOf("--profile");
const profileId = profileIdx >= 0 ? args[profileIdx + 1] : "desktop";
const profileDir = path.join(os.homedir(), ".dsh", "profiles", profileId);
const pkgPath = path.join(profileDir, "package.json");

if (!fs.existsSync(pkgPath)) {
  console.error(`找不到 profile：${profileDir}`);
  process.exit(1);
}

const names = [selfPkg.name, "dsh-brain"];
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const bundles = (pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles))
  ? pkg.dsh.profile.bundles.filter((name) => !names.includes(name))
  : [];
if (pkg.dsh && pkg.dsh.profile) pkg.dsh.profile.bundles = bundles;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

for (const name of names) fs.rmSync(path.join(profileDir, "node_modules", name), { recursive: true, force: true });

console.log("已移除 dsh-brain-viewer / dsh-brain（bundles + node_modules）");
console.log("重启 DSH 后左侧栏按钮消失。");
