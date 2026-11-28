import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const ROOT = 'D:\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\monet-chat';
const REPO = '9527-tech/monet-chat';
const token = process.env.GH_TOKEN;

function api(method, host, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: host, path, method,
      headers: {
        Authorization: `Bearer ${token}`, 'User-Agent': 'monet-chat',
        Accept: 'application/vnd.github+json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      let buf = ''; res.on('data', (d) => (buf += d));
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error(`${method} ${path} -> ${res.statusCode} ${buf.slice(0, 400)}`));
        resolve(buf ? JSON.parse(buf) : null);
      });
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
      headers: {
        Authorization: `Bearer ${token}`, 'User-Agent': 'monet-chat',
        Accept: 'application/vnd.github+json', 'Content-Type': 'application/octet-stream',
        'Content-Length': buf.length,
      },
    }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error(`upload ${filePath} -> ${res.statusCode} ${b.slice(0, 300)}`));
        resolve(JSON.parse(b));
      });
    });
    req.on('error', reject);
    req.write(buf); req.end();
  });
}

const body = readFileSync(join(ROOT, 'release', '发布说明-1.4.1.md'), 'utf8');
const rel = await api('POST', 'api.github.com', `/repos/${REPO}/releases`, {
  tag_name: 'v1.4.1', name: 'Monet Chat 1.4.1', draft: false, prerelease: false, body,
});
console.log('release', rel.id, rel.html_url);

const assets = [
  'MonetChat-1.4.1.apk',
  'MonetChat-Setup-1.4.1.exe',
  'MonetChat-1.4.1-linux-x64.tar.gz',
  'MonetChat-1.4.1-win64-portable.zip',
  'monet-chat-1.4.1-source.zip',
  'SHA256SUMS-1.4.1.txt',
  'INSTALL-1.4.1.txt',
];
for (const name of assets) {
  const a = await upload(
    `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
    join(ROOT, 'release', name),
  );
  console.log('uploaded', name, a.state, a.size);
}
console.log('done');
