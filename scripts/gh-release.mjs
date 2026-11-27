import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const ROOT = 'D:\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\monet-chat';
const REPO = '9527-tech/monet-chat';
const token = process.env.GH_TOKEN;

function api(method, host, path, body, rawHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: host, path, method,
      headers: {
        'Authorization': `Bearer ${token}`, 'User-Agent': 'monet-chat',
        'Accept': 'application/vnd.github+json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...rawHeaders,
      },
    }, (res) => {
      let buf = ''; res.on('data', (d) => (buf += d));
      res.on('end', () => { if (res.statusCode >= 300) return reject(new Error(`${method} ${path} -> ${res.statusCode} ${buf.slice(0, 300)}`)); resolve(buf ? JSON.parse(buf) : null); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function upload(url, filePath) {
  return new Promise((resolve, reject) => {
    const buf = readFileSync(filePath);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'monet-chat', 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length },
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { if (res.statusCode >= 300) return reject(new Error(`upload -> ${res.statusCode} ${b.slice(0, 200)}`)); resolve(JSON.parse(b)); }); });
    req.on('error', reject);
    req.write(buf); req.end();
  });
}

const rel = await api('POST', 'api.github.com', `/repos/${REPO}/releases`, {
  tag_name: 'v1.2.2', name: 'Monet Chat 1.2.2', draft: false, prerelease: false,
  body: '消息历史滚动修复 · 扫码加好友 · 旧房间自动恢复 · TURN 中继 · Android 屏幕共享守卫 · 语音/视频通话修复',
});
console.log('release', rel.id, rel.html_url);
const assets = [
  ['MonetChat-1.2.2.apk', 'application/vnd.android.package-archive'],
  ['MonetChat-Setup-1.2.2.exe', 'application/octet-stream'],
  ['MonetChat-Portable-1.2.2.exe', 'application/octet-stream'],
  ['monet-chat-1.2.2-source.zip', 'application/zip'],
  ['SHA256SUMS-1.2.2.txt', 'text/plain'],
];
for (const [name] of assets) {
  const p = join(ROOT, 'release', name);
  const url = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`;
  const a = await upload(url, p);
  console.log('uploaded', name, a.state, a.size);
}
console.log('done');
