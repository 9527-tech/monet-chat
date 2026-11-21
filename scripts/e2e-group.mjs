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
async function makePage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
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
  await page.waitForSelector('#me-card .avatar', { timeout: 15000 });
}

const A = await makePage('A');
const B = await makePage('B');
const C = await makePage('C');

try {
  await onboard(A.page, '林小满');

  // New group: menu -> prompt for name -> invite modal
  await A.page.click('#btn-new');
  await A.page.click('.menu-item:has-text("创建群聊")');
  await A.page.waitForSelector('.modal input', { timeout: 10000 });
  await A.page.fill('.modal input', '周末出游计划');
  await A.page.getByRole('button', { name: '创建', exact: true }).click();
  await A.page.waitForSelector('#invite-code', { timeout: 20000 });
  const code = (await A.page.textContent('#invite-code')).trim();
  console.log('group code:', code);
  await A.page.screenshot({ path: path.join(OUT, '05-group-invite.png') });
  await A.page.getByRole('button', { name: '完成' }).click();

  await B.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await B.page.fill('#ob-name', '周予安');
  await B.page.click('#ob-create');
  await B.page.waitForSelector('#chat-view:not(.hidden)', { timeout: 20000 });

  // A should see a 2-person member count and P2P connection.
  await A.page.waitForFunction(() => /2 人/.test(document.querySelector('#chat-subtitle')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
  await A.page.waitForTimeout(2200);
  console.log('group subtitle:', (await A.page.textContent('#chat-subtitle'))?.trim());

  const hello = `群聊广播测试 ${Date.now()}`;
  await A.page.fill('#input', hello);
  await A.page.click('#btn-send');
  await B.page.waitForSelector(`.msg .bubble:has-text("群聊广播测试")`, { timeout: 20000 });
  console.log('A -> group ok');

  const reply = '收到，群聊也走 P2P。';
  await B.page.fill('#input', reply);
  await B.page.click('#btn-send');
  await A.page.waitForSelector(`.msg .bubble:has-text("收到，群聊也走 P2P")`, { timeout: 20000 });
  console.log('group -> A ok');

  // Third member joins; group fanout should reach both.
  await C.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await C.page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await C.page.fill('#ob-name', '程一');
  await C.page.click('#ob-create');
  await C.page.waitForSelector('#chat-view:not(.hidden)', { timeout: 20000 });
  await A.page.waitForTimeout(2600);

  const three = '三个人都收到了吗？';
  await A.page.fill('#input', three);
  await A.page.click('#btn-send');
  await B.page.waitForSelector(`.msg .bubble:has-text("三个人都收到了吗")`, { timeout: 20000 });
  await C.page.waitForSelector(`.msg .bubble:has-text("三个人都收到了吗")`, { timeout: 20000 });
  console.log('group fanout to 3 members ok');

  await A.page.waitForTimeout(600);
  await A.page.screenshot({ path: path.join(OUT, '06-group-A.png') });
  await C.page.screenshot({ path: path.join(OUT, '07-group-C.png') });

  // Info panel + member list
  await A.page.click('#btn-info');
  await A.page.waitForSelector('#info-panel:not(.hidden)', { timeout: 8000 });
  await A.page.waitForTimeout(400);
  const info = await A.page.textContent('#info-content');
  console.log('info has members:', /程一/.test(info) && /周予安/.test(info));
  await A.page.screenshot({ path: path.join(OUT, '08-group-info.png') });
  await A.page.click('#info-close');

  console.log('CONSOLE_ERRORS', JSON.stringify(errors, null, 2));
} finally {
  await browser.close();
}
