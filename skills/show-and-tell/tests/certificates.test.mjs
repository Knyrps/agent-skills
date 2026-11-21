// The shared browser accepts the certificates of this machine's dev hosts, and still refuses a bad one elsewhere.
// Needs no network: the test serves HTTPS itself with a certificate nobody signed, reached once as localhost and
// once under a name that is not this machine's (the test browser resolves it here, see lib-paths.mjs).
import https from 'node:https';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHosts } from '../bridge/hosts.js';
import { spkiOf } from '../scripts/certificates.mjs';
import { selfSigned } from './self-signed.mjs';
import { cdp, targets, check, summary, sleep, testHost, SKILL, ENV, CDP } from './lib.mjs';

const b = cmd => spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'browser.mjs'), cmd], { env: ENV, encoding: 'utf8' }).stdout;
b('stop'); await sleep(1000); b('start');

const browser = async () => cdp((await (await fetch(CDP + '/json/version')).json()).webSocketDebuggerUrl);
// Opens a page in a new tab, hands its session to `read`, and closes the tab again.
const inTab = async (url, read, ms = 4000) => {
  const br = await browser();
  const { targetId } = await br.send('Target.createTarget', { url });
  try {
    await sleep(ms);
    const t = (await targets()).find(x => x.id === targetId);
    const s = t && await cdp(t.webSocketDebuggerUrl);
    try { return s ? await read(s) : null; } finally { s?.close(); }
  } finally { await br.send('Target.closeTarget', { targetId }).catch(() => {}); br.close(); }
};
// Plain evaluation: chrome:// pages and error pages do not allow the eval that lib's `ev` wraps around.
const value = async (s, expression) => (await Promise.race([s.send('Runtime.evaluate', { expression, returnByValue: true }), sleep(3000).then(() => ({}))])).result?.value;

// The flags the browser really runs with, from its own chrome://version page (the same on every OS).
const args = String(await inTab('chrome://version', s => value(s, `document.getElementById('command_line')?.textContent || ''`), 1500) || '');
check('the browser\'s command line can be read', /--remote-debugging-port=9434/.test(args), args.slice(0, 200));
check('the browser no longer ignores every certificate error', !/--ignore-certificate-errors(?!-)/.test(args), args.slice(0, 200));
check('it accepts invalid certificates on localhost', /--allow-insecure-localhost/.test(args));

// An HTTPS server with an untrusted certificate. `served` holds the Host of every request that got through
// TLS: a page the browser refuses never sends one, whatever language its error page is in.
const other = testHost('bad-cert'), served = [];
const server = https.createServer(selfSigned(['localhost', other]), (q, r) => {
  served.push(String(q.headers.host).split(':')[0]);
  r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<title>served</title>ok');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const titleOf = url => inTab(url, s => value(s, 'document.title'));

const local = await titleOf(`https://localhost:${port}/`);
check('localhost with an untrusted certificate opens', local === 'served' && served.includes('localhost'), `title "${local}"`);
const bad = await titleOf(`https://${other}:${port}/`);
check('another site with an untrusted certificate is refused', bad !== 'served' && !served.includes(other), `title "${bad}", served ${JSON.stringify(served)}`);
server.close(); server.closeAllConnections?.();

// A dev host from the hosts file that serves HTTPS, if this machine has one.
const names = createHosts({ extDir: path.join(SKILL, 'extension') }).state().loopback.filter(n => !n.includes('*') && n !== 'localhost');
let dev = null; for (const n of names) if (await spkiOf(n, 443)) { dev = n; break; }
if (dev) {
  const t = await inTab(`https://${dev}/`, async s => ({ title: await value(s, 'document.title'), error: await value(s, `!!document.querySelector('#main-frame-error, .interstitial-wrapper')`) }));
  check(`a dev host with its own certificate opens (${dev})`, !!t && !t.error, JSON.stringify(t));
} else console.log('      (no HTTPS dev host in the hosts file; skipped)');
summary(); process.exit(0);
