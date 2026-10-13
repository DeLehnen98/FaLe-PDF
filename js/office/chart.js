// Diagramme für Tabellen: Daten aus einem Bereich, SVG-Rendering (Raster, PDF, Vorschau) und Einfüge-/Bearbeiten-Dialog.
import { $, $$, h, esc, toast, openDialog } from '../ui.js';
import { oicon } from './kinds.js';
import { KEY } from './workbook.js';
import { parseRangeAddr, colName } from './formula.js';

export const CHART_TYPES = [
  { id: 'col', label: 'Säulen' }, { id: 'bar', label: 'Balken' }, { id: 'line', label: 'Linie' },
  { id: 'pie', label: 'Kreis' }, { id: 'area', label: 'Fläche' }, { id: 'scatter', label: 'Punkte' },
];
// validated categorical palette (fixed order, light / dark steps)
const CAT_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const CAT_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const PALETTES = {
  standard: { label: 'Standard', light: CAT_LIGHT, dark: CAT_DARK },
  blau: { label: 'Blautöne', light: ['#184f95', '#2a78d6', '#5598e7', '#86b6ef', '#104281', '#3987e5', '#6da7ec', '#9ec5f4'], dark: ['#3987e5', '#86b6ef', '#2a78d6', '#b7d3f6', '#5598e7', '#cde2fb', '#6da7ec', '#9ec5f4'] },
  marke: { label: 'FaLe', light: ['#3B37A0', '#0B8F80', '#E8613C', '#2F67D8', '#C23A7B', '#15895A', '#8A4FD0', '#D99A06'], dark: ['#8E8AF7', '#2DD4BF', '#F08A63', '#6C9BEF', '#E27AAB', '#4CC38A', '#B48AF0', '#F5C04A'] },
};
const SURF = { light: { bg: '#FFFFFF', text: '#15172F', text2: '#52514e', grid: '#E6E7EE', axis: '#C9CCDA' }, dark: { bg: '#171932', text: '#ECEDF8', text2: '#A9ACCC', grid: '#2A2D4C', axis: '#3A3E66' } };

export function newChartId() { return 'ch' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ---------------- data ----------------
function cellVal(sh, r, c) {
  const cell = sh.cells.get(KEY(r, c));
  if (!cell) return null;
  const v = cell.f ? cell.cv : cell.v;
  return v && typeof v === 'object' ? null : v;
}
function sheetByName(wb, name, fallback) {
  if (!name) return fallback;
  const n = String(name).replace(/^'|'$/g, '').replace(/''/g, "'").toLowerCase();
  return wb.sheets.find(s => s.name.toLowerCase() === n) || fallback;
}
/** "Tabelle1!$A$2:$A$6" → { sh, r1, c1, r2, c2 } */
export function resolveRef(wb, sh, ref) {
  if (!ref) return null;
  const m = /^(?:(.+)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)$/.exec(String(ref).trim());
  if (!m) return null;
  const rg = parseRangeAddr(m[2].replace(/\$/g, ''));
  if (!rg) return null;
  return { sh: sheetByName(wb, m[1], sh), ...rg };
}
function refValues(wb, sh, ref, { num = true } = {}) {
  const r = resolveRef(wb, sh, ref);
  if (!r) return [];
  const out = [];
  for (let rr = r.r1; rr <= r.r2; rr++) for (let cc = r.c1; cc <= r.c2; cc++) {
    const v = cellVal(r.sh, rr, cc);
    out.push(num ? (typeof v === 'number' && Number.isFinite(v) ? v : null) : (v == null ? '' : String(typeof v === 'number' ? fmtNum(v) : v)));
  }
  return out;
}
const isText = v => typeof v === 'string' && v.trim() !== '' && !/^-?[\d.,]+$/.test(v.trim());

/** Derive explicit series refs from a data range (header row / category column detection like spreadsheet apps). */
export function seriesFromRange(sh, range, byRows = null, type = 'col') {
  const rg = parseRangeAddr(String(range || '').replace(/\$/g, ''));
  if (!rg) return null;
  let { r1, c1, r2, c2 } = rg;
  r2 = Math.min(r2, Math.max(r1, sh.maxR)); c2 = Math.min(c2, Math.max(c1, sh.maxC));
  let headRow = false, headCol = false;
  for (let c = c1 + (c2 > c1 ? 1 : 0); c <= c2; c++) if (isText(cellVal(sh, r1, c))) headRow = true;
  for (let r = r1 + (headRow ? 1 : 0); r <= r2; r++) if (isText(cellVal(sh, r, c1)) || (type === 'scatter' && c2 > c1)) headCol = true;
  if (c1 === c2) headCol = false;
  if (r1 === r2) headRow = false;
  const dr1 = r1 + (headRow ? 1 : 0), dc1 = c1 + (headCol ? 1 : 0);
  const rows = r2 - dr1 + 1, cols = c2 - dc1 + 1;
  if (byRows == null) byRows = type !== 'scatter' && cols > rows && rows > 0;
  const q = `'${sh.name.replace(/'/g, "''")}'`;
  const A = (r, c) => `$${colName(c)}$${r + 1}`;
  const series = [];
  if (!byRows) {
    for (let c = dc1; c <= c2; c++) series.push({ name: headRow ? `${q}!${A(r1, c)}` : null, cat: headCol ? `${q}!${A(dr1, c1)}:${A(r2, c1)}` : null, val: `${q}!${A(dr1, c)}:${A(r2, c)}`, label: headRow ? null : `Reihe ${series.length + 1}` });
  } else {
    for (let r = dr1; r <= r2; r++) series.push({ name: headCol ? `${q}!${A(r, c1)}` : null, cat: headRow ? `${q}!${A(r1, dc1)}:${A(r1, c2)}` : null, val: `${q}!${A(r, dc1)}:${A(r, c2)}`, label: headCol ? null : `Reihe ${series.length + 1}` });
  }
  return { series, byRows };
}

/** Resolve a chart model to plain data: { cats: string[], series: [{ name, values, color, x? }] } */
export function chartData(wb, sh, chart, mode = 'light') {
  let list = chart.series;
  if (!list || !list.length) { const d = seriesFromRange(sh, chart.range, chart.byRows, chart.type); list = d ? d.series : []; }
  const pal = (PALETTES[chart.palette] || PALETTES.standard)[mode];
  let cats = [];
  const series = list.map((s, i) => {
    const values = refValues(wb, sh, s.val);
    if (s.cat && !cats.length) cats = refValues(wb, sh, s.cat, { num: false });
    const xs = chart.type === 'scatter' && s.cat ? refValues(wb, sh, s.cat) : null;
    let name = s.label || `Reihe ${i + 1}`;
    if (s.name) { const n = /!|\$/.test(s.name) ? refValues(wb, sh, s.name, { num: false })[0] : s.name; if (n) name = String(n); }
    const color = (chart.colors && chart.colors[i]) || s.color || pal[i % pal.length];
    return { name, values, color, xs };
  }).filter(s => s.values.length);
  const n = Math.max(0, ...series.map(s => s.values.length));
  if (!cats.length) cats = Array.from({ length: n }, (_, i) => String(i + 1));
  return { cats: cats.slice(0, n), series };
}

// ---------------- formatting ----------------
const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
export function fmtNum(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return nf.format(+(v / 1e9).toFixed(1)) + ' Mrd.';
  if (a >= 1e6) return nf.format(+(v / 1e6).toFixed(1)) + ' Mio.';
  if (a >= 1e4) return nf.format(+(v / 1e3).toFixed(1)) + ' Tsd.';
  return nf.format(+v.toPrecision(10));
}
function niceTicks(min, max, count = 5) {
  if (min === max) { if (min === 0) return { lo: 0, hi: 1, step: 0.2 }; min = Math.min(0, min); max = Math.max(0, max); if (min === max) max = min + 1; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}
const tw = (s, px = 12) => String(s).length * px * 0.56;
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ---------------- SVG ----------------
/** Render chart data as an SVG string (w × h px). mode: 'light' | 'dark'. */
export function chartSvg(chart, data, { w = 480, h = 300, mode = 'light' } = {}) {
  const S = SURF[mode] || SURF.light;
  const type = chart.type || 'col';
  const out = [];
  const font = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif"';
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${font} role="img" aria-label="${esc(chart.title || 'Diagramm')}">`);
  out.push(`<rect width="${w}" height="${h}" fill="${S.bg}"/>`);
  let top = 12, bottom = h - 10, left = 12, right = w - 12;
  if (chart.title) { out.push(`<text x="${w / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="${S.text}">${esc(clip(chart.title, Math.floor(w / 9)))}</text>`); top = 40; }
  const series = data.series;
  const pie = type === 'pie';
  const legendItems = pie ? data.cats.map((c, i) => ({ name: c, color: (series[0] && series[0].color && chart.colors && chart.colors[i]) || ((PALETTES[chart.palette] || PALETTES.standard)[mode][i % 8]) })) : series.map(s => ({ name: s.name, color: s.color }));
  const legend = chart.legend || 'r';
  const showLegend = legend !== 'none' && (pie || series.length > 1 || legend !== 'r');
  if (showLegend && legendItems.length) {
    if (legend === 'r') {
      const lw = Math.min(w * 0.32, Math.max(...legendItems.map(l => tw(clip(l.name, 22), 12))) + 26);
      const lx = w - lw - 6;
      const ly0 = Math.max(top, (top + bottom) / 2 - legendItems.length * 10);
      legendItems.slice(0, 14).forEach((l, i) => out.push(`<g><rect x="${lx}" y="${ly0 + i * 20 + 3}" width="10" height="10" rx="2" fill="${l.color}"/><text x="${lx + 16}" y="${ly0 + i * 20 + 12}" font-size="12" fill="${S.text2}">${esc(clip(l.name, 22))}</text></g>`));
      right = lx - 12;
    } else {
      // top or bottom row(s)
      let x = 0, rows = [[]];
      legendItems.slice(0, 20).forEach(l => { const iw = tw(clip(l.name, 18), 12) + 30; if (x + iw > w - 24 && rows[rows.length - 1].length) { rows.push([]); x = 0; } rows[rows.length - 1].push({ ...l, iw }); x += iw; });
      const lh = rows.length * 18;
      const y0 = legend === 'b' ? h - 8 - lh : top;
      rows.forEach((row, ri) => {
        const total = row.reduce((a, l) => a + l.iw, 0);
        let xx = (w - total) / 2;
        row.forEach(l => { out.push(`<rect x="${xx}" y="${y0 + ri * 18 + 3}" width="10" height="10" rx="2" fill="${l.color}"/><text x="${xx + 15}" y="${y0 + ri * 18 + 12}" font-size="12" fill="${S.text2}">${esc(clip(l.name, 18))}</text>`); xx += l.iw; });
      });
      if (legend === 'b') bottom = y0 - 8; else top = y0 + lh + 8;
    }
  }
  if (!series.length || !series.some(s => s.values.some(v => v != null))) {
    out.push(`<text x="${w / 2}" y="${(top + bottom) / 2}" text-anchor="middle" font-size="13" fill="${S.text2}">Keine Zahlen im gewählten Bereich</text></svg>`);
    return out.join('');
  }
  if (pie) {
    const s = series[0];
    const vals = s.values.map(v => (v && v > 0 ? v : 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = (left + right) / 2, cy = (top + bottom) / 2, r = Math.max(10, Math.min(right - left, bottom - top) / 2 - 6);
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!v) return;
      const a1 = a0 + (v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
      const d = v === total ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0` : `M${cx},${cy}L${p(a0)}A${r},${r} 0 ${large},1 ${p(a1)}Z`;
      out.push(`<path d="${d}" fill="${legendItems[i] ? legendItems[i].color : s.color}" stroke="${S.bg}" stroke-width="2"><title>${esc(data.cats[i] || '')}: ${fmtNum(v)} (${Math.round(v / total * 100)} %)</title></path>`);
      const mid = (a0 + a1) / 2;
      if (v / total > 0.06) out.push(`<text x="${(cx + r * 0.62 * Math.cos(mid)).toFixed(1)}" y="${(cy + r * 0.62 * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${Math.round(v / total * 100)} %</text>`);
      a0 = a1;
    });
    out.push('</svg>');
    return out.join('');
  }
  // axes
  const horiz = type === 'bar';
  const scatter = type === 'scatter';
  const allV = series.flatMap(s => s.values).filter(v => v != null);
  const yt = niceTicks(Math.min(0, ...allV), Math.max(0, ...allV));
  let xt = null;
  if (scatter) { const xs = series.flatMap(s => s.xs || s.values.map((_, i) => i + 1)).filter(v => v != null); xt = niceTicks(Math.min(...xs), Math.max(...xs)); }
  const yLabels = [];
  for (let v = yt.lo; v <= yt.hi + yt.step / 2; v += yt.step) yLabels.push(+v.toPrecision(12));
  const catLabelW = horiz ? Math.min(w * 0.3, Math.max(...data.cats.map(c => tw(clip(c, 16), 12)))) + 8 : 0;
  const valLabelW = Math.max(...yLabels.map(v => tw(fmtNum(v), 11))) + 8;
  if (chart.yTitle) left += 18;
  if (chart.xTitle) bottom -= 18;
  left += horiz ? catLabelW : valLabelW;
  bottom -= 20;
  const pw = Math.max(10, right - left), ph = Math.max(10, bottom - top);
  const vToPx = v => (horiz ? left + ((v - yt.lo) / (yt.hi - yt.lo)) * pw : bottom - ((v - yt.lo) / (yt.hi - yt.lo)) * ph);
  // grid + value labels
  yLabels.forEach(v => {
    const p = vToPx(v);
    if (horiz) { out.push(`<line x1="${p}" y1="${top}" x2="${p}" y2="${bottom}" stroke="${S.grid}" stroke-width="1"/><text x="${p}" y="${bottom + 15}" text-anchor="middle" font-size="11" fill="${S.text2}">${fmtNum(v)}</text>`); }
    else { out.push(`<line x1="${left}" y1="${p}" x2="${right}" y2="${p}" stroke="${S.grid}" stroke-width="1"/><text x="${left - 6}" y="${p + 4}" text-anchor="end" font-size="11" fill="${S.text2}">${fmtNum(v)}</text>`); }
  });
  const zero = vToPx(Math.max(yt.lo, Math.min(0, yt.hi)));
  if (horiz) out.push(`<line x1="${zero}" y1="${top}" x2="${zero}" y2="${bottom}" stroke="${S.axis}" stroke-width="1"/>`);
  else out.push(`<line x1="${left}" y1="${zero}" x2="${right}" y2="${zero}" stroke="${S.axis}" stroke-width="1"/>`);
  if (chart.yTitle) out.push(`<text transform="translate(16 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="${S.text2}">${esc(clip(chart.yTitle, 40))}</text>`);
  if (chart.xTitle) out.push(`<text x="${(left + right) / 2}" y="${h - 10 - (legend === 'b' && showLegend ? (h - bottom - 58) : 0)}" text-anchor="middle" font-size="12" fill="${S.text2}">${esc(clip(chart.xTitle, 60))}</text>`);
  const n = data.cats.length;
  if (scatter) {
    const xPx = v => left + ((v - xt.lo) / (xt.hi - xt.lo)) * pw;
    for (let v = xt.lo; v <= xt.hi + xt.step / 2; v += xt.step) out.push(`<text x="${xPx(v)}" y="${bottom + 15}" text-anchor="middle" font-size="11" fill="${S.text2}">${fmtNum(+v.toPrecision(12))}</text>`);
    series.forEach(s => s.values.forEach((v, i) => {
      const x = s.xs ? s.xs[i] : i + 1;
      if (v == null || x == null) return;
      out.push(`<circle cx="${xPx(x).toFixed(1)}" cy="${vToPx(v).toFixed(1)}" r="5" fill="${s.color}" stroke="${S.bg}" stroke-width="2"><title>${esc(s.name)}: ${fmtNum(x)} / ${fmtNum(v)}</title></circle>`);
    }));
    out.push('</svg>');
    return out.join('');
  }
  // category axis
  const band = (horiz ? ph : pw) / Math.max(1, n);
  const step = Math.max(1, Math.ceil((horiz ? 16 : Math.max(...data.cats.map(c => tw(clip(c, 14), 11))) + 8) / band));
  data.cats.forEach((c, i) => {
    if (i % step) return;
    const mid = (horiz ? top : left) + band * (i + 0.5);
    if (horiz) out.push(`<text x="${left - 6}" y="${mid + 4}" text-anchor="end" font-size="12" fill="${S.text2}">${esc(clip(c, 16))}</text>`);
    else out.push(`<text x="${mid}" y="${bottom + 15}" text-anchor="middle" font-size="11" fill="${S.text2}">${esc(clip(c, 14))}</text>`);
  });
  if (type === 'col' || type === 'bar') {
    const k = series.length;
    const gw = band * 0.72, bw = Math.max(1, (gw - (k - 1) * 2) / k);
    series.forEach((s, si) => s.values.forEach((v, i) => {
      if (v == null) return;
      const off = (horiz ? top : left) + band * i + (band - gw) / 2 + si * (bw + 2);
      const a = vToPx(0 < yt.lo ? yt.lo : 0 > yt.hi ? yt.hi : 0), b = vToPx(v);
      const lo = Math.min(a, b), len = Math.max(1, Math.abs(b - a));
      const rr = Math.min(4, bw / 2, len / 2);
      out.push(horiz ? `<rect x="${lo.toFixed(1)}" y="${off.toFixed(1)}" width="${len.toFixed(1)}" height="${bw.toFixed(1)}" rx="${rr}" fill="${s.color}"><title>${esc(s.name)} · ${esc(data.cats[i] || '')}: ${fmtNum(v)}</title></rect>`
        : `<rect x="${off.toFixed(1)}" y="${lo.toFixed(1)}" width="${bw.toFixed(1)}" height="${len.toFixed(1)}" rx="${rr}" fill="${s.color}"><title>${esc(s.name)} · ${esc(data.cats[i] || '')}: ${fmtNum(v)}</title></rect>`);
    }));
  } else {
    series.forEach(s => {
      const pts = s.values.map((v, i) => (v == null ? null : [left + band * (i + 0.5), vToPx(v)]));
      const segs = [];
      let cur = [];
      pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      segs.forEach(seg => {
        const d = seg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
        if (type === 'area') out.push(`<path d="${d}L${seg[seg.length - 1][0].toFixed(1)},${zero.toFixed(1)}L${seg[0][0].toFixed(1)},${zero.toFixed(1)}Z" fill="${s.color}" fill-opacity="0.28"/>`);
        out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
      });
      if (type === 'line' && n <= 40) pts.forEach((p, i) => { if (p) out.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${s.color}" stroke="${S.bg}" stroke-width="2"><title>${esc(s.name)} · ${esc(data.cats[i] || '')}: ${fmtNum(s.values[i])}</title></circle>`); });
    });
  }
  out.push('</svg>');
  return out.join('');
}

/** Rasterise a chart (light mode) to PNG bytes – for the PDF export. */
export async function chartPng(chart, data, w, h, scale = 2) {
  const svg = chartSvg(chart, data, { w, h, mode: 'light' });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Diagramm konnte nicht gezeichnet werden')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}

// ---------------- dialog ----------------
const TYPE_ICON = {
  col: '<path d="M4 20h16"/><rect x="6" y="11" width="3" height="9" rx=".6"/><rect x="11" y="6" width="3" height="14" rx=".6"/><rect x="16" y="13" width="3" height="7" rx=".6"/>',
  bar: '<path d="M4 4v16"/><rect x="4" y="6" width="10" height="3" rx=".6"/><rect x="4" y="11" width="15" height="3" rx=".6"/><rect x="4" y="16" width="7" height="3" rx=".6"/>',
  line: '<path d="M4 20h16"/><path d="m4.5 15 4.5-5 4 3 6.5-7"/>',
  pie: '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l6 5"/>',
  area: '<path d="M4 20h16"/><path d="M4.5 18 9 11l4 3 6.5-7V18z" fill="currentColor" fill-opacity=".3"/>',
  scatter: '<path d="M4 4v16h16"/><circle cx="9" cy="14" r="1.6" fill="currentColor"/><circle cx="13" cy="9" r="1.6" fill="currentColor"/><circle cx="17" cy="12" r="1.6" fill="currentColor"/><circle cx="16" cy="6" r="1.6" fill="currentColor"/>',
};
export const typeIcon = id => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICON[id] || TYPE_ICON.col}</svg>`;

/** Insert/edit dialog. Returns the chart settings or null. getData(chartDraft) → data for the live preview. */
export async function chartDialog(init, { getData, title = 'Diagramm einfügen', mode = 'light' } = {}) {
  const c = { type: 'col', range: '', title: '', xTitle: '', yTitle: '', legend: 'r', palette: 'standard', byRows: null, ...init };
  const r = await openDialog({
    title, wide: true,
    body: `<div class="chart-dlg">
      <div class="cd-types" role="radiogroup" aria-label="Diagrammtyp">${CHART_TYPES.map(t => `<button type="button" class="cd-type" role="radio" data-type="${t.id}" aria-checked="${t.id === c.type}">${typeIcon(t.id)}<span>${t.label}</span></button>`).join('')}</div>
      <div class="cd-main">
        <div class="cd-form">
          <label class="field"><span class="field-label">Datenbereich</span><input class="input" name="range" value="${esc(c.range)}" placeholder="z. B. A1:C7" spellcheck="false"></label>
          <label class="field"><span class="field-label">Titel</span><input class="input" name="title" value="${esc(c.title)}" placeholder="z. B. Umsatz 2026"></label>
          <div class="field-row"><label class="field"><span class="field-label">Achse X</span><input class="input" name="xTitle" value="${esc(c.xTitle)}" placeholder="optional"></label>
            <label class="field"><span class="field-label">Achse Y</span><input class="input" name="yTitle" value="${esc(c.yTitle)}" placeholder="optional"></label></div>
          <div class="field-row"><label class="field"><span class="field-label">Legende</span><select class="select" name="legend"><option value="r">Rechts</option><option value="b">Unten</option><option value="t">Oben</option><option value="none">Keine</option></select></label>
            <label class="field"><span class="field-label">Reihen aus</span><select class="select" name="byRows"><option value="auto">Automatisch</option><option value="cols">Spalten</option><option value="rows">Zeilen</option></select></label></div>
          <div class="field"><span class="field-label">Farben</span><div class="cd-pals" role="radiogroup" aria-label="Farben">${Object.entries(PALETTES).map(([k, p]) => `<button type="button" class="cd-pal" data-pal="${k}" aria-checked="${k === c.palette}" role="radio" title="${p.label}">${p.light.slice(0, 5).map(x => `<i style="background:${x}"></i>`).join('')}<span>${p.label}</span></button>`).join('')}</div></div>
        </div>
        <div class="cd-prev" aria-label="Vorschau"></div>
      </div></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: init && init.id ? 'Übernehmen' : 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      const rg = parseRangeAddr($('[name=range]', dlg).value.trim().replace(/\$/g, '').toUpperCase());
      if (!rg) { toast('Bitte gib einen gültigen Datenbereich an, z. B. A1:C7.', 'error'); return false; }
      return true;
    },
    onMount: dlg => {
      $('[name=legend]', dlg).value = c.legend;
      $('[name=byRows]', dlg).value = c.byRows == null ? 'auto' : c.byRows ? 'rows' : 'cols';
      const read = () => {
        c.range = $('[name=range]', dlg).value.trim().toUpperCase();
        c.title = $('[name=title]', dlg).value; c.xTitle = $('[name=xTitle]', dlg).value; c.yTitle = $('[name=yTitle]', dlg).value;
        c.legend = $('[name=legend]', dlg).value;
        const br = $('[name=byRows]', dlg).value; c.byRows = br === 'auto' ? null : br === 'rows';
      };
      const paint = () => {
        read();
        const prev = $('.cd-prev', dlg);
        try { prev.innerHTML = chartSvg(c, getData({ ...c, series: null }), { w: 360, h: 240, mode }); } catch { prev.innerHTML = '<p class="panel-empty">Keine Vorschau</p>'; }
      };
      $$('[data-type]', dlg).forEach(b => b.addEventListener('click', () => { c.type = b.dataset.type; $$('[data-type]', dlg).forEach(x => x.setAttribute('aria-checked', String(x === b))); paint(); }));
      $$('[data-pal]', dlg).forEach(b => b.addEventListener('click', () => { c.palette = b.dataset.pal; $$('[data-pal]', dlg).forEach(x => x.setAttribute('aria-checked', String(x === b))); paint(); }));
      dlg.addEventListener('input', paint);
      dlg.addEventListener('change', paint);
      paint();
      return { collect: () => { read(); return { ...c }; } };
    },
  });
  return r.value === 'ok' ? r.data : null;
}

export { oicon, h };
