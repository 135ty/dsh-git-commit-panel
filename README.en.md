# dsh-git-commit-panel

English · [中文](README.md)

A DSH web GUI plugin: when the git repository of the current conversation's directory has uncommitted changes, a small pill floats in the page showing the branch, how many changes are pending and the added/removed line totals (e.g. `⑂ main 6 changed +61 -5`). Clicking it opens the commit card — write the message yourself or let AI draft it, then commit, or commit and push right away.

The behaviour mirrors ZCode's git tool: same trigger, same message rules (a Conventional Commit subject, type and scope in English, subject under 72 characters), same two actions.

## What it does

- **Appears only when it matters.** A clean work tree leaves no UI at all, and you never have to open a tab or a panel first.
- **Bound to the current conversation's workspace.** The pill always belongs to the directory the conversation in the main view sits in: switch conversations and it follows; another conversation's or another registered workspace's changes never take its place. It stays hidden while that directory is clean, is not a git repository, or is not a registered workspace.
- **Write the message, or let AI draft it.** `Generate with AI` drafts from the branch, the changed-file summary and diff excerpts using the deployment's default model (not the model your conversation has selected); an optional hint tells it the intent a diff cannot show.
- **An empty box is not an error.** Press `Commit` or `Commit & Push` with nothing typed and the message is drafted first, then committed.
- **Commits, or commits and pushes.** `Stage all changes before committing` decides whether the work tree is staged wholesale (including untracked files) or only what is already in the index; a missing upstream comes back as an actionable error.
- **Local and workspace-gated.** The browser cannot run git in an arbitrary directory, and the routes are reachable from this machine only.
- **Speaks both languages**, following the GUI locale, and follows the interface theme in light and dark alike.

## Install

Requires DeepSeek Harness `0.2.0-rc.1` or newer and `git` on the host `PATH`.

The plugin is not published to npm; it ships from GitHub only. Pick one:

```sh
# 1) prebuilt release asset (recommended: no full-repo download, no local build)
dsh plugin --profile web add https://github.com/135ty/dsh-git-commit-panel/releases/download/v0.1.0/dsh-git-commit-panel-0.1.0.tgz

# 2) straight from the GitHub source (downloads the whole repo and builds locally; needs Node.js 24+)
dsh plugin --profile web add github:135ty/dsh-git-commit-panel

# 3) pinned to a tag or commit
dsh plugin --profile web add github:135ty/dsh-git-commit-panel#v0.1.0

# 4) a local checkout (development: a link dependency, live after a rebuild and a reload)
dsh plugin --profile web add E:/path/to/dsh-git-commit-panel
```

Then restart `dsh web`.

> **Install it from `dsh web` / the CLI only.** The DSH Desktop client's install boundary accepts nothing but `name@x.y.z` from npm, so a GitHub-sourced plugin cannot be installed there — a limit of that client, not of this plugin.

## Development and verification

```sh
npm install          # brings the @deepseek-ai/dsh-* declarations typecheck resolves against
npm run verify       # typecheck + build + artifact contract check
npm run build        # build only: client (esbuild) -> lib/client.js, host (tsc declarations + esbuild) -> lib/index.js
npm run pack:release # pack the prebuilt release tarball and print the upload commands and asset URL
```

`lib/` is a build artifact and is committed: a GitHub-source install loads fine even when the repository's build script never ran.

The browser harnesses drive a real Chromium (`playwright-core` is a dev dependency) against a running GUI, so they need a tokenised base URL; their artifacts land in `artifacts/`:

```sh
node scripts/verify-panel.mjs <base-url-with-token> [expected unstaged count]
node scripts/verify-workspace.mjs <base-url-with-token> <conversation workspace>
node scripts/verify-theme.mjs <base-url-with-token> <workspace path>
node scripts/verify-generate.mjs <base-url-with-token>   # needs a working default model
node scripts/verify-failure.mjs [base-url]               # brings its own scratch DSH_HOME
```

Only `verify-generate.mjs` spends a real model call; `verify-failure.mjs` boots against a deliberately invalid key (`sk-invalid-key-for-failure-path-test`). No real credential lives in this repository.

## License

MIT.
