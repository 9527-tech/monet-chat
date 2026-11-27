import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const ROOT = 'D:\\OneDrive\\Documents\\deepseek-harness\\default-workspace\\monet-chat';
const REPO = '9527-tech/monet-chat';
const MSG = '1.2.2: fix message history scroll, QR join scanner, room re-create, TURN, screen-share guard';
const GIT = join(ROOT, 'toolchain', 'git', 'cmd', 'git.exe');

function sh(cmd) { return execSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: 'cmd' }).trim(); }

const token = process.env.GH_TOKEN || sh(`echo protocol=https& echo host=github.com& echo & echo | "${GIT}" credential fill | findstr /c:"password="`).replace('password=', '').trim();

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: 'api.github.com', path, method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'monet-chat',
        'Accept': 'application/vnd.github+json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${method} ${path} -> ${res.statusCode} ${buf.slice(0, 400)}`));
        resolve(buf ? JSON.parse(buf) : null);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const files = sh(`"${GIT}" diff-tree --no-commit-id --name-only -r HEAD`)
  .split(/\r?\n/).filter(Boolean);

const ref = await api('GET', `/repos/${REPO}/git/ref/heads/main`);
const baseCommit = ref.object.sha;
const base = await api('GET', `/repos/${REPO}/git/commits/${baseCommit}`);
const tree = [];
for (const f of files) {
  const content = readFileSync(join(ROOT, f));
  const blob = await api('POST', `/repos/${REPO}/git/blobs`, { content: content.toString('base64'), encoding: 'base64' });
  tree.push({ path: f.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
  console.log('blob', f, blob.sha);
}
const newTree = await api('POST', `/repos/${REPO}/git/trees`, { base_tree: base.tree.sha, tree });
const commit = await api('POST', `/repos/${REPO}/git/commits`, { message: MSG, tree: newTree.sha, parents: [baseCommit] });
await api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: false });
console.log('pushed', commit.sha);
