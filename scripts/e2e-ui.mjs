import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
});
const errors = [];
async function makePage(tag, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[${tag}] console: ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  return { ctx, page };
}
async function onboard(page, name) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await page.fill('#ob-name', name);
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
}

const A = await makePage('A');
const B = await makePage('B');

try {
  await onboard(A.page, '林小满');
  await A.page.click('#btn-new');
  await A.page.click('.menu-item:has-text("新对话")');
  await A.page.waitForSelector('#invite-code', { timeout: 20000 });
  const code = (await A.page.textContent('#invite-code')).trim();
  await A.page.getByRole('button', { name: '完成' }).click();

  await B.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await B.page.fill('#ob-name', '周予安');
  await B.page.click('#ob-create');
  await B.page.waitForSelector('#chat-view:not(.hidden)', { timeout: 20000 });
  await A.page.waitForFunction(() => !document.querySelector('#btn-call')?.disabled, null, { timeout: 25000 });

  // Seed messages
  await A.page.fill('#input', '这是一条用来搜索的测试消息：晚风与橘子海');
  await A.page.click('#btn-send');
  await B.page.waitForSelector('.msg .bubble:has-text("晚风与橘子海")', { timeout: 15000 });
  await B.page.fill('#input', '还有一条回复用来测试引用。');
  await B.page.click('#btn-send');
  await A.page.waitForSelector('.msg .bubble:has-text("测试引用")', { timeout: 15000 });

  // Reaction
  await A.page.locator('.msg.out').last().hover();
  await A.page.locator('.msg.out').last().locator('[data-act="react"]').click();
  await A.page.waitForSelector('.emoji-cell', { timeout: 8000 });
  await A.page.locator('.emoji-cell').first().click();
  await A.page.getByRole('button', { name: '关闭' }).click().catch(() => {});
  await A.page.waitForSelector('.reaction-chip', { timeout: 8000 });
  await B.page.waitForSelector('.reaction-chip', { timeout: 15000 });
  console.log('reaction round ok');

  // Reply
  await A.page.locator('.msg.in').last().hover();
  await A.page.locator('.msg.in').last().locator('[data-act="reply"]').click();
  await A.page.fill('#input', '引用回复测试通过。');
  await A.page.click('#btn-send');
  await B.page.waitForSelector('.msg .reply-quote:has-text("测试引用")', { timeout: 15000 });
  console.log('reply round ok');

  // Pin
  await A.page.locator('.msg.out').last().hover();
  await A.page.locator('.msg.out').last().locator('[data-act="pin"]').click();
  await A.page.waitForSelector('#pinned-bar:not(.hidden)', { timeout: 8000 });
  console.log('pin ok');

  // Global search
  await A.page.keyboard.press('Control+K');
  await A.page.fill('#search-input', '橘子海');
  await A.page.waitForSelector('.search-hit', { timeout: 10000 });
  await A.page.screenshot({ path: path.join(OUT, '13-search.png') });
  await A.page.locator('.search-hit').first().click();
  await A.page.waitForTimeout(600);
  console.log('search ok');

  // Settings
  await A.page.click('#btn-settings');
  await A.page.waitForSelector('.settings-modal', { timeout: 8000 });
  await A.page.waitForTimeout(350);
  await A.page.screenshot({ path: path.join(OUT, '14-settings-appearance.png') });

  await A.page.click('.settings-tab[data-tab="profile"]');
  await A.page.fill('#set-name', '林小满·改');
  await A.page.click('.modal-actions .btn.filled');
  await A.page.waitForTimeout(900);
  const meName = (await A.page.textContent('#me-card .me-name, #me-card')) || '';
  console.log('profile save name ok:', /林小满·改/.test(meName));
  await B.page.waitForTimeout(1500);
  const bHeader = (await B.page.textContent('#chat-title')) || '';
  console.log('peer profile propagated:', /林小满·改/.test(bHeader));

  // Dark appearance preview + cancel restores
  const beforeDark = await A.page.evaluate(() => document.documentElement.dataset.theme);
  await A.page.click('#btn-settings');
  await A.page.waitForSelector('.settings-modal', { timeout: 8000 });
  await A.page.click('.seg-btn[data-value="dark"]');
  await A.page.waitForTimeout(500);
  const duringDark = await A.page.evaluate(() => document.documentElement.dataset.theme);
  await A.page.screenshot({ path: path.join(OUT, '15-settings-dark.png') });
  await A.page.click('.modal-actions .btn.text');
  await A.page.waitForTimeout(500);
  const afterDark = await A.page.evaluate(() => document.documentElement.dataset.theme);
  console.log('theme preview/cancel:', { beforeDark, duringDark, afterDark });

  // Back to dark for a polished desktop screenshot
  await A.page.click('#btn-settings');
  await A.page.click('.seg-btn[data-value="dark"]');
  await A.page.click('.modal-actions .btn.filled');
  await A.page.waitForTimeout(800);
  await A.page.evaluate(() => document.querySelector('#toast-root')?.replaceChildren());
  await A.page.screenshot({ path: path.join(OUT, '16-chat-dark.png') });
  await A.page.click('#btn-settings');
  await A.page.click('.seg-btn[data-value="light"]');
  await A.page.click('.modal-actions .btn.filled');

  // Mobile layout
  await A.page.setViewportSize({ width: 390, height: 844 });
  await A.page.waitForTimeout(700);
  await A.page.evaluate(() => document.querySelector('#toast-root')?.replaceChildren());
  await A.page.screenshot({ path: path.join(OUT, '17-mobile-chat.png') });
  await A.page.click('#btn-back');
  await A.page.waitForTimeout(500);
  await A.page.screenshot({ path: path.join(OUT, '18-mobile-list.png') });

  await A.page.click('#btn-settings');
  await A.page.waitForSelector('.settings-modal', { timeout: 8000 });
  await A.page.waitForTimeout(400);
  await A.page.evaluate(() => document.querySelector('#toast-root')?.replaceChildren());
  await A.page.screenshot({ path: path.join(OUT, '21-mobile-settings.png') });
  await A.page.keyboard.press('Escape');

  // Material You extraction from an uploaded wallpaper
  await A.page.setViewportSize({ width: 1440, height: 900 });
  await A.page.click('#btn-settings');
  await A.page.waitForSelector('.settings-modal', { timeout: 8000 });
  const beforePrimary = await A.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  const [chooser] = await Promise.all([
    A.page.waitForEvent('filechooser'),
    A.page.click('#btn-wall-upload'),
  ]);
  await chooser.setFiles(path.resolve('assets/icon-512.png'));
  await A.page.waitForTimeout(1600);
  const customTiles = await A.page.locator('.wallpaper-swatch[data-wall="custom"]').count();
  const afterPrimary = await A.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  await A.page.click('.modal-actions .btn.filled');
  await A.page.waitForTimeout(900);
  const wallpaperBg = await A.page.evaluate(() => getComputedStyle(document.querySelector('#wallpaper')).backgroundImage);
  await A.page.evaluate(() => document.querySelector('#toast-root')?.replaceChildren());
  await A.page.screenshot({ path: path.join(OUT, '22-custom-wallpaper.png') });
  console.log('wallpaper extraction:', { customTiles, changed: beforePrimary !== afterPrimary, bg: /url\(/.test(wallpaperBg) });

  console.log('CONSOLE_ERRORS', JSON.stringify(errors, null, 2));
} finally {
  await browser.close();
}
