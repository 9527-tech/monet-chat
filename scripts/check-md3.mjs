import { chromium } from 'playwright-core';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4177';
const OUT = path.resolve('screenshots');

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#onboarding:not(.hidden)');
await page.fill('#ob-name', '莫奈');
await page.click('#ob-create');
await page.waitForSelector('#shell:not(.hidden)');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, 'md3-01-empty.png') });

await page.click('#btn-new');
await page.click('.menu-item:has-text("新对话")');
await page.waitForSelector('#invite-code');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'md3-02-invite.png') });
console.log(JSON.stringify(await page.evaluate(() => ({
  modals: document.querySelectorAll('.modal').length,
  qr: document.querySelectorAll('.qr-card').length,
  modalBg: getComputedStyle(document.querySelector('.modal')).backgroundColor,
  opacity: getComputedStyle(document.querySelector('.modal')).opacity,
}))));
await page.getByRole('button', { name: '完成' }).click();

await page.click('.rail-btn[data-rail="settings"]');
await page.waitForSelector('.settings-tabs');
await page.screenshot({ path: path.join(OUT, 'md3-03-settings.png') });
await page.click('.settings-tab[data-tab="general"]');
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(OUT, 'md3-04-general.png') });
await page.click('.settings-tab[data-tab="appearance"]');
await page.click('.segmented[data-seg="themeMode"] .seg-btn:has-text("深色")');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, 'md3-08-settings-dark.png') });
await page.getByRole('button', { name: '取消' }).click();

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
const p = await phone.newPage();
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#onboarding:not(.hidden)');
await p.fill('#ob-name', '小屏');
await p.click('#ob-create');
await p.waitForSelector('#shell:not(.hidden)');
await p.waitForTimeout(500);
await p.screenshot({ path: path.join(OUT, 'md3-05-phone-list.png') });
await p.click('[data-nav="settings"]');
await p.waitForSelector('.settings-tabs');
await p.waitForTimeout(350);
await p.screenshot({ path: path.join(OUT, 'md3-07-phone-settings.png') });
const metrics = await p.evaluate(() => ({
  nav: getComputedStyle(document.querySelector('.mobile-nav')).display,
  sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
  shellPad: getComputedStyle(document.querySelector('.shell')).padding,
  tabs: document.querySelector('.settings-tabs').scrollWidth,
  tabsClient: document.querySelector('.settings-tabs').clientWidth,
}));
console.log(JSON.stringify({ errors, metrics }));
await browser.close();
