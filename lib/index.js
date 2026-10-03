// src/host/service.ts
import { realpath, stat } from "node:fs/promises";

// src/host/git.ts
var OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
var GIT_GRACE_MS = 2e4;
var DEFAULT_DIFF_MAX_BYTES = 64 * 1024;
var GitCommandError = class extends Error {
  constructor(message, code, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.name = "GitCommandError";
  }
};
var GitRunner = class {
  constructor(ctx, executable = "git") {
    this.ctx = ctx;
    this.executable = executable;
  }
  /**
   * Run `git <args>` to completion.
   * @param args - git arguments, never shell-interpreted.
   * @param cwd - working directory (the gated workspace or repository root).
   * @param signal - cancellation.
   * @returns exit facts and collected output.
   */
  async run(args, cwd, signal) {
    signal?.throwIfAborted();
    const handle = this.ctx.subprocess.spawn({
      argv: [this.executable, ...args],
      cwd,
      stdio: {
        stdin: "ignore",
        stdout: { maxBytes: OUTPUT_CAP_BYTES },
        stderr: { maxBytes: OUTPUT_CAP_BYTES }
      },
      graceMs: GIT_GRACE_MS,
      ...signal === void 0 ? {} : { signal }
    });
    const outcome = await handle.done;
    signal?.throwIfAborted();
    return {
      exitCode: outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? "",
      stderr: handle.collected.stderr?.readFrom(0).text ?? ""
    };
  }
  /**
   * Run `git <args>` and fail loudly on a nonzero exit, with a bounded stderr
   * tail attached to the error.
   * @param args - git arguments.
   * @param cwd - working directory.
   * @param signal - cancellation.
   * @param code - machine code the raised error carries.
   * @returns the collected output of a successful command.
   */
  async must(args, cwd, signal, code = "git-failed") {
    const result = await this.run(args, cwd, signal);
    if (result.exitCode !== 0) {
      throw new GitCommandError(
        `git ${args[0] ?? ""} failed`,
        code,
        tail(result.stderr.trim() || result.stdout.trim(), 600)
      );
    }
    return result;
  }
};
function tail(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `\u2026${text.slice(text.length - maxChars)}`;
}
function fieldAfter(record, spaces) {
  let seen = 0;
  for (let position = 0; position < record.length; position += 1) {
    if (record[position] !== " ") continue;
    seen += 1;
    if (seen === spaces) {
      const rest = record.slice(position + 1);
      return rest === "" ? void 0 : rest;
    }
  }
  return void 0;
}
function parsePorcelain(raw) {
  let branch = null;
  let detached = false;
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  const entries = [];
  const records = raw.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === void 0 || record === "") continue;
    if (record.startsWith("# ")) {
      const header = record.slice(2);
      if (header.startsWith("branch.head ")) {
        const value = header.slice("branch.head ".length).trim();
        detached = value === "(detached)";
        branch = detached ? null : value;
      } else if (header.startsWith("branch.upstream ")) {
        upstream = header.slice("branch.upstream ".length).trim();
      } else if (header.startsWith("branch.ab ")) {
        const match = /^\+(\d+)\s+-(\d+)$/.exec(header.slice("branch.ab ".length).trim());
        if (match !== null) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      }
      continue;
    }
    const type = record[0];
    if (type === "1") {
      const xy = record.slice(2, 4);
      const path = fieldAfter(record, 8);
      if (path !== void 0) entries.push({ xy, path });
      continue;
    }
    if (type === "2") {
      const xy = record.slice(2, 4);
      const path = fieldAfter(record, 9);
      const from = records[index + 1];
      index += 1;
      if (path !== void 0) {
        entries.push(from === void 0 || from === "" ? { xy, path } : { xy, path, from });
      }
      continue;
    }
    if (type === "u") {
      const xy = record.slice(2, 4);
      const path = fieldAfter(record, 10);
      if (path !== void 0) entries.push({ xy, path });
      continue;
    }
    if (type === "?") {
      const path = record.slice(2);
      if (path !== "") entries.push({ xy: "??", path });
      continue;
    }
  }
  return { branch, detached, upstream, ahead, behind, entries };
}
function classify(xy) {
  if (xy === "??") return "untracked";
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "unmerged";
  const index = xy[0] ?? ".";
  const worktree = xy[1] ?? ".";
  const letter = worktree !== "." ? worktree : index;
  switch (letter) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    case "M":
      return "modified";
    default:
      return "modified";
  }
}
function toFileChanges(entries) {
  return entries.map((entry) => {
    const index = entry.xy[0] ?? ".";
    const worktree = entry.xy[1] ?? ".";
    const untracked = entry.xy === "??";
    const change = {
      path: entry.path,
      kind: classify(entry.xy),
      staged: !untracked && index !== "." && index !== "?",
      unstaged: untracked || worktree !== "." && worktree !== "?"
    };
    if (entry.from !== void 0) change.from = entry.from;
    return change;
  });
}
function summarize(files) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (const file of files) {
    if (file.staged) staged += 1;
    if (file.unstaged) unstaged += 1;
    if (file.kind === "untracked") untracked += 1;
  }
  return { total: files.length, staged, unstaged, untracked };
}
async function readStatus(git, workspace, signal) {
  const rootResult = await git.run(["rev-parse", "--show-toplevel"], workspace, signal);
  if (rootResult.exitCode !== 0) return null;
  const root = rootResult.stdout.trim();
  if (root === "") return null;
  const status = await git.must(
    ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
    root,
    signal,
    "not-a-repository"
  );
  const parsed = parsePorcelain(status.stdout);
  const files = toFileChanges(parsed.entries);
  const summary = summarize(files);
  return {
    workspace,
    root,
    branch: parsed.branch,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files,
    summary,
    hasUnstagedChanges: files.some((file) => file.unstaged),
    hasStagedChanges: files.some((file) => file.staged)
  };
}
async function readDiff(git, root, options, signal) {
  const args = ["diff", "--no-color", "--no-ext-diff", "--unified=3"];
  if (options.staged) args.push("--cached");
  if (options.paths !== void 0 && options.paths.length > 0) {
    args.push("--", ...options.paths);
  }
  const result = await git.run(args, root, signal);
  const patch = result.stdout;
  const cap = options.maxBytes ?? DEFAULT_DIFF_MAX_BYTES;
  if (patch.length <= cap) {
    return { patch, truncated: false, bytes: patch.length };
  }
  return { patch: patch.slice(0, cap), truncated: true, bytes: cap };
}

// src/host/service.ts
var MAX_PROMPT_FILES = 30;
var MAX_PROMPT_FILE_CHARS = 80;
var MAX_PROMPT_DIFF_FILES = 10;
var MAX_PROMPT_DIFF_CHARS = 12e3;
var MAX_PROMPT_DIFF_CHARS_PER_FILE = 2e3;
var MAX_COMMIT_MESSAGE_CHARS = 1e3;
var MAX_HINT_CHARS = 500;
var CONVENTIONAL_COMMIT_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./@ -]+\))?!?: .{1,120}$/;
var DIFF_FOR_PROMPT_BYTES = 200 * 1024;
var ServiceError = class extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.name = "ServiceError";
  }
  /** The wire error this exception projects to. */
  toError() {
    const error = { code: this.code, message: this.message };
    if (this.detail !== void 0 && this.detail !== "") error.detail = this.detail;
    return error;
  }
};
var GitCommitService = class {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options;
    this.git = new GitRunner(ctx);
  }
  git;
  /**
   * Read one workspace's repository status.
   * @param request - the requested workspace path.
   * @param signal - cancellation.
   * @returns the status, or null when the workspace is not a repository.
   */
  async status(request, signal) {
    const canonical = await this.gated(request.path);
    return await readStatus(this.git, canonical, signal);
  }
  /**
   * Read a bounded unified diff of one workspace.
   * @param request - workspace, optional path restriction, staged choice, byte cap.
   * @param signal - cancellation.
   * @returns the patch payload.
   */
  async diff(request, signal) {
    const { canonical, root } = await this.gatedRepository(request.path, signal);
    void canonical;
    return await readDiff(
      this.git,
      root,
      { staged: request.staged === true, paths: request.paths, maxBytes: request.maxBytes },
      signal
    );
  }
  /**
   * Generate one Conventional Commit message for the workspace's changes.
   * @param request - workspace, optional path restriction/staged choice/locale/hint.
   * @param signal - cancellation following the HTTP request's lifetime.
   * @returns the message with the model identity that produced it.
   */
  async generateCommitMessage(request, signal) {
    const { canonical, root } = await this.gatedRepository(request.path, signal);
    const selection = this.ctx.agentDefaultModel.currentSelection();
    const provider = selection.provider?.trim() ?? "";
    const model = selection.model?.trim() ?? "";
    if (provider === "" || model === "") {
      throw new ServiceError("model-unavailable", "No default model is configured for this deployment.");
    }
    const status = await readStatus(this.git, canonical, signal);
    if (status === null) {
      throw new ServiceError("not-a-repository", "The workspace is not inside a git repository.");
    }
    const staged = request.staged === true;
    const selected = selectFiles(status.files, request.paths, staged);
    if (selected.length === 0) {
      throw new ServiceError("nothing-to-commit", staged ? "There are no staged changes to describe." : "There are no unstaged changes to describe.");
    }
    const diffs = await this.collectDiffs(root, selected, staged, signal);
    const prompt = buildCommitMessagePrompt({
      branch: status.branch,
      locale: request.locale,
      files: selected,
      diffs,
      hint: request.hint
    });
    const message = await this.complete(provider, model, prompt, signal);
    const validated = validateGeneratedCommitMessage(message);
    if (validated === null) {
      throw new ServiceError(
        "model-failed",
        "The model did not return a usable Conventional Commit message.",
        tail(message, 200)
      );
    }
    return { message: validated, provider, model };
  }
  /**
   * Stage (optionally), commit, and optionally push one workspace.
   * @param request - workspace, message, stageAll, push.
   * @param signal - cancellation.
   * @returns the created commit and whether the push leg ran.
   */
  async commit(request, signal) {
    const { root } = await this.gatedRepository(request.path, signal);
    const message = request.message.trim().slice(0, MAX_COMMIT_MESSAGE_CHARS);
    if (message === "") {
      throw new ServiceError("bad-request", "A commit message is required.");
    }
    if (request.stageAll) {
      await this.git.must(["add", "--all", "--", "."], root, signal);
    }
    const staged = await this.git.run(
      ["diff", "--cached", "--name-only", "-z"],
      root,
      signal
    );
    if (staged.exitCode !== 0) {
      throw new ServiceError("git-failed", "Could not inspect the index.", tail(staged.stderr, 400));
    }
    if (staged.stdout.split("\0").every((entry) => entry === "")) {
      throw new ServiceError("nothing-to-commit", "Nothing is staged, so there is nothing to commit.");
    }
    const committed = await this.git.run(["commit", "-m", message], root, signal);
    if (committed.exitCode !== 0) {
      throw new ServiceError(
        "git-failed",
        "git commit failed.",
        tail(committed.stderr.trim() || committed.stdout.trim(), 600)
      );
    }
    const head = await this.git.must(["rev-parse", "HEAD"], root, signal);
    const subject = await this.git.must(["log", "-1", "--pretty=%s"], root, signal);
    const branchResult = await this.git.run(["symbolic-ref", "--short", "-q", "HEAD"], root, signal);
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null;
    const result = {
      commit: head.stdout.trim(),
      subject: subject.stdout.trim(),
      branch,
      pushed: false
    };
    if (request.push === true) {
      const pushDetail = await this.push(root, signal);
      result.pushed = true;
      result.pushDetail = pushDetail;
    }
    return result;
  }
  /**
   * Push the current branch to its upstream.
   * @param root - repository top level.
   * @param signal - cancellation.
   * @returns the human-readable push summary (git's own stderr/stdout tail).
   */
  async push(root, signal) {
    const upstream = await this.git.run(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      root,
      signal
    );
    if (upstream.exitCode !== 0) {
      throw new ServiceError(
        "push-failed",
        "The current branch has no upstream, so it cannot be pushed automatically.",
        "Set one with: git push -u <remote> <branch>"
      );
    }
    const pushed = await this.git.run(["push"], root, signal);
    if (pushed.exitCode !== 0) {
      throw new ServiceError(
        "push-failed",
        "git push failed.",
        tail(pushed.stderr.trim() || pushed.stdout.trim(), 600)
      );
    }
    return tail(pushed.stderr.trim() || pushed.stdout.trim() || `pushed to ${upstream.stdout.trim()}`, 300);
  }
  /** Canonicalize + authorize a workspace path. */
  async gated(path) {
    const gate = await this.options.gate(path);
    if (!gate.ok) throw new ServiceError(gate.error.code, gate.error.message, gate.error.detail);
    return gate.canonical;
  }
  /** Canonicalize + authorize a workspace path and resolve its repository top level. */
  async gatedRepository(path, signal) {
    const canonical = await this.gated(path);
    const result = await this.git.run(["rev-parse", "--show-toplevel"], canonical, signal);
    if (result.exitCode !== 0) {
      throw new ServiceError("not-a-repository", "The workspace is not inside a git repository.");
    }
    const root = result.stdout.trim();
    if (root === "") {
      throw new ServiceError("not-a-repository", "The workspace is not inside a git repository.");
    }
    return { canonical, root };
  }
  /** Read one diff per selected file, bounded per file and in total. */
  async collectDiffs(root, files, staged, signal) {
    const out = [];
    for (const file of files.slice(0, MAX_PROMPT_DIFF_FILES)) {
      signal?.throwIfAborted();
      if (file.kind === "untracked") {
        out.push({ path: file.path, patch: "(new untracked file; no diff available)" });
        continue;
      }
      const payload = await readDiff(
        this.git,
        root,
        { staged, paths: [file.path], maxBytes: Math.max(DIFF_FOR_PROMPT_BYTES, MAX_PROMPT_DIFF_CHARS_PER_FILE) },
        signal
      );
      out.push({ path: file.path, patch: payload.patch });
    }
    return out;
  }
  /**
   * One non-streaming model call assembled from the streaming API. The call is
   * bounded by its own deadline and by the caller's lifetime, so a browser that
   * navigated away does not leave a provider request running.
   */
  async complete(provider, model, prompt, signal) {
    const controller = new AbortController();
    const timeoutMs = this.options.generateTimeoutMs ?? 6e4;
    const timer = setTimeout(
      () => controller.abort(new Error("commit message generation timed out")),
      timeoutMs
    );
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    let text = "";
    try {
      const stream = this.ctx.llm.stream({
        provider,
        model,
        system: "You write concise Conventional Commit messages. You answer with the commit message only.",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        temperature: 0.2,
        maxTokens: 400,
        purpose: "session-title",
        signal: controller.signal
      });
      for await (const chunk of stream) {
        if (chunk.type === "text-delta") text += chunk.text;
        if (chunk.type === "finish") {
          if (chunk.reason.kind === "error") {
            throw new ServiceError("model-failed", "The model call failed.", chunk.reason.failure.message);
          }
          if (chunk.reason.kind === "aborted") {
            throw new ServiceError("model-failed", "The model call was aborted.", chunk.reason.failure.message);
          }
        }
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        "model-failed",
        "The model request failed.",
        tail(error instanceof Error ? error.message : String(error), 400)
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (text.trim() === "") {
      throw new ServiceError("model-failed", "The model returned no text.");
    }
    return text.trim();
  }
};
function selectFiles(files, paths, staged) {
  const side = files.filter((file) => staged ? file.staged : file.unstaged);
  if (paths === void 0 || paths.length === 0) return side;
  const wanted = new Set(paths);
  return side.filter((file) => wanted.has(file.path));
}
function buildCommitMessagePrompt(input) {
  const branch = input.branch?.trim() || "(detached or unborn)";
  const language = (input.locale ?? "").toLowerCase().startsWith("zh") ? "Chinese" : "English";
  const visible = input.files.slice(0, MAX_PROMPT_FILES);
  const omitted = Math.max(0, input.files.length - visible.length);
  const fileLines = visible.map((file) => {
    const from = file.from === void 0 ? "" : ` (from ${file.from})`;
    const side = [file.staged ? "staged" : "", file.unstaged ? "unstaged" : ""].filter((part) => part !== "").join("+");
    return `- ${file.kind} ${file.path}${from} [${side || "clean"}]`.slice(0, MAX_PROMPT_FILE_CHARS);
  });
  let diffBudget = MAX_PROMPT_DIFF_CHARS;
  const diffChunks = [];
  for (const diff of input.diffs) {
    if (diffBudget <= 0) break;
    const body = diff.patch.trim() === "" ? "(no textual diff)" : diff.patch.trim();
    const limit = Math.min(MAX_PROMPT_DIFF_CHARS_PER_FILE, diffBudget);
    const clipped = body.length <= limit ? body : `${body.slice(0, limit)}
...diff truncated...`;
    const chunk = `--- ${diff.path}
${clipped}`;
    diffChunks.push(chunk);
    diffBudget -= chunk.length;
  }
  const lines = [
    "Write exactly one Git commit message for the workspace changes below.",
    "Return only the commit message text.",
    "",
    "Hard requirements:",
    "- The first line must be a valid Conventional Commit subject.",
    "- Use one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
    "- Keep the Conventional Commit type and optional scope in English.",
    `- Write the subject and any body in ${language}.`,
    "- Keep the subject under 72 characters.",
    "- Describe the change itself; never describe this instruction or your reasoning.",
    "- Do not wrap the message in quotes or code fences.",
    "",
    `Current branch: ${branch}`,
    `Current language: ${language}`,
    "",
    "Changed files:",
    fileLines.length > 0 ? fileLines.join("\n") : "- (no file summary available)"
  ];
  if (omitted > 0) lines.push(`- ... ${omitted} more changed files`);
  if (input.hint !== void 0 && input.hint.trim() !== "") {
    lines.push("", "Additional user intent (weigh it, do not quote it):", input.hint.trim().slice(0, MAX_HINT_CHARS));
  }
  lines.push("", "Diff excerpts:", diffChunks.length > 0 ? diffChunks.join("\n\n") : "(no diff available)", "");
  return lines.join("\n");
}
function validateGeneratedCommitMessage(raw) {
  const message = stripDecorations(raw).trim().slice(0, MAX_COMMIT_MESSAGE_CHARS).trim();
  if (message === "") return null;
  const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return CONVENTIONAL_COMMIT_RE.test(subject) ? message : null;
}
function stripDecorations(raw) {
  const trimmed = raw.trim();
  const fenced = /^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const withoutFence = (fenced?.[1] ?? trimmed).trim();
  const commitTag = /<commit>([\s\S]*?)<\/commit>/.exec(withoutFence);
  const withoutTag = (commitTag?.[1] ?? withoutFence).trim();
  const withoutPrefix = withoutTag.replace(/^commit message:\s*/i, "").trim();
  if (withoutPrefix.startsWith('"') && withoutPrefix.endsWith('"') || withoutPrefix.startsWith("'") && withoutPrefix.endsWith("'")) {
    return withoutPrefix.slice(1, -1);
  }
  return withoutPrefix;
}
function createWorkspaceGate(ctx) {
  return async (path) => {
    let canonical;
    try {
      canonical = await realpath(path);
    } catch {
      return { ok: false, error: { code: "workspace-unknown", message: "The path does not resolve on disk." } };
    }
    try {
      const info = await stat(canonical);
      if (!info.isDirectory()) {
        return { ok: false, error: { code: "workspace-unknown", message: "The path is not a directory." } };
      }
    } catch {
      return { ok: false, error: { code: "workspace-unknown", message: "The path does not resolve on disk." } };
    }
    const match = ctx.workspaceRegistry.list().some((workspace) => samePath(workspace.path, canonical));
    if (!match) {
      return {
        ok: false,
        error: {
          code: "workspace-unknown",
          message: "The path is not a registered workspace."
        }
      };
    }
    return { ok: true, canonical };
  };
}
function samePath(left, right) {
  if (left === right) return true;
  return process.platform === "win32" && left.toLowerCase() === right.toLowerCase();
}
function toWireError(error) {
  if (error instanceof ServiceError) return error.toError();
  if (error instanceof GitCommandError) {
    return { code: error.code, message: error.message, detail: error.detail ?? "" };
  }
  return {
    code: "internal",
    message: "The git operation failed unexpectedly.",
    detail: tail(error instanceof Error ? error.message : String(error), 400)
  };
}

// src/types.ts
var CHANGE_KINDS = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "unmerged",
  "untracked"
];
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}
function readStatusRequest(value) {
  if (!isRecord(value)) return null;
  return isNonEmptyString(value.path) ? { path: value.path } : null;
}
function readDiffRequest(value) {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.path)) return null;
  const paths = readStringArray(value.paths);
  if (paths === null) return null;
  const staged = typeof value.staged === "boolean" ? value.staged : void 0;
  const maxBytes = typeof value.maxBytes === "number" && Number.isFinite(value.maxBytes) && value.maxBytes > 0 ? Math.floor(value.maxBytes) : void 0;
  return { path: value.path, paths: paths ?? void 0, staged, maxBytes };
}
function readGenerateRequest(value) {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.path)) return null;
  const paths = readStringArray(value.paths);
  if (paths === null) return null;
  return {
    path: value.path,
    paths: paths ?? void 0,
    staged: typeof value.staged === "boolean" ? value.staged : void 0,
    locale: isNonEmptyString(value.locale) ? value.locale : void 0,
    hint: isNonEmptyString(value.hint) ? value.hint.slice(0, 500) : void 0
  };
}
function readCommitRequest(value) {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.path)) return null;
  if (typeof value.message !== "string" || value.message.trim() === "") return null;
  return {
    path: value.path,
    message: value.message,
    stageAll: value.stageAll === true,
    push: value.push === true
  };
}
function readStringArray(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) return null;
    out.push(item);
  }
  return out;
}
function isChangeKind(value) {
  return typeof value === "string" && CHANGE_KINDS.includes(value);
}
function isRepoStatus(value) {
  if (!isRecord(value)) return false;
  if (typeof value.workspace !== "string" || typeof value.root !== "string") return false;
  if (!(value.branch === null || typeof value.branch === "string")) return false;
  if (typeof value.detached !== "boolean") return false;
  if (!(value.upstream === null || typeof value.upstream === "string")) return false;
  if (typeof value.ahead !== "number" || typeof value.behind !== "number") return false;
  if (typeof value.hasUnstagedChanges !== "boolean" || typeof value.hasStagedChanges !== "boolean") return false;
  if (!Array.isArray(value.files)) return false;
  for (const file of value.files) {
    if (!isRecord(file)) return false;
    if (typeof file.path !== "string") return false;
    if (!isChangeKind(file.kind)) return false;
    if (typeof file.staged !== "boolean" || typeof file.unstaged !== "boolean") return false;
    if (file.from !== void 0 && typeof file.from !== "string") return false;
  }
  const summary = value.summary;
  if (!isRecord(summary)) return false;
  return typeof summary.total === "number" && typeof summary.staged === "number" && typeof summary.unstaged === "number" && typeof summary.untracked === "number";
}
function isDiffPayload(value) {
  return isRecord(value) && typeof value.patch === "string" && typeof value.truncated === "boolean" && typeof value.bytes === "number";
}
function isGenerateMessageResult(value) {
  return isRecord(value) && typeof value.message === "string" && typeof value.provider === "string" && typeof value.model === "string";
}
function isCommitResult(value) {
  return isRecord(value) && typeof value.commit === "string" && typeof value.subject === "string" && (value.branch === null || typeof value.branch === "string") && typeof value.pushed === "boolean";
}

// src/host/routes.ts
var ROUTE_PREFIX = "/git-commit";
var BODY_MAX_BYTES = 1024 * 1024;
var OK = (value) => ({ ok: true, value });
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk;
    size += buffer.length;
    if (size > BODY_MAX_BYTES) {
      req.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function writeJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer"
  });
  res.end(JSON.stringify(body));
}
function writeFailure(res, error) {
  const wire = toWireError(error);
  if (wire.code === "internal") {
    const detail = wire.detail ?? "";
    console.error(`[dsh-git-commit-panel] route failure: ${wire.message}${detail === "" ? "" : ` \u2014 ${detail}`}`);
  }
  writeJson(res, 200, { ok: false, error: wire });
}
function isTrustedRequest(req) {
  const address = req.socket.remoteAddress ?? "";
  const normalized = address.toLowerCase();
  const loopback = normalized === "::1" || normalized.startsWith("::ffff:127.") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
  if (!loopback) return false;
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let hostname;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  const loopbackHost = hostname === "localhost" || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (!loopbackHost) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function registerGitCommitRoutes(ctx, service) {
  const handler = async (req, res) => {
    if (!isTrustedRequest(req)) {
      writeJson(res, 403, { ok: false, error: { code: "bad-request", message: "forbidden: local requests only" } });
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      res.end();
      return;
    }
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      res.writeHead(415);
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      writeJson(res, 400, { ok: false, error: { code: "bad-request", message: "malformed request path" } });
      return;
    }
    const payload = await readJsonBody(req);
    if (payload === null) {
      writeJson(res, 200, { ok: false, error: { code: "bad-request", message: "malformed JSON body" } });
      return;
    }
    const controller = new AbortController();
    const onAborted = () => controller.abort(new Error("request aborted"));
    req.on("aborted", onAborted);
    const signal = controller.signal;
    try {
      switch (pathname) {
        case `${ROUTE_PREFIX}/status`: {
          const request = readStatusRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: "bad-request", message: "a workspace path is required" } });
          const status = await service.status(request, signal);
          if (status === null) {
            writeJson(res, 200, OK(null));
            return;
          }
          writeJson(res, 200, isRepoStatus(status) ? OK(status) : { ok: false, error: { code: "internal", message: "malformed status payload" } });
          return;
        }
        case `${ROUTE_PREFIX}/diff`: {
          const request = readDiffRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: "bad-request", message: "a workspace path is required" } });
          const diff = await service.diff(request, signal);
          writeJson(res, 200, isDiffPayload(diff) ? OK(diff) : { ok: false, error: { code: "internal", message: "malformed diff payload" } });
          return;
        }
        case `${ROUTE_PREFIX}/generate`: {
          const request = readGenerateRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: "bad-request", message: "a workspace path is required" } });
          const generated = await service.generateCommitMessage(request, signal);
          writeJson(res, 200, isGenerateMessageResult(generated) ? OK(generated) : { ok: false, error: { code: "internal", message: "malformed generation payload" } });
          return;
        }
        case `${ROUTE_PREFIX}/commit`: {
          const request = readCommitRequest(payload);
          if (request === null) return void writeJson(res, 200, { ok: false, error: { code: "bad-request", message: "a workspace path and a commit message are required" } });
          const result = await service.commit(request, signal);
          writeJson(res, 200, isCommitResult(result) ? OK(result) : { ok: false, error: { code: "internal", message: "malformed commit payload" } });
          return;
        }
        default:
          writeJson(res, 404, { ok: false, error: { code: "bad-request", message: "unknown route" } });
      }
    } catch (error) {
      writeFailure(res, error);
    } finally {
      req.off("aborted", onAborted);
    }
  };
  return ctx.webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler });
}

// src/index.ts
var name = "dsh-git-commit-panel";
var inject = ["webServer", "subprocess", "llm", "agentDefaultModel", "workspaceRegistry"];
function apply(ctx) {
  const service = new GitCommitService(ctx, { gate: createWorkspaceGate(ctx) });
  ctx.effect(
    () => registerGitCommitRoutes(ctx, service),
    "dsh-git-commit-panel: /git-commit routes"
  );
}
export {
  apply,
  inject,
  name
};
