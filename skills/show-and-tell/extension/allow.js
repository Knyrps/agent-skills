// Shared by the service worker and the side panel. config.json holds the defaults; config.local.json
// (git-ignored, optional) adds allowlisted hosts and video branding for this machine. Restart the demo
// browser after editing either.
let configP = null;

const read = file => fetch(chrome.runtime.getURL(file)).then(r => (r.ok ? r.json() : {})).catch(() => ({}));

export function loadConfig() {
  configP ||= Promise.all([read('config.json'), read('config.local.json')]).then(([c, local]) => ({
    bridgeUrl: local.bridgeUrl || c.bridgeUrl || 'ws://127.0.0.1:47613/ext',
    allowlist: [...(Array.isArray(c.allowlist) ? c.allowlist : ['localhost', '*.dev.local']),
      ...(Array.isArray(local.allowlist) ? local.allowlist : [])],
    // { name, logo (file in extension/, e.g. "local/logo.svg"), accent (CSS colour), footer }
    branding: { ...(c.branding || {}), ...(local.branding || {}) },
  }));
  return configP;
}

// Patterns are host names; "*.example" matches example and every subdomain of it.
export function hostAllowed(url, allowlist) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return allowlist.some(p => {
    p = String(p).toLowerCase().trim();
    if (p.startsWith('*.')) { const base = p.slice(2); return host === base || host.endsWith('.' + base); }
    return host === p;
  });
}

export const pageKey = url => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return ''; } };
