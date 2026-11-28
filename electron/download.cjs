const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

function downloadFile(url, dest, options = {}) {
  const {
    expectedSize = 0,
    onProgress = null,
    attempt = 0,
    redirects = 0,
  } = options;
  const part = `${dest}.part`;

  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('下载重定向过多'));
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('下载地址无效'));
      return;
    }
    const isLoopback = /^(127\.0\.0\.1|localhost)$/i.test(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
      reject(new Error('更新地址必须是 HTTPS（本机回环地址除外）'));
      return;
    }

    let start = 0;
    try {
      start = fs.statSync(part).size;
    } catch {}
    if (expectedSize && start > expectedSize) {
      try { fs.unlinkSync(part); } catch {}
      start = 0;
    }

    const headers = {
      'user-agent': 'monet-chat-updater/1.1',
      accept: 'application/octet-stream',
      'accept-encoding': 'identity',
    };
    if (start > 0) headers.range = `bytes=${start}-`;

    let settled = false;
    let out = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    const retry = (err) => {
      if (settled) return;
      settled = true;
      try { if (out && !out.closed) out.close(); } catch {}
      if (attempt >= 2 || err?.permanent) {
        reject(err);
        return;
      }
      const wait = Math.min(4000, 900 * (attempt + 1));
      setTimeout(() => {
        downloadFile(url, dest, { ...options, attempt: attempt + 1 }).then(resolve, reject);
      }, wait);
    };

    const req = (parsed.protocol === 'https:' ? https : http).get(parsed, {
      timeout: 25000,
      headers,
    }, (res) => {
      if (req.socket) req.socket.setTimeout(120000);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(new URL(res.headers.location, url).toString(), dest, {
          ...options,
          redirects: redirects + 1,
        }).then(resolve, reject);
        return;
      }

      if (res.statusCode === 416) {
        res.resume();
        if (expectedSize && start === expectedSize) {
          try {
            fs.renameSync(part, dest);
            finish(resolve, { path: dest, size: start, resumed: true });
          } catch (e) {
            finish(reject, e);
          }
          return;
        }
        try { fs.unlinkSync(part); } catch {}
        const err = new Error('续传区间无效，将重新下载');
        retry(err);
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        const err = new Error(`下载失败 HTTP ${res.statusCode}`);
        err.permanent = res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 408 && res.statusCode !== 429;
        retry(err);
        return;
      }

      const resumed = res.statusCode === 206 && start > 0;
      const contentLength = Number(res.headers['content-length'] || 0);
      const total = contentLength > 0 ? (resumed ? start + contentLength : contentLength) : expectedSize;
      let received = resumed ? start : 0;

      out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
      out.on('error', retry);
      res.on('error', retry);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) {
          const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
          onProgress({ received, total, percent });
        }
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        if (settled) return;
        let size = 0;
        try { size = fs.statSync(part).size; } catch {}
        if (total > 0 && size < total) {
          retry(new Error(`下载不完整（${size}/${total}），继续续传`));
          return;
        }
        if (expectedSize && size !== expectedSize) {
          try { fs.unlinkSync(part); } catch {}
          retry(new Error(`安装包大小不符（${size}/${expectedSize}）`));
          return;
        }
        try {
          fs.renameSync(part, dest);
          finish(resolve, { path: dest, size, resumed });
        } catch (e) {
          finish(reject, e);
        }
      }));
    });
    req.on('timeout', () => req.destroy(new Error('下载超时，已保留断点')));
    req.on('error', retry);
  });
}

module.exports = { downloadFile };
