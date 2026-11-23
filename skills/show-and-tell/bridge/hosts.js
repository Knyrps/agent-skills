// Which hosts the shared browser may be used on. Allowed without asking: this machine (localhost, loopback
// addresses, and names the hosts file points at loopback, read live). Every other host needs the user's click
// in the side panel. Those grants are kept by the extension, inside the browser ("This session" until it
// restarts, "Always" in its storage); it tells the bridge over its authenticated socket, and what it said last
// is all the bridge knows. No file grants a host, so nothing an agent can edit does. The agent can only ask.
import fs from 'node:fs';
import path from 'node:path';
import { hostAllowed, isLoopbackHost } from '../extension/allow.js';

const SYSTEM_HOSTS = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts';
const HOST = /^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/;

// Names (exact, or "*.x" wildcards some resolvers accept) that the hosts file maps to a loopback address.
export function loopbackNames(text) {
  const names = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const [ip, ...rest] = raw.replace(/#.*/, '').trim().split(/\s+/);
    if (!ip || !rest.length || !isLoopbackHost(ip)) continue;
    for (const n of rest) names.add(n.toLowerCase());
  }
  return [...names].sort();
}

const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };

export function createHosts({ hostsFile = process.env.DEMO_HOSTS_FILE || SYSTEM_HOSTS } = {}) {
  let granted = new Set();
  let cache = { key: '', loopback: [] };

  function loopback() {
    const key = String(mtime(hostsFile));
    if (key !== cache.key) {
      let text = '';
      try { text = fs.readFileSync(hostsFile, 'utf8'); } catch {}
      cache = { key, loopback: loopbackNames(text) };
    }
    return cache.loopback;
  }

  // What the extension needs from this side: only the hosts file's names, which a browser cannot read.
  const state = () => ({ loopback: loopback() });

  function check(url) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, host: '', error: `not a URL: ${url}` }; }
    if (u.href === 'about:blank') return { ok: true, host: '' };
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, host: '', error: `only http(s) pages: ${url}` };
    const host = u.hostname.toLowerCase();
    if (isLoopbackHost(host)) return { ok: true, host, reason: 'loopback' };
    if (hostAllowed(u.href, loopback())) return { ok: true, host, reason: 'hosts file' };
    if (granted.has(host)) return { ok: true, host, reason: 'allowed by the user' };
    return { ok: false, host };
  }

  const clean = list => (Array.isArray(list) ? list : []).map(h => String(h || '').toLowerCase().trim()).filter(h => HOST.test(h));
  // The extension's whole list, replacing what was known: a host it no longer names is no longer allowed.
  function setGranted(list) { granted = new Set(clean(list)); }
  // One more host, right after the user's answer came back over the socket (the full list follows).
  function add(host) { for (const h of clean([host])) granted.add(h); }

  return { check, state, setGranted, add, granted: () => [...granted] };
}
