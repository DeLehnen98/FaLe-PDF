// Text geometry from pdf.js text content (copied from the FaLe PDF app, js/tools/textgeom.js – pure
// functions, no app imports): per-character boxes in the page viewport at scale 1 (= the visual frame
// in points, origin top left), used by the PDF editor for "highlight text" and "change text".
let measureCtx = null;
function charWidths(str) {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
    measureCtx.font = '100px Helvetica, Arial, sans-serif';
  }
  const w = [];
  for (const ch of str) w.push(Math.max(1, measureCtx.measureText(ch).width));
  return w;
}

/**
 * @param {object} page   pdf.js page proxy
 * @param {object} base   viewport at scale 1 (with rotation)
 * @returns {Promise<{chars: Array, text: string, map: number[], lines: Array}>}
 */
export async function pageChars(page, base) {
  const content = await page.getTextContent({ includeMarkedContent: false });
  const styles = content.styles || {};
  const chars = [];
  let itemIdx = 0;
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.str.length) continue;
    const st = styles[item.fontName] || {};
    if (st.vertical) continue;
    const [a, b, c, d, e, f] = item.transform;
    const ul = Math.hypot(a, b) || 1;
    const u = [a / ul, b / ul]; // text direction
    let nl = Math.hypot(c, d) || 1;
    let n = [c / nl, d / nl]; // "up" direction
    const fh = item.height || nl;
    let asc = typeof st.ascent === 'number' && st.ascent > 0 ? st.ascent : 0.8;
    let desc = typeof st.descent === 'number' && st.descent < 0 ? st.descent : -0.2;
    if (asc - desc < 0.6) { asc = 0.8; desc = -0.2; }
    const width = item.width || fh * item.str.length * 0.5;
    const chs = Array.from(item.str);
    const ws = charWidths(item.str);
    const total = ws.reduce((s, x) => s + x, 0) || 1;
    let off = 0;
    for (let k = 0; k < chs.length; k++) {
      const w0 = (off / total) * width;
      off += ws[k];
      const w1 = (off / total) * width;
      const P = (t, s) => [e + u[0] * t + n[0] * s * fh, f + u[1] * t + n[1] * s * fh];
      const LL = P(w0, desc), LR = P(w1, desc), UL = P(w0, asc), UR = P(w1, asc);
      const vs = [UL, UR, LL, LR].map(([x, y]) => base.convertToViewportPoint(x, y));
      const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]);
      chars.push({
        ch: chs[k], item: itemIdx, eol: k === chs.length - 1 && !!item.hasEOL,
        quad: [UL[0], UL[1], UR[0], UR[1], LL[0], LL[1], LR[0], LR[1]],
        x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
        u, n, fh, base: [e, f], font: item.fontName, family: st.fontFamily || '',
      });
    }
    itemIdx++;
  }
  // assign line numbers + build plain text with separators
  let line = 0;
  let text = '';
  const map = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (i > 0) {
      const pv = chars[i - 1];
      if (ch.item !== pv.item) {
        const sameLine = sameLineAs(pv, ch);
        if (!sameLine) { line++; text += '\n'; map.push(-1); }
        else {
          const gap = ch.x0 - pv.x1;
          if (gap > pv.fh * 0.15 && pv.ch !== ' ' && ch.ch !== ' ') { text += ' '; map.push(-1); }
        }
      }
    }
    ch.line = line;
    text += ch.ch;
    map.push(i);
  }
  return { chars, text, map };
}

function sameLineAs(a, b) {
  // same direction and baseline within 35 % of the font height
  if (Math.abs(a.u[0] - b.u[0]) > 0.05 || Math.abs(a.u[1] - b.u[1]) > 0.05) return false;
  const dx = b.base[0] - a.base[0], dy = b.base[1] - a.base[1];
  const perp = dx * a.n[0] + dy * a.n[1];
  return Math.abs(perp) < Math.max(a.fh, b.fh) * 0.35;
}

/** Index of the character closest to a viewport point (or -1 if the page has no text). */
export function nearestChar(chars, x, y) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const dx = x < c.x0 ? c.x0 - x : x > c.x1 ? x - c.x1 : 0;
    const dy = y < c.y0 ? c.y0 - y : y > c.y1 ? y - c.y1 : 0;
    const d = dx + dy * 2.5; // prefer the same line
    if (d < bd) { bd = d; best = i; if (d === 0) break; }
  }
  return best;
}

/** Characters in [i, j] → merged quads per line run. */
export function quadsFor(chars, i, j) {
  if (i < 0 || j < 0) return [];
  if (i > j) [i, j] = [j, i];
  const runs = [];
  let cur = null;
  for (let k = i; k <= j; k++) {
    const c = chars[k];
    if (cur && (c.line !== cur.line || !sameLineAs(cur.last, c) || c.x0 < cur.last.x0 - 1)) { runs.push(cur); cur = null; }
    if (!cur) cur = { line: c.line, first: c, last: c };
    else cur.last = c;
  }
  if (cur) runs.push(cur);
  return runs
    // drop runs that are only whitespace
    .filter(r => { for (let k = chars.indexOf(r.first); k <= chars.indexOf(r.last); k++) if (chars[k].ch.trim()) return true; return false; })
    .map(r => {
      const a = r.first.quad, b = r.last.quad;
      // UL, UR, LL, LR
      return [a[0], a[1], b[2], b[3], a[4], a[5], b[6], b[7]];
    });
}

/** Axis-aligned viewport boxes for chars [i..j], merged per run (for previews / redaction). */
export function boxesFor(chars, i, j) {
  if (i < 0 || j < 0) return [];
  if (i > j) [i, j] = [j, i];
  const out = [];
  let cur = null;
  for (let k = i; k <= j; k++) {
    const c = chars[k];
    if (cur && (c.line !== cur.line || c.x0 < cur.x1 - c.fh)) { out.push(cur); cur = null; }
    if (!cur) cur = { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, line: c.line, blank: !c.ch.trim() };
    else { cur.x0 = Math.min(cur.x0, c.x0); cur.y0 = Math.min(cur.y0, c.y0); cur.x1 = Math.max(cur.x1, c.x1); cur.y1 = Math.max(cur.y1, c.y1); if (c.ch.trim()) cur.blank = false; }
  }
  if (cur) out.push(cur);
  return out.filter(b => !b.blank);
}

