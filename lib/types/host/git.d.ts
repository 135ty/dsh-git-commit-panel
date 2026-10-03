/**
 * Host-side git plumbing: one bounded subprocess runner over the DSH
 * `subprocess` service, plus the status and diff readers built on it. Every
 * git invocation goes through {@link GitRunner.run}, which owns the output
 * caps, the grace period, and the workspace gate check the caller performed
 * beforehand.
 *
 * @module dsh-git-commit-panel/host/git
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ChangeKind, ChangeSummary, DiffPayload, FileChange, RepoStatus } from '../types.ts';
/** Collected-output cap for one git command (4 MiB). */
export declare const OUTPUT_CAP_BYTES: number;
/** Milliseconds a git command may run before the subprocess tree is terminated. */
export declare const GIT_GRACE_MS = 20000;
/** Default retained diff cap (64 KiB) — enough for a prompt, cheap over HTTP. */
export declare const DEFAULT_DIFF_MAX_BYTES: number;
/** One finished git invocation. A nonzero exit is a result, not an exception. */
export interface GitRunResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}
/** git failures this module raises with an intended machine code. */
export declare class GitCommandError extends Error {
    readonly code: 'git-failed' | 'not-a-repository';
    readonly detail?: string | undefined;
    constructor(message: string, code: 'git-failed' | 'not-a-repository', detail?: string | undefined);
}
/**
 * Runs one resolved git executable with bounded output. The runner never
 * shell-interprets arguments, and the caller's AbortSignal reaches the
 * subprocess tree.
 */
export declare class GitRunner {
    private readonly ctx;
    private readonly executable;
    constructor(ctx: Context, executable?: string);
    /**
     * Run `git <args>` to completion.
     * @param args - git arguments, never shell-interpreted.
     * @param cwd - working directory (the gated workspace or repository root).
     * @param signal - cancellation.
     * @returns exit facts and collected output.
     */
    run(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<GitRunResult>;
    /**
     * Run `git <args>` and fail loudly on a nonzero exit, with a bounded stderr
     * tail attached to the error.
     * @param args - git arguments.
     * @param cwd - working directory.
     * @param signal - cancellation.
     * @param code - machine code the raised error carries.
     * @returns the collected output of a successful command.
     */
    must(args: readonly string[], cwd: string, signal?: AbortSignal, code?: GitCommandError['code']): Promise<GitRunResult>;
}
/** Bounded tail of a diagnostic string. */
export declare function tail(text: string, maxChars: number): string;
/** Porcelain entry: one changed path with its index/work-tree status letters. */
interface PorcelainEntry {
    /** Two status letters: index then work tree. `.` means "unchanged on that side". */
    xy: string;
    path: string;
    from?: string;
}
/**
 * Parse the NUL-delimited `git status --porcelain=v2 --branch -z` stream.
 *
 * Records are `1`/`2`/`u`/`?`/`!` lines; branch headers are `# ...` lines.
 * With `-z`, a rename/copy record carries the original path in the field
 * after the new path instead of an `->` arrow.
 * @param raw - collected stdout.
 * @returns branch facts and the change entries in git's own order.
 */
export declare function parsePorcelain(raw: string): {
    branch: string | null;
    detached: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
    entries: PorcelainEntry[];
};
/** Map git's two status letters to the panel's coarse change kind. */
export declare function classify(xy: string): ChangeKind;
/** Turn parsed porcelain entries into the wire change set. */
export declare function toFileChanges(entries: readonly PorcelainEntry[]): FileChange[];
/** Count one change set. */
export declare function summarize(files: readonly FileChange[]): ChangeSummary;
/**
 * Read the complete status of one already-gated workspace directory.
 * @param git - the runner.
 * @param workspace - canonical workspace root.
 * @param signal - cancellation.
 * @returns the repository status; null when the directory is not inside a repository.
 */
export declare function readStatus(git: GitRunner, workspace: string, signal?: AbortSignal): Promise<RepoStatus | null>;
/**
 * Read a unified diff of one already-gated repository.
 * @param git - the runner.
 * @param root - repository top level.
 * @param options - staged/unstaged choice, optional path restriction, byte cap.
 * @param signal - cancellation.
 * @returns the retained patch and whether it was cut at the cap.
 */
export declare function readDiff(git: GitRunner, root: string, options: {
    staged: boolean;
    paths?: readonly string[] | undefined;
    maxBytes?: number | undefined;
}, signal?: AbortSignal): Promise<DiffPayload>;
export {};
