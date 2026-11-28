'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, session, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { downloadFile } = require('./download.cjs');

const APP_ID = 'com.monet.chat';
let serverProcess = null;
let mainWindow = null;
let tray = null;
let backgroundMode = false;
let quitting = false;
let serverPort = 0;

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function ensureTray() {
  if (tray) return;
  try {
    const iconPath = path.join(rootDir(), 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon-192.png');
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = nativeImage.createEmpty();
    tray = new Tray(image);
    tray.setToolTip('Monet Chat 正在后台运行 · 消息照常接收');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Monet Chat', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('double-click', showMainWindow);
  } catch (err) {
    console.warn('[tray]', err);
  }
}

function destroyTray() {
  if (tray) { try { tray.destroy(); } catch {} tray = null; }
}

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

ipcMain.handle('update:check', async () => {
  try {
    return await localJson('/api/update?platform=win');
  } catch (e) {
    return { available: false, current: app.getVersion(), error: String(e.message || e) };
  }
});

ipcMain.handle('update:install', async (event, urls, expectedSize) => {
  try {
    const candidates = (Array.isArray(urls) ? urls : [urls]).map((u) => String(u || '')).filter(Boolean);
    const allowed = (raw) => {
      try {
        const parsed = new URL(raw);
        const isLoopback = /^(127\.0\.0\.1|localhost)$/i.test(parsed.hostname)
          && parsed.protocol === 'http:'
          && parsed.pathname.startsWith('/release/');
        const isAllowedHost = /(^|\.)github\.com$|(^|\.)githubusercontent\.com$|(^|\.)gh-proxy\.com$/i.test(parsed.hostname);
        return (isLoopback || isAllowedHost) && /\.(exe|zip)$/i.test(parsed.pathname) ? parsed : null;
      } catch {
        return null;
      }
    };
    const parsedList = candidates.map(allowed).filter(Boolean);
    if (!parsedList.length) {
      return { ok: false, error: '更新地址不在允许的下载域名内' };
    }

    const size = Number(expectedSize) || 0;
    const isZip = /\.zip$/i.test(parsedList[0].pathname);
    const file = path.join(app.getPath('temp'), isZip ? 'MonetChat-Update.zip' : 'MonetChat-Update-installer.exe');
    const progress = (data) => {
      try { event.sender.send('update:progress', data); } catch {}
    };
    let lastError = null;
    for (const parsed of parsedList) {
      try {
        await downloadFile(parsed.toString(), file, {
          expectedSize: size,
          onProgress: progress,
        });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) throw lastError;

    if (size > 0) {
      const actual = fs.statSync(file).size;
      if (actual !== size) {
        try { fs.unlinkSync(file); } catch {}
        return { ok: false, error: `安装包大小校验失败（${actual}/${size}）` };
      }
    }

    const installDir = path.dirname(app.getPath('exe'));
    const stamp = Date.now();
    const script = path.join(app.getPath('temp'), `monet-update-${stamp}.cmd`);
    let command;
    if (isZip) {
      const work = path.join(app.getPath('temp'), `monet-update-${stamp}`);
      fs.mkdirSync(work, { recursive: true });
      command = [
        '@echo off',
        'timeout /t 4 /nobreak >nul',
        `set "ZIP=${file}"`,
        `set "WORK=${work}"`,
        `set "DEST=${installDir}"`,
        'taskkill /F /IM "Monet Chat.exe" >nul 2>&1',
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:WORK -Force"',
        'robocopy "%WORK%" "%DEST%" /E /IS /IT /R:3 /W:1 /NFL /NDL /NJH /NJS >> "%TEMP%\\monet-update.log" 2>&1',
        'start "" "%DEST%\\Monet Chat.exe"',
        'rmdir /s /q "%WORK%"',
        'del "%ZIP%"',
        'del "%~f0"',
      ].join('\r\n');
    } else {
      command = [
        '@echo off',
        'timeout /t 3 /nobreak >nul',
        `start "" "${file}" /S /D=${installDir}`,
        'del "%~f0" >nul 2>&1',
      ].join('\r\n');
    }
    fs.writeFileSync(script, command, 'utf8');
    const child = spawn('cmd.exe', ['/c', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    setTimeout(() => { quitting = true; app.quit(); }, 700);
    return { ok: true, file, installDir, zip: isZip };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('app:downloads', async () => {
  const target = path.join(app.getPath('userData'), 'downloads');
  await fs.promises.mkdir(target, { recursive: true }).catch(() => {});
  return { path: target };
});

ipcMain.handle('app:background-mode', async (_event, enabled) => {
  backgroundMode = !!enabled;
  if (backgroundMode) ensureTray(); else destroyTray();
  return { ok: true, backgroundMode };
});

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#F5EFE6',
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

  mainWindow.on('close', (event) => {
    if (backgroundMode && !quitting) {
      event.preventDefault();
      mainWindow.hide();
      ensureTray();
    }
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
    destroyTray();
    if (serverProcess && !serverProcess.killed) {
      try { serverProcess.kill(); } catch {}
    }
  });

  app.on('window-all-closed', () => {
    if (!backgroundMode) app.quit();
  });
}
