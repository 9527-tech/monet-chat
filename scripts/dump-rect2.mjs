import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 820 } });
await p.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#onboarding:not(.hidden)', { timeout: 15000 });
await p.fill('#ob-name', 'x'); await p.click('#ob-create');
await p.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
await p.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('monet-chat', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction(['chats', 'messages'], 'readwrite');
  tx.objectStore('chats').put({ id: 'dm:scroll-test', type: 'dm', title: '历史记录', peerId: 'peer-scroll', lastTs: Date.now() });
  const now = Date.now();
  for (let i = 0; i < 200; i++) tx.objectStore('messages').put({ id: 'sm' + i, chatId: 'dm:scroll-test', ts: now - i * 60000, type: 'text', text: '第 ' + (200 - i) + ' 条消息', from: i % 2 ? 'peer-scroll' : 'me', read: true });
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
});
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('#shell:not(.hidden)', { timeout: 15000 });
await p.click('[data-chat-id="dm:scroll-test"]');
await p.waitForTimeout(1000);
const r = await p.evaluate(() => {
  const inner = document.querySelector('.messages-inner');
  const box = document.getElementById('messages');
  const cs = getComputedStyle(inner);
  return {
    innerRect: inner.getBoundingClientRect().toJSON(),
    innerOffsetH: inner.offsetHeight,
    innerScrollH: inner.scrollHeight,
    innerMinH: cs.minHeight,
    innerHeight: cs.height,
    innerFlex: cs.flex,
    innerAlignSelf: cs.alignSelf,
    boxScrollH: box.scrollHeight,
    boxOffsetH: box.offsetHeight,
    boxCS: { display: getComputedStyle(box).display, flexDir: getComputedStyle(box).flexDirection, align: getComputedStyle(box).alignItems, justify: getComputedStyle(box).justifyContent },
    firstMsgTop: inner.querySelector('.msg')?.getBoundingClientRect().top,
    lastMsgBottom: inner.querySelector('.msg:last-of-type')?.getBoundingClientRect().bottom,
    count: inner.querySelectorAll('.msg').length,
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
