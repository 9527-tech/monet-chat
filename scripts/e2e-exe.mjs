import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const exe = path.resolve('dist/win-unpacked/Monet Chat.exe');
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const env = { ...process.env, NODE_ENV: 'production' };
delete env.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({ executablePath: exe, args: [], env });
const errors = [];
try {
  const page = await app.firstWindow({ timeout: 30000 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('#onboarding:not(.hidden), #shell:not(.hidden)', { timeout: 30000 });
  if (await page.locator('#onboarding:not(.hidden)').count()) {
    await page.fill('#ob-name', '桌面安装版');
    await page.click('#ob-create');
    await page.waitForSelector('#shell:not(.hidden)', { timeout: 20000 });
  }
  const title = await page.title();
  const url = page.url();
  await page.screenshot({ path: path.join(OUT, '35-packaged-exe.png') });
  console.log('packaged exe:', title);
  console.log('url:', url);
  console.log('CONSOLE_ERRORS', JSON.stringify(errors));
  if (!/^http:\/\/127\.0\.0\.1:\d+/.test(url)) throw new Error(`unexpected packaged url ${url}`);
} finally {
  await app.close();
}
