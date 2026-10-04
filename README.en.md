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

Requires DeepSeek Harness `0.2.0-rc.1` or newer, `git` on the host `PATH`, and Node.js 24+ to build.

```sh
# local checkout
dsh plugin --profile web add E:/path/to/dsh-git-commit-panel

# from a git host (requires lib/ to be committed)
dsh plugin --profile web add github:<owner>/<repo>
```

Then restart `dsh web`. Once it is on npm, this also works:

```sh
dsh plugin --profile web add dsh-git-commit-panel
```

(The package is not published to npm yet — use one of the source installs above.)

## License

MIT.
