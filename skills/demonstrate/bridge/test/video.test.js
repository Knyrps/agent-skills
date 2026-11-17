import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defragment } from '../mp4.js';
import { vttTime, chapterTime, toVtt, toChapters, safeName } from '../core.js';
import { captionPages, pageMs, stepTiming, pickSize, estimateMs } from '../../extension/video-plan.js';

// ---- a synthetic fragmented MP4 shaped like Chrome's MediaRecorder output
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); };
const full = (type, v, f, ...parts) => box(type, u32((v << 24) | f), ...parts);
const zeros = n => Buffer.alloc(n);

const MDTS = 90000, DUR = 3000;
function fragment(seq, t, payloads) {
  const make = offset => box('moof', full('mfhd', 0, 0, u32(seq)), box('traf',
    full('tfhd', 0, 0x020000, u32(1)), full('tfdt', 1, 0, u64(t)),
    full('trun', 0, 0x205, u32(payloads.length), u32(offset), u32(0x02000000), ...payloads.map(p => u32(p.length)))));
  const moof = make(make(0).length + 8);
  return Buffer.concat([moof, box('mdat', ...payloads)]);
}
function fragmentedMp4() {
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isomiso6mp41'));
  const stbl = box('stbl', full('stsd', 0, 0, u32(0)), full('stts', 0, 0, u32(0)), full('stsc', 0, 0, u32(0)),
    full('stsz', 0, 0, u32(0), u32(0)), full('stco', 0, 0, u32(0)));
  const trak = box('trak', full('tkhd', 0, 3, zeros(8), u32(1), zeros(4), u32(0), zeros(60)),
    box('mdia', full('mdhd', 0, 0, zeros(8), u32(MDTS), u32(0), zeros(4)), full('hdlr', 0, 0, zeros(4), Buffer.from('vide'), zeros(13)),
      box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(0))), stbl)));
  const moov = box('moov', full('mvhd', 0, 0, zeros(8), u32(1000), u32(0), zeros(80)), trak,
    box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(DUR), u32(0), u32(0x10000))));
  const p = i => Buffer.alloc(10 + i, 65 + i);
  // The second fragment starts 1500 ticks late: a recorder pause that the timeline has to keep.
  return { file: Buffer.concat([ftyp, moov, fragment(1, 0, [p(0), p(1), p(2)]), fragment(2, 3 * DUR + 1500, [p(3), p(4)])]),
    payload: Buffer.concat([0, 1, 2, 3, 4].map(p)) };
}

function findBox(buf, type, s = 0, e = buf.length) {
  for (let o = s; o + 8 <= e;) {
    const size = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8);
    if (t === type) return buf.subarray(o, o + size);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(t)) { const r = findBox(buf, type, o + 8, o + size); if (r) return r; }
    o += size;
  }
  return null;
}
const table = (b, at, n, width) => Array.from({ length: n }, (_, i) => b.readUInt32BE(at + i * 4 * width));

test('defragment builds full sample tables and copies the samples in order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp4-'));
  const { file, payload } = fragmentedMp4();
  fs.writeFileSync(path.join(dir, 'in.mp4'), file);
  const r = defragment(path.join(dir, 'in.mp4'), path.join(dir, 'out.mp4'));
  const out = fs.readFileSync(path.join(dir, 'out.mp4'));
  fs.rmSync(dir, { recursive: true });

  assert.equal(r.remuxed, true);
  assert.deepEqual(r.samples, [5]);
  assert.equal(r.durationMs, Math.round((5 * DUR + 1500) / MDTS * 1000));
  assert.equal(findBox(out, 'mvex'), null);
  assert.equal(findBox(out, 'moof'), null);
  assert.equal(findBox(out, 'mvhd').readUInt32BE(24), Math.round((5 * DUR + 1500) / MDTS * 1000));
  assert.equal(findBox(out, 'mdhd').readUInt32BE(24), 5 * DUR + 1500);

  const stts = findBox(out, 'stts');
  assert.deepEqual([stts.readUInt32BE(12), ...table(stts, 16, 3 * 2, 1)], [3, 2, DUR, 1, DUR + 1500, 2, DUR]);
  const stss = findBox(out, 'stss');
  assert.deepEqual(table(stss, 16, stss.readUInt32BE(12), 1), [1, 4]);
  const stsz = findBox(out, 'stsz');
  assert.deepEqual(table(stsz, 20, 5, 1), [10, 11, 12, 13, 14]);
  const stco = findBox(out, 'stco');
  const offsets = table(stco, 16, stco.readUInt32BE(12), 1);
  assert.equal(offsets.length, 2);
  const mdat = findBox(out, 'mdat');
  assert.equal(offsets[0], out.indexOf(mdat) + 8);
  assert.equal(offsets[1], offsets[0] + 10 + 11 + 12);
  assert.ok(mdat.subarray(8).equals(payload));
});

test('defragment copies a file that is not fragmented', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp4-'));
  const plain = Buffer.concat([box('ftyp', Buffer.from('isom'), u32(0)), box('moov', full('mvhd', 0, 0, zeros(96))), box('mdat', zeros(4))]);
  fs.writeFileSync(path.join(dir, 'in.mp4'), plain);
  assert.equal(defragment(path.join(dir, 'in.mp4'), path.join(dir, 'out.mp4')).remuxed, false);
  assert.ok(fs.readFileSync(path.join(dir, 'out.mp4')).equals(plain));
  fs.rmSync(dir, { recursive: true });
});

test('caption pages keep whole sentences and stay short', () => {
  assert.deepEqual(captionPages(''), []);
  assert.deepEqual(captionPages('One. Two!'), ['One. Two!']);
  const long = 'This sentence is long enough to need its own page on the screen of the video. '.repeat(3);
  const pages = captionPages(long);
  assert.ok(pages.length >= 3);
  assert.ok(pages.every(p => p.length <= 140 && p.endsWith('.')));
  const huge = captionPages('word '.repeat(80).trim());
  assert.ok(huge.every(p => p.length <= 140));
  assert.equal(huge.join(' '), 'word '.repeat(80).trim());
});

test('reading time grows with words and respects pace and dwell', () => {
  assert.equal(pageMs('Hi'), 2500);
  assert.equal(pageMs('word '.repeat(100)), 10000);
  assert.ok(pageMs('one two three four five six seven eight nine ten', 2) > pageMs('one two three four five six seven eight nine ten'));
  const t = stepTiming({ explanation: 'First sentence here. Second one.' });
  assert.equal(t.times.reduce((a, b) => a + b, 0), t.total);
  const d = stepTiming({ explanation: 'First sentence here. Second one.', dwell: 9000 });
  assert.equal(d.total, 9000);
  assert.ok(Math.abs(d.times.reduce((a, b) => a + b, 0) - 9000) <= 1);
  assert.deepEqual(stepTiming({ explanation: 'x', caption: false }).pages, []);
  assert.equal(stepTiming({}).total, 2500);
  assert.ok(estimateMs({ steps: [{}, { video: false }] }) >= 2500);
});

test('pickSize takes the largest preset that fits the screen 1:1', () => {
  // 1536x960 DIP screen at 125 % next to a side panel: 1080p and 900p do not fit, 720p does.
  assert.deepEqual(pickSize('auto', 1.25, { width: 1100, height: 780 }),
    { width: 1280, height: 720, viewport: { width: 1024, height: 576 }, scaled: false });
  assert.deepEqual(pickSize('auto', 1, { width: 2400, height: 1300 }).viewport, { width: 1920, height: 1080 });
  const forced = pickSize('1080p', 1.25, { width: 1100, height: 780 });
  assert.equal(forced.scaled, true);
  assert.ok(forced.viewport.width <= 1100 && forced.viewport.height <= 780);
  assert.deepEqual([pickSize('1001x601', 1, { width: 5000, height: 5000 }).width, pickSize('1001x601', 1, { width: 5000, height: 5000 }).height], [1000, 600]);
});

test('subtitle and chapter formatting', () => {
  assert.equal(vttTime(3723456), '01:02:03.456');
  assert.equal(chapterTime(65000), '1:05');
  assert.equal(chapterTime(3723456), '1:02:03');
  assert.equal(toVtt([{ start: 0, end: 1500, text: 'a --> b' }]), 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\na → b\n');
  assert.equal(toChapters([{ t: 0, title: 'Intro' }, { t: 61000, title: 'Next' }]), '0:00 Intro\n1:01 Next\n');
  assert.equal(safeName('Kunden: Übersicht / v2'), 'Kunden-Ubersicht-v2');
  assert.match(safeName(''), /^demo-\d{8}-\d{6}$/);
});
