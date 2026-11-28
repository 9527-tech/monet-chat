import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN missing');
const repo = '9527-tech/monet-chat';
const api = `https://api.github.com/repos/${repo}`;
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'monet-chat' };

async function gh(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const git = (args) => execFileSync('toolchain\\git\\cmd\\git.exe', args, { encoding: 'utf8' });

const ref = await gh(`${api}/git/ref/heads/main`);
const baseSha = ref.object.sha;
const baseCommit = await gh(`${api}/git/commits/${baseSha}`);
const changed = git(['diff', '--name-only', 'origin/main', 'HEAD'])
  .split(/\r?\n/).filter(Boolean)
  .filter((f) => !f.startsWith('screenshots/') && !f.startsWith('release/') && !f.startsWith('www/') && !f.startsWith('dist'));
const extras = fs.readdirSync('screenshots').filter((f) => f.startsWith('md3-')).map((f) => `screenshots/${f}`);
const files = [...new Set([...changed, ...extras])].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());

console.log('base', baseSha, 'files', files.length);
const tree = [];
for (const f of files) {
  const content = fs.readFileSync(f).toString('base64');
  const blob = await gh(`${api}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
  tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
  console.log('blob', f);
}
const newTree = await gh(`${api}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) });
const message = process.env.COMMIT_MESSAGE || 'Monet Chat 1.4.0: Material 3 refactor, adaptive navigation, responsive polish';
const commit = await gh(`${api}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }) });
await gh(`${api}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
console.log('commit', commit.sha);
