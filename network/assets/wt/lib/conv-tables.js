// Table detection from text positions (no ruling lines needed) – used by pdf-to-excel and pdf-to-word.
// Lines (from conv-pdfmodel.js: {y, size, items:[{x, w, str, size, bold}]}) are split into "chunks" at
// wide gaps; runs of ≥ 3 consecutive lines with ≥ 2 chunks whose columns line up form a table. Column
// borders come from the x-coverage of the chunks (an empty vertical band = a column gap), like the
// app's PDF → Excel (js/office/pdf2xlsx.js). Lists (bullet/number column) and two-column body text
// are not mistaken for tables.

const LIST_CELL = /^([•●▪■◦○◆►▶➢✓✔–—\-*·]|\(?\d{1,3}[.)]|[a-z][.)])$/i;

// Text measuring for word positions inside a text item (pdf.js joins close glyph runs into one item):
// the ratio of canvas widths gives the x of a word – accurate enough to find a column start.
let measureCtx = null;
const startsCache = new WeakMap(); // item → word starts (alignedEdges and lineChunks ask for the same items again and again)
function wordStarts(it) {
  const hit = startsCache.get(it);
  if (hit && hit.str === it.str && hit.x === it.x && hit.w === it.w) return hit.starts;
  const starts = measureStarts(it);
  startsCache.set(it, { str: it.str, x: it.x, w: it.w, starts });
  return starts;
}
const tokenWidths = new Map(); // font → Map(token → width at 100 px)
function measureStarts(it) {
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(it.str))) words.push(m.index);
  if (words.length < 2) return [{ i: words[0] || 0, x: it.x }];
  if (!measureCtx) measureCtx = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')).getContext('2d');
  const font = `100px ${it.family === 'Times New Roman' ? 'serif' : it.family === 'Courier New' ? 'monospace' : 'sans-serif'}`;
  if (measureCtx.font !== font) measureCtx.font = font;
  let cache = tokenWidths.get(font);
  if (!cache) { cache = new Map(); tokenWidths.set(font, cache); }
  const width = tok => {
    let w = cache.get(tok);
    if (w === undefined) { w = measureCtx.measureText(tok).width; if (cache.size < 50000) cache.set(tok, w); }
    return w;
  };
  // prefix widths from the widths of the single words and gaps (linear instead of measuring every prefix;
  // kerning between tokens is irrelevant for finding a column start)
  const tokens = it.str.match(/\s+|\S+/g) || [];
  const prefix = [];
  let acc = 0, pos = 0;
  for (const tok of tokens) { if (!/\s/.test(tok[0])) prefix.push([pos, acc]); acc += width(tok); pos += tok.length; }
  const total = acc || 1;
  return prefix.map(([i, x]) => ({ i, x: it.x + it.w * (x / total) }));
}

/**
 * Split a line into chunks at wide gaps (> 0.6 em) – or where a word starts at a column edge that many
 * lines of the region share (tight spreadsheet columns, even inside one pdf.js text item).
 */
export function lineChunks(line, align = null) {
  const pieces = [];
  for (const it of line.items.slice().sort((a, b) => a.x - b.x)) {
    if (!it.str.trim()) continue;
    if (align && align.starts.size && /\S\s+\S/.test(it.str)) {
      const ws = wordStarts(it);
      let from = 0, fromX = it.x;
      for (let k = 1; k < ws.length; k++) {
        if (![...align.starts].some(a => Math.abs(a - ws[k].x) <= 2.5)) continue;
        pieces.push({ ...it, str: it.str.slice(from, ws[k].i).trimEnd(), x: fromX, w: ws[k].x - fromX - it.size * 0.25 });
        from = ws[k].i; fromX = ws[k].x;
      }
      pieces.push({ ...it, str: it.str.slice(from), x: fromX, w: it.x + it.w - fromX });
    } else pieces.push(it);
  }
  const chunks = [];
  for (const it of pieces) {
    const last = chunks[chunks.length - 1];
    const gap = last ? it.x - (last.x + last.w) : Infinity;
    const aligned = last && align && gap > 1 && [...align.starts].some(a => Math.abs(a - it.x) <= 2.5);
    if (last && gap < Math.max(2, it.size * 0.6) && !aligned) {
      last.str += (gap > it.size * 0.12 && !/\s$/.test(last.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
      last.w = Math.max(last.w, it.x + it.w - last.x);
      last.bold = last.bold && it.bold;
    } else chunks.push({ x: it.x, w: it.w, str: it.str, bold: !!it.bold, size: it.size });
  }
  for (const c of chunks) c.str = c.str.replace(/\s+/g, ' ').trim();
  return chunks.filter(c => c.str);
}

/** x positions where words start in many lines of a region (column edges; the line start is left out). */
export function alignedEdges(lines) {
  const starts = new Map(), itemStarts = new Map();
  for (const l of lines) {
    const seen = new Set();
    let first = true;
    for (const it of l.items.slice().sort((a, b) => a.x - b.x)) {
      if (!it.str.trim()) continue;
      if (!first) { const x = Math.round(it.x); itemStarts.set(x, (itemStarts.get(x) || 0) + 1); }
      for (const w of wordStarts(it)) {
        if (first) { first = false; continue; }
        const x = Math.round(w.x);
        if (seen.has(x)) continue;
        seen.add(x);
        starts.set(x, (starts.get(x) || 0) + 1);
      }
    }
  }
  const min = Math.max(3, lines.length * 0.3);
  const out = new Set();
  for (const [x] of starts) {
    const near = m => (m.get(x - 2) || 0) + (m.get(x - 1) || 0) + (m.get(x) || 0) + (m.get(x + 1) || 0) + (m.get(x + 2) || 0);
    // a column edge: many lines have a word there, and in some lines a separate text item starts there
    // (so "Person 12" or "12,50 €" – one item in every line – don't become two columns)
    if (near(starts) >= min && near(itemStarts) >= 2) out.add(x);
  }
  return { starts: out };
}

/** Column separators (x positions) from the coverage of the chunks of some lines. */
export function columnSeparators(lineChunkList, minGap = 3) {
  const all = lineChunkList.flat();
  if (!all.length) return [];
  const minX = Math.floor(Math.min(...all.map(c => c.x)));
  const maxX = Math.ceil(Math.max(...all.map(c => c.x + c.w)));
  const cover = new Uint16Array(Math.max(1, maxX - minX + 1));
  for (const chunks of lineChunkList) for (const c of chunks) {
    for (let x = Math.floor(c.x) - minX; x <= Math.ceil(c.x + c.w) - minX; x++) if (x >= 0 && x < cover.length) cover[x]++;
  }
  const limit = Math.max(0, Math.floor(lineChunkList.length * 0.08));
  const seps = [];
  let start = -1;
  for (let x = 0; x < cover.length; x++) {
    if (cover[x] <= limit) { if (start < 0) start = x; }
    else if (start >= 0) { if (x - start >= minGap && start > 0) seps.push(minX + (start + x) / 2); start = -1; }
  }
  return seps;
}

function toRows(chunkLines, seps) {
  const colOf = x => { let i = 0; while (i < seps.length && x > seps[i]) i++; return i; };
  const n = seps.length + 1;
  return chunkLines.map(chunks => {
    const row = new Array(n).fill('');
    for (const c of chunks) {
      const col = colOf(c.x + c.w / 2);
      row[col] = row[col] ? row[col] + ' ' + c.str : c.str;
    }
    return row;
  });
}

const isNumeric = s => /^[-+(]?[\d.,\s]+%?\)?\s*(€|EUR|\$|£|CHF|mm|cm|kg|m|km|h|%)?$/i.test(String(s).trim()) && /\d/.test(s);

/**
 * Detect tables among the lines of one text region.
 * @returns {Array<{top:number, bottom:number, lines:object[], rows:string[][], header:boolean, widths:number[]}>}
 */
export function detectTables(lines, { minRows = 3 } = {}) {
  const tables = [];
  const align = alignedEdges(lines);
  const info = lines.map(l => ({ l, chunks: lineChunks(l, align) }));
  let i = 0;
  while (i < info.length) {
    if (info[i].chunks.length < 2) { i++; continue; }
    // run of multi-chunk lines with normal line spacing
    let j = i + 1;
    while (j < info.length && info[j].chunks.length >= 2 && info[j].l.y - info[j - 1].l.y < Math.max(info[j].l.size, info[j - 1].l.size) * 3.2) j++;
    const run = info.slice(i, j);
    const t = run.length >= minRows ? tableFrom(run) : null;
    if (t) { tables.push(t); i = j; } else i++;
  }
  return tables;
}

function tableFrom(run) {
  const chunkLines = run.map(r => r.chunks);
  const seps = columnSeparators(chunkLines, 2);
  // columns whose cells start at the same x in most rows, even when the gap is too narrow for the coverage
  const startCount = new Map();
  for (const chunks of chunkLines) for (const c of chunks.slice(1)) { const x = Math.round(c.x); startCount.set(x, (startCount.get(x) || 0) + 1); }
  for (const [x, nn] of startCount) {
    const near = (startCount.get(x - 1) || 0) + nn + (startCount.get(x + 1) || 0);
    const sx = x - 1;
    // only where no cell of another row runs across (right-aligned columns start at varying x)
    const crosses = chunkLines.some(chunks => chunks.some(c => c.x < sx - 0.5 && c.x + c.w > sx + 0.5));
    if (near >= chunkLines.length * 0.5 && !crosses && !seps.some(q => Math.abs(q - sx) < 4)) seps.push(sx);
  }
  seps.sort((p, q) => p - q);
  if (!seps.length) return null;
  let rows = toRows(chunkLines, seps);
  // drop columns that stay empty
  const keep = rows[0].map((_, c) => rows.some(r => r[c]));
  rows = rows.map(r => r.filter((_, c) => keep[c]));
  // a header word over right-aligned numbers lands in its own column: join a column that is used by
  // at most one row with its neighbour when they never share a row (debit/credit columns stay apart)
  for (let k = 0; k < rows[0].length - 1; k++) {
    const a = rows.filter(r => r[k]).length, b = rows.filter(r => r[k + 1]).length;
    if ((a <= 1 || b <= 1) && !rows.some(r => r[k] && r[k + 1])) {
      rows = rows.map(r => [...r.slice(0, k), r[k] || r[k + 1], ...r.slice(k + 2)]);
      k--;
    }
  }
  const nCols = rows[0].length;
  if (nCols < 2) return null;
  const filled = rows.filter(r => r.filter(Boolean).length >= 2).length;
  if (filled < rows.length * 0.6) return null;
  // a list (bullet or number in the first column) is not a table
  if (rows.every(r => !r[0] || LIST_CELL.test(r[0]))) return null;
  // two columns of running text (newspaper layout) are not a table
  const all = chunkLines.flat();
  const minX = Math.min(...all.map(c => c.x)), maxX = Math.max(...all.map(c => c.x + c.w));
  const avgW = all.reduce((s, c) => s + c.w, 0) / all.length;
  if (nCols === 2 && avgW > (maxX - minX) * 0.36) return null;
  const longCells = rows.flat().filter(c => c.length > 60).length;
  if (longCells > rows.length * 0.5) return null;
  // header: first row bold, or text over numeric columns
  const first = run[0].chunks;
  const header = first.every(c => c.bold) && !run.slice(1).every(r => r.chunks.every(c => c.bold))
    || (rows[0].every(c => !c || !isNumeric(c)) && rows.slice(1).some(r => r.some(c => c && isNumeric(c))));
  // widths from the separators (percent)
  const bounds = [minX, ...seps.filter((_, k) => keep[k] || keep[k + 1]), maxX];
  let widths = [];
  for (let k = 0; k < bounds.length - 1; k++) widths.push(Math.max(1, bounds[k + 1] - bounds[k]));
  if (widths.length !== nCols) widths = new Array(nCols).fill(1);
  const sum = widths.reduce((a, b) => a + b, 0);
  widths = widths.map(w => (w / sum) * 100);
  const lines = run.map(r => r.l);
  return { top: lines[0].y - lines[0].size, bottom: lines[lines.length - 1].y, lines, rows, header, widths };
}

/** Whole region as rows (every line a row, columns where they line up) – "everything" mode of Excel. */
export function regionRows(lines) {
  const align = alignedEdges(lines);
  const chunkLines = lines.map(l => lineChunks(l, align));
  const multi = chunkLines.filter(c => c.length >= 2);
  if (!multi.length) return chunkLines.map(c => [c.map(x => x.str).join(' ')]);
  const seps = columnSeparators(multi);
  const colOf = x => { let i = 0; while (i < seps.length && x > seps[i]) i++; return i; };
  const n = seps.length + 1;
  return chunkLines.map(chunks => {
    const row = new Array(n).fill('');
    for (const c of chunks) {
      const col = chunks.length === 1 ? colOf(c.x) : colOf(c.x + c.w / 2);
      row[col] = row[col] ? row[col] + ' ' + c.str : c.str;
    }
    return row;
  });
}

/** Typed cell value from text (German/English numbers, %, currency, dates) – port of pdf2xlsx smartValue. */
export function smartValue(s) {
  const t = String(s).trim();
  if (!t) return { v: null };
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    if (d.getUTCMonth() === +m[2] - 1) return { v: d.getTime() / 86400000 + 25569, fmt: 'dd.mm.yyyy' };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (d.getUTCMonth() === +m[2] - 1) return { v: d.getTime() / 86400000 + 25569, fmt: 'yyyy-mm-dd' }; }
  const pct = /%$/.test(t), cur = /€|EUR$/i.test(t), usd = /^\$|\$$/.test(t);
  let core = t.replace(/\s|€|EUR|\$|%/gi, '');
  const neg = /^\(.*\)$/.test(core) || /-$/.test(core) || /^[−–]/.test(core);
  core = core.replace(/^\(|\)$/g, '').replace(/-$/, '').replace(/^[−–]/, '-');
  let v = null;
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(core) || /^[-+]?\d+,\d+$/.test(core)) v = parseFloat(core.replace(/\./g, '').replace(',', '.'));
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(core)) v = parseFloat(core.replace(/,/g, ''));
  else if (/^[-+]?\d+(\.\d+)?$/.test(core) && !/^[-+]?0\d/.test(core)) v = parseFloat(core);
  if (v === null || !Number.isFinite(v)) return { v: t };
  if (neg) v = -Math.abs(v);
  if (pct) return { v: v / 100, fmt: '0.0%' };
  if (cur) return { v, fmt: '#,##0.00 "€"' };
  if (usd) return { v, fmt: '"$"#,##0.00' };
  const dec = (/[.,](\d+)$/.exec(core) || [])[1];
  if (dec && dec.length === 2 && !/^[-+]?\d{1,3}([.,]\d{3})+$/.test(core)) return { v, fmt: '#,##0.00' };
  return { v };
}
