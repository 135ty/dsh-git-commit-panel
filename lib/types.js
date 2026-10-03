/**
 * Wire domain shared by the host half and the browser half of
 * dsh-git-commit-panel. Every value that crosses the plugin's HTTP routes is
 * declared here, and every inbound payload is narrowed by the guards below
 * before it reaches a git command.
 *
 * @module dsh-git-commit-panel/types
 */
const CHANGE_KINDS = [
    'added', 'modified', 'deleted', 'renamed', 'copied', 'typechange', 'unmerged', 'untracked',
];
/** Whether a value is a plain JSON object. */
export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Whether a value is a non-empty string. */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}
/** Narrow a status payload. */
export function readStatusRequest(value) {
    if (!isRecord(value))
        return null;
    return isNonEmptyString(value.path) ? { path: value.path } : null;
}
/** Narrow a diff payload; an absent `paths` means the whole change set. */
export function readDiffRequest(value) {
    if (!isRecord(value))
        return null;
    if (!isNonEmptyString(value.path))
        return null;
    const paths = readStringArray(value.paths);
    if (paths === null)
        return null;
    const staged = typeof value.staged === 'boolean' ? value.staged : undefined;
    const maxBytes = typeof value.maxBytes === 'number' && Number.isFinite(value.maxBytes) && value.maxBytes > 0
        ? Math.floor(value.maxBytes)
        : undefined;
    return { path: value.path, paths: paths ?? undefined, staged, maxBytes };
}
/** Narrow a generate payload. */
export function readGenerateRequest(value) {
    if (!isRecord(value))
        return null;
    if (!isNonEmptyString(value.path))
        return null;
    const paths = readStringArray(value.paths);
    if (paths === null)
        return null;
    return {
        path: value.path,
        paths: paths ?? undefined,
        staged: typeof value.staged === 'boolean' ? value.staged : undefined,
        locale: isNonEmptyString(value.locale) ? value.locale : undefined,
        hint: isNonEmptyString(value.hint) ? value.hint.slice(0, 500) : undefined,
    };
}
/** Narrow a commit payload. */
export function readCommitRequest(value) {
    if (!isRecord(value))
        return null;
    if (!isNonEmptyString(value.path))
        return null;
    if (typeof value.message !== 'string' || value.message.trim() === '')
        return null;
    return {
        path: value.path,
        message: value.message,
        stageAll: value.stageAll === true,
        push: value.push === true,
    };
}
/** Read an optional array of non-empty strings; null when the field is present but malformed. */
function readStringArray(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        return null;
    const out = [];
    for (const item of value) {
        if (!isNonEmptyString(item))
            return null;
        out.push(item);
    }
    return out;
}
/** Whether a value is one of the declared change kinds. */
export function isChangeKind(value) {
    return typeof value === 'string' && CHANGE_KINDS.includes(value);
}
/** Whether a value is a well-formed repository status (route response guard). */
export function isRepoStatus(value) {
    if (!isRecord(value))
        return false;
    if (typeof value.workspace !== 'string' || typeof value.root !== 'string')
        return false;
    if (!(value.branch === null || typeof value.branch === 'string'))
        return false;
    if (typeof value.detached !== 'boolean')
        return false;
    if (!(value.upstream === null || typeof value.upstream === 'string'))
        return false;
    if (typeof value.ahead !== 'number' || typeof value.behind !== 'number')
        return false;
    if (typeof value.hasUnstagedChanges !== 'boolean' || typeof value.hasStagedChanges !== 'boolean')
        return false;
    if (!Array.isArray(value.files))
        return false;
    for (const file of value.files) {
        if (!isRecord(file))
            return false;
        if (typeof file.path !== 'string')
            return false;
        if (!isChangeKind(file.kind))
            return false;
        if (typeof file.staged !== 'boolean' || typeof file.unstaged !== 'boolean')
            return false;
        if (file.from !== undefined && typeof file.from !== 'string')
            return false;
    }
    const summary = value.summary;
    if (!isRecord(summary))
        return false;
    return typeof summary.total === 'number'
        && typeof summary.staged === 'number'
        && typeof summary.unstaged === 'number'
        && typeof summary.untracked === 'number';
}
/** Whether a value is a well-formed diff payload. */
export function isDiffPayload(value) {
    return isRecord(value)
        && typeof value.patch === 'string'
        && typeof value.truncated === 'boolean'
        && typeof value.bytes === 'number';
}
/** Whether a value is a well-formed generated commit message. */
export function isGenerateMessageResult(value) {
    return isRecord(value)
        && typeof value.message === 'string'
        && typeof value.provider === 'string'
        && typeof value.model === 'string';
}
/** Whether a value is a well-formed commit result. */
export function isCommitResult(value) {
    return isRecord(value)
        && typeof value.commit === 'string'
        && typeof value.subject === 'string'
        && (value.branch === null || typeof value.branch === 'string')
        && typeof value.pushed === 'boolean';
}
