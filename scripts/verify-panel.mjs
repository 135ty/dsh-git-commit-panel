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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'artifacts');

const url = process.argv[2];
if (url === undefined) {
  console.error('usage: node verify-panel.mjs <base-url-with-token> [expected-unstaged-count]');
  process.exit(2);
}
/** Ground truth from `git status`; the harness asserts against it rather than a magic number. */
const expectedUnstaged = process.argv[3] === undefined ? null : Number(process.argv[3]);

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

const overlayHtml = frameReady
  ? await page.locator('[data-shell-overlay]').innerHTML().catch(() => '')
  : '';
const pill = page.locator('[data-dsh-git-commit-panel="pill"]').first();
const pillVisible = await pill.isVisible().catch(() => false);
check(pillVisible, 'floating commit pill rendered', pillVisible ? '' : `overlay html: ${overlayHtml.slice(0, 300)}`);

const pillText = pillVisible ? (await pill.innerText()).replace(/\s+/g, ' ').trim() : '';
check(pillText.includes('main'), 'pill shows the branch name', pillText);
if (expectedUnstaged === null) {
  check(/\d/.test(pillText), 'pill carries a change count', pillText);
} else {
  check(
    new RegExp(`\\b${expectedUnstaged}\\b`).test(pillText),
    `pill shows the unstaged change count (expected ${expectedUnstaged})`,
    pillText,
  );
}

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

    // Drive the controlled textarea the way React's own onChange expects: the
    // native value setter plus a bubbling input event. (Playwright's fill/type
    // does not reach this component's React state in headless Chrome.)
    const message = `fix: verify the floating commit panel ${Date.now()}`;
    await dialog.locator('textarea').evaluate((element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, message);
    await page.waitForTimeout(500);
    const typed = await dialog.locator('textarea').inputValue();
    check(typed === message, 'message box accepts typed text', typed.slice(0, 60));

    const commitButton = dialog.locator('[data-dsh-git-commit-panel="commit"]');
    check(await commitButton.count() === 1, 'commit action present');
    const enabled = await commitButton.isEnabled().catch(() => false);
    check(enabled, 'commit action enables once a message exists');
    await page.screenshot({ path: join(OUT, 'panel-open.png') });
    await dialog.screenshot({ path: join(OUT, 'panel-card.png') }).catch(() => {});

    // Drive the real commit through the panel and watch the pill retire.
    if (enabled) {
      await commitButton.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForTimeout(10_000);
      const pillAfter = await page.locator('[data-dsh-git-commit-panel="pill"]').count();
      const cardText = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      check(pillAfter === 0, 'pill disappears once the work tree is clean', cardText.slice(0, 200));
      await writeFile(join(OUT, 'commit-message.txt'), message, 'utf8');
      await page.screenshot({ path: join(OUT, 'panel-after-commit.png') });
    }
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
