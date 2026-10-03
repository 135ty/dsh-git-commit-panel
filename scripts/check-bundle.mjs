/**
 * Offline contract check for the built plugin artifacts. It validates the
 * things that fail late and loudly at boot — a missing client bundle, a bundle
 * that is not wrapped in the ModuleLoader factory, a `require()` the frozen
 * browser module table cannot answer — so a broken build is caught before the
 * web GUI is restarted.
 *
 * @module dsh-git-commit-panel/scripts/check-bundle
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ID = 'dsh-git-commit-panel';

const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]);

const failures = [];
const notes = [];

/** Record one failed assertion. */
function check(condition, message) {
  if (condition) {
    notes.push(`ok   ${message}`);
  } else {
    failures.push(message);
  }
}

const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
check(manifest.name === PLUGIN_ID, `package name is ${PLUGIN_ID}`);
check(manifest.dsh?.client?.platform === 'web', 'dsh.client.platform is "web"');
check(
  typeof manifest.exports?.['./client']?.default === 'string',
  'exports["./client"] is declared',
);
check(manifest.main === 'lib/index.js', 'main points at the node half');

const host = await readFile(join(ROOT, 'lib/index.js'), 'utf8').catch(() => null);
check(host !== null, 'lib/index.js exists');
check(host !== null && /\bapply\b/.test(host), 'lib/index.js exports apply');
check(host !== null && /\binject\b/.test(host), 'lib/index.js declares inject');
check(host !== null && !/from\s+['"][^'"]*\.ts['"]/.test(host), 'lib/index.js has no .ts imports');

const client = await readFile(join(ROOT, 'lib/client.js'), 'utf8').catch(() => null);
check(client !== null, 'lib/client.js exists');
if (client !== null) {
  check(client.includes(`window.__ModuleLoader__.load({`), 'client bundle registers via __ModuleLoader__.load');
  check(client.includes(`id: "${PLUGIN_ID}"`), 'client bundle id equals the package name');
  check(/factory:\s*\(require\)\s*=>\s*\{/.test(client), 'client bundle exposes a require-taking factory');
  check(client.trimEnd().endsWith('});'), 'client bundle closes its load call');
  check(!/^\s*(?:import|export)\s/m.test(client), 'client bundle has no stray module statements');

  const requires = [...client.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);
  const unknown = [...new Set(requires)].filter((id) => !PLATFORM_MODULES.has(id));
  check(
    unknown.length === 0,
    `client bundle only requires platform modules (unexpected: ${unknown.join(', ') || 'none'})`,
  );
  notes.push(`     requires: ${[...new Set(requires)].join(', ') || '(none)'}`);
}

const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8').catch(() => null);
check(patch !== null && patch.includes('insert:'), 'cordis.patch.yml carries an insert row');
check(patch !== null && patch.includes(PLUGIN_ID), 'cordis.patch.yml names the package');

if (process.argv.includes('--verbose')) {
  for (const note of notes) console.log(note);
}

if (failures.length > 0) {
  console.error('\nBundle contract check FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Bundle contract check passed (${notes.filter((note) => note.startsWith('ok')).length} assertions).`);
}
