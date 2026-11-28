'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monetDesktop', {
  isDesktop: true,
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: (url) => ipcRenderer.invoke('update:install', url),
  openDownloads: () => ipcRenderer.invoke('app:downloads'),
  setBackgroundMode: (enabled) => ipcRenderer.invoke('app:background-mode', enabled),
});
