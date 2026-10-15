// Raster → vector: traces the outline of an alpha mask (pixel-edge contours, joined into closed loops,
// simplified with Douglas–Peucker and smoothed with quadratic curves) into one SVG path (even-odd fill).
// Used by signature-maker for a real vector SVG of drawn, typed or photographed signatures.

/** Closed contours of mask (Uint8Array w*h, 1 = inside) as point lists in pixel-corner coordinates. */
export function contours(mask, w, h) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const W = w + 1;
  const next = new Map(); // vertex → [vertex…] (directed edges, inside on the right in y-down space)
  const add = (ax, ay, bx, by) => {
    const a = ay * W + ax, b = by * W + bx;
    const l = next.get(a);
    if (l) l.push(b); else next.set(a, [b]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inside(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [start, list] of next) {
    while (list.length) {
      const pts = [];
      let v = start;
      let guard = 0;
      while (guard++ < 4e6) {
        const l = next.get(v);
        if (!l || !l.length) break;
        const n = l.pop();
        pts.push([v % W, (v / W) | 0]);
        v = n;
        if (v === start) break;
      }
      if (pts.length >= 4) loops.push(pts);
    }
  }
  return loops;
}

function dpSimplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** SVG path data for the mask (scale = output units per pixel). */
export function maskToPath(mask, w, h, { scale = 1, eps = 0.7 } = {}) {
  const r = v => +(v * scale).toFixed(2);
  let d = '';
  for (const loop of contours(mask, w, h)) {
    // split the closed loop at its farthest point so the simplification keeps both halves
    let f = 0, fd = -1;
    for (let i = 1; i < loop.length; i++) { const dd = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (dd > fd) { fd = dd; f = i; } }
    const p = [...dpSimplify(loop.slice(0, f + 1), eps).slice(0, -1), ...dpSimplify([...loop.slice(f), loop[0]], eps).slice(0, -1)];
    if (p.length < 3) continue;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const m0 = mid(p[p.length - 1], p[0]);
    d += `M${r(m0[0])} ${r(m0[1])}`;
    for (let i = 0; i < p.length; i++) {
      const c = p[i], m = mid(c, p[(i + 1) % p.length]);
      d += `Q${r(c[0])} ${r(c[1])} ${r(m[0])} ${r(m[1])}`;
    }
    d += 'Z';
  }
  return d;
}

/** Binary mask + mean ink colour from RGBA data. */
export function alphaMask(data, w, h, threshold = 110) {
  const mask = new Uint8Array(w * h);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a >= threshold) { mask[i] = 1; r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; n++; }
  }
  const hex = v => Math.round(v / Math.max(1, n)).toString(16).padStart(2, '0');
  return { mask, color: `#${hex(r)}${hex(g)}${hex(b)}`, ink: n };
}
