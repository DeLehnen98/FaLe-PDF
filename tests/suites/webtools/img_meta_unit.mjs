// Unit test for network/assets/wt/lib/img-meta.js (node): read + lossless strip of JPEG/PNG/WebP.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const M = await import('/home/claude/FalePDF/network/assets/wt/lib/img-meta.js');
const F = new URL('./fixtures/img/', import.meta.url).pathname;
const O = new URL('./out/img-meta/', import.meta.url).pathname;
mkdirSync(O, { recursive: true });
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
for (const f of ['gps_photo.jpg', 'meta.png', 'meta.webp', 'phone_big.jpg', 'clean.jpg', 'logo.png']) {
  const b = new Uint8Array(readFileSync(F + f));
  const m = M.readMeta(b);
  console.log(f, JSON.stringify({ gps: m.gps, o: m.orientation, date: m.date, entries: m.entries.map(e => e.key + '=' + e.value), xmp: m.xmp, com: m.comments, trailer: m.trailer, exif: m.exif }));
  for (const keepDate of [false, true]) {
    const r = M.stripMeta(b, { keepDate });
    const m2 = M.readMeta(r.bytes);
    ok(!m2.gps && !m2.xmp && !m2.comments.length && !m2.trailer && !m2.entries.filter(e => !(keepDate && e.group === 'time')).length, `${f}: leftovers ${JSON.stringify(m2.entries)} ${m2.comments}`);
    ok(m2.orientation === m.orientation, `${f}: orientation kept ${m2.orientation}`);
    if (keepDate && m.date) ok(m2.date === m.date.slice(0, 19), `${f}: date kept ${m2.date}`);
    ok(M.sameBytes(M.imageData(b), M.imageData(r.bytes)), `${f}: image data unchanged`);
    writeFileSync(O + (keepDate ? 'date_' : '') + f, r.bytes);
  }
}
console.log(fail ? `${fail} failures` : 'all ok');
process.exit(fail ? 1 : 0);
