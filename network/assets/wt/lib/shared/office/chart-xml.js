// GENERATED – synced copy of js/office/chart-xml.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Diagramme ↔ .xlsx (DrawingML: xl/charts/chartN.xml + xl/drawings/drawingN.xml). Excel/LibreOffice/openpyxl lesen sie.
import { xmlEsc } from './vendor.js';
import { kids, kid, attr, desc, path as xpath, rid } from './vendor.js';
import { chartData, seriesFromRange, PALETTES } from './chart.js';
import { DEFAULT_COL_W, ROW_H } from './workbook.js';
import { colName, parseRangeAddr } from './formula.js';

const EMU = 9525; // per px
const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const hex = c => String(c || '#2a78d6').replace('#', '').toUpperCase().slice(0, 6);

function richTitle(text, { size = 1400, rot = null } = {}) {
  return `<c:title><c:tx><c:rich><a:bodyPr${rot != null ? ` rot="${rot}" vert="horz"` : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="1"/></a:pPr><a:r><a:rPr lang="de-DE" sz="${size}" b="1"/><a:t>${xmlEsc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}
function strCache(vals) { return `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEsc(v)}</c:v></c:pt>`).join('')}</c:strCache>`; }
function numCache(vals) { return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (v == null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`; }
function absRef(ref) {
  // make sure refs are absolute and sheet-qualified (Excel requires sheet names in chart formulas)
  return ref;
}

/** chartN.xml for one chart. */
export function chartSpaceXml(wb, sh, chart) {
  const type = chart.type || 'col';
  const series = chart.series && chart.series.length ? chart.series : (seriesFromRange(sh, chart.range, chart.byRows, type) || { series: [] }).series;
  const data = chartData(wb, sh, { ...chart, series }, 'light');
  const pal = (PALETTES[chart.palette] || PALETTES.standard).light;
  const ax1 = 50010001, ax2 = 50010002;
  const sers = series.map((s, i) => {
    const d = data.series[i] || { values: [], name: s.label || `Reihe ${i + 1}`, color: pal[i % 8] };
    const color = hex(d.color);
    const tx = s.name ? `<c:tx><c:strRef><c:f>${xmlEsc(absRef(s.name))}</c:f>${strCache([d.name])}</c:strRef></c:tx>` : `<c:tx><c:v>${xmlEsc(d.name)}</c:v></c:tx>`;
    const cat = s.cat ? (type === 'scatter'
      ? `<c:xVal><c:numRef><c:f>${xmlEsc(s.cat)}</c:f>${numCache(d.xs || [])}</c:numRef></c:xVal>`
      : `<c:cat><c:strRef><c:f>${xmlEsc(s.cat)}</c:f>${strCache(data.cats)}</c:strRef></c:cat>`) : '';
    const val = type === 'scatter' ? `<c:yVal><c:numRef><c:f>${xmlEsc(s.val)}</c:f>${numCache(d.values)}</c:numRef></c:yVal>` : `<c:val><c:numRef><c:f>${xmlEsc(s.val)}</c:f>${numCache(d.values)}</c:numRef></c:val>`;
    const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`;
    if (type === 'col' || type === 'bar') return `<c:ser>${head}<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
    if (type === 'line') return `<c:ser>${head}<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    if (type === 'area') return `<c:ser>${head}<c:spPr><a:solidFill><a:srgbClr val="${color}"><a:alpha val="45000"/></a:srgbClr></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr>${cat}${val}</c:ser>`;
    if (type === 'scatter') return `<c:ser>${head}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    // pie: one colour per point
    const n = (data.series[i] || { values: [] }).values.length;
    const pts = i === 0 ? Array.from({ length: n }, (_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${hex((chart.colors && chart.colors[k]) || pal[k % 8])}"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('') : '';
    return `<c:ser>${head}${pts}${cat}${val}</c:ser>`;
  });
  const axTitle = (t, rot) => (t ? richTitle(t, { size: 1000, rot }) : '');
  const catAx = (pos, t) => `<c:catAx><c:axId val="${ax1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${axTitle(t, pos === 'l' ? -5400000 : null)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${ax2}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = (id, cross, pos, t, grid = true) => `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${grid ? '<c:majorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="E6E7EE"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ''}${axTitle(t, pos === 'l' ? -5400000 : null)}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="${type === 'scatter' ? 'midCat' : 'between'}"/></c:valAx>`;
  let plot;
  if (type === 'col' || type === 'bar') plot = `<c:barChart><c:barDir val="${type === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${sers.join('')}<c:gapWidth val="80"/><c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:barChart>${catAx(type === 'bar' ? 'l' : 'b', type === 'bar' ? chart.yTitle : chart.xTitle)}${valAx(ax2, ax1, type === 'bar' ? 'b' : 'l', type === 'bar' ? chart.xTitle : chart.yTitle)}`;
  else if (type === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers.join('')}<c:marker val="1"/><c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:lineChart>${catAx('b', chart.xTitle)}${valAx(ax2, ax1, 'l', chart.yTitle)}`;
  else if (type === 'area') plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers.join('')}<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:areaChart>${catAx('b', chart.xTitle)}${valAx(ax2, ax1, 'l', chart.yTitle)}`;
  else if (type === 'scatter') plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers.join('')}<c:axId val="${ax1}"/><c:axId val="${ax2}"/></c:scatterChart>${valAx(ax1, ax2, 'b', chart.xTitle, false)}${valAx(ax2, ax1, 'l', chart.yTitle)}`;
  else plot = `<c:pieChart><c:varyColors val="1"/>${sers.slice(0, 1).join('')}<c:firstSliceAng val="0"/></c:pieChart>`;
  const legend = chart.legend === 'none' ? '' : `<c:legend><c:legendPos val="${['r', 'b', 't'].includes(chart.legend) ? chart.legend : 'r'}"/><c:overlay val="0"/></c:legend>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace ${NS}><c:roundedCorners val="0"/><c:chart>${chart.title ? richTitle(chart.title) : ''}<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
}

// ---- anchors: px (grid content coordinates) ↔ cell + offset ----
function colW(sh, c) { const w = sh.colW[c]; return w == null ? DEFAULT_COL_W : w; }
function pxToCell(sh, x, y) {
  let c = 0, acc = 0;
  while (c < 16000 && acc + colW(sh, c) <= x) { acc += colW(sh, c); c++; }
  const colOff = Math.max(0, Math.round((x - acc) * EMU));
  const r = Math.max(0, Math.floor(y / ROW_H));
  return { c, colOff, r, rowOff: Math.max(0, Math.round((y - r * ROW_H) * EMU)) };
}
function cellToPx(sh, c, colOff, r, rowOff) {
  let x = 0;
  for (let k = 0; k < c; k++) x += colW(sh, k);
  return { x: x + colOff / EMU, y: r * ROW_H + rowOff / EMU };
}

/** drawingN.xml + its rels for the charts of one sheet. chartFiles: global chart numbers. */
export function drawingXml(sh, charts, chartNums) {
  const anchors = charts.map((ch, i) => {
    const a = pxToCell(sh, ch.x || 0, ch.y || 0);
    const b = pxToCell(sh, (ch.x || 0) + (ch.w || 480), (ch.y || 0) + (ch.h || 300));
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${a.c}</xdr:col><xdr:colOff>${a.colOff}</xdr:colOff><xdr:row>${a.r}</xdr:row><xdr:rowOff>${a.rowOff}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${b.c}</xdr:col><xdr:colOff>${b.colOff}</xdr:colOff><xdr:row>${b.r}</xdr:row><xdr:rowOff>${b.rowOff}</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Diagramm ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.join('')}</xdr:wsDr>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${chartNums.map((n, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${n}.xml"/>`).join('')}</Relationships>`;
  return { xml, rels };
}

// ---------------- reading ----------------
const TYPE_MAP = { barChart: null, bar3DChart: null, lineChart: 'line', line3DChart: 'line', pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'pie', ofPieChart: 'pie', areaChart: 'area', area3DChart: 'area', scatterChart: 'scatter', bubbleChart: 'scatter', radarChart: 'line' };
function textOf(el) { return el ? desc(el, 't').map(t => t.textContent).join('') : ''; }
function refOf(el) { const f = el && desc(el, 'f')[0]; return f ? f.textContent.trim() : null; }
function colorOf(spPr) {
  if (!spPr) return null;
  const fill = kid(spPr, 'solidFill') || (kid(spPr, 'ln') && kid(kid(spPr, 'ln'), 'solidFill'));
  const c = fill && kid(fill, 'srgbClr');
  const v = c && attr(c, 'val');
  return v && /^[0-9A-F]{6}$/i.test(v) ? '#' + v.toUpperCase() : null; // used in SVG attributes – hex only
}
function stripSheet(ref) { const m = /^(?:(.+)!)?(.*)$/.exec(ref || ''); return { sheet: m && m[1] ? m[1].replace(/^'|'$/g, '').replace(/''/g, "'") : null, a1: m ? m[2].replace(/\$/g, '') : '' }; }

/** Parse a chartSpace document into our chart model (or null if unsupported). */
export function parseChartXml(doc) {
  const plot = desc(doc, 'plotArea')[0];
  if (!plot) return null;
  let typeEl = null, type = null;
  for (const k of kids(plot)) if (k.localName in TYPE_MAP) { typeEl = k; type = TYPE_MAP[k.localName]; break; }
  if (!typeEl) return null;
  if (type === null) { const bd = kid(typeEl, 'barDir'); type = bd && attr(bd, 'val') === 'bar' ? 'bar' : 'col'; }
  const chartEl = desc(doc, 'chart')[0];
  const titleEl = chartEl && kid(chartEl, 'title');
  const series = [], colors = [];
  for (const s of kids(typeEl, 'ser')) {
    const tx = kid(s, 'tx');
    const nameRef = tx ? refOf(tx) : null;
    const nameLit = tx && !nameRef ? (kid(tx, 'v') ? kid(tx, 'v').textContent : textOf(tx)) : null;
    const cat = kid(s, 'cat') || kid(s, 'xVal');
    const val = kid(s, 'val') || kid(s, 'yVal');
    const vref = refOf(val);
    if (!vref) continue;
    series.push({ name: nameRef || nameLit || null, cat: refOf(cat), val: vref });
    if (type === 'pie' && !series[1]) for (const dp of kids(s, 'dPt')) { const ix = +attr(kid(dp, 'idx'), 'val'); const c = colorOf(kid(dp, 'spPr')); if (c) colors[ix] = c; }
    else if (type !== 'pie') colors.push(colorOf(kid(s, 'spPr')) || colorOf(xpath(s, 'marker', 'spPr')));
  }
  if (!series.length) return null;
  const axTitle = name => { for (const ax of kids(plot)) if (/Ax$/.test(ax.localName)) { const pos = attr(kid(ax, 'axPos'), 'val'); if (pos === name && kid(ax, 'title')) return textOf(kid(ax, 'title')); } return ''; };
  const leg = chartEl && kid(chartEl, 'legend');
  const legPos = leg ? attr(kid(leg, 'legendPos'), 'val') : null;
  // bounding data range on one sheet
  let range = '', sheetName = null;
  const refs = series.flatMap(s => [s.cat, s.val, s.name && /!/.test(s.name) ? s.name : null]).filter(Boolean).map(stripSheet);
  const rgs = refs.map(r => ({ ...r, rg: parseRangeAddr(r.a1) })).filter(r => r.rg);
  if (rgs.length) {
    sheetName = rgs[0].sheet;
    const r1 = Math.min(...rgs.map(r => r.rg.r1)), c1 = Math.min(...rgs.map(r => r.rg.c1)), r2 = Math.max(...rgs.map(r => r.rg.r2)), c2 = Math.max(...rgs.map(r => r.rg.c2));
    range = `${colName(c1)}${r1 + 1}:${colName(c2)}${r2 + 1}`;
  }
  let palette = 'standard', cols = colors.some(Boolean) ? colors.map(c => c || null) : null;
  if (cols) for (const [k, p] of Object.entries(PALETTES)) if (cols.every((c, i) => !c || (p.light[i % 8] || '').toUpperCase() === c.toUpperCase())) { palette = k; cols = null; break; }
  return {
    type, title: titleEl ? textOf(titleEl) : '', xTitle: type === 'bar' ? axTitle('b') : axTitle('b'), yTitle: type === 'bar' ? axTitle('l') : axTitle('l'),
    legend: !leg ? 'none' : ['r', 'b', 't'].includes(legPos) ? legPos : 'r', palette, series, range, sheetName, colors: cols,
  };
}

/** Read charts of a sheet (needs the zip helpers). Returns chart models with px positions. */
export async function readSheetCharts(zip, sheetPath, sh, { readRels, zipXml }) {
  const rels = await readRels(zip, sheetPath);
  const out = [];
  for (const rel of rels.values()) {
    if (rel.type !== 'drawing') continue;
    const dr = await zipXml(zip, rel.target);
    if (!dr) continue;
    const drels = await readRels(zip, rel.target);
    for (const anc of [...desc(dr, 'twoCellAnchor'), ...desc(dr, 'oneCellAnchor')]) {
      const chartRef = desc(anc, 'chart')[0];
      if (!chartRef) continue;
      const crel = drels.get(rid(chartRef));
      if (!crel) continue;
      const cdoc = await zipXml(zip, crel.target);
      if (!cdoc) continue;
      const ch = parseChartXml(cdoc);
      if (!ch) continue;
      const num = (el, n) => +(el && kid(el, n) ? kid(el, n).textContent : 0) || 0;
      const from = kid(anc, 'from'), to = kid(anc, 'to'), ext = kid(anc, 'ext');
      const p1 = cellToPx(sh, num(from, 'col'), num(from, 'colOff'), num(from, 'row'), num(from, 'rowOff'));
      let w = 480, hgt = 300;
      if (to) { const p2 = cellToPx(sh, num(to, 'col'), num(to, 'colOff'), num(to, 'row'), num(to, 'rowOff')); w = p2.x - p1.x; hgt = p2.y - p1.y; }
      else if (ext) { w = +attr(ext, 'cx') / EMU; hgt = +attr(ext, 'cy') / EMU; }
      out.push({ id: 'ch' + Math.random().toString(36).slice(2, 9), ...ch, x: Math.round(p1.x), y: Math.round(p1.y), w: Math.max(160, Math.round(w)), h: Math.max(120, Math.round(hgt)) });
    }
  }
  return out;
}
