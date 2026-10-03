/**
 * Browser client for the host's `/git-commit/*` routes: typed envelope calls
 * over a same-origin relative fetch. The page is served with `<base href="./">`,
 * so every route path stays document-relative and works under a sub-path
 * deployment.
 *
 * @module dsh-git-commit-panel/client/api
 */
import type { CommitResult, DiffPayload, Envelope, RepoStatus } from '../types.ts';
/** Absolute route prefix, mirroring the host half's registration. */
export declare const ROUTE_PREFIX = "git-commit";
/** Typed git operations over the wire. */
export declare class GitCommitApi {
    /** Read one workspace's repository status; `value: null` means "not a repository". */
    status(path: string, signal?: AbortSignal): Promise<Envelope<RepoStatus | null>>;
    /** Read a unified diff, optionally restricted to specific paths. */
    diff(path: string, options?: {
        paths?: readonly string[];
        staged?: boolean;
    }, signal?: AbortSignal): Promise<Envelope<DiffPayload>>;
    /** Ask the host's default model for a Conventional Commit message. */
    generate(path: string, options?: {
        staged?: boolean;
        locale?: string;
        hint?: string;
    }, signal?: AbortSignal): Promise<Envelope<{
        message: string;
        provider: string;
        model: string;
    }>>;
    /** Stage (optionally), commit, and optionally push. */
    commit(input: {
        path: string;
        message: string;
        stageAll: boolean;
        push: boolean;
    }, signal?: AbortSignal): Promise<Envelope<CommitResult>>;
}
