// Field detection for PDFs without form fields (fill-pdf-form): underscores, "Label:" gaps, drawn boxes/lines,
// checkbox glyphs. Adapted from the FaLe PDF app (js/tools/formcreate.js detectFields + js/tools/pagegeom.js).
import { loadPdfjs } from './pdf.js';

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * @param {object} page  pdf.js page
 * @param {object} base  viewport at scale 1 (with the page rotation)
 * @returns {Promise<{images: Array<{x0,y0,x1,y1}>, rects: Array<{x0,y0,x1,y1,fill,stroke}>, lines: Array<{x0,y0,x1,y1}>}>}
 */
export async function pageShapes(page, base, { wantPaths = true } = {}) {
  const OPS = (await loadPdfjs()).OPS;
  const out = { images: [], rects: [], lines: [] };
  let list;
  try { list = await page.getOperatorList(); } catch { return out; }
  const { fnArray, argsArray } = list;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const toView = (x, y) => { const [px, py] = apply(ctm, x, y); return base.convertToViewportPoint(px, py); };
  const boxOf = pts => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      const m = args && args[0];
      if (m && m.length === 6) ctm = mul(ctm, Array.from(m));
    } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
      const b = boxOf([toView(0, 0), toView(1, 0), toView(0, 1), toView(1, 1)]);
      if (b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1) out.images.push(b);
    } else if (wantPaths && fn === OPS.constructPath) {
      // pdf.js ≥5: [paintOp, [pathData], minMax]
      const paint = args && args[0];
      const mm = args && args[2];
      if (!mm || mm.length < 4 || !Number.isFinite(mm[0]) || mm[0] > mm[2]) continue;
      const data = args[1] && args[1][0];
      const segs = data && data.length != null ? data.length : 0;
      const b = boxOf([toView(mm[0], mm[1]), toView(mm[2], mm[1]), toView(mm[0], mm[3]), toView(mm[2], mm[3])]);
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      const stroke = paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke || paint === OPS.closeFillStroke || paint === OPS.eoFillStroke;
      const fill = paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke || paint === OPS.eoFillStroke || paint === OPS.closeFillStroke;
      if (segs && segs > 40) continue; // complex outlines (glyph-like drawings, charts)
      if (h < 2.2 && w > 24) out.lines.push(b);
      else if (w > 4 && h > 4) out.rects.push({ ...b, fill, stroke });
    }
  }
  return out;
}

function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}

const cleanLabel = s => String(s || '').replace(/[_.…:]+$/g, '').replace(/^[\s_]+|[\s_:]+$/g, '').trim();
function typeFromLabel(label, fallback = 'text') {
  if (/unterschrift|signatur|signature|unterzeichn/i.test(label)) return 'sign';
  if (/datum|geburtstag|date\b|geb\.?\s*am/i.test(label)) return 'date';
  return fallback;
}

/**
 * Detect candidate form fields on a page (viewport@1 coordinates).
 * @returns {Promise<Array<{type, x, y, w, h, name, auto: true}>>}
 */
export async function detectFields(page, base) {
  const out = [];
  const W = base.width, H = base.height;
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue;
    const size = Math.hypot(c, d) || it.height || 10;
    const [x, y] = base.convertToViewportPoint(e, f);
    const [x2] = base.convertToViewportPoint(e + (it.width || 0) * (a / (Math.hypot(a, b) || 1)), f);
    items.push({ str: it.str, x: Math.min(x, x2), x1: Math.max(x, x2), y, size, w: Math.abs(x2 - x) });
  }
  const textBoxes = items.map(i => ({ x: i.x, y: i.y - i.size * 0.8, w: i.x1 - i.x, h: i.size, str: i.str }));
  const sameLine = (i, j) => Math.abs(i.y - j.y) < Math.max(i.size, j.size) * 0.5;
  const labelLeftOf = (x, y, hgt) => {
    let best = null;
    for (const it of items) {
      if (Math.abs(it.y - (y + hgt * 0.75)) > Math.max(it.size, hgt) * 0.8 && Math.abs(it.y - y - hgt) > it.size * 0.6) continue;
      if (it.x1 > x + 2 || x - it.x1 > 160) continue;
      if (!best || it.x1 > best.x1) best = it;
    }
    return best ? cleanLabel(best.str.replace(/_{3,}.*/, '')) : '';
  };
  const add = f => {
    f.w = Math.max(10, Math.min(W - f.x - 2, f.w));
    if (f.w < 10 || f.h < 6) return;
    if (out.some(o => overlap(o, f) > 0.3)) return;
    out.push({ ...f, auto: true, required: false, def: f.type === 'check' ? false : '' });
  };

  // 1) underscore runs: "Name: ________"
  for (const it of items) {
    const re = /_{4,}/g;
    let m;
    while ((m = re.exec(it.str))) {
      const n = it.str.length || 1;
      const x0 = it.x + (m.index / n) * (it.x1 - it.x), x1 = it.x + ((m.index + m[0].length) / n) * (it.x1 - it.x);
      let label = cleanLabel(it.str.slice(0, m.index));
      if (!label) {
        const left = items.filter(o => o !== it && sameLine(o, it) && o.x1 <= x0 + 2).sort((p, q) => q.x1 - p.x1)[0];
        if (left) label = cleanLabel(left.str);
      }
      const hgt = Math.max(14, it.size * 1.5);
      const type = typeFromLabel(label);
      add({ type, x: x0, y: it.y - hgt + it.size * 0.25, w: x1 - x0, h: type === 'sign' ? Math.max(hgt, 34) : hgt, name: label || (type === 'sign' ? 'Unterschrift' : 'Textfeld') });
    }
  }
  // 2) checkbox glyphs
  for (const it of items) {
    const idx = it.str.search(/[☐□❏▢◻]/);
    if (idx < 0) continue;
    const n = it.str.length || 1;
    const x0 = it.x + (idx / n) * (it.x1 - it.x);
    const s = it.size * 0.9;
    const rest = cleanLabel(it.str.slice(idx + 1)) || (items.find(o => o !== it && sameLine(o, it) && o.x >= x0) || {}).str || '';
    add({ type: 'check', x: x0, y: it.y - s * 0.95, w: s, h: s, name: cleanLabel(rest) || 'Kontrollkästchen' });
  }
  // 3) shapes: small squares → checkbox, boxes → text, lines → field above
  let shapes = { rects: [], lines: [] };
  try { shapes = await pageShapes(page, base); } catch {}
  const coversText = r => textBoxes.some(t => overlap(t, r) > 0.5 && !/^_+$/.test(t.str.trim()));
  for (const r of shapes.rects) {
    const w = r.x1 - r.x0, hh = r.y1 - r.y0;
    if (w > W * 0.9 && hh > H * 0.5) continue; // page frames
    const rect = { x: r.x0, y: r.y0, w, h: hh };
    if (coversText(rect)) continue;
    if (w >= 6 && w <= 24 && Math.abs(w - hh) < 3) {
      const right = items.filter(o => Math.abs(o.y - (r.y1 - hh * 0.1)) < Math.max(o.size, hh) && o.x >= r.x1 - 1 && o.x - r.x1 < 40).sort((p, q) => p.x - q.x)[0];
      add({ type: 'check', x: r.x0 + 1, y: r.y0 + 1, w: w - 2, h: hh - 2, name: right ? cleanLabel(right.str) : 'Kontrollkästchen' });
    } else if (w >= 40 && hh >= 10 && hh <= 200 && r.stroke) {
      const label = labelLeftOf(r.x0, r.y0, Math.min(hh, 20)) || (items.filter(o => o.y <= r.y0 + 2 && r.y0 - o.y < 20 && o.x >= r.x0 - 4 && o.x < r.x1).sort((p, q) => q.y - p.y)[0] || {}).str || '';
      const type = hh > 40 ? (typeFromLabel(label, 'multiline')) : typeFromLabel(label);
      add({ type, x: r.x0 + 1.5, y: r.y0 + 1.5, w: w - 3, h: hh - 3, name: cleanLabel(label) || (type === 'multiline' ? 'Textbereich' : 'Textfeld') });
    }
  }
  for (const l of shapes.lines) {
    const w = l.x1 - l.x0;
    if (w < 50 || w > W * 0.92) continue;
    const label = labelLeftOf(l.x0, l.y0 - 16, 16);
    const type = typeFromLabel(label);
    const hgt = type === 'sign' ? 36 : 18;
    const rect = { x: l.x0, y: l.y0 - hgt, w, h: hgt };
    if (textBoxes.some(t => overlap(t, rect) > 0.35)) continue;
    add({ type, ...rect, name: label || (type === 'sign' ? 'Unterschrift' : 'Textfeld') });
  }
  // 4) "Label:" followed by empty space on the same line
  for (const it of items) {
    const s = it.str.trim();
    if (!/[:]$/.test(s) || s.length > 40 || /_{3,}/.test(s)) continue;
    const label = cleanLabel(s);
    if (!label || /^\d/.test(label)) continue;
    const right = items.filter(o => o !== it && sameLine(o, it) && o.x > it.x1 - 1).sort((p, q) => p.x - q.x)[0];
    const x0 = it.x1 + 6;
    const x1 = right ? right.x - 8 : Math.min(W - 40, x0 + 260);
    if (x1 - x0 < 60) continue;
    const hgt = Math.max(14, it.size * 1.5);
    const type = typeFromLabel(label);
    const rect = { x: x0, y: it.y - hgt + it.size * 0.3, w: x1 - x0, h: type === 'sign' ? Math.max(hgt, 32) : hgt };
    if (type === 'sign') rect.y = it.y - rect.h + it.size * 0.3;
    if (out.some(o => overlap(o, rect) > 0.1)) continue;
    add({ type, ...rect, name: label });
  }
  return out;
}

