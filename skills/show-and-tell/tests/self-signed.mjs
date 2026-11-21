// A self-signed certificate made here, so a test can serve HTTPS without openssl, a package or a key in the repo.
// It is deliberately untrusted: no authority signed it. names go into the certificate's subjectAltName.
import crypto from 'node:crypto';

const der = (tag, ...parts) => {
  const body = Buffer.concat(parts), n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
};
const seq = (...p) => der(0x30, ...p);
const oid = hex => der(0x06, Buffer.from(hex, 'hex'));
const utc = d => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;

export function selfSigned(names = ['localhost']) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecdsaSha256 = seq(oid('2a8648ce3d040302'));
  const name = seq(der(0x31, seq(oid('550403'), der(0x0c, Buffer.from(names[0])))));
  const day = 86400000, now = Date.now();
  const san = seq(oid('551d11'), der(0x04, seq(...names.map(n => der(0x82, Buffer.from(n))))));
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // version 3
    der(0x02, Buffer.concat([Buffer.from([1]), crypto.randomBytes(8)])), // serial
    ecdsaSha256, name, seq(utc(new Date(now - day)), utc(new Date(now + 30 * day))), name,
    publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, seq(san)));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, ecdsaSha256, der(0x03, Buffer.from([0]), sig));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', cert) };
}
