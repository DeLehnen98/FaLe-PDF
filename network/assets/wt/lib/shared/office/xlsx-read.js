// GENERATED – synced copy of js/office/xlsx-read.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// .xlsx reader (own parser on top of JSZip). Fast string scanning for sheet data (large files stay responsive).
import { openZip, zipXml, kids, kid, attr, rid, readRels, desc, tick } from './vendor.js';
import { newWorkbook, newSheet, KEY, recalc } from './workbook.js';
import { errFromCode, shiftRefs, canonicalFn } from './formula.js';
import { UserError } from '../../conv-office-shim.js';
import { parseXml } from './vendor.js';
import { CF_STYLES, CF_SCALES, ensureSheetExtras, parseList, filterHidden } from './sheetfx.js';

const BUILTIN_FMT = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'dd.mm.yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'hh:mm', 21: 'hh:mm:ss', 22: 'dd.mm.yyyy hh:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 44: '#,##0.00 "€"', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

const ROW_PX_PER_PT = 28 / 15; // default row (15 pt) is 28 px on screen
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unxml(s) {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()];
  }).replace(/_x([0-9A-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function colorOf(el, theme) {
  if (!el) return null;
  const rgb = attr(el, 'rgb');
  if (rgb && /^[0-9A-F]{8}$/i.test(rgb)) return rgb.slice(0, 2).toUpperCase() === '00' && rgb.slice(2) === '000000' ? null : '#' + rgb.slice(2).toUpperCase();
  if (rgb && /^[0-9A-F]{6}$/i.test(rgb)) return '#' + rgb.toUpperCase();
  const idx = attr(el, 'indexed');
  if (idx != null && INDEXED[+idx]) return +idx === 64 ? null : '#' + INDEXED[+idx];
  const th = attr(el, 'theme');
  if (th != null && theme[+th]) return applyTint('#' + theme[+th], +(attr(el, 'tint') || 0));
  return null;
}
function applyTint(hex, tint) {
  if (!tint) return hex.toUpperCase();
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const out = v.map(x => Math.round(tint < 0 ? x * (1 + tint) : x + (255 - x) * tint));
  return '#' + out.map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function readTheme(zip, rels) {
  for (const r of rels.values()) {
    if (r.type !== 'theme') continue;
    const doc = await zipXml(zip, r.target);
    if (!doc) break;
    const scheme = desc(doc, 'clrScheme')[0];
    if (!scheme) break;
    const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
    return order.map(n => {
      const e = kid(scheme, n);
      const c = e && (kid(e, 'srgbClr') || kid(e, 'sysClr'));
      const v = c ? (attr(c, 'val') && c.localName === 'srgbClr' ? attr(c, 'val') : attr(c, 'lastClr') || '000000') : '000000';
      return /^[0-9A-F]{6}$/i.test(v) ? v : '000000'; // theme colours end up in style="…" – hex only
    });
  }
  return ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
}

function readStyles(doc, theme) {
  const xfs = [];
  if (!doc) return xfs;
  const fmts = {};
  for (const f of desc(doc, 'numFmt')) fmts[attr(f, 'numFmtId')] = attr(f, 'formatCode');
  const onv = el => !!el && !['0', 'false'].includes(String(attr(el, 'val') ?? '1'));
  const fonts = desc(kid(doc.documentElement, 'fonts'), 'font').map(f => ({
    b: onv(kid(f, 'b')), i: onv(kid(f, 'i')),
    u: !!kid(f, 'u') && attr(kid(f, 'u'), 'val') !== 'none', strike: onv(kid(f, 'strike')), color: colorOf(kid(f, 'color'), theme), size: kid(f, 'sz') ? +attr(kid(f, 'sz'), 'val') : null,
    name: kid(f, 'name') ? attr(kid(f, 'name'), 'val') : null, va: kid(f, 'vertAlign') ? attr(kid(f, 'vertAlign'), 'val') : null,
  }));
  const baseFont = fonts[0] && fonts[0].name;
  const fills = desc(kid(doc.documentElement, 'fills'), 'fill').map(f => {
    const p = kid(f, 'patternFill');
    if (!p || attr(p, 'patternType') !== 'solid') return null;
    return colorOf(kid(p, 'fgColor'), theme) || colorOf(kid(p, 'bgColor'), theme);
  });
  // border side: true (thin) or the style name (medium, thick, double, dashed, dotted, hair …)
  const side = el => { const st = el && attr(el, 'style'); if (!st || st === 'none') return false; return st === 'thin' ? true : st; };
  const borders = desc(kid(doc.documentElement, 'borders'), 'border').map(b => {
    const L = kid(b, 'left') || kid(b, 'start'), R = kid(b, 'right') || kid(b, 'end'), T = kid(b, 'top'), B = kid(b, 'bottom');
    const bd = { l: side(L), r: side(R), t: side(T), b: side(B) };
    if (!(bd.l || bd.r || bd.t || bd.b)) return null;
    for (const k of ['l', 'r', 't', 'b']) if (!bd[k]) delete bd[k];
    const col = [L, R, T, B].map(x => x && colorOf(kid(x, 'color'), theme)).find(c => c && c !== '#000000');
    if (col) bd.color = col;
    return bd;
  });
  xfs.dxfs = desc(kid(doc.documentElement, 'dxfs'), 'dxf').map(d => {
    const font = kid(d, 'font'), fill = kid(d, 'fill');
    const pf = fill && kid(fill, 'patternFill');
    return { b: !!(font && kid(font, 'b')), color: font ? colorOf(kid(font, 'color'), theme) : null, fill: pf ? colorOf(kid(pf, 'bgColor'), theme) || colorOf(kid(pf, 'fgColor'), theme) : null };
  });
  const cellXfs = kid(doc.documentElement, 'cellXfs');
  for (const x of kids(cellXfs, 'xf')) {
    const s = {};
    const fid = +(attr(x, 'numFmtId') || 0);
    const code = fmts[fid] || BUILTIN_FMT[fid] || 'General';
    if (code !== 'General') s.fmt = code.replace(/\\(.)/g, '$1') === code ? code : code;
    const font = fonts[+(attr(x, 'fontId') || 0)];
    if (font) {
      if (font.b) s.b = true; if (font.i) s.i = true; if (font.u) s.u = true; if (font.strike) s.st = true;
      if (font.color && font.color !== '#000000') s.color = font.color; if (font.size && font.size !== 11) s.size = font.size;
      if (font.name && font.name !== baseFont && !/^(calibri|arial)$/i.test(font.name)) s.font = font.name;
      if (font.va === 'superscript' || font.va === 'subscript') s.va = font.va === 'superscript' ? 'sup' : 'sub';
    }
    const fill = fills[+(attr(x, 'fillId') || 0)];
    if (fill && fill !== '#FFFFFF') s.fill = fill;
    const al = kid(x, 'alignment');
    if (al) {
      const ha = attr(al, 'horizontal');
      if (['left', 'center', 'right', 'justify', 'fill'].includes(ha)) s.align = ha === 'fill' ? 'left' : ha;
      else if (ha === 'centerContinuous') s.align = 'center';
      const va = attr(al, 'vertical');
      if (va === 'top' || va === 'center') s.valign = va;
      if (attr(al, 'wrapText') === '1' || attr(al, 'wrapText') === 'true') s.wrap = true;
      const ind = +(attr(al, 'indent') || 0); if (ind > 0) s.indent = Math.min(15, ind);
      const rot = +(attr(al, 'textRotation') || 0); if (rot === 90 || rot === 180 || rot === 255 || rot === 45) s.rot = rot === 180 ? 270 : rot;
    }
    const pr = kid(x, 'protection');
    if (pr && attr(pr, 'locked') === '0') s.unlocked = true;
    if (pr && attr(pr, 'hidden') === '1') s.hideF = true;
    const bd = borders[+(attr(x, 'borderId') || 0)];
    if (bd) s.bd = { ...bd };
    xfs.push(Object.keys(s).length ? s : null);
  }
  return xfs;
}

async function readSharedStrings(zip, path) {
  const f = path && zip.file(path);
  if (!f) return [];
  const xml = await f.async('string');
  const out = [];
  const re = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (!m[1]) { out.push(''); continue; }
    const body = m[1].replace(/<(?:\w+:)?rPh[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
    let s = '';
    const tr = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let t;
    while ((t = tr.exec(body))) s += t[1];
    out.push(unxml(s));
  }
  return out;
}

function cellRefToRC(ref) {
  let i = 0, c = 0;
  while (i < ref.length) { const ch = ref.charCodeAt(i); if (ch < 65) break; c = c * 26 + ((ch > 90 ? ch - 32 : ch) - 64); i++; }
  return { r: +ref.slice(i) - 1, c: c - 1 };
}

function parseSheetXml(xml, sh, sst, xfs) {
  // columns
  const colsM = /<(?:\w+:)?cols>([\s\S]*?)<\/(?:\w+:)?cols>/.exec(xml);
  if (colsM) {
    const re = /<(?:\w+:)?col\s([^>]*)\/?>/g;
    let m;
    while ((m = re.exec(colsM[1]))) {
      const a = m[1];
      const min = +(/\bmin="(\d+)"/.exec(a) || [])[1], max = +(/\bmax="(\d+)"/.exec(a) || [])[1];
      const w = parseFloat((/\bwidth="([\d.]+)"/.exec(a) || [])[1]);
      const hidden = /\bhidden="(1|true)"/.test(a);
      if (min && max && (w || hidden)) for (let c = min - 1; c < Math.min(max, min + 200); c++) {
        const px = Math.round((w || 8.43) * 7 + 5);
        if (hidden) { sh.colW[c] = 0; sh.hiddenColW[c] = px; } else sh.colW[c] = px;
      }
    }
  }
  // frozen panes
  const pane = /<(?:\w+:)?pane\s([^>]*)\/?>/.exec(xml);
  if (pane && /state="frozen"/.test(pane[1])) {
    const ys = /ySplit="(\d+)"/.exec(pane[1]), xs = /xSplit="(\d+)"/.exec(pane[1]);
    if (ys) sh.freeze = Math.min(+ys[1], 200);
    if (xs) sh.freezeC = Math.min(+xs[1], 50);
  }
  const tab = /<(?:\w+:)?tabColor\s([^>]*)\/?>/.exec(xml);
  if (tab) { const rgb = /rgb="([0-9A-Fa-f]{8})"/.exec(tab[1]); if (rgb) sh.tabColor = '#' + rgb[1].slice(2).toUpperCase(); }
  const prot = /<(?:\w+:)?sheetProtection\s([^>]*)\/?>/.exec(xml);
  if (prot && /\bsheet="(1|true)"/.test(prot[1])) sh.protect = { on: true };
  // merges
  const mre = /<(?:\w+:)?mergeCell\s+ref="([A-Z]+\d+):([A-Z]+\d+)"/g;
  let mm;
  while ((mm = mre.exec(xml))) { const a = cellRefToRC(mm[1]), b = cellRefToRC(mm[2]); sh.merges.push({ r1: a.r, c1: a.c, r2: b.r, c2: b.c }); }
  // hidden rows
  const hre = /<(?:\w+:)?row\s([^>]*?)>/g;
  let hm;
  while ((hm = hre.exec(xml))) {
    const rr = /\br="(\d+)"/.exec(hm[1]);
    if (!rr) continue;
    if (/\bhidden="(1|true)"/.test(hm[1])) sh.hiddenRows.add(+rr[1] - 1);
    const ht = /\bht="([\d.]+)"/.exec(hm[1]);
    if (ht && /customHeight="(1|true)"/.test(hm[1]) && Math.abs(+ht[1] - 15) > 0.5) sh.rowH.set(+rr[1] - 1, Math.max(8, Math.round(+ht[1] * ROW_PX_PER_PT)));
  }
  parseSheetExtras(xml, sh, xfs);
  // cells
  const dataStart = xml.search(/<(?:\w+:)?sheetData/);
  if (dataStart < 0) return;
  const data = xml.slice(dataStart, xml.search(/<\/(?:\w+:)?sheetData>/) + 1 || undefined);
  const shared = new Map(); // si → {r, c, f}
  const arrays = []; // ranges of array formulas: spilled values are recalculated, not stored
  const cre = /<(?:\w+:)?c\s([^>]*?)(\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let m, lastR = 0, lastC = -1;
  // also track <row r=""> for cells without r attribute
  const rowRe = /<(?:\w+:)?row\s[^>]*?\br="(\d+)"/y;
  void rowRe;
  while ((m = cre.exec(data))) {
    const a = m[1];
    const refM = /\br="([A-Z]+\d+)"/.exec(a);
    let r, c;
    if (refM) ({ r, c } = cellRefToRC(refM[1]));
    else { r = lastR; c = lastC + 1; }
    lastR = r; lastC = c;
    const t = (/\bt="(\w+)"/.exec(a) || [])[1] || 'n';
    const sIdx = +((/\bs="(\d+)"/.exec(a) || [])[1] || 0);
    const inner = m[3] || '';
    const cell = {};
    const st = xfs[sIdx];
    if (st) cell.s = { ...st };
    // formula
    const fm = /<(?:\w+:)?f(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/.exec(inner);
    if (fm) {
      const fa = fm[1] || '';
      let ftext = fm[2] != null ? unxml(fm[2]) : '';
      const ftype = (/\bt="(\w+)"/.exec(fa) || [])[1];
      const si = (/\bsi="(\d+)"/.exec(fa) || [])[1];
      if (ftype === 'shared' && si != null) {
        if (ftext) shared.set(si, { r, c, f: ftext });
        else if (shared.has(si)) {
          const base = shared.get(si);
          const dr = r - base.r, dc = c - base.c;
          ftext = shiftRefs(normFormula(base.f), ref => ({ ...ref, r: ref.absR || ref.colOnly ? ref.r : ref.r + dr, c: ref.absC ? ref.c : ref.c + dc }));
        }
      }
      if (ftext) cell.f = normFormula(ftext);
      if (cell.f && (ftype === 'array' || /\bcm="\d+"/.test(a))) {
        cell.da = true;
        const ref = (/\bref="([A-Z]+\d+(?::[A-Z]+\d+)?)"/.exec(fa) || [])[1];
        if (ref && ref.includes(':')) { const p1 = cellRefToRC(ref.split(':')[0]), p2 = cellRefToRC(ref.split(':')[1]); arrays.push({ r1: p1.r, c1: p1.c, r2: p2.r, c2: p2.c }); }
      }
    } else if (arrays.length && arrays.some(g => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2 && (r !== g.r1 || c !== g.c1))) {
      // value inside the spill range of an array formula
      const st0 = xfs[sIdx];
      if (st0) sh.cells.set(KEY(r, c), { v: null, s: { ...st0 } });
      continue;
    }
    const vm = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
    const raw = vm ? unxml(vm[1]) : null;
    let v = null;
    if (t === 's') v = raw != null ? sst[+raw] ?? '' : null;
    else if (t === 'inlineStr') {
      let s = '';
      const tr = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
      let x;
      while ((x = tr.exec(inner))) s += x[1];
      v = unxml(s);
    } else if (t === 'b') v = raw === '1' || raw === 'true';
    else if (t === 'e') v = raw ? errFromCode(raw) : null;
    else if (t === 'str') v = raw ?? '';
    else if (t === 'd') { const d = raw ? new Date(raw) : null; v = d && !isNaN(d) ? (d - Date.UTC(1899, 11, 30)) / 86400000 : raw; }
    else if (raw != null && raw !== '') v = parseFloat(raw);
    if (cell.f) { cell.cv = v; cell.cv0 = v; } else cell.v = v;
    if (v === null && !cell.f && !cell.s) continue;
    if (v === null && !cell.f && cell.s && !cell.s.fill && !cell.s.bd) continue; // drop style-only noise without visible formatting
    sh.cells.set(KEY(r, c), cell);
    if (r > sh.maxR) sh.maxR = r;
    if (c > sh.maxC) sh.maxC = c;
  }
}

/** AutoFilter, conditional formatting and data validation (parsed from the part after <sheetData>). */
function parseSheetExtras(xml, sh, xfs) {
  ensureSheetExtras(sh);
  const endData = xml.search(/<\/(?:\w+:)?sheetData>|<(?:\w+:)?sheetData\s*\/>/);
  if (endData < 0) return;
  const rootM = /<(\w+:)?worksheet\b[^>]*>/.exec(xml);
  if (!rootM) return;
  const tailStart = xml.indexOf('>', endData) + 1;
  const tail = xml.slice(tailStart);
  if (!/autoFilter|conditionalFormatting|dataValidation/.test(tail)) return;
  let doc;
  try { doc = parseXml(rootM[0] + tail); } catch { return; }
  const root = doc.documentElement;
  const af = kid(root, 'autoFilter');
  if (af && attr(af, 'ref')) {
    const ref = attr(af, 'ref');
    const c0 = cellRefToRC(ref.split(':')[0]).c;
    const filters = {};
    for (const fc of kids(af, 'filterColumn')) {
      const col = c0 + +(attr(fc, 'colId') || 0);
      const f = kid(fc, 'filters');
      if (f) {
        const vals = kids(f, 'filter').map(x => attr(x, 'val') || '');
        if (attr(f, 'blank') === '1') vals.push('(Leer)');
        filters[col] = vals;
        continue;
      }
      const cf = kid(fc, 'customFilters');
      if (cf) {
        const OPS = { equal: 'eq', notEqual: 'ne', greaterThan: 'gt', greaterThanOrEqual: 'ge', lessThan: 'lt', lessThanOrEqual: 'le' };
        const conds = kids(cf, 'customFilter').map(x => {
          const op = OPS[attr(x, 'operator') || 'equal'] || 'eq';
          let val = attr(x, 'val') || '';
          // text filters are stored with wildcards: *x* contains, x* begins, *x ends
          if ((op === 'eq' || op === 'ne') && /^\*.*\*$/.test(val) && val.length > 1) return { op: op === 'eq' ? 'contains' : 'notcontains', v: val.slice(1, -1) };
          if (op === 'eq' && /\*$/.test(val) && !/^\*/.test(val)) return { op: 'begins', v: val.slice(0, -1) };
          if (op === 'eq' && /^\*/.test(val) && !/\*$/.test(val)) return { op: 'ends', v: val.slice(1) };
          return { op, v: val };
        });
        if (conds.length) filters[col] = { custom: conds, and: attr(cf, 'and') === '1' || attr(cf, 'and') === 'true' };
        continue;
      }
      const top = kid(fc, 'top10');
      if (top) filters[col] = { top: +(attr(top, 'val') || 10), bottom: attr(top, 'top') === '0', percent: attr(top, 'percent') === '1' };
    }
    sh.autoFilter = { range: ref.includes(':') ? ref : `${ref}:${ref}`, filters };
  }
  for (const cfEl of kids(root, 'conditionalFormatting')) {
    const range = (attr(cfEl, 'sqref') || '').split(/\s+/)[0];
    if (!range) continue;
    for (const rule of kids(cfEl, 'cfRule')) {
      const type = attr(rule, 'type');
      const fs = kids(rule, 'formula').map(f => f.textContent.replace(/^"|"$/g, ''));
      const dx = xfs.dxfs && xfs.dxfs[+attr(rule, 'dxfId')];
      const st = dx ? (CF_STYLES.find(x => x.fill && dx.fill && x.fill.toUpperCase() === dx.fill.toUpperCase()) || null) : null;
      const base = { id: Math.random().toString(36).slice(2, 9), range, style: st ? st.id : 'custom', custom: !st && dx ? dx : null };
      if (type === 'cellIs') {
        const op = { greaterThan: 'gt', lessThan: 'lt', between: 'between', equal: 'eq', greaterThanOrEqual: 'gt', lessThanOrEqual: 'lt' }[attr(rule, 'operator')];
        if (op) sh.cf.push({ ...base, type: op, v1: fs[0] || '', v2: fs[1] || '' });
      } else if (type === 'containsText') sh.cf.push({ ...base, type: 'contains', v1: attr(rule, 'text') || '' });
      else if (type === 'colorScale') {
        const cols = desc(rule, 'color').map(c => attr(c, 'rgb') || '').map(c => '#' + c.slice(-6).toUpperCase());
        const sc = CF_SCALES.find(x => x.min.toUpperCase() === cols[0] && x.max.toUpperCase() === cols[cols.length - 1]);
        sh.cf.push({ ...base, type: 'scale', scale: sc ? sc.id : 'rg' });
      }
    }
  }
  const dvs = kid(root, 'dataValidations');
  for (const dv of kids(dvs, 'dataValidation')) {
    const type = attr(dv, 'type') || 'none';
    const f1 = kid(dv, 'formula1'), f2 = kid(dv, 'formula2');
    const t1 = f1 ? f1.textContent.trim() : '', t2 = f2 ? f2.textContent.trim() : '';
    const ranges = (attr(dv, 'sqref') || '').split(/\s+/).filter(Boolean);
    const msg = { prompt: attr(dv, 'prompt') || '', error: attr(dv, 'error') || '' };
    if (type === 'list') {
      if (/^".*"$/.test(t1)) { const list = parseList(t1.slice(1, -1).replace(/""/g, '"')); for (const range of ranges) sh.dv.push({ range, list, ...msg }); }
      else if (t1) for (const range of ranges) sh.dv.push({ range, type: 'list', src: t1.replace(/^=/, ''), list: [], ...msg });
    } else if (['whole', 'decimal', 'date', 'time', 'textLength'].includes(type)) {
      const op = attr(dv, 'operator') || 'between';
      for (const range of ranges) sh.dv.push({ range, type, op, v1: t1.replace(/^"|"$/g, ''), v2: t2.replace(/^"|"$/g, ''), list: [], ...msg });
    }
  }
}

function normFormula(f) {
  return f.replace(/_xlfn\.|_xlws\.|_xlpm\./g, '').replace(/^=/, '').replace(/\b([A-Z][A-Z0-9.]*)\(/g, (m, n) => canonicalFn(n) + '(');
}

/**
 * Read an .xlsx file into a workbook model.
 * @returns {Promise<object>} workbook
 */
export async function readXlsx(data, name = 'Tabelle', onProgress) {
  const zip = await openZip(data, name);
  const pkg = await readRels(zip, '');
  let wbPath = 'xl/workbook.xml';
  for (const r of pkg.values()) if (r.type === 'officeDocument') wbPath = r.target;
  const wbDoc = await zipXml(zip, wbPath);
  if (!wbDoc) throw new UserError(`„${name}“ enthält keine Tabelle.`);
  const rels = await readRels(zip, wbPath);
  const theme = await readTheme(zip, rels);
  let stylesDoc = null, sstPath = null;
  for (const r of rels.values()) {
    if (r.type === 'styles') stylesDoc = await zipXml(zip, r.target);
    if (r.type === 'sharedStrings') sstPath = r.target;
  }
  const xfs = readStyles(stylesDoc, theme);
  const sst = await readSharedStrings(zip, sstPath);
  const wb = newWorkbook();
  wb.sheets = [];
  const pr = desc(wbDoc, 'workbookPr')[0];
  wb.date1904 = pr && (attr(pr, 'date1904') === '1' || attr(pr, 'date1904') === 'true');
  const sheetEls = desc(wbDoc, 'sheet');
  let i = 0;
  for (const s of sheetEls) {
    const rel = rels.get(rid(s));
    const sh = newSheet(attr(s, 'name') || `Tabelle${i + 1}`);
    if (attr(s, 'state') === 'hidden' || attr(s, 'state') === 'veryHidden') sh.hidden = true;
    if (rel && zip.file(rel.target)) {
      const xml = await zip.file(rel.target).async('string');
      parseSheetXml(xml, sh, sst, xfs);
      if (/<(?:\w+:)?drawing\s/.test(xml)) {
        try {
          const { readSheetCharts } = await import('./chart-xml.js');
          const { seriesFromRange } = await import('./chart.js');
          const norm = r => String(r || '').replace(/^.*!/, '').replace(/\$/g, '');
          sh.charts = (await readSheetCharts(zip, rel.target, sh, { readRels, zipXml })).map(ch => {
            // charts that simply plot a block of this sheet are kept range-based (editable like new ones)
            if (ch.range && (!ch.sheetName || ch.sheetName.toLowerCase() === sh.name.toLowerCase())) {
              for (const byRows of [false, true]) {
                const d = seriesFromRange(sh, ch.range, byRows, ch.type);
                if (d && d.series.length === ch.series.length && d.series.every((x, i) => norm(x.val) === norm(ch.series[i].val) && norm(x.cat) === norm(ch.series[i].cat))) { ch.series = null; ch.byRows = byRows; break; }
              }
            }
            delete ch.sheetName;
            return ch;
          });
        } catch (e) { console.warn('Diagramme übersprungen', e); }
      }
      if (sh.autoFilter) for (const r of filterHidden(sh)) sh.hiddenRows.delete(r);
    }
    if (wb.date1904) for (const cell of sh.cells.values()) if (typeof cell.v === 'number' && cell.s && cell.s.fmt && /[dmy]/i.test(cell.s.fmt)) cell.v += 1462;
    wb.sheets.push(sh);
    i++;
    onProgress && onProgress(i / sheetEls.length);
    await tick();
  }
  if (!wb.sheets.length) wb.sheets.push(newSheet('Tabelle1'));
  // defined names (named ranges)
  for (const dn of desc(wbDoc, 'definedName')) {
    const nm = attr(dn, 'name') || '';
    if (!nm || /^_xlnm\./i.test(nm) || attr(dn, 'hidden') === '1') continue;
    const ref = (dn.textContent || '').trim().replace(/^=/, '');
    if (!ref || /#REF!/.test(ref)) continue;
    const ls = attr(dn, 'localSheetId');
    wb.names.push({ name: nm, ref: normFormula(ref), si: ls != null ? +ls : null, comment: attr(dn, 'comment') || '' });
  }
  recalc(wb);
  return wb;
}
