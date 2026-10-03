/** Collected-output cap for one git command (4 MiB). */
export const OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
/** Milliseconds a git command may run before the subprocess tree is terminated. */
export const GIT_GRACE_MS = 20_000;
/** Default retained diff cap (64 KiB) — enough for a prompt, cheap over HTTP. */
export const DEFAULT_DIFF_MAX_BYTES = 64 * 1024;
/** git failures this module raises with an intended machine code. */
export class GitCommandError extends Error {
    code;
    detail;
    constructor(message, code, detail) {
        super(message);
        this.code = code;
        this.detail = detail;
        this.name = 'GitCommandError';
    }
}
/**
 * Runs one resolved git executable with bounded output. The runner never
 * shell-interprets arguments, and the caller's AbortSignal reaches the
 * subprocess tree.
 */
export class GitRunner {
    ctx;
    executable;
    constructor(ctx, executable = 'git') {
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
                stdin: 'ignore',
                stdout: { maxBytes: OUTPUT_CAP_BYTES },
                stderr: { maxBytes: OUTPUT_CAP_BYTES },
            },
            graceMs: GIT_GRACE_MS,
            ...(signal === undefined ? {} : { signal }),
        });
        const outcome = await handle.done;
        signal?.throwIfAborted();
        return {
            exitCode: outcome.exitCode,
            stdout: handle.collected.stdout?.readFrom(0).text ?? '',
            stderr: handle.collected.stderr?.readFrom(0).text ?? '',
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
    async must(args, cwd, signal, code = 'git-failed') {
        const result = await this.run(args, cwd, signal);
        if (result.exitCode !== 0) {
            throw new GitCommandError(`git ${args[0] ?? ''} failed`, code, tail(result.stderr.trim() || result.stdout.trim(), 600));
        }
        return result;
    }
}
/** Bounded tail of a diagnostic string. */
export function tail(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return `…${text.slice(text.length - maxChars)}`;
}
/**
 * Return the text of the field that follows the `n`th single space in a
 * porcelain-v2 record.
 *
 * A path may itself contain spaces, while every field before it cannot, so the
 * n-th space is the only reliable delimiter; a naive `split(' ')` index would
 * truncate such a path.
 * @param record - one NUL-delimited record.
 * @param spaces - count of spaces that precede the wanted field.
 * @returns the field text, or undefined when the record is too short.
 */
function fieldAfter(record, spaces) {
    let seen = 0;
    for (let position = 0; position < record.length; position += 1) {
        if (record[position] !== ' ')
            continue;
        seen += 1;
        if (seen === spaces) {
            const rest = record.slice(position + 1);
            return rest === '' ? undefined : rest;
        }
    }
    return undefined;
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
export function parsePorcelain(raw) {
    let branch = null;
    let detached = false;
    let upstream = null;
    let ahead = 0;
    let behind = 0;
    const entries = [];
    const records = raw.split('\0');
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (record === undefined || record === '')
            continue;
        if (record.startsWith('# ')) {
            const header = record.slice(2);
            if (header.startsWith('branch.head ')) {
                const value = header.slice('branch.head '.length).trim();
                detached = value === '(detached)';
                branch = detached ? null : value;
            }
            else if (header.startsWith('branch.upstream ')) {
                upstream = header.slice('branch.upstream '.length).trim();
            }
            else if (header.startsWith('branch.ab ')) {
                const match = /^\+(\d+)\s+-(\d+)$/.exec(header.slice('branch.ab '.length).trim());
                if (match !== null) {
                    ahead = Number(match[1]);
                    behind = Number(match[2]);
                }
            }
            continue;
        }
        const type = record[0];
        if (type === '1') {
            // "1 XY sub mH mI mW hH hI path"
            const xy = record.slice(2, 4);
            const path = fieldAfter(record, 8);
            if (path !== undefined)
                entries.push({ xy, path });
            continue;
        }
        if (type === '2') {
            // "2 XY sub mH mI mW hH hI Xscore path\0origPath"
            const xy = record.slice(2, 4);
            const path = fieldAfter(record, 9);
            const from = records[index + 1];
            index += 1;
            if (path !== undefined) {
                entries.push(from === undefined || from === '' ? { xy, path } : { xy, path, from });
            }
            continue;
        }
        if (type === 'u') {
            // "u XY sub m1 m2 m3 mW h1 h2 h3 path"
            const xy = record.slice(2, 4);
            const path = fieldAfter(record, 10);
            if (path !== undefined)
                entries.push({ xy, path });
            continue;
        }
        if (type === '?') {
            const path = record.slice(2);
            if (path !== '')
                entries.push({ xy: '??', path });
            continue;
        }
        // '!' (ignored) records are never reported.
    }
    return { branch, detached, upstream, ahead, behind, entries };
}
/** Map git's two status letters to the panel's coarse change kind. */
export function classify(xy) {
    if (xy === '??')
        return 'untracked';
    if (xy.includes('U') || xy === 'AA' || xy === 'DD')
        return 'unmerged';
    const index = xy[0] ?? '.';
    const worktree = xy[1] ?? '.';
    const letter = worktree !== '.' ? worktree : index;
    switch (letter) {
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': return 'renamed';
        case 'C': return 'copied';
        case 'T': return 'typechange';
        case 'M': return 'modified';
        default: return 'modified';
    }
}
/** Turn parsed porcelain entries into the wire change set. */
export function toFileChanges(entries) {
    return entries.map((entry) => {
        const index = entry.xy[0] ?? '.';
        const worktree = entry.xy[1] ?? '.';
        const untracked = entry.xy === '??';
        const change = {
            path: entry.path,
            kind: classify(entry.xy),
            staged: !untracked && index !== '.' && index !== '?',
            unstaged: untracked || (worktree !== '.' && worktree !== '?'),
        };
        if (entry.from !== undefined)
            change.from = entry.from;
        return change;
    });
}
/** Count one change set. */
export function summarize(files) {
    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    for (const file of files) {
        if (file.staged)
            staged += 1;
        if (file.unstaged)
            unstaged += 1;
        if (file.kind === 'untracked')
            untracked += 1;
    }
    return { total: files.length, staged, unstaged, untracked };
}
/**
 * Read the complete status of one already-gated workspace directory.
 * @param git - the runner.
 * @param workspace - canonical workspace root.
 * @param signal - cancellation.
 * @returns the repository status; null when the directory is not inside a repository.
 */
export async function readStatus(git, workspace, signal) {
    const rootResult = await git.run(['rev-parse', '--show-toplevel'], workspace, signal);
    if (rootResult.exitCode !== 0)
        return null;
    const root = rootResult.stdout.trim();
    if (root === '')
        return null;
    const status = await git.must(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], root, signal, 'not-a-repository');
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
        hasStagedChanges: files.some((file) => file.staged),
    };
}
/**
 * Read a unified diff of one already-gated repository.
 * @param git - the runner.
 * @param root - repository top level.
 * @param options - staged/unstaged choice, optional path restriction, byte cap.
 * @param signal - cancellation.
 * @returns the retained patch and whether it was cut at the cap.
 */
export async function readDiff(git, root, options, signal) {
    const args = ['diff', '--no-color', '--no-ext-diff', '--unified=3'];
    if (options.staged)
        args.push('--cached');
    if (options.paths !== undefined && options.paths.length > 0) {
        args.push('--', ...options.paths);
    }
    const result = await git.run(args, root, signal);
    const patch = result.stdout;
    const cap = options.maxBytes ?? DEFAULT_DIFF_MAX_BYTES;
    if (patch.length <= cap) {
        return { patch, truncated: false, bytes: patch.length };
    }
    return { patch: patch.slice(0, cap), truncated: true, bytes: cap };
}
