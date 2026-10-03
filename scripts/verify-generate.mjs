/**
 * Verification of the AI leg of the panel: click "Generate with AI" in the
 * real browser and assert that a Conventional Commit message lands in the
 * message box. Requires a deployment with a working default model.
 *
 * Usage: node verify-generate.mjs <base-url-with-token>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'artifacts');

const url = process.argv[2];
if (url === undefined) {
  console.error('usage: node verify-generate.mjs <base-url-with-token>');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForSelector('[data-dsh-git-commit-panel="pill"]', { timeout: 45_000 });
await page.waitForTimeout(3_000);
await page.locator('[data-dsh-git-commit-panel="pill"]')
  .evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForTimeout(1_000);

const dialog = page.locator('[data-dsh-git-commit-panel="card"]');
const generate = dialog.locator('button').filter({ hasText: /Generate with AI|AI 生成/ }).first();
console.log('generate button count:', await generate.count());
await generate.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));

// The model call runs on the host; poll the message box until text arrives.
const textarea = dialog.locator('textarea');
let message = '';
for (let attempt = 0; attempt < 60; attempt += 1) {
  await page.waitForTimeout(1_000);
  message = await textarea.inputValue();
  if (message !== '') break;
}

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: join(OUT, 'panel-generated.png') });
const cardText = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
console.log('message:', JSON.stringify(message));
console.log('card text:', cardText.slice(0, 400));
await writeFile(join(OUT, 'generated-message.txt'), message, 'utf8');

const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./@ -]+\))?!?: .+/.test(message);
console.log(conventional ? 'PASS  generated message is a Conventional Commit subject' : 'FAIL  generated message is not a Conventional Commit subject');
console.log(`page errors: ${pageErrors.length}`);
for (const error of pageErrors.slice(0, 5)) console.log(`  - ${error.slice(0, 300)}`);

await browser.close();
process.exit(conventional ? 0 : 1);
