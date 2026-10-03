/**
 * Browser client for the host's `/git-commit/*` routes: typed envelope calls
 * over a same-origin relative fetch. The page is served with `<base href="./">`,
 * so every route path stays document-relative and works under a sub-path
 * deployment.
 *
 * @module dsh-git-commit-panel/client/api
 */
import type {
  CommitResult,
  DiffPayload,
  Envelope,
  GitCommitError,
  RepoStatus,
} from '../types.ts';

/** Absolute route prefix, mirroring the host half's registration. */
export const ROUTE_PREFIX = 'git-commit';

/** Fallback error used when the transport itself failed (no envelope arrived). */
const TRANSPORT_ERROR: GitCommitError = {
  code: 'internal',
  message: 'The git commit panel could not reach the host.',
};

/**
 * POST one JSON payload and decode the envelope; never throws.
 * @param route - route name below the plugin prefix (`status`, `diff`, …).
 * @param payload - JSON body.
 * @param signal - caller cancellation.
 * @returns the decoded envelope, or a transport failure.
 */
async function post<T>(route: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<Envelope<T>> {
  let response: Response;
  try {
    response = await fetch(`${ROUTE_PREFIX}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return { ok: false, error: TRANSPORT_ERROR };
  }
  try {
    const envelope = await response.json() as unknown;
    if (typeof envelope !== 'object' || envelope === null) return { ok: false, error: TRANSPORT_ERROR };
    const record = envelope as Record<string, unknown>;
    if (record.ok === true) return { ok: true, value: record.value as T };
    return { ok: false, error: (record.error as GitCommitError | undefined) ?? TRANSPORT_ERROR };
  } catch {
    return { ok: false, error: TRANSPORT_ERROR };
  }
}

/** Typed git operations over the wire. */
export class GitCommitApi {
  /** Read one workspace's repository status; `value: null` means "not a repository". */
  status(path: string, signal?: AbortSignal): Promise<Envelope<RepoStatus | null>> {
    return post<RepoStatus | null>('status', { path }, signal);
  }

  /** Read a unified diff, optionally restricted to specific paths. */
  diff(
    path: string,
    options: { paths?: readonly string[]; staged?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<Envelope<DiffPayload>> {
    return post<DiffPayload>('diff', { path, ...options }, signal);
  }

  /** Ask the host's default model for a Conventional Commit message. */
  generate(
    path: string,
    options: { staged?: boolean; locale?: string; hint?: string } = {},
    signal?: AbortSignal,
  ): Promise<Envelope<{ message: string; provider: string; model: string }>> {
    return post<{ message: string; provider: string; model: string }>('generate', { path, ...options }, signal);
  }

  /** Stage (optionally), commit, and optionally push. */
  commit(
    input: { path: string; message: string; stageAll: boolean; push: boolean },
    signal?: AbortSignal,
  ): Promise<Envelope<CommitResult>> {
    return post<CommitResult>('commit', { ...input }, signal);
  }
}
