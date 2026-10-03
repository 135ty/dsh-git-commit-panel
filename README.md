# dsh-git-commit-panel

English · [中文](README.zh.md)

A DSH web GUI plugin that shows a **floating commit window** in any workspace whose git repository has work-tree changes. The pill shows the branch and the pending count; clicking it opens a commit card where the message is either written by hand or drafted by the deployment's own model, and then committed — optionally with an immediate `git push`.

The behaviour mirrors ZCode's git tool: same trigger (unstaged changes), same message rules (one Conventional Commit subject, type and scope in English, subject under 72 characters), same two actions.

![Floating commit pill and open commit card](artifacts/panel-open.png)

## What it does

- **Appears only when it matters.** The panel is mounted in the frame-wide `shell.overlay` seat and renders nothing until a registered workspace inside a git repository reports work-tree changes. A clean tree leaves no UI at all.
- **Picks the workspace for you.** It prefers the directories an active session is working in, then falls back to every registered workspace, and inspects candidates cheapest-first (`git status` only; diffs are fetched on demand).
- **Drafts the message with AI.** `Generate with AI` asks the host half for a Conventional Commit message built from the branch, the changed-file summary, bounded diff excerpts, and an optional free-text hint.
- **An empty box is not an error.** Press `Commit` or `Commit & Push` with nothing typed and the AI drafts the message first; that drafted text is what gets committed. The card says so under the message box, and the box shows which model drafted it.
- **Commits, or commits and pushes.** `Stage all changes before committing` controls whether the work tree is staged wholesale (including untracked files) or only what is already in the index. `Commit & Push` pushes to the configured upstream and reports a missing upstream as an actionable error.
- **Speaks both languages.** English and Chinese dictionaries ship with the plugin and follow the GUI locale.

### Which model drafts the message

The deployment's default model (`agent-default-model`, e.g. `deepseek-official/deepseek-flash`) — **not** the model currently selected in the conversation you happen to be looking at. That choice is deliberate: the host half has no session context, so it always has a usable route, and drafting a commit subject is not worth changing the model your conversation runs on. Change it by editing the deployment default in the profile patch:

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-official
    model: deepseek-flash
```

The generate route also accepts an optional `{ provider, model }` pair and honours it when an adapter is registered for that provider, falling back to the default otherwise — the hook for a future per-session follow mode. The panel itself does not send it today, because a frame-wide overlay has no reliable notion of "the current session".

## Install

The plugin is a normal DSH bundle with a host half and a browser half.

```sh
# local checkout (a link dependency; edits to lib/ are live after a reload)
dsh plugin --profile web add E:/path/to/dsh-git-commit-panel

# from a git host (requires lib/ to be committed)
dsh plugin --profile web add github:<owner>/<repo>
```

Then restart `dsh web`. Bundle installation writes the profile manifest and its patch layer, so a running profile has to be stopped first; a rebuild of `lib/client.js` alone is picked up by the client HMR receiver without a restart.

For throwaway testing without touching your profile, mount it with an overlay instead:

```sh
dsh web --patch ./plugin.patch.yml --port 3199 --no-open
```

with

```yaml
- insert:
    - id: git-commit-panel
      name: 'E:/path/to/dsh-git-commit-panel/lib/index.js'
```

## How it is built

| Layer | Artifact | What it owns |
|---|---|---|
| Node half | `lib/index.js` | The `/git-commit/*` routes, the workspace gate, every git invocation, and the model call. |
| Browser half | `lib/client.js` | One `shell.overlay` registration: the pill and the commit card. |
| Types | `lib/types/**` | Declarations for embedders. |

`npm run build` runs two independent steps: `scripts/build.mjs` bundles the browser half as a classic script registering a `window.__ModuleLoader__` factory (platform modules like `react` stay external, everything else is inlined), and `scripts/build-host.mjs` bundles the node half as one ESM entry with all packages external.

```sh
npm install
npm run verify      # typecheck + build + client-bundle contract check
```

`npm run check:bundle` fails the build when `lib/client.js` is not a ModuleLoader factory, when it requires anything outside the frozen browser module table, or when the manifest stops declaring `dsh.client.platform: web`.

## Wire API

Every route is `POST`, JSON in, `{ ok: true, value }` or `{ ok: false, error: { code, message, detail? } }` out.

| Route | Payload | Result |
|---|---|---|
| `/git-commit/status` | `{ path }` | `RepoStatus` or `null` (not a repository) |
| `/git-commit/diff` | `{ path, paths?, staged?, maxBytes? }` | `{ patch, truncated, bytes }` |
| `/git-commit/generate` | `{ path, paths?, staged?, locale?, hint?, provider?, model? }` | `{ message, provider, model }` |
| `/git-commit/commit` | `{ path, message, stageAll, push? }` | `{ commit, subject, branch, pushed, pushDetail? }` |

Error codes: `bad-request`, `workspace-unknown`, `not-a-repository`, `git-failed`, `nothing-to-commit`, `model-unavailable`, `model-failed`, `push-failed`, `internal`.

## Security boundary

The browser never names a directory it is allowed to run git in freely. A request path is resolved with `fs.realpath` and then required to **equal a registered workspace path**; a subdirectory, a symlink escape, or any directory outside the registry is refused with `workspace-unknown`. On top of that the routes are loopback-only (socket address, `Host` header, and same-origin browser markers) and require a JSON content-type, so a cross-site form cannot drive a commit. There is no user-supplied remote, ref, or git option: the service only runs fixed verbs against the gated repository.

## Configuration

The plugin has no settings of its own; it follows the deployment's default model (`agent-default-model`) for AI messages. The routes are the only tuning surface, and the client passes `stageAll` explicitly.

## Development

```
src/
  types.ts            wire domain + inbound/outbound guards
  index.ts            host half entry (service + routes)
  host/git.ts         GitRunner, porcelain v2 parser, status/diff readers
  host/service.ts     workspace gate, git verbs, prompt + model call
  host/routes.ts      /git-commit/* route family
  client/index.ts     browser half entry (slot registration, status source)
  client/Panel.tsx    the pill and the commit card
  client/api.ts       typed wire client
  client/locales.ts   en/zh copy
```

`scripts/verify-panel.mjs` and `scripts/verify-generate.mjs` drive a real Chromium against a running instance and write screenshots plus a JSON report into `artifacts/`. The panel harness also exercises the trigger and drafting contracts itself: a clean work tree renders no window, a seeded change brings it back, an empty message box still commits (drafting first), and the explicit generate action fills the box.

```sh
node scripts/verify-panel.mjs 'http://127.0.0.1:3199/?token=<token>' E:/path/to/workspace
node scripts/verify-generate.mjs 'http://127.0.0.1:3199/?token=<token>'
```

Both need `playwright-core` (already a dev dependency) and a Chromium-based browser; the panel harness additionally needs `git` on `PATH` for its ground-truth reads.

## Model experience

The host half adds **no** model-facing surface: no tool, no command, and no prompt fragment. Its only model interaction is the explicit, user-initiated one-shot call that drafts a commit message, which sends the branch name, the changed-file summary, and bounded diff excerpts of the workspace the user is already committing.

## License

MIT.
