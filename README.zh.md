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
# 刷新 DSH 页面；没变化就完全退出再打开一次
```

管线会把笔记写进 `brain/vault/`，再重建 `app/brain.html` 并重新内嵌到 `lib/client.js`。

## 准实时同步：新资料自动进图谱

```bash
# 盯 ai-brain 的 vault（DSH 技能每次写记忆都会落到这里，改完约 1-3 秒重建）
node tools/watch.mjs --vault "C:/Users/pc/Documents/deepseek-harness/default-workspace/ai-brain/vault"

# 或盯一个资料目录（md / docx / xlsx）
node tools/watch.mjs --workspace "D:/我的资料"
```

变化 → 防抖 2.5s → 自动重建 → `app/brain.html` 更新。**刷新 DSH 页面**即可看到新节点。

> 这是「准实时」：浏览器半边的 HTML 是构建时内嵌的，所以还不能完全不刷新。
> 真·实时（运行时加载 `graph.json` + 前端轮询）在路线图里，需要把数据改成 host 路由下发。

## 性能（v0.2.3）

- **WebGL 批量渲染**：节点用 instanced quads、连线用 `gl.LINES` 一次性画完；缩放/平移只改矩阵，不重建几何。6398 节点的图单帧约 **0.6–1.2 ms**（旧版 Canvas2D 逐点绘制约 90 ms/帧）。
- **按需渲染**：没有动画/交互时**完全不跑 requestAnimationFrame**（静止 0 帧），和 Obsidian 关系图谱同一策略；打开「漂移」或「放电」才会连续出帧。
- **标签 LOD**：文字按缩放阈值出现，最多 64 个、重叠自动舍弃；标签与高亮单独一层 2D 画布，只画需要的那几十个。
- 没有 WebGL 的环境自动退回 2D 批量绘制（按类型合并 path），同样保留按需渲染。
- `brain.html` 以 gzip+base64 内嵌，**打开面板时才解压**；面板关闭即卸载 iframe，不再占用 CPU。

## 隐私

- 演示数据由 `brain/seed_demo.py` 用通用内容生成。
- `tools/rebuild.mjs --workspace` 只在本机读文件，不上传任何内容。
- 图谱在本地 Blob URL 的 iframe 里渲染，不发起网络请求。

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
