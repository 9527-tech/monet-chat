const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { downloadFile } = require('../electron/download.cjs');

const total = 8 * 1024 * 1024;
const data = Buffer.alloc(total);
for (let i = 0; i < total; i++) data[i] = (i * 31 + 7) & 0xff;
const expected = crypto.createHash('sha256').update(data).digest('hex');
let first = true;

const server = http.createServer((req, res) => {
  const range = /bytes=(\d+)-/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  if (start === 0 && first) {
    first = false;
    res.writeHead(200, { 'content-length': total, 'content-type': 'application/octet-stream' });
    res.write(data.subarray(0, 2 * 1024 * 1024));
    setTimeout(() => res.destroy(), 50);
    return;
  }
  res.writeHead(start > 0 ? 206 : 200, {
    'content-length': total - start,
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    ...(start > 0 ? { 'content-range': `bytes ${start}-${total - 1}/${total}` } : {}),
  });
  res.end(data.subarray(start));
});

server.listen(43210, '127.0.0.1', async () => {
  const dest = path.join(os.tmpdir(), 'monet-resume-test.bin');
  try { fs.unlinkSync(dest); } catch {}
  try { fs.unlinkSync(dest + '.part'); } catch {}
  let last = -1;
  const result = await downloadFile('http://127.0.0.1:43210/test.bin', dest, {
    expectedSize: total,
    onProgress: (p) => {
      if (p.percent !== last && p.percent % 10 === 0) {
        last = p.percent;
        console.log('progress', p.percent);
      }
    },
  });
  const buf = fs.readFileSync(dest);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  console.log(JSON.stringify({ size: buf.length, hashOk: hash === expected, resumed: result.resumed }));
  server.close();
  process.exit(hash === expected && buf.length === total ? 0 : 1);
});
