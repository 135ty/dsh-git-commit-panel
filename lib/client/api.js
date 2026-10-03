/** Absolute route prefix, mirroring the host half's registration. */
export const ROUTE_PREFIX = 'git-commit';
/** Fallback error used when the transport itself failed (no envelope arrived). */
const TRANSPORT_ERROR = {
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
async function post(route, payload, signal) {
    let response;
    try {
        response = await fetch(`${ROUTE_PREFIX}/${route}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch {
        return { ok: false, error: TRANSPORT_ERROR };
    }
    try {
        const envelope = await response.json();
        if (typeof envelope !== 'object' || envelope === null)
            return { ok: false, error: TRANSPORT_ERROR };
        const record = envelope;
        if (record.ok === true)
            return { ok: true, value: record.value };
        return { ok: false, error: record.error ?? TRANSPORT_ERROR };
    }
    catch {
        return { ok: false, error: TRANSPORT_ERROR };
    }
}
/** Typed git operations over the wire. */
export class GitCommitApi {
    /** Read one workspace's repository status; `value: null` means "not a repository". */
    status(path, signal) {
        return post('status', { path }, signal);
    }
    /** Read a unified diff, optionally restricted to specific paths. */
    diff(path, options = {}, signal) {
        return post('diff', { path, ...options }, signal);
    }
    /** Ask the host's default model for a Conventional Commit message. */
    generate(path, options = {}, signal) {
        return post('generate', { path, ...options }, signal);
    }
    /** Stage (optionally), commit, and optionally push. */
    commit(input, signal) {
        return post('commit', { ...input }, signal);
    }
}
