import { readFileSync } from 'node:fs';
const M = await import('/home/claude/FalePDF/one/js/media.js');
for (const f of ['IMG_0001.jpg','IMG_0004.jpg','VID_0001.mp4','IMG_9999.HEIC']) {
  const u8 = new Uint8Array(readFileSync('data/photos/' + f));
  const file = new Blob([u8]); file.name = f;
  console.log(f, JSON.stringify(await M.readMediaMeta(Object.assign(new File([u8], f)), M.mimeOf(f))));
}
const T = await import('/home/claude/FalePDF/one/js/takeout.js');
const z = new File([readFileSync('data/takeout/takeout-20260101.zip')], 'takeout.zip');
const r = await T.scanTakeout([z]);
console.log(JSON.stringify(r.items.map(i => ({ n: i.name, s: i.sidecar, a: i.albums })), null, 0), r.albums);
const U = await import('/home/claude/FalePDF/one/js/unzip.js');
const b = await U.readEntry(z, r.items[0].entry, 'image/jpeg'); console.log('entry', b.size, r.items[0].entry.usize);
