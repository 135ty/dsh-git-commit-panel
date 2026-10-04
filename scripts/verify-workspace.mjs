/**
 * Verification harness for the pill's workspace scope.
 *
 * The pill belongs to the conversation the main view is showing, so this
 * harness drives a running GUI that has two registered workspaces — the one the
 * conversation sits in, and a second one — and asserts the whole contract:
 *
 *   1. the conversation's workspace is the only directory the panel ever asks
 *      about,
 *   2. no pill appears while that workspace is clean, even though the other
 *      registered workspace has changes,
 *   3. the pill appears with that workspace's branch and change count as soon as
 *      the workspace has changes.
 *
 * Every `/git-commit/status` request body is recorded, so the assertion is
 * about what the panel actually did, not about what it rendered.
 *
 * The GUI under test must open its conversation in the workspace passed as the
 * second argument (for a scratch `DSH_HOME`: that workspace is the one whose
 * Session is the most recent), and must have a second registered workspace with
 * changes of its own — the subject the pill must never adopt. The harness
 * verifies that premise and says so when it does not hold.
 *
 * Usage: node verify-workspace.mjs <base-url-with-token> <conversation-workspace>
 */
import { rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));

const url = process.argv[2];
if (url === undefined) {
  console.error('usage: node verify-workspace.mjs <base-url-with-token> <conversation-workspace>');
  process.exit(2);
}
/** The workspace the open conversation sits in; the only legal pill subject. */
const workspace = resolve(process.argv[3] ?? '.');

/** Untracked file the harness seeds and removes again. */
const SEED_FILE = join(workspace, 'workspace-scope-verify.txt');

/** Normalize a path for comparison: lowercase, forward slashes, no trailing slash. */
function normalize(path) {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Ground truth: how many unstaged changes the workspace has right now. */
function unstagedCount() {
  const raw = execFileSync('git', ['status', '--porcelain=v2', '--untracked-files=all', '-z'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  return raw.split('\0').filter((record) => /^[12u?]/.test(record)).length;
}

/** Branch name the pill is expected to print. */
function branchOf() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
}

if (unstagedCount() !== 0) {
  console.error(`the conversation workspace must start clean: ${workspace}`);
  process.exit(2);
}

const results = [];
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : ` — ${extra}`}`);
};

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

/** Every workspace path the panel has probed, in order, with duplicates. */
const probes = [];
page.on('request', (request) => {
  if (request.method() !== 'POST' || !request.url().includes('/git-commit/status')) return;
  try {
    const body = JSON.parse(request.postData() ?? '{}');
    if (typeof body.path === 'string') probes.push(body.path);
  } catch {
    probes.push('(unparsable body)');
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

let frameReady = true;
try {
  await page.waitForSelector('[data-shell-overlay]', { timeout: 45_000 });
} catch {
  frameReady = false;
}
check(frameReady, 'app frame mounted (shell overlay layer present)');

// A first-use profile opens onboarding overlays whose mask swallows pointer
// events; dismiss them before reading the panel.
for (let attempt = 0; attempt < 4; attempt += 1) {
  const mask = page.locator('div[aria-hidden="true"][class*="mask"]');
  if (await mask.count() === 0) break;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const closer = page.locator('button[aria-label*="lose"], button[aria-label*="关闭"]').first();
  if (await closer.count() > 0) {
    await closer.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
  if (await mask.count() === 0) break;
  await page.mouse.click(4, 4);
  await page.waitForTimeout(400);
}

const pillSelector = '[data-dsh-git-commit-panel="pill"]';

/**
 * Poll until the pill's presence matches expectation.
 * @param present - whether the pill must be there.
 * @param timeoutMs - bound for the wait.
 * @returns the last observed presence.
 */
async function waitForPill(present, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seen = !present;
  while (Date.now() < deadline) {
    seen = await page.locator(pillSelector).count() > 0;
    if (seen === present) return seen;
    await page.waitForTimeout(500);
  }
  return seen;
}

// Let the boot navigation settle (it opens the recent workspace's conversation)
// and the panel run its first probes.
await page.waitForTimeout(8_000);

const probedPaths = [...new Set(probes.map(normalize))];
const expected = normalize(workspace);

check(probes.length > 0, 'the panel probed the conversation workspace at all', `${probes.length} status probes`);
check(
  probedPaths.length > 0 && probedPaths.every((path) => path === expected),
  'the conversation workspace is the only directory probed',
  `probed: ${probedPaths.join(', ') || '(none)'}`,
);
if (probedPaths.length === 0 || !probedPaths.includes(expected)) {
  console.log('      note: the main view is not in the conversation workspace — the harness premise did not hold');
}

const pillWhileClean = await waitForPill(false, 2_000);
check(
  !pillWhileClean,
  'no pill while the conversation workspace is clean, even though another workspace has changes',
);

// Positive half: a change in the conversation's own workspace must bring the
// pill back, describing that workspace.
await writeFile(SEED_FILE, 'seeded by verify-workspace.mjs\n', 'utf8');
// The panel re-probes on focus; the 20s poll is the backstop.
await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
const appeared = await waitForPill(true, 30_000);
check(appeared, 'the pill appears once the conversation workspace has changes');
if (!appeared) {
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(22_000);
}

const pill = page.locator(pillSelector).first();
const pillVisible = await pill.isVisible().catch(() => false);
const pillText = pillVisible ? (await pill.innerText()).replace(/\s+/g, ' ').trim() : '';
const branch = branchOf();
check(pillVisible, 'floating commit pill rendered', pillText);
check(pillText.includes(branch), `pill shows the conversation workspace's branch (${branch})`, pillText);
check(
  new RegExp(`\\b${unstagedCount()}\\b`).test(pillText),
  `pill shows the conversation workspace's change count (${unstagedCount()})`,
  pillText,
);

const afterSeedPaths = [...new Set(probes.slice(probes.length - 4).map(normalize))];
check(
  afterSeedPaths.every((path) => path === expected),
  'still only the conversation workspace is probed after the change',
  `recent probes: ${afterSeedPaths.join(', ') || '(none)'}`,
);

await rm(SEED_FILE, { force: true });

console.log(`\npage errors: ${pageErrors.length}`);
for (const error of pageErrors.slice(0, 5)) console.log(`  - ${error.slice(0, 300)}`);
console.log(`probes (${probes.length}): ${probes.map(normalize).join(' ')}`);

await browser.close();

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
