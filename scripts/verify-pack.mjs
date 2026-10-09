/**
 * Regression check for the npm report reader `pack:release` depends on.
 *
 * The reader shipped with a fixed offset that only matched one report shape, so
 * `pack:release` exited 1 on every npm that printed its report as an array — the
 * shape npm 11 writes. Nothing caught it because nothing exercised this path,
 * so both shapes and the prepare output that precedes them are pinned here.
 *
 * Usage: npm run verify:pack
 *
 * @module dsh-git-commit-panel/scripts/verify-pack
 */
import assert from 'node:assert/strict';

import { parseReport } from './lib/npm-pack-report.mjs';

const ENTRY = {
    id: 'dsh-git-commit-panel@0.1.0',
    name: 'dsh-git-commit-panel',
    filename: 'dsh-git-commit-panel-0.1.0.tgz',
    files: [
        { path: 'package.json' },
        { path: 'cordis.patch.yml' },
        { path: 'lib/index.js' },
        { path: 'lib/client.js' },
    ],
    entryCount: 4,
};

/** What `npm pack` writes when it runs this package's `prepare` first. */
const BUILD_OUTPUT = [
    '[build] cleaning lib/',
    '[build] bundling lib/client.js',
    '[build] wrote lib/client.js',
    '[build] done',
    '',
    '> dsh-git-commit-panel@0.1.0 prepare',
    '> npm run build',
    '',
].join('\n');

const cases = [
    {
        name: 'array report behind prepare output — the shape that shipped broken',
        stdout: `${BUILD_OUTPUT}\n[\n${JSON.stringify(ENTRY, null, 2)}\n]\n`,
        expected: [ENTRY],
    },
    {
        name: 'object report keyed by package name',
        stdout: `${BUILD_OUTPUT}\n${JSON.stringify({ [ENTRY.name]: ENTRY }, null, 2)}\n`,
        expected: { [ENTRY.name]: ENTRY },
    },
    {
        name: 'array report with no prepare output',
        stdout: `[${JSON.stringify(ENTRY)}]\n`,
        expected: [ENTRY],
    },
    {
        name: 'report whose entries nest arrays and objects',
        stdout: [
            BUILD_OUTPUT,
            '[',
            '  {',
            '    "files": [',
            '      {"path": "a"},',
            '      {"path": "b"}',
            '    ],',
            '    "bundled": []',
            '  }',
            ']',
            '',
        ].join('\n'),
        expected: [{ files: [{ path: 'a' }, { path: 'b' }], bundled: [] }],
    },
    {
        name: 'build output that is not JSON at all',
        stdout: BUILD_OUTPUT,
        expected: null,
    },
    {
        name: 'empty output',
        stdout: '',
        expected: null,
    },
];

const failures = [];

for (const { name, stdout, expected } of cases) {
    const actual = parseReport(stdout);
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`ok    ${name}`);
        continue;
    }
    failures.push(name);
    console.error(`fail  ${name}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
}

if (failures.length > 0) {
    console.error(`\nverify:pack — ${failures.length} of ${cases.length} cases failed.`);
    process.exit(1);
}

console.log(`\nverify:pack passed (${cases.length} cases).`);