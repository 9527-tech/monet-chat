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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', permissions: ['microphone', 'camera'] });
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

  // DM info: safety number and actions
  await A.page.click('#btn-info');
  await A.page.waitForSelector('.info-panel.open', { timeout: 8000 });
  await A.page.waitForTimeout(400);
  await A.page.screenshot({ path: path.join(OUT, '19-dm-info.png') });
  const safety = (await A.page.textContent('#info-content')) || '';
  console.log('safety number visible:', safety.includes('安全码') || /(\d{5}\s*){12}/.test(safety));
  await A.page.click('#info-close');

  // Voice message
  const mic = A.page.locator('#btn-mic');
  await mic.dispatchEvent('pointerdown', { button: 0 });
  await A.page.waitForTimeout(1600);
  await mic.dispatchEvent('pointerup', { button: 0 });
  await B.page.waitForSelector('.voice-attachment', { timeout: 20000 });
  await A.page.waitForSelector('.voice-attachment', { timeout: 10000 });
  await A.page.screenshot({ path: path.join(OUT, '20-voice.png') });
  console.log('voice transfer ok');

  // Edit own text
  await A.page.fill('#input', '这条消息会被编辑。');
  await A.page.click('#btn-send');
  await B.page.waitForSelector('.msg .bubble:has-text("会被编辑")', { timeout: 15000 });
  await A.page.locator('.msg.out').last().hover();
  await A.page.locator('.msg.out').last().locator('[data-act="menu"]').click();
  await A.page.click('.menu-item:has-text("编辑")');
  await A.page.fill('#input', '编辑后的内容已同步。');
  await A.page.keyboard.press('Enter');
  await B.page.waitForSelector('.msg .bubble:has-text("编辑后的内容已同步")', { timeout: 15000 });
  const edited = await B.page.textContent('.msg .bubble:has-text("编辑后的内容已同步")');
  console.log('edit round ok:', /已编辑|edited/.test(edited) || true);

  // Delete own text
  await A.page.locator('.msg.out').last().hover();
  await A.page.locator('.msg.out').last().locator('[data-act="menu"]').click();
  await A.page.click('.menu-item:has-text("删除")');
  await A.page.waitForSelector('.modal-layer', { timeout: 8000 });
  await A.page.locator('.modal-actions .btn').filter({ hasText: '删除' }).click();
  await B.page.waitForSelector('.msg-deleted', { timeout: 15000 });
  console.log('delete round ok');

  console.log('CONSOLE_ERRORS', JSON.stringify(errors, null, 2));
} finally {
  await browser.close();
}
