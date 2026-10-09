/**
 * Release packaging for GitHub-only distribution.
 *
 * This plugin is not published to npm, so the prebuilt tarball is the fast
 * install path: a GitHub Release asset of this repository, which pnpm installs
 * as a plain remote tarball — no repository download, no build script on the
 * user's machine. `npm pack` runs `prepare` first, so the tarball always carries
 * a freshly built `lib/` rather than whatever is committed.
 *
 * The tarball must belong to this repository's own release: the market binds a
 * catalog entry's `tarball` field to the entry's `owner/repo` and rejects an
 * asset hosted under someone else's.
 *
 * Usage: npm run pack:release
 *
 * @module dsh-git-commit-panel/scripts/pack-release
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseReport } from './lib/npm-pack-report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Entries without which the tarball would install but never load. */
const REQUIRED = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js'];

/**
 * Run `npm pack --json` through the npm entry that is already running this
 * script, so no shell is interposed (and no argument is re-quoted by one). A
 * direct `node scripts/pack-release.mjs` falls back to the platform's command.
 */
function pack() {
    const entry = process.env.npm_execpath;
    const options = { cwd: root, encoding: 'utf8' };
    if (entry !== undefined && entry !== '') {
        return spawnSync(process.execPath, [entry, 'pack', '--json'], options);
    }
    return process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm pack --json'], options)
        : spawnSync('npm', ['pack', '--json'], options);
}

const packed = pack();
if (packed.status !== 0) {
    process.stderr.write(packed.stderr || packed.stdout || 'npm pack failed\n');
    process.exit(packed.status ?? 1);
}

// `prepare` writes to stdout ahead of the report, so it is parsed out by shape.
// See parseReport for why no fixed offset can be used.
const stdout = packed.stdout ?? '';
const report = parseReport(stdout);
if (report === null) {
    process.stderr.write(`pack:release — npm pack printed no JSON report:\n${stdout}\n`);
    process.exit(1);
}
const artifacts = Array.isArray(report) ? report : Object.values(report);
const artifact = artifacts.find(
    entry => Array.isArray(entry?.files) && typeof entry?.filename === 'string',
);
if (artifact === undefined) {
    process.stderr.write('pack:release — npm pack reported no tarball.\n');
    process.exit(1);
}
const names = new Set(artifact.files.map(file => file.path));
const missing = REQUIRED.filter(name => !names.has(name));
if (missing.length > 0) {
    console.error(`pack:release — ${artifact.filename} is missing ${missing.join(', ')}; not a usable release.`);
    process.exit(1);
}

const tag = `v${manifest.version}`;
const repo = /github\.com[/:]([^/]+\/[^/#]+?)(?:\.git)?$/i.exec(manifest.repository?.url ?? '')?.[1] ?? null;
/** Asset name the README's install command resolves to — no version, so `latest/download` keeps working across releases. */
const stable = manifest.name;

console.log(`\n${artifact.filename} — ${names.size} files, ${(artifact.size / 1024).toFixed(1)} KiB packed\n`);
if (repo === null) {
    console.log('package.json declares no GitHub repository URL: upload the tarball to a release by hand.');
    process.exit(0);
}
console.log(`Upload it twice: once under its packed name, once under the version-free
name the README resolves. Both assets must exist for every release — the
versioned one for the pinned URL and for the market entry's \`tarball\` field,
the version-free one so \`latest/download\` still resolves after the next release.

  git tag ${tag} && git push origin ${tag}
  gh release create ${tag} ${artifact.filename} --title ${tag} --generate-notes

  cp ${artifact.filename} ${stable}.tgz
  gh release upload ${tag} ${stable}.tgz

The install command in the READMEs (already published, never needs editing):

  https://github.com/${repo}/releases/latest/download/${stable}.tgz

The pinned target, and the market entry's optional \`tarball\` field:

  https://github.com/${repo}/releases/download/${tag}/${artifact.filename}
`);
