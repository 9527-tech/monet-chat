import fs from 'node:fs';
const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN missing');
const repo = '9527-tech/monet-chat';
const api = `https://api.github.com/repos/${repo}`;
const tag = process.env.TAG || 'v1.4.0';
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'monet-chat' };
async function gh(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}
const body = fs.readFileSync('release/发布说明-1.4.0.md', 'utf8');
let release;
try {
  release = await gh(`${api}/releases`, { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: 'Monet Chat 1.4.0 · Material 3', body, draft: false, prerelease: false }) });
} catch (e) {
  if (!String(e.message).includes('422')) throw e;
  const list = await gh(`${api}/releases/tags/${tag}`);
  release = list;
}
console.log('release', release.id, release.html_url);
const files = [
  'MonetChat-1.4.0.apk',
  'MonetChat-Setup-1.4.0.exe',
  'MonetChat-Portable-1.4.0.exe',
  'MonetChat-1.4.0-linux-x64.tar.gz',
  'monet-chat-1.4.0-source.zip',
  'SHA256SUMS-1.4.0.txt',
  '安装说明.txt',
];
for (const name of files) {
  const local = `release/${name}`;
  const assetName = name === '安装说明.txt' ? 'INSTALL-1.4.0.txt' : name;
  const data = fs.readFileSync(local);
  console.log('upload', assetName, data.length);
  const r = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
    body: data,
    duplex: 'half',
  });
  const t = await r.text();
  if (!r.ok) {
    if (r.status === 422 && t.includes('already_exists')) { console.log('exists', assetName); continue; }
    throw new Error(`${r.status} ${assetName} ${t.slice(0, 300)}`);
  }
  console.log('ok', assetName, JSON.parse(t).size);
}
