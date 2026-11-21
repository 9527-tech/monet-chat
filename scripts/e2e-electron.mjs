import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const errors = [];
const env = { ...process.env, NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  args: [root],
  cwd: root,
  env,
});

app.process().stderr?.on('data', (chunk) => {
  const text = String(chunk).trim();
  if (text) console.log('[stderr]', text);
});

const page = await app.firstWindow({ timeout: 30000 });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));

await page.waitForSelector('#onboarding:not(.hidden), #shell:not(.hidden)', { timeout: 20000 });
if (await page.locator('#onboarding:not(.hidden)').count()) {
  await page.fill('#ob-name', '桌面测试');
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)', { timeout: 20000 });
}
console.log('electron shell:', await page.title());
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(root, 'screenshots', '30-electron.png') });
const ui = await page.evaluate(() => ({
  simple: document.body.classList.contains('simple-mode'),
  newLabel: document.querySelector('#btn-new span:last-child')?.textContent,
  emptyTitle: document.querySelector('#empty-state .empty-card h2')?.textContent,
  electron: /Electron/i.test(navigator.userAgent),
}));
console.log('electron ui:', JSON.stringify(ui));
console.log('native class:', await page.evaluate(() => document.documentElement.classList.contains('native')));
console.log('CONSOLE_ERRORS', JSON.stringify(errors, null, 2));

await app.close();
