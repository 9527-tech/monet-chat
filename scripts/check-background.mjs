import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env, NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForSelector('#onboarding:not(.hidden), #shell:not(.hidden)', { timeout: 20000 });
if (await page.locator('#onboarding:not(.hidden)').count()) {
  await page.fill('#ob-name', '后台测试');
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)', { timeout: 20000 });
}

const bridge = await page.evaluate(() => window.monetDesktop?.setBackgroundMode?.(true));
await page.waitForTimeout(400);
const hidden = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0];
  win.close();
  return { destroyed: win.isDestroyed(), visible: win.isVisible() };
});
await page.waitForTimeout(700);
const alive = !app.process().killed;
const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
await page.evaluate(() => window.monetDesktop?.setBackgroundMode?.(false));
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
await page.waitForTimeout(900).catch(() => {});
const closed = app.process().exitCode;
console.log(JSON.stringify({ bridge, hidden, alive, windows, closed }, null, 2));
