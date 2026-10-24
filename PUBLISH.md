# 发布到 DSH 插件市场

发布流程（2026-10-25 更新到 0.3.0）：

1. `node tools/rebuild.mjs --demo` —— **必须**先用演示数据重建（真实 vault 绝不能进公开包）
2. `npm test` + `npm pack --dry-run` 自检
3. `npm publish --registry=https://registry.npmjs.org --access public`（本机 `~/.npmrc` 已配 npmjs token）
4. 同步 GitHub 仓库 `vamyane/dsh-brain-viewer`（tag + push）
5. 给 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR：`data/plugins/vamyane__dsh-brain-viewer.yml`

DSH 插件市场本质是 **npm 包索引 + 精选目录**：

1. 插件先发布到 npm（官方 registry，不是 npmmirror）
2. 目录站（awesome-dsh-plugin）收录后，市场才能搜到并安装
3. 用户用 `dsh plugin add <包名>` 或插件市场的「安装」按钮安装

包名 `dsh-brain-viewer` 已占用（v0.2.4 已发布）。本机 npm 登录态是 `~/.npmrc` 里的 npmjs token，注意默认 registry 是 npmmirror，验证/发布都要带 `--registry=https://registry.npmjs.org`。

## 发布命令

```powershell
cd C:\Users\pc\Documents\deepseek-harness\default-workspace\ai-brain\dsh-plugin
node tools/rebuild.mjs --demo
npm test
npm publish --registry=https://registry.npmjs.org --access public
npm view dsh-brain-viewer version --registry=https://registry.npmjs.org
```

发布成功后市场目录通常会自动收录；如果需要手动提 PR，到 awesome-dsh-plugin 仓库
（`awesome-dsh-plugin/awesome-dsh-plugin`）按它的 entry 格式加一条即可（本机 gh 已登录 `vamyane`，可以让 AI 代提）。

## 本地安装（不发布也能用）

```powershell
dsh plugin --profile desktop add C:\path\to\dsh-brain-viewer-0.3.0.tgz
```

或直接把 `dsh-plugin` 目录复制到 `~/.dsh/profiles/desktop/node_modules/dsh-brain-viewer`，
在 profile 的 `dsh.profile.bundles` 里追加 `dsh-brain-viewer`，然后重启 DSH。

## 数据边界（重要）

- 市场包内是 **演示数据**（`brain/seed_demo.py` 生成，通用内容），已扫描确认不含真实客户/项目信息。
- 要给自己的大脑用：`node tools/rebuild.mjs --workspace "你的目录"` 之后再打包/安装。
- 永远不要把带真实 vault 的包发布到公开 registry。
