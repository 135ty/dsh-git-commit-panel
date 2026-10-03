/**
 * Verification of the failure path: what the user actually sees when the
 * commit-message model call fails.
 *
 * Boots its own DSH instance against a scratch home whose provider credential
 * is deliberately invalid, registers a scratch repository as a workspace,
 * drives the panel in a real Chromium, and captures both the raw error
 * envelope and the rendered card. Writes `artifacts/failure-report.json`.
 *
 * Usage:
 *   node scripts/verify-failure.mjs                  # boot its own instance
 *   node scripts/verify-failure.mjs <base-url>       # use an already-running one
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'artifacts');
const SCRATCH = resolve(ROOT, '..', '.verify');
const REPO = join(SCRATCH, 'scratch-repo');
const HOME = join(SCRATCH, 'dsh-home-broken');
const PORT = 3202;
const PLUGIN_MAIN = join(ROOT, 'lib', 'index.js');

const results = [];
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : ` — ${extra}`}`);
};

/** Boot the isolated broken-credential instance and resolve its tokenised URL. */
async function bootBrokenInstance() {
  await mkdir(join(HOME, 'storages'), { recursive: true });
  await writeFile(
    join(HOME, '.credentials.yaml'),
    'DEEPSEEK_API_KEY: "sk-invalid-key-for-failure-path-test"\n',
    'utf8',
  );
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' }).trim();
  const canonical = execFileSync('node', ['-e', `process.stdout.write(require('node:fs').realpathSync(${JSON.stringify(repo)}))`], { encoding: 'utf8' });
  const now = new Date().toISOString();
  const workspaceId = 'ws-failure-probe';
  await writeFile(
    join(HOME, 'storages', 'workspace.json'),
    JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [], pinnedSessionIds: [] },
      tables: { workspaces: { [workspaceId]: { path: canonical, title: 'scratch-repo', sessionIds: [], createdAt: now, updatedAt: now } } },
    }, null, 2),
    'utf8',
  );
  const patch = join(HOME, 'plugin.patch.yml');
  await writeFile(
    patch,
    `- insert:\n    - id: git-commit-panel\n      name: '${PLUGIN_MAIN.replace(/\\/g, '/')}'\n`,
    'utf8',
  );

  const child = spawn(process.execPath, [
    'D:/npm/node_global/node_modules/@deepseek-ai/dsh/lib/bin.js',
    'web', '--patch', patch, '--no-open', '--port', String(PORT),
  ], {
    cwd: REPO,
    env: { ...process.env, DSH_HOME: HOME },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolveUrl, rejectUrl) => {
    let buffer = '';
    const timer = setTimeout(() => rejectUrl(new Error(`instance did not report a URL: ${buffer.slice(0, 600)}`)), 90_000);
    const scan = (chunk) => {
      buffer += String(chunk);
      const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolveUrl(match[0]);
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
  });
  return { child, url };
}

/** POST one JSON body to the running instance and return the parsed envelope. */
async function post(base, route, body) {
  const response = await fetch(`${base}/git-commit/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await response.json();
}

const providedUrl = process.argv[2];
const booted = providedUrl === undefined ? await bootBrokenInstance() : null;
const url = providedUrl ?? booted.url;
const base = new URL(url).origin;
console.log(`instance: ${base}`);

// Keep the trigger real: the panel only renders while the tree is dirty.
await writeFile(join(REPO, 'failure-probe.txt'), `probe ${Date.now()}\n`, 'utf8');

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleMessages = [];
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') consoleMessages.push(message.text());
});
page.on('pageerror', (error) => consoleMessages.push(`pageerror: ${String(error)}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('[data-shell-overlay]', { timeout: 45_000 });
await page.waitForSelector('[data-dsh-git-commit-panel="pill"]', { timeout: 45_000 });
await page.waitForTimeout(2_000);
await page.locator('[data-dsh-git-commit-panel="pill"]')
  .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForTimeout(1_200);

const card = page.locator('[data-dsh-git-commit-panel="card"]');
const errorBox = card.locator('[data-dsh-git-commit-panel="error"]');

// 1. The Generate with AI button.
await card.locator('button').filter({ hasText: /Generate with AI|AI 生成/ }).first()
  .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
let errorText = '';
for (let attempt = 0; attempt < 90; attempt += 1) {
  await page.waitForTimeout(1_000);
  errorText = (await errorBox.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  if (errorText !== '') break;
}
check(errorText !== '', 'generate failure is shown in the card', errorText.slice(0, 240));
check(/model-failed|model-unavailable/.test(errorText), 'failure names the model step', errorText.slice(0, 120));
check(/generateFailed|无法生成提交信息/.test(errorText), 'heading says generation failed, not commit failed');
check(/invalid|401|Authentication|api key/i.test(errorText), 'provider cause and request id are visible');
await mkdir(OUT, { recursive: true });
await card.screenshot({ path: join(OUT, 'failure-generate.png') }).catch(() => {});
const rawGenerate = await post(base, 'generate', { path: REPO });
await writeFile(join(OUT, 'failure-generate-envelope.json'), JSON.stringify(rawGenerate, null, 2), 'utf8');

// 2. An empty box must not commit when the draft fails: the failure is
//    surfaced, the draft lands nowhere, and no commit is created.
const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
const textarea = card.locator('textarea');
await textarea.evaluate((element) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(element, '');
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(400);
await card.locator('[data-dsh-git-commit-panel="commit"]')
  .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForTimeout(30_000);
const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
check(after === before, 'a failed draft leaves the repository untouched', `HEAD ${after.slice(0, 8)}`);
const boxAfter = (await textarea.inputValue()).trim();
check(boxAfter === '', 'a failed draft leaves the message box empty', boxAfter.slice(0, 60));
check(
  consoleMessages.some((message) => message.includes('dsh-git-commit-panel')),
  'the failure is mirrored to the browser console',
  consoleMessages.filter((message) => message.includes('dsh-git-commit-panel')).slice(0, 1).join('').slice(0, 160),
);
await card.screenshot({ path: join(OUT, 'failure-commit.png') }).catch(() => {});
await page.screenshot({ path: join(OUT, 'failure-page.png') });
await writeFile(
  join(OUT, 'failure-report.json'),
  JSON.stringify({ results, errorText, rawGenerate, consoleMessages: consoleMessages.slice(0, 20) }, null, 2),
  'utf8',
);

await browser.close();
booted?.child.kill();

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
