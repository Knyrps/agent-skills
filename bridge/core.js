// Bridge core: one process owns 127.0.0.1:PORT and serves the extension (WebSocket /ext) and
// local clients (HTTP: MCP instances, the `wait` CLI). Everything else talks to it over HTTP.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { acceptUpgrade, rejectUpgrade } from './ws.js';

export const PORT = +(process.env.DEMO_BRIDGE_PORT || 47613);
export const CDP_PORT = +(process.env.DEMO_CDP_PORT || 9334);
export const EXT_ID = 'jedpjgmldnhcfdejimlabhppmffdijei'; // pinned by "key" in extension/manifest.json
export const DATA = process.env.DEMO_DATA || path.join(process.env.LOCALAPPDATA || os.homedir(), 'demonstrate');
const QUEUE_FILE = path.join(DATA, 'queue.json');

// Every OpenCode session starts its own bridge; one owns the port. The newest code wins: an older
// owner hands the port over when a newer bridge asks (POST /yield), so an edit takes effect without
// hunting down stale processes.
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const VERSION = Math.max(...['core.js', 'index.js', 'ws.js', '../scripts/browser.mjs']
  .map(f => { try { return fs.statSync(path.join(HERE, f)).mtimeMs; } catch { return 0; } }));
const SHOTS = path.join(DATA, 'shots');
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

export const log = (...m) => console.error('[demonstrate]', ...m);

// ------------------------------------------------------------------ owner server

export function startOwner({ standalone = false } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    pruneShots();
    const state = { step: '', panelOpen: false };
    const exts = new Set();
    const waiters = new Set();
    const replies = new Map();
    const seen = [];
    let queue = loadQueue();
    let rid = 0;

    const broadcast = msg => { const s = JSON.stringify(msg); for (const c of exts) c.send(s); };
    const pushState = c => {
      c.send(JSON.stringify({ cmd: 'setStep', label: state.step }));
      c.send(JSON.stringify({ cmd: 'setWaiting', waiting: waiters.size > 0 }));
    };
    // Commands that need an answer (highlight etc.) go to the most recently connected extension.
    const requestExt = (msg, ms = 8000) => new Promise((resolve, reject) => {
      const conn = [...exts].pop();
      if (!conn) return reject(new Error('browser extension not connected - run `node scripts/browser.mjs start`'));
      const id = ++rid;
      const t = setTimeout(() => { replies.delete(id); reject(new Error('extension did not answer')); }, ms);
      replies.set(id, v => { clearTimeout(t); replies.delete(id); resolve(v); });
      conn.send(JSON.stringify({ ...msg, rid: id }));
    });
    const setWaiters = fn => { const before = waiters.size > 0; fn(); const now = waiters.size > 0;
      if (before !== now) broadcast({ cmd: 'setWaiting', waiting: now }); };
    const persist = () => fs.writeFile(QUEUE_FILE, JSON.stringify(queue), () => {});

    function flush() {
      if (!queue.length || !waiters.size) return;
      const body = { actions: queue };
      queue = [];
      persist();
      setWaiters(() => { for (const w of waiters) { clearTimeout(w.timer); json(w.res, 200, body); } waiters.clear(); });
    }

    async function onAction(conn, msg) {
      if (seen.includes(msg.id)) { conn.send(JSON.stringify({ type: 'ack', id: msg.id })); return; }
      const action = { ...msg.action, id: msg.id };
      // Annotation screenshots arrive as data URLs; the queue and the agent get file paths instead.
      for (const [key, file] of [['image', 'imagePath'], ['labelledImage', 'labelledImagePath']]) {
        const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(action[key] || '');
        if (!m) continue;
        const p = path.join(SHOTS, `annotation-${Date.now()}-${key}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
        fs.writeFileSync(p, Buffer.from(m[2], 'base64'));
        action[file] = p;
        delete action[key];
      }
      if (seen.includes(msg.id)) return; // resent while we were capturing
      seen.push(msg.id); if (seen.length > 500) seen.shift();
      queue.push(action);
      persist();
      conn.send(JSON.stringify({ type: 'ack', id: msg.id }));
      flush();
    }

    const server = http.createServer(async (req, res) => {
      if (!HOSTS.has(req.headers.host) || req.headers.origin || req.headers['x-demonstrate'] !== '1') {
        return json(res, 403, { error: 'forbidden' });
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = `${req.method} ${url.pathname}`;
      if (route === 'POST /yield') {
        let body = {};
        try { body = JSON.parse(await readBody(req)); } catch {}
        if (!(+body.version > VERSION)) return json(res, 409, { error: 'not newer', version: VERSION });
        json(res, 200, { ok: true });
        log('handing the port to a newer bridge');
        setWaiters(() => { for (const w of waiters) { clearTimeout(w.timer); json(w.res, 200, { actions: [], cancelled: true }); } waiters.clear(); });
        for (const c of exts) c.close();
        server.close();
        server.closeAllConnections?.();
        return;
      }
      if (route === 'GET /status') return json(res, 200, { ok: true, pid: process.pid, standalone, version: VERSION,
        extensionConnected: exts.size > 0, panelOpen: exts.size > 0 && state.panelOpen,
        step: state.step, queued: queue.length, waiters: waiters.size });
      if (route === 'GET /queue') { const actions = queue; queue = []; persist(); return json(res, 200, { actions }); }
      if (route === 'GET /wait') {
        const sec = clamp(+url.searchParams.get('timeout') || 600, 1, 86400);
        const w = { res, timer: setTimeout(() => setWaiters(() => { waiters.delete(w); json(res, 200, { actions: [], timeout: true }); }), sec * 1000) };
        setWaiters(() => waiters.add(w));
        res.on('close', () => { clearTimeout(w.timer); setWaiters(() => waiters.delete(w)); });
        return flush();
      }
      if (route === 'POST /cancel') {
        const n = waiters.size;
        setWaiters(() => { for (const w of waiters) { clearTimeout(w.timer); json(w.res, 200, { actions: [], cancelled: true }); } waiters.clear(); });
        return json(res, 200, { cancelled: n });
      }
      if (route === 'POST /cmd') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
        if (body.cmd === 'setStep') {
          state.step = String(body.label || '');
          broadcast({ cmd: 'setStep', label: state.step });
          return json(res, 200, { ok: true, extensionConnected: exts.size > 0 });
        }
        if (!['highlight', 'clearHighlights', 'hideOverlays', 'state', 'loadTour', 'gotoStep', 'endTour', 'requestDemo'].includes(body.cmd)) return json(res, 400, { error: 'unknown cmd' });
        try { return json(res, 200, await requestExt(body)); }
        catch (e) { return json(res, 200, { ok: false, error: e.message }); }
      }
      if (route === 'POST /shutdown' && standalone) { json(res, 200, { ok: true }); setTimeout(() => process.exit(0), 50); return; }
      json(res, 404, { error: 'not found' });
    });
    server.requestTimeout = 0;
    server.timeout = 0;

    server.on('upgrade', (req, socket, head) => {
      if (new URL(req.url, 'http://x').pathname !== '/ext' || req.headers.origin !== `chrome-extension://${EXT_ID}`) {
        log('rejected WebSocket from origin', req.headers.origin);
        return rejectUpgrade(socket);
      }
      const conn = acceptUpgrade(req, socket, head);
      if (!conn) return;
      exts.add(conn);
      log('extension connected');
      pushState(conn);
      conn.on('message', m => {
        let msg; try { msg = JSON.parse(m); } catch { return; }
        if (msg.type === 'action' && msg.id && msg.action) onAction(conn, msg).catch(e => log('action failed', e));
        else if (msg.type === 'result' && msg.rid) { const { type, rid: r, ...rest } = msg; replies.get(r)?.(rest); }
        else if (msg.type === 'panel') state.panelOpen = !!msg.open;
        else if (msg.type === 'ping') conn.send('{"type":"pong"}');
      });
      conn.on('close', () => { exts.delete(conn); log('extension disconnected'); });
    });

    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
  });
}

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

function json(res, status, body) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

function loadQueue() {
  try { const q = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); return Array.isArray(q) ? q : []; } catch { return []; }
}

function pruneShots() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(SHOTS)) {
    const p = path.join(SHOTS, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
}

export function getJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, res => {
      let s = ''; res.on('data', d => { s += d; });
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ client side

export function call(method, pathname, body, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: pathname, signal,
      headers: { 'X-Demonstrate': '1', ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }) } },
    res => {
      let s = ''; res.on('data', d => { s += d; });
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(s); } catch { return reject(new Error(`bridge answered ${res.statusCode}: ${s.slice(0, 200)}`)); }
        res.statusCode < 300 ? resolve(parsed) : reject(new Error(parsed.error || 'HTTP ' + res.statusCode));
      });
    });
    req.on('error', e => reject(e.code === 'ECONNREFUSED' ? new Error(`bridge not running on 127.0.0.1:${PORT}`) : e));
    if (payload) req.write(payload);
    req.end();
  });
}

// Become the owner if the port is free; otherwise keep retrying so a surviving instance takes over
// when the current owner exits. Resolves once the first attempt is done.
export async function ensureOwnerLoop() {
  let server = null;
  const attempt = async (retried = false) => {
    if (server) return;
    try { server = await startOwner(); log('bridge listening on 127.0.0.1:' + PORT); server.on('close', () => { server = null; }); }
    catch (e) {
      if (e.code !== 'EADDRINUSE') return log('bridge listen failed:', e.message);
      const owner = await call('GET', '/status').catch(() => null);
      if (!owner) return log(`port ${PORT} is used by something else`);
      if (retried || !(VERSION > (owner.version || 0))) return;
      if (!(await call('POST', '/yield', { version: VERSION }).then(() => true, () => false))) return;
      await new Promise(r => setTimeout(r, 300));
      return attempt(true);
    }
  };
  await attempt();
  setInterval(() => attempt(), 5000).unref();
}
