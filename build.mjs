#!/usr/bin/env node
/**
 * 构建 dsh-brain 的浏览器半边：把 app/brain.html gzip 后内嵌进 lib/client.js。
 * gzip+base64 让 client.js 从 ~3.6MB 降到 ~1MB 以内，打开面板时才解压。
 * 用法：node build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const brainHtmlPath = path.join(here, "app", "brain.html");
const templatePath = path.join(here, "lib", "client.template.js");
const outPath = path.join(here, "lib", "client.js");

const brainHtml = fs.readFileSync(brainHtmlPath, "utf8");
const template = fs.readFileSync(templatePath, "utf8");
const PLACEHOLDER = "var APP_GZIP_B64 = __BRAIN_GZIP_B64__;";
if (!template.includes(PLACEHOLDER)) {
  console.error("模板里找不到 APP_GZIP_B64 占位符");
  process.exit(1);
}

const gz = zlib.gzipSync(Buffer.from(brainHtml, "utf8"), { level: 9 });
const b64 = gz.toString("base64");
const out = template.replace(PLACEHOLDER, "var APP_GZIP_B64 = " + JSON.stringify(b64) + ";");
fs.writeFileSync(outPath, out);

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`brain.html      ${mb(Buffer.byteLength(brainHtml))} MB`);
console.log(`gzip            ${mb(gz.length)} MB`);
console.log(`client.js       ${mb(Buffer.byteLength(out))} MB  -> ${outPath}`);
