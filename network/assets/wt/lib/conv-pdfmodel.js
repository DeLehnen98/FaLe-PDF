// PDF → document model (the block model of the app's Writer, lib/shared/office/docmodel.js), for
// pdf-to-text, pdf-to-markdown and pdf-to-word.
//
// Per page (pdf.js text content + operator list):
//   1. text items with font size / bold / italic (font flags and names, like the app's pdfstruct.js)
//   2. two-column layouts: a vertical gutter that is free of text → left column first, then right
//   3. repeated running heads/footers and page numbers are dropped (when asked)
//   4. lines → paragraphs with headings by font size (pdfstruct.paragraphs, synced from the app)
//   5. bullet / numbered lists, tables (aligned columns over ≥ 3 rows), embedded images at their place
// Scanned pages (no text) can be kept as a page image. Everything stays in reading order.
import { bodySize, paragraphs, fontFamilyOf } from './shared/pdfstruct.js';
import { detectTables } from './conv-tables.js';

const isBoldName = n => /bold|black|heavy|semibold|demi|[-,]bd\b/i.test(n || '');
const isItalicName = n => /italic|oblique|[-,]it\b/i.test(n || '');
const BULLET_RE = /^\s*([•●▪■◦○◆►▶➢✓✔–—\-*·])\s+/;
const NUMBER_RE = /^\s*(\d{1,3}|[a-z]|[ivx]{1,5})([.)])\s+/i;

// characters that XML (DOCX/XLSX) and text files must not contain: C0 controls, non-characters, lone surrogates
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
export const cleanText = s => s.replace(BAD_CHARS, '');

/** Text items of a page in viewport coordinates (top-left origin), with font info. */
async function pageItems(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const fontCache = new Map();
  const fontInfo = id => {
    if (fontCache.has(id)) return fontCache.get(id);
    let f = null;
    try { if (page.commonObjs.has(id)) f = page.commonObjs.get(id); } catch { /* not loaded */ }
    const st = (tc.styles || {})[id] || {};
    const name = f && f.name ? String(f.name) : '';
    const info = { bold: !!(f && (f.bold || f.black)) || isBoldName(name), italic: !!(f && f.italic) || isItalicName(name), family: fontFamilyOf(name, st.fontFamily) };
    fontCache.set(id, info);
    return info;
  };
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.length) continue;
    it.str = cleanText(it.str);
    if (!it.str.length) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2 && Math.abs(c) > Math.abs(d) * 0.2) continue; // rotated text
    const size = Math.hypot(c, d) || it.height || 10;
    const [x, y] = vp.convertToViewportPoint(e, f);
    // rotated pages: convertToViewportPoint already turns the page; widths follow the text direction
    items.push({ str: it.str, x, y, w: it.width || size * it.str.length * 0.5, size, ...fontInfo(it.fontName) });
  }
  return { items, width: vp.width, height: vp.height };
}

/** Find a vertical gutter (two columns): returns the split x or null. */
function findGutter(items, width) {
  const body = items.filter(it => it.str.trim() && it.size < 30);
  if (body.length < 30) return null;
  const minX = Math.min(...body.map(i => i.x)), maxX = Math.max(...body.map(i => i.x + i.w));
  const span = maxX - minX;
  if (span < width * 0.5) return null;
  const N = 200;
  const cover = new Float32Array(N);
  for (const it of body) {
    const a = Math.max(0, Math.floor(((it.x - minX) / span) * N)), b = Math.min(N - 1, Math.floor(((it.x + it.w - minX) / span) * N));
    for (let k = a; k <= b; k++) cover[k] += 1;
  }
  // widest run of (almost) empty buckets in the middle third
  let best = null, start = -1;
  // a few items may cross the gutter (a title over both columns, a centred page number)
  const lineCount = new Set(body.map(i => Math.round(i.y))).size;
  const limit = Math.max(2, lineCount * 0.08);
  for (let k = Math.floor(N * 0.3); k <= Math.ceil(N * 0.7); k++) {
    if (cover[k] <= limit) { if (start < 0) start = k; }
    else if (start >= 0) { if (!best || k - start > best[1] - best[0]) best = [start, k]; start = -1; }
  }
  if (!best || best[1] - best[0] < 3) return null;
  const split = minX + ((best[0] + best[1]) / 2 / N) * span;
  // both sides need real text lines
  const left = body.filter(i => i.x + i.w < split), right = body.filter(i => i.x > split);
  if (left.length < body.length * 0.25 || right.length < body.length * 0.25) return null;
  // running text on both sides (lines of several words) – a table with a wide gap is not a column layout
  const prose = side => {
    const byLine = new Map();
    for (const it of side) { const k = Math.round(it.y / 2); byLine.set(k, (byLine.get(k) || '') + ' ' + it.str); }
    const lines = [...byLine.values()];
    return lines.filter(t => t.trim().split(/\s+/).length >= 4).length >= lines.length * 0.5;
  };
  if (!prose(left) || !prose(right)) return null;
  return split;
}

/** Items → lines with style runs (port of pdfstruct.analysePage steps 2–3, per region). */
function toLines(items) {
  items = items.slice().sort((p, q) => (Math.abs(p.y - q.y) < Math.min(p.size, q.size) * 0.35 ? p.x - q.x : p.y - q.y));
  const lines = [];
  for (const it of items) {
    let line = lines.length ? lines[lines.length - 1] : null;
    if (!line || Math.abs(line.y - it.y) > Math.min(line.size, it.size) * 0.35) {
      line = { y: it.y, size: it.size, items: [], x0: it.x, x1: it.x + it.w };
      lines.push(line);
    }
    line.items.push(it);
    line.x0 = Math.min(line.x0, it.x);
    line.x1 = Math.max(line.x1, it.x + it.w);
    line.size = Math.max(line.size, it.size);
  }
  for (const line of lines) {
    line.items.sort((p, q) => p.x - q.x);
    const runs = [];
    let prev = null;
    for (const it of line.items) {
      let text = it.str;
      if (prev) {
        const gap = it.x - (prev.x + prev.w);
        const spaced = /\s$/.test(prev.str) || /^\s/.test(text);
        if (!spaced && gap > it.size * 0.15) text = (gap > it.size * 3 ? '    ' : ' ') + text;
      }
      const r = runs[runs.length - 1];
      if (r && r.bold === it.bold && r.italic === it.italic && Math.abs(r.size - it.size) < 0.6 && r.family === it.family && r.flag === it.flag) r.text += text;
      else runs.push({ text, bold: it.bold, italic: it.italic, size: it.size, family: it.family, flag: it.flag });
      prev = it;
    }
    runs.forEach(r => { r.text = r.text.replace(/\s+/g, m => (m.length >= 4 ? '\t' : ' ')); });
    if (runs.length) { runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, ''); runs[0].text = runs[0].text.replace(/^\s+/, ''); }
    line.runs = runs.filter(r => r.text);
    line.text = line.runs.map(r => r.text).join('');
    line.bold = line.runs.length > 0 && line.runs.every(r => r.bold || !r.text.trim());
  }
  return lines.filter(l => l.text.trim());
}

/** Placed raster images of a page (operator list + CTM tracking) – positions in viewport coords. */
async function pageImages(page, lib, { minPt = 28 } = {}) {
  const OPS = lib.OPS;
  const vp = page.getViewport({ scale: 1 });
  const list = await page.getOperatorList();
  const out = [];
  const stack = [];
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i], args = list.argsArray[i];
    if (fn === OPS.save) stack.push(m);
    else if (fn === OPS.restore) m = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) m = mul(m, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(m); if (Array.isArray(args[0]) && args[0].length === 6) m = mul(m, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) m = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.paintImageXObject && typeof args[0] === 'string') {
      // unit square → page space
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => vp.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (box.w < minPt || box.h < minPt) continue;
      if (out.some(o => o.id === args[0] && Math.abs(o.box.y - box.y) < 1)) continue;
      out.push({ id: args[0], box });
    }
  }
  return out;
}

async function imageDataUrl(page, id, box, { maxSide = 1800 } = {}) {
  const objs = id.startsWith('g_') ? page.commonObjs : page.objs;
  const obj = await new Promise(resolve => { try { objs.get(id, resolve); } catch { resolve(null); } setTimeout(() => resolve(null), 10000); });
  if (!obj || !obj.width) return null;
  // no more pixels than needed for 200 dpi at the drawn size
  const want = Math.min(maxSide, Math.max(box.w, box.h) * (200 / 72));
  const s = Math.min(1, want / Math.max(obj.width, obj.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(obj.width * s)); c.height = Math.max(1, Math.round(obj.height * s));
  const g = c.getContext('2d');
  let alpha = false;
  if (obj.bitmap) g.drawImage(obj.bitmap, 0, 0, c.width, c.height);
  else if (obj.data) {
    const full = document.createElement('canvas');
    full.width = obj.width; full.height = obj.height;
    full.getContext('2d').putImageData(rawToImageData(obj), 0, 0);
    g.drawImage(full, 0, 0, c.width, c.height);
    alpha = obj.kind === 3;
    full.width = full.height = 0;
  } else return null;
  if (obj.bitmap || alpha) { // keep PNG when there is real transparency
    const d = g.getImageData(0, 0, Math.min(c.width, 64), Math.min(c.height, 64)).data;
    alpha = false;
    for (let k = 3; k < d.length; k += 4) if (d[k] < 250) { alpha = true; break; }
  }
  const url = c.toDataURL(alpha ? 'image/png' : 'image/jpeg', 0.88);
  c.width = c.height = 0;
  return url;
}

function rawToImageData(obj) {
  const { width: w, height: h, data, kind } = obj;
  const out = new ImageData(w, h);
  const px = out.data;
  if (kind === 3) px.set(data.subarray(0, w * h * 4));
  else if (kind === 2) for (let i = 0, j = 0; i < w * h; i++, j += 3) { px[i * 4] = data[j]; px[i * 4 + 1] = data[j + 1]; px[i * 4 + 2] = data[j + 2]; px[i * 4 + 3] = 255; }
  else {
    const rb = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (data[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255; }
  }
  return out;
}

const norm = s => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Analyse pages → page records {width, height, regions:[{lines}], images, chars, tables}.
 * @param {object} pdf  pdf.js document
 * @param {number[]} indices  0-based pages
 */
/**
 * Page record from positioned text items (top-left origin, points) – used for OCR results (image-to-word):
 * items { str, x, y (baseline), w, size, bold?, italic?, family?, flag? }.
 */
export function analyseItems(items, width, height, index = 0) {
  items = items.map(i => ({ bold: false, italic: false, family: 'Arial', ...i, str: cleanText(i.str) })).filter(i => i.str);
  const split = findGutter(items, width);
  let regions;
  if (split) {
    const cross = items.filter(i => i.x < split && i.x + i.w > split);
    const colItems = items.filter(i => !cross.includes(i));
    const ys = colItems.map(i => i.y).sort((p, q) => p - q);
    const top = ys.length ? ys[Math.floor(ys.length / 2)] : 0;
    regions = [
      { lines: toLines(cross.filter(i => i.y <= top)) },
      { lines: toLines(colItems.filter(i => i.x + i.w / 2 < split)) },
      { lines: toLines(colItems.filter(i => i.x + i.w / 2 >= split)) },
      { lines: toLines(cross.filter(i => i.y > top)) },
    ].filter(r => r.lines.length);
  } else regions = [{ lines: toLines(items) }];
  const chars = items.reduce((s, i) => s + i.str.replace(/\s/g, '').length, 0);
  return { index, width, height, regions, chars, columns: !!split, images: [] };
}

export async function analysePdf(pdf, indices, ctx, { images = false, onPage = null } = {}) {
  const lib = images ? await (await import('./pdf.js')).loadPdfjs() : null;
  const pages = [];
  for (let k = 0; k < indices.length; k++) {
    onPage?.(k, indices.length);
    const page = await pdf.getPage(indices[k] + 1);
    if (images) { try { await page.getOperatorList(); } catch { /* fonts for bold detection */ } }
    const { items, width, height } = await pageItems(page);
    const split = findGutter(items, width);
    let regions;
    if (split) {
      // full-width items (titles across both columns) above/below the column part stay in order
      const cross = items.filter(i => i.x < split && i.x + i.w > split);
      const colItems = items.filter(i => !cross.includes(i));
      const ys = colItems.map(i => i.y).sort((p, q) => p - q);
      const top = ys.length ? ys[Math.floor(ys.length / 2)] : 0;   // median: above = title, below = footer
      regions = [
        { lines: toLines(cross.filter(i => i.y <= top)) },
        { lines: toLines(colItems.filter(i => i.x + i.w / 2 < split)) },
        { lines: toLines(colItems.filter(i => i.x + i.w / 2 >= split)) },
        { lines: toLines(cross.filter(i => i.y > top)) },
      ].filter(r => r.lines.length);
    } else regions = [{ lines: toLines(items) }];
    const chars = items.reduce((s, i) => s + i.str.replace(/\s/g, '').length, 0);
    let imgs = [];
    if (images && lib) {
      try { imgs = await pageImages(page, lib); } catch (err) { console.warn(err); }
      for (const im of imgs) { try { im.src = await imageDataUrl(page, im.id, im.box); } catch { im.src = null; } }
      imgs = imgs.filter(im => im.src);
    }
    pages.push({ index: indices[k], width, height, regions, chars, columns: !!split, images: imgs, page });
    if (!images) page.cleanup();
    await ctx.tick();
  }
  return pages;
}

/** Remove running heads/footers and page numbers that repeat over the pages. */
export function dropRunningLines(pages) {
  if (pages.length < 3) return 0;
  const counts = new Map();
  const body = bodySize(pages.flatMap(p => p.regions));
  const zone = (p, l) => (l.y < p.height * 0.08 || l.y > p.height * 0.92) && l.size <= body * 1.08;
  for (const p of pages) {
    const seen = new Set();
    for (const r of p.regions) for (const l of r.lines) if (zone(p, l)) { const k = norm(l.text); if (k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); } }
  }
  let dropped = 0;
  const minPages = Math.max(3, Math.ceil(pages.length * 0.5));
  for (const p of pages) for (const r of p.regions) {
    const before = r.lines.length;
    r.lines = r.lines.filter(l => !(zone(p, l) && ((counts.get(norm(l.text)) || 0) >= minPages || /^(seite|page|s\.)?\s*#(\s*(von|of|\/)\s*#)?$/.test(norm(l.text)))));
    dropped += before - r.lines.length;
  }
  return dropped;
}

const runOf = (r, body, heading) => {
  const o = { text: r.text };
  if (!heading) {
    if (r.bold) o.b = true;
    if (Math.abs(r.size - body) > 1.2) o.size = Math.round(r.size * 2) / 2;
    if (r.family && r.family !== 'Arial') o.font = r.family;
    if (r.family === 'Courier New') o.mono = true;
  }
  if (r.italic) o.i = true;
  if (r.flag) o.bg = '#FFF1A8';   // OCR: uncertain word – check it
  return o;
};

/**
 * Page records → docmodel { blocks, baseSize }.
 * options: tables (detect tables), images (place images), pageBreaks, scanImages (map → dataURL per page index)
 */
export function buildModel(pages, { tables = true, pageBreaks = true, scanImages = null } = {}) {
  const body = bodySize(pages.flatMap(p => p.regions.map(r => ({ lines: r.lines }))));
  const blocks = [];
  let listSeq = 0;
  const stats = { paragraphs: 0, headings: 0, lists: 0, tables: 0, images: 0, scanned: 0, columns: 0 };
  pages.forEach((p, pi) => {
    if (pi > 0 && pageBreaks) blocks.push({ type: 'pagebreak' });
    if (p.columns) stats.columns++;
    if (p.chars < 15 && scanImages && scanImages.has(p.index)) {
      const src = scanImages.get(p.index);
      blocks.push({ type: 'para', tag: 'p', align: 'center', runs: [{ img: { src: src.url, w: src.w, h: src.h } }] });
      stats.scanned++;
      return;
    }
    // flow elements with a y position (per region), then merged in region order
    for (const region of p.regions) {
      const flow = [];
      let lines = region.lines;
      if (tables) {
        const found = detectTables(lines);
        for (const t of found) {
          flow.push({ y: t.top, block: tableBlock(t, body) });
          stats.tables++;
        }
        const used = new Set(found.flatMap(t => t.lines));
        lines = lines.filter(l => !used.has(l));
      }
      // paragraphs on consecutive line groups (tables split the flow)
      const groups = [];
      let cur = [];
      const sortedTables = flow.map(f => f.y).sort((a, b) => a - b);
      for (const l of lines) {
        if (cur.length && sortedTables.some(ty => ty > cur[cur.length - 1].y && ty < l.y)) { groups.push(cur); cur = []; }
        cur.push(l);
      }
      if (cur.length) groups.push(cur);
      for (const g of groups) {
        const paras = paragraphs({ lines: g }, body);
        let list = null;
        for (const para of paras) {
          const block = paraBlock(para, body);
          const y = para.top;
          const bm = BULLET_RE.exec(para.text), nm = NUMBER_RE.exec(para.text);
          if ((bm || nm) && !para.heading) {
            const ordered = !bm;
            const level = para.indent > body * 2.5 ? 1 : 0;
            if (!list || list.ordered !== ordered) list = { ordered, id: `pl${++listSeq}`, n: 0 };
            list.n++;
            stripPrefix(block, (bm || nm)[0]);
            const idx = ordered ? (parseInt(nm[1], 10) || list.n) : list.n;
            block.list = { ordered, level, index: idx, type: ordered && /^[a-z]$/i.test(nm[1]) ? 'a' : '1', id: list.id, root: list.id };
            delete block.indent;
            stats.lists++;
          } else list = null;
          if (block.tag !== 'p') stats.headings++; else stats.paragraphs++;
          flow.push({ y, block });
        }
      }
      if (region === p.regions[p.regions.length - 1] || p.regions.length === 1) {
        for (const im of p.images || []) {
          // image directly in the flow at its vertical position (width in px, max. text width)
          const maxW = p.width * 0.86;
          const s = Math.min(1, maxW / im.box.w);
          flow.push({ y: im.box.y, block: { type: 'para', tag: 'p', align: im.box.x + im.box.w / 2 > p.width * 0.4 && im.box.x + im.box.w / 2 < p.width * 0.6 ? 'center' : undefined, runs: [{ img: { src: im.src, w: Math.round(im.box.w * s * 96 / 72), h: Math.round(im.box.h * s * 96 / 72) } }] } });
          stats.images++;
        }
      }
      flow.sort((a, b) => a.y - b.y);
      blocks.push(...flow.map(f => f.block));
    }
  });
  stats.pages = pages.length;
  return { model: { blocks, baseSize: Math.round(body * 2) / 2 }, stats, body };
}

function paraBlock(para, body) {
  const tag = para.heading ? `h${para.heading}` : 'p';
  const runs = para.runs.map(r => runOf(r, body, !!para.heading));
  const b = { type: 'para', tag, runs };
  if (para.align && para.align !== 'left') b.align = para.align;
  if (para.indent > 6 && para.align === 'left') b.indent = Math.round(Math.min(para.indent, 200));
  return b;
}

function stripPrefix(block, prefix) {
  let left = prefix.length;
  // the prefix may span runs; trim it from the start
  while (left > 0 && block.runs.length) {
    const r = block.runs[0];
    const t = r.text || '';
    const lead = t.length - t.trimStart().length;
    if (t.length <= left + lead && t.trim().length <= left) { left -= t.length; block.runs.shift(); continue; }
    r.text = t.trimStart().slice(Math.max(0, left - lead)).trimStart();
    left = 0;
  }
  if (block.runs[0]) block.runs[0].text = block.runs[0].text.replace(/^\s+/, '');
}

function tableBlock(t, body) {
  const rows = t.rows.map((row, ri) => row.map(cell => ({
    blocks: [{ type: 'para', tag: 'p', runs: cell ? [{ text: cell, ...(ri === 0 && t.header ? { b: true } : {}) }] : [] }],
    colspan: 1, rowspan: 1, header: ri === 0 && t.header,
  })));
  const cols = t.rows[0]?.length || 1;
  return { type: 'table', rows, widths: t.widths || new Array(cols).fill(100 / cols), cols, headerRows: t.header ? 1 : 0, borderless: false, baseSize: body };
}

// ---------------------------------------------------------------- plain text and Markdown writers
const listMark = l => (l.ordered ? `${l.type === 'a' ? String.fromCharCode(96 + Math.min(26, l.index)) : l.index}. ` : '• ');
const paraText = b => b.runs.map(r => (r.br ? '\n' : r.text || '')).join('');

/** Plain text: paragraphs separated by an empty line, tables tab separated, optional page markers. */
export function modelToPlainText(model, { pageMarks = true, lang = 'de' } = {}) {
  const out = [];
  let page = 1;
  let prevList = false;
  for (const b of model.blocks) {
    if (b.type === 'pagebreak') {
      page++;
      if (pageMarks) out.push('', `—— ${lang === 'de' ? 'Seite' : 'Page'} ${page} ——`, '');
      else out.push('');
      prevList = false;
      continue;
    }
    if (b.type === 'table') {
      if (out.length && out[out.length - 1] !== '') out.push('');
      for (const row of b.rows) out.push(row.map(c => c.blocks.map(paraText).join(' ').trim()).join('\t'));
      out.push('');
      prevList = false;
      continue;
    }
    if (b.type !== 'para') continue;
    const text = paraText(b).trim();
    if (!text) continue;
    if (b.list) {
      if ((!prevList || prevList !== b.list.root) && out.length && out[out.length - 1] !== '') out.push('');
      out.push('  '.repeat(b.list.level) + listMark(b.list) + text);
      prevList = b.list.root;
      continue;
    }
    if (prevList) out.push('');
    prevList = false;
    out.push(text, '');
  }
  if (pageMarks && model.blocks.some(b => b.type === 'pagebreak')) out.unshift(`—— ${lang === 'de' ? 'Seite' : 'Page'} 1 ——`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Markdown (headings by size, lists, tables, bold/italic). Images are not embedded. */
export function modelToMd(model, { pageMarks = false } = {}) {
  const esc = t => t.replace(/([\\`*_[\]#<>|])/g, '\\$1').replace(/^(\s*)([-+]|\d+\.)\s/, '$1\\$2 ');
  const inline = runs => {
    let s = '';
    for (const r of runs) {
      if (r.br) { s += '  \n'; continue; }
      if (r.img || r.text == null) continue;
      const m = /^(\s*)(.*?)(\s*)$/s.exec(r.text);
      let t = esc(m[2]);
      if (!t) { s += r.text; continue; }
      if (r.mono) t = '`' + m[2].replace(/`/g, "'") + '`';
      if (r.b && r.i) t = `***${t}***`; else if (r.b) t = `**${t}**`; else if (r.i) t = `*${t}*`;
      s += m[1] + t + m[3];
    }
    return s.replace(/\*\*\s*\*\*/g, ' ').replace(/\t/g, ' ').trim();
  };
  const out = [];
  let page = 1;
  let prevList = false;
  for (const b of model.blocks) {
    if (b.type === 'pagebreak') { page++; if (pageMarks) out.push('', '---', ''); prevList = false; continue; }
    if (b.type === 'table') {
      if (prevList) out.push('');
      const cell = c => c.blocks.map(x => inline(c.header ? x.runs.map(r => ({ ...r, b: false })) : x.runs)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
      const rows = b.rows.map(r => '| ' + r.map(cell).join(' | ') + ' |');
      rows.splice(1, 0, '|' + ' --- |'.repeat(b.cols));
      out.push('', ...rows, '');
      prevList = false;
      continue;
    }
    if (b.type !== 'para') continue;
    const text = inline(b.runs);
    if (!text) continue;
    if (/^h[1-6]$/.test(b.tag)) { out.push('', '#'.repeat(+b.tag[1]) + ' ' + text.replace(/\*+/g, ''), ''); prevList = false; continue; }
    if (b.list) {
      if (prevList !== b.list.root) out.push('');
      out.push('   '.repeat(b.list.level) + (b.list.ordered ? `${b.list.index}. ` : '- ') + text);
      prevList = b.list.root;
      continue;
    }
    if (prevList) out.push('');
    prevList = false;
    out.push(text, '');
  }
  void page;
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
