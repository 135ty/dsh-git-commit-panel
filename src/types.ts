/**
 * Wire domain shared by the host half and the browser half of
 * dsh-git-commit-panel. Every value that crosses the plugin's HTTP routes is
 * declared here, and every inbound payload is narrowed by the guards below
 * before it reaches a git command.
 *
 * @module dsh-git-commit-panel/types
 */

/** Stable machine codes for every failure the routes can report. */
export type GitCommitErrorCode =
  | 'bad-request'
  | 'workspace-unknown'
  | 'not-a-repository'
  | 'git-failed'
  | 'nothing-to-commit'
  | 'model-unavailable'
  | 'model-failed'
  | 'push-failed'
  | 'internal';

/** One structured failure; `message` is shown to the user verbatim. */
export interface GitCommitError {
  code: GitCommitErrorCode;
  message: string;
  /** Optional git stderr tail, already bounded, for the panel's detail line. */
  detail?: string | undefined;
}

/** Envelope every route returns; HTTP status stays 200 for handled failures. */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: GitCommitError };

/** How one path changed, derived from git's porcelain status letters. */
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'unmerged' | 'untracked';

/** One changed path. */
export interface FileChange {
  /** Repository-relative path, always slash-separated. */
  path: string;
  kind: ChangeKind;
  /** Index differs from HEAD (the change is staged). */
  staged: boolean;
  /** Work tree differs from the index (the change is unstaged). */
  unstaged: boolean;
  /** Path this one was renamed or copied from, when git reported one. */
  from?: string | undefined;
}

/** Aggregate counts for one change set. */
export interface ChangeSummary {
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

/** The repository facts the floating window renders. */
export interface RepoStatus {
  /** Canonical workspace root the caller asked about (host-resolved). */
  workspace: string;
  /** Repository top level; differs from the workspace when it sits in a subdirectory. */
  root: string;
  /** Branch name, or a short commit id when HEAD is detached; null for an unborn branch with no commits. */
  branch: string | null;
  detached: boolean;
  /** Upstream tracking branch when one is configured. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Complete change set of the repository. */
  files: readonly FileChange[];
  summary: ChangeSummary;
  /** The plugin's own trigger: the repository has work-tree changes. */
  hasUnstagedChanges: boolean;
  /** Staged changes exist, so "commit what is staged" is possible. */
  hasStagedChanges: boolean;
}

/** Bounded diff text for one or more paths. */
export interface DiffPayload {
  /** Unified diff bytes as git printed them (possibly truncated). */
  patch: string;
  truncated: boolean;
  /** Byte length of the retained patch. */
  bytes: number;
}

/** Inbound payload of `/git-commit/status`. */
export interface StatusRequest {
  /** Workspace root to inspect; the host canonicalizes and gates it. */
  path: string;
}

/** Inbound payload of `/git-commit/diff`. */
export interface DiffRequest {
  path: string;
  /** Restrict the diff to these repository-relative paths. */
  paths?: readonly string[] | undefined;
  /** Diff the index against HEAD instead of the work tree against the index. */
  staged?: boolean | undefined;
  /** Retained patch cap in bytes. */
  maxBytes?: number | undefined;
}

/** Inbound payload of `/git-commit/generate`. */
export interface GenerateMessageRequest {
  path: string;
  /** Changed paths to include in the prompt; omitted uses the whole change set. */
  paths?: readonly string[] | undefined;
  /** Whether the prompt is built from staged (true) or unstaged (false) changes. */
  staged?: boolean | undefined;
  /** Preferred language of the produced subject/body; type and scope stay English. */
  locale?: string | undefined;
  /** Extra user intent appended to the prompt (the panel's optional hint box). */
  hint?: string | undefined;
}

/** Result of one AI commit-message generation. */
export interface GenerateMessageResult {
  message: string;
  provider: string;
  model: string;
}

/** Inbound payload of `/git-commit/commit`. */
export interface CommitRequest {
  path: string;
  message: string;
  /**
   * Stage every work-tree change (including untracked files) before
   * committing. When false, only what is already staged is committed.
   */
  stageAll: boolean;
  /** Push the resulting commit to the upstream immediately afterwards. */
  push?: boolean | undefined;
  /** Push even when the upstream would have to be created... (not supported; kept explicit). */
}

/** Result of a commit, and of a following push when one was requested. */
export interface CommitResult {
  commit: string;
  subject: string;
  branch: string | null;
  pushed: boolean;
  /** Present only when the push leg ran. */
  pushDetail?: string | undefined;
}

/** Result of `/git-commit/remotes`, used to explain an unpushable branch. */
export interface RemoteList {
  remotes: readonly string[];
  hasUpstream: boolean;
}

const CHANGE_KINDS: readonly string[] = [
  'added', 'modified', 'deleted', 'renamed', 'copied', 'typechange', 'unmerged', 'untracked',
];

/** Whether a value is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Narrow a status payload. */
export function readStatusRequest(value: unknown): StatusRequest | null {
  if (!isRecord(value)) return null;
  return isNonEmptyString(value.path) ? { path: value.path } : null;
}

/** Narrow a diff payload; an absent `paths` means the whole change set. */
export function readDiffRequest(value: unknown): DiffRequest | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.path)) return null;
  const paths = readStringArray(value.paths);
  if (paths === null) return null;
  const staged = typeof value.staged === 'boolean' ? value.staged : undefined;
  const maxBytes = typeof value.maxBytes === 'number' && Number.isFinite(value.maxBytes) && value.maxBytes > 0
    ? Math.floor(value.maxBytes)
    : undefined;
  return { path: value.path, paths: paths ?? undefined, staged, maxBytes };
}

/** Narrow a generate payload. */
export function readGenerateRequest(value: unknown): GenerateMessageRequest | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.path)) return null;
  const paths = readStringArray(value.paths);
  if (paths === null) return null;
  return {
    path: value.path,
    paths: paths ?? undefined,
    staged: typeof value.staged === 'boolean' ? value.staged : undefined,
    locale: isNonEmptyString(value.locale) ? value.locale : undefined,
    hint: isNonEmptyString(value.hint) ? value.hint.slice(0, 500) : undefined,
  };
}

/** Narrow a commit payload. */
export function readCommitRequest(value: unknown): CommitRequest | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.path)) return null;
  if (typeof value.message !== 'string' || value.message.trim() === '') return null;
  return {
    path: value.path,
    message: value.message,
    stageAll: value.stageAll === true,
    push: value.push === true,
  };
}

/** Read an optional array of non-empty strings; null when the field is present but malformed. */
function readStringArray(value: unknown): readonly string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) return null;
    out.push(item);
  }
  return out;
}

/** Whether a value is one of the declared change kinds. */
export function isChangeKind(value: unknown): value is ChangeKind {
  return typeof value === 'string' && CHANGE_KINDS.includes(value);
}

/** Whether a value is a well-formed repository status (route response guard). */
export function isRepoStatus(value: unknown): value is RepoStatus {
  if (!isRecord(value)) return false;
  if (typeof value.workspace !== 'string' || typeof value.root !== 'string') return false;
  if (!(value.branch === null || typeof value.branch === 'string')) return false;
  if (typeof value.detached !== 'boolean') return false;
  if (!(value.upstream === null || typeof value.upstream === 'string')) return false;
  if (typeof value.ahead !== 'number' || typeof value.behind !== 'number') return false;
  if (typeof value.hasUnstagedChanges !== 'boolean' || typeof value.hasStagedChanges !== 'boolean') return false;
  if (!Array.isArray(value.files)) return false;
  for (const file of value.files) {
    if (!isRecord(file)) return false;
    if (typeof file.path !== 'string') return false;
    if (!isChangeKind(file.kind)) return false;
    if (typeof file.staged !== 'boolean' || typeof file.unstaged !== 'boolean') return false;
    if (file.from !== undefined && typeof file.from !== 'string') return false;
  }
  const summary = value.summary;
  if (!isRecord(summary)) return false;
  return typeof summary.total === 'number'
    && typeof summary.staged === 'number'
    && typeof summary.unstaged === 'number'
    && typeof summary.untracked === 'number';
}

/** Whether a value is a well-formed diff payload. */
export function isDiffPayload(value: unknown): value is DiffPayload {
  return isRecord(value)
    && typeof value.patch === 'string'
    && typeof value.truncated === 'boolean'
    && typeof value.bytes === 'number';
}

/** Whether a value is a well-formed generated commit message. */
export function isGenerateMessageResult(value: unknown): value is GenerateMessageResult {
  return isRecord(value)
    && typeof value.message === 'string'
    && typeof value.provider === 'string'
    && typeof value.model === 'string';
}

/** Whether a value is a well-formed commit result. */
export function isCommitResult(value: unknown): value is CommitResult {
  return isRecord(value)
    && typeof value.commit === 'string'
    && typeof value.subject === 'string'
    && (value.branch === null || typeof value.branch === 'string')
    && typeof value.pushed === 'boolean';
}
