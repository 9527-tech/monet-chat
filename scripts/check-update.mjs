import { chromium } from 'playwright-core';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE || 'http://127.0.0.1:4176';
const OUT = path.resolve('screenshots');

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.fill('#ob-name', '更新测试');
await page.click('#ob-create');
await page.waitForSelector('#shell:not(.hidden)', { timeout: 20000 });
await page.click('#btn-settings');
await page.waitForSelector('.settings-modal', { timeout: 10000 });
await page.click('.settings-tab[data-tab="about"]');
await page.waitForSelector('#btn-check-update', { timeout: 5000 });
await page.click('#btn-check-update');
await page.waitForTimeout(2500);
const state = await page.textContent('#update-state');
const modal = await page.locator('.settings-modal').count();
console.log(JSON.stringify({ state, modal, errors }, null, 2));
await page.screenshot({ path: path.join(OUT, '73-update.png') });
await browser.close();
