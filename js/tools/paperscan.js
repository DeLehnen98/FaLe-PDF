// Papierformular-Erkennung auf dem Seitenbild (pure, ohne DOM): findet in einem Graustufen-/RGBA-Bild Schreiblinien,
// Kästen (auch Tabellenzellen mit kleiner Beschriftung oben) und Ankreuzkästchen und ordnet ihnen Beschriftungen zu.
// Funktioniert für Scans und Fotos genauso wie für „flache“ PDFs (alles wird als Bild betrachtet).
// Einheiten: alle Ergebnisse in Seiten-Koordinaten (viewport@1, Punkte), Eingabebild im Maßstab `s` (Pixel je Punkt).

/**
 * Dark-pixel mask (1 = ink). Each pixel is compared with the brightness of the paper around it (local mean over
 * ~1/12 of the page), so photos with uneven light – a lamp spot, the shadow of the phone, a dark table at the edge –
 * work like scans: thin grey write-on lines in a shadow are still ink, a shaded patch of paper is not.
 */
export function inkMask(rgba, w, h) {
  const n = w * h;
  const lum = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) lum[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  // background: mean brightness of blocks, blurred over 5 × 5 blocks, interpolated between block centres
  const b = Math.max(8, Math.round(Math.min(w, h) / 60));
  const gw = Math.ceil(w / b), gh = Math.ceil(h / b);
  const G = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let sum = 0, cnt = 0;
    const y1 = Math.min(h, (gy + 1) * b), x1 = Math.min(w, (gx + 1) * b);
    for (let y = gy * b; y < y1; y += 2) for (let x = gx * b; x < x1; x += 2) { sum += lum[y * w + x]; cnt++; }
    G[gy * gw + gx] = cnt ? sum / cnt : 255;
  }
  const B = new Float32Array(gw * gh);
  const R = 2;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let sum = 0, cnt = 0;
    for (let yy = Math.max(0, gy - R); yy <= Math.min(gh - 1, gy + R); yy++) for (let xx = Math.max(0, gx - R); xx <= Math.min(gw - 1, gx + R); xx++) { sum += G[yy * gw + xx]; cnt++; }
    B[gy * gw + gx] = sum / cnt;
  }
  const mask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / b - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / b - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const bg = (B[y0 * gw + x0] * (1 - tx) + B[y0 * gw + x1] * tx) * (1 - ty) + (B[y1 * gw + x0] * (1 - tx) + B[y1 * gw + x1] * tx) * ty;
      const l = lum[y * w + x];
      // clearly darker than the paper around it; very bright pixels are never ink
      mask[y * w + x] = l < bg * 0.8 && l < 225 ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Skew of a scanned page in degrees (−3 … 3): the angle at which the rows of ink line up best
 * (sharpest horizontal projection). 0 for straight pages.
 */
export function estimateSkew(mask, w, h, { maxDeg = 3, step = 0.1 } = {}) {
  const f = 4, sw = Math.ceil(w / f), sh = Math.ceil(h / f);
  const cell = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let ink = 0;
    for (let yy = y * f; yy < Math.min(h, y * f + f) && !ink; yy++) for (let xx = x * f; xx < Math.min(w, x * f + f); xx++) if (mask[yy * w + xx]) { ink = 1; break; }
    cell[y * sw + x] = ink;
  }
  // only stroke-like ink counts: the edge of the sheet, a fold, a shadow or a table in a photo are long dark bands
  // at their own angle and would outvote the text lines
  const W1 = sw + 1, ii = new Uint32Array(W1 * (sh + 1));
  for (let y = 0; y < sh; y++) { let row = 0; for (let x = 0; x < sw; x++) { row += cell[y * sw + x]; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; } }
  const r = Math.max(2, Math.round(Math.max(sw, sh) / 160));
  const pts = [];
  for (let y = 0; y < sh; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(sh, y + r + 1);
    for (let x = 0; x < sw; x++) {
      if (!cell[y * sw + x]) continue;
      const xa = Math.max(0, x - r), xb = Math.min(sw, x + r + 1);
      const n = ii[yb * W1 + xb] - ii[ya * W1 + xb] - ii[yb * W1 + xa] + ii[ya * W1 + xa];
      if (n < (yb - ya) * (xb - xa) * 0.8) pts.push(x, y);
    }
  }
  if (pts.length < 200) return 0;
  const score = deg => {
    const t = Math.tan(deg * Math.PI / 180);
    const bins = new Float64Array(sh * 2 + 8);
    const off = sh / 2 + 4;
    for (let i = 0; i < pts.length; i += 2) { const b = Math.round(pts[i + 1] - (pts[i] - sw / 2) * t + off); if (b >= 0 && b < bins.length) bins[b]++; }
    let s2 = 0; for (const v of bins) s2 += v * v;
    return s2;
  };
  let best = 0, bestS = -1;
  for (let d = -maxDeg; d <= maxDeg + 1e-9; d += step) { const sc = score(d); if (sc > bestS * 1.0005) { bestS = sc; best = d; } }
  // refine
  for (let d = best - step; d <= best + step + 1e-9; d += step / 4) { const sc = score(d); if (sc > bestS) { bestS = sc; best = d; } }
  return Math.abs(best) < 0.08 ? 0 : Math.round(best * 100) / 100;
}

/** Runs of ink along rows (horizontal) with small gaps bridged → [{y, x0, x1}] (pixels, x1 exclusive). */
function hRuns(mask, w, h, minLen, maxLen = Infinity, gap = 2) {
  const out = [];
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let start = -1, lastInk = -1;
    for (let x = 0; x <= w; x++) {
      const ink = x < w && mask[row + x];
      if (ink) { if (start < 0) start = x; lastInk = x; continue; }
      if (start >= 0 && (x - lastInk > gap || x === w)) {
        const len = lastInk + 1 - start;
        if (len >= minLen && len <= maxLen) out.push({ y, x0: start, x1: lastInk + 1 });
        start = -1;
      }
    }
  }
  return out;
}

/** Runs of ink along columns (vertical) → [{x, y0, y1}]. */
function vRuns(mask, w, h, minLen, gap = 2) {
  const out = [];
  for (let x = 0; x < w; x++) {
    let start = -1, lastInk = -1;
    for (let y = 0; y <= h; y++) {
      const ink = y < h && mask[y * w + x];
      if (ink) { if (start < 0) start = y; lastInk = y; continue; }
      if (start >= 0 && (y - lastInk > gap || y === h)) {
        if (lastInk + 1 - start >= minLen) out.push({ x, y0: start, y1: lastInk + 1 });
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Merge runs of neighbouring rows into strokes: horizontal → {x0, x1, y0, y1, ya, yb} (pixels; ya/yb = height at the
 * left/right end). A stroke counts when its ink is at most `maxThick` thick on average – a slightly slanted thin line
 * covers more rows than that, a filled bar or a blob of text has more ink.
 */
function mergeH(runs, maxThick) {
  const open = [];
  const done = [];
  for (const r of runs) {
    let hit = null;
    for (const g of open) {
      // compare with the run of the row before (not the whole stroke): a stroke follows its own path down the rows
      if (r.y - g.y1 > 1 || g.ly === r.y) continue;
      const ov = Math.min(g.lx1, r.x1) - Math.max(g.lx0, r.x0);
      if (ov >= 0.7 * Math.min(g.lx1 - g.lx0, r.x1 - r.x0)) { hit = g; break; }
      // a line with small breaks: the run lies within the stroke so far (not a short run swallowed by a huge area)
      const ou = Math.min(g.x1, r.x1) - Math.max(g.x0, r.x0);
      if (ou >= 0.9 * (r.x1 - r.x0) && (g.x1 - g.x0) <= 3 * (r.x1 - r.x0)) { hit = g; break; }
    }
    if (hit) {
      if (r.x0 < hit.x0) { hit.x0 = r.x0; hit.ya = r.y; }
      if (r.x1 > hit.x1) { hit.x1 = r.x1; hit.yb = r.y; }
      hit.y1 = r.y + 1; hit.n++; hit.px += r.x1 - r.x0; hit.lx0 = r.x0; hit.lx1 = r.x1; hit.ly = r.y;
    } else open.push({ x0: r.x0, x1: r.x1, y0: r.y, y1: r.y + 1, ya: r.y, yb: r.y, n: 1, px: r.x1 - r.x0, lx0: r.x0, lx1: r.x1, ly: r.y });
    // retire groups that can no longer grow
    for (let i = open.length - 1; i >= 0; i--) if (r.y - open[i].y1 > 1) done.push(open.splice(i, 1)[0]);
  }
  done.push(...open);
  return done.filter(g => {
    const len = g.x1 - g.x0;
    // thin: as many rows as the slant explains plus the stroke itself (a row of bold letters is level but tall)
    return g.px / Math.max(1, len) <= maxThick && g.y1 - g.y0 <= maxThick + len * 0.06 && g.y1 - g.y0 - Math.abs(g.yb - g.ya) <= maxThick + 1;
  });
}
/** Strokes of one ruled line that came out as two (its rows start at different x) → one stroke. */
function unite(strokes, maxThick) {
  const list = strokes.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out = [];
  for (const g of list) {
    const o = out.find(u => Math.min(u.x1, g.x1) - Math.max(u.x0, g.x0) > 0 && g.y0 <= u.y1 + 1 && Math.max(u.y1, g.y1) - Math.min(u.y0, g.y0) <= maxThick + 1);
    if (!o) { out.push({ ...g }); continue; }
    if (g.x0 < o.x0) { o.x0 = g.x0; o.ya = g.ya; }
    if (g.x1 > o.x1) { o.x1 = g.x1; o.yb = g.yb; }
    o.y0 = Math.min(o.y0, g.y0); o.y1 = Math.max(o.y1, g.y1);
  }
  return out;
}
function mergeV(runs, maxThick) {
  const t = unite(mergeH(runs.map(r => ({ y: r.x, x0: r.y0, x1: r.y1 })).sort((a, b) => a.y - b.y || a.x0 - b.x0), maxThick), maxThick);
  return t.map(g => ({ y0: g.x0, y1: g.x1, x0: g.y0, x1: g.y1 }));
}

/**
 * Chain thin horizontal strokes that continue each other with a small step up or down: a write-on line in a photo
 * is rarely perfectly level (perspective, a curved sheet), so it falls apart into short pieces on neighbouring rows.
 * strokes: {x0, x1, y0, y1} (pixels) → chains {x0, x1, y0, y1, ya, yb} (ya/yb: centre height at the left/right end)
 */
function linkH(strokes, maxGap, maxStep) {
  const list = strokes.slice().sort((a, b) => a.x0 - b.x0);
  const used = new Uint8Array(list.length);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const a = list[i];
    const ya = a.ya != null ? a.ya : (a.y0 + a.y1) / 2, yb = a.yb != null ? a.yb : (a.y0 + a.y1) / 2;
    const ch = { x0: a.x0, x1: a.x1, y0: a.y0, y1: a.y1, ya, yb, n: 1 };
    for (;;) {
      let best = -1, bestD = Infinity;
      for (let j = i + 1; j < list.length; j++) {
        if (used[j]) continue;
        const b = list[j];
        if (b.x0 > ch.x1 + maxGap) break;
        if (b.x1 <= ch.x1 + 2) continue;
        // height of b where the chain ends (pieces of a slanted line overlap a little)
        const bya = b.ya != null ? b.ya : (b.y0 + b.y1) / 2, byb = b.yb != null ? b.yb : bya;
        const at = Math.min(1, Math.max(0, (ch.x1 - b.x0) / Math.max(1, b.x1 - b.x0)));
        const dy = Math.abs(bya + (byb - bya) * at - ch.yb);
        if (dy > maxStep) continue;
        const d = dy * 4 + Math.max(0, b.x0 - ch.x1);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best < 0) break;
      const b = list[best];
      used[best] = 1;
      ch.x1 = b.x1; ch.y0 = Math.min(ch.y0, b.y0); ch.y1 = Math.max(ch.y1, b.y1); ch.yb = b.yb != null ? b.yb : (b.y0 + b.y1) / 2; ch.n++;
    }
    out.push(ch);
  }
  return out;
}

/** Fraction of rows y0..y1 that have ink in columns cx0..cx1 (pixels). */
function colCover(mask, w, cx0, cx1, y0, y1) {
  let hit = 0, n = 0;
  cx0 = Math.max(0, cx0); cx1 = Math.min(w - 1, cx1);
  for (let y = y0; y < y1; y++) {
    n++;
    for (let x = cx0; x <= cx1; x++) if (mask[y * w + x]) { hit++; break; }
  }
  return n ? hit / n : 0;
}
function inkShare(mask, w, x0, y0, x1, y1) {
  let ink = 0, n = 0;
  for (let y = Math.max(0, y0); y < y1; y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) { n++; ink += mask[y * w + x]; }
  return n ? ink / n : 0;
}

/**
 * Find lines, boxes and checkboxes.
 * @param {Uint8Array} mask  ink mask (w × h)
 * @param {number} s  pixels per point
 * @returns {{lines: Array<{x0,x1,y}>, cells: Array<{x0,y0,x1,y1}>, checks: Array<{x0,y0,x1,y1}>}} in points
 */
export function findShapes(mask, w, h, s) {
  const P = v => v * s; // points → pixels
  const thick = Math.max(3, Math.round(P(2.6)));
  // long horizontal strokes (write-on lines, box edges)
  const H = unite(mergeH(hRuns(mask, w, h, Math.round(P(28))), thick), thick).filter(l => l.x1 - l.x0 < w * 0.97);
  // vertical strokes (box sides) – at least 9 pt high
  const V = mergeV(vRuns(mask, w, h, Math.round(P(9))), thick).filter(l => l.y1 - l.y0 < h * 0.9);
  const yc = l => (l.y0 + l.y1) / 2, xc = l => (l.x0 + l.x1) / 2;
  const tol = Math.max(3, P(2.5));
  const used = new Set();
  const cells = [];
  const byY = H.slice().sort((a, b) => yc(a) - yc(b));
  for (let i = 0; i < byY.length; i++) {
    const a = byY[i];
    for (let j = i + 1; j < byY.length; j++) {
      const b = byY[j];
      const gap = yc(b) - yc(a);
      if (gap < P(9)) continue;
      if (gap > P(160)) break;
      const bx0 = Math.max(a.x0, b.x0), bx1 = Math.min(a.x1, b.x1);
      if (bx1 - bx0 < P(20)) continue;
      // nearest line below for this x-range only
      const between = byY.slice(i + 1, j).some(c => Math.min(c.x1, bx1) - Math.max(c.x0, bx0) > (bx1 - bx0) * 0.5);
      if (between) continue;
      const vs = V.filter(v => xc(v) >= bx0 - tol && xc(v) <= bx1 + tol && v.y0 <= yc(a) + tol && v.y1 >= yc(b) - tol).sort((p, q) => xc(p) - xc(q));
      const hasL = vs.some(v => Math.abs(xc(v) - bx0) <= tol), hasR = vs.some(v => Math.abs(xc(v) - bx1) <= tol);
      if (!hasL || !hasR) continue;
      used.add(a); used.add(b);
      // split at inner verticals → cells
      const xs = [bx0, ...vs.map(xc).filter(x => x > bx0 + tol && x < bx1 - tol), bx1];
      for (let k = 0; k + 1 < xs.length; k++) {
        const x0 = xs[k], x1 = xs[k + 1];
        if (x1 - x0 < P(14)) continue;
        cells.push({ x0: (x0 + thick / 2) / s, y0: (yc(a) + thick / 2) / s, x1: (x1 - thick / 2) / s, y1: (yc(b) - thick / 2) / s });
      }
      break;
    }
  }
  // dedupe cells (two box rows can produce the same cell twice)
  const uniq = [];
  for (const c of cells) if (!uniq.some(u => Math.abs(u.x0 - c.x0) < 2 && Math.abs(u.y0 - c.y0) < 2 && Math.abs(u.x1 - c.x1) < 2 && Math.abs(u.y1 - c.y1) < 2)) uniq.push(c);
  // open write-on lines: not part of a box, 40 pt or longer – pieces of slightly slanted lines chained together;
  // a line is free space to write on, so the band just above it is (almost) empty (rows of bold text are not lines)
  const pieces = mergeH(hRuns(mask, w, h, Math.round(P(10))), Math.max(3, Math.round(P(1.9)))); // write-on lines are thin; a row of bold letters run together is thicker
  const chains = linkH(pieces, Math.max(4, P(7)), Math.max(2, P(1.5)))
    .filter(c => c.x1 - c.x0 >= P(40) && c.x1 - c.x0 < w * 0.97 && Math.abs(c.yb - c.ya) <= (c.x1 - c.x0) * 0.09);
  const onBox = c => [...used].some(u => Math.abs(yc(u) - (c.ya + c.yb) / 2) <= tol + Math.abs(c.yb - c.ya) / 2 && Math.min(u.x1, c.x1) - Math.max(u.x0, c.x0) > (c.x1 - c.x0) * 0.5);
  const clearAbove = c => {
    const x0 = Math.round(c.x0 + (c.x1 - c.x0) * 0.04), x1 = Math.round(c.x1 - (c.x1 - c.x0) * 0.04);
    // a line stands alone: right above and right below it there is paper (the top or bottom edge of a row of bold
    // letters has letter bodies on one side)
    const near = inkShare(mask, w, x0, Math.round(c.y0 - P(2.6)), x1, Math.round(c.y0 - P(0.7))) > 0.12 || inkShare(mask, w, x0, Math.round(c.y1 + P(0.7)), x1, Math.round(c.y1 + P(2.6))) > 0.15;
    // the space to write in (up to ~9 pt above) is free
    const far = inkShare(mask, w, x0, Math.round(c.y0 - P(9)), x1, Math.round(c.y0 - P(2.2))) > 0.1;
    return !near && !far;
  };
  let lines = chains.filter(c => !onBox(c) && clearAbove(c) && !V.some(v => (Math.abs(xc(v) - c.x0) <= tol || Math.abs(xc(v) - c.x1) <= tol) && v.y0 <= (c.ya + c.yb) / 2 + tol && v.y1 >= (c.ya + c.yb) / 2 - tol && v.y1 - v.y0 > P(12)))
    .map(c => ({ x0: c.x0 / s, x1: c.x1 / s, y: c.ya / s, yr: c.yb / s })) // y at the left end (where the label is), yr at the right end
    .filter(l => !uniq.some(c => (Math.abs(l.y - c.y0) < 4 || Math.abs(l.y - c.y1) < 4) && l.x0 >= c.x0 - 4 && l.x1 <= c.x1 + 4))
    .sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))
    .filter((l, i, all) => !all.slice(0, i).some(o => Math.abs(o.y - l.y) < 3 && Math.min(o.x1, l.x1) - Math.max(o.x0, l.x0) > (l.x1 - l.x0) * 0.6))
    .sort((a, b) => a.x0 - b.x0);
  // a faint line in a photo can break in the middle: pieces in line with a small gap are one line
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const ay = a.yr != null ? a.yr : a.y;
      if (b.x0 - a.x1 > 22 || b.x0 < a.x1 - 6 || Math.abs(b.y - ay) > 2.5) continue;
      a.x1 = Math.max(a.x1, b.x1); a.yr = b.yr != null ? b.yr : b.y;
      lines.splice(j, 1); j = i;
    }
  }
  // checkboxes: small squares 6–22 pt with an (almost) empty inside
  const SH = mergeH(hRuns(mask, w, h, Math.round(P(6)), Math.round(P(23))), thick);
  const checks = [];
  const sorted = SH.slice().sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const side = t.x1 - t.x0;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const hgt = b.y1 - t.y0;
      if (hgt > side * 1.4) break;
      if (hgt < side * 0.7 || Math.abs(b.x0 - t.x0) > tol || Math.abs(b.x1 - t.x1) > tol) continue;
      const lc = colCover(mask, w, t.x0, t.x0 + thick, t.y0, b.y1), rc = colCover(mask, w, t.x1 - thick - 1, t.x1 - 1, t.y0, b.y1);
      if (lc < 0.8 || rc < 0.8) continue;
      const inner = inkShare(mask, w, t.x0 + thick + 1, t.y1 + 1, t.x1 - thick - 1, b.y0 - 1);
      if (inner > 0.25) continue;
      const g0 = Math.round(P(1.3)), g1 = Math.round(P(3.2));
      const leftInk = inkShare(mask, w, t.x0 - g1, t.y0, t.x0 - g0, b.y1), rightInk = inkShare(mask, w, t.x1 + g0, t.y0, t.x1 + g1, b.y1);
      if (leftInk > 0.08 && rightInk > 0.08) continue; // a letter („o“, „D“) between other letters
      const c = { x0: t.x0 / s, y0: t.y0 / s, x1: t.x1 / s, y1: b.y1 / s };
      if (!checks.some(o => Math.abs(o.x0 - c.x0) < 3 && Math.abs(o.y0 - c.y0) < 3)) checks.push(c);
      break;
    }
  }
  // a checkbox is not a cell
  const cellsOut = uniq.filter(c => !checks.some(k => Math.abs(k.x0 - c.x0) < 3 && Math.abs(k.y0 - c.y0) < 3) && !((c.x1 - c.x0) < 24 && (c.y1 - c.y0) < 24));
  return { lines, cells: cellsOut, checks };
}

/** OCR words → text items like the PDF text layer gives them: chunks of words separated by wide gaps. */
export function itemsFromWords(words, s) {
  const lines = new Map();
  // a write-on line is sometimes „read“ as flat little words („ee“, „lores“) lying on it: much flatter than real words
  const hs = (words || []).filter(wd => wd && wd.bbox && /\p{L}{2}/u.test(wd.text || '')).map(wd => wd.bbox.y1 - wd.bbox.y0).sort((a, b) => a - b);
  const medH = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
  for (const wd of words || []) {
    if (!wd || !wd.text || !wd.bbox) continue;
    if (medH && (wd.bbox.y1 - wd.bbox.y0 < medH * 0.4 || wd.bbox.y1 - wd.bbox.y0 > medH * 3.2)) continue; // and noise read as one huge „word“
    if (wd.conf != null && wd.conf < 30 && wd.text.trim().length <= 5) continue;
    if (/^[\[\]|_()□☐❏▢◻○◯oO0]{1,3}$/.test(wd.text.trim())) continue; // a drawn box read as "[_]", "O", "|_|" …
    if (/^[_\-–—.…=~]{2,}$/.test(wd.text.trim()) || /_{3,}/.test(wd.text)) continue; // a write-on line read as „____“ (its box would cover the line)
    const key = wd.line != null ? wd.line : Math.round(wd.bbox.y1 / 8);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(wd);
  }
  const out = [];
  for (const ws of lines.values()) {
    ws.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let cur = null;
    for (const wd of ws) {
      const b = wd.bbox, hgt = b.y1 - b.y0;
      if (cur && b.x0 - cur.x1 > Math.max(hgt, cur.h) * 1.6) { out.push(cur); cur = null; }
      if (!cur) cur = { str: wd.text, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, h: hgt };
      else { cur.str += ' ' + wd.text; cur.x1 = Math.max(cur.x1, b.x1); cur.y0 = Math.min(cur.y0, b.y0); cur.y1 = Math.max(cur.y1, b.y1); cur.h = Math.max(cur.h, hgt); }
    }
    if (cur) out.push(cur);
  }
  return out.map(c => ({ str: c.str, x: c.x0 / s, x1: c.x1 / s, y: c.y1 / s, top: c.y0 / s, size: Math.max(5, (c.y1 - c.y0) / s) }));
}

const clean = str => String(str || '').replace(/[_.…]{2,}.*$/, '').replace(/[\s:_.…*]+$/g, '').replace(/^[\s_:]+/, '').replace(/^(?:\(?\d{1,2}[.)]|[a-hA-H][.)])\s+/, '').trim();
export function typeOf(label, fallback = 'text') {
  if (/unterschrift|signatur|signature|unterzeichn/i.test(label)) return 'sign';
  if (/datum|geburtstag|date\b|geb\.?\s*am/i.test(label) && !/\bort\b/i.test(label)) return 'date';
  return fallback;
}

/**
 * Turn shapes + text items (points, viewport@1) into form fields.
 * items: [{str, x, x1, y (baseline/bottom), top?, size}]
 * @returns {Array<{type, x, y, w, h, name}>}
 */
export function fieldsFromShapes(shapes, items, { W = 595, H = 842 } = {}) {
  const out = [];
  const top = it => (it.top != null ? it.top : it.y - it.size);
  const box = it => ({ x0: it.x, x1: it.x1, y0: top(it), y1: it.y });
  const inside = (b, c, m = 1) => b.x0 >= c.x0 - m && b.x1 <= c.x1 + m && b.y0 >= c.y0 - m && b.y1 <= c.y1 + m;
  const ovl = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ix * iy / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  };
  const add = f => {
    if (f.w < 12 || f.h < 7) return;
    if (out.some(o => ovl(o, f) > 0.3)) return;
    out.push(f);
  };
  const textIn = r => items.filter(it => { const b = box(it); const ix = Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0), iy = Math.min(b.y1, r.y1) - Math.max(b.y0, r.y0); return ix > 0 && iy > 0 && ix * iy > 0.5 * (b.x1 - b.x0) * (b.y1 - b.y0); });
  const leftLabel = (x0, yMid, maxGap = 170) => {
    let best = null;
    for (const it of items) {
      if (it.x1 > x0 + 3 || x0 - it.x1 > maxGap) continue;
      if (Math.abs((top(it) + it.y) / 2 - yMid) > Math.max(it.size, 8) * 0.9) continue;
      if (!best || it.x1 > best.x1) best = it;
    }
    return best;
  };
  // 1) cells (boxes)
  for (const c of shapes.cells || []) {
    const r = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 };
    const ins = textIn(r);
    const ch = c.y1 - c.y0, cw = c.x1 - c.x0;
    if (!ins.length) {
      const lab = leftLabel(c.x0, (c.y0 + c.y1) / 2) || items.filter(it => it.y <= c.y0 + 2 && c.y0 - it.y < 14 && it.x1 > c.x0 && it.x < c.x1).sort((p, q) => q.y - p.y)[0];
      const name = lab ? clean(lab.str) : '';
      const type = typeOf(name, ch > 40 ? 'multiline' : 'text');
      add({ type, x: c.x0 + 1.5, y: c.y0 + 1.5, w: cw - 3, h: ch - 3, name });
      continue;
    }
    const lb = ins.map(box);
    const labBottom = Math.max(...lb.map(b => b.y1));
    const labRight = Math.max(...lb.map(b => b.x1));
    const name = clean(ins.sort((p, q) => top(p) - top(q) || p.x - q.x).map(it => it.str).join(' '));
    if (name.length > 70) continue; // a box full of text is not a field
    if (labBottom <= c.y0 + ch * 0.55 && c.y1 - labBottom >= 8) {
      // small label at the top of the box ("Name, Vorname") → write below it
      const type = typeOf(name, c.y1 - labBottom > 40 ? 'multiline' : 'text');
      add({ type, x: c.x0 + 1.5, y: labBottom + 0.5, w: cw - 3, h: c.y1 - labBottom - 2, name });
    } else if (labRight <= c.x0 + cw * 0.6 && c.x1 - labRight >= 30) {
      // label on the left inside the box → write right of it
      add({ type: typeOf(name), x: labRight + 4, y: c.y0 + 1.5, w: c.x1 - labRight - 6, h: ch - 3, name });
    }
  }
  // 2) checkboxes (not inside a word: bold letters like „o“ can look like tiny boxes)
  for (const k of shapes.checks || []) {
    const kh = k.y1 - k.y0;
    if (kh < 7.5 || k.x1 - k.x0 < 7.5) continue; // smaller „boxes“ are letters (o, D, 0) far more often than tick boxes
    if (items.some(it => { const b = box(it); return k.x0 >= b.x0 - 1 && k.x1 <= b.x1 + 1 && k.y0 >= b.y0 - 2 && k.y1 <= b.y1 + 2; })) continue;
    const right = items.filter(it => it.x >= k.x1 - 1 && it.x - k.x1 < 40 && Math.abs((top(it) + it.y) / 2 - (k.y0 + k.y1) / 2) < Math.max(it.size, kh) * 0.8).sort((p, q) => p.x - q.x)[0];
    const left = right ? null : leftLabel(k.x0, (k.y0 + k.y1) / 2, 60);
    const f = { type: 'check', x: k.x0 + 1, y: k.y0 + 1, w: k.x1 - k.x0 - 2, h: kh - 2, name: clean((right || left || {}).str || '') };
    if (f.w >= 4 && !out.some(o => ovl(o, f) > 0.3)) out.push(f);
  }
  // 3) open lines: write above the line; caption left of it (same line) or right under it ("Ort, Datum", "Unterschrift")
  // a stroke through or right under words is text (bold letters run together, underlined headings), not a line to write on
  const throughText = l => items.some(it => { const b = box(it); const ov = Math.min(b.x1, l.x1) - Math.max(b.x0, l.x0); const ym = (l.y + (l.yr != null ? l.yr : l.y)) / 2; return ov > 0.3 * Math.min(l.x1 - l.x0, b.x1 - b.x0) && ym >= b.y0 - 0.5 && ym <= b.y1 + 1.5; });
  for (const l of shapes.lines || []) {
    const lw = l.x1 - l.x0;
    if (throughText(l)) continue;
    if (lw > W * 0.92) continue;
    if (l.y < H * 0.07 || l.y > H * 0.9) continue; // header and footer rules of letters
    // a line in a photo is often a little slanted: the label sits at its left end, the field ends at its highest point
    const yHi = Math.min(l.y, l.yr != null ? l.yr : l.y), yLo = Math.max(l.y, l.yr != null ? l.yr : l.y);
    const lab = leftLabel(l.x0, l.y - 6);
    const under = items.filter(it => top(it) >= yHi - 1 && top(it) - yLo < 12 && it.x < l.x1 && it.x1 > l.x0 && clean(it.str).length <= 40).sort((p, q) => top(p) - top(q))[0];
    const name = clean((lab || under || {}).str || '');
    const type = typeOf(name);
    let hgt = type === 'sign' ? 34 : 18;
    // do not reach into text or another line above
    const above = Math.max(-Infinity, ...items.filter(it => it.x < l.x1 && it.x1 > l.x0 && it.y <= yHi - 2 && it !== lab).map(it => it.y),
      ...(shapes.lines || []).filter(o => o !== l && Math.max(o.y, o.yr != null ? o.yr : o.y) < yHi - 4 && o.x0 < l.x1 && o.x1 > l.x0).map(o => Math.max(o.y, o.yr != null ? o.yr : o.y)));
    if (Number.isFinite(above)) hgt = Math.min(hgt, yHi - above - 1.5);
    if (hgt < 9) continue;
    const x0 = lab && lab.x1 > l.x0 ? lab.x1 + 3 : l.x0; // "Name: ____" written over the start of the line
    add({ type, x: x0, y: yHi - hgt - 0.5, w: l.x1 - x0, h: hgt, name });
  }
  // „Ort, Datum ______    ______“: the line next to the place/date line is where the signature goes
  for (const f of out) {
    if (f.type === 'sign' || f.type === 'check' || /unterschrift|signatur/i.test(f.name) || (f.name && knownLabel(f.name))) continue;
    const od = out.find(o => o !== f && /\bort\b.*datum|datum.*\bort\b/i.test(o.name) && o.x + o.w <= f.x + 4 && Math.abs((o.y + o.h) - (f.y + f.h)) < 8);
    if (od) { f.type = 'sign'; f.name = 'Unterschrift'; if (f.h < 30) { const grow = Math.min(34 - f.h, Math.max(0, f.y - 2)); f.y -= grow; f.h += grow; } }
  }
  return out;
}

// Common labels on German (and some English) forms – OCR results that are one or two letters off are corrected to these.
const KNOWN = ['Name', 'Vorname', 'Nachname', 'Familienname', 'Geburtsname', 'Ort', 'PLZ', 'Postleitzahl', 'Wohnort', 'Straße', 'Hausnummer', 'Straße, Hausnummer',
  'Anschrift', 'Telefon', 'Mobil', 'Fax', 'E-Mail', 'Geburtsdatum', 'Geburtsort', 'Datum', 'Ort, Datum', 'Unterschrift', 'Staatsangehörigkeit', 'Familienstand',
  'Geschlecht', 'Titel', 'Beruf', 'Arbeitgeber', 'IBAN', 'BIC', 'Kontoinhaber', 'Kreditinstitut', 'Steuernummer', 'Steuer-ID', 'Krankenkasse', 'Versichertennummer',
  'Land', 'Kennzeichen', 'Aktenzeichen', 'Kundennummer', 'Bemerkungen', 'Name, Vorname'];
function dist(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** Correct a (recognised) label to a well-known form label when it is one letter off („Or“ → „Ort“, „Vomame“ → „Vorname“). */
export function fixLabel(str) {
  const t = String(str || '').trim();
  if (/^\S{2,4},?\s+datum$/i.test(t) && !/^datum/i.test(t)) return 'Ort, Datum'; // „Or, Datum“, „Die, Datum“
  if (t.length < 2 || t.length > 24) return t;
  const lo = t.toLowerCase();
  let best = null, bd = 9;
  for (const k of KNOWN) {
    const d = dist(lo, k.toLowerCase());
    if (d < bd) { bd = d; best = k; }
  }
  const allowed = t.length >= 6 ? 2 : 1;
  return best && bd > 0 && bd <= allowed && !(t.length === 2 && best.length > 3) ? best : t;
}

/** Is this (recognised) word a well-known form label, give or take a letter and a colon? */
export function knownLabel(str) {
  const t = String(str || '').replace(/[:.\s]+$/, '').trim();
  if (t.length < 3) return false;
  const f = fixLabel(t);
  return KNOWN.some(k => k.toLowerCase() === f.toLowerCase());
}

/** Unique, readable field names (AcroForm names must be unique). */
export function uniqueNames(fields, fallback = { text: 'Textfeld', multiline: 'Textbereich', check: 'Kontrollkästchen', sign: 'Unterschrift', date: 'Datum' }) {
  const seen = new Map();
  for (const f of fields) {
    const base = (String(f.name || '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)) || fallback[f.type] || 'Feld';
    const n = (seen.get(base.toLowerCase()) || 0) + 1;
    seen.set(base.toLowerCase(), n);
    f.name = n === 1 ? base : `${base} ${n}`;
  }
  return fields;
}
