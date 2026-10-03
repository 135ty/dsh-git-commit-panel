# dsh-git-commit-panel

[English](README.md) · 中文

一个 DSH Web GUI 插件：当工作区内的 git 仓库有未提交改动时，**显示一个悬浮提交窗**。收起状态是一枚小胶囊，显示当前分支和待提交数量；点开后是提交卡片，提交信息可以手写，也可以让部署自身的模型起草，然后提交——或者提交后立即 `git push`。

行为对齐 ZCode 的 git 工具：触发条件相同（存在未暂存更改），提交信息规则相同（首行必须是 Conventional Commit，type 与 scope 用英文，主题不超过 72 字符），动作相同。

![悬浮胶囊与展开后的提交卡片](artifacts/panel-open.png)

## 功能

- **只在需要时出现。** 面板注册在页面级 `shell.overlay` 槽位，只有当某个已注册工作区位于 git 仓库内且存在未提交改动时才渲染；工作区干净时完全不占界面。
- **自动选择工作区。** 优先使用有会话正在工作的目录，其次回退到全部已注册工作区，按代价从低到高探测（只跑 `git status`，diff 在需要时才取）。
- **AI 起草提交信息。** `AI 生成` 会让 Host 侧根据分支、变更文件摘要、截断后的 diff 片段，以及可选的补充说明，生成一条 Conventional Commit 信息。
- **提交，或提交并推送。** `提交前暂存全部更改` 决定是整体暂存（含未跟踪文件）还是只提交索引里已有的内容；`提交并推送` 会推送到已配置的上游，缺少上游时给出可操作的错误提示。
- **中英双语。** 插件自带中英文词典，跟随 GUI 语言切换。

## 安装

插件是标准的 DSH bundle，同时包含 Host 侧与浏览器侧。

```sh
# 本地目录（link 依赖，重新构建 lib/ 后刷新页面即可生效）
dsh plugin --profile web add E:/path/to/dsh-git-commit-panel

# 从 git 仓库安装（需要已提交 lib/）
dsh plugin --profile web add github:<owner>/<repo>
```

之后重启 `dsh web`。bundle 安装会改写 profile 清单和补丁层，因此必须先停掉正在运行的 profile；只重新构建 `lib/client.js` 时，客户端 HMR 会直接生效，无需重启。

如果只想临时验证、不改动 profile，可以用 overlay 挂载：

```sh
dsh web --patch ./plugin.patch.yml --port 3199 --no-open
```

```yaml
- insert:
    - id: git-commit-panel
      name: 'E:/path/to/dsh-git-commit-panel/lib/index.js'
```

## 构建结构

| 层 | 产物 | 职责 |
|---|---|---|
| Host 侧 | `lib/index.js` | `/git-commit/*` 路由、工作区闸门、全部 git 调用、模型调用。 |
| 浏览器侧 | `lib/client.js` | 一次 `shell.overlay` 注册：胶囊与提交卡片。 |
| 类型 | `lib/types/**` | 供其他包引用的声明。 |

`npm run build` 分两步：`scripts/build.mjs` 把浏览器侧打成经典脚本，注册 `window.__ModuleLoader__` 工厂（`react` 等平台模块保持外部依赖，其余全部内联）；`scripts/build-host.mjs` 把 Host 侧打成单个 ESM 入口，所有包保持外部依赖。

```sh
npm install
npm run verify      # 类型检查 + 构建 + client bundle 契约检查
```

`npm run check:bundle` 会在以下情况直接失败：`lib/client.js` 不是 ModuleLoader 工厂、require 了冻结模块表以外的模块、清单不再声明 `dsh.client.platform: web`。

## 通信接口

所有路由都是 `POST`，JSON 入参，出参为 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, detail? } }`。

| 路由 | 入参 | 出参 |
|---|---|---|
| `/git-commit/status` | `{ path }` | `RepoStatus`，或 `null`（不是仓库） |
| `/git-commit/diff` | `{ path, paths?, staged?, maxBytes? }` | `{ patch, truncated, bytes }` |
| `/git-commit/generate` | `{ path, paths?, staged?, locale?, hint? }` | `{ message, provider, model }` |
| `/git-commit/commit` | `{ path, message, stageAll, push? }` | `{ commit, subject, branch, pushed, pushDetail? }` |

错误码：`bad-request`、`workspace-unknown`、`not-a-repository`、`git-failed`、`nothing-to-commit`、`model-unavailable`、`model-failed`、`push-failed`、`internal`。

## 安全边界

浏览器不能随意指定运行 git 的目录。请求路径先经 `fs.realpath` 解析，然后必须**等于某个已注册工作区的路径**；子目录、符号链接逃逸、以及注册表之外的任何目录都会以 `workspace-unknown` 拒绝。此外路由仅限回环访问（socket 地址、`Host` 头、同源浏览器标记），并要求 JSON content-type，跨站表单无法驱动提交。接口不接受用户传入的 remote、ref 或 git 参数，服务只在通过闸门的仓库上执行固定的 git 动词。

## 配置

插件没有自己的设置项；AI 提交信息使用部署的默认模型（`agent-default-model`）。唯一的调节手段是路由参数，客户端会显式传入 `stageAll`。

## 开发

```
src/
  types.ts            wire 领域类型与出入参校验
  index.ts            Host 侧入口（服务 + 路由）
  host/git.ts         GitRunner、porcelain v2 解析、status/diff 读取
  host/service.ts     工作区闸门、git 动词、提示词与模型调用
  host/routes.ts      /git-commit/* 路由族
  client/index.ts     浏览器侧入口（槽位注册、状态源）
  client/Panel.tsx    胶囊与提交卡片
  client/api.ts       类型化 wire 客户端
  client/locales.ts   中英文文案
```

`scripts/verify-panel.mjs` 与 `scripts/verify-generate.mjs` 会用真实 Chromium 驱动一个正在运行的实例，并把截图和 JSON 报告写入 `artifacts/`。

## 模型体验

Host 侧**不新增任何面向模型的接口**：没有工具、没有命令、没有提示词片段。唯一的模型交互是用户显式触发的一次性调用，用于起草提交信息，内容限于分支名、变更文件摘要，以及用户本来就要提交的那些工作区的截断 diff。

## 许可

MIT。
