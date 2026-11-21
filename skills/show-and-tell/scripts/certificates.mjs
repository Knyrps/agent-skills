// Which certificate errors the shared browser accepts. It holds the user's sign-ins, so a bad certificate on
// a real site must stop it like it stops any Chrome. Local dev servers use self-signed certificates, though, and
// Playwright's --ignore-https-errors does not reach a browser it only attaches to over CDP. So:
// - localhost and loopback addresses: Chrome's own --allow-insecure-localhost.
// - names the hosts file maps to loopback (app.local, …): their certificate, read at start-up on port 443 and on
//   the ports in config "httpsPorts", is trusted by its public key (--ignore-certificate-errors-spki-list).
//   A dev server started later, or with a new certificate, needs a browser restart.
// - "ignoreCertificateErrors": true in config.local.json brings back the old flag for every site, for setups
//   the above does not cover; it is the user's choice, never the agent's.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { createHosts } from '../bridge/hosts.js';

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

// The base64 SHA-256 of a server's public key (SPKI), or null when nothing answers with TLS there.
export function spkiOf(host, port, ms = 800) {
  return new Promise(resolve => {
    const done = v => { clearTimeout(t); s.destroy(); resolve(v); };
    const s = tls.connect({ host: '127.0.0.1', port, servername: host, rejectUnauthorized: false }, () => {
      try { done(crypto.createHash('sha256').update(s.getPeerX509Certificate().publicKey.export({ type: 'spki', format: 'der' })).digest('base64')); }
      catch { done(null); }
    });
    s.on('error', () => done(null));
    const t = setTimeout(() => done(null), ms);
  });
}

export async function certificateFlags(extDir) {
  const cfg = { ...readJson(path.join(extDir, 'config.json')), ...readJson(path.join(extDir, 'config.local.json')) };
  if (cfg.ignoreCertificateErrors === true) return ['--ignore-certificate-errors'];
  const ports = [443, ...(Array.isArray(cfg.httpsPorts) ? cfg.httpsPorts.map(Number).filter(n => n > 0 && n < 65536) : [])];
  const names = createHosts({ extDir }).state().loopback.filter(n => !n.includes('*') && n !== 'localhost');
  const keys = new Set((await Promise.all(names.flatMap(n => ports.map(p => spkiOf(n, p))))).filter(Boolean));
  return ['--allow-insecure-localhost', ...(keys.size ? [`--ignore-certificate-errors-spki-list=${[...keys].join(',')}`] : [])];
}
