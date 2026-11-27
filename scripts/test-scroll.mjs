import { chromium } from 'playwright-core';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 820 } });
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(BASE, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
await p.fill('#ob-name', '滚动测试'); await p.click('#ob-create');
await p.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });

// seed 200 messages + a dm chat directly in IndexedDB
await p.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('monet-chat', 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction(['chats', 'messages'], 'readwrite');
  const chats = tx.objectStore('chats');
  const msgs = tx.objectStore('messages');
  const id = 'dm:scroll-test';
  chats.put({ id, type: 'dm', title: '历史记录', peerId: 'peer-scroll', lastTs: Date.now() });
  const now = Date.now();
  for (let i = 0; i < 200; i++) {
    msgs.put({ id: 'sm' + i, chatId: id, ts: now - i * 60000, type: 'text', text: '第 ' + (200 - i) + ' 条消息', from: i % 2 ? 'peer-scroll' : 'me', read: true });
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
});

await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
await p.waitForTimeout(500);
await p.click('[data-chat-id="dm:scroll-test"]');
await p.waitForTimeout(800);

// scroll to very top repeatedly to load older pages
for (let i = 0; i < 20; i++) {
  await p.evaluate(() => { const box = document.getElementById('messages'); box.scrollTop = 0; });
  await p.waitForTimeout(400);
}
const box = await p.evaluateHandle(() => document.getElementById('messages'));
const info = await box.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
const firstText = await p.evaluate(() => {
  const el = document.querySelector('.messages-inner .msg, .messages-inner .msg-system');
  return el ? el.textContent.slice(0, 40) : null;
});
console.log('SCROLL', JSON.stringify(info), 'FIRST', firstText);
console.log('ERRORS', JSON.stringify(errs));
await p.screenshot({ path: 'screenshots/88-scroll-top.png' });
await b.close();
