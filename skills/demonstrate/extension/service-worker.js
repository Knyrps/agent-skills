// Owns the WebSocket to the bridge, the action outbox and the highlight list.
// State lives in chrome.storage.session so it survives service-worker restarts and navigations;
// the side panel and the content scripts render from it.
import { loadConfig, hostAllowed, pageKey } from './allow.js';
import { stepTiming, estimateMs, pickSize, bitrate } from './video-plan.js';

const S = chrome.storage.session;
S.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {}); // content scripts read highlights
S.set({ connected: false });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());

let lock = Promise.resolve();
const serial = fn => { const p = lock.then(fn); lock = p.catch(() => {}); return p; };
const allowed = async url => hostAllowed(url, (await loadConfig()).allowlist);

// ------------------------------------------------------------------ bridge connection

let ws = null, backoff = 1000, retry = null, ping = null;
const panels = new Set();
let video = null; // the recording in progress, see "video recording" below
S.set({ video: null });

async function connect() {
  if (ws) return;
  const { bridgeUrl } = await loadConfig();
  if (ws) return;
  const sock = new WebSocket(bridgeUrl);
  ws = sock;
  sock.onopen = () => {
    backoff = 1000;
    S.set({ connected: true });
    clearInterval(ping);
    ping = setInterval(() => send({ type: 'ping' }), 20000); // traffic keeps the worker alive
    send({ type: 'panel', open: panels.size > 0 });
    flushOutbox();
  };
  sock.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    onBridge(m).catch(err => console.warn('[demonstrate]', err));
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    clearInterval(ping);
    S.set({ connected: false, waiting: false });
    if (!retry) retry = setTimeout(() => { retry = null; connect(); }, backoff);
    backoff = Math.min(backoff * 2, 15000);
  };
}

function send(m) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

// ------------------------------------------------------------------ outbox (nothing is lost)

async function enqueue(action) {
  const item = { id: crypto.randomUUID(), action: { ...action, ts: Date.now() } };
  await serial(async () => {
    const { outbox = [] } = await S.get('outbox');
    outbox.push(item);
    await S.set({ outbox });
  });
  if (!send({ type: 'action', ...item })) connect();
  return { id: item.id, delivered: ws?.readyState === WebSocket.OPEN };
}

async function flushOutbox() {
  const { outbox = [] } = await S.get('outbox');
  for (const item of outbox) send({ type: 'action', ...item });
}

const ack = id => serial(async () => {
  const { outbox = [] } = await S.get('outbox');
  await S.set({ outbox: outbox.filter(x => x.id !== id) });
});

// ------------------------------------------------------------------ bridge -> extension

async function onBridge(m) {
  if (m.type === 'ack') return ack(m.id);
  if (m.type === 'pong') return;
  if (m.cmd === 'setStep') {
    // A loaded tour labels its own steps; the bridge re-sends its last label on every reconnect.
    if ((await S.get('tour')).tour) return;
    return S.set({ step: String(m.label || '') });
  }
  if (m.cmd === 'setWaiting') return S.set({ waiting: !!m.waiting, listener: String(m.listener || '') });
  if (!m.rid) return;
  let result;
  try { result = await command(m); } catch (e) { result = { ok: false, error: String(e?.message || e) }; }
  send({ type: 'result', rid: m.rid, ...result });
}

async function command(m) {
  if (video && !['state', 'recordStop', 'setStep'].includes(m.cmd)) return { ok: false, error: 'a video is being recorded; wait for videoReady or call recordStop' };
  switch (m.cmd) {
    case 'recordTour': return recordTour(m);
    case 'recordStop': return recordStop(m);
    case 'highlight': return highlight(m);
    case 'clearHighlights':
      await serial(async () => {
        const { highlights = [] } = await S.get('highlights');
        await S.set({ highlights: m.id ? highlights.filter(h => h.id !== m.id) : [] });
      });
      return { ok: true };
    case 'hideOverlays':
      await S.set({ overlaysHidden: !!m.hidden });
      return { ok: true, hidden: !!m.hidden };
    // Steps can take longer than the bridge waits for a reply: start them and report failures as stepError.
    case 'loadTour':
      await S.set({ tour: validTour(m.tour), tourIndex: -1, tourRunning: false });
      gotoStep(m.start ?? 0, { replay: true });
      return { ok: true, steps: m.tour.steps.length };
    case 'gotoStep':
      gotoStep(+m.index, { replay: true });
      return { ok: true };
    case 'endTour':
      await S.set({ tour: null, tourIndex: -1, explanation: '', step: '', highlights: [], tourRunning: false });
      return { ok: true };
    // The agent asks the user to show something: the panel shows the prompt and recording starts.
    case 'requestDemo': {
      const id = 'r' + Date.now().toString(36);
      const r = await startRecording();
      if (r.error) return { ok: false, error: r.error };
      await S.set({ demoRequest: { id, prompt: String(m.prompt || '') }, recordingDraft: null });
      return { ok: true, requestId: id };
    }
    case 'state': {
      const tab = await activeTab();
      return { ok: true, panelOpen: panels.size > 0, ...(video && { video: (await S.get('video')).video }),
        tab: tab && { url: tab.url, title: tab.title, allowed: await allowed(tab.url) } };
    }
    default: return { ok: false, error: 'unknown command ' + m.cmd };
  }
}

const GESTURES = ['tap', 'double-tap', 'long-press', 'swipe', 'pinch', 'click', 'double-click', 'right-click', 'hover', 'drag', 'scroll'];

async function highlight({ item = {}, keep, tab }) {
  if (!item.selector) return { ok: false, error: 'selector is required' };
  tab ||= await activeTab();
  if (!tab) return { ok: false, error: 'no active tab' };
  // `url` opens the page first, so showing one thing needs no browser driving by the agent.
  if (item.url && tab.url !== item.url) {
    if (!(await allowed(item.url))) return { ok: false, error: `not on an allowlisted host: ${item.url}` };
    await navigate(tab.id, String(item.url));
    tab = await chrome.tabs.get(tab.id);
  }
  if (!(await allowed(tab.url))) return { ok: false, error: `active tab is not on an allowlisted host: ${tab.url}` };
  const h = {
    id: String(item.id || 'h' + Date.now().toString(36)),
    selector: String(item.selector),
    text: item.text ? String(item.text) : '',
    label: item.label ? String(item.label) : '',
    style: ['spotlight', 'none'].includes(item.style) ? item.style : 'outline',
    color: item.color ? String(item.color) : '',
    gesture: item.gesture ? String(item.gesture) : '',
    direction: item.direction ? String(item.direction) : '',
    to: item.to ? String(item.to) : '',
    pageKey: pageKey(tab.url),
  };
  if (h.gesture && !GESTURES.includes(h.gesture)) return { ok: false, error: `unknown gesture "${h.gesture}"; use one of ${GESTURES.join(', ')}` };
  if (h.direction && !['left', 'right', 'up', 'down', 'in', 'out'].includes(h.direction)) return { ok: false, error: 'direction must be left, right, up, down, in or out' };
  await serial(async () => {
    const { highlights = [] } = await S.get('highlights');
    await S.set({ highlights: (keep ? highlights.filter(x => x.id !== h.id) : []).concat(h) });
  });
  const probe = await chrome.tabs.sendMessage(tab.id, { cmd: 'probe', id: h.id, scroll: item.scroll !== false })
    .catch(e => ({ found: null, note: 'page not ready yet (' + e.message + '); the highlight appears once it loads' }));
  return { ok: true, id: h.id, url: tab.url, ...probe };
}

// ------------------------------------------------------------------ scripted tours
// The agent hands over the whole tour once; Next/Back then run here without a model round trip.
// Step: { title, explanation?, url?, actions?, highlights?, agent? }. `url` navigates before the step;
// a step without one continues on the current page. `agent: true` hands the step to the agent.

function validTour(tour) {
  if (!tour || !Array.isArray(tour.steps) || tour.steps.length === 0) throw new Error('tour.steps must be a non-empty array');
  tour.steps.forEach((s, i) => { if (!s.title) throw new Error(`step ${i + 1} has no title`); });
  return tour;
}

let running = false;

async function gotoStep(index, { replay }) {
  const { tour } = await S.get('tour');
  if (!tour) return { ok: false, error: 'no tour loaded' };
  if (running) return { ok: false, error: 'a step is still running' };
  const steps = tour.steps;
  if (index >= steps.length) {
    await enqueue({ type: 'tourEnd', step: steps.length - 1 });
    return { ok: true, ended: true };
  }
  index = Math.max(0, index);
  const step = steps[index];
  running = true;
  await S.set({ tourIndex: index, tourRunning: true, step: `${index + 1}/${steps.length} – ${step.title}`,
    explanation: step.explanation || '', highlights: [] });
  try {
    if (step.agent) {
      await enqueue({ type: 'agentStep', step: index, title: step.title });
      return { ok: true, step: index, agent: true };
    }
    const tab = await activeTab();
    if (!tab) throw new Error('no active tab');
    // Going back (or jumping) replays from the last navigation, so the page state matches the step.
    let from = index;
    if (replay) while (from > 0 && !steps[from].url) from--;
    for (let i = from; i <= index; i++) {
      const s = steps[i];
      if (s.url && i === from) await navigate(tab.id, s.url);
      if (s.actions?.length) await run(tab.id, s.actions, i);
    }
    for (const [i, h] of (step.highlights || []).entries()) {
      await run(tab.id, [{ waitFor: h.selector, text: h.text, after: 0 }], index);
      const r = await highlight({ item: { id: h.id || 'h' + i, ...h }, keep: i > 0 });
      if (!r.ok) throw new Error(`step ${index + 1} highlight: ${r.error}`);
      if (r.found === false) throw new Error(`step ${index + 1} highlight not found: ${h.selector}`);
    }
    return { ok: true, step: index };
  } catch (e) {
    const error = String(e?.message || e);
    await enqueue({ type: 'stepError', step: index, error });
    return { ok: false, step: index, error };
  } finally {
    running = false;
    await S.set({ tourRunning: false });
  }
}

// One action per message: an action that loads a new page closes the message channel, which then
// counts as done once the new page is ready.
async function run(tabId, actions, i, cinematic = false) {
  for (const a of actions) {
    let r;
    try { r = await chrome.tabs.sendMessage(tabId, { cmd: 'runActions', actions: [a], cinematic, accent: cinematic ? video?.stage?.branding?.accent : '' }); }
    catch (e) {
      if (!/closed|Receiving end/i.test(e.message)) throw e;
      await pageReady(tabId);
      continue;
    }
    if (!r?.ok) throw new Error(`step ${i + 1}: ${r?.error || 'actions failed'}`);
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'loading') await pageReady(tabId);
  }
}

async function pageReady(tabId, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') {
      const r = await chrome.tabs.sendMessage(tabId, { cmd: 'ping' }).catch(() => null);
      if (r?.ok) return;
      if (!(await allowed(t.url))) throw new Error('the page left the allowlisted hosts: ' + t.url);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('page load timed out');
}

async function navigate(tabId, url) {
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('page load timed out: ' + url)); }, 120000);
    const on = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve(); } };
    chrome.tabs.onUpdated.addListener(on);
  });
  await chrome.tabs.update(tabId, { url });
  await done;
  for (let i = 0; i < 50; i++) {
    const r = await chrome.tabs.sendMessage(tabId, { cmd: 'ping' }).catch(() => null);
    if (r?.ok) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('page is not on an allowlisted host or did not start the content script: ' + url);
}

async function tourAction(action) {
  const { tour, tourIndex = -1 } = await S.get(['tour', 'tourIndex']);
  if (video && (action.type === 'next' || action.type === 'back')) return { ok: true, local: true, busy: true };
  if (!tour || (action.type !== 'next' && action.type !== 'back')) return null;
  if (running) return { ok: true, local: true, busy: true };
  const target = tourIndex + (action.type === 'next' ? 1 : -1);
  if (target < 0) return { ok: true, local: true };
  gotoStep(target, { replay: action.type === 'back' });
  return { ok: true, local: true, delivered: true };
}

// ------------------------------------------------------------------ "Annotate": capture and paint
// The content script hides its overlay and describes every mark in document coordinates. The worker
// captures the page area around all marks (beyond the window if needed) and paints the marks itself:
// once as the user drew them, once more with a dashed, labelled outline (1a, 1b …) per page element a
// mark refers to - the same labels as the action's legend. Only the model sees that second copy.

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

async function captureArea(tab, spec) {
  const view = { x: spec.scroll.x, y: spec.scroll.y, width: spec.viewport.width, height: spec.viewport.height };
  const c = spec.clip;
  const beyond = c.x < view.x || c.y < view.y || c.x + c.width > view.x + view.width || c.y + c.height > view.y + view.height;
  const target = { tabId: tab.id };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    // Another debugger client holds the tab: fall back to the visible window.
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { bitmap: await createImageBitmap(await (await fetch(url)).blob()), clip: view, captureError: String(e.message || e) };
  }
  try {
    const { data } = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', { format: 'png',
      captureBeyondViewport: beyond, clip: { ...c, scale: Math.min(1, 12000 / (c.height * spec.dpr)) } });
    return { bitmap: await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob()), clip: c };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

function smoothPath(g, pts) {
  g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  g.lineTo(...pts[pts.length - 1]);
}

function arrowParts([f, t], k) {
  const dx = t[0] - f[0], dy = t[1] - f[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const L = Math.min(18 * k, len * 0.6), w = L * 0.55, bx = t[0] - ux * L, by = t[1] - uy * L;
  return { shaft: [f, [bx + ux * 2 * k, by + uy * 2 * k]], head: [t, [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]] };
}

function wrap(g, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && g.measureText(next.trimEnd()).width > maxW) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// The same look as the overlay: halo, tinted frames, arrowhead, smoothed pen, numbered badge, note card.
function paintMarks(g, annotations, clip, k, surface = '#fff') {
  const X = x => (x - clip.x) * k, Y = y => (y - clip.y) * k, P = p => [X(p.x), Y(p.y)];
  for (const a of annotations) {
    const d = a.draw;
    if (!d || !a.rect) continue;
    g.save();
    if (d.clip) { g.beginPath(); g.rect(X(d.clip.x), Y(d.clip.y), d.clip.width * k, d.clip.height * k); g.clip(); }
    g.lineCap = g.lineJoin = 'round';
    const r = [X(a.rect.x), Y(a.rect.y), a.rect.width * k, a.rect.height * k];
    const arrow = a.kind === 'arrow' && arrowParts([P(a.from), P(a.to)], k);
    const shape = () => {
      g.beginPath();
      if (a.kind === 'rect' || a.kind === 'element') g.roundRect(...r, 10 * k);
      else if (arrow) { g.moveTo(...arrow.shaft[0]); g.lineTo(...arrow.shaft[1]); }
      else smoothPath(g, d.points.map(P));
    };
    const head = () => { g.beginPath(); g.moveTo(...arrow.head[0]); g.lineTo(...arrow.head[1]); g.lineTo(...arrow.head[2]); g.closePath(); };
    g.save();
    g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 3 * k; g.shadowOffsetY = k;
    g.strokeStyle = surface; g.fillStyle = surface; g.globalAlpha = 0.92; g.lineWidth = 7 * k;
    shape(); g.stroke();
    if (arrow) { head(); g.fill(); g.stroke(); }
    g.restore();
    if (a.kind === 'rect' || a.kind === 'element') { g.fillStyle = a.color + (a.kind === 'rect' ? '12' : '24'); shape(); g.fill(); }
    g.strokeStyle = a.color; g.lineWidth = (a.kind === 'element' ? 2.5 : 3) * k;
    shape(); g.stroke();
    if (arrow) { g.fillStyle = a.color; g.lineWidth = 2 * k; head(); g.fill(); g.stroke(); }
    g.restore();
  }
  // Note cards grow out of the badge, so the badge is painted last, on the card's number spot.
  for (const a of annotations) {
    const d = a.draw;
    if (!d?.noteBox || !a.note) continue;
    const box = d.noteBox, t = d.noteText;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 6 * k; g.shadowOffsetY = 2 * k;
    g.fillStyle = d.noteBg;
    g.beginPath(); g.roundRect(X(box.x), Y(box.y), box.width * k, box.height * k, d.noteRadius * k); g.fill();
    g.shadowColor = 'transparent';
    g.font = `400 ${14 * k}px ${FONT}`; g.fillStyle = d.noteFg; g.textBaseline = 'middle'; g.textAlign = 'start';
    wrap(g, a.note, (t.width + 2) * k).forEach((l, i) => g.fillText(l, X(t.x), Y(t.y) + (10 + 20 * i) * k));
    g.restore();
  }
  for (const a of annotations) {
    const d = a.draw;
    if (!d?.badge || !a.rect) continue;
    g.save();
    if (d.clip && !d.noteBox) { g.beginPath(); g.rect(X(d.clip.x), Y(d.clip.y), d.clip.width * k, d.clip.height * k); g.clip(); }
    const [bx, by] = P(d.badge);
    g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 3 * k; g.shadowOffsetY = k;
    g.fillStyle = a.color; g.strokeStyle = surface; g.lineWidth = 2 * k;
    g.beginPath(); g.arc(bx, by, 11 * k, 0, Math.PI * 2); g.fill();
    g.shadowColor = 'transparent'; g.stroke();
    g.fillStyle = d.on || '#fff'; g.font = `600 ${12 * k}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(a.n), bx, by + 0.5 * k);
    g.restore();
  }
}

function paintLabels(g, annotations, clip, k) {
  const X = x => (x - clip.x) * k, Y = y => (y - clip.y) * k;
  g.font = `600 ${11 * k}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'start';
  for (const a of annotations) {
    for (const el of a.elements) {
      const r = el.rect;
      g.setLineDash([6 * k, 4 * k]);
      g.strokeStyle = a.color; g.lineWidth = 1.5 * k;
      g.strokeRect(X(r.x), Y(r.y), r.width * k, r.height * k);
      g.setLineDash([]);
      const w = g.measureText(el.label).width + 10 * k, h = 18 * k;
      const tx = Math.min(Math.max(0, X(r.x + r.width) - w), g.canvas.width - w);
      const ty = Math.min(Math.max(0, Y(r.y) - h - 2 * k), g.canvas.height - h);
      g.fillStyle = a.color;
      g.beginPath(); g.roundRect(tx, ty, w, h, 4 * k); g.fill();
      g.fillStyle = a.draw?.on || '#fff';
      g.fillText(el.label, tx + 5 * k, ty + h / 2);
    }
  }
}

async function toDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(bin);
}

async function renderAnnotation(tab, spec) {
  const { bitmap, clip, captureError } = await captureArea(tab, spec);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d');
  const k = bitmap.width / clip.width;
  g.drawImage(bitmap, 0, 0);
  paintMarks(g, spec.annotations, clip, k, spec.surface);
  const image = await toDataUrl(canvas);
  paintLabels(g, spec.annotations, clip, k);
  const labelledImage = await toDataUrl(canvas);
  return {
    url: spec.url, viewport: spec.viewport, scroll: spec.scroll, dpr: spec.dpr,
    imageArea: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    ...(captureError && { captureError }),
    annotations: spec.annotations.map(({ draw: _, ...a }) => a),
    image, labelledImage,
  };
}

// ------------------------------------------------------------------ video recording
// record_tour plays a scripted tour on one pinned tab while the offscreen page records that tab.
// The window is sized so the viewport maps 1:1 onto the output; page loads are cut by pausing.

let videoPort = null, videoRid = 0, portWaiter = null;
const videoReplies = new Map();

function onVideoPort(port) {
  videoPort = port;
  portWaiter?.();
  port.onMessage.addListener(m => {
    if (m.rid) return videoReplies.get(m.rid)?.(m);
    if (m.type === 'error' && video) { video.failure ||= m.error; video.abort = true; }
  });
  port.onDisconnect.addListener(() => {
    if (videoPort === port) videoPort = null;
    if (video && !video.finishing) { video.failure ||= 'the video recorder page closed'; video.abort = true; }
  });
}

function videoCmd(m, ms = 15000) {
  return new Promise((resolve, reject) => {
    if (!videoPort) return reject(new Error('the video recorder is not running'));
    const rid = ++videoRid;
    const t = setTimeout(() => { videoReplies.delete(rid); reject(new Error('the video recorder did not answer: ' + m.cmd)); }, ms);
    videoReplies.set(rid, r => { clearTimeout(t); videoReplies.delete(rid); r.ok === false ? reject(new Error(r.error)) : resolve(r); });
    videoPort.postMessage({ ...m, rid });
  });
}

async function openRecorder() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument().catch(() => {});
  videoPort = null;
  const connected = new Promise((resolve, reject) => {
    portWaiter = resolve;
    setTimeout(() => reject(new Error('the video recorder page did not start')), 10000);
  });
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'],
    justification: 'Records the demo tour tab to a video file' });
  await connected;
  portWaiter = null;
}

const metrics = tabId => chrome.tabs.sendMessage(tabId, { cmd: 'metrics' });
const even = n => Math.max(2, Math.round(n / 2) * 2);

// Resizes the window so the tab's viewport has the chosen size in device-independent pixels.
async function stageWindow(tab, size) {
  const win = await chrome.windows.get(tab.windowId);
  const restore = { id: win.id, state: win.state, left: win.left, top: win.top, width: win.width, height: win.height };
  const zoom = await chrome.tabs.getZoom(tab.id);
  let m = await metrics(tab.id);
  const scale = m.dpr / zoom;
  const vw = () => m.iw * zoom, vh = () => m.ih * zoom;
  const dx = win.width - vw(), dy = win.height - vh();
  const pick = pickSize(size, scale, { width: m.aw - dx, height: m.ah - dy });
  const target = pick.viewport;
  if (win.state !== 'normal') await chrome.windows.update(win.id, { state: 'normal' });
  let bounds = { left: m.ax, top: m.ay, width: Math.round(target.width + dx), height: Math.round(target.height + dy) };
  for (let i = 0; i < 4; i++) {
    await chrome.windows.update(win.id, bounds);
    await new Promise(r => setTimeout(r, 300));
    m = await metrics(tab.id);
    const ex = target.width - vw(), ey = target.height - vh();
    if (Math.abs(ex) < 1 && Math.abs(ey) < 1) break;
    bounds = { ...bounds, width: Math.round(bounds.width + ex), height: Math.round(bounds.height + ey) };
  }
  // Whatever the window ended up as, the output keeps the viewport's shape so nothing is letterboxed.
  const exact = Math.abs(target.width - vw()) < 1 && Math.abs(target.height - vh()) < 1 && !pick.scaled;
  const width = exact ? pick.width : even(vw() * scale), height = exact ? pick.height : even(vh() * scale);
  return { restore, width, height, viewport: { width: Math.round(vw()), height: Math.round(vh()) }, scale, exact };
}

async function restoreWindow(r) {
  if (!r) return;
  if (r.state === 'normal') await chrome.windows.update(r.id, { left: r.left, top: r.top, width: r.width, height: r.height }).catch(() => {});
  else await chrome.windows.update(r.id, { state: r.state }).catch(() => {});
}

async function recordTour(m) {
  if (video) return { ok: false, error: 'a video is already being recorded' };
  const tour = validTour(m.tour);
  const agentStep = tour.steps.findIndex(s => s.agent);
  if (agentStep >= 0) return { ok: false, error: `step ${agentStep + 1} is an agent step; videos need fully scripted tours` };
  const opts = { name: m.name || tour.title || '', size: m.size || 'auto', pace: Math.min(3, Math.max(0.3, +m.pace || 1)),
    captions: m.captions !== false, cards: m.cards !== false, hidpi: m.hidpi !== false, out: m.out || '' };
  const tab = await activeTab();
  if (!tab) return { ok: false, error: 'no active tab' };
  // The first page has to be loaded to measure the viewport; this load is not recorded.
  const first = tour.steps.find(s => s.url)?.url;
  if (!(await allowed(tab.url))) {
    if (!first) return { ok: false, error: `the active tab is not on an allowlisted host: ${tab.url}` };
    await navigate(tab.id, first);
  }
  await S.set({ tour: null, tourIndex: -1, highlights: [], explanation: '', step: '' });
  // `zoom` (0.25–2) zooms the page for the recording, e.g. 0.8 on a 125 % screen shows the page at its
  // 1:1 desktop layout. Chrome keeps zoom per site, so the previous level is restored afterwards.
  const zoom = m.zoom ? Math.min(2, Math.max(0.25, +m.zoom)) : 0;
  const zoomBefore = zoom ? await chrome.tabs.getZoom(tab.id) : 0;
  if (zoom) { await chrome.tabs.setZoom(tab.id, zoom); await new Promise(r => setTimeout(r, 300)); }
  let staged = await stageWindow(tab, opts.size);
  // Leaving the maximized state can still be in progress and swallow the resize; try once more.
  if (!staged.exact) {
    await new Promise(r => setTimeout(r, 1000));
    staged = { ...(await stageWindow(tab, opts.size)), restore: staged.restore };
  }
  video = { tabId: tab.id, tour, opts, ...staged, zoomBefore, step: -1, abort: false, discard: false, failure: '', finishing: false,
    loading: false, onCamera: false, stage: {} };
  await S.set({ video: { state: 'starting', steps: tour.steps.length, step: -1, width: staged.width, height: staged.height } });
  runVideo(video);
  const z = zoom || 1;
  return { ok: true, width: staged.width, height: staged.height, exact: staged.exact,
    viewport: { width: Math.round(staged.viewport.width / z), height: Math.round(staged.viewport.height / z) },
    estimatedMs: estimateMs(tour, { ...opts, intro: opts.cards }) };
}

async function recordStop(m) {
  if (!video) return { ok: false, error: 'no video is being recorded' };
  video.abort = true;
  video.discard = !!m.discard;
  return { ok: true, stopping: true };
}

async function dwell(v, ms) {
  const end = Date.now() + ms;
  while (!v.abort && Date.now() < end) await new Promise(r => setTimeout(r, Math.min(200, end - Date.now())));
}

const panelVideo = (v, state, extra = {}) =>
  S.set({ video: { state, steps: v.tour.steps.length, step: v.step, width: v.width, height: v.height, ...extra } });

// The stage script draws captions, chapter label, progress bar and cards; it is injected again after
// every page load and always gets the whole state.
async function stage(v, patch) {
  Object.assign(v.stage, patch);
  await chrome.scripting.executeScript({ target: { tabId: v.tabId }, files: ['stage.js'] }).catch(() => {});
  await chrome.tabs.sendMessage(v.tabId, { cmd: 'stage', state: v.stage }).catch(() => {});
}

// A page started loading in the recorded tab: cut the load out of the video.
chrome.webNavigation.onBeforeNavigate.addListener(d => {
  const v = video;
  if (!v || d.tabId !== v.tabId || d.frameId !== 0 || v.finishing) return;
  v.loading = true;
  videoCmd({ cmd: 'pause' }).catch(() => {});
});

// After a page load: wait for the new page, redraw the stage, resume recording if the step is on camera.
async function settle(v) {
  const t = await chrome.tabs.get(v.tabId);
  if (!v.loading && t.status !== 'loading') return;
  await pageReady(v.tabId);
  v.loading = false;
  await stage(v, {});
  if (v.onCamera) await videoCmd({ cmd: 'resume' });
}

const now = async () => (await videoCmd({ cmd: 'now' })).t;
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function logoData(file) {
  if (!file) return '';
  if (/^(data|https?):/.test(file)) return file;
  try {
    const blob = await (await fetch(chrome.runtime.getURL(file))).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
  } catch { return ''; }
}

async function runVideo(v) {
  const { tour, opts } = v, steps = tour.steps, pace = opts.pace;
  const chapters = [], cues = [];
  const shown = steps.filter(s => s.video !== false);
  const sections = [...new Set(shown.map(s => s.section).filter(Boolean))];
  const title = tour.title || opts.name || steps[0].title;
  let mimeType = '', section = null, n = 0;
  const caption = async (text, ms) => {
    const t0 = await now();
    if (opts.captions) await stage(v, { caption: text });
    await dwell(v, ms);
    cues.push({ start: t0, end: await now(), text });
  };
  try {
    const { branding = {} } = await loadConfig();
    v.stage = { branding: { ...branding, logoData: await logoData(branding.logo) }, shield: true, footer: null, lower: null, caption: null,
      card: opts.cards ? { kind: 'intro', title, subtitle: tour.subtitle || [today(), branding.name].filter(Boolean).join(' · ') } : null };
    // The first page is already loaded; go there now so the intro card covers it, not a page load.
    if (steps[0].url && (await chrome.tabs.get(v.tabId)).url !== steps[0].url) await navigate(v.tabId, steps[0].url);
    await stage(v, {});
    for (let c = 3; c > 0 && !v.abort; c--) { await panelVideo(v, 'countdown', { count: c }); await dwell(v, 1000); }
    if (v.abort) throw Object.assign(new Error('cancelled'), { quiet: true });
    await openRecorder();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: v.tabId });
    // Chrome renders a captured tab at a higher pixel density when the capture is larger than the tab, so
    // the video gets real detail beyond the window's pixels (up to 1080 lines, at most twice the window).
    const k = opts.hidpi === false ? 1 : Math.min(2, Math.max(1, 1080 / v.height));
    v.width = even(v.width * k); v.height = even(v.height * k);
    const info = await videoCmd({ cmd: 'start', streamId, width: v.width, height: v.height, fps: 30,
      bitrate: bitrate(v.width, v.height), name: opts.name || title });
    mimeType = info.mimeType;
    v.onCamera = true;
    if (opts.cards) await dwell(v, 2500 * pace);
    for (let i = 0; i < steps.length && !v.abort; i++) {
      const s = steps[i];
      v.step = i;
      await panelVideo(v, 'recording');
      await S.set({ step: `${i + 1}/${steps.length} – ${s.title}`, explanation: s.explanation || '', highlights: [] });
      v.onCamera = s.video !== false;
      if (!v.onCamera) await videoCmd({ cmd: 'pause' });
      // A new section swaps the card in place (intro → section), so no page flashes between two cards;
      // the card also covers the navigation to the step's page.
      const newSection = v.onCamera && opts.cards && s.section && s.section !== section;
      if (newSection) {
        section = s.section;
        await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
        await S.set({ highlights: [] });
        await stage(v, { caption: null, lower: null,
          card: { kind: 'section', title: s.section, kicker: `Section ${sections.indexOf(s.section) + 1} of ${sections.length}` } });
      } else await stage(v, { card: v.onCamera && v.stage.card?.kind === 'intro' ? v.stage.card : null, caption: null, lower: null });
      if (s.url && i > 0) await navigate(v.tabId, s.url);
      await settle(v);
      if (newSection) await dwell(v, 1600 * pace);
      const t = v.onCamera ? await now() : 0;
      if (v.onCamera) {
        n++;
        chapters.push({ t, title: s.title });
        const timing = stepTiming(s, opts);
        v.timing = timing;
        await stage(v, { card: null, footer: { index: n - 1, count: shown.length },
          lower: { n, of: shown.length, title: s.title },
          caption: opts.captions ? timing.pages[0] || null : null });
      }
      if (s.actions?.length) { await run(v.tabId, s.actions, i, v.onCamera); await settle(v); }
      const tab = await chrome.tabs.get(v.tabId);
      for (const [k, h] of (s.highlights || []).entries()) {
        await run(v.tabId, [{ waitFor: h.selector, text: h.text, after: 0 }], i);
        const r = await highlight({ item: { id: h.id || 'h' + k, ...h }, keep: k > 0, tab });
        if (!r.ok) throw new Error(`step ${i + 1} highlight: ${r.error}`);
        if (r.found === false) throw new Error(`step ${i + 1} highlight not found: ${h.selector}`);
      }
      if (!v.onCamera) { await videoCmd({ cmd: 'resume' }); continue; }
      // Captions: the first page has been up since the step began; the rest follow at reading pace.
      const { pages, times, total } = v.timing;
      const spent = (await now()) - t;
      if (!pages.length) { await dwell(v, Math.max(800, total - spent)); continue; }
      cues.push({ start: t, end: t, text: pages[0] });
      const first = cues[cues.length - 1];
      // While actions run the viewer watches the pointer, so only half of that time counts as reading.
      await dwell(v, Math.max(1500 * pace, times[0] - spent / 2));
      first.end = await now();
      for (let k = 1; k < pages.length && !v.abort; k++) await caption(pages[k], times[k]);
    }
    if (!v.abort && opts.cards) {
      const fmt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
      await S.set({ highlights: [] });
      await stage(v, { caption: null, lower: null, card: { kind: 'outro', title, chapters: chapters.map(c => ({ time: fmt(c.t), title: c.title })) } });
      await dwell(v, Math.max(3000, 500 * chapters.length) * pace);
    }
  } catch (e) {
    if (!e.quiet) v.failure ||= String(e?.message || e);
    else v.discard = true;
  }
  v.finishing = true;
  await panelVideo(v, 'finishing');
  const partial = v.abort && !v.failure;
  try {
    if (v.failure || v.discard) {
      if (videoPort) await videoCmd({ cmd: 'stop', discard: true }, 30000).catch(() => {});
      await enqueue(v.failure ? { type: 'videoError', step: v.step, error: v.failure } : { type: 'videoDiscarded', step: v.step });
    } else {
      // The bridge queues videoReady itself once the file is complete.
      await videoCmd({ cmd: 'stop', meta: { title, chapters, cues: opts.captions ? cues : [],
        steps: steps.map(s => s.title), width: v.width, height: v.height, mimeType, out: opts.out,
        ...(partial && { partial: true }) } }, 120000);
    }
  } catch (e) {
    await enqueue({ type: 'videoError', step: v.step, error: 'finishing the video failed: ' + (e?.message || e) });
  } finally {
    await chrome.offscreen.closeDocument().catch(() => {});
    await chrome.tabs.sendMessage(v.tabId, { cmd: 'stage', end: true }).catch(() => {});
    await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
    await S.set({ pointerAt: null });
    await restoreWindow(v.restore);
    if (v.zoomBefore) await chrome.tabs.setZoom(v.tabId, v.zoomBefore).catch(() => {});
    video = null;
    await S.set({ video: null, step: '', explanation: '', highlights: [] });
  }
}

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  if (t) return t;
  const [any] = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return any;
}

// ------------------------------------------------------------------ panel / content -> worker

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  handle(m, sender).then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});

async function handle(m, sender) {
  switch (m.type) {
    case 'hello': return { allowed: await allowed(sender.tab?.url || m.url) };
    case 'videoStop': return video ? recordStop(m) : { ok: false };
    case 'annotate': case 'recStart':
      if (video) return { error: 'A video is being recorded.' };
      return m.type === 'recStart' ? startRecording() : handleAnnotate();
    case 'action': {
      const local = await tourAction(m.action);
      if (local) return local;
      const { tourIndex = -1, tour } = await S.get(['tourIndex', 'tour']);
      return enqueue(tour ? { ...m.action, step: tourIndex } : m.action);
    }
    case 'recStep': {
      if (!sender.tab) return {};
      await serial(async () => {
        const { recording } = await S.get('recording');
        if (!recording || recording.tabId !== sender.tab.id) return;
        recording.steps.push(m.step);
        await S.set({ recording });
      });
      return {};
    }
    // Stopping parks the recording as a draft; the panel sends it with the user's question.
    case 'recStop': {
      const { recording, demoRequest } = await S.get(['recording', 'demoRequest']);
      if (!recording || m.discard) {
        await S.set({ recording: null, demoRequest: null });
        if (demoRequest) await enqueue({ type: 'demoDeclined', requestId: demoRequest.id, prompt: demoRequest.prompt });
        return { ok: true, discarded: true };
      }
      await S.set({ recording: null, recordingDraft: { title: 'demonstrate recording', startedAt: recording.startedAt,
        duration: Date.now() - recording.startedAt, steps: recording.steps } });
      return { ok: true };
    }
    case 'recSend': {
      const { recordingDraft, demoRequest, tourIndex = -1, tour } = await S.get(['recordingDraft', 'demoRequest', 'tourIndex', 'tour']);
      if (!recordingDraft) return { error: 'There is no recording.' };
      await S.set({ recordingDraft: null, demoRequest: null });
      return enqueue({ type: 'recording', text: m.text || '', url: m.url,
        ...(demoRequest && { requestId: demoRequest.id, prompt: demoRequest.prompt }),
        ...(tour && { step: tourIndex }), recording: recordingDraft });
    }
    case 'recDrop': {
      const { demoRequest } = await S.get('demoRequest');
      await S.set({ recordingDraft: null, demoRequest: null });
      if (demoRequest) await enqueue({ type: 'demoDeclined', requestId: demoRequest.id, prompt: demoRequest.prompt });
      return { ok: true };
    }
    case 'annotationSend': {
      const { annotationDraft, tourIndex = -1, tour } = await S.get(['annotationDraft', 'tourIndex', 'tour']);
      if (!annotationDraft) return { error: 'There is no annotation.' };
      await S.set({ annotationDraft: null });
      return enqueue({ type: 'annotation', text: m.text || '', ...(tour && { step: tourIndex }), ...annotationDraft });
    }
    case 'annotationDrop':
      await S.set({ annotationDraft: null });
      return { ok: true };
    default: return { error: 'unknown message' };
  }
}

async function handleAnnotate() {
  const tab = await activeTab();
  if (!tab || !(await allowed(tab.url))) return { error: 'This page is not on the allowlist.' };
  const result = await chrome.tabs.sendMessage(tab.id, { cmd: 'annotate' });
  if (!result) return { cancelled: true };
  try {
    const annotationDraft = await renderAnnotation(tab, result);
    await S.set({ annotationDraft });
    return { ok: true, count: result.annotations.length };
  } finally {
    chrome.tabs.sendMessage(tab.id, { cmd: 'annotateClear' }).catch(() => {});
  }
}

async function startRecording() {
  const tab = await activeTab();
  if (!tab || !(await allowed(tab.url))) return { error: 'This page is not on the allowlist.' };
  await S.set({ recording: { startedAt: Date.now(), tabId: tab.id, steps: [
    { type: 'setViewport', width: tab.width, height: tab.height },
    { type: 'navigate', url: tab.url, ts: Date.now() },
  ] } });
  return { ok: true };
}

// URL changes in the recorded tab: a full page load (`navigate`, a replay loads it) or an SPA route
// change (`urlChange`, a replay gets there by repeating the click before it).
function recordUrl(type, { tabId, frameId, url }) {
  if (frameId !== 0) return;
  serial(async () => {
    const { recording } = await S.get('recording');
    if (!recording || recording.tabId !== tabId) return;
    const last = recording.steps[recording.steps.length - 1];
    if (type === 'navigate' && last?.type === 'navigate' && last.url === url) return;
    recording.steps.push({ type, url, ts: Date.now() });
    await S.set({ recording });
  });
}
chrome.webNavigation.onCommitted.addListener(d => recordUrl('navigate', d));
chrome.webNavigation.onHistoryStateUpdated.addListener(d => recordUrl('urlChange', d));

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'video') return onVideoPort(port);
  if (port.name !== 'panel') return;
  panels.add(port);
  connect();
  send({ type: 'panel', open: true });
  port.onDisconnect.addListener(() => { panels.delete(port); send({ type: 'panel', open: panels.size > 0 }); });
});

connect();
