// The shared browser accepts the certificates of this machine's dev hosts, and still refuses a bad one elsewhere.
import fs from 'node:fs';
import { createHosts } from '../bridge/hosts.js';
import { spkiOf } from '../scripts/certificates.mjs';
import { page, cdp, check, summary, sleep, SKILL, CDP } from './lib.mjs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENV } from './lib.mjs';
const b = cmd => spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'browser.mjs'), cmd], { env: ENV, encoding: 'utf8' }).stdout;
b('stop'); await sleep(1000); b('start');
const args = String(spawnSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? { $_.CommandLine -match '--remote-debugging-port=9434' -and $_.CommandLine -notmatch '--type=' } | select -First 1).CommandLine`], { encoding: 'utf8' }).stdout);
check('the browser no longer ignores every certificate error', !/--ignore-certificate-errors(?!-)/.test(args), args.slice(0, 200));
check('it accepts invalid certificates on localhost', /--allow-insecure-localhost/.test(args));
const open = async url => {
  const v = await (await fetch(CDP + '/json/version')).json(), br = await cdp(v.webSocketDebuggerUrl);
  const { targetId } = await br.send('Target.createTarget', { url }); await sleep(4000);
  const p = await page(u => u.startsWith(url.replace(/\/$/, '')) || u.includes('chrome-error'), 5000).catch(() => null);
  const title = p ? await p.ev('document.title').catch(() => '?') : '?';
  await br.send('Target.closeTarget', { targetId }); br.close(); return title;
};
// A dev host from the hosts file that serves HTTPS, if this machine has one.
const names = createHosts({ extDir: path.join(SKILL, 'extension') }).state().loopback.filter(n => !n.includes('*') && n !== 'localhost');
let dev = null; for (const n of names) if (await spkiOf(n, 443)) { dev = n; break; }
if (dev) { const t = await open(`https://${dev}/`); check(`a dev host with its own certificate opens (${dev})`, !/privacy error|not private/i.test(t), t); }
else console.log('      (no HTTPS dev host in the hosts file; skipped)');
const bad = await open('https://self-signed.badssl.com/');
check('a site on the internet with a bad certificate is refused', /privacy error/i.test(bad), bad);
summary(); process.exit(0);
