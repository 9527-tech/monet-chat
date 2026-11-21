import { chromium } from 'playwright-core';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:4181';
const OUT = path.resolve('screenshots');
const errors = [];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.fill('#ob-name', '取色测试');
const chooserPromise = page.waitForEvent('filechooser');
await page.click('#ob-avatar');
const chooser = await chooserPromise;
await chooser.setFiles(path.resolve('screenshots/square-avatar.png'));
await page.waitForTimeout(1200);
const avatarBox = await page.locator('#ob-avatar-preview').boundingBox();
const imgBox = await page.locator('#ob-avatar-preview img').boundingBox();
console.log('avatar boxes', { avatarBox, imgBox });
if (avatarBox) {
  await page.screenshot({
    path: path.join(OUT, '71-avatar-square.png'),
    clip: { x: Math.max(0, avatarBox.x - 18), y: Math.max(0, avatarBox.y - 18), width: avatarBox.width + 36, height: avatarBox.height + 36 },
  });
}
await page.click('#ob-create');
await page.waitForSelector('#shell:not(.hidden)', { timeout: 10000 });
await page.waitForTimeout(400);

await page.click('#btn-settings');
await page.waitForSelector('.settings-modal', { timeout: 5000 });
const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
const hintBefore = await page.locator('#seed-hint').innerText();

await page.click('[data-wall="peach"]');
await page.waitForTimeout(450);
const peach = await page.evaluate(() => ({
  primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  seed: document.querySelector('#set-seed')?.value,
  hint: document.querySelector('#seed-hint')?.innerText,
}));
await page.click('[data-wall="forest"]');
await page.waitForTimeout(450);
const forest = await page.evaluate(() => ({
  primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  seed: document.querySelector('#set-seed')?.value,
  hint: document.querySelector('#seed-hint')?.innerText,
}));
await page.click('.settings-tab[data-tab="profile"]');
await page.waitForTimeout(120);
const anim = await page.evaluate(() => {
  const p = document.querySelector('.settings-panel[data-panel="profile"]');
  return { className: p.className, animation: getComputedStyle(p).animationName, duration: getComputedStyle(p).animationDuration };
});
await page.screenshot({ path: path.join(OUT, '72-settings-refine.png') });

// custom seed must switch back to manual mode
await page.click('.settings-tab[data-tab="appearance"]');
await page.evaluate(() => {
  const i = document.querySelector('#set-seed');
  i.value = '#00bcd4';
  i.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(250);
const manual = await page.evaluate(() => ({
  seed: document.querySelector('#set-seed')?.value,
  hint: document.querySelector('#seed-hint')?.innerText,
  primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
}));

console.log(JSON.stringify({ before, hintBefore, peach, forest, anim, manual, errors }, null, 2));
await browser.close();
