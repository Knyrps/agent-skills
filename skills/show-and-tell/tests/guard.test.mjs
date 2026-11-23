// Checks of the host guard: only the user's click in the panel allows a host. Not a socket that merely claims to
// be the extension, not a file, not a page that moves on to another site or embeds one.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { agent, panel, page, check, summary, sleep, testHost, LAB, SKILL, BRIDGE } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?guard' });
const pn = await panel();
const J = s => { try { return JSON.parse(s); } catch { return { raw: s }; } };
const only = process.argv[2];
const run = async (name, fn) => { if (only && !only.split(',').includes(name)) return; console.log(`\n== ${name}`); try { await fn(); } catch (e) { check(name + ' ran through', false, e.stack); } };
const EXT = 'chrome-extension://jedpjgmldnhcfdejimlabhppmffdijei';
const WS = BRIDGE.replace('http', 'ws') + '/ext';
const local = (method, route, body, headers = {}) => new Promise(resolve => {
  const u = new URL(BRIDGE + route), data = body ? JSON.stringify(body) : null;
  const q = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...headers, ...(data && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }) } }, r => {
    let s = ''; r.on('data', d => { s += d; }); r.on('end', () => resolve({ status: r.statusCode, body: J(s) }));
  });
  q.on('error', e => resolve({ status: 0, body: { error: e.message } }));
  q.end(data || undefined);
});
// Every snapshot file Playwright wrote for the agent to read.
const OUT = path.join(SKILL, '..', 'data', 'playwright');
const written = () => fs.readdirSync(OUT).filter(f => f.endsWith('.yml')).map(f => fs.readFileSync(path.join(OUT, f), 'utf8'));
const hostCheck = host => local('POST', '/host/check', { url: `http://${host}:47714/` }, { 'x-show-and-tell': '1' }).then(r => r.body);
// Tries to open the extension's socket the way another program on this machine could.
const knock = (url, sendMsg) => new Promise(resolve => {
  let ws; try { ws = new WebSocket(url, { headers: { Origin: EXT } }); } catch (e) { return resolve('refused: ' + e.message); }
  const t = setTimeout(() => { try { ws.close(); } catch {} resolve('timeout'); }, 4000);
  ws.onopen = () => { if (sendMsg) ws.send(JSON.stringify(sendMsg)); setTimeout(() => { clearTimeout(t); ws.close(); resolve('open'); }, 500); };
  ws.onerror = () => { clearTimeout(t); resolve('refused'); };
});

await run('socket', async () => {
  const host = testHost('forged');
  check('a host nobody allowed is not allowed', (await hostCheck(host)).ok === false);
  const plain = await knock(WS, { type: 'hostState', always: [host], session: [host] });
  check('a socket that only claims the extension\'s origin is refused', plain === 'refused', plain);
  const wrong = await knock(WS + '?key=' + 'a'.repeat(64), { type: 'hostState', always: [host], session: [host] });
  check('so is one with a wrong key', wrong === 'refused', wrong);
  check('and the host is still not allowed', (await hostCheck(host)).ok === false, JSON.stringify(await hostCheck(host)));
  const video = await local('POST', '/video/open', { name: 'x' }, { Origin: EXT });
  check('the video upload needs the key too', video.status === 403, JSON.stringify(video));
  check('the real extension is connected with its key', (await local('GET', '/status', null, { 'x-show-and-tell': '1' })).body.extensionConnected === true);
});

await run('file', async () => {
  const host = testHost('file'), file = path.join(SKILL, 'extension', 'config.local.json');
  const before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(before), allowlist: [host, '*.show-and-tell.test'] }));
  await sleep(6000); // longer than the bridge takes to notice a changed file
  check('a host written into config.local.json is not allowed', (await hostCheck(host)).ok === false, JSON.stringify(await hostCheck(host)));
  const call = a.tool('highlight', { selector: 'body', url: `http://${host}:47714/plain` });
  let asked = false;
  for (let i = 0; i < 40 && !asked; i++) { await sleep(250); asked = await pn.P(`!!$d('#host-no')`); }
  check('the agent\'s call on it still asks the user', asked);
  // The question may still be rendering: answer until it is gone.
  for (let i = 0; i < 10 && await pn.P(`!!$d('#host-no')`); i++) { await sleep(600); await pn.P(`$d('#host-no')?.click()`); }
  const res = J(await Promise.race([call, sleep(15000).then(() => '{"timeout":true}')]));
  check('and is refused on No', /did not allow/.test(res.error || ''), JSON.stringify(res).slice(0, 200));
  fs.writeFileSync(file, before);
});

await run('moved', async () => {
  const host = testHost('moved');
  const r = await a.tool('browser_navigate', { url: LAB + 'redirect?to=' + encodeURIComponent(`http://${host}:47714/plain`) });
  check('a page that moves on to a site that is not allowed gives nothing away', /Not allowed: the page is now on moved-/.test(r) && !/Secret text|Plain page/.test(r), r.replace(/\s+/g, ' ').slice(0, 300));
  check('nor do the snapshot files Playwright wrote', !written().some(t => t.includes(`Secret text of ${host}`)), `${written().length} files`);
  const back = await a.tool('browser_navigate', { url: LAB + '?guard' });
  check('the agent can leave for an allowed page', /Gesture lab/.test(back) && !/Not allowed/.test(back), back.replace(/\s+/g, ' ').slice(0, 200));
});

await run('frames', async () => {
  const host = testHost('frame');
  await a.tool('browser_navigate', { url: LAB + 'embed?to=' + encodeURIComponent(`http://${host}:47714/plain`) }); await sleep(800);
  const snap = await a.tool('browser_snapshot');
  check('the page around an embedded site that is not allowed is readable', /Outer button/.test(snap), snap.replace(/\s+/g, ' ').slice(0, 300));
  check('the embedded site\'s content is withheld, and the result says why', !/Secret text|Inside button/.test(snap) && /content withheld/.test(snap) && snap.includes(`embeds ${host}`), snap.replace(/\s+/g, ' ').slice(-300));
  check('also in the snapshot files', !written().some(t => t.includes(`Secret text of ${host}`)) && written().some(t => /content withheld/.test(t)));
  const top = +(/"Outer button" \[ref=f(\d+)e\d+\]/.exec(snap) || [])[1];
  const guess = await a.tool('browser_click', { element: 'Inside button', target: `f${top + 1}e4`, ref: `f${top + 1}e4` });
  check('an element inside it cannot be used, even with a guessed ref', /Not allowed: that element is inside an embedded frame/.test(guess), guess.replace(/\s+/g, ' ').slice(0, 200));
  await a.tool('browser_navigate', { url: LAB + 'embed?to=' + encodeURIComponent('http://localhost:47714/plain') }); await sleep(800);
  const own = await a.tool('browser_snapshot');
  check('an embedded page of an allowed site stays readable', /Secret text/.test(own) && !/content withheld/.test(own), own.replace(/\s+/g, ' ').slice(0, 300));
  await a.tool('browser_navigate', { url: LAB + '?guard' });
});

summary();
await a.close(); process.exit(0);
