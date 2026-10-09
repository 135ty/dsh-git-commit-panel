/**
 * Reading npm's `--json` report back out of a run that printed other things
 * too.
 *
 * `npm pack` runs `prepare` first, so build output lands on stdout ahead of
 * the report, and the report itself has shipped in two shapes: a one-element
 * array, and an object keyed by package name. Cutting it out by offset
 * therefore binds the caller to one npm version's formatting, and fails
 * silently-by-exit-code when that changes.
 * @module dsh-git-commit-panel/scripts/lib/npm-pack-report
 */

/**
 * Parse the report out of everything a `npm pack --json` run wrote.
 *
 * Candidates are found by shape rather than by offset: every `[` or `{` that
 * opens a JSON value at the start of a line is tried as a start, scanning
 * backwards, and the first whose remainder parses is the report. A value nested
 * inside the report cannot be mistaken for one, because closing brackets that
 * belong to an enclosing value are missing from its slice.
 * @param {string} stdout Everything the run wrote to stdout.
 * @returns {unknown} The parsed report, or null when no complete JSON value starts a line.
 */
export function parseReport(stdout) {
    for (let start = stdout.length - 1; start >= 0; start -= 1) {
        const opener = stdout[start];
        if (opener !== '[' && opener !== '{') continue;
        if (start > 0 && !/[\r\n]/.test(stdout[start - 1])) continue;
        try {
            const report = JSON.parse(stdout.slice(start));
            if (report !== null && typeof report === 'object') return report;
        } catch {
            // No complete value opens here; an earlier line may still hold one.
        }
    }
    return null;
}