// Bridge core: one process owns 127.0.0.1:PORT and serves the extension (WebSocket /ext) and
// local clients (HTTP: MCP instances, the `wait` CLI). Everything else talks to it over HTTP.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { acceptUpgrade, rejectUpgrade } from './ws.js';
import { defragment } from './mp4.js';
import { createHosts } from './hosts.js';

export const PORT = +(process.env.DEMO_BRIDGE_PORT || 47613);
export const CDP_PORT = +(process.env.DEMO_CDP_PORT || 9334);
export const EXT_ID = 'jedpjgmldnhcfdejimlabhppmffdijei'; // pinned by "key" in extension/manifest.json
// Queue, shots and the browser profile: %LOCALAPPDATA% on Windows, Application Support on macOS,
// $XDG_DATA_HOME (~/.local/share) elsewhere.
const DATA_ROOT = {
  win32: process.env.LOCALAPPDATA || os.homedir(),
  darwin: path.join(os.homedir(), 'Library', 'Application Support'),
}[process.platform] || process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
export const DATA = process.env.DEMO_DATA || path.join(DATA_ROOT, 'show-and-tell');
// The skill was called "demonstrate": take over its folder once, so the browser profile (and its
// sign-ins), saved videos and queued input survive the rename. Skipped while the old browser runs.
if (!process.env.DEMO_DATA && !fs.existsSync(DATA)) {
  try { fs.renameSync(path.join(DATA_ROOT, 'demonstrate'), DATA); } catch {}
}
const QUEUE_FILE = path.join(DATA, 'queue.json');

// Every OpenCode session starts its own bridge; one owns the port. The newest code wins: an older
// owner hands the port over when a newer bridge asks (POST /yield), so an edit takes effect without
// hunting down stale processes.
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const VERSION = Math.max(...['core.js', 'index.js', 'ws.js', 'hosts.js', 'driver.js', '../scripts/browser.mjs']
  .map(f => { try { return fs.statSync(path.join(HERE, f)).mtimeMs; } catch { return 0; } }));
const SHOTS = path.join(DATA, 'shots');
export const VIDEOS = path.join(DATA, 'videos');
const VIDEO_DAYS = 14;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
// Chrome tab group colours, one per live session.
const COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'cyan', 'red', 'yellow', 'grey'];

export const log = (...m) => console.error('[show-and-tell]', ...m);

// ------------------------------------------------------------------ owner server

export function startOwner({ standalone = false } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.mkdirSync(VIDEOS, { recursive: true });
    pruneShots();
    pruneVideos();
    const videos = new Map(); // id -> { fd, part, name, ext }
    const state = { steps: new Map(), panelOpen: false }; // steps: session -> its set_step label
    const exts = new Set();
    const waiters = new Set();
    const replies = new Map();
    const seen = [];
    let queue = loadQueue();
    let rid = 0;

    const broadcast = msg => { const s = JSON.stringify(msg); for (const c of exts) c.send(s); };
    // Routing: panel input goes to one agent session, the one that drove the browser last (`owner`), and
    // only to that session's watcher. While it has no watcher the input stays queued. An owner that has
    // neither a watcher nor sent a heartbeat for 90 s is dropped, and the next waiting session takes over.
    // Each session also has its own tab in the browser (a named, coloured tab group); input from that tab
    // goes to that session. Sessions from the same folder get distinct names: "app", "app 2", …
    const sessions = new Map(); // session id -> { label, name, color, seen }
    let owner = null, recent = [], announced = '';
    const alive = s => Date.now() - s.seen < 90000 || [...waiters].some(w => w.session === s.id);
    const touch = (id, label) => {
      if (!id) return;
      const s = sessions.get(id);
      const unique = (base, self) => {
        const live = [...sessions.values()].filter(x => x !== self && alive(x));
        let name = base;
        for (let n = 2; live.some(x => x.name === name); n++) name = `${base} ${n}`;
        return name;
      };
      if (s) {
        s.seen = Date.now();
        // First seen without a label (e.g. a status call): the real one replaces the fallback.
        if (label && s.auto) Object.assign(s, { label: String(label), name: unique(String(label), s), auto: false });
        return;
      }
      const live = [...sessions.values()].filter(alive);
      const used = new Set(live.map(x => x.color));
      const color = COLORS.find(c => !used.has(c)) || COLORS[sessions.size % COLORS.length];
      const base = String(label || 'agent');
      sessions.set(id, { id, label: base, name: unique(base, null), color, auto: !label, seen: Date.now() });
    };
    const nameOf = id => sessions.get(id)?.name || '';
    const ownerAlive = () => [...waiters].some(w => w.session === owner) || Date.now() - (sessions.get(owner)?.seen || 0) < 90000;
    function recipients() {
      if (owner && !ownerAlive()) owner = null;
      if (!owner) owner = [...waiters].find(w => w.session)?.session || null;
      return owner ? [...waiters].filter(w => w.session === owner) : [...waiters];
    }
    // `waiting`/`listener`: who gets input from a tab no session owns. `sessions`: every live session, so
    // the panel can show the one whose tab is in front.
    const listener = () => {
      const r = recipients();
      return { waiting: r.length > 0, listener: owner ? nameOf(owner) || owner : '',
        sessions: [...sessions.values()].filter(alive).map(s => ({ id: s.id, name: s.name, color: s.color,
          listening: [...waiters].some(w => w.session === s.id) })) };
    };
    // Tells the panel who receives its input and whether that session is listening right now.
    const announce = () => {
      const l = listener(), key = JSON.stringify(l);
      if (key === announced) return;
      announced = key;
      broadcast({ cmd: 'setWaiting', ...l });
    };
    const claim = (id, label) => {
      if (!id) return;
      touch(id, label);
      owner = id;
      announce();
      flush();
    };
    setInterval(announce, 15000).unref();
    // Allowed hosts: the extension gets the full picture on connect and whenever it changes (a config
    // edit, a hosts-file edit, a grant), so it decides on its own even while the bridge is away.
    const hosts = createHosts({ extDir: path.join(HERE, '..', 'extension') });
    let hostsSent = '';
    const pushHosts = (force = false) => {
      const s = JSON.stringify({ cmd: 'hosts', ...hosts.state() });
      if (!force && s === hostsSent) return;
      hostsSent = s;
      for (const c of exts) c.send(s);
    };
    setInterval(pushHosts, 5000).unref();
    const asking = new Map(); // host -> pending question, so parallel calls ask once
    const pushState = c => {
      for (const [session, label] of state.steps) c.send(JSON.stringify({ cmd: 'setStep', label, session }));
      c.send(JSON.stringify({ cmd: 'setWaiting', ...listener() }));
      c.send(JSON.stringify({ cmd: 'hosts', ...hosts.state() }));
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
    const setWaiters = fn => { fn(); announce(); };
    const persist = () => fs.writeFile(QUEUE_FILE, JSON.stringify(queue), () => {});
    // Undelivered input expires after a day (its screenshots are pruned then); delivered input stays
    // readable for an hour in case a watcher took it and the agent never reacted.
    const expire = () => {
      const day = Date.now() - 24 * 3600e3, hour = Date.now() - 3600e3;
      const before = queue.length;
      queue = queue.filter(a => (a.ts || Date.now()) > day);
      recent = recent.filter(a => a.deliveredAt > hour);
      if (queue.length !== before) persist();
    };

    // Input from a session's tab (`to`) waits for that session; input from other tabs, or for a session
    // that has gone away, takes the owner route above.
    function flush() {
      expire();
      if (!queue.length || !waiters.size) return;
      const general = recipients(), deliveries = new Map(), keep = [];
      for (const a of queue) {
        const target = a.to && sessions.get(a.to);
        const to = target && alive(target) ? [...waiters].filter(w => w.session === a.to) : general;
        if (!to.length) { keep.push(a); continue; }
        const { to: _, ...plain } = a;
        for (const w of to) deliveries.set(w, [...(deliveries.get(w) || []), plain]);
        recent.push({ ...plain, deliveredAt: Date.now() });
      }
      if (!deliveries.size) return;
      queue = keep;
      persist();
      setWaiters(() => { for (const [w, actions] of deliveries) { clearTimeout(w.timer); json(w.res, 200, { actions }); waiters.delete(w); } });
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

    const push = action => {
      queue.push({ ...action, id: crypto.randomUUID(), ts: Date.now() });
      persist();
      flush();
    };

    // Video chunks come from the extension's offscreen page, so this route is gated on that origin
    // (which web pages cannot claim) instead of the local-client header.
    async function videoRoute(req, res, url) {
      const [, , id, op] = url.pathname.split('/');
      if (req.method === 'POST' && id === 'open') {
        const body = JSON.parse(await readBody(req) || '{}');
        const vid = crypto.randomUUID();
        const part = path.join(VIDEOS, vid + '.part');
        videos.set(vid, { fd: fs.openSync(part, 'w+'), part, name: safeName(body.name), ext: body.ext === 'webm' ? 'webm' : 'mp4' });
        return json(res, 200, { id: vid });
      }
      const v = videos.get(id);
      if (!v) return json(res, 404, { error: 'unknown video' });
      if (req.method === 'PUT' && !op) {
        const at = +url.searchParams.get('offset');
        if (!Number.isSafeInteger(at) || at < 0) return json(res, 400, { error: 'bad offset' });
        const buf = await readBytes(req, 256 * 2 ** 20);
        await new Promise((ok, fail) => fs.write(v.fd, buf, 0, buf.length, at, e => (e ? fail(e) : ok())));
        return json(res, 200, { ok: true, bytes: buf.length });
      }
      if (req.method === 'POST' && op === 'abort') {
        videos.delete(id);
        fs.closeSync(v.fd);
        fs.rmSync(v.part, { force: true });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && op === 'close') {
        const meta = JSON.parse(await readBody(req) || '{}');
        videos.delete(id);
        fs.closeSync(v.fd);
        const out = finishVideo(v, meta);
        push({ type: 'videoReady', ...out, ...(meta.to && { to: String(meta.to) }) });
        return json(res, 200, out);
      }
      return json(res, 404, { error: 'not found' });
    }

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/video/')) {
        if (!HOSTS.has(req.headers.host) || req.headers.origin !== `chrome-extension://${EXT_ID}`) return json(res, 403, { error: 'forbidden' });
        return videoRoute(req, res, url).catch(e => json(res, 500, { error: e.message }));
      }
      if (!HOSTS.has(req.headers.host) || req.headers.origin || req.headers['x-show-and-tell'] !== '1') {
        return json(res, 403, { error: 'forbidden' });
      }
      const route = `${req.method} ${url.pathname}`;
      if (route === 'POST /yield') {
        let body = {};
        try { body = JSON.parse(await readBody(req)); } catch {}
        // A new owner would not know the open video, so the recording finishes here first.
        if (videos.size) return json(res, 409, { error: 'a video is being recorded', version: VERSION });
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
        steps: Object.fromEntries([...state.steps].map(([s, l]) => [nameOf(s) || s, l])), queued: queue.length, waiters: waiters.size,
        owner: owner && { session: owner, label: nameOf(owner) || owner }, listening: listener().waiting,
        sessions: listener().sessions,
        watching: [...new Set([...waiters].map(w => w.session).filter(Boolean))] });
      if (route === 'GET /queue') {
        expire();
        const actions = queue;
        queue = [];
        persist();
        if (url.searchParams.get('recent')) return json(res, 200, { actions, recent: recent.map(({ deliveredAt, ...a }) => a) });
        recent.push(...actions.map(a => ({ ...a, deliveredAt: Date.now() })));
        return json(res, 200, { actions });
      }
      if (route === 'GET /wait') {
        const sec = clamp(+url.searchParams.get('timeout') || 600, 1, 86400);
        const session = url.searchParams.get('session') || '';
        touch(session, url.searchParams.get('label'));
        const w = { res, session, timer: setTimeout(() => setWaiters(() => { waiters.delete(w); json(res, 200, { actions: [], timeout: true }); }), sec * 1000) };
        setWaiters(() => waiters.add(w));
        res.on('close', () => { clearTimeout(w.timer); setWaiters(() => waiters.delete(w)); });
        return flush();
      }
      if (route === 'POST /cancel') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        const hit = [...waiters].filter(w => !body.session || w.session === body.session);
        setWaiters(() => { for (const w of hit) { clearTimeout(w.timer); json(w.res, 200, { actions: [], cancelled: true }); waiters.delete(w); } });
        return json(res, 200, { cancelled: hit.length });
      }
      if (route === 'POST /hello' || route === 'POST /claim') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        if (route === 'POST /claim') claim(body.session, body.label); else { touch(body.session, body.label); announce(); }
        return json(res, 200, { ok: true, owner, listening: listener().waiting });
      }
      // Is this URL allowed? With ask, the side panel asks the user (up to 2 min); only the user's answer,
      // which arrives over the extension's socket, can grant a host. Callers cannot grant one here.
      if (route === 'POST /host/check') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        const r = hosts.check(String(body.url || ''));
        if (r.ok || !r.host || !body.ask) return json(res, 200, r);
        let q = asking.get(r.host);
        if (!q) {
          q = requestExt({ cmd: 'askHost', host: r.host, why: String(body.why || ''), who: nameOf(body.session) || nameOf(owner) }, 130000)
            .then(a => a.decision || 'no', e => (exts.size ? 'timeout' : 'offline:' + e.message))
            .finally(() => asking.delete(r.host));
          asking.set(r.host, q);
        }
        const decision = await q;
        if (decision === 'session' || decision === 'always') {
          try { hosts.grant(r.host, decision); } catch {}
          pushHosts();
          return json(res, 200, { ok: true, host: r.host, granted: decision });
        }
        const error = decision === 'no' ? `the user did not allow ${r.host}`
          : decision === 'timeout' ? `the user did not answer the question about ${r.host} in the side panel (is it open?)`
            : `could not ask about ${r.host}: ${decision.replace(/^offline:/, '')}`;
        return json(res, 200, { ok: false, host: r.host, decision, error });
      }
      if (route === 'POST /activity') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        touch(body.session, body.label);
        broadcast({ cmd: 'activity', text: String(body.text || '').slice(0, 200),
          who: nameOf(body.session) || String(body.label || ''), session: String(body.session || ''), ts: Date.now() });
        return json(res, 200, { ok: true });
      }
      // The session's own tab (created and grouped on first use), for its browser_* calls.
      if (route === 'POST /tab') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        if (!body.session) return json(res, 400, { error: 'session is required' });
        claim(body.session, body.label);
        const s = sessions.get(body.session);
        try { return json(res, 200, await requestExt({ cmd: 'sessionTab', session: s.id, sessionName: s.name, color: s.color }, 20000)); }
        catch (e) { return json(res, 200, { ok: false, error: e.message }); }
      }
      if (route === 'POST /cmd') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'bad json' }); }
        // Whoever drives the browser receives what the user sends from tabs no session owns. The extension
        // gets the session's name and colour for its tab group.
        if (body.session && body.cmd !== 'state') claim(body.session, body.sessionLabel);
        if (body.session) { touch(body.session, body.sessionLabel); Object.assign(body, { sessionName: nameOf(body.session), color: sessions.get(body.session).color }); }
        delete body.sessionLabel;
        if (body.cmd === 'setStep') {
          const label = String(body.label || '');
          if (label) state.steps.set(body.session || '', label); else state.steps.delete(body.session || '');
          broadcast({ cmd: 'setStep', label, session: body.session || '' });
          return json(res, 200, { ok: true, extensionConnected: exts.size > 0 });
        }
        if (!['highlight', 'clearHighlights', 'hideOverlays', 'state', 'loadTour', 'gotoStep', 'endTour', 'requestDemo', 'recordTour', 'recordStop'].includes(body.cmd)) return json(res, 400, { error: 'unknown cmd' });
        try { return json(res, 200, await requestExt(body, ['recordTour', 'highlight', 'loadTour', 'requestDemo'].includes(body.cmd) ? 150000 : 8000)); }
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
        // The user allowed a host from the panel (on their own, or answering the extension's question).
        else if (msg.type === 'hostGrant') { try { hosts.grant(msg.host, msg.mode); } catch (e) { log(e.message); } pushHosts(true); }
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

function readBytes(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on('data', d => { n += d.length; if (n > max) req.destroy(new Error('chunk too large')); else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
export const safeName = name => String(name || '').normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\w.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80)
  || 'demo-' + stamp();

// "1:02:03.456" style times for WebVTT, "1:02:03" for chapter lists (YouTube's format).
export const vttTime = ms => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
};
export const chapterTime = ms => {
  const t = Math.floor(Math.max(0, ms) / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};
export const toVtt = cues => 'WEBVTT\n\n' + cues.map((c, i) =>
  `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${String(c.text).replace(/-->/g, '→').replace(/\n{2,}/g, '\n')}\n`).join('\n');
export const toChapters = chapters => chapters.map(c => `${chapterTime(c.t)} ${c.title}`).join('\n') + '\n';

function freePath(dir, name, ext) {
  for (let i = 1; ; i++) {
    const p = path.join(dir, `${name}${i > 1 ? '-' + i : ''}.${ext}`);
    if (!fs.existsSync(p)) return p;
  }
}

// Renames the finished upload and writes its sidecars: subtitles, chapter list, manifest.
function finishVideo(v, meta) {
  const file = freePath(VIDEOS, v.name, v.ext);
  let remux = null;
  if (v.ext === 'mp4') {
    try { remux = defragment(v.part, file); fs.rmSync(v.part, { force: true }); }
    catch (e) { fs.rmSync(file, { force: true }); remux = { error: e.message }; }
  }
  if (fs.existsSync(v.part)) fs.renameSync(v.part, file);
  if (remux?.durationMs) meta = { ...meta, durationMs: remux.durationMs };
  if (remux?.error) meta = { ...meta, error: [meta.error, 'kept the fragmented MP4: ' + remux.error].filter(Boolean).join('; ') };
  const stem = file.slice(0, -(v.ext.length + 1));
  // A stopped recording ends mid-step: cut subtitles and chapters at the real end of the video.
  const end = +meta.durationMs || Infinity;
  const chapters = (Array.isArray(meta.chapters) ? meta.chapters : []).filter(c => c.t < end - 500);
  const cues = (Array.isArray(meta.cues) ? meta.cues : []).filter(c => c.text && c.start < end - 300)
    .map(c => ({ ...c, end: Math.min(c.end, end) })).filter(c => c.end > c.start);
  const out = { path: file, bytes: fs.statSync(file).size, durationMs: meta.durationMs, width: meta.width, height: meta.height,
    mimeType: meta.mimeType, ...(meta.partial && { partial: true }), ...(meta.error && { error: meta.error }) };
  if (cues.length) { out.vtt = stem + '.vtt'; fs.writeFileSync(out.vtt, toVtt(cues)); }
  if (chapters.length) { out.chaptersPath = stem + '.chapters.txt'; fs.writeFileSync(out.chaptersPath, toChapters(chapters)); }
  out.chapters = chapters.map(c => ({ time: chapterTime(c.t), ms: Math.round(c.t), title: c.title }));
  out.manifest = stem + '.json';
  fs.writeFileSync(out.manifest, JSON.stringify({ ...out, title: meta.title, steps: meta.steps, createdAt: new Date().toISOString() }, null, 2));
  if (meta.out) Object.assign(out, copyOut(out, String(meta.out)));
  return out;
}

// `out` is a file path or an existing directory; the sidecars go next to the copied video.
function copyOut(out, target) {
  try {
    const isDir = /[\\/]$/.test(target) || fs.statSync(target, { throwIfNoEntry: false })?.isDirectory();
    const dest = isDir ? path.join(target, path.basename(out.path)) : target;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(out.path, dest);
    const stem = dest.replace(/\.[^.\\/]+$/, '');
    for (const [key, ext] of [['vtt', '.vtt'], ['chaptersPath', '.chapters.txt']]) if (out[key]) fs.copyFileSync(out[key], stem + ext);
    return { copiedTo: dest };
  } catch (e) { return { copyError: e.message }; }
}

function pruneVideos() {
  const cutoff = Date.now() - VIDEO_DAYS * 24 * 3600 * 1000, stale = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(VIDEOS)) {
    const p = path.join(VIDEOS, f);
    try { const t = fs.statSync(p).mtimeMs; if (t < cutoff || (f.endsWith('.part') && t < stale)) fs.unlinkSync(p); } catch {}
  }
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
      headers: { 'X-Show-And-Tell': '1', ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }) } },
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
