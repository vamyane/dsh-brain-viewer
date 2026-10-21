#!/usr/bin/env node
/**
 * 把 dsh-brain-viewer 安装进 DSH 的 desktop profile（link 方式，避免被 pnpm 清理）。
 *
 * 关键点：DSH 启动时会跑一次 pnpm install；只写 dsh.profile.bundles 的话，
 * 插件会被当作「不在依赖树里」挪进 node_modules/.ignored。所以这里必须：
 *   1. 把插件复制到 <profile>/local-plugins/<包名>（稳定目录，不在 node_modules 里）
 *   2. 在 dependencies 里登记 "link:./local-plugins/<包名>"
 *   3. 写入 bundle 列表
 *   4. 建好 node_modules 链接
 * 最后需要手动跑一次 pnpm install（脚本会打印命令），然后完全退出 DSH 再打开。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const selfPkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const packageName = selfPkg.name;
const legacyNames = ["dsh-brain"];

const args = process.argv.slice(2);
const profileIdx = args.indexOf("--profile");
const profileId = profileIdx >= 0 ? args[profileIdx + 1] : "desktop";
const profileDir = path.join(os.homedir(), ".dsh", "profiles", profileId);
const pkgPath = path.join(profileDir, "package.json");

if (!fs.existsSync(profileDir) || !fs.existsSync(pkgPath)) {
  console.error(`找不到 profile：${profileDir}`);
  process.exit(1);
}

const backupPath = pkgPath + ".dsh-brain.bak";
const raw = fs.readFileSync(pkgPath, "utf8");
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, raw);
  console.log(`已备份 -> ${backupPath}`);
}

// 1) 复制到稳定目录
const sourceRoot = path.join(profileDir, "local-plugins", packageName);
fs.rmSync(sourceRoot, { recursive: true, force: true });
fs.mkdirSync(sourceRoot, { recursive: true });
const items = ["package.json", "lib", "app", "cordis.patch.yml", "brain", "tools", "build.mjs", "README.md", "README.zh.md"];
for (const item of items) {
  const source = path.join(here, item);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(sourceRoot, item), { recursive: true });
}
console.log(`插件已复制 -> ${sourceRoot}`);

// 2) 写 dependencies / bundles
const pkg = JSON.parse(raw);
pkg.dependencies = pkg.dependencies || {};
for (const legacy of legacyNames) delete pkg.dependencies[legacy];
pkg.dependencies[packageName] = `link:./local-plugins/${packageName}`;

pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
let bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
bundles = bundles.filter((name) => !legacyNames.includes(name));
if (!bundles.includes(packageName)) bundles.push(packageName);
pkg.dsh.profile.bundles = bundles;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("已写入 dependencies(link) 与 dsh.profile.bundles");

// 3) node_modules 链接
const linkPath = path.join(profileDir, "node_modules", packageName);
fs.rmSync(linkPath, { recursive: true, force: true });
fs.mkdirSync(path.dirname(linkPath), { recursive: true });
fs.symlinkSync(sourceRoot, linkPath, "junction");
console.log(`已建立链接 -> ${linkPath}`);

console.log("");
console.log("还差一步：在 profile 目录跑一次 pnpm install 更新锁文件，例如：");
console.log(`  cd "${profileDir}"`);
console.log("  pnpm install --config.fetch-retries=2");
console.log("然后完全退出 DSH 再重新打开。");
