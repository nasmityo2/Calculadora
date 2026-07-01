'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Asistente de instalación (SQLite embebido: sin paso de base de datos) */
contextBridge.exposeInMainWorld('nexusSetup', {
  getInitialStep: () => ipcRenderer.invoke('setup:get-initial-step'),
  prepareLicenseStep: () => ipcRenderer.invoke('setup:prepare-license-step'),
  getVersion: () => ipcRenderer.invoke('app:get-version')
});

/** Paso licencia (misma API que activation.html) */
contextBridge.exposeInMainWorld('nexusCore', {
  getHardwareId: () => ipcRenderer.invoke('app:get-hardware-id'),
  getHardwareIdBundle: () => ipcRenderer.invoke('app:get-hardware-id-bundle'),
  getVersion: () => ipcRenderer.invoke('app:get-version')
});

contextBridge.exposeInMainWorld('nexusLicense', {
  getServerUrl: () => ipcRenderer.invoke('license:get-server-url'),
  confirmed: () => ipcRenderer.send('license:activated'),
  getHwid: () => ipcRenderer.invoke('license:get-hwid'),
  getStatus: () => ipcRenderer.invoke('license:get-status'),
  activate: (licenseKey) => ipcRenderer.invoke('license:activate', { licenseKey }),
  deactivate: () => ipcRenderer.invoke('license:deactivate')
});
