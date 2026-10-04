/**
 * Verification harness for the git commit panel.
 *
 * Loads the running DSH web GUI in a real Chromium, waits for the client
 * plugin roster to settle, and asserts that the floating commit pill rendered
 * against the scratch workspace's changes, that the commit card exposes its
 * controls, and that a commit driven from the card empties the work tree.
 * Console errors and page errors are captured so a bundle that fails to
 * materialize is visible rather than silent.
 *
 * Usage: node verify-panel.mjs <base-url-with-token> [expected-unstaged-count]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'artifacts');

const url = process.argv[2];
if (url === undefined) {
  console.error('usage: node verify-panel.mjs <base-url-with-token> [workspace-path]');
  process.exit(2);
}
/**
 * The repository the panel is expected to pick. The harness both reads it (for
 * ground truth) and mutates it, so the trigger contract can be exercised from
 * the clean side as well as the dirty side.
 */
const workspace = resolve(process.argv[3] ?? '.');

/** Ground truth for the pill's count, read straight from the repository. */
function unstagedCount() {
  const raw = execFileSync('git', ['status', '--porcelain=v2', '--untracked-files=all', '-z'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  return raw.split('\0').filter((record) => /^[12u?]/.test(record)).length;
}

/** Seed one work-tree change so the dirty-side assertions have a subject. */
function seedChange() {
  const target = join(workspace, 'panel-verify.txt');
  execFileSync('node', ['-e', `require('node:fs').appendFileSync(${JSON.stringify(target)}, 'change\\n')`]);
}

/** Subject of the repository's current HEAD. */
function subjectOf() {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: workspace, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/**
 * Object id of the repository's current HEAD. A commit is detected by this and
 * not by its subject: a drafted subject is free to repeat the previous one
 * (the diff can be the same), which would make a subject comparison report a
 * landed commit as missing.
 */
function headOf() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
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

const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// The client boot is all-or-nothing: wait for the app frame, then give the
// overlay a beat to run its first workspace probe.
let frameReady = true;
try {
  await page.waitForSelector('[data-shell-overlay]', { timeout: 45_000 });
} catch {
  frameReady = false;
}
check(frameReady, 'app frame mounted (shell overlay layer present)');

await page.waitForTimeout(4_000);

// A fresh profile opens onboarding overlays whose mask swallows pointer
// events; dismiss them before touching the panel.
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
 * Poll until the pill's presence matches expectation. The panel re-probes its
 * candidate workspaces on visibility, focus, and a 20s timer, so a state
 * change needs either a reload or a bounded wait.
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

// Trigger contract, clean side: a clean work tree must produce no window at
// all, and a fresh change must bring it back.
if (unstagedCount() === 0) {
  const seen = await waitForPill(false, 6_000);
  check(!seen, 'no floating window while the work tree is clean');
  seedChange();
  let appeared = await waitForPill(true, 30_000);
  if (!appeared) {
    // The overlay re-probes on focus and on its timer; a reload is the
    // deterministic way to force the first probe.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-shell-overlay]', { timeout: 45_000 });
    appeared = await waitForPill(true, 30_000);
  }
  check(appeared, 'floating window appears after a work-tree change');
  await page.waitForTimeout(2_000);
}

const expectedUnstaged = unstagedCount();
const overlayHtml = frameReady
  ? await page.locator('[data-shell-overlay]').innerHTML().catch(() => '')
  : '';
const pill = page.locator(pillSelector).first();
const pillVisible = await pill.isVisible().catch(() => false);
check(pillVisible, 'floating commit pill rendered', pillVisible ? '' : `overlay html: ${overlayHtml.slice(0, 300)}`);

const pillText = pillVisible ? (await pill.innerText()).replace(/\s+/g, ' ').trim() : '';
check(pillText.includes('main'), 'pill shows the branch name', pillText);
check(
  new RegExp(`\\b${expectedUnstaged}\\b`).test(pillText),
  `pill shows the unstaged change count (expected ${expectedUnstaged})`,
  pillText,
);

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: join(OUT, 'panel-pill.png') });

if (pillVisible) {
  // Dispatch the activation directly: a fresh profile may keep an onboarding
  // mask over the frame, and this assertion is about the panel's own handler.
  await pill.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(1_500);
  const dialog = page.locator('[data-dsh-git-commit-panel="card"]').first();
  const dialogVisible = await dialog.isVisible().catch(() => false);
  check(dialogVisible, 'commit card opened on click');

  if (dialogVisible) {
    const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ').trim();
    const hasMessageBox = dialogText.includes('Commit message') || dialogText.includes('提交信息');
    check(hasMessageBox, 'card exposes the message box', dialogText.slice(0, 160));
    const hasPush = dialogText.includes('Commit & Push') || dialogText.includes('提交并推送');
    check(hasPush, 'card exposes the commit-and-push action');
    check(await dialog.locator('textarea').count() === 1, 'exactly one message textarea');
    const generateButtons = await dialog.locator('button').filter({ hasText: /Generate with AI|AI 生成/ }).count();
    check(generateButtons >= 1, 'AI generate button present');

    const textarea = dialog.locator('textarea');
    const commitButton = dialog.locator('[data-dsh-git-commit-panel="commit"]');
    check(await commitButton.count() === 1, 'commit action present');

    /** Wait for the empty-box commit to draft a message and land a commit. */
    const waitForCommit = async (predicate, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(1_000);
        if (await predicate()) return true;
      }
      return false;
    };

    // 1. An empty box is still a valid commit: the AI drafts the message and
    //    that drafted text is what gets committed.
    check(await commitButton.isEnabled(), 'commit action is enabled with an empty message box');
    const hintShown = (await dialog.innerText()).includes('AI drafts one')
      || (await dialog.innerText()).includes('留空则由 AI 起草');
    check(hintShown, 'card explains that an empty message is drafted by the AI');

    const before = headOf();
    await commitButton.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const committed = await waitForCommit(() => headOf() !== before, 120_000);
    const drafted = committed ? subjectOf() : '';
    check(committed, 'empty-box commit reached the repository', drafted);
    check(
      /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./@ -]+\))?!?: .+/.test(drafted),
      'the AI-drafted commit subject is a Conventional Commit',
      drafted,
    );
    await writeFile(join(OUT, 'commit-message.txt'), drafted, 'utf8');

    const pillAfter = await page.locator('[data-dsh-git-commit-panel="pill"]').count();
    check(pillAfter === 0, 'pill disappears once the work tree is clean');
    await page.screenshot({ path: join(OUT, 'panel-after-commit.png') });

    // 2. Explicit drafting still fills the box with reviewable text. The page
    //    reloads first so the probe runs against the freshly seeded change
    //    rather than waiting out a poll interval.
    seedChange();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-shell-overlay]', { timeout: 45_000 });
    const reappeared = await waitForPill(true, 40_000);
    check(reappeared, 'pill returns for the next change set');
    if (reappeared) {
      await page.locator(pillSelector).first()
        .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForTimeout(1_500);
      const card = page.locator('[data-dsh-git-commit-panel="card"]').first();
      const nextTextarea = card.locator('textarea');
      await nextTextarea.evaluate((element) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(element, '   ');
        element.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(400);
      await card.locator('button').filter({ hasText: /Generate with AI|AI 生成/ }).first()
        .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      const deadline = Date.now() + 120_000;
      let draftedText = '';
      while (Date.now() < deadline) {
        await page.waitForTimeout(1_000);
        draftedText = (await nextTextarea.inputValue()).trim();
        if (draftedText !== '') break;
      }
      check(draftedText !== '', 'Generate with AI fills the message box', draftedText.slice(0, 80));
      await card.screenshot({ path: join(OUT, 'panel-generated.png') }).catch(() => {});
    }
    await page.screenshot({ path: join(OUT, 'panel-open.png') });
  }
}

await writeFile(
  join(OUT, 'verify-report.json'),
  JSON.stringify({ results, consoleErrors, pageErrors, overlayHtml: overlayHtml.slice(0, 2000) }, null, 2),
  'utf8',
);

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const error of consoleErrors.slice(0, 10)) console.log(`  - ${error.slice(0, 300)}`);
console.log(`page errors: ${pageErrors.length}`);
for (const error of pageErrors.slice(0, 10)) console.log(`  - ${error.slice(0, 300)}`);

await browser.close();

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
