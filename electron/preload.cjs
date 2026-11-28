'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monetDesktop', {
  isDesktop: true,
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: (url, expectedSize) => ipcRenderer.invoke('update:install', url, expectedSize),
  onUpdateProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  openDownloads: () => ipcRenderer.invoke('app:downloads'),
  setBackgroundMode: (enabled) => ipcRenderer.invoke('app:background-mode', enabled),
});
