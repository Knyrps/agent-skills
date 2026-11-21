// Test page for show-and-tell: every element reacts to real mouse, touch and keyboard input (and to the
// skill's scripted actions), and a log at the bottom lists what happened, trusted or synthetic. It is built
// like a Material 3 Expressive app (Lit + @m3e/web), so the controls live in shadow DOM the way they do in
// real apps. Its source is ui-src/src/lab/, built to lab-vendor/lab.js; this file only serves it.
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
  '/lab.js': [path.join(here, 'lab-vendor', 'lab.js'), 'text/javascript'],
  '/m3-tokens.css': [path.join(here, '..', 'extension', 'vendor', 'm3-tokens.css'), 'text/css'],
  '/favicon.svg': [path.join(here, '..', 'extension', 'icons', 'icon.svg'), 'image/svg+xml'],
};

// The page is one element; `m3e-theme` gives motion and shape, the tokens file the colours (the class repeats
// them inside the theme element, which would otherwise set its own).
const page = (title, name) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="/favicon.svg">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/m3-tokens.css">
<script type="module" src="/lab.js"></script>
</head><body>
<m3e-theme motion="expressive" strong-focus><sat-lab-page class="m3-tokens" page="${name}"></sat-lab-page></m3e-theme>
</body></html>`;

const LAB = page('Gesture lab', 'lab');
const NEXT = page('Next page', 'next');

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
