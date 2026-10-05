# dsh-git-commit-panel

中文 · [English](README.en.md)

一个 DSH Web GUI 插件：当前对话所在目录的 git 仓库有未提交改动时，页面浮出一枚小胶囊（显示当前分支、待提交数量和增删行数，如 `⑂ main 6 个更改 +61 -5`），点开就是提交卡片——提交信息可以手写，也可以让 AI 起草，然后提交，或者提交后立即推送。

行为对齐 ZCode 的 git 工具：触发条件、提交信息规则（首行是 Conventional Commit，type 与 scope 用英文，主题不超过 72 字符）和两个动作都一致。

## 它做什么

- **只在需要时出现。** 工作区干净时完全不占界面，也不用先打开某个标签页或面板。
- **只认当前对话的工作区。** 胶囊始终属于主视图里那条对话所在的目录：换一条对话就跟着换，别的对话、别的已注册工作区有改动也不会顶上来。该目录干净、不是 git 仓库、或不是已注册工作区时，胶囊不出现。
- **提交信息可以手写，也可以让 AI 起草。** 点「AI 生成」由部署的默认模型（不跟随当前会话所选的模型）根据分支、变更文件摘要和 diff 片段起草；也可以补一句说明，告诉它 diff 里看不出来的意图。
- **留空点提交不算错。** 什么都不填直接点「提交」或「提交并推送」，会先起草信息再提交。
- **提交，或提交并推送。** 「提交前暂存全部更改」决定是整体暂存（含未跟踪文件）还是只提交索引里已有的内容；缺少上游时会给出可操作的报错。
- **只在本机、只对已注册工作区生效。** 浏览器不能指定任意目录跑 git，路由也仅限本机访问。
- **中英双语**，跟随 GUI 语言；浅色、深色都跟随界面主题。

## 安装

要求 DeepSeek Harness `0.2.0-rc.1` 及以上，Host 的 `PATH` 中有 `git`。

本插件不发布 npm 包，只从 GitHub 分发，下列方式选一种：

```sh
# 1) 预编译的 Release 包（推荐：不下载整个仓库，也不在本地构建）
dsh plugin --profile web add https://github.com/135ty/dsh-git-commit-panel/releases/download/v0.1.0/dsh-git-commit-panel-0.1.0.tgz

# 2) 直接从 GitHub 源安装（下载整个仓库并在本地构建，需要 Node.js 24+）
dsh plugin --profile web add github:135ty/dsh-git-commit-panel

# 3) 固定到某个 tag 或 commit
dsh plugin --profile web add github:135ty/dsh-git-commit-panel#v0.1.0

# 4) 本地目录（开发用；link 依赖，重新构建后刷新页面即生效）
dsh plugin --profile web add E:/path/to/dsh-git-commit-panel
```

之后重启 `dsh web`。

> **只在 `dsh web` / CLI 上安装。** DSH Desktop 客户端的安装边界只接受已发布到 npm 的 `name@x.y.z`，GitHub 源的插件在那边装不上——这是客户端的限制，不是插件的问题。

## 开发与验证

```sh
npm install          # 依赖里含类型检查所需的 @deepseek-ai/dsh-* 声明
npm run verify       # typecheck + 构建 + 产物契约检查
npm run build        # 只构建：client（esbuild）→ lib/client.js，host（tsc 声明 + esbuild）→ lib/index.js
npm run pack:release # 打出 Release 用的预编译 tgz，并打印上传命令与资产地址
```

`lib/` 是构建产物且已提交：从 GitHub 源安装时，即使仓库里的构建脚本没跑，插件也能正常加载。

浏览器验证脚本都驱动真实 Chromium（`playwright-core` 已在 devDependencies），需要一个带 token 的运行中 GUI；产物写在 `artifacts/`：

```sh
node scripts/verify-panel.mjs <base-url-with-token> [期望的未提交文件数]
node scripts/verify-workspace.mjs <base-url-with-token> <对话所在工作区>
node scripts/verify-theme.mjs <base-url-with-token> <工作区路径>
node scripts/verify-generate.mjs <base-url-with-token>   # 需要部署有可用的默认模型
node scripts/verify-failure.mjs [base-url]               # 自带凭据无效的临时 DSH_HOME
```

只有 `verify-generate.mjs` 会真正调用模型；`verify-failure.mjs` 用的是故意写坏的假 key（`sk-invalid-key-for-failure-path-test`），仓库里没有任何真实凭据。

## 许可

MIT。
