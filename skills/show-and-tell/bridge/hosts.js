// Which hosts the shared browser may be used on. Allowed without asking: this machine (localhost,
// loopback addresses, and names the hosts file points at loopback, read live). Everything else needs the
// user: a pattern in extension/config(.local).json, or a grant from the side panel ("This session" in
// memory, "Always" appended to config.local.json). The agent can only trigger the question.
import fs from 'node:fs';
import path from 'node:path';
import { hostAllowed, isLoopbackHost } from '../extension/allow.js';

const SYSTEM_HOSTS = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts';

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

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };

export function createHosts({ extDir, hostsFile = process.env.DEMO_HOSTS_FILE || SYSTEM_HOSTS } = {}) {
  const base = path.join(extDir, 'config.json'), local = path.join(extDir, 'config.local.json');
  const granted = new Set();
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

  // Everything the extension needs to decide on its own, pushed to it whenever it changes.
  function state() {
    const list = f => (Array.isArray(readJson(f).allowlist) ? readJson(f).allowlist.map(String) : []);
    // saved: what the user granted with "Always" (config.local.json); the panel lists it with the session grants to take back.
    return { allow: [...new Set([...list(base), ...list(local)])], saved: list(local), loopback: loopback(), granted: [...granted] };
  }

  function check(url) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, host: '', error: `not a URL: ${url}` }; }
    if (u.href === 'about:blank') return { ok: true, host: '' };
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, host: '', error: `only http(s) pages: ${url}` };
    const host = u.hostname.toLowerCase(), s = state();
    if (isLoopbackHost(host)) return { ok: true, host, reason: 'loopback' };
    if (hostAllowed(u.href, s.loopback)) return { ok: true, host, reason: 'hosts file' };
    if (hostAllowed(u.href, s.allow)) return { ok: true, host, reason: 'config' };
    if (granted.has(host)) return { ok: true, host, reason: 'this session' };
    return { ok: false, host };
  }

  // mode: "session" (until the bridge restarts) or "always" (written to config.local.json).
  function grant(host, mode) {
    host = String(host || '').toLowerCase().trim();
    if (!/^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/.test(host)) throw new Error('bad host ' + host);
    granted.add(host);
    if (mode !== 'always') return;
    const cfg = readJson(local);
    const list = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];
    if (!list.includes(host)) fs.writeFileSync(local, JSON.stringify({ ...cfg, allowlist: [...list, host] }, null, 2) + '\n');
  }

  // Takes a grant back: from this session and from config.local.json. Patterns in config.json are shared, not the user's.
  function revoke(host) {
    host = String(host || '').toLowerCase().trim();
    granted.delete(host);
    const cfg = readJson(local);
    if (Array.isArray(cfg.allowlist) && cfg.allowlist.includes(host)) fs.writeFileSync(local, JSON.stringify({ ...cfg, allowlist: cfg.allowlist.filter(h => h !== host) }, null, 2) + '\n');
  }

  return { check, grant, revoke, state };
}
