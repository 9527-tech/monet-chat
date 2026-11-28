import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const ROOT = 'D:\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\monet-chat';
const REPO = '9527-tech/monet-chat';
const token = process.env.GH_TOKEN;
const files = process.argv.slice(2);

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        Authorization: `Bearer ${token}`, 'User-Agent': 'monet-chat',
        Accept: 'application/vnd.github+json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => res.statusCode >= 300 ? reject(new Error(`${method} ${path} ${res.statusCode} ${b.slice(0, 300)}`)) : resolve(b ? JSON.parse(b) : null));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

for (const file of files) {
  const apiPath = file.split('/').map(encodeURIComponent).join('/');
  let sha;
  try { sha = (await req('GET', `/repos/${REPO}/contents/${apiPath}?ref=main`)).sha; } catch {}
  const content = readFileSync(join(ROOT, file)).toString('base64');
  const res = await req('PUT', `/repos/${REPO}/contents/${apiPath}`, {
    message: `Update ${file}`,
    content,
    branch: 'main',
    ...(sha ? { sha } : {}),
  });
  console.log('uploaded', file, res.commit?.sha);
}
