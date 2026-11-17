// Turns the fragmented MP4 that Chrome's MediaRecorder writes (moov without sample tables, then
// moof+mdat pairs) into a regular MP4: one moov with full sample tables and durations, then one mdat.
// Many players (Windows Media Foundation, Explorer, QuickTime) read duration and seek index from the
// moov only, and show a wrong length or cannot seek in the fragmented form.
import fs from 'node:fs';

const MiB = 2 ** 20;

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let n = 0;
  while (n < len) { const r = fs.readSync(fd, b, n, len - n, pos + n); if (!r) break; n += r; }
  return b.subarray(0, n);
}

function topBoxes(fd, size) {
  const out = [];
  for (let pos = 0; pos + 8 <= size;) {
    const h = readAt(fd, pos, 16);
    let len = h.readUInt32BE(0), head = 8;
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); head = 16; } else if (len === 0) len = size - pos;
    if (len < head || pos + len > size) throw new Error(`corrupt MP4: box "${h.toString('latin1', 4, 8)}" at ${pos}`);
    out.push({ type: h.toString('latin1', 4, 8), start: pos, size: len, head });
    pos += len;
  }
  return out;
}

// The child boxes of a box held in `buf` (the box itself starts at 0).
function children(buf, from = 8) {
  const out = [];
  for (let o = from; o + 8 <= buf.length;) {
    let len = buf.readUInt32BE(o), head = 8;
    if (len === 1) { len = Number(buf.readBigUInt64BE(o + 8)); head = 16; } else if (len === 0) len = buf.length - o;
    if (len < head) throw new Error('corrupt MP4 child box');
    out.push({ type: buf.toString('latin1', o + 4, o + 8), data: buf.subarray(o, o + len) });
    o += len;
  }
  return out;
}
const child = (buf, type) => children(buf).find(c => c.type === type)?.data;

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const box = (type, ...parts) => {
  const body = Buffer.concat(parts.map(p => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)));
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
};
const fullBox = (type, version, flags, ...parts) => box(type, u32((version << 24) | flags), ...parts);

// mvhd/mdhd: timescale and duration; tkhd: track id and duration. Offsets depend on the box version.
const timescaleOf = b => b.readUInt32BE(b[8] ? 28 : 20);
const trackIdOf = tkhd => tkhd.readUInt32BE(tkhd[8] ? 28 : 20);
function withDuration(b, duration) {
  const c = Buffer.from(b), v = c[8];
  const at = c.toString('latin1', 4, 8) === 'tkhd' ? (v ? 36 : 28) : (v ? 32 : 24);
  if (v) c.writeBigUInt64BE(BigInt(duration), at); else c.writeUInt32BE(Math.min(duration, 0xffffffff), at);
  return c;
}

function rle(values) {
  const out = [];
  for (const v of values) { const last = out[out.length - 1]; if (last && last[1] === v) last[0]++; else out.push([1, v]); }
  return out;
}

function parseFragments(fd, boxes, tracks) {
  for (const top of boxes.filter(b => b.type === 'moof')) {
    const moof = readAt(fd, top.start, top.size);
    for (const { type, data: traf } of children(moof)) {
      if (type !== 'traf') continue;
      const tfhd = child(traf, 'tfhd');
      const tf = tfhd.readUInt32BE(8) & 0xffffff;
      const track = tracks.get(tfhd.readUInt32BE(12));
      if (!track) throw new Error('fragment for an unknown track');
      let o = 16, base = top.start;
      if (tf & 0x1) { base = Number(tfhd.readBigUInt64BE(o)); o += 8; }
      if (tf & 0x2) o += 4;
      let dDur = track.trex.duration, dSize = track.trex.size, dFlags = track.trex.flags;
      if (tf & 0x8) { dDur = tfhd.readUInt32BE(o); o += 4; }
      if (tf & 0x10) { dSize = tfhd.readUInt32BE(o); o += 4; }
      if (tf & 0x20) { dFlags = tfhd.readUInt32BE(o); o += 4; }
      const tfdt = child(traf, 'tfdt');
      if (tfdt) {
        const t = tfdt[8] ? Number(tfdt.readBigUInt64BE(12)) : tfdt.readUInt32BE(12);
        if (track.samples.length) {
          // Keep the timeline the fragments describe: a gap or overlap goes into the previous sample.
          const last = track.samples[track.samples.length - 1];
          last.d = Math.max(1, last.d + t - track.dts);
        } else track.start = t;
        track.dts = t;
      }
      let pos = base;
      for (const { type: rt, data: trun } of children(traf)) {
        if (rt !== 'trun') continue;
        const v = trun[8], f = trun.readUInt32BE(8) & 0xffffff, count = trun.readUInt32BE(12);
        let p = 16, first = null;
        if (f & 0x1) { pos = base + trun.readInt32BE(p); p += 4; }
        if (f & 0x4) { first = trun.readUInt32BE(p); p += 4; }
        const run = { src: pos, bytes: 0, count };
        for (let i = 0; i < count; i++) {
          const d = f & 0x100 ? trun.readUInt32BE((p += 4) - 4) : dDur;
          const s = f & 0x200 ? trun.readUInt32BE((p += 4) - 4) : dSize;
          let fl = f & 0x400 ? trun.readUInt32BE((p += 4) - 4) : dFlags;
          if (i === 0 && first !== null) fl = first;
          const c = f & 0x800 ? (v ? trun.readInt32BE((p += 4) - 4) : trun.readUInt32BE((p += 4) - 4)) : 0;
          track.samples.push({ d, s, sync: !(fl & 0x10000), c });
          track.dts += d;
          run.bytes += s;
        }
        pos += run.bytes;
        if (count) { run.track = track; track.runs.push(run); }
      }
    }
  }
}

function sampleTable(track, offsets, co64) {
  const s = track.samples;
  const parts = [child(track.stbl, 'stsd')];
  const stts = rle(s.map(x => x.d));
  parts.push(fullBox('stts', 0, 0, u32(stts.length), ...stts.flatMap(([n, d]) => [u32(n), u32(d)])));
  if (s.some(x => x.c)) {
    const neg = s.some(x => x.c < 0), ctts = rle(s.map(x => x.c));
    parts.push(fullBox('ctts', neg ? 1 : 0, 0, u32(ctts.length), ...ctts.flatMap(([n, c]) => [u32(n), neg ? i32(c) : u32(c)])));
  }
  if (!s.every(x => x.sync)) {
    const sync = s.flatMap((x, i) => (x.sync ? [i + 1] : []));
    parts.push(fullBox('stss', 0, 0, u32(sync.length), ...sync.map(u32)));
  }
  const stsc = [];
  track.runs.forEach((r, i) => { if (!stsc.length || stsc[stsc.length - 1][1] !== r.count) stsc.push([i + 1, r.count]); });
  parts.push(fullBox('stsc', 0, 0, u32(stsc.length), ...stsc.flatMap(([c, n]) => [u32(c), u32(n), u32(1)])));
  parts.push(fullBox('stsz', 0, 0, u32(0), u32(s.length), ...s.map(x => u32(x.s))));
  parts.push(co64 ? fullBox('co64', 0, 0, u32(offsets.length), ...offsets.map(u64))
    : fullBox('stco', 0, 0, u32(offsets.length), ...offsets.map(u32)));
  return box('stbl', ...parts);
}

function buildMoov(moov, tracks, mvts, offsetsOf, co64) {
  let movieDur = 0;
  const traks = [];
  for (const t of tracks.values()) {
    const mediaDur = t.samples.reduce((n, x) => n + x.d, 0);
    const dur = Math.round(mediaDur * mvts / t.mdts);
    movieDur = Math.max(movieDur, dur);
    const minf = box('minf', ...children(t.minf).map(c => (c.type === 'stbl' ? sampleTable(t, offsetsOf(t), co64) : c.data)));
    const mdia = box('mdia', ...children(t.mdia).map(c => (c.type === 'mdhd' ? withDuration(c.data, mediaDur) : c.type === 'minf' ? minf : c.data)));
    // B-frames shift presentation times; the edit list starts the track at its first presented frame.
    const lead = t.samples[0]?.c || 0;
    const edts = lead > 0 ? [box('edts', fullBox('elst', 0, 0, u32(1), u32(dur), u32(lead), u32(1 << 16)))] : [];
    traks.push(box('trak', ...children(t.trak).flatMap(c => (c.type === 'tkhd' ? [withDuration(c.data, dur), ...edts]
      : c.type === 'mdia' ? [mdia] : c.type === 'edts' ? [] : [c.data]))));
  }
  const rest = children(moov).filter(c => !['mvhd', 'trak', 'mvex'].includes(c.type)).map(c => c.data);
  return box('moov', withDuration(child(moov, 'mvhd'), movieDur), ...traks, ...rest);
}

export function defragment(src, dest) {
  const fd = fs.openSync(src, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const boxes = topBoxes(fd, size);
    const moovBox = boxes.find(b => b.type === 'moov');
    if (!moovBox) throw new Error('no moov box');
    const moov = readAt(fd, moovBox.start, moovBox.size);
    if (!boxes.some(b => b.type === 'moof')) { fs.copyFileSync(src, dest); return { remuxed: false }; }
    const mvts = timescaleOf(child(moov, 'mvhd'));
    const mvex = child(moov, 'mvex');
    const trex = new Map((mvex ? children(mvex) : []).filter(c => c.type === 'trex').map(({ data: b }) =>
      [b.readUInt32BE(12), { duration: b.readUInt32BE(20), size: b.readUInt32BE(24), flags: b.readUInt32BE(28) }]));
    const tracks = new Map();
    for (const { type, data: trak } of children(moov)) {
      if (type !== 'trak') continue;
      const id = trackIdOf(child(trak, 'tkhd')), mdia = child(trak, 'mdia'), minf = child(mdia, 'minf');
      tracks.set(id, { trak, mdia, minf, stbl: child(minf, 'stbl'), mdts: timescaleOf(child(mdia, 'mdhd')),
        trex: trex.get(id) || { duration: 0, size: 0, flags: 0 }, samples: [], runs: [], dts: 0, start: 0 });
    }
    parseFragments(fd, boxes, tracks);
    const runs = [...tracks.values()].flatMap(t => t.runs).sort((a, b) => a.src - b.src);
    const dataBytes = runs.reduce((n, r) => n + r.bytes, 0);
    const ftyp = box('ftyp', 'isom', u32(0x200), 'isom', 'iso2', 'avc1', 'mp41');
    const co64 = dataBytes + 64 * MiB > 0xffffffff;
    const mdatHead = dataBytes + 8 > 0xffffffff ? Buffer.concat([u32(1), Buffer.from('mdat'), u64(dataBytes + 16)])
      : Buffer.concat([u32(dataBytes + 8), Buffer.from('mdat')]);
    // Chunk offsets depend on the moov's size, which does not depend on the offsets' values.
    const sizing = buildMoov(moov, tracks, mvts, t => t.runs.map(() => 0), co64).length;
    const dataStart = ftyp.length + sizing + mdatHead.length;
    let at = dataStart;
    for (const r of runs) { r.dst = at; at += r.bytes; }
    const moovOut = buildMoov(moov, tracks, mvts, t => t.runs.map(r => r.dst), co64);
    const out = fs.openSync(dest, 'w');
    try {
      fs.writeSync(out, Buffer.concat([ftyp, moovOut, mdatHead]));
      const buf = Buffer.alloc(4 * MiB);
      for (const r of runs) {
        for (let done = 0; done < r.bytes;) {
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, r.bytes - done), r.src + done);
          if (!n) throw new Error('sample data ends early');
          fs.writeSync(out, buf, 0, n);
          done += n;
        }
      }
    } finally { fs.closeSync(out); }
    const durations = [...tracks.values()].map(t => t.samples.reduce((n, x) => n + x.d, 0) * 1000 / t.mdts);
    return { remuxed: true, durationMs: Math.round(Math.max(0, ...durations)), samples: [...tracks.values()].map(t => t.samples.length) };
  } finally { fs.closeSync(fd); }
}
