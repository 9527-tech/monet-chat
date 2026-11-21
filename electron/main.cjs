'use strict';

const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_ID = 'com.monet.chat';
let serverProcess = null;
let mainWindow = null;
let quitting = false;

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
    if (await health(port)) return port;
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
