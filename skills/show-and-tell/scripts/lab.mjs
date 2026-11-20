// Test page for show-and-tell: every element reacts to real mouse, touch and keyboard input (and to the
// skill's scripted actions), and a log at the bottom lists what happened, trusted or synthetic. It is built
// like a Material 3 app (M3 color tokens, type scale, Material Web components), so the controls live in
// shadow DOM the way they do in real apps.
// node scripts/lab.mjs [port]  → http://localhost:5191/  (and /next for a second page)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = {
  '/material-lab.js': [path.join(here, 'lab-vendor', 'material-lab.js'), 'text/javascript'],
  '/m3-tokens.css': [path.join(here, '..', 'extension', 'vendor', 'm3-tokens.css'), 'text/css'],
};
const port = +(process.argv[2] || process.env.LAB_PORT || 5191);
// Enough cards to overflow the strip even on very wide screens.
const cards = Array.from({ length: 20 }, (_, i) => `<div class="item md-typescale-label-large" data-n="${i + 1}">Product ${i + 1}</div>`).join('');

const page = (title, body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
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
#menu-anchor{position:fixed;width:0;height:0}
/* M3 terminal-style log on the inverse surface. */
#log{grid-column:1/-1;height:160px;overflow:auto;padding:12px 16px;border-radius:12px;
  background:var(--md-sys-color-inverse-surface);color:var(--md-sys-color-inverse-on-surface);font:12px/18px ui-monospace,Consolas,monospace}
</style></head><body>
<header><span class="md-typescale-title-large">${title}</span><span class="grow"></span>${title === 'Next page'
  ? '<a href="/" id="back-link" class="md-typescale-label-large">← Back to the lab</a>'
  : '<a href="/next" id="next-link" class="md-typescale-label-large">Next page →</a>'}</header>
<main>${body}<div id="log"></div></main>
<script type="module">
import '/material-lab.js';
const $ = s => document.querySelector(s);
// e: the DOM event behind the entry, or 'component' for an event a component fires itself (a select picking
// an option). Trusted input is the user's or the agent's: Playwright's input is as trusted as a person's.
// show-and-tell marks <html data-show-and-tell-agent> while the agent's browser call runs.
const byAgent = () => document.documentElement.hasAttribute('data-show-and-tell-agent');
// who: overrides who gets the credit (a field's change comes on blur, the value from whoever typed it).
const log = (what, e, who) => { const l = $('#log'); const d = document.createElement('div'), agent = who ? who === 'agent' : byAgent();
  d.textContent = new Date().toLocaleTimeString() + '  ' + what + (e === 'component' ? '  [component]' : e ? (!e.isTrusted ? '  [synthetic]' : agent ? '  [agent]' : '  [you]') : '');
  l.append(d); l.scrollTop = l.scrollHeight; window.__lab = window.__lab || []; window.__lab.push({ what, trusted: !!e?.isTrusted, agent, event: !!e && e !== 'component' }); };
const set = (sel, text, ok = true) => { const s = $(sel + ' .state'); if (s) s.textContent = text; if (ok) $(sel).classList.add('ok'); };
// Material components re-fire change as their own (untrusted) event; the native control inside has the real one.
const inner = async (sel, q = 'input') => { const h = $(sel); await customElements.whenDefined(h.localName); await h.updateComplete; return [...h.shadowRoot.querySelectorAll(q)].pop(); };
${script}
log('page loaded: ' + location.pathname);
</script></body></html>`;

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
$('#name').addEventListener('input', () => { typedBy = byAgent() ? 'agent' : 'you'; set('#name-box', 'Hello, ' + ($('#name').value || '…')); });
(await inner('#name')).addEventListener('change', e => log('name changed to "' + $('#name').value + '"', e, typedBy));
$('#query').addEventListener('keydown', e => { if (e.key !== 'Enter') return; e.preventDefault(); set('#form-box', 'Searched for "' + $('#query').value + '"'); log('search submitted', e); });
$('#size').addEventListener('change', () => { set('#size-box', 'Size ' + $('#size').value); log('select: ' + $('#size').value, 'component'); });
(await inner('#agree')).addEventListener('change', e => { set('#agree-box', $('#agree').checked ? 'Checked' : 'Unchecked'); log('checkbox ' + $('#agree').checked, e); });
$('#vol').addEventListener('input', () => set('#vol-box', 'Volume ' + $('#vol').value));
(await inner('#vol')).addEventListener('change', e => log('slider ' + $('#vol').value, e));
$('#open-dlg').addEventListener('click', e => { $('#dlg').show(); log('dialog opened', e); });
$('#dlg-ok').addEventListener('click', e => { $('#dlg').close(); set('#dlg-box', 'Dialog confirmed'); log('dialog confirmed', e); });
addEventListener('keydown', e => { if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); set('#keys-box', 'Ctrl+K pressed'); log('shortcut Ctrl+K', e); } });
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
  `<md-dialog id="dlg"><div slot="headline">Confirm</div><div slot="content">A modal dialog.</div>
    <div slot="actions"><md-text-button id="dlg-ok">OK</md-text-button></div></md-dialog>`,
  `<span id="menu-anchor"></span><md-menu id="menu" anchor="menu-anchor" positioning="fixed">
    <md-menu-item data-v="Copy"><div slot="headline">Copy</div></md-menu-item>
    <md-menu-item data-v="Delete"><div slot="headline">Delete</div></md-menu-item></md-menu>`,
].join('\n'), LAB_SCRIPT);

const NEXT = page('Next page', card('second', 'Second page', 'For recordings that span pages.', '', 'wide'));

http.createServer((q, r) => {
  const p = new URL(q.url, 'http://x').pathname;
  if (FILES[p]) {
    const [file, type] = FILES[p];
    r.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(r);
  }
  if (p !== '/' && p !== '/next') { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(p === '/next' ? NEXT : LAB);
}).listen(port, '127.0.0.1', () => console.log(`lab on http://localhost:${port}/`));
