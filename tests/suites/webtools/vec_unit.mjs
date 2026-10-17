// Unit test for lib/vec-trace.js: synthetic logos are traced, the paths rasterised again (even-odd) and
// compared with the drawn shapes per colour.  node tests/suites/webtools/vec_unit.mjs
import { vectorize, toSvg, toPdfOps, loops } from '../../../network/assets/wt/lib/vec-trace.js';

let ok = 0, fail = 0;
const expect = (c, m) => { if (c) ok++; else { fail++; console.log('FAIL', m); } };

function image(w, h, paint, aa = true) {
  // paint(x, y) → [r,g,b,a]; 4×4 supersampling for anti-aliased edges like real exports
  const data = new Uint8ClampedArray(w * h * 4);
  const S = aa ? 4 : 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const c = paint(x + (sx + 0.5) / S, y + (sy + 0.5) / S); for (let k = 0; k < 4; k++) acc[k] += c[k]; }
    for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = acc[k] / (S * S);
  }
  return { data, width: w, height: h };
}

// flatten a layer's ops and rasterise with the even-odd rule at pixel centres
function raster(layer, w, h, scale) {
  const polys = layer.ops.map(lp => {
    const pts = [lp.start.map(v => v * scale)];
    let cur = pts[0];
    for (const op of lp.ops) {
      if (op[0] === 'L') { cur = op[1].map(v => v * scale); pts.push(cur); continue; }
      const [c1, c2, b] = [op[1], op[2], op[3]].map(p => p.map(v => v * scale));
      for (let t = 1; t <= 8; t++) {
        const u = t / 8, m = 1 - u;
        pts.push([m * m * m * cur[0] + 3 * m * m * u * c1[0] + 3 * m * u * u * c2[0] + u * u * u * b[0], m * m * m * cur[1] + 3 * m * m * u * c1[1] + 3 * m * u * u * c2[1] + u * u * u * b[1]]);
      }
      cur = b;
    }
    return pts;
  });
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs = [];
    for (const P of polys) for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(w, Math.ceil(xs[k + 1] - 0.5)); x++) out[y * w + x] = 1;
  }
  return out;
}

/** composite all layers → per pixel the index of the topmost layer (-1 = none) */
function composite(res, w, h, scale = 1) {
  const top = new Int16Array(w * h).fill(-1);
  res.layers.forEach((l, i) => { const m = raster(l, w, h, scale); for (let p = 0; p < w * h; p++) if (m[p]) top[p] = i; });
  return top;
}
const near = (a, b, tol = 40) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < tol;

// --- 1. two-colour logo: red disc with a hole, blue bar, white background
{
  const W = 240, H = 160;
  const paint = (x, y) => {
    const dc = Math.hypot(x - 80, y - 80);
    if (dc < 55 && dc > 22) return [220, 30, 40, 255];
    if (x > 150 && x < 225 && y > 40 && y < 120) return [20, 60, 200, 255];
    return [255, 255, 255, 255];
  };
  const img = image(W, H, paint);
  const res = vectorize(img, { mode: 'color', colors: 0, detail: 3, smooth: 3 });
  expect(res.layers.length === 3, `logo: 3 layers (${res.layers.length})`);
  expect(near(res.layers[0].color, [255, 255, 255]), 'logo: background first');
  const top = composite(res, W, H);
  let wrong = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const want = paint(x + 0.5, y + 0.5), got = top[y * W + x] >= 0 ? res.layers[top[y * W + x]].color : [0, 0, 0];
    if (!near(want, got)) wrong++;
  }
  expect(wrong / (W * H) < 0.012, `logo: ${(wrong / (W * H) * 100).toFixed(2)} % wrong pixels`);
  expect(res.nodes < 160, `logo: compact (${res.nodes} nodes)`);
  const svg = toSvg(res);
  expect(svg.startsWith('<svg') && !/<image|base64/.test(svg) && (svg.match(/<path/g) || []).length === 3, 'logo: plain SVG paths, no bitmap');
  const noBg = vectorize(img, { mode: 'color', colors: 0, detail: 3, smooth: 3, dropBackground: true });
  expect(noBg.layers.length === 2 && !noBg.layers.some(l => near(l.color, [255, 255, 255])), 'logo: background left out on request');
  const ops = toPdfOps(res);
  expect(/ rg\n/.test(ops) && /f\*\n$/.test(ops) && / c\n/.test(ops), 'logo: PDF operators');
}

// --- 2. black & white line art with thin lines and text-like strokes
{
  const W = 200, H = 120;
  const paint = (x, y) => {
    const ink = (Math.abs(y - 30) < 1.5 && x > 20 && x < 180) || (Math.abs(x - 100) < 2 && y > 40 && y < 110) || (Math.abs(Math.hypot(x - 50, y - 80) - 20) < 2.5);
    return ink ? [10, 10, 10, 255] : [250, 248, 240, 255];
  };
  // the tool traces small pictures enlarged (smooth edges instead of pixel steps) – do the same here
  const img = image(W * 3, H * 3, (x, y) => paint(x / 3, y / 3));
  const res = vectorize(img, { mode: 'bw', detail: 4, smooth: 2, outScale: 1 / 3 });
  const ink = res.layers.find(l => l.color[0] === 0);
  expect(!!ink, 'bw: black layer');
  const m = raster(ink, W * 3, H * 3, 1);   // compare at the traced resolution (edges are sub-pixel)
  let miss = 0, extra = 0, total = 0;
  for (let y = 0; y < H * 3; y++) for (let x = 0; x < W * 3; x++) {
    const want = paint((x + 0.5) / 3, (y + 0.5) / 3)[0] < 128;
    if (want) total++;
    if (want && !m[y * W * 3 + x]) miss++;
    if (!want && m[y * W * 3 + x]) extra++;
  }
  expect(miss / total < 0.12 && extra / total < 0.12, `bw: thin lines kept (miss ${miss}, extra ${extra} of ${total})`);
  const cut = vectorize(img, { mode: 'outline', detail: 4, smooth: 2 });
  expect(cut.layers.length === 1 && cut.layers[0].color[0] === 0, 'outline: one cut layer only');
}

// --- 3. transparency: transparent background stays transparent
{
  const img = image(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 35 ? [0, 150, 80, 255] : [0, 0, 0, 0]));
  const res = vectorize(img, { mode: 'color' });
  expect(res.layers.length === 1 && near(res.layers[0].color, [0, 150, 80]), `alpha: only the shape (${res.layers.length})`);
}

// --- 4. pinch (two squares touching at a corner) gives closed loops
{
  const w = 4, h = 4, m = new Uint8Array(16);
  m[1 * 4 + 1] = 1; m[2 * 4 + 2] = 1;
  const L = loops(m, w, h);
  expect(L.length === 2 && L.every(l => l.length === 8), `pinch: two closed squares (${L.map(l => l.length)})`);
}

// --- 5. upscaled output and noise robustness, timing on a big picture
{
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const W = 1400, H = 1000;
  const img = image(W, H, (x, y) => {
    const n = (rnd() - 0.5) * 30;
    const c = Math.hypot(x - 500, y - 500) < 300 ? [230, 120, 20] : y > 700 ? [30, 30, 30] : [240, 240, 235];
    return [c[0] + n, c[1] + n, c[2] + n, 255];
  }, false);
  const t0 = Date.now();
  const res = vectorize(img, { mode: 'color', colors: 0, detail: 3, smooth: 3, outScale: 2 });
  const ms = Date.now() - t0;
  expect(res.layers.length === 3, `noise: 3 colours despite noise (${res.layers.length})`);
  expect(res.nodes < 400, `noise: no speck explosion (${res.nodes} nodes)`);
  expect(res.width === 2800 && /viewBox="0 0 2800 2000"/.test(toSvg(res)), 'outScale: coordinates of the original size');
  expect(ms < 6000, `big picture traced in ${ms} ms`);
  console.log(`1400×1000 noisy picture: ${ms} ms, ${res.nodes} nodes`);
}

console.log(`vec-trace: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
