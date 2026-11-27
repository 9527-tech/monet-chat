#!/usr/bin/env node
/**
 * Monet Chat server
 * - static file host for the PWA
 * - zero-dependency signalling relay (SSE + JSON) for WebRTC handshakes
 * - never sees message contents: only SDP / ICE and public profile metadata
 */
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, stat, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = '1.3.0';
const GITHUB_REPO = '9527-tech/monet-chat';
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 320 * 1024;
const ROOM_TTL = 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 800;
const MAX_ROOMS = 800;

const clients = new Map();
const rooms = new Map();

// Optional public tunnel. Two modes, in order of preference:
//  1) Tailscale Funnel — stable https://<machine>.<tailnet>.ts.net URL, no domain,
//     survives reboots, works behind CGNAT. One-time `tailscale up` login.
//  2) Cloudflare Quick Tunnel — zero-account fallback, random URL per launch.
// AUTO_TUNNEL=1 starts the best available mode together with the desktop app.
const remote = {
  status: 'idle', url: null, error: null, warning: null, proc: null,
  startedAt: 0, mode: null, stable: false, verified: null, auto: process.env.AUTO_TUNNEL === '1',
};

function probePublic(url) {
  return new Promise((resolve) => {
    const req = https.get(`${url}/api/health`, { timeout: 9000, headers: { 'user-agent': 'monet-chat/1.0' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4096) body += c; });
      res.on('end', () => resolve(res.statusCode === 200 && body.includes('"ok":true')));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function runCmd(exe, args, timeout = 15000) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, out, err: String(e.message || e) });
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeout);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: String(e.message || e) }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

async function findTailscale() {
  const candidates = [
    process.env.TAILSCALE,
    process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : '/usr/bin/tailscale',
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe' : '/usr/local/bin/tailscale',
  ].filter(Boolean);
  for (const file of candidates) {
    try { await access(file); return file; } catch {}
  }
  return null;
}

async function tailscaleState(exe) {
  const r = await runCmd(exe, ['status', '--json'], 8000);
  if (r.code !== 0) return { ok: false, reason: (r.err || r.out || 'tailscale 未登录').trim().slice(0, 240) };
  try {
    const info = JSON.parse(r.out);
    if (info.BackendState && info.BackendState !== 'Running') {
      return { ok: false, reason: `Tailscale 状态：${info.BackendState}` };
    }
    const dns = String(info.Self?.DNSName || '').replace(/\.$/, '');
    if (!dns) return { ok: false, reason: 'Tailscale 已运行，但还没有分配设备域名' };
    return { ok: true, url: `https://${dns}`, dns };
  } catch (e) {
    return { ok: false, reason: `无法解析 tailscale status：${String(e.message || e)}` };
  }
}

async function startTailscaleFunnel() {
  const exe = await findTailscale();
  if (!exe) return { ok: false, reason: '未安装 Tailscale' };
  const state = await tailscaleState(exe);
  if (!state.ok) return { ok: false, reason: state.reason };
  const r = await runCmd(exe, ['funnel', '--bg', '--https=443', `http://127.0.0.1:${PORT}`], 20000);
  if (r.code !== 0) {
    const reason = (r.err || r.out || '').trim().split('\n').slice(-2).join(' ').slice(0, 300);
    return { ok: false, reason: reason || 'Tailscale Funnel 未启用（需要在管理台开启 HTTPS/Funnel）' };
  }
  remote.status = 'online';
  remote.url = state.url;
  remote.mode = 'tailscale';
  remote.stable = true;
  remote.verified = null;
  remote.warning = null;
  remote.error = null;
  probePublic(remote.url).then((ok) => {
    if (remote.url !== state.url) return;
    remote.verified = ok;
    if (!ok) remote.warning = '稳定地址已生成，但本机 DNS 暂时无法自检；外部网络通常仍可访问';
  });
  return { ok: true, url: state.url };
}

function cloudflaredExe() {
  const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  return process.env.CLOUDFLARED || path.join(ROOT, 'toolchain', exeName);
}

async function startCloudflared(extraArgs = [], attempt = 0) {
  const exe = cloudflaredExe();
  try {
    await access(exe);
  } catch {
    remote.status = 'unavailable';
    remote.error = '未安装 cloudflared，远程通道不可用';
    return remote;
  }
  const child = spawn(exe, [
    'tunnel', '--url', `http://127.0.0.1:${PORT}`,
    '--no-autoupdate', '--protocol', 'http2', ...extraArgs,
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  remote.proc = child;
  remote.mode = 'cloudflare';
  remote.stable = false;
  let started = false;
  const onData = (buf) => {
    const text = String(buf);
    const m = text.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i);
    if (m && !started) {
      started = true;
      remote.url = m[0];
      remote.status = 'online';
      remote.error = null;
      remote.warning = '临时公网地址每次启动都会变化；安装并登录 Tailscale 后可获得永久地址';
      probePublic(remote.url).then((ok) => {
        if (remote.url !== m[0]) return;
        remote.verified = ok;
        if (!ok) remote.warning = '公网地址已生成；本机 DNS 无法自检，外部网络通常仍可访问';
      });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', () => {
    remote.proc = null;
    if (remote.status !== 'online') {
      if (attempt === 0) {
        // CN DNS often poisons argotunnel SRV records. Try the opposite path
        // once: direct edge IP first, then normal discovery (or vice versa).
        remote.status = 'starting';
        remote.error = null;
        const edge = process.env.CLOUDFLARE_EDGE || '198.41.192.77:7844';
        startCloudflared(extraArgs.length ? [] : ['--edge', edge], 1);
        return;
      }
      remote.status = 'error';
      remote.error = remote.error || '远程通道启动失败，请检查网络或 DNS';
    }
  });
  setTimeout(() => {
    if (!started && remote.status === 'starting') {
      remote.error = '远程通道启动超时，请检查网络';
      try { child.kill(); } catch {}
    }
  }, 30000).unref();
  return remote;
}

async function startRemoteTunnel() {
  if (remote.proc || remote.status === 'starting' || remote.status === 'online') return remote;
  remote.status = 'starting';
  remote.error = null;
  remote.warning = null;
  remote.url = null;
  remote.mode = null;
  remote.stable = false;
  remote.verified = null;
  remote.startedAt = Date.now();

  const ts = await startTailscaleFunnel();
  if (ts.ok) return remote;
  remote.error = ts.reason && ts.reason !== '未安装 Tailscale' ? `Tailscale：${ts.reason}` : null;
  const edge = process.env.CLOUDFLARE_EDGE || '198.41.192.77:7844';
  return startCloudflared(edge === 'off' ? [] : ['--edge', edge]);
}

let updateCache = { at: 0, data: null };

function versionParts(v) {
  return String(v || '0').replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
}

function versionNewer(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function githubJson(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout,
      headers: { 'user-agent': 'monet-chat-updater/1.0', accept: 'application/vnd.github+json' },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub 请求超时')); });
    req.on('error', reject);
  });
}

async function latestRelease() {
  if (updateCache.data && Date.now() - updateCache.at < 10 * 60 * 1000) return updateCache.data;
  const data = await githubJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
  updateCache = { at: Date.now(), data };
  return data;
}

function assetFor(release, platform) {
  const assets = release.assets || [];
  const tests = {
    win: /Setup.*\.exe$/i,
    android: /\.apk$/i,
    linux: /linux.*\.tar\.gz$/i,
    source: /source\.zip$/i,
  };
  const re = tests[platform] || tests.win;
  return assets.find((a) => re.test(a.name || '')) || null;
}

async function updateInfo(platform) {
  const release = await latestRelease();
  const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
  const asset = assetFor(release, platform);
  let local = null;
  if (asset?.name) {
    try {
      await access(path.join(ROOT, 'release', asset.name));
      local = `/release/${encodeURIComponent(asset.name)}`;
    } catch {}
  }
  return {
    current: APP_VERSION,
    latest,
    available: versionNewer(latest, APP_VERSION) && !!asset,
    platform,
    name: asset?.name || null,
    size: asset?.size || 0,
    url: asset?.browser_download_url || release.html_url,
    local,
    page: release.html_url,
    notes: String(release.body || '').slice(0, 4000),
  };
}

function stopRemoteTunnel() {
  if (remote.proc) {
    try { remote.proc.kill(); } catch {}
    remote.proc = null;
  }
  remote.status = 'idle';
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(n = 4) {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

function roomCode(kind) {
  return `${kind === 'group' ? 'G' : 'D'}-${randomCode(4)}-${randomCode(4)}`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, obj) {
  cors(res);
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function cleanName(name, max = 60) {
  return String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function normalizeProfile(raw = {}) {
  const id = String(raw.id || '');
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return null;
  if (raw.sigPub && !/^[A-Za-z0-9_-]{40,200}$/.test(String(raw.sigPub))) return null;
  if (raw.ecdhPub && !/^[A-Za-z0-9_-]{40,200}$/.test(String(raw.ecdhPub))) return null;
  return {
    id: id.toLowerCase(),
    name: cleanName(raw.name) || '匿名用户',
    bio: cleanName(raw.bio, 140),
    sigPub: String(raw.sigPub || ''),
    ecdhPub: String(raw.ecdhPub || ''),
    sig: String(raw.sig || ''),
  };
}

function publicPeer(client) {
  return {
    ...client.profile,
    online: true,
    connectedAt: client.connectedAt,
  };
}

function peersInRoom(code, exceptId) {
  const room = rooms.get(code);
  if (!room) return [];
  return [...room.members]
    .filter((id) => id !== exceptId)
    .map((id) => clients.get(id))
    .filter(Boolean)
    .map(publicPeer);
}

function sseWrite(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

function broadcast(code, event, data, exceptId) {
  const room = rooms.get(code);
  if (!room) return;
  for (const id of room.members) {
    if (id === exceptId) continue;
    const client = clients.get(id);
    if (client) sseWrite(client.res, event, data);
  }
}

function ensureRoomLimit() {
  if (rooms.size < MAX_ROOMS) return true;
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.members.size === 0 && now - room.lastActive > 60 * 60 * 1000) {
      rooms.delete(code);
      if (rooms.size < MAX_ROOMS) return true;
    }
  }
  return rooms.size < MAX_ROOMS;
}

function addToRoom(client, code) {
  let room = rooms.get(code);
  if (!room) {
    // Keep old invite codes usable after a restart or TTL cleanup.
    room = {
      code,
      kind: code.startsWith('G-') ? 'group' : 'dm',
      name: code.startsWith('G-') ? '恢复的群聊' : '私聊',
      createdAt: Date.now(),
      lastActive: Date.now(),
      members: new Set(),
    };
    rooms.set(code, room);
  }
  const already = room.members.has(client.id);
  if (!already) {
    const max = room.kind === 'dm' ? 2 : 12;
    if (room.members.size >= max) throw new Error(room.kind === 'dm' ? '这个私聊房间已满' : '群聊房间已满（最多 12 人）');
    room.members.add(client.id);
  }
  room.lastActive = Date.now();
  client.rooms.add(code);
  return { room, already };
}

function removeFromRoom(client, code, { announce = true } = {}) {
  const room = rooms.get(code);
  if (!room) {
    client.rooms.delete(code);
    return;
  }
  room.members.delete(client.id);
  room.lastActive = Date.now();
  client.rooms.delete(code);
  if (announce) broadcast(code, 'peer-left', { room: code, peer: publicPeer(client) });
}

function dropClient(id) {
  const client = clients.get(id);
  if (!client) return;
  clients.delete(id);
  clearTimeout(client.graceTimer);
  for (const code of [...client.rooms]) {
    removeFromRoom(client, code);
  }
}

function closeClientStream(client, reason = 'replaced') {
  try {
    sseWrite(client.res, 'bye', { reason });
    client.res.end();
  } catch {}
}

/* ------------------------------- routes ------------------------------- */

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      clients: clients.size,
      rooms: rooms.size,
      uptime: Math.round(process.uptime()),
      version: APP_VERSION,
    });
    return true;
  }

  if (pathname === '/api/update' && req.method === 'GET') {
    const platform = (url.searchParams.get('platform') || 'win').toLowerCase();
    try {
      json(res, 200, await updateInfo(platform));
    } catch (e) {
      json(res, 502, { current: APP_VERSION, available: false, error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/remote' && req.method === 'GET') {
    json(res, 200, {
      status: remote.status,
      url: remote.url,
      error: remote.error,
      warning: remote.warning,
      mode: remote.mode,
      stable: remote.stable,
      verified: remote.verified,
      auto: remote.auto,
      startedAt: remote.startedAt,
    });
    return true;
  }

  if (pathname === '/api/remote/start' && req.method === 'POST') {
    await startRemoteTunnel();
    json(res, 200, { status: remote.status, url: remote.url, error: remote.error });
    return true;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    await handleEvents(req, res, url);
    return true;
  }

  if (pathname === '/api/rooms' && req.method === 'POST') {
    const body = await readBody(req);
    const kind = body.kind === 'group' ? 'group' : 'dm';
    const name = cleanName(body.name) || (kind === 'group' ? '新的群聊' : '私聊');
    if (!ensureRoomLimit()) {
      json(res, 503, { error: '服务器房间数量已达上限，请稍后再试' });
      return true;
    }
    let code = roomCode(kind);
    while (rooms.has(code)) code = roomCode(kind);
    const room = {
      code,
      kind,
      name,
      createdAt: Date.now(),
      lastActive: Date.now(),
      members: new Set(),
    };
    rooms.set(code, room);
    json(res, 201, { room: roomMeta(room) });
    return true;
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9-]+)$/);
  if (roomMatch && req.method === 'GET') {
    const room = rooms.get(roomMatch[1].toUpperCase());
    if (!room) {
      json(res, 404, { error: '房间不存在或已过期' });
      return true;
    }
    json(res, 200, { room: roomMeta(room) });
    return true;
  }

  if (pathname === '/api/join' && req.method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').toLowerCase();
    const code = String(body.room || '').toUpperCase();
    const client = clients.get(id);
    if (!client) {
      json(res, 409, { error: '信令连接已断开，正在重连' });
      return true;
    }
    try {
      const { room, already } = addToRoom(client, code);
      const peers = peersInRoom(code, id);
      json(res, 200, { room: roomMeta(room), peers, already });
      if (!already) {
        broadcast(code, 'peer-joined', { room: code, peer: publicPeer(client) }, id);
      }
    } catch (err) {
      json(res, 404, { error: err.message });
    }
    return true;
  }

  if (pathname === '/api/leave' && req.method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').toLowerCase();
    const code = String(body.room || '').toUpperCase();
    const client = clients.get(id);
    if (client) removeFromRoom(client, code);
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/profile' && req.method === 'POST') {
    const body = await readBody(req);
    const id = String(body.id || '').toLowerCase();
    const client = clients.get(id);
    if (!client) {
      json(res, 404, { error: '连接不存在' });
      return true;
    }
    const profile = normalizeProfile(body.p);
    if (!profile || profile.id !== id) {
      json(res, 400, { error: '资料格式错误' });
      return true;
    }
    client.profile = profile;
    for (const code of client.rooms) {
      broadcast(code, 'peer-updated', { room: code, peer: publicPeer(client) }, id);
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/signal' && req.method === 'POST') {
    const body = await readBody(req);
    const from = String(body.from || '').toLowerCase();
    const to = String(body.to || '').toLowerCase();
    const room = String(body.room || '').toUpperCase();
    const fromClient = clients.get(from);
    const toClient = clients.get(to);
    if (!fromClient || !toClient) {
      json(res, 404, { error: '对端不在线' });
      return true;
    }
    const roomObj = rooms.get(room);
    if (!roomObj || !roomObj.members.has(from) || !roomObj.members.has(to)) {
      json(res, 403, { error: '不在同一房间' });
      return true;
    }
    if (!body.data || typeof body.data !== 'object') {
      json(res, 400, { error: '信令内容为空' });
      return true;
    }
    sseWrite(toClient.res, 'signal', {
      room,
      from,
      data: body.data,
      profile: publicPeer(fromClient),
    });
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/disconnect' && req.method === 'POST') {
    let body = {};
    try {
      body = await readBody(req);
    } catch {}
    if (body.id) dropClient(String(body.id).toLowerCase());
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function roomMeta(room) {
  return {
    code: room.code,
    kind: room.kind,
    name: room.name,
    createdAt: room.createdAt,
    online: room.members.size,
  };
}

async function handleEvents(req, res, url) {
  if (clients.size >= MAX_CLIENTS) {
    json(res, 503, { error: '服务器连接数已满' });
    return;
  }
  const id = String(url.searchParams.get('id') || '').toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(id)) {
    json(res, 400, { error: '无效的客户端 ID' });
    return;
  }
  let profile = { id, name: '匿名用户', bio: '', sigPub: '', ecdhPub: '', sig: '' };
  const packed = url.searchParams.get('p');
  if (packed) {
    try {
      const parsed = JSON.parse(Buffer.from(packed, 'base64url').toString('utf8'));
      const normalized = normalizeProfile(parsed);
      if (!normalized || normalized.id !== id) {
        json(res, 400, { error: '资料签名格式错误' });
        return;
      }
      profile = normalized;
    } catch {
      json(res, 400, { error: '资料解析失败' });
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  // 通过 Cloudflare Tunnel 时，边缘会缓冲小响应；先发送一段 SSE 注释把响应头/首包推出去。
  res.write(':' + ' '.repeat(8192) + '\n\n');
  res.write('retry: 1500\n\n');

  const old = clients.get(id);
  if (old) {
    clearTimeout(old.graceTimer);
    closeClientStream(old, 'replaced');
  }

  const roomsSnapshot = [];
  if (old) {
    for (const code of old.rooms) {
      const room = rooms.get(code);
      if (room) {
        roomsSnapshot.push({ meta: roomMeta(room), peers: peersInRoom(code, id) });
      }
    }
  }

  const client = {
    id,
    profile,
    res,
    rooms: old?.rooms || new Set(),
    connectedAt: old?.connectedAt || Date.now(),
    lastSeen: Date.now(),
    graceTimer: 0,
  };
  clients.set(id, client);

  sseWrite(res, 'welcome', {
    id,
    serverTime: Date.now(),
    rooms: roomsSnapshot,
    protocol: 1,
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 20000);

  const cleanup = () => {
    clearInterval(heartbeat);
    if (clients.get(id)?.res !== res) return;
    client.lastSeen = Date.now();
    client.graceTimer = setTimeout(() => {
      if (clients.get(id)?.res === res) dropClient(id);
    }, 6000);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

/* ------------------------------ static ------------------------------ */

async function handleStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname.includes('\0')) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  let filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  let info;
  try {
    info = await stat(filePath);
  } catch {
    if (!path.extname(pathname)) {
      filePath = path.join(ROOT, 'index.html');
      try {
        info = await stat(filePath);
      } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
  }
  if (info.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      info = await stat(filePath);
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${info.size}-${Math.round(info.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return;
  }
  const headers = {
    'Content-Type': type,
    'Content-Length': info.size,
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  };
  const isShell = ['.html', '.js', '.css', '.webmanifest'].includes(ext) || path.basename(filePath) === 'sw.js';
  headers['Cache-Control'] = isShell ? 'no-cache' : 'public, max-age=604800, immutable';
  if (path.basename(filePath) === 'sw.js') headers['Service-Worker-Allowed'] = '/';

  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    const [startRaw, endRaw] = range.replace('bytes=', '').split('-');
    let start = startRaw ? Number(startRaw) : 0;
    let end = endRaw ? Number(endRaw) : info.size - 1;
    if (!startRaw) {
      const suffix = Number(endRaw);
      start = Math.max(0, info.size - suffix);
      end = info.size - 1;
    }
    start = Math.max(0, Math.min(start, info.size - 1));
    end = Math.max(start, Math.min(end, info.size - 1));
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    const { createReadStream } = await import('node:fs');
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  const data = await readFile(filePath);
  res.end(data);
}

/* ------------------------------ server ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) json(res, 404, { error: '接口不存在' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method not allowed');
      return;
    }
    await handleStatic(req, res, url);
  } catch (err) {
    console.error('[monet]', err);
    if (!res.headersSent) json(res, 500, { error: err.message || '服务器错误' });
    else res.end();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.members.size === 0 && now - room.lastActive > ROOM_TTL) rooms.delete(code);
  }
  for (const [id, client] of clients) {
    if (now - client.lastSeen > 5 * 60 * 1000) {
      try {
        client.res.end();
      } catch {}
      dropClient(id);
    }
  }
}, 10 * 60 * 1000).unref();

/* WebSocket transport: Cloudflare Tunnel buffers SSE, so use WS when possible. */
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    socket.destroy();
    return;
  }
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    let buffer = '';
    const fakeRes = {
      writeHead() {},
      write(chunk) {
        buffer += String(chunk);
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          try {
            ws.send(JSON.stringify({ event, data: JSON.parse(data) }));
          } catch {}
        }
      },
      end() {
        try { ws.close(); } catch {}
      },
    };
    const fakeReq = new EventEmitter();
    fakeReq.method = 'GET';
    fakeReq.url = req.url;
    fakeReq.headers = req.headers;
    ws.on('close', () => fakeReq.emit('close'));
    ws.on('error', () => fakeReq.emit('error'));
    handleEvents(fakeReq, fakeRes, url).catch(() => {
      try { ws.close(); } catch {}
    });
  });
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }
  console.log('');
  console.log('  \x1b[38;5;213m◈ Monet Chat\x1b[0m  P2P · Material You');
  console.log(`  ➜  Local:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  ➜  Network: http://${ip}:${PORT}`);
  console.log('');
  if (remote.auto) {
    setTimeout(() => {
      startRemoteTunnel().catch((e) => console.error('[remote]', e));
    }, 1200).unref();
  }
});

function shutdown() {
  stopRemoteTunnel();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', () => {
  console.log('\n  再见 👋');
  shutdown();
});
process.on('SIGTERM', shutdown);
process.on('exit', () => {
  if (remote.proc) { try { remote.proc.kill(); } catch {} }
});
