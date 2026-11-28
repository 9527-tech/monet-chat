import fs from 'node:fs';
const token = process.env.GH_TOKEN;
const file = process.env.FILE;
if (!token || !file) throw new Error('GH_TOKEN/FILE required');
const repo = '9527-tech/monet-chat';
const api = `https://api.github.com/repos/${repo}`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'monet-chat' };
async function gh(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const ref = await gh(`${api}/git/ref/heads/main`);
const base = await gh(`${api}/git/commits/${ref.object.sha}`);
const blob = await gh(`${api}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: fs.readFileSync(file).toString('base64'), encoding: 'base64' }) });
const tree = await gh(`${api}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree: [{ path: file.replaceAll('\\', '/'), mode: '100644', type: 'blob', sha: blob.sha }] }) });
const commit = await gh(`${api}/git/commits`, { method: 'POST', body: JSON.stringify({ message: process.env.MESSAGE || `Add ${file}`, tree: tree.sha, parents: [ref.object.sha] }) });
await gh(`${api}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
console.log(commit.sha);
