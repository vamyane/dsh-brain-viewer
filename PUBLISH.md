# 发布到 DSH 插件市场

这个包已经打好：`dsh-brain-viewer-0.2.1.tgz`（237 KB，476 个文件，演示数据 + 完整知识库管线）。

## 为什么还不能一键上架

DSH 插件市场本质上是一个 **npm 包索引**：

1. 插件先发布到 npm（官方 registry，不是 npmmirror）
2. 市场目录（awesome-dsh-plugin）抓取带 `dsh-plugin` 关键词的 npm 包并收录
3. 用户用 `dsh plugin add <包名>` 或插件市场的「安装」按钮安装

这台机器的 npm **没有登录态**（`npm whoami` 报 ENEEDAUTH），所以最后一步 `npm publish` 需要你来做（或提供 token 给 AI 执行）。包名已确认可用：`dsh-brain-viewer`。

## 发布命令（两分钟）

```powershell
cd C:\Users\pc\Documents\deepseek-harness\default-workspace\ai-brain\dsh-plugin

# 1) 登录 npm（浏览器授权，只需一次）
npm login --registry=https://registry.npmjs.org

# 2) 发布
npm publish --registry=https://registry.npmjs.org --access public

# 3) 验证
npm view dsh-brain-viewer version
```

发布成功后市场目录通常会自动收录；如果需要手动提 PR，到 awesome-dsh-plugin 仓库
（GitHub 上搜索 `awesome-dsh-plugin`）按它的 entry 格式加一条即可（本机 gh 已登录 `vamyane`，可以让 AI 代提）。

## 发布前自检

```powershell
npm run test        # 离线冒烟：内嵌 HTML / 槽位注册 / 组件渲染
npm pack --dry-run  # 看包内容和体积
```

## 本地安装（不发布也能用）

```powershell
dsh plugin --profile desktop add C:\path\to\dsh-brain-viewer-0.2.1.tgz
```

或直接把 `dsh-plugin` 目录复制到 `~/.dsh/profiles/desktop/node_modules/dsh-brain-viewer`，
在 profile 的 `dsh.profile.bundles` 里追加 `dsh-brain-viewer`，然后重启 DSH。

## 数据边界（重要）

- 市场包内是 **演示数据**（`brain/seed_demo.py` 生成，通用内容），已扫描确认不含真实客户/项目信息。
- 要给自己的大脑用：`node tools/rebuild.mjs --workspace "你的目录"` 之后再打包/安装。
- 永远不要把带真实 vault 的包发布到公开 registry。
