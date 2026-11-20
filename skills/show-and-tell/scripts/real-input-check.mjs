// End-to-end check with real input: CDP Input.* events, which pages receive as trusted, like a person's
// mouse, touch and keyboard. Covers every element of the lab page and every control of the side panel.
// Needs: the browser (node scripts/browser.mjs start), the bridge (an agent session or `node bridge serve`)
// and the lab (node scripts/lab.mjs). Run: node scripts/real-input-check.mjs
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAB = process.env.LAB_URL || 'http://localhost:5191/';
const CDP = 'http://127.0.0.1:' + (process.env.DEMO_CDP_PORT || 9334);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const cli = (...a) => new Promise(r => execFile(process.execPath, ['bridge', ...a], { cwd: SKILL, maxBuffer: 1e7 }, (e, o, err) => r((o || err || '').trim())));
const queue = async () => { try { return JSON.parse(await cli('queue')).actions || []; } catch { return []; } };

// Minimal CDP client with events.
async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(), listeners = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); }
    else for (const f of listeners) f(m); };
  return {
    send: (method, params = {}) => new Promise((r, j) => { const n = ++id; pend.set(n, { r, j }); ws.send(JSON.stringify({ id: n, method, params })); }),
    on: f => listeners.push(f), close: () => ws.close(),
  };
}
const targets = async () => (await fetch(CDP + '/json/list')).json();

function input(s) {
  const ev = async e => { const r = await s.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
  const at = async (sel, fx = .5, fy = .5) => { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center', behavior: 'instant' })`); await sleep(80);
    return ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width * ${fx}, r.top + r.height * ${fy}]; })()`); };
  // A move with a button held reports that button, as Chrome's own input does (needed to start a drag).
  const mouse = (type, x, y, o = {}) => s.send('Input.dispatchMouseEvent', { type, x, y, button: o.button || (o.buttons ? 'left' : 'none'), buttons: o.buttons ?? 0, clickCount: o.count || 0, modifiers: o.mod || 0, deltaX: o.dx || 0, deltaY: o.dy || 0 });
  const click = async (x, y, { button = 'left', count = 1 } = {}) => {
    await mouse('mouseMoved', x, y);
    for (let c = 1; c <= count; c++) { await mouse('mousePressed', x, y, { button, count: c, buttons: button === 'right' ? 2 : 1 }); await mouse('mouseReleased', x, y, { button, count: c }); }
  };
  const touch = (type, points) => s.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i })) });
  // Keys that produce a character (Enter: "\r") carry it, or Chrome does not run their default action.
  const key = (key, code, vk, mod = 0) => {
    const text = key === 'Enter' ? '\r' : key.length === 1 && !(mod & 2) ? key : undefined;
    return s.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mod, ...(text && { text, unmodifiedText: text }) })
      .then(() => s.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mod }));
  };
  const type = text => s.send('Input.insertText', { text });
  return { ev, at, mouse, click, touch, key, type };
}
const ENTER = ['Enter', 'Enter', 13], ESC = ['Escape', 'Escape', 27];

// ---------------------------------------------------------------- setup
let list = await targets();
let tgt = list.find(t => t.type === 'page' && t.url.startsWith(LAB)) || list.find(t => t.type === 'page' && /^(https?:|about:blank)/.test(t.url));
let P = await cdp(tgt.webSocketDebuggerUrl), p = input(P);
await P.send('Page.enable');
await P.send('Page.bringToFront');
await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const load = async url => { await P.send('Page.navigate', { url }); await sleep(1500);
  const at = await p.ev('location.href'); if (url === LAB && !at.startsWith(LAB)) throw new Error('the tab is on ' + at + ', not the lab'); };
await load(LAB);
const state = sel => p.ev(`document.querySelector('${sel} .state')?.textContent || ''`);
const panelT = (await targets()).find(t => t.url.endsWith('/panel.html'));
const S = await cdp(panelT.webSocketDebuggerUrl), q = input(S);
await S.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cli('queue'); // start with an empty queue

// ---------------------------------------------------------------- lab page: mouse
console.log('\n# Lab page, mouse and keyboard');
let [x, y] = await p.at('#tap'); await p.click(x, y);
check('tap (mouse click)', /Tapped 1/.test(await state('#tap')));
[x, y] = await p.at('#btn'); await p.click(x, y); await p.click(x, y);
check('button click ×2', /2 clicks/.test(await state('#btn-box')));
[x, y] = await p.at('#dbl'); await p.click(x, y, { count: 2 });
check('double click', /Double clicked/.test(await state('#dbl')));
[x, y] = await p.at('#ctx'); await p.click(x, y, { button: 'right' });
const menuOpen = await p.ev(`getComputedStyle(document.getElementById('menu')).display !== 'none'`);
[x, y] = await p.at('#menu [data-v="Delete"]'); await p.click(x, y);
check('right click opens the menu, choosing an item', menuOpen && /Chose Delete/.test(await state('#ctx')));
[x, y] = await p.at('#hover'); await p.mouse('mouseMoved', x - 30, y); await p.mouse('mouseMoved', x, y); await sleep(100);
check('hover', /Hovered/.test(await state('#hover')));
[x, y] = await p.at('#scr'); await p.mouse('mouseWheel', x, y, { dy: 240 }); await sleep(400);
check('wheel scroll inside a box', /Scrolled to [1-9]/.test(await state('#scr')));
[x, y] = await p.at('#strip'); await p.mouse('mouseWheel', x, y, { dx: 300 }); await sleep(300);
check('horizontal wheel on the strip', /in view: ([2-9]|1\d|20)$/.test(await state('#strip-box')));
await p.ev(`document.getElementById('strip').scrollLeft = 0`); await sleep(100);
[x, y] = await p.at('#strip', .8);
await p.mouse('mouseMoved', x, y); await p.mouse('mousePressed', x, y, { button: 'left', buttons: 1, count: 1 });
for (let i = 1; i <= 10; i++) await p.mouse('mouseMoved', x - 32 * i, y, { buttons: 1 });
await p.mouse('mouseReleased', x - 320, y, { button: 'left', count: 1 }); await sleep(300);
check('mouse drag scrolls the strip', /in view: ([2-9]|1\d|20)$/.test(await state('#strip-box')));
[x, y] = await p.at('#pinch'); await p.mouse('mouseWheel', x, y, { dy: -100, mod: 2 }); await sleep(100);
check('Ctrl + wheel zooms', /Zoom 1[1-9]\d%/.test(await state('#pinch')));
[x, y] = await p.at('#name'); await p.click(x, y); await p.type('Ada');
[x, y] = await p.at('#hover'); await p.click(x, y); // leaving the field fires change
check('typing into a field', /Hello, Ada/.test(await state('#name-box')) && (await p.ev(`__lab.some(e => e.what.startsWith('name changed') && e.trusted)`)));
[x, y] = await p.at('#query'); await p.click(x, y); await p.type('castors'); await p.key(...ENTER);
check('Enter submits a form', /Searched for "castors"/.test(await state('#form-box')));
await p.ev(`document.getElementById('size').focus()`); await p.key('ArrowDown', 'ArrowDown', 40); await sleep(100);
check('select with the keyboard', /Size M/.test(await state('#size-box')));
[x, y] = await p.at('#agree'); await p.click(x, y);
check('checkbox', /Checked/.test(await state('#agree-box')));
[x, y] = await p.at('#vol', .8, .5); await p.click(x, y);
check('slider click', /Volume (7\d|8\d)/.test(await state('#vol-box')), await state('#vol-box'));
[x, y] = await p.at('#open-dlg'); await p.click(x, y); await sleep(200);
[x, y] = await p.at('#dlg-ok'); await p.click(x, y);
check('modal dialog open and confirm', /confirmed/.test(await state('#dlg-box')));
await p.key('k', 'KeyK', 75, 2);
check('keyboard shortcut Ctrl+K', /Ctrl\+K pressed/.test(await state('#keys-box')));
// HTML5 drag and drop with the mouse: Chrome hands the drag to CDP, which drops it on the target.
await P.send('Input.setInterceptDrags', { enabled: true });
let dragData = null; P.on(m => { if (m.method === 'Input.dragIntercepted') dragData = m.params.data; });
const [dx0, dy0] = await p.at('#drag'), [tx, ty] = await p.at('#drop');
const [sx0, sy0] = await p.at('#drag');
await p.mouse('mouseMoved', sx0, sy0); await p.mouse('mousePressed', sx0, sy0, { button: 'left', buttons: 1, count: 1 });
for (let i = 1; i <= 6; i++) await p.mouse('mouseMoved', sx0 + (tx - sx0) * i / 6, sy0 + (ty - sy0) * i / 6, { buttons: 1 });
await sleep(200);
if (dragData) for (const type of ['dragEnter', 'dragOver', 'drop']) await P.send('Input.dispatchDragEvent', { type, x: tx, y: ty, data: dragData });
await p.mouse('mouseReleased', tx, ty, { button: 'left', count: 1 });
// An intercepted drag must be ended explicitly, or Chrome keeps treating input as part of it.
await P.send('Input.cancelDragging').catch(() => {});
await P.send('Input.setInterceptDrags', { enabled: false });
check('mouse drag and drop (HTML5)', /Dropped \(html5\)/.test(await state('#drop')), dragData ? '' : 'no drag started');
void dx0; void dy0;

// ---------------------------------------------------------------- lab page: touch
check('every mouse and keyboard event arrived as trusted input', await p.ev(`(window.__lab || []).filter(e => e.event).every(e => e.trusted)`));
console.log('\n# Lab page, touch');
// A fresh tab: CDP's intercepted drag above can leave the first tab treating new touches as part of an
// old sequence (only compatibility mouse events arrive). Touch emulation is on before the page loads.
const browserWs = (await (await fetch(CDP + '/json/version')).json()).webSocketDebuggerUrl;
const B = await cdp(browserWs);
const { targetId: touchTab } = await B.send('Target.createTarget', { url: 'about:blank' });
await sleep(500);
const firstP = P;
P = await cdp((await targets()).find(t => t.id === touchTab).webSocketDebuggerUrl); p = input(P);
await P.send('Page.enable');
await P.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await P.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await load(LAB);
const tap = async (x, y) => { await p.touch('touchStart', [[x, y]]); await p.touch('touchEnd', []); };
await p.ev(`window.__hits = []; for (const t of ['pointerdown', 'touchstart', 'mousedown']) addEventListener(t, e => __hits.push(t + ':' + (e.pointerType || '') + '@' + Math.round(e.clientX ?? e.touches?.[0]?.clientX) + ',' + Math.round(e.clientY ?? e.touches?.[0]?.clientY) + ' ' + (e.target.id || e.target.className)), true)`);
[x, y] = await p.at('#tap'); await tap(x, y);
check('tap (touch)', /Tapped 1/.test(await state('#tap')), `sent ${Math.round(x)},${Math.round(y)}; got ${await p.ev('JSON.stringify(__hits)')}; touch points ${await p.ev('navigator.maxTouchPoints')}`);
[x, y] = await p.at('#dtap'); await tap(x, y); await sleep(80); await tap(x, y);
check('double tap', /Double tapped/.test(await state('#dtap')));
[x, y] = await p.at('#lp'); await p.touch('touchStart', [[x, y]]); await sleep(800); await p.touch('touchEnd', []);
check('long press', /Long pressed/.test(await state('#lp')));
[x, y] = await p.at('#pinch');
await p.touch('touchStart', [[x - 10, y], [x + 10, y]]);
for (let i = 1; i <= 8; i++) await p.touch('touchMove', [[x - 10 - 6 * i, y], [x + 10 + 6 * i, y]]);
await p.touch('touchEnd', []);
check('two-finger pinch zooms', /Zoom (1[3-9]\d|2\d\d|300)%/.test(await state('#pinch')), await state('#pinch'));
[x, y] = await p.at('#strip', .8);
await p.touch('touchStart', [[x, y]]);
for (let i = 1; i <= 10; i++) { await p.touch('touchMove', [[x - 30 * i, y]]); await sleep(16); }
await p.touch('touchEnd', []); await sleep(600);
check('swipe scrolls the strip', /in view: ([2-9]|1\d|20)$/.test(await state('#strip-box')), await state('#strip-box'));
const [fx, fy] = await p.at('#drag'), [gx, gy] = await p.at('#drop');
await p.touch('touchStart', [[fx, fy]]);
for (let i = 1; i <= 8; i++) await p.touch('touchMove', [[fx + (gx - fx) * i / 8, fy + (gy - fy) * i / 8]]);
await p.touch('touchEnd', []);
check('touch drag and drop', /Dropped \(pointer\)/.test(await state('#drop')));
check('every touch event arrived as trusted input', await p.ev(`(window.__lab || []).filter(e => e.event).every(e => e.trusted)`));
await P.send('Emulation.setTouchEmulationEnabled', { enabled: false });
[x, y] = await p.at('#next-link'); await p.click(x, y); await sleep(1200);
const onNext = await p.ev('location.pathname');
[x, y] = await p.at('#back-link'); await p.click(x, y); await sleep(1200);
check('links between two pages', onNext === '/next' && (await p.ev('location.pathname')) === '/');
// Back to the first tab for the side panel.
P.close(); await B.send('Target.closeTarget', { targetId: touchTab }); B.close();
P = firstP; p = input(P); await P.send('Page.bringToFront'); await sleep(500);

// ---------------------------------------------------------------- side panel
console.log('\n# Side panel');
await load(LAB);
await S.send('Page.reload'); await sleep(1500);
const label = () => q.ev(`document.getElementById('annotate-label').textContent`);
const doneButton = async () => {
  const { root } = await P.send('DOM.getDocument', { depth: -1, pierce: true });
  const find = n => { if (n.attributes) for (let i = 0; i < n.attributes.length; i += 2) if (n.attributes[i] === 'data-act' && n.attributes[i + 1] === 'done') return n;
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) { const f = find(c); if (f) return f; } return null; };
  const n = find(root); if (!n) return null;
  const { model } = await P.send('DOM.getBoxModel', { nodeId: n.nodeId }); const b = model.content;
  return [(b[0] + b[4]) / 2, (b[1] + b[5]) / 2];
};
// Empty conversation: the suggestion chip puts the cursor in the message field.
await q.ev(`chrome.storage.session.set({ chats: {} })`); await sleep(400);
[x, y] = await q.at('#sug-ask'); await q.click(x, y);
check('suggestion chip "Ask a question" focuses the composer', await q.ev(`document.activeElement?.id === 'q'`));
check('Send is off while the composer is empty', await q.ev(`document.getElementById('send').disabled`));
// Annotate, then Esc pressed while the side panel has focus.
[x, y] = await q.at('#annotate'); await q.click(x, y); await sleep(700);
const started = !!(await doneButton());
check('Annotate starts annotating the page (button turns into Cancel)', started && (await label()) === 'Cancel');
await q.key(...ESC); await sleep(500);
check('Esc in the side panel cancels annotating', !(await doneButton()) && (await label()) === 'Annotate');
// Annotate, mark an element, Done in the page, then send with a message.
[x, y] = await q.at('#annotate'); await q.click(x, y); await sleep(700);
[x, y] = await p.at('#tap'); await p.click(x, y); await sleep(300);
await p.key(...ENTER); await sleep(200); // closes the note field if one opened
const done = await doneButton(); if (done) await p.click(...done);
await sleep(1500);
check('marking an element and Done attaches the annotation', /Annotation · 1/.test(await q.ev(`document.getElementById('annot-chip-text').label`)));
[x, y] = await q.at('#q'); await q.click(x, y); await q.type('Is this the right target?');
check('typing enables Send', !(await q.ev(`document.getElementById('send').disabled`)));
await q.key(...ENTER); await sleep(1200);
let acts = await queue();
const annot = acts.find(a => a.type === 'annotation');
check('Enter sends message and annotation', annot?.text === 'Is this the right target?' && annot.annotations?.length === 1);
check('the message shows in the conversation', /Is this the right target\?/.test(await q.ev(`document.getElementById('log').innerText`)));
// Record real clicks and typing, stop, send without text.
[x, y] = await q.at('#rec'); await q.click(x, y); await sleep(400);
[x, y] = await p.at('#btn'); await p.click(x, y);
[x, y] = await p.at('#name'); await p.click(x, y); await p.type('Grace'); await p.key('Tab', 'Tab', 9);
await sleep(500);
const recLabel = await q.ev(`document.getElementById('rec-label').textContent`);
check('Record counts the steps while recording', /Stop · [2-9] steps/.test(recLabel), recLabel);
[x, y] = await q.at('#rec'); await q.click(x, y); await sleep(500);
check('Stop attaches the recording', /Recording · \d+ steps/.test(await q.ev(`document.getElementById('rec-chip-text').label`)));
[x, y] = await q.at('#send'); await q.click(x, y); await sleep(1200);
acts = await queue();
const rec = acts.find(a => a.type === 'recording');
const kinds = rec ? rec.recording.steps.map(s => s.type) : [];
check('Send delivers the recording with click and change steps', kinds.includes('click') && kinds.includes('change'), kinds.join(','));
// Throttling: Turn off.
await cli('throttle', '3g', '--cpu', '4'); await sleep(500);
const throttled = await q.ev(`!document.getElementById('throttle').hidden`);
[x, y] = await q.at('#throttle-off'); await q.click(x, y); await sleep(600);
check('throttle line and Turn off', throttled && await q.ev(`document.getElementById('throttle').hidden`));
// Host question: No.
const pending = cli('highlight', 'h1', '--url', 'https://example.com/');
for (let i = 0; i < 30 && !(await q.ev(`!document.getElementById('host-ask').hidden`)); i++) await sleep(200);
[x, y] = await q.at('#host-no'); await q.click(x, y);
check('host question: No refuses the agent', /did not allow example\.com/.test(await pending));
// A page that is not allowed: allow it from the notice. Grants last until the browser restarts, so each
// run uses a new name that nip.io resolves to this machine (the lab again, but not a loopback name);
// without DNS for nip.io, public test sites that are not allowed yet.
const fresh = `http://lab-${Date.now().toString(36)}.127.0.0.1.nip.io:${new URL(LAB).port || 80}/`;
let notice = false, site = '';
for (site of [fresh, 'https://example.org/', 'https://example.net/', 'https://www.example.org/', 'https://www.example.net/']) {
  await load(site); await sleep(500);
  if ((notice = await q.ev(`!document.getElementById('notice').hidden`))) break;
}
if (notice) {
  [x, y] = await q.at('#allow-session'); await q.click(x, y); await sleep(600);
  check('notice on a page that is not allowed, and "Allow this session"', await q.ev(`document.getElementById('notice').hidden`), site);
} else check('notice on a page that is not allowed (restart the browser to reset grants)', false);
await load(LAB);
// Tour: Next and Back.
const tourFile = path.join(os.tmpdir(), 'sat-tour.json');
fs.writeFileSync(tourFile, JSON.stringify({ steps: [
  { title: 'Click', url: LAB, explanation: 'One.', highlights: [{ selector: '#btn', label: 'Here' }] },
  { title: 'Double click', explanation: 'Two.', highlights: [{ selector: '#dbl', label: 'There' }] }] }));
await cli('tour', tourFile); await sleep(2500);
const stepText = () => q.ev(`document.getElementById('step').textContent`);
const s1 = await stepText();
[x, y] = await q.at('#next'); await q.click(x, y); await sleep(1500);
const s2 = await stepText();
[x, y] = await q.at('#back'); await q.click(x, y); await sleep(2500);
check('tour Next and Back', /1\/2/.test(s1) && /2\/2/.test(s2) && /1\/2/.test(await stepText()), `${s1} → ${s2} → ${await stepText()}`);
await cli('end');
// Video: Discard during the countdown or recording.
await cli('queue');
await cli('record', tourFile, '--name', 'real-input-check'); await sleep(5000);
[x, y] = await q.at('#video-discard'); await q.click(x, y);
let discarded = false;
for (let i = 0; i < 40 && !discarded; i++) { await sleep(500); discarded = (await queue()).some(a => a.type === 'videoDiscarded'); }
check('video Discard', discarded);

// ---------------------------------------------------------------- summary
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
await cli('clear');
P.close(); S.close();
process.exit(failed.length ? 1 : 0);
