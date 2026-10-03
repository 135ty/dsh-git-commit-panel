import type { Context } from '@deepseek-ai/cordis';
import type { CommitRequest, CommitResult, DiffPayload, DiffRequest, FileChange, GenerateMessageRequest, GenerateMessageResult, GitCommitError, GitCommitErrorCode, RepoStatus, StatusRequest } from '../types.ts';
/** Outcome of the workspace gate. */
export type GateResult = {
    ok: true;
    canonical: string;
} | {
    ok: false;
    error: GitCommitError;
};
/** Canonicalize a caller-supplied workspace path, requiring a registered workspace. */
export type WorkspaceGate = (path: string) => Promise<GateResult>;
/** One handled failure carrying the machine code the route envelope reports. */
export declare class ServiceError extends Error {
    readonly code: GitCommitErrorCode;
    readonly detail?: string | undefined;
    constructor(code: GitCommitErrorCode, message: string, detail?: string | undefined);
    /** The wire error this exception projects to. */
    toError(): GitCommitError;
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
export declare class GitCommitService {
    private readonly ctx;
    private readonly options;
    private readonly git;
    constructor(ctx: Context, options: GitCommitServiceOptions);
    /**
     * Read one workspace's repository status.
     * @param request - the requested workspace path.
     * @param signal - cancellation.
     * @returns the status, or null when the workspace is not a repository.
     */
    status(request: StatusRequest, signal?: AbortSignal): Promise<RepoStatus | null>;
    /**
     * Read a bounded unified diff of one workspace.
     * @param request - workspace, optional path restriction, staged choice, byte cap.
     * @param signal - cancellation.
     * @returns the patch payload.
     */
    diff(request: DiffRequest, signal?: AbortSignal): Promise<DiffPayload>;
    /**
     * Generate one Conventional Commit message for the workspace's changes.
     * @param request - workspace, optional path restriction/staged choice/locale/hint.
     * @param signal - cancellation following the HTTP request's lifetime.
     * @returns the message with the model identity that produced it.
     */
    generateCommitMessage(request: GenerateMessageRequest, signal?: AbortSignal): Promise<GenerateMessageResult>;
    /**
     * Stage (optionally), commit, and optionally push one workspace.
     * @param request - workspace, message, stageAll, push.
     * @param signal - cancellation.
     * @returns the created commit and whether the push leg ran.
     */
    commit(request: CommitRequest, signal?: AbortSignal): Promise<CommitResult>;
    /**
     * Push the current branch to its upstream.
     * @param root - repository top level.
     * @param signal - cancellation.
     * @returns the human-readable push summary (git's own stderr/stdout tail).
     */
    push(root: string, signal?: AbortSignal): Promise<string>;
    /**
     * Resolve the provider/model the drafting call runs on.
     *
     * A caller-supplied pair is honoured only when an adapter is registered for
     * that provider, so a browser cannot name an unroutable route. Everything
     * else falls back to the deployment's default selection — the same one a
     * freshly created agent starts on.
     */
    private resolveSelection;
    /** Whether an LLM adapter is currently registered for one provider route. */
    private hasAdapter;
    /** Canonicalize + authorize a workspace path. */
    private gated;
    /** Canonicalize + authorize a workspace path and resolve its repository top level. */
    private gatedRepository;
    /** Read one diff per selected file, bounded per file and in total. */
    private collectDiffs;
    /**
     * One non-streaming model call assembled from the streaming API. The call is
     * bounded by its own deadline and by the caller's lifetime, so a browser that
     * navigated away does not leave a provider request running.
     */
    private complete;
}
/**
 * Build the commit-message prompt. The shape follows ZCode's generator: a
 * hard requirement block, the branch, the language, the changed-file summary,
 * and bounded diff excerpts.
 * @param input - branch, locale, files, diffs, optional user hint.
 * @returns the complete prompt text.
 */
export declare function buildCommitMessagePrompt(input: {
    branch: string | null;
    locale?: string | undefined;
    files: readonly FileChange[];
    diffs: readonly {
        path: string;
        patch: string;
    }[];
    hint?: string | undefined;
}): string;
/**
 * Strip model decorations, cap the length, and require a Conventional Commit
 * subject.
 * @param raw - the model's raw reply.
 * @returns the usable message, or null when the reply is unusable.
 */
export declare function validateGeneratedCommitMessage(raw: string): string | null;
/** Remove fences, a leading label, and wrapping quotes from a model reply. */
export declare function stripDecorations(raw: string): string;
/**
 * Build the workspace gate for one host composition.
 * @param ctx - context carrying the workspace registry.
 * @returns a gate that canonicalizes the path and requires registry membership.
 */
export declare function createWorkspaceGate(ctx: Context): WorkspaceGate;
/** Project an arbitrary thrown value onto the route envelope's error shape. */
export declare function toWireError(error: unknown): GitCommitError;
