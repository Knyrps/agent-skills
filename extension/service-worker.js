// Owns the WebSocket to the bridge, the action outbox and the highlight list.
// State lives in chrome.storage.session so it survives service-worker restarts and navigations;
// the side panel and the content scripts render from it.
import { loadConfig, hostAllowed, pageKey } from './allow.js';

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
  if (m.cmd === 'setWaiting') return S.set({ waiting: !!m.waiting });
  if (!m.rid) return;
  let result;
  try { result = await command(m); } catch (e) { result = { ok: false, error: String(e?.message || e) }; }
  send({ type: 'result', rid: m.rid, ...result });
}

async function command(m) {
  switch (m.cmd) {
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
      return { ok: true, panelOpen: panels.size > 0,
        tab: tab && { url: tab.url, title: tab.title, allowed: await allowed(tab.url) } };
    }
    default: return { ok: false, error: 'unknown command ' + m.cmd };
  }
}

async function highlight({ item = {}, keep }) {
  if (!item.selector) return { ok: false, error: 'selector is required' };
  const tab = await activeTab();
  if (!tab) return { ok: false, error: 'no active tab' };
  if (!(await allowed(tab.url))) return { ok: false, error: `active tab is not on an allowlisted host: ${tab.url}` };
  const h = {
    id: String(item.id || 'h' + Date.now().toString(36)),
    selector: String(item.selector),
    text: item.text ? String(item.text) : '',
    label: item.label ? String(item.label) : '',
    style: item.style === 'spotlight' ? 'spotlight' : 'outline',
    color: item.color ? String(item.color) : '',
    pageKey: pageKey(tab.url),
  };
  await serial(async () => {
    const { highlights = [] } = await S.get('highlights');
    await S.set({ highlights: (keep ? highlights.filter(x => x.id !== h.id) : []).concat(h) });
  });
  const probe = await chrome.tabs.sendMessage(tab.id, { cmd: 'probe', id: h.id, scroll: item.scroll !== false })
    .catch(e => ({ found: null, note: 'page not ready yet (' + e.message + '); the highlight appears once it loads' }));
  return { ok: true, id: h.id, url: tab.url, ...probe };
}

// ------------------------------------------------------------------ scripted tours
// The agent hands over the whole tour once; Weiter/Zurück then run here without a model round trip.
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

async function run(tabId, actions, i) {
  const r = await chrome.tabs.sendMessage(tabId, { cmd: 'runActions', actions });
  if (!r?.ok) throw new Error(`step ${i + 1}: ${r?.error || 'actions failed'}`);
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
  if (!tour || (action.type !== 'next' && action.type !== 'back')) return null;
  if (running) return { ok: true, local: true, busy: true };
  const target = tourIndex + (action.type === 'next' ? 1 : -1);
  if (target < 0) return { ok: true, local: true };
  gotoStep(target, { replay: action.type === 'back' });
  return { ok: true, local: true, delivered: true };
}

// ------------------------------------------------------------------ "Markieren": capture and paint
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
    case 'action': {
      const local = await tourAction(m.action);
      if (local) return local;
      const { tourIndex = -1, tour } = await S.get(['tourIndex', 'tour']);
      return enqueue(tour ? { ...m.action, step: tourIndex } : m.action);
    }
    case 'recStart': return startRecording();
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
      if (!recordingDraft) return { error: 'Keine Aufnahme vorhanden.' };
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
    case 'annotate': {
      const tab = await activeTab();
      if (!tab || !(await allowed(tab.url))) return { error: 'Diese Seite ist nicht freigegeben.' };
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
    case 'annotationSend': {
      const { annotationDraft, tourIndex = -1, tour } = await S.get(['annotationDraft', 'tourIndex', 'tour']);
      if (!annotationDraft) return { error: 'Keine Markierung vorhanden.' };
      await S.set({ annotationDraft: null });
      return enqueue({ type: 'annotation', text: m.text || '', ...(tour && { step: tourIndex }), ...annotationDraft });
    }
    case 'annotationDrop':
      await S.set({ annotationDraft: null });
      return { ok: true };
    default: return { error: 'unknown message' };
  }
}

async function startRecording() {
  const tab = await activeTab();
  if (!tab || !(await allowed(tab.url))) return { error: 'Diese Seite ist nicht freigegeben.' };
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
  if (port.name !== 'panel') return;
  panels.add(port);
  connect();
  send({ type: 'panel', open: true });
  port.onDisconnect.addListener(() => { panels.delete(port); send({ type: 'panel', open: panels.size > 0 }); });
});

connect();
