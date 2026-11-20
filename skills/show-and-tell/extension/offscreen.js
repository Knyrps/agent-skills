// Hidden page that owns a video recording: the tab's stream goes through MediaRecorder and every
// chunk is written to the bridge as it arrives. The service worker drives it over the "video" port.
// This page keeps the clock of recorded time (pauses excluded), so chapters and captions match the file.
import { loadConfig } from './allow.js';

// H.264 High / Main / Baseline at level 4.0 (enough for 1080p30), then whatever MP4 or WebM there is.
const TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.4d0028', 'video/mp4;codecs=avc1.42e028',
  'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = null, rec = null, stream = null, base = '', id = '', offset = 0, upload = Promise.resolve(), failed = '';
let startedAt = 0, pausedAt = 0, pausedTotal = 0, ending = null, heartbeat = 0;

const now = () => (startedAt ? Math.max(0, (pausedAt || performance.now()) - startedAt - pausedTotal) : 0);
const post = m => { try { port?.postMessage(m); } catch {} };

async function bridge(method, path, body) {
  const r = await fetch(base + path, { method, body,
    headers: body && typeof body === 'string' ? { 'Content-Type': 'application/json' } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `bridge answered ${r.status}`);
  return j;
}

// Chunks are written in order at their byte offset; a failed write is retried before the recording fails.
function put(blob) {
  if (!blob.size) return;
  const at = offset;
  offset += blob.size;
  upload = upload.then(async () => {
    if (failed) return;
    for (let attempt = 0; ; attempt++) {
      try { await bridge('PUT', `/video/${id}?offset=${at}`, blob); return; }
      catch (e) {
        if (attempt < 4) { await sleep(400 * 2 ** attempt); continue; }
        fail('saving the video failed: ' + e.message);
        return;
      }
    }
  });
}

function fail(error) {
  if (failed) return;
  failed = error;
  post({ type: 'error', error });
  try { if (rec?.state !== 'inactive') rec.stop(); } catch {}
}

// The file records one generated track; frames come from the captured tab of the moment, so the video can
// move to a tab or popup a step opened (switch) without starting a new file. Frames get a steady clock of
// their own, so a switch leaves no jump. A popup of another size is scaled into the frame (letterboxed).
let gen = null, writer = null, feeding = 0, source = null, constraints = null;
const capture = streamId => navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
  chromeMediaSource: 'tab', chromeMediaSourceId: streamId, ...constraints } } });
async function feed(s) {
  const token = ++feeding, [track] = s.getVideoTracks();
  track.addEventListener('ended', () => { if (token === feeding && !ending) fail('the tab capture ended (tab closed or capture taken over)'); });
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const old = source; source = s;
  (async () => {
    for (;;) {
      const { value: frame, done } = await reader.read().catch(() => ({ done: true }));
      if (done) return;
      if (token !== feeding) { frame.close(); reader.cancel().catch(() => {}); return; }
      if (old) { old.getTracks().forEach(t => t.stop()); }
      const out = new VideoFrame(frame, { timestamp: Math.round(performance.now() * 1000) });
      frame.close();
      try { await writer.write(out); } catch { out.close(); return; }
    }
  })();
  return track;
}

async function start(m) {
  const { bridgeUrl } = await loadConfig();
  base = bridgeUrl.replace(/^ws/, 'http').replace(/\/ext$/, '');
  constraints = { minWidth: m.width, maxWidth: m.width, minHeight: m.height, maxHeight: m.height, maxFrameRate: m.fps, minFrameRate: m.minFps ?? m.fps };
  gen = new MediaStreamTrackGenerator({ kind: 'video' });
  writer = gen.writable.getWriter();
  stream = new MediaStream([gen]);
  const first = await capture(m.streamId);
  const capTrack = await feed(first);
  const track = gen;
  const mimeType = (m.mimeType && MediaRecorder.isTypeSupported(m.mimeType) && m.mimeType)
    || TYPES.find(t => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('this browser cannot record video (no MP4 or WebM encoder)');
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  ({ id } = await bridge('POST', '/video/open', JSON.stringify({ name: m.name, ext })));
  // Screen content is mostly still, so a variable-rate encoder starves the moments that move (scrolling,
  // dialogs opening) and they turn blocky. A constant rate keeps motion as sharp as the still frames.
  track.contentHint = 'detail';
  rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: m.bitrate, videoBitrateMode: m.bitrateMode || 'constant',
    videoKeyFrameIntervalDuration: 2000 });
  rec.ondataavailable = e => put(e.data);
  rec.onerror = e => fail('recorder error: ' + (e.error?.message || e.error || 'unknown'));
  rec.onstop = () => ending?.();
  const begun = new Promise(r => { rec.onstart = () => { startedAt = performance.now(); r(); }; });
  rec.start(m.timeslice ?? 1000);
  await begun;
  heartbeat = setInterval(() => post({ type: 'tick', t: now() }), 1000);
  const s = capTrack.getSettings();
  return { id, mimeType, ext, width: s.width, height: s.height, frameRate: s.frameRate };
}

// Stops the recorder, waits for every chunk, then lets the bridge finish (meta) or delete (discard) the file.
async function stop({ meta = {}, discard = false } = {}) {
  clearInterval(heartbeat);
  const durationMs = Math.round(now());
  if (rec && rec.state !== 'inactive') {
    const done = new Promise(r => { ending = r; });
    rec.stop();
    await Promise.race([done, sleep(10000)]);
  }
  feeding++;
  source?.getTracks().forEach(t => t.stop());
  stream?.getTracks().forEach(t => t.stop());
  await upload;
  if (!id) return { ok: true, discarded: true };
  if (discard || failed) {
    await bridge('POST', `/video/${id}/abort`, JSON.stringify({ keep: false })).catch(() => {});
    return failed ? { ok: false, error: failed } : { ok: true, discarded: true };
  }
  const r = await bridge('POST', `/video/${id}/close`, JSON.stringify({ ...meta, durationMs, bytes: offset }));
  return { ok: true, ...r };
}

async function onCommand(m) {
  switch (m.cmd) {
    case 'start': return start(m);
    case 'now': return { t: now() };
    case 'pause':
      if (rec?.state === 'recording') { rec.pause(); pausedAt = performance.now(); }
      return { t: now() };
    case 'resume':
      if (rec?.state === 'paused') { rec.resume(); pausedTotal += performance.now() - pausedAt; pausedAt = 0; }
      return { t: now() };
    // Go on recording another tab (a tab or popup a step opened, or back).
    case 'switch': { await feed(await capture(m.streamId)); return { t: now() }; }
    case 'stop': return stop(m);
    default: throw new Error('unknown command ' + m.cmd);
  }
}

port = chrome.runtime.connect({ name: 'video' });
port.onMessage.addListener(m => {
  onCommand(m).then(r => post({ rid: m.rid, ...r }), e => post({ rid: m.rid, ok: false, error: String(e?.message || e) }));
});
// The worker went away (crash, reload): keep what was recorded so far instead of losing it.
port.onDisconnect.addListener(() => {
  port = null;
  stop({ meta: { partial: true, error: 'the extension stopped during the recording' } }).finally(() => window.close());
});
