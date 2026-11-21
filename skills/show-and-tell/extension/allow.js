// Shared by the service worker, the side panel and the bridge. config.json holds the defaults;
// config.local.json (git-ignored, optional) adds allowed hosts and video branding for this machine.
// Hosts on this machine (loopback) are always allowed; the bridge adds the hosts file's loopback names
// and the hosts the user allowed from the panel.
let configP = null;

const read = file => fetch(chrome.runtime.getURL(file)).then(r => (r.ok ? r.json() : {})).catch(() => ({}));

// config.local.json changes on disk when the user allows or takes back a host: read it again after that.
export const reloadConfig = () => { configP = null; };

export function loadConfig() {
  configP ||= Promise.all([read('config.json'), read('config.local.json')]).then(([c, local]) => ({
    bridgeUrl: local.bridgeUrl || c.bridgeUrl || 'ws://127.0.0.1:47613/ext',
    allowlist: [...(Array.isArray(c.allowlist) ? c.allowlist : ['localhost']),
      ...(Array.isArray(local.allowlist) ? local.allowlist : [])],
    // { name, logo (file in extension/, e.g. "local/logo.svg"), accent (CSS colour), footer }
    branding: { ...(c.branding || {}), ...(local.branding || {}) },
  }));
  return configP;
}

// localhost, *.localhost, 127.0.0.0/8 and ::1 (with or without brackets).
export function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(h) || h === '::1';
}

// Patterns are host names; "*.example" matches example and every subdomain of it.
export function hostAllowed(url, allowlist) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (isLoopbackHost(host)) return true;
  return allowlist.some(p => {
    p = String(p).toLowerCase().trim();
    if (p.startsWith('*.')) { const base = p.slice(2); return host === base || host.endsWith('.' + base); }
    return host === p;
  });
}

export const pageKey = url => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return ''; } };
