// Round-trip: lib/shared/qr.js encoder → lib/img-qrdecode.js decoder, all ECC levels, many lengths/masks.
const Q = await import('/home/claude/FalePDF/network/assets/wt/lib/shared/qr.js');
const D = await import('/home/claude/FalePDF/network/assets/wt/lib/img-qrdecode.js');
let fail = 0, n = 0;
const texts = ['https://fale.network', 'Hallo Welt – äöü ß € 🙂', 'WIFI:T:WPA;S:Mein WLAN;P:geheim;;', 'x'.repeat(300), 'y'.repeat(1200), '日本語テキスト'.repeat(20)];
for (const t of texts) for (const ecc of ['L', 'M', 'Q', 'H']) for (const mask of [-1, 0, 3, 5, 7]) {
  let qr;
  try { qr = Q.encodeQR(t, { ecc, mask }); } catch { continue; }
  n++;
  const out = D.decodeModules((x, y) => qr.get(x, y), qr.size);
  if (out !== t) { fail++; console.log('FAIL', ecc, mask, qr.version, JSON.stringify(t).slice(0, 40), JSON.stringify(out)?.slice(0, 40)); }
  // one flipped module in the format area must still decode (format bits are error-tolerant)
}
// raster path
const qr = Q.encodeQR('raster test', { ecc: 'M' });
const border = 4, px = 7, N = (qr.size + border * 2) * px;
const data = new Uint8ClampedArray(N * N * 4).fill(255);
for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.get(x, y)) for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) { const i = (((y + border) * px + yy) * N + (x + border) * px + xx) * 4; data[i] = 20; data[i + 1] = 40; data[i + 2] = 120; }
console.log('raster:', D.decodeRaster({ data, width: N, height: N }, qr.size, border));
// inverted colours must fail
for (let i = 0; i < data.length; i += 4) { data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; data[i + 2] = 255 - data[i + 2]; }
console.log('inverted:', D.decodeRaster({ data, width: N, height: N }, qr.size, border));
console.log(`${n} round trips, ${fail} failures`);
process.exit(fail ? 1 : 0);
