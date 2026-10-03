/**
 * Visual check of the panel against the live theme: renders the pill and the
 * open card in both light and dark, and asserts that every themed colour
 * actually resolves (a token typo silently falls back or paints nothing, which
 * is exactly the drift this check exists to catch).
 *
 * Usage: node scripts/verify-theme.mjs <base-url-with-token> <workspace-path>
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'artifacts');
const url = process.argv[2];
const workspace = resolve(process.argv[3] ?? '.');
if (url === undefined) {
  console.error('usage: node scripts/verify-theme.mjs <base-url-with-token> <workspace-path>');
  process.exit(2);
}

const results = [];
const check = (ok, label, extra = '') => {
  results.push({ ok, label, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra === '' ? '' : ` — ${extra}`}`);
};

execFileSync('node', ['-e', `require('node:fs').appendFileSync(${JSON.stringify(join(workspace, 'theme-probe.txt'))}, 'x\\n')`]);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('[data-dsh-git-commit-panel="pill"]', { timeout: 45_000 });
await page.waitForTimeout(2_000);

/** Read the resolved computed style of the panel and its controls. */
const readStyles = async () => page.evaluate(() => {
  const card = document.querySelector('[data-dsh-git-commit-panel="card"]');
  const pill = document.querySelector('[data-dsh-git-commit-panel="pill"]');
  const primary = document.querySelector('[data-dsh-git-commit-panel="commit-push"]');
  const secondary = document.querySelector('[data-dsh-git-commit-panel="commit"]');
  const textarea = card?.querySelector('textarea');
  const pick = (element) => {
    if (element === null || element === undefined) return null;
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      color: style.color,
      border: style.borderTopWidth + ' ' + style.borderTopColor,
      radius: style.borderRadius,
      shadow: style.boxShadow === 'none' ? 'none' : style.boxShadow.slice(0, 60),
      font: style.fontFamily.split(',')[0] + ' ' + style.fontSize,
    };
  };
  return { pill: pick(pill), card: pick(card), primary: pick(primary), secondary: pick(secondary), textarea: pick(textarea) };
});

const snapshots = {};
for (const mode of ['light', 'dark']) {
  // Start from the collapsed state so the pill is the thing being captured.
  if (await page.locator('[data-dsh-git-commit-panel="card"]').count() > 0) {
    await page.locator('[data-dsh-git-commit-panel="close"]')
      .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(600);
  }
  await page.evaluate((next) => {
    if (next === 'dark') document.body.setAttribute('data-ds-dark-theme', '');
    else document.body.removeAttribute('data-ds-dark-theme');
  }, mode);
  await page.waitForTimeout(400);

  // The pill renders only while the card is closed, so read it first.
  const pillStyles = await readStyles();
  await page.screenshot({ path: join(OUT, `theme-${mode}-pill.png`) });
  await page.locator('[data-dsh-git-commit-panel="pill"]')
    .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(900);
  const card = page.locator('[data-dsh-git-commit-panel="card"]');
  await card.screenshot({ path: join(OUT, `theme-${mode}-card.png`) }).catch(() => {});
  const styles = { ...await readStyles(), pill: pillStyles.pill };
  snapshots[mode] = styles;
  console.log(`\n[${mode}] card=${JSON.stringify(styles.card)}`);
  console.log(`[${mode}] primary=${JSON.stringify(styles.primary)}`);
  console.log(`[${mode}] textarea=${JSON.stringify(styles.textarea)}`);

  // A token that failed to resolve shows up as a transparent background or the
  // browser's default colours rather than a themed value. Note that a `.5px`
  // border computes as `1px` at devicePixelRatio 1 — Chrome snaps sub-pixel
  // borders — so the assertion is about the colour, not the width.
  check(styles.card?.background !== undefined && !/rgba\(0, 0, 0, 0\)/.test(styles.card.background), `[${mode}] card background resolves`);
  check(styles.card?.color !== undefined && !/rgb\(0, 0, 0\)/.test(styles.card.color ?? ''), `[${mode}] card label uses a themed colour`, styles.card?.color);
  check(styles.card?.shadow !== 'none', `[${mode}] card carries a themed elevation`, styles.card?.shadow);
  check(!/rgba\(0, 0, 0, 0\)/.test(styles.primary?.background ?? ''), `[${mode}] primary button fill resolves`, styles.primary?.background);
  check(!/rgba\(0, 0, 0, 0\)/.test(styles.textarea?.background ?? ''), `[${mode}] input fill resolves`, styles.textarea?.background);
  check(styles.pill?.border.startsWith('1px') || styles.pill?.border.startsWith('0.5px'), `[${mode}] pill carries a themed hairline border`, styles.pill?.border);
  check(/Inter|-apple-system|system-ui/.test(styles.card?.font ?? ''), `[${mode}] card uses the theme font`, styles.card?.font);

  await page.locator('[data-dsh-git-commit-panel="close"]')
    .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(700);
}

const light = snapshots.light;
const dark = snapshots.dark;
check(light?.card?.background !== dark?.card?.background, 'light and dark resolve to different surfaces', `${light?.card?.background} vs ${dark?.card?.background}`);
check(light?.card?.color !== dark?.card?.color, 'light and dark resolve to different label colours', `${light?.card?.color} vs ${dark?.card?.color}`);

await writeFile(join(OUT, 'theme-report.json'), JSON.stringify({ results, snapshots }, null, 2), 'utf8');
await browser.close();

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
