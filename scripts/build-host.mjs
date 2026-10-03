/**
 * Build script for dsh-git-commit-panel — the NODE half.
 *
 * The host Loader resolves the plugin row by package name, so the node half
 * must be one resolvable ESM entry at `lib/index.js`. Internal modules
 * (`host/*.ts`) are inlined; every installed dependency, and every harness
 * package, stays external because the profile's own `node_modules` answers
 * those at runtime.
 *
 * Declarations are emitted separately by `tsc` (`build:host:types`); this
 * script writes runtime JavaScript only, and runs AFTER the client build so it
 * never competes with that script's `lib/` cleanup.
 *
 * @module dsh-git-commit-panel/scripts/build-host
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src/index.ts');
const OUTPUT = join(ROOT, 'lib/index.js');

console.log('[build:host] bundling lib/index.js');
const bundled = await build({
  entryPoints: [ENTRY],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  legalComments: 'none',
  logLevel: 'warning',
  // Every bare specifier resolves from the profile at runtime; only the
  // plugin's own relative modules are inlined.
  packages: 'external',
});

const [output] = bundled.outputFiles ?? [];
if (output === undefined) throw new Error('esbuild produced no host bundle');
if (!/\bexport\b/.test(output.text)) {
  throw new Error('host bundle exposes no exports; the Loader requires apply/inject');
}

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output.text, 'utf8');
console.log(`[build:host] wrote ${relative(ROOT, OUTPUT).split(sep).join('/')}`);
