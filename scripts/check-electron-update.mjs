import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ args: [root], cwd: root, env });
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForSelector('#onboarding:not(.hidden), #shell:not(.hidden)', { timeout: 20000 });
if (await page.locator('#onboarding:not(.hidden)').count()) {
  await page.fill('#ob-name', '更新桥测试');
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)', { timeout: 20000 });
}
const result = await page.evaluate(async () => {
  if (!window.monetDesktop) return { bridge: false };
  const info = await window.monetDesktop.checkUpdate();
  return { bridge: true, info };
});
console.log(JSON.stringify(result, null, 2));
await app.close();
