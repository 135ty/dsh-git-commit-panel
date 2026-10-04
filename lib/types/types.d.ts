/**
 * Wire domain shared by the host half and the browser half of
 * dsh-git-commit-panel. Every value that crosses the plugin's HTTP routes is
 * declared here, and every inbound payload is narrowed by the guards below
 * before it reaches a git command.
 *
 * @module dsh-git-commit-panel/types
 */
/** Stable machine codes for every failure the routes can report. */
export type GitCommitErrorCode = 'bad-request' | 'workspace-unknown' | 'not-a-repository' | 'git-failed' | 'nothing-to-commit' | 'model-unavailable' | 'model-failed' | 'push-failed' | 'internal';
/** One structured failure; `message` is shown to the user verbatim. */
export interface GitCommitError {
    code: GitCommitErrorCode;
    message: string;
    /** Optional git stderr tail, already bounded, for the panel's detail line. */
    detail?: string | undefined;
}
/** Envelope every route returns; HTTP status stays 200 for handled failures. */
export type Envelope<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: GitCommitError;
};
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
/**
 * Line totals of one change set, as the work tree reads them against the index.
 * An untracked file counts as all-added: git reports no diff for a path it does
 * not track yet.
 */
export interface LineCounts {
    additions: number;
    deletions: number;
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
    /**
     * Added and removed lines across the unstaged change set `summary.unstaged`
     * counts. Optional because the two halves do not always swap together: the
     * browser bundle is re-served on a page load while a changed host half needs a
     * restart, so a client can meet a status that predates these totals.
     */
    lines?: LineCounts | undefined;
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
    /**
     * Preferred provider route for the drafting call. Only honoured when an
     * adapter is registered for it; otherwise the deployment default is used.
     */
    provider?: string | undefined;
    /** Preferred model id, paired with {@link provider}. */
    model?: string | undefined;
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
/** Whether a value is a plain JSON object. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
/** Narrow a status payload. */
export declare function readStatusRequest(value: unknown): StatusRequest | null;
/** Narrow a diff payload; an absent `paths` means the whole change set. */
export declare function readDiffRequest(value: unknown): DiffRequest | null;
/** Narrow a generate payload. */
export declare function readGenerateRequest(value: unknown): GenerateMessageRequest | null;
/** Narrow a commit payload. */
export declare function readCommitRequest(value: unknown): CommitRequest | null;
/** Whether a value is one of the declared change kinds. */
export declare function isChangeKind(value: unknown): value is ChangeKind;
/** Whether a value is a well-formed error envelope member. */
export declare function isGitCommitError(value: unknown): value is GitCommitError;
/** Whether a value is a well-formed repository status (route response guard). */
export declare function isRepoStatus(value: unknown): value is RepoStatus;
/** Whether a value is a well-formed diff payload. */
export declare function isDiffPayload(value: unknown): value is DiffPayload;
/** Whether a value is a well-formed generated commit message. */
export declare function isGenerateMessageResult(value: unknown): value is GenerateMessageResult;
/** Whether a value is a well-formed commit result. */
export declare function isCommitResult(value: unknown): value is CommitResult;
