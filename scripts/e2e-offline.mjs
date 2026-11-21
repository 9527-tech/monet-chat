import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
const errors = [];
async function ctxPage(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => errors.push(`${tag}: ${err.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  return { ctx, page };
}
async function onboard(page, name) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#onboarding:not(.hidden)');
  await page.fill('#ob-name', name);
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)');
}
const A = await ctxPage('A');
const B = await ctxPage('B');
try {
  await onboard(A.page, '离线甲');
  await A.page.click('#btn-new');
  await A.page.click('.menu-item:has-text("新对话")');
  await A.page.waitForSelector('#invite-code');
  const code = (await A.page.textContent('#invite-code')).trim();
  await A.page.getByRole('button', { name: '完成' }).click();

  await B.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('#onboarding:not(.hidden)');
  await B.page.fill('#ob-name', '离线乙');
  await B.page.click('#ob-create');
  await B.page.waitForSelector('#chat-view:not(.hidden)');
  await A.page.waitForFunction(() => !document.querySelector('#btn-call')?.disabled, null, { timeout: 25000 });
  console.log('initial room:', code, 'online:', (await (await fetch(`${BASE}/api/rooms/${code}`)).json()).online);

  await B.page.close();
  await A.page.waitForTimeout(8000);
  console.log('A subtitle after B close:', (await A.page.textContent('#chat-subtitle')).trim());
  console.log('room online after close:', (await (await fetch(`${BASE}/api/rooms/${code}`)).json()).online);

  await A.page.fill('#input', '这条消息在对方离线时发送。');
  await A.page.click('#btn-send');
  await A.page.waitForTimeout(1500);
  const st = await A.page.locator('.msg.out').last().textContent().catch(() => '');
  console.log('last out message text:', st.slice(0, 120));
  console.log('toast:', (await A.page.textContent('#toast-root').catch(() => '')).trim());

  const page2 = await B.ctx.newPage();
  page2.on('pageerror', (err) => errors.push(`B2: ${err.message}`));
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(`B2 console: ${m.text()}`); });
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('#chat-view:not(.hidden)', { timeout: 20000 });
  await page2.waitForTimeout(6000);
  console.log('B2 chats:', (await page2.textContent('#chat-list')).trim().slice(0, 160));
  console.log('B2 subtitle:', (await page2.textContent('#chat-subtitle')).trim());
  console.log('B2 network:', (await page2.textContent('#net-chip')).trim());
  console.log('A subtitle after B2:', (await A.page.textContent('#chat-subtitle')).trim());
  console.log('room online after B2:', (await (await fetch(`${BASE}/api/rooms/${code}`)).json()).online);
  await page2.screenshot({ path: 'screenshots/offline-b2.png' });

  await page2.waitForSelector('.msg .bubble:has-text("对方离线时发送")', { timeout: 15000 });
  console.log('offline delivery ok');
  console.log('ERRORS', JSON.stringify(errors));
} catch (err) {
  console.error('FAILED:', err.message);
  console.log('ERRORS', JSON.stringify(errors));
  process.exitCode = 1;
} finally {
  await browser.close();
}
