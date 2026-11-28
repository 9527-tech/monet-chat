import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args:['--host-resolver-rules=MAP monet-chat.tailb40225.ts.net 103.84.155.153','--no-proxy-server'] });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs=[]; p.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
await p.goto('https://monet-chat.tailb40225.ts.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(4000);
console.log('title', await p.title());
console.log('remote', await p.evaluate(async()=> (await fetch('/api/remote')).json()));
console.log('errors', errs.slice(0,5));
await p.screenshot({ path: 'screenshots/85-permanent.png' });
await b.close();

