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
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${tag}] console: ${msg.text()}`);
  });
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
  await A.page.screenshot({ path: path.join(OUT, '01-shell-A.png') });

  await A.page.click('#btn-new');
  await A.page.click('.menu-item:has-text("新对话")');
  await A.page.waitForSelector('#invite-code', { timeout: 20000 });
  const code = (await A.page.textContent('#invite-code')).trim();
  console.log('invite code:', code);
  await A.page.screenshot({ path: path.join(OUT, '02-invite.png') });
  await A.page.getByRole('button', { name: '完成' }).click();

  await B.page.goto(`${BASE}/?join=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await B.page.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
  await B.page.fill('#ob-name', '周予安');
  await B.page.click('#ob-create');
  await B.page.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
  await B.page.waitForSelector('#chat-view:not(.hidden)', { timeout: 20000 });

  // Wait for the encrypted data channels to finish their signed hello.
  await A.page.waitForFunction(() => document.querySelector('#chat-subtitle')?.textContent?.includes('在线'), null, { timeout: 25000 }).catch(() => {});
  await A.page.waitForTimeout(2500);

  const textA = `你好，这是第一条 P2P 消息 ${Date.now()}`;
  await A.page.fill('#input', textA);
  await A.page.click('#btn-send');
  await B.page.waitForSelector(`.msg .bubble:has-text("${textA.slice(0, 12)}")`, { timeout: 20000 });
  console.log('A -> B text ok');

  const textB = '收到！端到端加密通道很顺畅。';
  await B.page.fill('#input', textB);
  await B.page.click('#btn-send');
  await A.page.waitForSelector(`.msg .bubble:has-text("${textB.slice(0, 8)}")`, { timeout: 20000 });
  console.log('B -> A text ok');

  // emoji + read receipt round
  await A.page.click('#btn-emoji');
  await A.page.waitForSelector('.emoji-cell', { timeout: 8000 });
  await A.page.locator('.emoji-cell').first().click();
  await A.page.getByRole('button', { name: '关闭' }).click().catch(() => {});
  await A.page.fill('#input', '表情与状态测试 🙂');
  await A.page.click('#btn-send');
  await B.page.waitForSelector('.msg .bubble:has-text("表情与状态测试")', { timeout: 20000 });
  console.log('emoji round ok');

  // image attachment: sender compresses, receiver renders a thumbnail
  const chooser = A.page.waitForEvent('filechooser');
  await A.page.click('#btn-attach');
  await (await chooser).setFiles(path.resolve('assets/icon-192.png'));
  await B.page.waitForSelector('.msg .image-attachment', { timeout: 30000 });
  console.log('image transfer ok');

  // oversized image is reclassified as a file and needs explicit acceptance
  const largePath = path.join(OUT, 'large-photo.png');
  if (!fs.existsSync(largePath) || fs.statSync(largePath).size < 9 * 1024 * 1024) {
    const dataUrl = await A.page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 2600; c.height = 1900;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = Math.random() * 255;
        img.data[i + 1] = Math.random() * 255;
        img.data[i + 2] = Math.random() * 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    });
    fs.writeFileSync(largePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  const chooserLarge = A.page.waitForEvent('filechooser');
  await A.page.click('#btn-attach');
  await (await chooserLarge).setFiles(largePath);
  await B.page.waitForSelector('.msg .file-attachment.awaiting', { timeout: 60000 });
  const largeCard = (await B.page.locator('.msg .file-attachment.awaiting').last().textContent()) || '';
  if (!largeCard.includes('8MB')) throw new Error('large image was not reclassified as file: ' + largeCard);
  await B.page.locator('.msg .file-attachment.awaiting').last().click();
  await B.page.waitForFunction(() => !document.querySelector('.msg .file-attachment.awaiting'), null, { timeout: 60000 });
  console.log('large image -> file acceptance ok');

  // generic file attachment
  const sample = path.join(OUT, 'sample-note.txt');
  fs.writeFileSync(sample, 'Monet Chat P2P file transfer test\n' + 'x'.repeat(20000));
  const chooser2 = A.page.waitForEvent('filechooser');
  await A.page.click('#btn-attach');
  await (await chooser2).setFiles(sample);
  await B.page.waitForSelector('.msg .file-attachment.awaiting', { timeout: 30000 });
  await B.page.click('.msg .file-attachment.awaiting');
  await B.page.waitForSelector('.msg .file-attachment:not(.awaiting)', { timeout: 30000 });
  await B.page.waitForTimeout(2500);
  const fileState = await B.page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('monet-chat');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = await new Promise((res, rej) => {
      const req = db.transaction('messages').objectStore('messages').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const m = all.find((x) => x?.meta?.name === 'sample-note.txt');
    return m ? { blob: !!m.blob, accepted: !!m.accepted, received: m.transfer?.received, total: m.transfer?.total } : null;
  });
  console.log('file transfer ok', JSON.stringify(fileState));


  const cardStyle = await A.page.evaluate(() => {
    const f = document.querySelector('.msg .file-attachment');
    const info = f?.querySelector('.file-info');
    const name = info?.querySelector('.file-name');
    return {
      align: f ? getComputedStyle(f).textAlign : null,
      justify: f ? getComputedStyle(f).justifyContent : null,
      infoAlign: info ? getComputedStyle(info).alignItems : null,
      nameAlign: name ? getComputedStyle(name).textAlign : null,
      rect: f ? { x: f.getBoundingClientRect().x, w: f.getBoundingClientRect().width } : null,
      nameRect: name ? { x: name.getBoundingClientRect().x, w: name.getBoundingClientRect().width } : null,
      sw: navigator.serviceWorker?.controller?.scriptURL || null,
    };
  });
  console.log('card style', JSON.stringify(cardStyle));
  await A.page.waitForTimeout(900);
  await A.page.screenshot({ path: path.join(OUT, '03-chat-A.png') });
  await B.page.screenshot({ path: path.join(OUT, '04-chat-B.png') });

  console.log('CONSOLE_ERRORS', JSON.stringify(errors, null, 2));
} finally {
  await browser.close();
}
