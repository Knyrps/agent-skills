// Shown instead of Chrome's error page while nothing serves the test page; switches to it once the bridge
// (which serves it) runs. Only loopback addresses are followed.
import { isLoopbackHost } from './allow.js';

const target = (() => {
  try {
    const u = new URL(new URLSearchParams(location.search).get('u') || '');
    return u.protocol === 'http:' && isLoopbackHost(u.hostname) ? u.href : null;
  } catch { return null; }
})();

async function poll() {
  if (!target) return;
  try {
    await fetch(target, { method: 'HEAD', cache: 'no-store' });
    location.replace(target);
  } catch { setTimeout(poll, 2000); }
}
poll();
