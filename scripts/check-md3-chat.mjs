import { chromium } from 'playwright-core';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4177';
const OUT = path.resolve('screenshots');
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
const errors = [];
const mk = async (name, viewport) => {
  const ctx = await browser.newContext({ viewport, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#onboarding:not(.hidden)');
  await page.fill('#ob-name', name);
  await page.click('#ob-create');
  await page.waitForSelector('#shell:not(.hidden)');
  return { ctx, page };
};
const A = await mk('林小满', { width: 390, height: 844 });
await A.page.click('#btn-new');
await A.page.click('.menu-item:has-text("新对话")');
await A.page.waitForSelector('#invite-code');
const code = (await A.page.textContent('#invite-code')).trim();
await A.page.getByRole('button', { name: '完成' }).click();
const bctx = await browser.newContext({ viewport: { width: 800, height: 900 }, locale: 'zh-CN' });
const B = { ctx: bctx, page: await bctx.newPage() };
B.page.on('console', (m) => { if (m.type() === 'error') errors.push(`[B] ${m.text()}`); });
await B.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
await B.page.waitForSelector('#onboarding:not(.hidden)');
await B.page.fill('#ob-name', '周予安');
await B.page.click('#ob-create');
await B.page.waitForSelector('#shell:not(.hidden)');
await B.page.waitForTimeout(1500);
await B.page.fill('#input', '手机端 MD3 聊天气泡与输入区测试');
await B.page.click('#btn-send');
await A.page.waitForTimeout(1200);
await A.page.fill('#input', '收到，这样阅读起来舒服多了。');
await A.page.click('#btn-send');
const chooser = A.page.waitForEvent('filechooser');
await A.page.click('#btn-attach');
(await chooser).setFiles(path.resolve('assets/icon-192.png'));
await A.page.waitForSelector('.msg.out .image-attachment');
await A.page.waitForTimeout(1200);
await A.page.screenshot({ path: path.join(OUT, 'md3-06-phone-chat.png') });
const metrics = await A.page.evaluate(() => {
  const media = document.querySelector('.msg.out .bubble.media-bubble');
  const img = document.querySelector('.msg.out .image-attachment');
  return {
    nav: getComputedStyle(document.querySelector('.mobile-nav')).display,
    chatOpen: document.querySelector('#shell').classList.contains('chat-open'),
    bubble: getComputedStyle(document.querySelector('.msg.out .bubble')).backgroundColor,
    media: media ? getComputedStyle(media).backgroundColor : null,
    imageBg: img ? getComputedStyle(img).backgroundColor : null,
    imgBg: (() => { const i = document.querySelector('.msg.out .image-attachment img'); if (!i) return null; const s = getComputedStyle(i); return { bg: s.backgroundColor, shadow: s.boxShadow, border: s.border, outline: s.outline, filter: s.filter }; })(),
    frame: (() => { const b = document.querySelector('.msg.out .image-attachment'); if (!b) return null; const s = getComputedStyle(b); return { bg: s.backgroundColor, border: s.border, shadow: s.boxShadow, padding: s.padding, outline: s.outline }; })(),
    fileAlign: (() => { const f = document.querySelector('.file-attachment'); return f ? getComputedStyle(f).textAlign : null; })(),
  };
});
console.log(JSON.stringify({ errors, metrics }));
await browser.close();
