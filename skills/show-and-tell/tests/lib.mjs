// Helpers for testing a throwaway copy of show-and-tell on its own ports (bridge 47713, CDP 9434, lab 47714),
// so a running browser of the real skill is never touched. run.mjs makes the copy.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SKILL, ENV, sleep } from './lib-paths.mjs';
export * from './lib-paths.mjs';
export const LAB = 'http://localhost:47714/';
export const CDP = 'http://127.0.0.1:9434';
export const BRIDGE = 'http://127.0.0.1:47713';
const BR = pathToFileURL(path.join(SKILL, 'bridge')).href + '/';
const { Client } = await import(BR + 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
const { StdioClientTransport } = await import(BR + 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');

const results = [];
export const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + String(detail).replace(/\s+/g, ' ').slice(0, 400) : ''}`); };
export const summary = () => console.log(`\n${results.filter(Boolean).length} of ${results.length} passed`);
export const show = (label, v) => console.log(`--- ${label}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);

// An agent: the bridge's MCP server as a child process, like a harness would run it.
export async function agent(cwdName = 'agent-a') {
  const cwd = path.join(ROOT, cwdName);
  (await import('node:fs')).mkdirSync(cwd, { recursive: true });
  const c = new Client({ name: 'x', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(SKILL, 'bridge', 'index.js')], cwd, env: ENV, stderr: 'ignore' }));
  const txt = r => (r.content || []).map(x => x.text || '').join('\n');
  const tool = async (n, a = {}) => txt(await c.callTool({ name: n, arguments: a }, undefined, { timeout: 180000 }));
  const sid = /--session (\S+)/.exec(await tool('status'))?.[1];
  // What the session's watcher would receive.
  const wait = async (sec = 5) => { const r = await fetch(`${BRIDGE}/wait?session=${sid}&timeout=${sec}`, { headers: { 'x-show-and-tell': '1' } }); const j = await r.json(); return r.ok ? (j.actions || []).map(({ id, ts, ...a }) => a) : `HTTP ${r.status} ${JSON.stringify(j)}`; };
  return { c, tool, sid, wait, close: () => c.close() };
}

// Prepended to every expression a test runs in a page: $d / $$d find elements through open shadow roots too,
// since the panel and the test page are built from web components (ids live inside their shadow roots).
export const DEEP = `const $d = (s, r = document) => { const f = r.querySelector(s); if (f) return f; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) { const x = $d(s, e.shadowRoot); if (x) return x; } return null; };
const $$d = (s, r = document, out = []) => { out.push(...r.querySelectorAll(s)); for (const e of r.querySelectorAll('*')) if (e.shadowRoot) $$d(s, e.shadowRoot, out); return out; };
const shown = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';`;

export async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), events = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)?.(m.result ?? { error: m.error }); pend.delete(m.id); } else events.push(m); };
  const send = (method, params = {}) => new Promise(r => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async e => { const r = await Promise.race([send('Runtime.evaluate', { expression: `(() => { ${DEEP}\nreturn (${e}); })()`, returnByValue: true, awaitPromise: true }), sleep(4000).then(() => { throw new Error('NO ANSWER (page paused?)'); })]); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result?.value; };
  return { send, ev, events, close: () => ws.close() };
}
export const targets = async () => (await fetch(CDP + '/json/list')).json();
export async function page(match) {
  let t = null;
  for (let i = 0; i < 40 && !t; i++) { t = (await targets()).find(t => t.type === 'page' && match(t.url)); if (!t) await sleep(200); }
  if (!t) throw new Error('no such page');
  const s = await cdp(t.webSocketDebuggerUrl);
  const pos = sel => s.ev(`(() => { const e = $d(${JSON.stringify(sel)}); if (!e) throw new Error('no ' + ${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  // Real mouse input; not awaited to the end, because a page that pauses in the handler never answers.
  const click = async sel => { const [x, y] = await pos(sel); await sleep(150);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(100); };
  return { ...s, t, pos, click };
}
export const panel = async () => { const s = await page(u => u.endsWith('/panel.html')); return { ...s, P: s.ev }; };
