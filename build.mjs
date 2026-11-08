#!/usr/bin/env node
/**
 * 构建 dsh-brain 的浏览器半边：
 *   - app/viewer.html      gzip 后内嵌（渲染器，不含数据）
 *   - brain/graph.json     gzip 后内嵌（构建时数据快照，宿主路由不可用时的 fallback）
 * 用法：node build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const viewerPath = path.join(here, "app", "viewer.html");
const graphPath = path.join(here, "brain", "graph.json");
const templatePath = path.join(here, "lib", "client.template.js");
const outPath = path.join(here, "lib", "client.js");

const viewerHtml = fs.readFileSync(viewerPath, "utf8");
const graphText = fs.existsSync(graphPath) ? fs.readFileSync(graphPath, "utf8") : "{\"nodes\":[],\"edges\":[]}";
const template = fs.readFileSync(templatePath, "utf8");

const VIEWER_PLACEHOLDER = "var APP_GZIP_B64 = __BRAIN_GZIP_B64__;";
const GRAPH_PLACEHOLDER = "var GRAPH_GZIP_B64 = __GRAPH_GZIP_B64__;";
for (const placeholder of [VIEWER_PLACEHOLDER, GRAPH_PLACEHOLDER]) {
  if (!template.includes(placeholder)) {
    console.error("模板里找不到占位符：" + placeholder);
    process.exit(1);
  }
}

const viewerB64 = zlib.gzipSync(Buffer.from(viewerHtml, "utf8"), { level: 9 }).toString("base64");
const graphB64 = zlib.gzipSync(Buffer.from(graphText, "utf8"), { level: 9 }).toString("base64");
const out = template
  .replace(VIEWER_PLACEHOLDER, "var APP_GZIP_B64 = " + JSON.stringify(viewerB64) + ";")
  .replace(GRAPH_PLACEHOLDER, "var GRAPH_GZIP_B64 = " + JSON.stringify(graphB64) + ";");
fs.writeFileSync(outPath, out);

const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`viewer.html     ${mb(Buffer.byteLength(viewerHtml))} MB`);
console.log(`graph.json      ${mb(Buffer.byteLength(graphText))} MB`);
console.log(`client.js       ${mb(Buffer.byteLength(out))} MB  -> ${outPath}`);
