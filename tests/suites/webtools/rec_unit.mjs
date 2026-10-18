// Unit tests for the screen recorder: WebM duration patch on a real Chrome MediaRecorder file (checked with
// ffprobe), refusal on layouts it must not touch, MIME choice and the clock.  node tests/suites/webtools/rec_unit.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
globalThis.document = { documentElement: { lang: 'de' }, createElement: () => ({ append() {}, addEventListener() {}, setAttribute() {}, classList: { add() {} } }), head: { append() {} }, querySelector: () => null, createElementNS: () => ({ setAttribute() {}, append() {} }), createTextNode: () => ({}) };
globalThis.Node = class {};
const { patchWebmHead, withDuration } = await import('../../../network/assets/wt/lib/rec-webm.js');
const { pickMime, clock } = await import('../../../network/assets/wt/tools/screen-recorder.js');

let ok = 0, fail = 0;
const expect = (c, m) => { if (c) ok++; else { fail++; console.log('FAIL', m); } };
const dur = p => spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' }).stdout.trim();
mkdirSync('out', { recursive: true });

const src = readFileSync('fixtures_static/rec/chrome_nodur.webm');
expect(dur('fixtures_static/rec/chrome_nodur.webm') === 'N/A', 'fixture has no duration');
const r = patchWebmHead(new Uint8Array(src.subarray(0, 65536)), 2500);
expect(r && r.head.length === r.cut + 11 + (8 - 1), `patched head grows by Duration + 8-byte size (${r && r.head.length - r.cut})`);
writeFileSync('out/rec_fixed.webm', Buffer.concat([Buffer.from(r.head), src.subarray(r.cut)]));
expect(Math.abs(parseFloat(dur('out/rec_fixed.webm')) - 2.5) < 0.01, `duration 2.5 s after patch (${dur('out/rec_fixed.webm')})`);
expect(spawnSync('ffmpeg', ['-v', 'error', '-i', 'out/rec_fixed.webm', '-f', 'null', '-']).status === 0, 'patched file decodes');
// patching twice overwrites in place
const r2 = patchWebmHead(new Uint8Array(readFileSync('out/rec_fixed.webm').subarray(0, 65536)), 4000);
expect(r2 && r2.head.length === r2.cut, 'second patch overwrites in place');
// Blob path
const b = await withDuration(new Blob([src], { type: 'video/webm' }), 1234);
writeFileSync('out/rec_blob.webm', Buffer.from(await b.arrayBuffer()));
expect(Math.abs(parseFloat(dur('out/rec_blob.webm')) - 1.234) < 0.01, 'withDuration on a Blob');
expect(await withDuration(new Blob([src], { type: 'video/mp4' }), 1000) instanceof Blob, 'mp4 passes through');
// refuse what it must not touch
expect(patchWebmHead(new Uint8Array([1, 2, 3, 4]), 1000) === null, 'not EBML');
const withSeek = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x11, 0x4d, 0x9b, 0x74, 0x80]);
expect(patchWebmHead(withSeek, 1000) === null, 'SeekHead → untouched');
expect(patchWebmHead(new Uint8Array(src.subarray(0, 60)), 1000) === null, 'Info cut off → untouched');

// MIME choice + clock
const sup = list => t => list.includes(t);
expect(pickMime('mp4', sup(['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'])) === 'video/mp4;codecs=avc1,mp4a.40.2', 'mp4 with H.264');
expect(pickMime('mp4', sup(['video/mp4'])) === null, 'bare mp4 (maybe VP9) not taken');
expect(pickMime('webm', sup(['video/webm;codecs=vp8,opus'])) === 'video/webm;codecs=vp8,opus', 'webm vp8');
expect(clock(0) === '0:00' && clock(65000) === '1:05' && clock(3725000) === '1:02:05', 'clock');

console.log(`rec: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
