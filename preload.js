'use strict';
const { ipcRenderer } = require('electron');
// Electron has no window.prompt(); ask the main process to show a small dialog instead.
window.prompt = function (message, def) {
  return ipcRenderer.sendSync('presenter:prompt', message == null ? '' : String(message), def == null ? '' : String(def));
};
