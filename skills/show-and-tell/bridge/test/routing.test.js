// Panel input goes to the session that drove the browser last, and only to its watcher.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-bridge-'));
process.env.DEMO_DATA = data;
process.env.DEMO_BRIDGE_PORT = String(47700 + Math.floor(Math.random() * 200));
const { startOwner, call, EXT_ID, PORT } = await import('../core.js');
const { WsConn } = await import('../ws.js');

let server, ext;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The extension side: a WebSocket from the extension's origin.
function connectExt() {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/ext', headers: { Connection: 'Upgrade', Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), Origin: `chrome-extension://${EXT_ID}` } });
    req.on('upgrade', (_res, socket) => resolve(new WsConn(socket, { mask: true })));
    req.on('error', reject);
    req.end();
  });
}
const send = text => ext.send(JSON.stringify({ type: 'action', id: crypto.randomUUID(), action: { type: 'question', text, ts: Date.now() } }));
const wait = (session, timeout = 2) => call('GET', `/wait?timeout=${timeout}${session ? `&session=${session}&label=${session}` : ''}`);

before(async () => {
  server = await startOwner();
  ext = await connectExt();
  ext.on('message', m => { const x = JSON.parse(m); if (x.rid) ext.send(JSON.stringify({ type: 'result', rid: x.rid, ok: true })); });
});
after(() => { ext.close(); server.close(); server.closeAllConnections?.(); fs.rmSync(data, { recursive: true, force: true }); });

test('without an owner the first waiting session takes the input and becomes the owner', async () => {
  const a = wait('alpha');
  await sleep(50);
  send('hi');
  assert.equal((await a).actions[0].text, 'hi');
  assert.equal((await call('GET', '/status')).owner.session, 'alpha');
});

test('input goes only to the owner; other watchers keep waiting', async () => {
  await call('POST', '/claim', { session: 'beta', label: 'repo-b' });
  const a = wait('alpha', 1), b = wait('beta');
  await sleep(50);
  send('for beta');
  assert.equal((await b).actions[0].text, 'for beta');
  const ra = await a;
  assert.equal(ra.actions.length, 0);
  assert.equal(ra.timeout, true);
});

test('driving the browser claims it; input waits until the owner listens', async () => {
  await call('POST', '/cmd', { cmd: 'state', session: 'gamma' }); // reading state does not claim
  assert.equal((await call('GET', '/status')).owner.session, 'beta');
  await call('POST', '/cmd', { cmd: 'hideOverlays', hidden: false, session: 'gamma', sessionLabel: 'repo-g' });
  const s = await call('GET', '/status');
  assert.deepEqual(s.owner, { session: 'gamma', label: 'repo-g' });
  send('queued');
  await sleep(100);
  assert.equal((await call('GET', '/status')).queued, 1);
  assert.equal((await wait('gamma')).actions[0].text, 'queued');
});

test('delivered input stays readable for an hour', async () => {
  const q = await call('GET', '/queue?recent=1');
  assert.ok(q.recent.some(a => a.text === 'queued'));
  assert.equal(q.recent.every(a => !('deliveredAt' in a)), true);
});

test('cancel can target one session', async () => {
  const g = wait('gamma', 5), d = wait('delta', 5);
  await sleep(50);
  assert.equal((await call('POST', '/cancel', { session: 'delta' })).cancelled, 1);
  assert.equal((await d).cancelled, true);
  await call('POST', '/cancel', {});
  assert.equal((await g).cancelled, true);
});
