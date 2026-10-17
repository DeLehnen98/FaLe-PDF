// GENERATED – synced copy of js/tools/annotpdf.js (hexToRgb copied in, makeSanitizer from formfields.js) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Writes real PDF annotations (with appearance streams) via pdf-lib's low-level API.
// Geometry comes from the annotate UI: text markup quads in PDF user space, everything else
// in page-viewport coordinates at scale 1 (converted here with the page viewport).
import { makeSanitizer } from './formfields.js';
function hexToRgb(hex) {
  const m = String(hex).replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const BASELINE = 0.946; // baseline offset (em) of Helvetica/Arial with line-height 1.2
export const TEXT_PAD = 2; // padding (pt) of free-text boxes
const K = 0.5523; // bezier circle constant

const f = n => String(+(+n).toFixed(3));
const rgb = hex => hexToRgb(hex).map(f).join(' ');

function bboxOf(points, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** Width of text in Helvetica at size (pt), using pdf-lib's standard font metrics. */
export function textMetrics(font, text, size) {
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map(l => font.widthOfTextAtSize(l, size)), size * 0.5);
  return { lines, width: w + TEXT_PAD * 2, height: lines.length * size * 1.2 + TEXT_PAD * 2 };
}

export function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `${f(pts[0][0])} ${f(pts[0][1])} m ${f(pts[0][0] + 0.01)} ${f(pts[0][1])} l`;
  if (pts.length === 2) return `${f(pts[0][0])} ${f(pts[0][1])} m ${f(pts[1][0])} ${f(pts[1][1])} l`;
  let s = `${f(pts[0][0])} ${f(pts[0][1])} m`;
  let p0 = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i];
    const end = [(c[0] + pts[i + 1][0]) / 2, (c[1] + pts[i + 1][1]) / 2];
    const c1 = [p0[0] + (2 / 3) * (c[0] - p0[0]), p0[1] + (2 / 3) * (c[1] - p0[1])];
    const c2 = [end[0] + (2 / 3) * (c[0] - end[0]), end[1] + (2 / 3) * (c[1] - end[1])];
    s += ` ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(end[0])} ${f(end[1])} c`;
    p0 = end;
  }
  const last = pts[pts.length - 1];
  s += ` ${f(last[0])} ${f(last[1])} l`;
  return s;
}

/**
 * @param {object} PDFLib
 * @param {object} pdfDoc  pdf-lib document
 * @param {Array} items    annotations from the UI
 * @param {Array} pages    page infos with .base (pdf.js viewport at scale 1)
 */
export async function writeAnnotations(PDFLib, pdfDoc, items, pages, { assets = null } = {}) {
  const { PDFString, PDFHexString, PDFName, StandardFonts } = PDFLib;
  const ctx = pdfDoc.context;
  const pdfPages = pdfDoc.getPages();
  let font = null, sanitize = null;
  const needFont = items.some(a => a.type === 'text');
  if (needFont) { font = await pdfDoc.embedFont(StandardFonts.Helvetica); sanitize = makeSanitizer(font); }
  const now = PDFString.fromDate(new Date());
  let seq = 0;
  const stamp = Date.now().toString(36);

  const ap = (content, bbox, resources = {}) => ctx.register(ctx.flateStream(content, {
    Type: 'XObject', Subtype: 'Form', BBox: bbox.map(v => +(+v).toFixed(3)), Resources: resources,
  }));
  const gs = (ca, blend) => ({ ExtGState: { GS0: { Type: 'ExtGState', CA: ca, ca, ...(blend ? { BM: blend } : {}) } } });

  for (const a of items) {
    const info = pages[a.page - 1];
    const page = pdfPages[a.page - 1];
    if (!info || !page) continue;
    const V = (x, y) => info.base.convertToPdfPoint(x, y);
    const color = hexToRgb(a.color || '#000000');
    const base = {
      Type: 'Annot', F: 4, C: color.map(v => +v.toFixed(4)), P: page.ref,
    };
    const extra = { NM: PDFString.of(`fale-${stamp}-${++seq}`), M: now, CreationDate: now };
    let dict = null;

    if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strike') {
      const quads = a.quads;
      const pts = [];
      quads.forEach(q => { for (let i = 0; i < 8; i += 2) pts.push([q[i], q[i + 1]]); });
      const rect = bboxOf(pts, 1);
      let content = '';
      if (a.type === 'highlight') {
        content = `/GS0 gs ${rgb(a.color)} rg\n`;
        for (const q of quads) content += `${f(q[0])} ${f(q[1])} m ${f(q[2])} ${f(q[3])} l ${f(q[6])} ${f(q[7])} l ${f(q[4])} ${f(q[5])} l h f\n`;
      } else {
        const t = a.type === 'underline' ? 0.1 : 0.42;
        content = `${rgb(a.color)} RG 1 J\n`;
        for (const q of quads) {
          const hgt = Math.hypot(q[0] - q[4], q[1] - q[5]);
          const lw = Math.max(0.6, hgt * 0.065);
          const sx = q[4] + (q[0] - q[4]) * t, sy = q[5] + (q[1] - q[5]) * t;
          const ex = q[6] + (q[2] - q[6]) * t, ey = q[7] + (q[3] - q[7]) * t;
          content += `${f(lw)} w ${f(sx)} ${f(sy)} m ${f(ex)} ${f(ey)} l S\n`;
        }
      }
      dict = ctx.obj({
        ...base, Subtype: a.type === 'highlight' ? 'Highlight' : a.type === 'underline' ? 'Underline' : 'StrikeOut',
        Rect: rect, QuadPoints: quads.flat().map(v => +v.toFixed(3)), CA: a.type === 'highlight' ? 1 : 1,
        AP: { N: ap(content, rect, a.type === 'highlight' ? gs(0.45, 'Multiply') : {}) },
      });
      if (a.text) dict.set(PDFName.of('Contents'), PDFHexString.fromText(a.text));
    } else if (a.type === 'ink') {
      const w = a.width;
      const paths = a.paths.map(path => path.map(([x, y]) => V(x, y)));
      const rect = bboxOf(paths.flat(), w / 2 + 1);
      let content = `${rgb(a.color)} RG ${f(w)} w 1 J 1 j\n`;
      for (const path of paths) content += smoothPath(path) + ' S\n';
      dict = ctx.obj({
        ...base, Subtype: 'Ink', Rect: rect, BS: { W: w, S: 'S' },
        InkList: paths.map(path => path.flat().map(v => +v.toFixed(3))),
        AP: { N: ap(content, rect) },
      });
    } else if (a.type === 'rect' || a.type === 'ellipse') {
      const w = a.width;
      const corners = [V(a.x0, a.y0), V(a.x1, a.y0), V(a.x0, a.y1), V(a.x1, a.y1)];
      const [x0, y0, x1, y1] = bboxOf(corners);
      const rect = [x0 - w / 2, y0 - w / 2, x1 + w / 2, y1 + w / 2];
      let content = `${rgb(a.color)} RG ${f(w)} w\n`;
      if (a.type === 'rect') content += `${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re S`;
      else {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
        content += `${f(cx + rx)} ${f(cy)} m `
          + `${f(cx + rx)} ${f(cy + K * ry)} ${f(cx + K * rx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c `
          + `${f(cx - K * rx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + K * ry)} ${f(cx - rx)} ${f(cy)} c `
          + `${f(cx - rx)} ${f(cy - K * ry)} ${f(cx - K * rx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c `
          + `${f(cx + K * rx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - K * ry)} ${f(cx + rx)} ${f(cy)} c S`;
      }
      dict = ctx.obj({
        ...base, Subtype: a.type === 'rect' ? 'Square' : 'Circle', Rect: rect, BS: { W: w, S: 'S' },
        AP: { N: ap(content, rect) },
      });
    } else if (a.type === 'line' || a.type === 'arrow') {
      const w = a.width;
      const p0 = V(a.x0, a.y0), p1 = V(a.x1, a.y1);
      const pts = [p0, p1];
      let content = `${rgb(a.color)} RG ${f(w)} w 1 J 1 j\n${f(p0[0])} ${f(p0[1])} m ${f(p1[0])} ${f(p1[1])} l S\n`;
      if (a.type === 'arrow') {
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        const d = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
        const s = Math.max(7, w * 3.5);
        const l = [p1[0] - d[0] * s - d[1] * s * 0.55, p1[1] - d[1] * s + d[0] * s * 0.55];
        const r = [p1[0] - d[0] * s + d[1] * s * 0.55, p1[1] - d[1] * s - d[0] * s * 0.55];
        content += `${f(l[0])} ${f(l[1])} m ${f(p1[0])} ${f(p1[1])} l ${f(r[0])} ${f(r[1])} l S`;
        pts.push(l, r);
      }
      const rect = bboxOf(pts, w + 1);
      dict = ctx.obj({
        ...base, Subtype: 'Line', Rect: rect, L: [p0[0], p0[1], p1[0], p1[1]].map(v => +v.toFixed(3)),
        BS: { W: w, S: 'S' }, LE: ['None', a.type === 'arrow' ? 'OpenArrow' : 'None'],
        AP: { N: ap(content, rect) },
      });
    } else if (a.type === 'text') {
      const text = sanitize(a.text || '').replace(/\s+$/g, '');
      if (!text.trim()) continue;
      const m = textMetrics(font, text, a.size);
      const corners = [V(a.x, a.y), V(a.x + m.width, a.y), V(a.x, a.y + m.height), V(a.x + m.width, a.y + m.height)];
      const rect = bboxOf(corners);
      const o = V(a.x, a.y), ox = V(a.x + 1, a.y);
      const cos = ox[0] - o[0], sin = ox[1] - o[1];
      let content = `BT /Helv ${f(a.size)} Tf ${rgb(a.color)} rg\n`;
      m.lines.forEach((line, i) => {
        if (!line) return;
        const [bx, by] = V(a.x + TEXT_PAD, a.y + TEXT_PAD + a.size * (i * 1.2 + BASELINE));
        content += `${f(cos)} ${f(sin)} ${f(-sin)} ${f(cos)} ${f(bx)} ${f(by)} Tm ${font.encodeText(line).toString()} Tj\n`;
      });
      content += 'ET';
      dict = ctx.obj({
        ...base, Subtype: 'FreeText', Rect: rect, BS: { W: 0 }, Border: [0, 0, 0],
        AP: { N: ap(content, rect, { Font: { Helv: font.ref } }) },
      });
      dict.delete(PDFName.of('C'));
      dict.set(PDFName.of('DA'), PDFString.of(`/Helv ${f(a.size)} Tf ${rgb(a.color)} rg`));
      dict.set(PDFName.of('Contents'), PDFHexString.fromText(a.text));
    } else if (a.type === 'stamp') {
      const as = assets && assets.get(a.asset);
      if (!as) continue;
      if (!as.embedded) as.embedded = await pdfDoc.embedPng(new Uint8Array(await as.blob.arrayBuffer()));
      const x0 = Math.min(a.x0, a.x1), x1 = Math.max(a.x0, a.x1), y0 = Math.min(a.y0, a.y1), y1 = Math.max(a.y0, a.y1);
      // unit square of the image → the box on the (possibly rotated) page
      const o = V(x0, y1), ex = V(x1, y1), ey = V(x0, y0);
      const m = [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
      const rect = bboxOf([V(x0, y0), V(x1, y0), V(x0, y1), V(x1, y1)]);
      const content = `q ${m.map(f).join(' ')} cm /Im0 Do Q`;
      dict = ctx.obj({
        ...base, Subtype: 'Stamp', Rect: rect, Name: 'FaLeStempel',
        AP: { N: ap(content, rect, { XObject: { Im0: as.embedded.ref } }) },
      });
      dict.delete(PDFName.of('C'));
      if (a.name) dict.set(PDFName.of('Contents'), PDFHexString.fromText(a.name));
    } else if (a.type === 'note') {
      const s = 20;
      const corners = [V(a.x, a.y), V(a.x + s, a.y), V(a.x, a.y + s), V(a.x + s, a.y + s)];
      const [x0, y0] = bboxOf(corners);
      const rect = [x0, y0, x0 + s, y0 + s];
      const content = `${rgb(a.color)} rg 0.22 0.23 0.32 RG 0.8 w\n`
        + `${f(x0 + 1.5)} ${f(y0 + 5)} m ${f(x0 + 18.5)} ${f(y0 + 5)} l ${f(x0 + 18.5)} ${f(y0 + 18.5)} l ${f(x0 + 1.5)} ${f(y0 + 18.5)} l ${f(x0 + 1.5)} ${f(y0 + 5)} l h `
        + `${f(x0 + 5)} ${f(y0 + 5)} m ${f(x0 + 4)} ${f(y0 + 1)} l ${f(x0 + 9)} ${f(y0 + 5)} l B\n`
        + `1 w ${f(x0 + 5)} ${f(y0 + 14.5)} m ${f(x0 + 15)} ${f(y0 + 14.5)} l ${f(x0 + 5)} ${f(y0 + 11.5)} m ${f(x0 + 15)} ${f(y0 + 11.5)} l ${f(x0 + 5)} ${f(y0 + 8.5)} m ${f(x0 + 12)} ${f(y0 + 8.5)} l S`;
      dict = ctx.obj({
        ...base, F: 28, Subtype: 'Text', Rect: rect, Name: 'Comment', Open: false,
        AP: { N: ap(content, rect) },
      });
      dict.set(PDFName.of('Contents'), PDFHexString.fromText(a.text || ''));
    }
    if (!dict) continue;
    for (const [k, v] of Object.entries(extra)) dict.set(PDFName.of(k), v);
    page.node.addAnnot(ctx.register(dict));
  }
}
