'use strict';
// Presenter desktop app (Electron). Starts the built-in server (so the phone
// remote keeps working) and shows the Control window in a normal app window.
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ORIGINS = ['http://localhost:' + PORT, 'http://127.0.0.1:' + PORT];
const isOurs = (url) => ORIGINS.some((o) => url === o || url.startsWith(o + '/'));

let mainWindow = null;

function waitForServer(tries, cb) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, (res) => {
    res.resume();
    cb(true);
  });
  req.on('error', () => retry());
  req.on('timeout', () => { req.destroy(); retry(); });
  function retry() {
    if (tries <= 0) return cb(false);
    setTimeout(() => waitForServer(tries - 1, cb), 250);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon-512.png'),
    title: 'Presenter',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false, // trusted local page only; lets preload replace window.prompt
      sandbox: true,
      backgroundThrottling: false
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(ORIGINS[0] + '/');
}

// Preview / Live windows opened by the page (window.open) become real app windows.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          backgroundColor: '#000000',
          icon: path.join(__dirname, 'icon-512.png'),
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            sandbox: true,
            backgroundThrottling: false
          }
        }
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (ev, url) => {
    if (!isOurs(url)) {
      ev.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
});

// window.prompt() is not supported by Electron, so the page's calls are routed here.
ipcMain.on('presenter:prompt', (e, message, def) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const id = crypto.randomBytes(6).toString('hex');
  const channel = 'presenter:prompt-result:' + id;
  let result = null;
  const win = new BrowserWindow({
    parent: parent || undefined,
    modal: !!parent,
    width: 440,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'Presenter',
    webPreferences: {
      preload: path.join(__dirname, 'prompt-preload.js'),
      contextIsolation: true
    }
  });
  win.removeMenu();
  ipcMain.once(channel, (_ev, val) => { result = val; win.close(); });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    ipcMain.removeAllListeners(channel);
    e.returnValue = result;
  });
  win.loadFile(path.join(__dirname, 'prompt.html'), { query: { message: String(message), def: String(def), id } });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Writable per-user folder for the remote PIN (the install folder is read-only).
    process.env.PRESENTER_DATA_DIR = app.getPath('userData');
    process.env.PRESENTER_EMBEDDED = '1';
    const server = require('./server.js');
    // A phone found this computer and wants to pair: ask once, then it's remembered.
    server.setPairHandler(async (device, signal) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      const opts = {
        type: 'question',
        buttons: ['Allow', 'Deny'],
        defaultId: 0,
        cancelId: 1,
        title: 'Presenter',
        message: 'Allow "' + device + '" to control Presenter?',
        detail: 'Choose Allow only if this is your own phone. You only have to do this once per phone.',
        signal
      };
      const r = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts);
      return r.response === 0;
    });
    waitForServer(40, (ok) => {
      if (!ok) console.error('Presenter server did not start on port ' + PORT);
      createMainWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
