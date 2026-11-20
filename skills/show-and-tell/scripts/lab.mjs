// Test page for show-and-tell: every element reacts to real mouse, touch and keyboard input (and to the
// skill's scripted actions), and a log at the bottom lists what happened, trusted or synthetic. It is built
// like a Material 3 app (M3 color tokens, type scale, Material Web components), so the controls live in
// shadow DOM the way they do in real apps.
// The bridge serves it on http://localhost:47614/ (and /next for a second page) whenever it runs, and the
// browser opens it on start. On its own: node scripts/lab.mjs [port]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Its own port, not the bridge's: the page's scripts must not reach the bridge API.
export const LAB_PORT = +(process.env.DEMO_LAB_PORT || 47614);
export const LAB_URL = `http://localhost:${LAB_PORT}/`;
const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = {
  '/material-lab.js': [path.join(here, 'lab-vendor', 'material-lab.js'), 'text/javascript'],
  '/m3-tokens.css': [path.join(here, '..', 'extension', 'vendor', 'm3-tokens.css'), 'text/css'],
  '/favicon.svg': [path.join(here, '..', 'extension', 'icons', 'icon.svg'), 'image/svg+xml'],
};
// Enough cards to overflow the strip even on very wide screens.
const cards = Array.from({ length: 20 }, (_, i) => `<div class="item md-typescale-label-large" data-n="${i + 1}">Product ${i + 1}</div>`).join('');

// Raw events the debug panel can show, by group: [type, note, name in the log]. Every row shows the real
// event name; a note only where the name does not explain itself. The log says "hover start" and "focus"
// for the events whose DOM names are least obvious.
const GROUPS = [
  ['Pointer', [['pointerdown'], ['pointerup'], ['pointermove'], ['pointercancel', 'the browser took over the gesture, e.g. to scroll']]],
  ['Hover', [['mouseover', 'hover start', 'hover start'], ['mouseout', 'hover end', 'hover end']]],
  ['Mouse', [['click'], ['dblclick'], ['auxclick', 'middle or other non-primary button'], ['contextmenu'], ['wheel']]],
  ['Keyboard', [['keydown'], ['keyup']]],
  ['Focus', [['focusin', 'focus, also from inside components', 'focus'], ['focusout', 'blur, also from inside components', 'blur']]],
  ['Input', [['beforeinput', 'just before a field\'s value changes'], ['input'], ['change'],
    ['compositionstart', 'IME or dead-key input begins'], ['compositionend', 'IME or dead-key input ends']]],
  ['Touch', [['touchstart'], ['touchmove'], ['touchend'], ['touchcancel']]],
  ['Drag', [['dragstart'], ['drag'], ['dragenter'], ['dragover'], ['dragleave'], ['drop'], ['dragend']]],
  ['Scroll', [['scroll']]],
  ['Clipboard', [['copy'], ['cut'], ['paste']]],
  ['Page', [['visibilitychange', 'the tab was hidden or shown'], ['resize'], ['pageshow', 'also when restored from the back/forward cache']]],
];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const eventList = GROUPS.map(([group, types]) => `<div class="group" data-group="${group}">
  <label class="check-row group-row"><md-checkbox class="gbox" aria-label="All ${group} events"></md-checkbox><span class="md-typescale-title-small grow">${group}</span><span class="count sub md-typescale-label-medium"></span></label>
  ${types.map(([type, note = '', label = type]) => `<label class="check-row ev" data-type="${type}" data-label="${esc(label)}" data-search="${esc(`${type} ${note} ${group}`.toLowerCase())}"><md-checkbox></md-checkbox><span class="txt"><span class="md-typescale-body-medium">${type}</span>${note ? `<span class="sub md-typescale-body-small">${esc(note)}</span>` : ''}</span></label>`).join('\n  ')}
</div>`).join('\n');

// The debug panel under the bug icon: who to show, and (Advanced) which events.
const DEBUG_PANEL = `<div id="debug-panel" class="debug-panel" role="dialog" aria-label="Debug options" hidden>
  <div class="pad"><md-outlined-select id="log-from" label="Log events from">
    <md-select-option value="both" selected><div slot="headline">User + Agent</div></md-select-option>
    <md-select-option value="user"><div slot="headline">User</div></md-select-option>
    <md-select-option value="agent"><div slot="headline">Agent</div></md-select-option>
  </md-outlined-select></div>
  <button id="adv-toggle" class="adv-toggle" aria-expanded="false" aria-controls="adv"><md-ripple></md-ripple>
    <span class="txt grow"><span class="md-typescale-body-large">Advanced…</span><span id="adv-sum" class="sub md-typescale-body-medium"></span></span>
    <svg viewBox="0 0 24 24"><path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg></button>
  <div id="adv" hidden>
    <label class="check-row"><md-checkbox id="demo"></md-checkbox><span class="txt"><span class="md-typescale-body-large">Demo reactions</span>
      <span class="sub md-typescale-body-small">What the lab's cards report: tapped, hovered, Ctrl+K…</span></span></label>
    <div class="sep"></div>
    <div class="pad"><md-outlined-text-field id="ev-search" label="Search events" type="search"></md-outlined-text-field></div>
    <div id="ev-list" class="ev-list">${eventList}</div>
    <div class="adv-actions"><md-text-button id="ev-all">All</md-text-button><md-text-button id="ev-none">None</md-text-button><md-text-button id="ev-reset">Reset</md-text-button></div>
  </div>
</div>`;

const page = (title, body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.svg">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/m3-tokens.css">
<style>
:root{color-scheme:light dark;--md-ref-typeface-brand:system-ui,"Segoe UI",sans-serif;--md-ref-typeface-plain:system-ui,"Segoe UI",sans-serif}
*{box-sizing:border-box}
/* Sideways swipes and wheels stay in the page instead of triggering Chrome's back/forward gesture. */
html,body{overscroll-behavior:none}
body{margin:0;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);font-family:var(--md-ref-typeface-plain)}
/* M3 small top app bar. */
header{position:sticky;top:0;z-index:5;height:64px;display:flex;align-items:center;gap:24px;padding:0 24px;
  background:var(--md-sys-color-surface-container)}
header .grow{flex:1}
[hidden]{display:none!important}
.grow{flex:1}
md-icon-button svg{width:24px;height:24px;fill:currentColor}
#log .raw{color:color-mix(in srgb,var(--md-sys-color-inverse-on-surface) 65%,transparent)}
/* Debug panel: an M3 surface under the bug icon (surface container, 16 px corners, elevation 2). */
.debug-panel{position:fixed;z-index:10;width:360px;max-height:calc(100vh - 80px);overflow:auto;padding:16px 0 8px;border-radius:16px;
  background:var(--md-sys-color-surface-container);color:var(--md-sys-color-on-surface);
  box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15)}
.debug-panel .pad{padding:0 16px}
.debug-panel md-outlined-select,.debug-panel md-outlined-text-field{width:100%}
.adv-toggle{all:unset;box-sizing:border-box;position:relative;display:flex;align-items:center;gap:16px;width:100%;min-height:64px;margin-top:8px;padding:8px 16px;cursor:pointer}
.adv-toggle .txt,.check-row .txt{display:flex;flex-direction:column}
.adv-toggle svg{flex:none;width:24px;height:24px;fill:var(--md-sys-color-on-surface-variant);transition:rotate .2s}
.adv-toggle[aria-expanded=true] svg{rotate:180deg}
.adv-toggle:focus-visible{outline:2px solid var(--md-sys-color-secondary);outline-offset:-2px}
#adv{display:flex;flex-direction:column;gap:8px}
.sep{height:1px;margin:0 16px;background:var(--md-sys-color-outline-variant)}
.sub{color:var(--md-sys-color-on-surface-variant)}
.check-row{display:flex;align-items:center;gap:12px;min-height:40px;padding:4px 16px;cursor:pointer}
.check-row.ev{padding-left:48px}
.group-row{min-height:48px}
.ev-list{display:flex;flex-direction:column}
.adv-actions{display:flex;justify-content:flex-end;gap:4px;padding:0 8px}
header a{color:var(--md-sys-color-primary);text-decoration:none}
main{padding:24px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
/* M3 filled card: surface-container-highest, 12 px corners. Done states use the secondary container. */
.box{position:relative;min-width:0;min-height:112px;padding:16px;display:flex;flex-direction:column;gap:8px;border-radius:12px;
  background:var(--md-sys-color-surface-container-highest);user-select:none;touch-action:none;transition:background .2s}
.box h3{margin:0}
.state{color:var(--md-sys-color-on-surface-variant)}
.ok{background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container)}
.ok .state{color:inherit}
.wide{grid-column:span 2}
.strip{display:flex;gap:8px;overflow-x:auto;padding:4px 0;scroll-behavior:auto;touch-action:pan-x;scrollbar-width:thin}
.item{flex:none;width:136px;height:80px;border-radius:12px;display:grid;place-items:center;
  background:var(--md-sys-color-surface-container-low);color:var(--md-sys-color-on-surface)}
#drag{position:relative;z-index:2;width:112px;height:56px;border-radius:16px;display:grid;place-items:center;cursor:grab;
  background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container)}
#drop{outline:2px dashed var(--md-sys-color-outline);outline-offset:-2px}
#drop.over{outline-color:var(--md-sys-color-primary);background:var(--md-sys-color-primary-container)}
#pinch{overflow:hidden}#pinch .zoom{transform-origin:center;transition:transform .05s;font-size:28px;text-align:center}
#hover:hover{background:var(--md-sys-color-tertiary-container);color:var(--md-sys-color-on-tertiary-container)}
#scr{height:136px;overflow:auto;touch-action:pan-y}
md-outlined-text-field,md-outlined-select{width:100%}
label.check{display:flex;align-items:center;gap:8px;cursor:pointer}
md-slider{width:100%}
.row{display:flex;flex-wrap:wrap;gap:8px}
#items{margin:0;padding-left:20px}#items:empty{display:none}
#menu-anchor{position:fixed;width:0;height:0}
/* M3 terminal-style log on the inverse surface. */
#log{grid-column:1/-1;height:160px;overflow:auto;padding:12px 16px;border-radius:12px;
  background:var(--md-sys-color-inverse-surface);color:var(--md-sys-color-inverse-on-surface);font:12px/18px ui-monospace,Consolas,monospace}
</style></head><body>
<header><span class="md-typescale-title-large">${title}</span><span class="grow"></span>${title === 'Next page'
  ? '<a href="/" id="back-link" class="md-typescale-label-large">← Back to the lab</a>'
  : '<a href="/next" id="next-link" class="md-typescale-label-large">Next page →</a>'}
<md-icon-button id="debug-btn" aria-label="Debug options" title="Debug options" aria-haspopup="dialog" aria-expanded="false">
  <svg viewBox="0 0 24 24"><path d="M20 8h-2.81a6 6 0 0 0-1.82-1.96L17 4.41 15.59 3l-2.17 2.17a6 6 0 0 0-2.83 0L8.41 3 7 4.41l1.62 1.63A6 6 0 0 0 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81A6 6 0 0 0 12 21a6 6 0 0 0 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>
</md-icon-button></header>
${DEBUG_PANEL}
<main>${body}<div id="log"></div></main>
<script type="module">
import '/material-lab.js';
${LOG_SCRIPT}
${script}
log('page loaded: ' + location.pathname);
</script></body></html>`;

// The log: every event goes into a buffer (5,000 lines); the debug panel's settings only decide what is
// shown, so changing them shows or hides past events too. Who caused an event:
//   trusted input                → [user], or [agent] while show-and-tell marks a browser_* call
//   untrusted, during a step     → [agent · scripted] (the skill playing the agent's tour or video steps)
//   untrusted, from page code    → [user · component] / [agent · component]: whoever's input came last
const LOG_SCRIPT = String.raw`
const $ = s => document.querySelector(s);
const set = (sel, text, ok = true) => { const s = $(sel + ' .state'); if (s) s.textContent = text; if (ok) $(sel).classList.add('ok'); };
// Material components re-fire change as their own (untrusted) event; the native control inside has the real one.
const inner = async (sel, q = 'input') => { const h = $(sel); await customElements.whenDefined(h.localName); await h.updateComplete; return [...h.shadowRoot.querySelectorAll(q)].pop(); };
const mark = () => document.documentElement.getAttribute('data-show-and-tell-agent');
let lastInput = null;
const whoOf = e => {
  const m = mark();
  if (e && e.isTrusted) return { who: m != null && m !== 'scripted' ? 'agent' : 'user', how: '' };
  if (m === 'scripted') return { who: 'agent', how: 'scripted' };
  return { who: lastInput && performance.now() - lastInput.t < 60000 ? lastInput.who : '', how: 'component' };
};
for (const t of ['pointerdown', 'keydown', 'beforeinput', 'wheel', 'touchstart'])
  addEventListener(t, e => { if (e.isTrusted) lastInput = { who: whoOf(e).who, t: performance.now() }; }, true);
const tag = c => c.who ? c.who + (c.how ? ' · ' + c.how : '') : c.how;

const DEFAULTS = { from: 'both', demo: true, types: [], advanced: false };
let cfg;
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.labLog || '{}') }; } catch { cfg = { ...DEFAULTS }; }
let types = new Set(cfg.types);
const save = () => { cfg.types = [...types]; localStorage.labLog = JSON.stringify(cfg); };

const buffer = [], MAX = 5000;
const shown = x => x.kind === 'note' || ((x.kind === 'demo' ? cfg.demo : types.has(x.type)) && (cfg.from === 'both' || !x.who || x.who === cfg.from));
const text = x => x.time + '  ' + (x.kind === 'raw' ? '· ' + x.label + (x.n > 1 ? ' ×' + x.n : '') + x.extra + ' on ' + x.where : x.what)
  + (x.kind === 'note' ? '' : '  [' + tag(x) + ']');
const line = x => { const d = document.createElement('div'); if (x.kind === 'raw') d.className = 'raw'; d.textContent = text(x); x.el = d; return d; };
const box = () => $('#log');
const atEnd = () => box().scrollHeight - box().scrollTop - box().clientHeight < 24;
function render() {
  for (const x of buffer) x.el = null;
  box().replaceChildren(...buffer.filter(shown).map(line));
  box().scrollTop = box().scrollHeight;
}
function add(x) {
  x.time = new Date().toLocaleTimeString();
  buffer.push(x);
  if (buffer.length > MAX) buffer.shift().el?.remove();
  if (!shown(x)) return;
  const end = atEnd();
  box().append(line(x));
  if (end) box().scrollTop = box().scrollHeight;
}

// A line from the lab's own listeners. e: the DOM event, 'component' for an event a component fires itself,
// or nothing for a note. credit: who gets it instead (a field's change comes on blur, its value from whoever typed).
function log(what, e, credit) {
  if (!e) return add({ kind: 'note', what, who: '', how: '' });
  const c = credit || whoOf(e === 'component' ? null : e);
  add({ kind: 'demo', what, ...c });
  (window.__lab = window.__lab || []).push({ what, trusted: !!e.isTrusted, agent: c.who === 'agent', event: e !== 'component' });
}

// Raw events, always recorded; repeats of one event on one element within a second fold into one line.
const LABELS = Object.fromEntries([...document.querySelectorAll('#ev-list .ev')].map(r => [r.dataset.type, r.dataset.label]));
const name = el => el === window ? 'window' : !(el instanceof Element) ? 'document' : el.id ? '#' + el.id
  : el.localName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '');
const where = el => { const b = el instanceof Element && el.closest('.box'); return name(el) + (b && b !== el && b.id ? ' in #' + b.id : ''); };
function raw(e) {
  const t = e.target;
  if (t instanceof Element && (t.closest('#log, header, #debug-panel') || t.localName === 'show-and-tell-overlay')) return;
  if ((e.type === 'mouseover' || e.type === 'mouseout') && e.relatedTarget && t.contains?.(e.relatedTarget)) return;
  const extra = e.type.startsWith('key') ? ' ' + e.key : e.type === 'wheel' ? ' ' + Math.round(e.deltaX) + ',' + Math.round(e.deltaY)
    : e.pointerType ? ' ' + e.pointerType : '';
  const c = whoOf(e), w = where(t), key = e.type + extra + w + tag(c), now = performance.now();
  const last = buffer[buffer.length - 1];
  if (last && last.kind === 'raw' && last.key === key && now - last.t < 1000) {
    last.n++; last.t = now;
    if (last.el) last.el.textContent = text(last);
    return;
  }
  add({ kind: 'raw', type: e.type, label: LABELS[e.type] || e.type, extra, where: w, ...c, key, t: now, n: 1 });
}
for (const type of Object.keys(LABELS)) addEventListener(type, raw, { capture: true, passive: true });

// The debug panel.
const panel = $('#debug-panel'), btn = $('#debug-btn'), from = $('#log-from'), demo = $('#demo');
const rows = [...panel.querySelectorAll('.ev')], groups = [...panel.querySelectorAll('.group')];
const checkOf = r => r.querySelector('md-checkbox');
function openPanel(on) {
  panel.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) return;
  const r = btn.getBoundingClientRect();
  panel.style.top = (r.bottom + 4) + 'px';
  panel.style.right = Math.max(8, innerWidth - r.right) + 'px';
}
btn.addEventListener('click', () => openPanel(panel.hidden));
addEventListener('pointerdown', e => { if (!panel.hidden && !e.composedPath().some(n => n === panel || n === btn)) openPanel(false); }, true);
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || panel.hidden || e.composedPath().some(n => n.localName === 'md-outlined-select' && n.open)) return;
  openPanel(false); btn.focus();
}, true);
function summary() {
  const n = types.size;
  $('#adv-sum').textContent = [cfg.demo && 'Demo reactions', n && n + ' event type' + (n > 1 ? 's' : '')].filter(Boolean).join(' + ') || 'Nothing';
}
function syncGroups() {
  for (const g of groups) {
    const items = rows.filter(r => g.contains(r)), on = items.filter(r => types.has(r.dataset.type)).length, gb = g.querySelector('.gbox');
    gb.checked = on === items.length; gb.indeterminate = on > 0 && on < items.length;
    g.querySelector('.count').textContent = on + '/' + items.length;
  }
}
function syncAll() {
  from.value = cfg.from; demo.checked = cfg.demo;
  for (const r of rows) checkOf(r).checked = types.has(r.dataset.type);
  syncGroups(); summary();
}
const changed = () => { save(); syncGroups(); summary(); render(); };
function showAdvanced(on) {
  $('#adv').hidden = !on; $('#adv-toggle').setAttribute('aria-expanded', String(on));
  cfg.advanced = on; save();
}
$('#adv-toggle').addEventListener('click', () => showAdvanced($('#adv').hidden));
from.addEventListener('change', () => { cfg.from = from.value; changed(); });
demo.addEventListener('change', () => { cfg.demo = demo.checked; changed(); });
for (const r of rows) checkOf(r).addEventListener('change', () => { checkOf(r).checked ? types.add(r.dataset.type) : types.delete(r.dataset.type); changed(); });
for (const g of groups) g.querySelector('.gbox').addEventListener('change', e => {
  for (const r of rows.filter(r => g.contains(r))) { e.target.checked ? types.add(r.dataset.type) : types.delete(r.dataset.type); checkOf(r).checked = e.target.checked; }
  changed();
});
$('#ev-search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  for (const r of rows) r.hidden = !!q && !r.dataset.search.includes(q);
  for (const g of groups) g.hidden = rows.filter(r => g.contains(r)).every(r => r.hidden);
});
const visibleRows = () => rows.filter(r => !r.hidden && !r.closest('.group').hidden);
$('#ev-all').addEventListener('click', () => { for (const r of visibleRows()) types.add(r.dataset.type); syncAll(); changed(); });
$('#ev-none').addEventListener('click', () => { for (const r of visibleRows()) types.delete(r.dataset.type); syncAll(); changed(); });
$('#ev-reset').addEventListener('click', () => { cfg = { ...DEFAULTS, advanced: cfg.advanced }; types = new Set(); syncAll(); changed(); });
await Promise.all(['md-outlined-select', 'md-checkbox'].map(n => customElements.whenDefined(n)));
await from.updateComplete;
syncAll(); showAdvanced(cfg.advanced);
localStorage.removeItem('labVerbose'); localStorage.removeItem('labMoves');
`;

const LAB_SCRIPT = String.raw`
// Tap: a pointer down and up on the same spot.
let taps = 0;
$('#tap').addEventListener('pointerup', e => { taps++; set('#tap', 'Tapped ' + taps + '×'); log('tap', e); });
// Double tap: two pointer ups within 350 ms (or a dblclick).
let lastUp = 0;
$('#dtap').addEventListener('pointerup', e => { const t = performance.now(); if (t - lastUp < 350) { set('#dtap', 'Double tapped'); log('double tap', e); lastUp = 0; } else lastUp = t; });
// Long press: held 600 ms without moving away.
let holdT = 0;
$('#lp').addEventListener('pointerdown', e => { set('#lp', 'Holding…', false); holdT = setTimeout(() => { set('#lp', 'Long pressed'); log('long press', e); }, 600); });
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) $('#lp').addEventListener(t, () => { clearTimeout(holdT); });
$('#lp').addEventListener('contextmenu', e => e.preventDefault());
// Pinch: two touch points, or Ctrl + wheel on a mouse / trackpad.
let scale = 1; const pts = new Map(); let d0 = 0, s0 = 1;
const zoom = (s, e, how) => { scale = Math.min(3, Math.max(.5, s)); $('#pinch .zoom').style.transform = 'scale(' + scale + ')'; set('#pinch', 'Zoom ' + Math.round(scale * 100) + '%'); log(how + ' ' + Math.round(scale * 100) + '%', e); };
$('#pinch').addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); s0 = scale; } });
$('#pinch').addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (pts.size === 2 && d0) { const [a, b] = [...pts.values()]; zoom(s0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / d0, e, 'pinch'); } });
for (const t of ['pointerup', 'pointercancel']) $('#pinch').addEventListener(t, e => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; });
$('#pinch').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); zoom(scale * (e.deltaY < 0 ? 1.1 : .9), e, 'ctrl+wheel zoom'); }, { passive: false });
// Swipe strip: scrolls with touch, the wheel, or a mouse drag.
const strip = $('#strip'); let sx = null;
strip.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') { sx = [e.clientX, strip.scrollLeft]; strip.setPointerCapture(e.pointerId); } });
strip.addEventListener('pointermove', e => { if (sx) strip.scrollLeft = sx[1] - (e.clientX - sx[0]); });
strip.addEventListener('pointerup', () => { sx = null; });
let scrollLog = 0;
strip.addEventListener('scroll', () => { const first = [...strip.children].find(c => c.offsetLeft - strip.offsetLeft + c.offsetWidth > strip.scrollLeft + 4);
  set('#strip-box', 'First card in view: ' + first.dataset.n); clearTimeout(scrollLog); scrollLog = setTimeout(() => log('strip scrolled to card ' + first.dataset.n), 200); });
// Drag to the drop zone: HTML5 drag and drop, or a pointer drag (touch, and pages that use pointer events).
const drag = $('#drag'), drop = $('#drop');
const dropped = (e, how) => { drop.append(drag); drag.style.translate = ''; drop.classList.remove('over'); set('#drop', 'Dropped (' + how + ')'); log('dropped via ' + how, e); };
drag.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'box'); log('drag start', e); });
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); dropped(e, 'html5'); });
let pd = null;
drag.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; pd = [e.clientX, e.clientY]; drag.setPointerCapture(e.pointerId); });
drag.addEventListener('pointermove', e => { if (pd) drag.style.translate = (e.clientX - pd[0]) + 'px ' + (e.clientY - pd[1]) + 'px'; });
drag.addEventListener('pointerup', e => { if (!pd) return; pd = null; drag.style.translate = '';
  const r = drop.getBoundingClientRect(); if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) dropped(e, 'pointer'); });
// Click, double click, right click with a menu, hover.
let clicks = 0;
$('#btn').addEventListener('click', e => { clicks++; $('#btn').textContent = 'Clicked ' + clicks; set('#btn-box', clicks + ' click' + (clicks > 1 ? 's' : '')); log('click', e); });
$('#dbl').addEventListener('dblclick', e => { set('#dbl', 'Double clicked'); log('double click', e); });
const menu = $('#menu'), anchor = $('#menu-anchor');
$('#ctx').addEventListener('contextmenu', e => { e.preventDefault(); Object.assign(anchor.style, { left: e.clientX + 'px', top: e.clientY + 'px' });
  menu.show(); set('#ctx', 'Menu open', false); log('right click', e); });
for (const item of menu.querySelectorAll('md-menu-item')) item.addEventListener('click', e => { set('#ctx', 'Chose ' + item.dataset.v); log('menu: ' + item.dataset.v, e); });
$('#hover').addEventListener('mouseenter', e => { set('#hover', 'Hovered'); log('hover', e); });
// Scroll inside a box.
let scrLog = 0;
$('#scr').addEventListener('scroll', () => { set('#scr', 'Scrolled to ' + Math.round($('#scr').scrollTop) + ' px'); clearTimeout(scrLog); scrLog = setTimeout(() => log('box scrolled to ' + Math.round($('#scr').scrollTop)), 200); });
// Typing, a search that submits on Enter, select, checkbox, slider, dialog, a shortcut.
let typedBy = '';
$('#name').addEventListener('input', e => { typedBy = whoOf(e); set('#name-box', 'Hello, ' + ($('#name').value || '…')); });
(await inner('#name')).addEventListener('change', e => log('name changed to "' + $('#name').value + '"', e, typedBy));
$('#query').addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); set('#form-box', 'Searched for "' + $('#query').value + '"'); log('search submitted', e); });
$('#size').addEventListener('change', () => { set('#size-box', 'Size ' + $('#size').value); log('select: ' + $('#size').value, 'component'); });
(await inner('#agree')).addEventListener('change', e => { set('#agree-box', $('#agree').checked ? 'Checked' : 'Unchecked'); log('checkbox ' + $('#agree').checked, e); });
$('#vol').addEventListener('input', () => set('#vol-box', 'Volume ' + $('#vol').value));
(await inner('#vol')).addEventListener('change', e => log('slider ' + $('#vol').value, e));
$('#open-dlg').addEventListener('click', e => { $('#dlg').show(); log('dialog opened', e); });
// New tabs: a link with target=_blank, window.open and a popup window, all opening the second page.
$('#newtab-link').addEventListener('click', e => log('link to a new tab', e));
$('#newtab-open').addEventListener('click', e => { window.open('/next?via=window.open'); log('window.open', e); });
$('#newtab-popup').addEventListener('click', e => { window.open('/next?via=popup', 'lab-popup', 'popup,width=720,height=520'); log('popup window', e); });
$('#dlg-ok').addEventListener('click', e => { $('#dlg').close(); set('#dlg-box', 'Dialog confirmed'); log('dialog confirmed', e); });
addEventListener('keydown', e => { if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); set('#keys-box', 'Ctrl+K pressed'); log('shortcut Ctrl+K', e); } });
// Load data: a request with a loading state, for pausing a page between the click and the result.
let loads = 0;
function renderItems(items) {
  const list = $('#items');
  list.replaceChildren(...items.map(item => Object.assign(document.createElement('li'), { textContent: item.name + ' · ' + item.price })));
  set('#load-box', items.length + ' items loaded');
}
async function loadItems(e) {
  const run = ++loads;
  set('#load-box', 'Loading…', false);
  const res = await fetch('/api/items?run=' + run);
  const data = await res.json();
  renderItems(data.items);
  log('items loaded', e);
}
$('#load').addEventListener('click', loadItems);
`;

const card = (id, title, hint, extra = '', cls = '') =>
  `<div class="box ${cls}" id="${id}"><h3 class="md-typescale-title-medium">${title}</h3>${extra}<div class="state md-typescale-body-medium">${hint}</div></div>`;

const LAB = page('Gesture lab', [
  card('tap', 'Tap target', 'Tap or click', '<md-ripple></md-ripple>'),
  card('dtap', 'Double tap', 'Tap twice quickly', '<md-ripple></md-ripple>'),
  card('lp', 'Long press', 'Hold for 0.6 s'),
  card('pinch', 'Pinch area', 'Pinch, or Ctrl + wheel', '<div class="zoom">🔍</div>'),
  card('strip-box', 'Swipe strip', 'Swipe, scroll or drag sideways', `<div class="strip" id="strip">${cards}</div>`, 'wide'),
  `<div class="box"><h3 class="md-typescale-title-medium">Drag me</h3><div id="drag" draggable="true" class="md-typescale-label-large">Box</div></div>`,
  card('drop', 'Drop here', 'Drop the box here'),
  card('btn-box', 'Click', '0 clicks', '<div><md-filled-button id="btn">Click</md-filled-button></div>'),
  card('dbl', 'Double click', 'Double click here'),
  card('ctx', 'Right click', 'Right click for a menu'),
  card('hover', 'Hover', 'Point at this'),
  card('scr', 'Scroll inside', 'Scroll this box', '<div style="flex:none;height:500px"></div>'),
  card('name-box', 'Type', 'Hello, …', '<md-outlined-text-field id="name" label="Name"></md-outlined-text-field>'),
  card('form-box', 'Search (Enter)', 'Type and press Enter', '<md-outlined-text-field id="query" label="Search" type="search"></md-outlined-text-field>'),
  card('size-box', 'Select', 'Size S', `<md-outlined-select id="size" label="Size">${['S', 'M', 'L'].map((v, i) =>
    `<md-select-option value="${v}"${i ? '' : ' selected'}><div slot="headline">${v}</div></md-select-option>`).join('')}</md-outlined-select>`),
  card('agree-box', 'Checkbox', 'Unchecked', '<label class="check md-typescale-body-large"><md-checkbox id="agree" touch-target="wrapper"></md-checkbox>I agree</label>'),
  card('vol-box', 'Slider', 'Volume 20', '<md-slider id="vol" min="0" max="100" value="20" labeled></md-slider>'),
  card('dlg-box', 'Dialog', 'Closed', '<div><md-outlined-button id="open-dlg">Open dialog</md-outlined-button></div>'),
  card('keys-box', 'Shortcut', 'Press Ctrl+K'),
  card('tabs-box', 'New tabs', 'Opens /next in a new tab or a popup window', '<div class="row"><md-outlined-button id="newtab-link" href="/next?via=link" target="_blank">Link</md-outlined-button>'
    + '<md-outlined-button id="newtab-open">window.open</md-outlined-button><md-outlined-button id="newtab-popup">Popup</md-outlined-button></div>', 'wide'),
  card('load-box', 'Load data', 'Nothing loaded', '<div><md-outlined-button id="load">Load items</md-outlined-button></div><ul id="items" class="md-typescale-body-medium"></ul>', 'wide'),
  `<md-dialog id="dlg"><div slot="headline">Confirm</div><div slot="content">A modal dialog.</div>
    <div slot="actions"><md-text-button id="dlg-ok">OK</md-text-button></div></md-dialog>`,
  `<span id="menu-anchor"></span><md-menu id="menu" anchor="menu-anchor" positioning="fixed">
    <md-menu-item data-v="Copy"><div slot="headline">Copy</div></md-menu-item>
    <md-menu-item data-v="Delete"><div slot="headline">Delete</div></md-menu-item></md-menu>`,
].join('\n'), LAB_SCRIPT);

const NEXT = page('Next page', card('second', 'Second page', 'For recordings that span pages.', '', 'wide'));

const ITEMS = [['Caster', '12.40'], ['Wheel', '8.90'], ['Bracket', '3.20'], ['Axle', '5.75']].map(([name, price]) => ({ name, price }));

// Static pages and one small JSON answer (GET/HEAD). Any host name is accepted: the real-input check reaches
// the lab through a *.nip.io name to test a host that is not allowed yet.
export function labHandler(q, r) {
  if (q.method !== 'GET' && q.method !== 'HEAD') { r.writeHead(405); return r.end(); }
  const p = new URL(q.url, 'http://x').pathname;
  if (FILES[p]) {
    const [file, type] = FILES[p];
    r.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    return q.method === 'HEAD' ? r.end() : fs.createReadStream(file).pipe(r);
  }
  if (p === '/api/items') {
    r.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (q.method === 'HEAD') return r.end();
    return void setTimeout(() => r.end(JSON.stringify({ items: ITEMS })), 300);
  }
  if (p !== '/' && p !== '/next') { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(q.method === 'HEAD' ? undefined : p === '/next' ? NEXT : LAB);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = +(process.argv[2] || LAB_PORT);
  http.createServer(labHandler).listen(port, '127.0.0.1', () => console.log(`lab on http://localhost:${port}/`));
}
