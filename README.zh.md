# dsh-brain-viewer

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 用的 **AI 大脑关系图谱**插件：
左侧栏一键打开脑形图谱，并把「知识库提取 → 编译 → 可视化」整条管线打包了进来。

## 能做什么

- **左栏入口**：左侧栏底部的「🧠 AI 大脑」按钮，点开全屏关系图谱。
- **脑形布局**：把成百上千篇笔记压进一个真实的大脑剪影（取自 🧠 字形轮廓），
  带簇心、神经元漂移、悬停高亮、拖拽回弹和神经放电。
- **知识库管线**：`brain/` 里带完整 Markdown 管线：
  扫描工作区（`md` / `docx` / `xlsx`）→ 按小节拆成记忆单元 → 写 Obsidian 兼容的
  `[[双链]]` 笔记 → 编译成图谱。
- **会话自动复盘入库（v0.4.0）**：面板右上角一键把「今天」的 DSH 会话压成 episode 记忆写进 vault，
  顺便重建图谱。全程本地，不调 LLM。
- **自带演示数据**：开箱即用，不含任何私人内容。

## 安装

```bash
dsh plugin --profile desktop add dsh-brain-viewer
```

装完**完全退出 DSH 再打开**，左侧栏底部会出现「🧠 AI 大脑」。

## 用你自己的知识库重建

需要 Node.js 20+ 和 Python 3.8+（只有重建需要，看图不需要）。

```bash
node tools/rebuild.mjs --workspace "D:/我的笔记"   # 扫描自己的目录
node tools/rebuild.mjs --demo                      # 恢复演示大脑
# 数据写进 brain/graph.json —— 重新打开面板即最新，不用刷新页面
```

管线会把笔记写进 `brain/vault/`，并生成 `brain/graph.json`（面板实时读它）。

## 实时同步：新资料立刻进图谱

```bash
# 盯 ai-brain 的 vault（DSH 技能每次写记忆都会落到这里，改完约 1-3 秒重建）
node tools/watch.mjs --vault "C:/Users/pc/Documents/deepseek-harness/default-workspace/ai-brain/vault"

# 或盯一个资料目录（md / docx / xlsx）
node tools/watch.mjs --workspace "D:/我的资料"
```

变化 → 防抖 2.5s → 重算 `brain/graph.json`。面板**每次打开都会重新 fetch**
`/api/dsh-brain/graph`，所以重开面板就是最新，**不需要重新打包、也不需要刷新页面**。

## 数据源（v0.3.1）

面板不再内嵌数据，打开时向宿主请求：

```
GET /api/dsh-brain/graph  →  brain/graph.json
```

面板在 DSH 页面上下文里取数（同源、带登录态）；宿主路由不可用时自动退回构建时快照，右上角会显示「实时」或「快照」。

- 默认读插件自己的 `brain/graph.json`（演示数据，或你用 rebuild 生成的数据）。
- 想指向别处（例如技能维护的 vault 产物），写一个配置文件：

```json
// ~/.dsh/brain-viewer.config.json
{ "graphPath": "C:/Users/pc/Documents/deepseek-harness/default-workspace/ai-brain/graph.json" }
```

改完**重启一次 DSH** 让宿主路由生效；之后数据变化只要重开面板。

## 会话自动复盘入库（v0.4.0）

DSH 每段会话都落在 `~/.dsh/sessions/<工作区>/<会话 id>/session.v4.jsonl.zstd`（zstd 压缩的 JSONL）。
面板 header 现在有一条工具行：**「复盘入库」按钮** + 状态行
（`今天已入库 N 条 · 最近记忆 YYYY-MM-DD · 可见会话 M`）。

| 路由 | 作用 |
| --- | --- |
| `GET /api/dsh-brain/ingest/status` | 今天已入库条数 / 最近记忆日期 / 可见会话数 |
| `POST /api/dsh-brain/ingest/run` | 扫描今天的会话 → 写 episode 笔记 → 重建图谱 → `{written, updated, skipped, nodes}` |

抽取是本地启发式的，**不调用任何模型**：首条真人用户消息当标题，用户意图列表 + 助手最终结论当正文，
再统计一下工具调用，并自动双链到 2–3 篇已有枢纽笔记。笔记写到
`vault/episodes/YYYY-MM/YYYY-MM-DD · 会话复盘 · <标题> (<会话短 id>).md`。

**幂等**：每篇自动笔记的 frontmatter 里带 `source: dsh-session-ingest` 和 `session: <id>`。
再点一次只会**原地更新同一篇**（会话有新内容时），不会重复写。子会话（subagent）和其他工作区的会话默认跳过
（`includeSubagent: true` 可放开）。

vault 配置（能推断就只写 `graphPath`，插件会自动找同目录的 `vault/` 与 `build_graph.py`）：

```json
// ~/.dsh/brain-viewer.config.json
{
  "graphPath": "C:/Users/pc/Documents/deepseek-harness/default-workspace/ai-brain/graph.json",
  "vaultPath": "C:/Users/pc/Documents/deepseek-harness/default-workspace/ai-brain/vault",
  "sessionsPath": "C:/Users/pc/.dsh/sessions",
  "workspaceRoot": "C:/Users/pc/Documents/deepseek-harness/default-workspace",
  "python": "python"
}
```

只写 `graphPath` 或 `vaultPath` 就够。**没配置真实 vault 时插件拒绝写入**，免得把会话写进包里的演示数据。
命令行也能跑：

```bash
node tools/ingest.mjs --status     # 只读：今天入库数 / 最近记忆 / 可见会话
node tools/ingest.mjs --dry-run    # 预览会写哪些笔记，不落盘
node tools/ingest.mjs              # 真正写入 + 重建图谱
node tools/ingest.mjs --date 2026-11-08
```

环境要求：入库需要带 zstd 的 Node（Node >= 22.15 或 >= 23.8；DSH 自带 Node 24）；
只有重建图谱需要 Python。`build_graph.py` 失败时笔记照常写入，返回里会带 `graph.ok: false` 和告警。

## 性能（v0.3.1）

- **WebGL 批量渲染**：节点用 instanced quads、连线用 `gl.LINES` 一次性画完；缩放/平移只改矩阵，不重建几何。6398 节点的图单帧约 **0.6–1.2 ms**（旧版 Canvas2D 逐点绘制约 90 ms/帧）。
- **按需渲染**：没有动画/交互时**完全不跑 requestAnimationFrame**（静止 0 帧），和 Obsidian 关系图谱同一策略；打开「漂移」或「放电」才会连续出帧。
- **标签 LOD**：文字按缩放阈值出现，最多 64 个、重叠自动舍弃；标签与高亮单独一层 2D 画布，只画需要的那几十个。
- **数据走宿主路由**：client.js 从 1 MB 降到约 **0.1 MB**，数据不进包、变更免重打包。
- 没有 WebGL 的环境自动退回 2D 批量绘制（按类型合并 path），同样保留按需渲染。
- 面板关闭即卸载 iframe，不再占用 CPU。

## 隐私

- 演示数据由 `brain/seed_demo.py` 用通用内容生成；公开包里不含任何真实笔记。
- `tools/rebuild.mjs --workspace` 只在本机读文件，不上传任何内容。
- 数据经本机回环 HTTP `/api/dsh-brain/graph` 读取，需要 DSH 登录态；不连接外部服务。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-brain-viewer
```

## License

MIT

## 排障：重启后左侧按钮消失

DSH 每次启动会跑 pnpm install。如果插件只出现在 `dsh.profile.bundles` 而不在 `dependencies` 里，
pnpm 会把它当成「不在依赖树中」挪进 `node_modules/.ignored/`，按钮就消失了。

正确安装方式（`install.mjs` 已按此实现）：

1. 插件放在 `<profile>/local-plugins/dsh-brain-viewer`（不要直接放 node_modules）
2. `dependencies` 里写 `"dsh-brain-viewer": "link:./local-plugins/dsh-brain-viewer"`
3. `pnpm install` 让锁文件记录这条 link
4. 重启 DSH

如果 pnpm 报 `minimumReleaseAge` / supply-chain policy 失败（常见于某个依赖的子包在镜像里缺少版本），
在 profile 的 `pnpm-workspace.yaml` 里把该包加进 `minimumReleaseAgeExclude`，例如：

```yaml
minimumReleaseAgeExclude:
  - dsh-ops@0.4.1
  - '@dsh-ops/bash-win32-x64@0.2.1'
```
