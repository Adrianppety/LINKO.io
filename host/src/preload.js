// Preload scripts for Electron - exposing safe APIs to renderer
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  startScreenShare: (roomId, userId) => ipcRenderer.invoke('start-screen-share', roomId, userId),
  stopScreenShare: () => ipcRenderer.invoke('stop-screen-share'),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  injectInput: (inputData) => ipcRenderer.send('inject-input', inputData),
  onInputError: (callback) => ipcRenderer.on('input-error', callback)
});