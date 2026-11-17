// Shared by the service worker and the side panel. config.json is edited by hand; reload the
// extension (or restart the demo browser) after changing it.
let configP = null;

export function loadConfig() {
  configP ||= fetch(chrome.runtime.getURL('config.json')).then(r => r.json()).catch(() => ({}))
    .then(c => ({
      bridgeUrl: c.bridgeUrl || 'ws://127.0.0.1:47613/ext',
      allowlist: Array.isArray(c.allowlist) ? c.allowlist : ['localhost', '*.dev.local'],
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
