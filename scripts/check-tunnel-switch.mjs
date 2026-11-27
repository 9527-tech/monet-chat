import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:4182';
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
if (await page.locator('#onboarding:not(.hidden)').count()) {
  await page.fill('#ob-name', '开关测试');
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)');
}
await page.click('#btn-settings');
await page.click('.settings-tab[data-tab="network"]');
await page.waitForSelector('#btn-remote-off');
const initial = await page.textContent('#remote-state');
const autoBefore = await page.isChecked('#set-tunnel-auto');
await page.click('#btn-remote-off');
await page.waitForFunction(() => document.querySelector('#remote-state')?.textContent?.includes('已断开'), null, { timeout: 15000 });
const remote = await (await fetch(`${BASE}/api/remote`)).json();
const after = await page.textContent('#remote-state');
await page.locator('label.settings-switch:has-text("启动时自动连接")').click();
await page.click('.modal-actions .btn.filled');
await page.waitForTimeout(1200);
const stored = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monet-chat'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction('settings', 'readonly');
  return new Promise((res) => { const q = tx.objectStore('settings').get('app'); q.onsuccess = () => res(q.result); });
});
console.log(JSON.stringify({ initial, autoBefore, after, status: remote.status, storedAuto: stored?.tunnelAuto, errors }, null, 2));
await browser.close();
