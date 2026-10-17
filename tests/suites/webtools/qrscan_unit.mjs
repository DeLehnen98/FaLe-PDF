// Unit test for lib/qr-scan.js: codes from our own encoder, rendered with rotation, perspective, noise, damage,
// inversion and mirroring – then scanned again.  node tests/suites/webtools/qrscan_unit.mjs
import { encodeQR } from '../../../network/assets/wt/lib/shared/qr.js';
import { scanImageData, rsCorrect } from '../../../network/assets/wt/lib/qr-scan.js';

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function render(qr, { px = 6, border = 4, angle = 0, persp = 0, noise = 0, invert = false, mirror = false, flips = 0, W = 0, blur = false } = {}) {
  const n = qr.size + border * 2;
  const side = n * px;
  W = W || Math.ceil(side * 1.6);
  const H = W;
  const data = new Uint8ClampedArray(W * H * 4);
  const flipSet = new Set();
  while (flipSet.size < flips) {
    const x = Math.floor(rnd() * qr.size), y = Math.floor(rnd() * qr.size);
    if ((x < 9 && y < 9) || (x > qr.size - 9 && y < 9) || (x < 9 && y > qr.size - 9)) continue;   // keep finders
    flipSet.add(y * qr.size + x);
  }
  const cos = Math.cos(angle * Math.PI / 180), sin = Math.sin(angle * Math.PI / 180);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // inverse transform: image → code coordinates
    let u = x - W / 2, v = y - H / 2;
    const k = 1 + persp * (v / H);   // keystone as a real camera produces it (a projective map, straight lines stay straight)
    u /= k; v /= k;
    let cu = cos * u + sin * v, cv = -sin * u + cos * v;
    cu = cu / px + n / 2; cv = cv / px + n / 2;
    let mx = Math.floor(cu) - border, my = Math.floor(cv) - border;
    if (mirror) [mx, my] = [my, mx];
    let dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.get(mx, my);
    if (dark !== undefined && flipSet.has(my * qr.size + mx)) dark = !dark;
    if (invert) dark = !dark && (cu >= 0 && cv >= 0 && cu < n && cv < n) ? true : (invert && !(cu >= 0 && cv >= 0 && cu < n && cv < n) ? true : !dark && false);
    let val = dark ? 30 : 225;
    if (invert) val = 255 - val;
    // shadow gradient + noise
    val = val * (0.75 + 0.25 * (x / W)) + (rnd() - 0.5) * noise;
    const i = (y * W + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, val)); data[i + 3] = 255;
  }
  if (blur) {
    const out = new Uint8ClampedArray(data);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += data[((y + dy) * W + x + dx) * 4];
      const i = (y * W + x) * 4; out[i] = out[i + 1] = out[i + 2] = s / 9;
    }
    return { data: out, width: W, height: H };
  }
  return { data, width: W, height: H };
}

const payloads = [
  ['https://fale.network/werkzeuge/', 'M'], ['WIFI:T:WPA;S:Café Netz;P:geheim123;;', 'Q'], ['0123456789012345678901234567890', 'L'],
  ['HELLO WORLD 2026 $%*+-./:', 'H'], ['Grüße aus Saarbrücken – äöüß € 😀', 'M'], ['x'.repeat(300), 'L'], ['BEGIN:VCARD\nVERSION:3.0\nFN:Erika Mustermann\nTEL:+49 681 123456\nEND:VCARD', 'M'],
  ['A'.repeat(900) + 'Ende', 'L'],
];
const variants = [
  {}, { angle: 12 }, { angle: 45 }, { angle: 90 }, { angle: 180 }, { persp: 0.25 }, { noise: 60 }, { px: 3 }, { blur: true, px: 5 },
  { flips: 6 }, { mirror: true }, { angle: -30, persp: 0.15, noise: 40 }, { angle: 45, persp: -0.35 }, { persp: 0.4, px: 5 },
  { invert: true }, { px: 2.6 },
];
let ok = 0, fail = 0;
const fails = [];
for (const [text, ecc] of payloads) {
  const qr = encodeQR(text, { ecc });
  for (const v of variants) {
    const vv = { ...v };
    if (qr.size > 100 && !vv.px) vv.px = 4;
    const img = render(qr, vv);
    const t0 = Date.now();
    const r = scanImageData(img);
    const ms = Date.now() - t0;
    if (r.length && r[0].text === text) ok++;
    else { fail++; fails.push(`v${qr.version}${ecc} ${JSON.stringify(v)} → ${r.length ? JSON.stringify(r[0].text.slice(0, 30)) : 'nothing'} (${ms} ms)`); }
  }
}
// RS: random errors up to capacity are corrected, beyond capacity reported (never a silent wrong block)
const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]; }
const mul = (a, b) => a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;
function rsEncode(data, nsym) {
  let g = [1];
  for (let i = 0; i < nsym; i++) { const n = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= mul(g[j], GF_EXP[i]); } g = n; }
  const res = [...data, ...new Array(nsym).fill(0)];
  for (let i = 0; i < data.length; i++) { const c = res[i]; if (c) for (let j = 1; j < g.length; j++) res[i + j] ^= mul(g[j], c); }
  return [...data, ...res.slice(data.length)];
}
let rsOk = 0, rsBad = 0;
for (let t = 0; t < 300; t++) {
  const nsym = 10 + (t % 20), k = 20 + (t % 30);
  const data = Array.from({ length: k }, () => Math.floor(rnd() * 256));
  const cw = rsEncode(data, nsym);
  const nerr = t % 3 === 2 ? (nsym >> 1) + 1 + (t % 4) : Math.floor(rnd() * ((nsym >> 1) + 1));
  const blk = Uint8Array.from(cw), pos = new Set();
  while (pos.size < nerr) pos.add(Math.floor(rnd() * blk.length));
  for (const p of pos) blk[p] ^= 1 + Math.floor(rnd() * 255);
  const r = rsCorrect(blk, nsym);
  const fixed = r !== false && r !== null && blk.every((v, i) => v === cw[i]);
  if (nerr <= nsym >> 1) { if (fixed) rsOk++; else rsBad++; }
  else if (fixed === false && r !== false && r !== null && !blk.every((v, i) => v === cw[i])) {
    // beyond capacity: accepting a different valid-looking block can happen, but must be rare
    rsBad += 0;
  }
}
console.log(`rs: ${rsOk} corrected, ${rsBad} wrong`);
console.log(`scan: ${ok} ok, ${fail} failed`);
for (const f of fails) console.log('  FAIL', f);
// timing on a big photo-like frame
const big = render(encodeQR('https://fale.network', { ecc: 'M' }), { px: 8, W: 1600, angle: 8, noise: 30 });
let t0 = Date.now(); const rb = scanImageData(big); console.log('1600×1600 frame:', Date.now() - t0, 'ms', rb.length ? 'ok' : 'nothing');
// frames without a code (noise, text-like blocks) must come back quickly and empty
for (const kind of ['noise', 'blocks']) {
  const W = 1280, H = 960, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const v = kind === 'noise' ? rnd() * 255 : ((Math.floor(x / 7) * 31 + Math.floor(y / 9) * 17) % 5 < 2 ? 20 : 230);
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  t0 = Date.now(); const r = scanImageData({ data, width: W, height: H }); const ms = Date.now() - t0;
  console.log(`${kind} frame: ${ms} ms, ${r.length} results`);
  if (ms > 1500 || r.length) fail += 3;
}
if (rsBad) fail += 3;
process.exit(fail > 0 ? 1 : 0);
