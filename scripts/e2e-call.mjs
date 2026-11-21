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
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    permissions: ['camera', 'microphone'],
  });
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
  await A.page.waitForTimeout(1500);

  // Audio call
  await A.page.click('#btn-call');
  await B.page.waitForSelector('.call-incoming', { timeout: 15000 });
  await B.page.screenshot({ path: path.join(OUT, '09-incoming-call.png') });
  await B.page.locator('[data-call-act="accept"]').click({ force: true });
  await A.page.waitForSelector('.call-screen', { timeout: 15000 });
  await B.page.waitForSelector('.call-screen', { timeout: 15000 });
  await A.page.waitForTimeout(4000);
  console.log('audio call active:');
  console.log(' A:', (await A.page.textContent('.call-screen'))?.replace(/\s+/g, ' ').trim().slice(0, 120));
  console.log(' B:', (await B.page.textContent('.call-screen'))?.replace(/\s+/g, ' ').trim().slice(0, 120));
  await A.page.screenshot({ path: path.join(OUT, '10-audio-call.png') });

  // Mute + hangup
  await A.page.locator('[data-call-act="mute"]').click();
  await B.page.waitForTimeout(500);
  await A.page.locator('[data-call-act="hangup"]').click();
  await A.page.waitForTimeout(1600);
  console.log('audio call ended, A overlay hidden:', await A.page.locator('.call-screen').count() === 0);

  // Video call
  await A.page.waitForTimeout(1200);
  await A.page.click('#btn-video');
  await B.page.waitForSelector('.call-incoming', { timeout: 15000 });
  await B.page.locator('[data-call-act="accept"]').click({ force: true });
  await A.page.waitForSelector('.call-screen.video-mode', { timeout: 15000 });
  await A.page.waitForTimeout(3500);
  const video = await A.page.evaluate(() => {
    const local = document.querySelector('.call-local-video');
    const remote = document.querySelector('.call-remote-video');
    return {
      local: !!local && local.videoWidth > 0,
      remote: !!remote && remote.videoWidth > 0,
      localMuted: local?.muted,
      remoteMuted: remote?.muted,
    };
  });
  console.log('video tracks:', video);
  await A.page.screenshot({ path: path.join(OUT, '11-video-call.png') });
  await B.page.screenshot({ path: path.join(OUT, '12-video-call-B.png') });
  await A.page.locator('[data-call-act="hangup"]').click();
  await A.page.waitForTimeout(1500);

  // Call logs should be present locally.
  const logsA = await A.page.locator('.call-log').count();
  const logsB = await B.page.locator('.call-log').count();
  console.log('call logs:', { A: logsA, B: logsB });
  console.log('CONSOLE_ERRORS', JSON.stringify(errors, null, 2));
} finally {
  await browser.close();
}
