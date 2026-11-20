// Test page for show-and-tell: every element reacts to real mouse, touch and keyboard input (and to the
// skill's scripted actions), and a log at the bottom lists what happened, trusted or synthetic.
// node scripts/lab.mjs [port]  → http://localhost:5191/  (and /next for a second page)
import http from 'node:http';

const port = +(process.argv[2] || process.env.LAB_PORT || 5191);
// Enough cards to overflow the strip even on very wide screens.
const cards = Array.from({ length: 20 }, (_, i) => `<div class="card" data-n="${i + 1}">Product ${i + 1}</div>`).join('');

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}
/* Sideways swipes and wheels stay in the page instead of triggering Chrome's back/forward gesture. */
html,body{overscroll-behavior:none}
body{font:16px "Segoe UI",system-ui,sans-serif;margin:0;background:#f6f7fb;color:#1a1b21}
header{background:#0b57d0;color:#fff;padding:14px 28px;font-size:20px;display:flex;gap:24px;align-items:center}
header a{color:#fff}
main{padding:24px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.box{min-width:0;background:#fff;border-radius:12px;padding:16px;min-height:96px;box-shadow:0 1px 3px #0003;user-select:none;touch-action:none;position:relative}
.box h3{margin:0 0 6px;font-size:15px}.state{font-size:14px;color:#45464f}.ok{background:#e6f4ea}
.wide{grid-column:span 2}
.strip{display:flex;gap:12px;overflow-x:auto;padding:4px;scroll-behavior:auto;touch-action:pan-x}
.card{flex:none;width:130px;height:80px;border-radius:10px;background:#d3e3fd;display:grid;place-items:center}
#drag{width:110px;height:56px;border-radius:10px;background:#0b57d0;color:#fff;display:grid;place-items:center;cursor:grab;position:relative;z-index:2}
#drop{min-height:96px;border:2px dashed #8e918f}#drop.over{border-color:#0b57d0;background:#e8f0fe}
#pinch{overflow:hidden}#pinch .zoom{transform-origin:center;transition:transform .05s;font-size:28px;text-align:center;padding-top:6px}
#hover:hover{background:#ffe08a}
#scr{height:120px;overflow:auto;touch-action:pan-y}
#menu{position:fixed;display:none;background:#fff;border-radius:8px;box-shadow:0 2px 8px #0004;padding:6px 0;z-index:9}
#menu div{padding:6px 16px;cursor:pointer}#menu div:hover{background:#eee}
input,select,button{font:inherit}input[type=text]{padding:6px;width:100%}
#log{grid-column:1/-1;background:#1a1b21;color:#e3e2e9;border-radius:12px;padding:12px 16px;font:12px/18px ui-monospace,Consolas,monospace;height:150px;overflow:auto}
dialog{border:0;border-radius:16px;padding:24px;box-shadow:0 4px 16px #0005}
</style></head><body><header><b>Gesture lab</b>${title === 'Next page' ? '<a href="/" id="back-link">← Back to the lab</a>' : '<a href="/next" id="next-link">Next page →</a>'}</header>
<main>${body}<div id="log"></div></main><div id="menu"><div data-v="Copy">Copy</div><div data-v="Delete">Delete</div></div>
<script>
const $ = s => document.querySelector(s);
const log = (what, e) => { const l = $('#log'); const d = document.createElement('div');
  d.textContent = new Date().toLocaleTimeString() + '  ' + what + (e ? (e.isTrusted ? '  [trusted]' : '  [synthetic]') : '');
  l.append(d); l.scrollTop = l.scrollHeight; window.__lab = window.__lab || []; window.__lab.push({ what, trusted: !!e?.isTrusted, event: !!e }); };
const set = (sel, text, ok = true) => { const s = $(sel + ' .state'); if (s) s.textContent = text; if (ok) $(sel).classList.add('ok'); };
${title === 'Next page' ? '' : LAB_SCRIPT}
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
strip.addEventListener('scroll', () => { const first = [...strip.children].find(c => c.offsetLeft + c.offsetWidth > strip.scrollLeft + 4);
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
const menu = $('#menu');
$('#ctx').addEventListener('contextmenu', e => { e.preventDefault(); Object.assign(menu.style, { display: 'block', left: e.clientX + 'px', top: e.clientY + 'px' }); set('#ctx', 'Menu open', false); log('right click', e); });
menu.addEventListener('click', e => { const v = e.target.dataset.v; if (!v) return; menu.style.display = 'none'; set('#ctx', 'Chose ' + v); log('menu: ' + v, e); });
addEventListener('pointerdown', e => { if (!menu.contains(e.target)) menu.style.display = 'none'; }, true);
$('#hover').addEventListener('mouseenter', e => { set('#hover', 'Hovered'); log('hover', e); });
// Scroll inside a box.
let scrLog = 0;
$('#scr').addEventListener('scroll', () => { set('#scr', 'Scrolled to ' + Math.round($('#scr').scrollTop) + ' px'); clearTimeout(scrLog); scrLog = setTimeout(() => log('box scrolled to ' + Math.round($('#scr').scrollTop)), 200); });
// Typing, a form that submits on Enter, select, checkbox, slider, dialog.
$('#name').addEventListener('input', e => set('#name-box', 'Hello, ' + ($('#name').value || '…')));
$('#name').addEventListener('change', e => log('name changed to "' + $('#name').value + '"', e));
$('#form').addEventListener('submit', e => { e.preventDefault(); set('#form-box', 'Searched for "' + $('#query').value + '"'); log('form submitted', e); });
$('#size').addEventListener('change', e => { set('#size-box', 'Size ' + $('#size').value); log('select: ' + $('#size').value, e); });
$('#agree').addEventListener('change', e => { set('#agree-box', $('#agree').checked ? 'Checked' : 'Unchecked'); log('checkbox ' + $('#agree').checked, e); });
$('#vol').addEventListener('input', e => set('#vol-box', 'Volume ' + $('#vol').value));
$('#vol').addEventListener('change', e => log('slider ' + $('#vol').value, e));
$('#open-dlg').addEventListener('click', e => { $('#dlg').showModal(); log('dialog opened', e); });
$('#dlg-ok').addEventListener('click', e => { $('#dlg').close(); set('#dlg-box', 'Dialog confirmed'); log('dialog confirmed', e); });
addEventListener('keydown', e => { if (e.key === 'k' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); set('#keys-box', 'Ctrl+K pressed'); log('shortcut Ctrl+K', e); } });
`;

const LAB = page('Gesture lab', `
<div class="box" id="tap"><h3>Tap target</h3><div class="state">Tap or click</div></div>
<div class="box" id="dtap"><h3>Double tap</h3><div class="state">Tap twice quickly</div></div>
<div class="box" id="lp"><h3>Long press</h3><div class="state">Hold for 0.6 s</div></div>
<div class="box" id="pinch"><h3>Pinch area</h3><div class="state">Pinch, or Ctrl + wheel</div><div class="zoom">🔍</div></div>
<div class="box wide" id="strip-box"><h3>Swipe strip</h3><div class="strip" id="strip">${cards}</div><div class="state">Swipe, scroll or drag sideways</div></div>
<div class="box"><h3>Drag me</h3><div id="drag" draggable="true">Box</div></div>
<div class="box" id="drop"><h3>Drop here</h3><div class="state">Drop the box here</div></div>
<div class="box" id="btn-box"><h3>Click</h3><button id="btn">Click</button><div class="state">0 clicks</div></div>
<div class="box" id="dbl"><h3>Double click</h3><div class="state">Double click here</div></div>
<div class="box" id="ctx"><h3>Right click</h3><div class="state">Right click for a menu</div></div>
<div class="box" id="hover"><h3>Hover</h3><div class="state">Point at this</div></div>
<div class="box" id="scr"><h3>Scroll inside</h3><div class="state">Scroll this box</div><div style="height:500px"></div></div>
<div class="box" id="name-box"><h3>Type</h3><input type="text" id="name" placeholder="Name"><div class="state">Hello, …</div></div>
<div class="box" id="form-box"><h3>Search (Enter)</h3><form id="form"><input type="text" id="query" placeholder="Search"></form><div class="state">Type and press Enter</div></div>
<div class="box" id="size-box"><h3>Select</h3><select id="size"><option>S</option><option>M</option><option>L</option></select><div class="state">Size S</div></div>
<div class="box" id="agree-box"><h3>Checkbox</h3><label><input type="checkbox" id="agree"> I agree</label><div class="state">Unchecked</div></div>
<div class="box" id="vol-box"><h3>Slider</h3><input type="range" id="vol" min="0" max="100" value="20"><div class="state">Volume 20</div></div>
<div class="box" id="dlg-box"><h3>Dialog</h3><button id="open-dlg">Open dialog</button><div class="state">Closed</div></div>
<div class="box" id="keys-box"><h3>Shortcut</h3><div class="state">Press Ctrl+K</div></div>
<dialog id="dlg"><p>A modal dialog.</p><button id="dlg-ok">OK</button></dialog>`);

const NEXT = page('Next page', '<div class="box wide"><h3>Second page</h3><div class="state">For recordings that span pages.</div></div>');

http.createServer((q, r) => {
  const p = new URL(q.url, 'http://x').pathname;
  if (p !== '/' && p !== '/next') { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(p === '/next' ? NEXT : LAB);
}).listen(port, '127.0.0.1', () => console.log(`lab on http://localhost:${port}/`));
