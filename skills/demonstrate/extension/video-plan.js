// Pure timing and sizing rules for video recordings; shared by the service worker and the tests.

export const SIZES = { '1080p': [1920, 1080], '900p': [1600, 900], '720p': [1280, 720] };
const MAX_PAGE = 140; // characters per caption page: two lines on a 720p frame

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const words = s => (String(s).match(/\S+/g) || []).length;

// Splits a caption into pages of whole sentences (long sentences at word boundaries).
export function captionPages(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const sentences = t.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g).map(s => s.trim()).filter(Boolean);
  const pieces = [];
  for (const s of sentences) {
    if (s.length <= MAX_PAGE) { pieces.push(s); continue; }
    let line = '';
    for (const w of s.split(' ')) {
      if (line && (line + ' ' + w).length > MAX_PAGE) { pieces.push(line); line = w; } else line = line ? line + ' ' + w : w;
    }
    if (line) pieces.push(line);
  }
  const pages = [];
  for (const p of pieces) {
    const last = pages[pages.length - 1];
    if (last && (last + ' ' + p).length <= MAX_PAGE) pages[pages.length - 1] = last + ' ' + p; else pages.push(p);
  }
  return pages;
}

// Reading time for one caption page: 2.5 s base plus 0.33 s per word, 2.5–10 s, scaled by pace.
export const pageMs = (text, pace = 1) => Math.round(clamp(1500 + 330 * words(text), 2500, 10000) * pace);

// How long a step stays on screen and how its caption pages share that time. `step.dwell` overrides the total.
export function stepTiming(step, { pace = 1, captions = true } = {}) {
  const text = step.caption === false ? '' : String(step.caption ?? step.explanation ?? '');
  const pages = captions ? captionPages(text) : [];
  let times = pages.map(p => pageMs(p, pace));
  let total = times.reduce((a, b) => a + b, 0) || Math.round((text ? clamp(1500 + 330 * words(text), 2500, 20000) : 2500) * pace);
  total = Math.min(total, 20000 * pace);
  if (+step.dwell > 0) total = +step.dwell;
  const sum = times.reduce((a, b) => a + b, 0);
  if (sum) times = times.map(t => Math.round(t * total / sum));
  return { pages, times, total };
}

export function estimateMs(tour, opts = {}) {
  const intro = opts.intro ? 3000 * (opts.pace || 1) : 0;
  return Math.round(intro + tour.steps.filter(s => s.video !== false)
    .reduce((n, s) => n + stepTiming(s, opts).total + 600 * (s.actions?.length || 0), 0) + 1500);
}

// Output size and the viewport (CSS px at zoom 1) that maps onto it 1:1 if the screen has room.
// `room` is the largest viewport the screen can show next to the browser's own UI.
export function pickSize(size, scale, room) {
  const fits = ([w, h]) => w / scale <= room.width + 0.5 && h / scale <= room.height + 0.5;
  let out;
  const custom = /^(\d{3,4})x(\d{3,4})$/.exec(String(size || ''));
  if (custom) out = [+custom[1] & ~1, +custom[2] & ~1];
  else if (SIZES[size]) out = SIZES[size];
  else out = Object.values(SIZES).find(fits) || SIZES['720p'];
  let vw = out[0] / scale, vh = out[1] / scale;
  const k = Math.min(1, room.width / vw, room.height / vh);
  vw = Math.round(vw * k); vh = Math.round(vh * k);
  return { width: out[0], height: out[1], viewport: { width: vw, height: vh }, scaled: k < 1 };
}

export const bitrate = (w, h, fps = 30) => Math.round(w * h * fps * 0.13);
