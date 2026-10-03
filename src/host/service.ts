/**
 * Host half of dsh-git-commit-panel: the workspace gate, the git verbs, and
 * the AI commit-message call. The browser may only act on a registered
 * workspace root — that canonicalization is this module's security boundary,
 * and every route handler funnels through it.
 *
 * The commit-message prompt mirrors the rules ZCode's git tool uses: one
 * Conventional Commit subject line, type and scope in English, subject under
 * 72 characters, no explanation of the reasoning.
 *
 * @module dsh-git-commit-panel/host/service
 */
import { realpath, stat } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-subprocess';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-agent-default-model';
import type {} from '@deepseek-ai/dsh-workspace';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import type {
  CommitRequest,
  CommitResult,
  DiffPayload,
  DiffRequest,
  FileChange,
  GenerateMessageRequest,
  GenerateMessageResult,
  GitCommitError,
  GitCommitErrorCode,
  RepoStatus,
  StatusRequest,
} from '../types.ts';
import { GitCommandError, GitRunner, readDiff, readStatus, tail } from './git.ts';

/** Prompt budget: changed-file rows and diff characters sent to the model. */
const MAX_PROMPT_FILES = 30;
const MAX_PROMPT_FILE_CHARS = 80;
const MAX_PROMPT_DIFF_FILES = 10;
const MAX_PROMPT_DIFF_CHARS = 12_000;
const MAX_PROMPT_DIFF_CHARS_PER_FILE = 2_000;
const MAX_COMMIT_MESSAGE_CHARS = 1_000;
const MAX_HINT_CHARS = 500;

/** A Conventional Commit subject; anything else is retried/refused rather than committed blindly. */
const CONVENTIONAL_COMMIT_RE = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./@ -]+\))?!?: .{1,120}$/;

/** Default diff body requested by the panel before it posts to the model. */
const DIFF_FOR_PROMPT_BYTES = 200 * 1024;

/** Outcome of the workspace gate. */
export type GateResult =
  | { ok: true; canonical: string }
  | { ok: false; error: GitCommitError };

/** Canonicalize a caller-supplied workspace path, requiring a registered workspace. */
export type WorkspaceGate = (path: string) => Promise<GateResult>;

/** One handled failure carrying the machine code the route envelope reports. */
export class ServiceError extends Error {
  constructor(readonly code: GitCommitErrorCode, message: string, readonly detail?: string) {
    super(message);
    this.name = 'ServiceError';
  }

  /** The wire error this exception projects to. */
  toError(): GitCommitError {
    const error: GitCommitError = { code: this.code, message: this.message };
    if (this.detail !== undefined && this.detail !== '') error.detail = this.detail;
    return error;
  }
}

/** Remote-neutral facts the service needs from the host composition. */
export interface GitCommitServiceOptions {
  /** Canonicalize + authorize a workspace path. */
  gate: WorkspaceGate;
  /** Milliseconds a generate call may run. */
  generateTimeoutMs?: number;
}

/**
 * The plugin's host service: git verbs plus the AI commit-message call.
 * Constructed once per mounted plugin row and shared by every route.
 */
export class GitCommitService {
  private readonly git: GitRunner;

  constructor(
    private readonly ctx: Context,
    private readonly options: GitCommitServiceOptions,
  ) {
    this.git = new GitRunner(ctx);
  }

  /**
   * Read one workspace's repository status.
   * @param request - the requested workspace path.
   * @param signal - cancellation.
   * @returns the status, or null when the workspace is not a repository.
   */
  async status(request: StatusRequest, signal?: AbortSignal): Promise<RepoStatus | null> {
    const canonical = await this.gated(request.path);
    return await readStatus(this.git, canonical, signal);
  }

  /**
   * Read a bounded unified diff of one workspace.
   * @param request - workspace, optional path restriction, staged choice, byte cap.
   * @param signal - cancellation.
   * @returns the patch payload.
   */
  async diff(request: DiffRequest, signal?: AbortSignal): Promise<DiffPayload> {
    const { canonical, root } = await this.gatedRepository(request.path, signal);
    void canonical;
    return await readDiff(
      this.git,
      root,
      { staged: request.staged === true, paths: request.paths, maxBytes: request.maxBytes },
      signal,
    );
  }

  /**
   * Generate one Conventional Commit message for the workspace's changes.
   * @param request - workspace, optional path restriction/staged choice/locale/hint.
   * @returns the message with the model identity that produced it.
   */
  async generateCommitMessage(request: GenerateMessageRequest): Promise<GenerateMessageResult> {
    const { canonical, root } = await this.gatedRepository(request.path);
    const selection = this.ctx.agentDefaultModel.currentSelection();
    const provider = selection.provider?.trim() ?? '';
    const model = selection.model?.trim() ?? '';
    if (provider === '' || model === '') {
      throw new ServiceError('model-unavailable', 'No default model is configured for this deployment.');
    }

    const status = await readStatus(this.git, canonical);
    if (status === null) {
      throw new ServiceError('not-a-repository', 'The workspace is not inside a git repository.');
    }
    const staged = request.staged === true;
    const selected = selectFiles(status.files, request.paths, staged);
    if (selected.length === 0) {
      throw new ServiceError('nothing-to-commit', staged
        ? 'There are no staged changes to describe.'
        : 'There are no unstaged changes to describe.');
    }

    const diffs = await this.collectDiffs(root, selected, staged);
    const prompt = buildCommitMessagePrompt({
      branch: status.branch,
      locale: request.locale,
      files: selected,
      diffs,
      hint: request.hint,
    });

    const message = await this.complete(provider, model, prompt);
    const validated = validateGeneratedCommitMessage(message);
    if (validated === null) {
      throw new ServiceError(
        'model-failed',
        'The model did not return a usable Conventional Commit message.',
        tail(message, 200),
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
  async commit(request: CommitRequest, signal?: AbortSignal): Promise<CommitResult> {
    const { root } = await this.gatedRepository(request.path, signal);
    const message = request.message.trim().slice(0, MAX_COMMIT_MESSAGE_CHARS);
    if (message === '') {
      throw new ServiceError('bad-request', 'A commit message is required.');
    }

    if (request.stageAll) {
      await this.git.must(['add', '--all', '--', '.'], root, signal);
    }

    const staged = await this.git.run(
      ['diff', '--cached', '--name-only', '-z'],
      root,
      signal,
    );
    if (staged.exitCode !== 0) {
      throw new ServiceError('git-failed', 'Could not inspect the index.', tail(staged.stderr, 400));
    }
    if (staged.stdout.split('\0').every((entry) => entry === '')) {
      throw new ServiceError('nothing-to-commit', 'Nothing is staged, so there is nothing to commit.');
    }

    const committed = await this.git.run(['commit', '-m', message], root, signal);
    if (committed.exitCode !== 0) {
      throw new ServiceError(
        'git-failed',
        'git commit failed.',
        tail(committed.stderr.trim() || committed.stdout.trim(), 600),
      );
    }

    const head = await this.git.must(['rev-parse', 'HEAD'], root, signal);
    const subject = await this.git.must(['log', '-1', '--pretty=%s'], root, signal);
    const branchResult = await this.git.run(['symbolic-ref', '--short', '-q', 'HEAD'], root, signal);
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null;

    const result: CommitResult = {
      commit: head.stdout.trim(),
      subject: subject.stdout.trim(),
      branch,
      pushed: false,
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
  async push(root: string, signal?: AbortSignal): Promise<string> {
    const upstream = await this.git.run(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      root,
      signal,
    );
    if (upstream.exitCode !== 0) {
      throw new ServiceError(
        'push-failed',
        'The current branch has no upstream, so it cannot be pushed automatically.',
        'Set one with: git push -u <remote> <branch>',
      );
    }
    const pushed = await this.git.run(['push'], root, signal);
    if (pushed.exitCode !== 0) {
      throw new ServiceError(
        'push-failed',
        'git push failed.',
        tail(pushed.stderr.trim() || pushed.stdout.trim(), 600),
      );
    }
    return tail(pushed.stderr.trim() || pushed.stdout.trim() || `pushed to ${upstream.stdout.trim()}`, 300);
  }

  /** Canonicalize + authorize a workspace path. */
  private async gated(path: string): Promise<string> {
    const gate = await this.options.gate(path);
    if (!gate.ok) throw new ServiceError(gate.error.code, gate.error.message, gate.error.detail);
    return gate.canonical;
  }

  /** Canonicalize + authorize a workspace path and resolve its repository top level. */
  private async gatedRepository(path: string, signal?: AbortSignal): Promise<{ canonical: string; root: string }> {
    const canonical = await this.gated(path);
    const result = await this.git.run(['rev-parse', '--show-toplevel'], canonical, signal);
    if (result.exitCode !== 0) {
      throw new ServiceError('not-a-repository', 'The workspace is not inside a git repository.');
    }
    const root = result.stdout.trim();
    if (root === '') {
      throw new ServiceError('not-a-repository', 'The workspace is not inside a git repository.');
    }
    return { canonical, root };
  }

  /** Read one diff per selected file, bounded per file and in total. */
  private async collectDiffs(
    root: string,
    files: readonly FileChange[],
    staged: boolean,
  ): Promise<{ path: string; patch: string }[]> {
    const out: { path: string; patch: string }[] = [];
    for (const file of files.slice(0, MAX_PROMPT_DIFF_FILES)) {
      if (file.kind === 'untracked') {
        // An untracked file has no diff against the index; the file list is
        // its only signal, which the prompt states explicitly.
        out.push({ path: file.path, patch: '(new untracked file; no diff available)' });
        continue;
      }
      const payload = await readDiff(
        this.git,
        root,
        { staged, paths: [file.path], maxBytes: Math.max(DIFF_FOR_PROMPT_BYTES, MAX_PROMPT_DIFF_CHARS_PER_FILE) },
      );
      out.push({ path: file.path, patch: payload.patch });
    }
    return out;
  }

  /** One non-streaming model call assembled from the streaming API. */
  private async complete(provider: string, model: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutMs = this.options.generateTimeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(new Error('commit message generation timed out')), timeoutMs);
    let text = '';
    try {
      const stream = this.ctx.llm.stream({
        provider,
        model,
        system: 'You write concise Conventional Commit messages. You answer with the commit message only.',
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        temperature: 0.2,
        maxTokens: 400,
        purpose: 'session-title',
        signal: controller.signal,
      });
      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        if (chunk.type === 'text-delta') text += chunk.text;
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error') {
            throw new ServiceError('model-failed', 'The model call failed.', chunk.reason.failure.message);
          }
          if (chunk.reason.kind === 'aborted') {
            throw new ServiceError('model-failed', 'The model call was aborted.', chunk.reason.failure.message);
          }
        }
      }
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(
        'model-failed',
        'The model request failed.',
        tail(error instanceof Error ? error.message : String(error), 400),
      );
    } finally {
      clearTimeout(timer);
    }
    if (text.trim() === '') {
      throw new ServiceError('model-failed', 'The model returned no text.');
    }
    return text.trim();
  }
}

/** Choose the files a generation request covers. */
function selectFiles(
  files: readonly FileChange[],
  paths: readonly string[] | undefined,
  staged: boolean,
): FileChange[] {
  const side = files.filter((file) => (staged ? file.staged : file.unstaged));
  if (paths === undefined || paths.length === 0) return side;
  const wanted = new Set(paths);
  return side.filter((file) => wanted.has(file.path));
}

/**
 * Build the commit-message prompt. The shape follows ZCode's generator: a
 * hard requirement block, the branch, the language, the changed-file summary,
 * and bounded diff excerpts.
 * @param input - branch, locale, files, diffs, optional user hint.
 * @returns the complete prompt text.
 */
export function buildCommitMessagePrompt(input: {
  branch: string | null;
  locale?: string | undefined;
  files: readonly FileChange[];
  diffs: readonly { path: string; patch: string }[];
  hint?: string | undefined;
}): string {
  const branch = input.branch?.trim() || '(detached or unborn)';
  const language = (input.locale ?? '').toLowerCase().startsWith('zh') ? 'Chinese' : 'English';
  const visible = input.files.slice(0, MAX_PROMPT_FILES);
  const omitted = Math.max(0, input.files.length - visible.length);
  const fileLines = visible.map((file) => {
    const from = file.from === undefined ? '' : ` (from ${file.from})`;
    const side = [file.staged ? 'staged' : '', file.unstaged ? 'unstaged' : ''].filter((part) => part !== '').join('+');
    return `- ${file.kind} ${file.path}${from} [${side || 'clean'}]`.slice(0, MAX_PROMPT_FILE_CHARS);
  });

  let diffBudget = MAX_PROMPT_DIFF_CHARS;
  const diffChunks: string[] = [];
  for (const diff of input.diffs) {
    if (diffBudget <= 0) break;
    const body = diff.patch.trim() === '' ? '(no textual diff)' : diff.patch.trim();
    const limit = Math.min(MAX_PROMPT_DIFF_CHARS_PER_FILE, diffBudget);
    const clipped = body.length <= limit ? body : `${body.slice(0, limit)}\n...diff truncated...`;
    const chunk = `--- ${diff.path}\n${clipped}`;
    diffChunks.push(chunk);
    diffBudget -= chunk.length;
  }

  const lines = [
    'Write exactly one Git commit message for the workspace changes below.',
    'Return only the commit message text.',
    '',
    'Hard requirements:',
    '- The first line must be a valid Conventional Commit subject.',
    '- Use one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.',
    '- Keep the Conventional Commit type and optional scope in English.',
    `- Write the subject and any body in ${language}.`,
    '- Keep the subject under 72 characters.',
    '- Describe the change itself; never describe this instruction or your reasoning.',
    '- Do not wrap the message in quotes or code fences.',
    '',
    `Current branch: ${branch}`,
    `Current language: ${language}`,
    '',
    'Changed files:',
    fileLines.length > 0 ? fileLines.join('\n') : '- (no file summary available)',
  ];
  if (omitted > 0) lines.push(`- ... ${omitted} more changed files`);
  if (input.hint !== undefined && input.hint.trim() !== '') {
    lines.push('', 'Additional user intent (weigh it, do not quote it):', input.hint.trim().slice(0, MAX_HINT_CHARS));
  }
  lines.push('', 'Diff excerpts:', diffChunks.length > 0 ? diffChunks.join('\n\n') : '(no diff available)', '');
  return lines.join('\n');
}

/**
 * Strip model decorations, cap the length, and require a Conventional Commit
 * subject.
 * @param raw - the model's raw reply.
 * @returns the usable message, or null when the reply is unusable.
 */
export function validateGeneratedCommitMessage(raw: string): string | null {
  const message = stripDecorations(raw).trim().slice(0, MAX_COMMIT_MESSAGE_CHARS).trim();
  if (message === '') return null;
  const subject = message.split(/\r?\n/, 1)[0]?.trim() ?? '';
  return CONVENTIONAL_COMMIT_RE.test(subject) ? message : null;
}

/** Remove fences, a leading label, and wrapping quotes from a model reply. */
export function stripDecorations(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const withoutFence = (fenced?.[1] ?? trimmed).trim();
  const commitTag = /<commit>([\s\S]*?)<\/commit>/.exec(withoutFence);
  const withoutTag = (commitTag?.[1] ?? withoutFence).trim();
  const withoutPrefix = withoutTag.replace(/^commit message:\s*/i, '').trim();
  if (
    (withoutPrefix.startsWith('"') && withoutPrefix.endsWith('"'))
    || (withoutPrefix.startsWith("'") && withoutPrefix.endsWith("'"))
  ) {
    return withoutPrefix.slice(1, -1);
  }
  return withoutPrefix;
}

/**
 * Build the workspace gate for one host composition.
 * @param ctx - context carrying the workspace registry.
 * @returns a gate that canonicalizes the path and requires registry membership.
 */
export function createWorkspaceGate(ctx: Context): WorkspaceGate {
  return async (path: string): Promise<GateResult> => {
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      return { ok: false, error: { code: 'workspace-unknown', message: 'The path does not resolve on disk.' } };
    }
    try {
      const info = await stat(canonical);
      if (!info.isDirectory()) {
        return { ok: false, error: { code: 'workspace-unknown', message: 'The path is not a directory.' } };
      }
    } catch {
      return { ok: false, error: { code: 'workspace-unknown', message: 'The path does not resolve on disk.' } };
    }
    const match = ctx.workspaceRegistry.list().some((workspace) => samePath(workspace.path, canonical));
    if (!match) {
      return {
        ok: false,
        error: {
          code: 'workspace-unknown',
          message: 'The path is not a registered workspace.',
        },
      };
    }
    return { ok: true, canonical };
  };
}

/** Case-insensitive comparison on Windows, exact elsewhere. */
function samePath(left: string, right: string): boolean {
  if (left === right) return true;
  return process.platform === 'win32' && left.toLowerCase() === right.toLowerCase();
}

/** Project an arbitrary thrown value onto the route envelope's error shape. */
export function toWireError(error: unknown): GitCommitError {
  if (error instanceof ServiceError) return error.toError();
  if (error instanceof GitCommandError) {
    return { code: error.code, message: error.message, detail: error.detail ?? '' };
  }
  return {
    code: 'internal',
    message: 'The git operation failed unexpectedly.',
    detail: tail(error instanceof Error ? error.message : String(error), 400),
  };
}
