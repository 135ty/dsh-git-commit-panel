# dsh-git-commit-panel

[English](README.md) · 中文

一个 DSH Web GUI 插件：当工作区内的 git 仓库有未提交改动时，**显示一个悬浮提交窗**。收起状态是一枚小胶囊，显示当前分支和待提交数量；点开后是提交卡片，提交信息可以手写，也可以让部署自身的模型起草，然后提交——或者提交后立即 `git push`。

行为对齐 ZCode 的 git 工具：触发条件相同（存在未暂存更改），提交信息规则相同（首行必须是 Conventional Commit，type 与 scope 用英文，主题不超过 72 字符），动作相同。

![悬浮胶囊与展开后的提交卡片](artifacts/panel-open.png)

## 功能

- **只在需要时出现。** 面板注册在页面级 `shell.overlay` 槽位，只有当某个已注册工作区位于 git 仓库内且存在未提交改动时才渲染；工作区干净时完全不占界面。
- **自动选择工作区。** 优先使用有会话正在工作的目录，其次回退到全部已注册工作区，按代价从低到高探测（只跑 `git status`，diff 在需要时才取）。
- **AI 起草提交信息。** `AI 生成` 会让 Host 侧根据分支、变更文件摘要、截断后的 diff 片段，以及可选的补充说明，生成一条 Conventional Commit 信息。
- **留空不是错误。** 什么都不填直接点 `提交` 或 `提交并推送` 时，先由 AI 起草信息，再用起草结果完成提交。卡片在输入框下方说明了这一点，生成后还会标出是哪个模型起草的。
- **提交，或提交并推送。** `提交前暂存全部更改` 决定是整体暂存（含未跟踪文件）还是只提交索引里已有的内容；`提交并推送` 会推送到已配置的上游，缺少上游时给出可操作的错误提示。
- **中英双语。** 插件自带中英文词典，跟随 GUI 语言切换。

### 用哪个模型起草

使用部署的默认模型（`agent-default-model`，例如 `deepseek-official/deepseek-flash`），**不跟随**你当前正在看的那个会话所选的模型。这是有意的选择：Host 侧没有会话上下文，这样永远有可用的路由，而且起草一条提交信息并不值得改动对话所用的模型。要换模型，改 profile 补丁里的部署默认值：

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-official
    model: deepseek-flash
```

generate 路由另外接受可选的 `{ provider, model }`，在该 provider 已注册适配器时优先使用，否则回退到默认值——这是为将来「跟随会话模型」预留的接口。面板当前不会传它，因为页面级浮层没有可靠的「当前会话」概念。

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

### 生成失败时怎么报

生成失败是一等公民式的失败，不会被吞掉：

- 卡片保留现场，在按钮下方显示失败信息，标题是**无法生成提交信息**（而不是"提交失败"），并带上 `[code]` 和 message；
- detail 行给出 provider 的原话和 request id，认证或额度问题可以直接从面板上看出来，例如 `[model-failed] The model call failed. Authentication Fails, Your api key: ****test is invalid (request_id: …)`；
- 同一行会同步打到浏览器控制台，不必为了看堆栈去复现那次点击；
- 留空却生成失败时**不会提交任何东西**：不做暂存、输入框保持为空、工作区原样不动，可以原地重试。

generate 路由可能返回的 code：`model-unavailable`（未配置默认模型）、`model-failed`（`detail` 带 provider 原因）、`nothing-to-commit`、`not-a-repository`、`workspace-unknown`、`bad-request`、`internal`。

![提交卡片中的失败提示](artifacts/failure-commit.png)

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
| `/git-commit/generate` | `{ path, paths?, staged?, locale?, hint?, provider?, model? }` | `{ message, provider, model }` |
| `/git-commit/commit` | `{ path, message, stageAll, push? }` | `{ commit, subject, branch, pushed, pushDetail? }` |

错误码：`bad-request`、`workspace-unknown`、`not-a-repository`、`git-failed`、`nothing-to-commit`、`model-unavailable`、`model-failed`、`push-failed`、`internal`。

## 主题与样式

面板**不自带任何设计**。所有颜色、圆角、阴影和字体都来自主题自己的 token 表（`dsh-client-ui-theme`），并按官方组件的组合方式拼装——所以在完全没做自定义样式的部署上，面板看起来就是这套 UI 的一部分，浅色、深色、跟随系统都成立：

| 元素 | 使用的 token |
|---|---|
| 卡片表面 | `bg-layer-2` + `elevation-prominent` + `radius-panel`（与官方设置面板同一组合） |
| 悬浮胶囊 | `button-floating-fill` + `border-l2` + `elevation-panel`（与官方浮动按钮一致） |
| 主操作 | `button-primary-fill` / `-hover` + `label-primary-foreground`（与官方主按钮一致） |
| 次操作 | 透明 + `border-l4`，hover 用 `interactive-bg-hover`（与官方 chip 一致） |
| 输入框 | `bg-layer-1` + `border-l4` + `radius-lg` |
| 次要文字 | `label-caption` + `font-xxs-12`；正文 `font-xs-13` |
| 错误文字 | `state-error-primary`（官方 103 处错误提示用的同一个 token） |

没有硬编码颜色、没有 `prefers-color-scheme` 分支、没有主题监听：token 在绘制时自然解析。`npm run verify:theme` 就是验证这一点——分别在两种模式下渲染胶囊与卡片，断言每个面色确实解析成了主题值（且深色下解析成**不同**的值），这正是能抓出"token 名写错导致静默回退"的那种检查。

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

`scripts/verify-panel.mjs` 与 `scripts/verify-generate.mjs` 会用真实 Chromium 驱动一个正在运行的实例，并把截图和 JSON 报告写入 `artifacts/`。面板校验脚本同时覆盖触发与起草契约：干净工作区不渲染任何窗口，注入改动后窗口回来，提交信息留空也能完成提交（先起草再提交），显式的生成动作会把内容填进输入框。

```sh
node scripts/verify-panel.mjs 'http://127.0.0.1:3199/?token=<token>' E:/path/to/workspace
node scripts/verify-generate.mjs 'http://127.0.0.1:3199/?token=<token>'
node scripts/verify-theme.mjs 'http://127.0.0.1:3199/?token=<token>' E:/path/to/workspace
node scripts/verify-failure.mjs        # 自己起一个凭据故意无效的实例
```

两者都需要 `playwright-core`（已在 devDependencies 中）和一个 Chromium 系浏览器；面板脚本还需要 `PATH` 中有 `git`，用于读取真实状态。`verify-failure.mjs` 是自包含的：它对一个凭据无效的临时 home 启动 DSH 实例，因此不会消耗可用的凭据。

## 模型体验

Host 侧**不新增任何面向模型的接口**：没有工具、没有命令、没有提示词片段。唯一的模型交互是用户显式触发的一次性调用，用于起草提交信息，内容限于分支名、变更文件摘要，以及用户本来就要提交的那些工作区的截断 diff。

## 许可

MIT。
