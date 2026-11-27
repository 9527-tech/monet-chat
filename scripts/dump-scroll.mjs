import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1000, height: 820 } });
await p.goto('http://127.0.0.1:4175', { waitUntil: 'domcontentloaded' });
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
const m = await p.evaluate(() => {
  const box = document.getElementById('messages');
  const inner = box.querySelector('.messages-inner');
  return {
    box: { h: box.clientHeight, sh: box.scrollHeight, st: box.scrollTop },
    inner: { h: inner.clientHeight, sh: inner.scrollHeight, minH: getComputedStyle(inner).minHeight },
    children: inner.children.length,
    firstChildH: inner.firstElementChild ? inner.firstElementChild.clientHeight : 0,
    boxCS: getComputedStyle(box).overflowY,
    boxDisplay: getComputedStyle(box).display,
    boxFlex: getComputedStyle(box).flex,
    boxHeight: getComputedStyle(box).height,
  };
});
console.log(JSON.stringify(m, null, 2));
await b.close();
