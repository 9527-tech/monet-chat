import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:4176';
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
if (await page.locator('#onboarding:not(.hidden)').count()) {
  await page.fill('#ob-name', '设置检查');
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)');
}
await page.click('#btn-settings');
await page.click('.settings-tab[data-tab="general"]');
await page.waitForSelector('#set-background');
const before = {
  background: await page.isChecked('#set-background'),
  haptics: await page.isChecked('#set-haptics'),
  motion: await page.isChecked('#set-motion'),
};
await page.locator('label.settings-switch:has-text("后台保活")').click();
await page.locator('label.settings-switch:has-text("触感反馈")').click();
const after = {
  background: await page.isChecked('#set-background'),
  haptics: await page.isChecked('#set-haptics'),
};
await page.screenshot({ path: 'screenshots/86-settings-general.png' });
await page.click('.modal-actions .btn.filled');
await page.waitForTimeout(600);
const stored = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monet-chat'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('settings', 'readonly');
  return new Promise((res) => { const q = tx.objectStore('settings').get('app'); q.onsuccess = () => res(q.result); });
});
console.log(JSON.stringify({ before, after, stored: { backgroundKeepAlive: stored?.backgroundKeepAlive, haptics: stored?.haptics }, errors }, null, 2));
await browser.close();
