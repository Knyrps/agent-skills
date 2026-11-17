// Minimal RFC 6455 WebSocket (text frames, ping/pong, close) so the bridge needs no ws package.
// Server side: the extension connects to us. Client side: we talk CDP to Edge.
import crypto from 'node:crypto';
import http from 'node:http';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WsConn extends EventEmitter {
  constructor(socket, { mask }) {
    super();
    this.socket = socket;
    this.mask = mask; // clients must mask, servers must not
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.#parse(); });
    socket.on('close', () => this.#closed());
    socket.on('error', () => this.#closed());
  }

  send(str) { this.#frame(0x1, Buffer.from(str)); }
  close() { if (this.open) { this.#frame(0x8, Buffer.alloc(0)); this.socket.end(); } this.#closed(); }

  #closed() { if (this.open) { this.open = false; this.emit('close'); } }

  #frame(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
    const out = Buffer.alloc(head + (this.mask ? 4 : 0) + len);
    out[0] = 0x80 | op;
    if (len < 126) out[1] = len;
    else if (len < 65536) { out[1] = 126; out.writeUInt16BE(len, 2); }
    else { out[1] = 127; out.writeBigUInt64BE(BigInt(len), 2); }
    if (this.mask) {
      out[1] |= 0x80;
      const key = crypto.randomBytes(4);
      key.copy(out, head);
      for (let i = 0; i < len; i++) out[head + 4 + i] = payload[i] ^ key[i & 3];
    } else payload.copy(out, head);
    this.socket.write(out);
  }

  #parse() {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const keyOff = off; if (masked) off += 4;
      if (b.length < off + len) return;
      const data = Buffer.from(b.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) data[i] ^= b[keyOff + (i & 3)];
      this.buf = b.subarray(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.#frame(0xA, data); continue; }
      if (op === 0xA) continue;
      this.parts.push(data);
      if (fin) { const msg = Buffer.concat(this.parts).toString(); this.parts = []; this.emit('message', msg); }
    }
  }
}

// Complete a server-side upgrade. Returns the connection, or null if the request was rejected.
export function acceptUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const conn = new WsConn(socket, { mask: false });
  if (head?.length) socket.emit('data', head);
  return conn;
}

export function rejectUpgrade(socket, status = '403 Forbidden') {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function connectWs(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') },
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('WebSocket connect timeout')); }, timeoutMs);
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      const conn = new WsConn(socket, { mask: true });
      if (head?.length) socket.emit('data', head);
      resolve(conn);
    });
    req.on('response', res => { clearTimeout(timer); reject(new Error('WebSocket upgrade refused: ' + res.statusCode)); });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

// Tiny CDP session over one target's WebSocket.
export async function cdpSession(wsUrl) {
  const ws = await connectWs(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.on('message', m => {
    const msg = JSON.parse(m);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  ws.on('close', () => { for (const p of pending.values()) p.reject(new Error('CDP closed')); pending.clear(); });
  return {
    send(method, params = {}, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const n = ++id;
        const t = setTimeout(() => { pending.delete(n); reject(new Error(method + ' timed out')); }, timeoutMs);
        pending.set(n, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    },
    close: () => ws.close(),
  };
}
