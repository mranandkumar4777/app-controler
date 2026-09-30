#!/usr/bin/env node
'use strict';
/*
 * Presenter remote-control server.
 *
 * Run this with Node.js in the same folder as presenter.html and remote.html:
 *   node server.js
 *
 * It serves the Presenter app itself (so the Control window can talk to this
 * server without any browser cross-origin issues) plus a lightweight mobile
 * "remote.html" page, and relays messages between them over Server-Sent
 * Events. No npm install needed — only Node's built-in modules are used.
 *
 * A PIN protects it: only requests that include the correct PIN can send
 * commands or read state. The Control window (when opened from this server)
 * picks it up automatically; phones have to be told it once.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ROOT = __dirname;
// The desktop app sets PRESENTER_DATA_DIR (a writable per-user folder); the plain
// "node server.js" way keeps the PIN file next to server.js as before.
const DATA_DIR = process.env.PRESENTER_DATA_DIR || ROOT;
const PIN_FILE = path.join(DATA_DIR, '.remote-pin');
const PUBLIC_FILES = new Set(['/manifest.json', '/icon-192.png', '/icon-512.png']);

// --- PIN: a fixed one from the environment, else a persisted one, else a new random one ---
function loadOrCreatePin() {
  if (process.env.PIN && String(process.env.PIN).trim()) {
    const pin = String(process.env.PIN).trim();
    try { fs.writeFileSync(PIN_FILE, pin); } catch (e) {}
    return pin;
  }
  try {
    const existing = fs.readFileSync(PIN_FILE, 'utf8').trim();
    if (existing) return existing;
  } catch (e) { /* no file yet */ }
  const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  try { fs.writeFileSync(PIN_FILE, pin); } catch (e) {}
  return pin;
}
const PIN = loadOrCreatePin();

// --- phone pairing -----------------------------------------------------------
// A phone finds this computer on the Wi-Fi (GET /api/hello) and asks to pair
// (POST /api/pair). The desktop app shows an "Allow this phone?" prompt; once
// allowed, that phone is remembered and gets the PIN automatically from then on.
const PAIRED_FILE = path.join(DATA_DIR, 'paired-devices.json');
let pairedIds = new Set();
try { pairedIds = new Set(JSON.parse(fs.readFileSync(PAIRED_FILE, 'utf8'))); } catch (e) { /* none yet */ }
function savePaired() { try { fs.writeFileSync(PAIRED_FILE, JSON.stringify(Array.from(pairedIds))); } catch (e) {} }
let pairHandler = null;   // async (deviceName, abortSignal) => boolean, set by the desktop app
let pairPending = false;
module.exports = { setPairHandler: (fn) => { pairHandler = fn; } };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// --- network helpers ----------------------------------------------------------
function lanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}
// True only for requests coming from this same computer (loopback, or this
// machine's own network address). A phone on the Wi-Fi never matches.
function isLoopback(req) {
  let a = (req.socket && req.socket.remoteAddress) || '';
  if (a.startsWith('::ffff:')) a = a.slice(7);
  return a === '127.0.0.1' || a === '::1' || lanAddresses().includes(a);
}

// --- SSE client bookkeeping -------------------------------------------------
const clients = new Set();
let lastState = null; // most recent {from:'control', type:'state', ...} message, replayed to new joiners

function sendSSE(res, obj) {
  try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* client gone */ }
}

function broadcast(obj) {
  for (const res of clients) sendSSE(res, obj);
}

function badPin(res) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ ok: false, error: 'bad-pin' }));
}

// --- static file helper -----------------------------------------------------
function serveFile(res, filePath, inject) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Not found: ' + path.basename(filePath));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = data;
    if (inject && ext === '.html') {
      const html = data.toString('utf8');
      const info = { port: PORT, addresses: lanAddresses() };
      const snippet = '<script>window.__SERVER_PIN__=' + JSON.stringify(PIN) + ';window.__SERVER_INFO__=' + JSON.stringify(info) + ';</script>';
      body = html.includes('<head>') ? html.replace('<head>', '<head>' + snippet) : snippet + html;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  });
}

function readJsonBody(req, cb) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      cb(null, raw ? JSON.parse(raw) : {});
    } catch (e) {
      cb(e);
    }
  });
  req.on('error', cb);
}

// --- server ------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  // Treat "/remote/" the same as "/remote", etc. — a trailing slash shouldn't matter.
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (pathname === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ app: 'presenter', name: os.hostname(), port: PORT, pair: !!pairHandler }));
    return;
  }

  if (pathname === '/api/pair' && req.method === 'POST') {
    const reply = (obj) => {
      if (res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    readJsonBody(req, (err, msg) => {
      msg = (err || !msg || typeof msg !== 'object') ? {} : msg;
      const device = String(msg.device || 'Phone').replace(/[\r\n]/g, ' ').slice(0, 60);
      const id = String(msg.id || '').slice(0, 64);
      if (id && pairedIds.has(id)) { reply({ ok: true, pin: PIN }); return; }
      if (!pairHandler) { reply({ ok: false, needPin: true }); return; }
      if (pairPending) { reply({ ok: false, busy: true }); return; }
      pairPending = true;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 60000);
      res.on('close', () => { if (!res.writableEnded) ac.abort(); });
      Promise.resolve()
        .then(() => pairHandler(device, ac.signal))
        .then((allowed) => {
          if (allowed && !ac.signal.aborted) {
            if (id) { pairedIds.add(id); savePaired(); }
            reply({ ok: true, pin: PIN });
          } else {
            reply({ ok: false, denied: true });
          }
        })
        .catch(() => reply({ ok: false, denied: true }))
        .then(() => { clearTimeout(timer); pairPending = false; });
    });
    return;
  }

  if (pathname === '/api/verify-pin') {
    const ok = u.searchParams.get('pin') === PIN;
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: ok }));
    return;
  }

  if (pathname === '/events') {
    if (u.searchParams.get('pin') !== PIN) { badPin(res); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 2000\n\n');
    clients.add(res);
    if (lastState) sendSSE(res, lastState);
    const heartbeat = setInterval(() => { try { res.write(':hb\n\n'); } catch (e) {} }, 20000);
    req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
    return;
  }

  if (pathname === '/api/send' && req.method === 'POST') {
    readJsonBody(req, (err, msg) => {
      if (err || !msg || typeof msg !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: 'bad json' }));
        return;
      }
      if (msg.pin !== PIN) { badPin(res); return; }
      if (msg.type === 'state' && msg.from === 'control') lastState = msg;
      broadcast(msg);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // Static files. Only presenter.html, and only when it's requested from this
  // same computer, gets the PIN and phone links injected. A phone (or anyone
  // else on the network) that opens the main address does NOT get the PIN.
  let filePath, injectPin = false;
  if (pathname === '/' || pathname === '/presenter.html' || pathname === '/control') {
    filePath = path.join(ROOT, 'presenter.html');
    injectPin = isLoopback(req);
  } else if (pathname === '/remote' || pathname === '/remote.html') {
    filePath = path.join(ROOT, 'remote.html');
  } else if (PUBLIC_FILES.has(pathname)) {
    filePath = path.join(ROOT, pathname);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Not found');
    return;
  }
  serveFile(res, filePath, injectPin);
});

const HOST = process.env.HOST && String(process.env.HOST).trim() ? String(process.env.HOST).trim() : '0.0.0.0';

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && process.env.PRESENTER_EMBEDDED) {
    console.log('Port ' + PORT + ' is already in use - assuming a Presenter server is already running.');
    return;
  }
  console.error('Server error: ' + (err && err.message));
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const addrs = lanAddresses();
  console.log('');
  console.log('Presenter remote server is running, listening on ' + HOST + ':' + PORT + ' (every network interface on this computer).');
  console.log('');
  console.log('  PIN (needed once per phone): ' + PIN);
  console.log('');
  console.log('  On this computer, open the Control window at (a plain double-click on presenter.html will NOT work with the phone):');
  console.log('    http://localhost:' + PORT + '/');
  console.log('');
  console.log('  On your phone (same Wi-Fi network), open:');
  if (addrs.length === 0) {
    console.log('    Could not detect a network address automatically.');
    console.log('    Run "ipconfig" (Windows) or "ifconfig" / "ip addr" (Mac/Linux) to find');
    console.log('    this computer\'s local IP, then open http://<that-ip>:' + PORT + '/remote on your phone.');
  } else {
    addrs.forEach((a) => console.log('    http://' + a + ':' + PORT + '/remote'));
    console.log('');
    console.log('  Easier: in the Presenter window click "Phone" — it shows a QR code to scan.');
  }
  console.log('');
  console.log('  This PIN is saved in .remote-pin next to this script, so it stays the');
  console.log('  same across restarts. Delete that file (or set PIN=yourpin when starting');
  console.log('  the server) to change it.');
  console.log('');
  console.log('  Reachable from any device on your network by default (protected by the PIN');
  console.log('  above). To restrict it to just this computer instead, start it with');
  console.log('  HOST=127.0.0.1 node server.js.');
  console.log('');
  console.log('Keep this window open for as long as you want the phone to stay connected.');
  console.log('Press Ctrl+C to stop.');
  console.log('');
});
