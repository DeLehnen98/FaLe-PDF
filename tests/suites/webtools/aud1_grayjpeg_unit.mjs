// aud1: unit test for lib/aud1-grayjpeg.js – encode a gradient + text-like pattern, decode with python PIL, compare.
import { encodeGrayJpeg } from '/home/claude/FalePDF/network/assets/wt/lib/aud1-grayjpeg.js';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const w = 333, h = 211, px = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = ((x * 255) / w + ((x >> 4) % 2 ? 40 : 0) + (y % 50 < 3 ? -60 : 0)) & 255;
const t0 = Date.now();
const jpg = await encodeGrayJpeg(px, w, h, 90);
const f = '/home/claude/FalePDF/tests/suites/webtools/out/aud1_gray.jpg';
writeFileSync(f, jpg);
writeFileSync(f + '.raw', px);
const r = execFileSync('python3', ['-c', `
from PIL import Image; import sys
im=Image.open('${f}'); assert im.mode=='L', im.mode; assert im.size==(${w},${h}), im.size
raw=open('${f}.raw','rb').read(); d=im.tobytes()
err=sum(abs(a-b) for a,b in zip(raw,d))/len(raw); print(round(err,2))
`]).toString().trim();
const err = parseFloat(r);
// big image speed
const W = 2480, H = 3508, big = new Uint8Array(W * H).map((_, i) => (i * 7) & 255);
const t1 = Date.now(); await encodeGrayJpeg(big, W, H, 85); const ms = Date.now() - t1;
console.log(`grayjpeg: mean abs error ${err}, ${jpg.length} bytes, A4@300dpi in ${ms} ms`);
if (!(err < 4)) { console.error('FAIL: error too high'); process.exit(1); }
