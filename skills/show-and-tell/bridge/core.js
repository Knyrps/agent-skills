// Bridge core: one process owns 127.0.0.1:PORT and serves the extension (WebSocket /ext) and
// local clients (HTTP: MCP instances, the `wait` CLI). Everything else talks to it over HTTP.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade, rejectUpgrade } from './ws.js';
import { defragment } from './mp4.js';
import { createHosts } from './hosts.js';
import { labHandler, LAB_PORT, LAB_URL } from '../scripts/lab.mjs';

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
// fileURLToPath decodes the URL: a path with a space or an 8.3 short name (PROGRA~1) arrives percent-encoded.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = Math.max(...['core.js', 'index.js', 'ws.js', 'hosts.js', 'driver.js', '../scripts/browser.mjs', '../scripts/lab.mjs']
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
    const alive = s => !s.endedAt && (Date.now() - s.seen < 90000 || [...waiters].some(w => w.session === s.id));
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

    // The user's own input in a session's tab, so the agent knows the page changed under it. Playwright's
    // input is trusted too, so what happens while one of the session's calls runs (plus a grace period for
    // the page reacting to it) is the agent's own and dropped.
    const userLog = new Map(); // session -> [event]
    const calls = new Map(); // session -> { running, windows: [[start, end]] }
    const GRACE = { navigate: 3000, urlChange: 3000, newTab: 3000 };
    const TAB_NEWS = new Set(['newTab', 'tabClosed', 'workingTabClosed']);
    const callState = s => { let c = calls.get(s); if (!c) calls.set(s, c = { running: 0, since: 0, windows: [] }); return c; };
    const agentsOwn = (s, ev) => {
      const c = calls.get(s);
      if (!c) return false;
      if (c.running && ev.ts >= c.since - 200) return true;
      return c.windows.some(([a, b]) => {
        if (ev.ts < a - 200 || ev.ts > b + (GRACE[ev.kind] || 250)) return false;
        // A page load right after an agent call is the agent's, unless the user acted after that call.
        if (ev.ts > b && GRACE[ev.kind] && (userLog.get(s) || []).some(u => u.ts > b && u.ts <= ev.ts)) return false;
        return true;
      });
    };
    function onUserEvent(msg) {
      const s = msg.session || owner || '';
      const ev = msg.event || {};
      if (!s || !ev.kind) return;
      // A new or closed tab is always news; an agent's call that opened one is credited to it.
      if (TAB_NEWS.has(ev.kind)) ev.by = ev.by === 'user' ? 'user' : agentsOwn(s, ev) ? 'agent' : 'other';
      else if (agentsOwn(s, ev)) return;
      const list = userLog.get(s) || [];
      const last = list[list.length - 1];
      // A field edited twice in a row keeps only its final value.
      if (last && ev.kind === 'change' && last.kind === 'change' && last.target?.selector === ev.target?.selector) list.pop();
      list.push({ ...ev, ts: ev.ts || Date.now() });
      userLog.set(s, list.slice(-40));
    }
    // Pause points (the `pause` tool): what the extension reports per tab. A session learns that its page
    // paused from its running browser_* call (the driver waits on /pause/wait), else from its watcher.
    const pauses = new Map(); // tabId -> { session, tabId, points, paused, held, told }
    const pauseWaits = new Set(); // { session, res }
    const pausedOf = s => [...pauses.values()].find(p => p.session === s && p.paused);
    function tellPaused(p) {
      if (p.told || !p.paused || !p.session) return;
      const waits = [...pauseWaits].filter(w => w.session === p.session);
      if (waits.length) {
        p.told = true;
        for (const w of waits) { pauseWaits.delete(w); json(w.res, 200, { paused: p.paused, tab: p.tabId }); }
      } else if (!callState(p.session).running) {
        p.told = true;
        push({ type: 'paused', own: true, to: p.session, tab: p.tabId, ...p.paused,
          hint: 'Look at it with inspect_paused and continue with resume; browser_* tools cannot act on a paused page.' });
      } // else the session's own call is about to end; /busy tells it then
    }
    function onPauseState(m) {
      if (m.tabId == null) return;
      const session = String(m.session || ''), prev = pauses.get(m.tabId);
      const next = { session, tabId: m.tabId, points: Array.isArray(m.points) ? m.points : [], paused: m.paused || null, held: m.held || null, told: false };
      if (next.paused || next.points.length || next.held) pauses.set(m.tabId, next); else pauses.delete(m.tabId);
      if (!session) return;
      if (next.paused) {
        // The pause and resume tools return what they caused themselves.
        if (prev?.paused?.since === next.paused.since) next.told = prev.told;
        else if (['agent', 'step', 'sync'].includes(m.by)) next.told = true;
        else tellPaused(next);
      }
      if (!prev?.held && next.held && m.by !== 'sync') {
        push({ type: 'requestHeld', own: true, to: session, tab: m.tabId, ...next.held,
          hint: 'The page runs on and shows its waiting state, so browser_* tools work. Let the requests go with resume.' });
      }
      const ran = !!prev?.paused && !next.paused, released = !!prev?.held && !next.held;
      // News nobody read yet is no longer true once the page runs again.
      const stale = a => a.own && a.tab === m.tabId && ((a.type === 'paused' && !next.paused) || (a.type === 'requestHeld' && !next.held));
      if (queue.some(stale)) { queue = queue.filter(a => !stale(a)); persist(); }
      // Ended without the agent: by the user in the panel, or by a new page it did not open itself.
      const told = m.by === 'user' || (m.by === 'navigation' && !callState(session).running);
      if (told && (ran || released)) {
        push({ type: 'resumed', own: true, to: session, tab: m.tabId, by: m.by, ...(ran && { page: true }), ...(released && { requests: prev.held.count }),
          note: m.by === 'user' ? m.note || 'The user let it run again from the side panel.' : 'A new page loaded in the tab; what was paused or held belonged to the old one.' });
      }
    }
    const ownerAlive = () => [...waiters].some(w => w.session === owner) || Date.now() - (sessions.get(owner)?.seen || 0) < 90000;
    function recipients() {
      if (owner && !ownerAlive()) owner = null;
      if (!owner) owner = [...waiters].find(w => w.session)?.session || null;
      return owner ? [...waiters].filter(w => w.session === owner) : [...waiters];
    }
    // `waiting`/`listener`: who gets input from a tab no session owns. `sessions`: every live session, so
    // the panel can show the one whose tab is in front.
    // A session has ended only when its MCP process is gone: its random id dies with the process, so no chat
    // can use it again. Sessions without a known process (CLI-only) never count as ended. A reused pid only
    // delays cleanup, never causes it.
    const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
    const ended = () => {
      const out = [];
      for (const s of sessions.values()) {
        if (!s.pid || pidAlive(s.pid)) continue;
        s.endedAt ||= Date.now();
        if (Date.now() - s.endedAt > 3600000) sessions.delete(s.id); else out.push(s.id);
      }
      return out;
    };
    const listener = () => {
      const r = recipients();
      return { waiting: r.length > 0, listener: owner ? nameOf(owner) || owner : '', ended: ended(),
        sessions: [...sessions.values()].filter(alive).map(s => ({ id: s.id, name: s.name, color: s.color,
          listening: [...waiters].some(w => w.session === s.id), ...(s.pid && { pid: s.pid }) })) };
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
      c.send(JSON.stringify({ cmd: 'lab', url: LAB_URL }));
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
        // `own`: news about the session's own page (pause points), of no use to anyone else.
        if (a.own && !(target && alive(target))) continue;
        const to = target && alive(target) ? [...waiters].filter(w => w.session === a.to) : general;
        if (!to.length) { keep.push(a); continue; }
        const { to: _, own: __, ...plain } = a;
        for (const w of to) deliveries.set(w, [...(deliveries.get(w) || []), plain]);
        recent.push({ ...plain, deliveredAt: Date.now() });
      }
      if (!deliveries.size && keep.length === queue.length) return;
      queue = keep;
      persist();
      setWaiters(() => { for (const [w, actions] of deliveries) { clearTimeout(w.timer); json(w.res, 200, { actions }); waiters.delete(w); } });
      // The user's message reached a session: the panel shows it thinking until it replies there.
      for (const [w, actions] of deliveries) {
        if (w.session && actions.some(a => ['question', 'annotation', 'recording'].includes(a.type))) broadcast({ cmd: 'thinking', session: w.session, ts: Date.now() });
      }
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
        extensionConnected: exts.size > 0, panelOpen: exts.size > 0 && state.panelOpen, lab: LAB_URL,
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
        if (route === 'POST /claim') claim(body.session, body.label);
        else {
          touch(body.session, body.label);
          const s = sessions.get(body.session);
          if (s && Number.isSafeInteger(body.pid) && body.pid > 0) s.pid = body.pid;
          announce();
        }
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
      // The agent answers in the panel's conversation (Markdown).
      if (route === 'POST /say') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        const text = String(body.text || '').trim().slice(0, 20000);
        if (!body.session || !text) return json(res, 400, { error: 'session and text are required' });
        touch(body.session, body.label);
        broadcast({ cmd: 'say', session: body.session, text, who: nameOf(body.session) });
        return json(res, 200, { ok: true, extensionConnected: exts.size > 0 });
      }
      // A session's browser call starts or ends (only the driver of that session sends this).
      if (route === 'POST /busy') {
        let body = {};
        try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
        if (!body.session) return json(res, 400, { error: 'session is required' });
        const c = callState(body.session), t = Date.now();
        const first = body.on && !c.running, last = !body.on && c.running === 1;
        if (body.on) { if (!c.running++) c.since = t; }
        else if (c.running > 0 && !--c.running) { c.windows.push([c.since, t]); c.windows = c.windows.slice(-20); }
        // The page marks the agent's input as such; the call waits (briefly) until the mark is set.
        if ((first || last) && exts.size) {
          const mark = requestExt({ cmd: 'agentBusy', session: body.session, on: !!body.on }, 500).catch(() => {});
          if (first) await mark;
        }
        // The page paused just as the call ended, so the call could not report it.
        if (last && pausedOf(body.session)) tellPaused(pausedOf(body.session));
        return json(res, 200, { ok: true });
      }
      // The driver waits here during a browser_* call: answered when the session's page pauses.
      if (route === 'GET /pause/wait') {
        const session = url.searchParams.get('session') || '', p = pausedOf(session);
        if (p) { p.told = true; return json(res, 200, { paused: p.paused, tab: p.tabId }); }
        if (url.searchParams.get('now')) return json(res, 200, {});
        const w = { session, res };
        pauseWaits.add(w);
        res.on('close', () => pauseWaits.delete(w));
        return;
      }
      // What the user did in the session's tab since the last time it asked; read once.
      if (route === 'GET /user-events') {
        const s = url.searchParams.get('session') || '';
        const events = userLog.get(s) || [];
        userLog.delete(s);
        return json(res, 200, { events: events.map(e => ({ ...e, text: userEventText(e) })) });
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
        if (!['highlight', 'clearHighlights', 'hideOverlays', 'throttle', 'pause', 'resume', 'inspectPaused', 'state', 'loadTour', 'gotoStep', 'endTour', 'requestDemo', 'recordTour', 'recordStop', 'tabs'].includes(body.cmd)) return json(res, 400, { error: 'unknown cmd' });
        const ms = ['recordTour', 'highlight', 'loadTour', 'requestDemo', 'tabs', 'pause'].includes(body.cmd) ? 150000 : ['resume', 'inspectPaused'].includes(body.cmd) ? 20000 : 8000;
        try { return json(res, 200, await requestExt(body, ms)); }
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
        else if (msg.type === 'userEvent') onUserEvent(msg);
        else if (msg.type === 'pauseState') onPauseState(msg);
        // After the port changed hands (the old owner was an agent's MCP process that exited), the extension
        // tells which sessions it has tabs for. Their processes are checked like any other, so a session
        // whose process is gone counts as ended; a running one says hello again within 30 s.
        else if (msg.type === 'knownSessions') {
          for (const k of Array.isArray(msg.sessions) ? msg.sessions.slice(0, 50) : []) {
            if (!k?.id || sessions.has(k.id) || !Number.isSafeInteger(k.pid) || k.pid <= 0) continue;
            sessions.set(String(k.id), { id: String(k.id), label: String(k.name || 'agent'), name: String(k.name || 'agent'),
              color: String(k.color || 'grey'), auto: false, seen: 0, pid: k.pid });
          }
          announced = ''; announce();
        }
        // The user allowed a host from the panel (on their own, or answering the extension's question).
        else if (msg.type === 'hostGrant') { try { hosts.grant(msg.host, msg.mode); } catch (e) { log(e.message); } pushHosts(true); }
        // The user took a grant back in the panel.
        else if (msg.type === 'hostRevoke') { hosts.revoke(msg.host); pushHosts(true); }
        else if (msg.type === 'ping') conn.send('{"type":"pong"}');
      });
      // A browser that is gone has nothing paused; one that reconnects says what is.
      conn.on('close', () => { exts.delete(conn); if (!exts.size) pauses.clear(); log('extension disconnected'); });
    });

    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => { server.off('error', reject); serveLab(server); resolve(server); });
  });
}

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// The test page (scripts/lab.mjs) on its own port, for as long as this process owns the bridge port. A
// handover closes it with the bridge; the new owner may need a moment until the port is free again.
function serveLab(bridge) {
  let lab = null, tries = 0, stopped = false;
  const start = () => {
    if (stopped) return;
    const s = http.createServer(labHandler);
    s.once('error', e => { if (++tries < 20) setTimeout(start, 500).unref(); else log('test page not served:', e.message); });
    s.listen(LAB_PORT, '127.0.0.1', () => { lab = s; });
  };
  bridge.on('close', () => { stopped = true; lab?.close(); lab?.closeAllConnections?.(); });
  start();
}

// One line per user event, e.g. `14:02:11 clicked button "Sortieren"`.
export function userEventText(e) {
  const t = e.target, el = t ? `${t.tag}${t.text ? ` "${t.text.slice(0, 40)}"` : ''} (${t.selector})` : '';
  const at = new Date(e.ts || Date.now()).toLocaleTimeString('en-GB', { hour12: false });
  const what = {
    click: () => `clicked ${el}`,
    doubleClick: () => `double-clicked ${el}`,
    change: () => `set ${el} to "${e.value}"`,
    key: () => `pressed ${e.key}${el ? ` in ${el}` : ''}`,
    navigate: () => `${e.how === 'reload' ? 'reloaded' : 'opened'} ${e.url}`,
    urlChange: () => `the page moved to ${e.url}`,
    newTab: () => `a new tab opened${e.by === 'agent' ? ' from your last action' : e.by === 'user' ? ' by the user, from the side panel' : ' (by the user or the page)'}: ${e.url} (tab ${e.tab}). Your calls still act on your working tab; switch with tabs({ action: 'select', id: ${e.tab} })`,
    tabClosed: () => `your tab ${e.tab} closed (${e.url})`,
    workingTabClosed: () => `your working tab ${e.tab} was closed (${e.url}). Pick another with tabs before your next browser call`,
  }[e.kind]?.() || `${e.kind} ${el}`;
  return `${at} ${what}`;
}

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
