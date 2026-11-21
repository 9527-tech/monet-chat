'use strict';

const { app, BrowserWindow, Menu, dialog, session, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const APP_ID = 'com.monet.chat';
let serverProcess = null;
let mainWindow = null;
let quitting = false;
let serverPort = 0;

function rootDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
  });
}

async function choosePort() {
  if (await portAvailable(4173)) return 4173;
  return freePort();
}

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 700 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startServer() {
  const port = await choosePort();
  const root = rootDir();
  const entry = path.join(root, 'server.mjs');
  serverProcess = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      HOST: '0.0.0.0',
      AUTO_TUNNEL: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stdout.on('data', (chunk) => console.log('[server]', String(chunk).trimEnd()));
  serverProcess.stderr.on('data', (chunk) => console.error('[server]', String(chunk).trimEnd()));
  serverProcess.on('exit', (code) => {
    if (!quitting) console.error(`[server] exited with code ${code}`);
  });

  for (let i = 0; i < 80; i += 1) {
    if (await health(port)) { serverPort = port; return port; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('内置信令服务启动超时');
}

function allowLocalPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set([
    'media', 'audioCapture', 'videoCapture', 'notifications', 'clipboard-read',
    'clipboard-sanitized-write', 'fullscreen', 'pointerLock',
  ]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

function localJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: serverPort, path: pathname, timeout: 20000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('更新检查超时')); });
    req.on('error', reject);
  });
}

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('下载重定向过多')); return; }
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error('下载地址无效')); return; }
    if (parsed.protocol !== 'https:') { reject(new Error('更新地址必须是 HTTPS')); return; }
    const req = https.get(parsed, { timeout: 30000, headers: { 'user-agent': 'monet-chat-updater/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(new URL(res.headers.location, url).toString(), dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', reject);
  });
}

ipcMain.handle('update:check', async () => {
  try {
    return await localJson('/api/update?platform=win');
  } catch (e) {
    return { available: false, current: app.getVersion(), error: String(e.message || e) };
  }
});

ipcMain.handle('update:install', async (_event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (!/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i.test(parsed.hostname)) {
      return { ok: false, error: '更新地址不是 GitHub 域名，已拒绝' };
    }
    const file = path.join(app.getPath('temp'), `MonetChat-Update-${Date.now()}.exe`);
    await downloadFile(parsed.toString(), file);
    const child = spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    setTimeout(() => { quitting = true; app.quit(); }, 1200);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('app:downloads', async () => {
  const target = path.join(app.getPath('userData'), 'downloads');
  await fs.promises.mkdir(target, { recursive: true }).catch(() => {});
  return { path: target };
});

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#FEF7FF',
    title: 'Monet Chat',
    autoHideMenuBar: true,
    icon: path.join(rootDir(), 'assets', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      if (target.origin !== `http://127.0.0.1:${port}`) {
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId(APP_ID);
    allowLocalPermissions();
    try {
      // The desktop shell runs from local files; stale PWA caches must never
      // shadow a freshly packaged app. Keep IndexedDB/localStorage intact.
      await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
      const port = await startServer();
      await createWindow(port);
    } catch (err) {
      dialog.showErrorBox('Monet Chat 无法启动', String(err?.message || err));
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    if (serverProcess && !serverProcess.killed) {
      try { serverProcess.kill(); } catch {}
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
