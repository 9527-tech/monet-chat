const { _electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const exe = path.resolve('dist/update test3/Monet Chat.exe');
  const zip = path.resolve('release/MonetChat-1.4.2-win64-portable.zip');
  const size = fs.statSync(zip).size;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: exe, args: [], env, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForSelector('#shell', { timeout: 30000 }).catch(() => {});
  console.log('window', await page.title());
  const result = await page.evaluate(async ([url, bytes]) => {
    try {
      return await window.monetDesktop.installUpdate(url, bytes);
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }, ['http://127.0.0.1:4173/release/MonetChat-1.4.2-win64-portable.zip', size]);
  console.log('install result', result);
  await new Promise((r) => setTimeout(r, 25000));
  const installed = path.resolve('dist/update test3/Monet Chat.exe');
  const v = fs.existsSync(installed)
    ? require('child_process').execFileSync('powershell', ['-Command', `(Get-Item '${installed.replace(/'/g, "''")}').VersionInfo.FileVersion`], { encoding: 'utf8' }).trim()
    : 'missing';
  console.log('installed version', v);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
