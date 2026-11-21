import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const OUT = path.resolve('screenshots');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
const errors = [];

async function makePage(tag, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  return { ctx, page };
}

async function onboard(page, name) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await page.fill('#ob-name', name);
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
}

const A = await makePage('tablet', 900, 1200);
const B = await makePage('phone', 390, 844);

try {
  await onboard(A.page, '平板用户');
  await A.page.click('#btn-new');
  await A.page.click('.menu-item:has-text("新对话")');
  await A.page.waitForSelector('#invite-code', { timeout: 20000 });
  const code = (await A.page.textContent('#invite-code')).trim();
  await A.page.getByRole('button', { name: '完成' }).click();

  await B.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await B.page.fill('#ob-name', '手机用户');
  await B.page.click('#ob-create');
  await B.page.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
  await B.page.waitForSelector('#chat-view:not(.hidden)', { timeout: 20000 });
  await A.page.waitForTimeout(2500);

  const text = `平板双栏布局验证 ${Date.now()}`;
  await A.page.fill('#input', text);
  await A.page.click('#btn-send');
  await B.page.waitForSelector('.msg .bubble:has-text("平板双栏布局验证")', { timeout: 20000 });
  await B.page.fill('#input', '手机端单栏布局也很顺畅。');
  await B.page.click('#btn-send');
  await A.page.waitForSelector('.msg .bubble:has-text("手机端单栏布局")', { timeout: 20000 });

  await A.page.screenshot({ path: path.join(OUT, '31-tablet-chat.png') });
  const tablet = await A.page.evaluate(() => {
    const sb = document.querySelector('#sidebar');
    const shell = document.querySelector('#shell');
    return {
      width: innerWidth,
      sidebar: sb ? getComputedStyle(sb).display : null,
      columns: getComputedStyle(shell).gridTemplateColumns,
      chatOpen: shell.classList.contains('chat-open'),
    };
  });
  console.log('tablet', JSON.stringify(tablet));

  await A.page.setViewportSize({ width: 390, height: 844 });
  await A.page.waitForTimeout(500);
  const phone = await A.page.evaluate(() => {
    const main = document.querySelector('.main');
    return {
      width: innerWidth,
      mainPosition: main ? getComputedStyle(main).position : null,
      chatOpen: document.querySelector('#shell').classList.contains('chat-open'),
    };
  });
  console.log('phone', JSON.stringify(phone));
  await A.page.screenshot({ path: path.join(OUT, '32-phone-chat.png') });

  await A.page.setViewportSize({ width: 1024, height: 768 });
  await A.page.waitForTimeout(500);
  await A.page.screenshot({ path: path.join(OUT, '33-tablet-landscape.png') });

  if (tablet.columns.split(' ').length < 2) throw new Error(`tablet is not two-pane: ${tablet.columns}`);
  if (phone.mainPosition !== 'fixed') throw new Error(`phone should use the single-pane overlay, got ${phone.mainPosition}`);
  console.log('CONSOLE_ERRORS', JSON.stringify(errors));
} finally {
  await browser.close();
}
