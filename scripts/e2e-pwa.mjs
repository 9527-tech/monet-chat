import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#onboarding:not(.hidden)');
  const reg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
    const r = await navigator.serviceWorker.ready;
    return { ok: true, scope: r.scope, state: r.active?.state };
  });
  console.log('service worker:', reg);

  await page.reload({ waitUntil: 'networkidle' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  console.log('controlled after reload:', controlled);

  const cacheKeys = await page.evaluate(async () => (await caches.keys()));
  console.log('caches:', cacheKeys);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  const text = await page.title();
  console.log('offline shell ok:', text);
  console.log('ERRORS', JSON.stringify(errors));
} catch (err) {
  console.error('FAILED:', err.message);
  console.log('ERRORS', JSON.stringify(errors));
  process.exitCode = 1;
} finally {
  await browser.close();
}
