'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const q = new URLSearchParams(location.search);
contextBridge.exposeInMainWorld('promptApi', {
  message: q.get('message') || '',
  def: q.get('def') || '',
  submit: (value) => ipcRenderer.send('presenter:prompt-result:' + q.get('id'), value)
});
