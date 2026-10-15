// GENERATED – synced copy of js/office/docmodel.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Neutral document model shared by the .docx writer, the PDF exporter and text export.
// Built from editor HTML (tags + inline styles only, no layout needed → works off-screen).
import { fontNameOf } from './fonts.js';
import { styleOfBlock, TAG_OF_STYLE, headingNumberer } from './docstyles.js';

export const HEADING_PT = { h1: 20, h2: 16, h3: 13.5, h4: 12, h5: 11, h6: 11, subtitle: 13 };
export const PARA_SPACE = { p: [0, 6], h1: [14, 8], h2: [14, 6], h3: [12, 4], h4: [10, 4], h5: [8, 4], h6: [8, 4], subtitle: [0, 10], li: [0, 3] };

const FONT_KEYWORDS = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 };
const FONT_TAG_SIZES = { 1: 7.5, 2: 10, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 };
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TBODY', 'THEAD', 'TR', 'TD', 'TH']);
const isTc = el => el.classList && el.classList.contains('tc');

let colorCtx = null;
export function normColor(c) {
  if (!c) return null;
  c = String(c).trim();
  if (!c || c === 'transparent' || c === 'inherit' || c === 'initial' || c === 'currentcolor') return null;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (m) {
    if (m[4] != null && parseFloat(m[4]) === 0) return null;
    return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toUpperCase();
  try {
    if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
    colorCtx.fillStyle = '#000001';
    colorCtx.fillStyle = c;
    const v = colorCtx.fillStyle;
    if (v === '#000001') return null;
    return /^#/.test(v) ? v.toUpperCase() : normColor(v);
  } catch { return null; }
}

function parseSize(v, parentPt) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (FONT_KEYWORDS[v]) return FONT_KEYWORDS[v];
  if (v === 'smaller') return parentPt * 0.83;
  if (v === 'larger') return parentPt * 1.2;
  const m = /^([\d.]+)(pt|px|em|rem|%)?$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'px': return n * 0.75;
    case 'em': case 'rem': return n * parentPt;
    case '%': return (n / 100) * parentPt;
    default: return n;
  }
}

function fmtFromElement(el, f) {
  const t = el.tagName;
  const n = { ...f };
  if (t === 'B' || t === 'STRONG') n.b = true;
  if (t === 'I' || t === 'EM' || t === 'CITE') n.i = true;
  if (t === 'INS' && isTc(el)) n.ins = { author: el.getAttribute('data-author') || '', date: el.getAttribute('data-date') || '' };
  else if (t === 'DEL' && isTc(el)) n.del = { author: el.getAttribute('data-author') || '', date: el.getAttribute('data-date') || '' };
  else if (t === 'U' || t === 'INS') n.u = true;
  else if (t === 'S' || t === 'STRIKE' || t === 'DEL') n.s = true;
  if (t === 'SUP') n.sup = true;
  if (t === 'SUB') n.sub = true;
  if (t === 'CODE' || t === 'KBD' || t === 'TT') n.mono = true;
  if (t === 'MARK') n.bg = '#FFF59D';
  if (t === 'A' && el.getAttribute('href')) { n.href = el.getAttribute('href'); n.link = true; }
  if (el.hasAttribute && el.hasAttribute('data-cmt')) n.cmt = el.getAttribute('data-cmt');
  if (t === 'FONT') {
    if (el.getAttribute('color')) n.color = normColor(el.getAttribute('color')) || n.color;
    if (el.getAttribute('size')) n.size = FONT_TAG_SIZES[el.getAttribute('size')] || n.size;
    const face = el.getAttribute('face') || '';
    if (/mono|courier/i.test(face)) n.mono = true; else if (/serif|times|georgia/i.test(face) && !/sans/i.test(face)) n.serif = true;
    const fn = fontNameOf(face); if (fn) n.font = fn;
  }
  const st = el.style;
  if (st && el.getAttribute('style')) {
    const fw = st.fontWeight;
    if (fw === 'bold' || fw === 'bolder' || +fw >= 600) n.b = true;
    else if (fw === 'normal' || (+fw && +fw < 600)) n.b = false;
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') n.i = true;
    else if (st.fontStyle === 'normal') n.i = false;
    const td = `${st.textDecorationLine || ''} ${st.textDecoration || ''}`;
    if (/underline/.test(td)) n.u = true;
    if (/line-through/.test(td)) n.s = true;
    if (st.color) n.color = normColor(st.color) || n.color;
    if (st.backgroundColor) { const bg = normColor(st.backgroundColor); if (bg && bg !== '#FFFFFF') n.bg = bg; }
    if (st.fontSize) n.size = parseSize(st.fontSize, f.size || f.base) || n.size;
    const ff = st.fontFamily || '';
    if (/mono|courier|consolas/i.test(ff)) { n.mono = true; n.serif = false; } else if (/serif|times|georgia|garamond|cambria|book/i.test(ff) && !/sans/i.test(ff)) { n.serif = true; n.mono = false; } else if (ff) { n.mono = false; n.serif = false; }
    if (ff) { const fn = fontNameOf(ff); if (fn) n.font = fn; }
    if (st.verticalAlign === 'super') n.sup = true;
    if (st.verticalAlign === 'sub') n.sub = true;
    if (st.textTransform === 'uppercase') n.upper = true;
    if (st.fontVariant === 'small-caps' || st.fontVariantCaps === 'small-caps') n.smallCaps = true;
  }
  return n;
}

function cleanText(s, f) {
  let t = s.replace(/ /g, ' ').replace(/[​﻿]/g, '');
  if (f.upper) t = t.toUpperCase();
  return t;
}

/** Inline runs of an element's children. */
function inlineRuns(node, f, runs) {
  for (let c = node.firstChild; c; c = c.nextSibling) inlineNode(c, f, runs);
  return runs;
}

function inlineNode(c, f, runs) {
  if (c.nodeType === 3) {
    const text = cleanText(c.nodeValue, f);
    if (!text) return;
    // pre-wrap: newlines are line breaks
    text.split('\n').forEach((p, i) => {
      if (i > 0) runs.push({ br: true });
      if (p) runs.push({ ...pickFmt(f), text: p });
    });
    return;
  }
  if (c.nodeType !== 1) return;
  const t = c.tagName;
  if (t === 'BR') { runs.push({ br: true }); return; }
  if (t === 'SUP' && c.classList && c.classList.contains('fn')) { runs.push({ fn: c.getAttribute('data-fn') || '' }); return; }
  if (t === 'SUP' && c.classList && c.classList.contains('en')) { runs.push({ en: c.getAttribute('data-en') || '' }); return; }
  if (t === 'SPAN' && c.classList && c.classList.contains('bm')) { const nm = c.getAttribute('data-bm'); if (nm) runs.push({ bm: nm }); return; }
  if (t === 'SPAN' && c.classList && c.classList.contains('xref')) { runs.push({ ...pickFmt(fmtFromElement(c, f)), xref: { name: c.getAttribute('data-ref') || '', kind: c.getAttribute('data-xk') || 'text' }, text: cleanText(c.textContent, f) || '?' }); return; }
  if (t === 'SPAN' && c.classList && c.classList.contains('seq')) { runs.push({ ...pickFmt(fmtFromElement(c, f)), seq: c.getAttribute('data-seq') || 'Abbildung', text: cleanText(c.textContent, f) || '1' }); return; }
  if (t === 'SPAN' && c.classList && c.classList.contains('tf')) { runs.push({ ...pickFmt(fmtFromElement(c, f)), tf: { f: c.getAttribute('data-f') || '', fmt: c.getAttribute('data-fmt') || '' }, text: cleanText(c.textContent, f) || '0' }); return; }
  if (t === 'SPAN' && c.classList && c.classList.contains('mf')) { runs.push({ ...pickFmt(fmtFromElement(c, f)), field: c.getAttribute('data-field') || '', text: `«${c.getAttribute('data-field') || ''}»` }); return; }
  if (t === 'IMG') {
    const src = c.getAttribute('src');
    if (src) runs.push({ ...(f.ins ? { ins: f.ins } : {}), img: { src, w: +c.getAttribute('width') || c.naturalWidth || 0, h: +c.getAttribute('height') || c.naturalHeight || 0, alt: c.getAttribute('alt') || '', wrap: c.getAttribute('data-wrap') || 'inline' } });
    return;
  }
  if (c.classList && (c.classList.contains('pg-sp') || c.classList.contains('img-handles'))) return;
  if (t === 'SCRIPT' || t === 'STYLE' || (c.classList && c.classList.contains('img-missing'))) return;
  if (c.hasAttribute && c.hasAttribute('data-page-break')) return;
  if (BLOCK_TAGS.has(t)) { // block inside inline context: separate by a line break
    if (runs.length && !runs[runs.length - 1].br) runs.push({ br: true });
  }
  inlineRuns(c, fmtFromElement(c, f), runs);
}

function pickFmt(f) {
  const o = {};
  for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'serif', 'color', 'bg', 'size', 'href', 'cmt', 'font', 'ins', 'del', 'smallCaps']) if (f[k]) o[k] = f[k];
  return o;
}

function blockAttrs(el) {
  const st = el.style || {};
  const a = {};
  const ta = st.textAlign || el.getAttribute('align');
  if (ta && ['center', 'right', 'justify'].includes(ta)) a.align = ta;
  else if (ta === 'left' && st.textAlign === 'left') a.align = 'left';
  if (st.marginLeft) { const v = parseSize(st.marginLeft, 12); if (v > 2) a.indent = v; }
  if (st.paddingLeft && el.tagName !== 'LI' && !(el.classList && el.classList.contains('quote'))) { const v = parseSize(st.paddingLeft, 12); if (v > 2) a.indent = (a.indent || 0) + v; }
  if (st.marginRight) { const v = parseSize(st.marginRight, 12); if (v > 2) a.indentR = v; }
  if (st.textIndent) { const v = parseSize(st.textIndent, 12); if (v && Math.abs(v) > 1) a.firstLine = v; }
  if (st.lineHeight) { const lh = parseFloat(st.lineHeight); if (/^[\d.]+$/.test(String(st.lineHeight).trim()) && lh > 0.5 && lh < 5) a.line = Math.round(lh / 1.13 * 100) / 100; }
  if (st.marginTop) { const v = parseSize(st.marginTop, 12); if (v !== null && v >= 0) a.before = v; }
  if (st.marginBottom) { const v = parseSize(st.marginBottom, 12); if (v !== null && v >= 0) a.after = v; }
  if (el.hasAttribute && el.hasAttribute('data-keep-next')) a.keepNext = true;
  if (el.hasAttribute && el.hasAttribute('data-pbb')) a.pageBreakBefore = true;
  if (el.hasAttribute && el.hasAttribute('data-tabs')) { const d = parseTabs(el.getAttribute('data-tabs')); if (d.length) { a.tabs = d.map(x => x.pos); if (d.some(x => x.align !== 'left' || x.leader !== 'none')) a.tabDefs = d; } }
  if (el.hasAttribute && el.hasAttribute('data-dropcap')) a.dropCap = true;
  const bg = normColor(st.backgroundColor);
  if (bg && bg !== '#FFFFFF') a.bg = bg;
  return a;
}

function trimRuns(runs) {
  while (runs.length && runs[runs.length - 1].br) runs.pop();
  return runs;
}

/**
 * Convert editor DOM (or an HTML string) to the block model.
 * @returns {{blocks: object[], baseSize: number}}
 */
export function htmlToModel(rootOrHtml, { baseSize = 11, styles = null } = {}) {
  let root = rootOrHtml;
  if (typeof rootOrHtml === 'string') {
    root = new DOMParser().parseFromString(`<body>${rootOrHtml}</body>`, 'text/html').body;
  }
  const base = { base: baseSize };
  const blocks = [];
  walkBlocks(root, base, blocks, { level: -1, indent: 0 });
  if (styles) numberHeadings(blocks, styles);
  const comments = {};
  root.querySelectorAll('[data-cmt]').forEach(el => {
    const id = el.getAttribute('data-cmt');
    if (!comments[id]) comments[id] = { text: el.getAttribute('data-cmt-text') || '', author: el.getAttribute('data-cmt-author') || '', date: el.getAttribute('data-cmt-date') || '' };
  });
  return { blocks, baseSize, comments, ...(styles ? { styles } : {}) };
}

function walkBlocks(parent, f, out, ctx) {
  let pending = [];
  const flush = () => {
    const runs = trimRuns(pending);
    pending = [];
    if (runs.some(r => r.text && r.text.trim() || r.img)) out.push({ type: 'para', tag: 'p', runs, indent: ctx.indent || 0 });
  };
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) {
      if (c.nodeValue.trim() || pending.length) inlineNode(c, f, pending);
      continue;
    }
    if (c.nodeType !== 1) continue;
    const t = c.tagName;
    if (!BLOCK_TAGS.has(t)) {
      if (t === 'BR') { if (pending.length) pending.push({ br: true }); else out.push({ type: 'para', tag: 'p', runs: [], indent: ctx.indent || 0 }); continue; }
      inlineNode(c, f, pending);
      continue;
    }
    flush();
    if (c.classList && (c.classList.contains('pg-sp') || c.classList.contains('img-handles'))) continue;
    if (c.hasAttribute('data-toc')) { out.push({ type: 'toc', title: c.getAttribute('data-toc-title') || (c.getAttribute('data-toc-kind') ? `${c.getAttribute('data-toc-kind')}verzeichnis` : 'Inhaltsverzeichnis'), depth: +(c.getAttribute('data-toc-depth') || 3), ...(c.getAttribute('data-toc-kind') ? { kind: 'captions', label: c.getAttribute('data-toc-kind') } : {}) }); continue; }
    const ff = fmtFromElement(c, f);
    if (t === 'HR') { out.push(c.hasAttribute('data-page-break') ? { type: 'pagebreak', ...(c.getAttribute('data-break') === 'section' ? { section: true, ...(/^(landscape|portrait)$/.test(c.getAttribute('data-orient') || '') ? { orient: c.getAttribute('data-orient') } : {}) } : {}) } : { type: 'hr' }); continue; }
    if (t === 'TABLE') { out.push(tableModel(c, ff)); continue; }
    if (t === 'UL' || t === 'OL') { listModel(c, ff, out, ctx.level + 1, ctx.indent || 0, ctx.listPath || []); continue; }
    if (t === 'DIV' && c.classList.contains('sect')) {
      const inner = [];
      walkBlocks(c, ff, inner, { ...ctx });
      out.push({ type: 'section', cols: Math.max(1, Math.min(4, +c.getAttribute('data-cols') || 2)), gap: +c.getAttribute('data-gap') || 18, blocks: inner });
      continue;
    }
    if (t === 'DIV' && c.classList.contains('textbox')) {
      const inner = [];
      walkBlocks(c, ff, inner, { level: -1, indent: 0 });
      const bc = normColor(c.style && c.style.borderColor);
      out.push({ type: 'textbox', blocks: inner, float: c.getAttribute('data-wrap') || null, w: parseSize(c.style && c.style.width, 12) || null, bg: normColor(c.style && c.style.backgroundColor), border: bc || '#8086A6' });
      continue;
    }
    if (/^H[1-6]$/.test(t) || t === 'P' || (t === 'DIV' && !hasBlockChild(c)) || t === 'PRE' || t === 'LI') {
      const sid = styleOfBlock(c);
      const tag = TAG_OF_STYLE[sid] || 'p';
      const fm = t === 'PRE' ? { ...ff, mono: true } : ff;
      const runs = trimRuns(inlineRuns(c, fm, []));
      const ba = blockAttrs(c);
      out.push({ type: 'para', tag, runs, ...ba, indent: (ba.indent || 0) + (ctx.indent || 0), ...(TAG_OF_STYLE[sid] ? {} : { cstyle: sid }) });
      continue;
    }
    if (t === 'BLOCKQUOTE') { const inner = []; walkBlocks(c, ff, inner, { ...ctx }); inner.forEach(b => { if (b.type === 'para' && b.tag === 'p') b.tag = 'quote'; }); out.push(...inner); continue; }
    // generic containers (div with blocks, figure, section …)
    const extra = blockAttrs(c);
    walkBlocks(c, ff, out, { ...ctx, indent: (ctx.indent || 0) + (extra.indent || 0) });
  }
  flush();
}

function hasBlockChild(el) {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (BLOCK_TAGS.has(c.tagName)) return true;
  return false;
}

function listModel(listEl, f, out, level, indent, path = [], rootId = null) {
  const ordered = listEl.tagName === 'OL';
  const type = listEl.getAttribute('type') || '1';
  let n = parseInt(listEl.getAttribute('start'), 10) || 1;
  if (!listEl._faleId) listEl._faleId = Math.random().toString(36).slice(2, 9);
  const listId = listEl.getAttribute('data-list-id') || listEl._faleId;
  const root = rootId || listId;
  const top = listEl.parentElement && listEl.parentElement.closest ? listEl.parentElement.closest('ol[data-ml],ul[data-ml]') : null;
  const ml = listEl.getAttribute('data-ml') || (top ? top.getAttribute('data-ml') : null) || null;
  const bullet = listEl.getAttribute('data-bullet') || null;
  for (let li = listEl.firstElementChild; li; li = li.nextElementSibling) {
    if (li.tagName === 'UL' || li.tagName === 'OL') { listModel(li, f, out, level + 1, indent, [...path, n - 1], root); continue; }
    if (li.tagName !== 'LI') continue;
    const lf = fmtFromElement(li, f);
    // inline part of the item (until the first nested list / block)
    const runs = [];
    const nested = [];
    for (let c = li.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) { nested.push(c); continue; }
      if (c.nodeType === 1 && (c.tagName === 'P' || c.tagName === 'DIV') ) { if (runs.length) runs.push({ br: true }); inlineRuns(c, fmtFromElement(c, lf), runs); continue; }
      inlineNode(c, lf, runs);
    }
    if (li.hasAttribute('value')) n = parseInt(li.getAttribute('value'), 10) || n;
    out.push({ type: 'para', tag: 'p', runs: trimRuns(runs), ...blockAttrs(li), indent, list: { ordered, level, index: n, type, id: listId, root, path: [...path, n], ...(ml ? { ml } : {}), ...(bullet ? { bullet } : {}), ...(listEl.hasAttribute('data-restart') ? { restart: true } : {}) } });
    n++;
    nested.forEach(nl => listModel(nl, lf, out, level + 1, indent, [...path, n - 1], root));
  }
}

function tableModel(tbl, f) {
  const rows = [];
  const trs = Array.from(tbl.rows || tbl.querySelectorAll('tr'));
  let maxCols = 0;
  let headerRows = 0;
  trs.forEach((tr, i) => { if ((tr.hasAttribute('data-hdr') || tr.parentElement.tagName === 'THEAD') && i === headerRows) headerRows++; });
  for (const tr of trs) {
    const cells = [];
    let cols = 0;
    for (const td of Array.from(tr.cells || [])) {
      const cf = fmtFromElement(td, td.tagName === 'TH' ? { ...f, b: true } : f);
      const blocks = [];
      walkBlocks(td, cf, blocks, { level: -1, indent: 0 });
      const colspan = Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1);
      const rowspan = Math.max(1, parseInt(td.getAttribute('rowspan'), 10) || 1);
      const st = td.style || {};
      const bd = {};
      for (const [k, prop] of [['t', 'borderTop'], ['r', 'borderRight'], ['b', 'borderBottom'], ['l', 'borderLeft']]) {
        const v = st[prop];
        if (!v) continue;
        if (/none|hidden/.test(v) || /^0(px|pt)?\b/.test(v)) bd[k] = { none: true };
        else { const w = parseSize((/([\d.]+(px|pt))/.exec(v) || [])[1], 12) || 0.75; bd[k] = { w, color: normColor((/(#[0-9a-f]{3,6}|rgba?\([^)]*\))/i.exec(v) || [])[1]) || '#1A1A1A', style: /double/.test(v) ? 'double' : /dashed/.test(v) ? 'dashed' : /dotted/.test(v) ? 'dotted' : 'single' }; }
      }
      cells.push({ blocks, colspan, rowspan, bg: normColor(st.backgroundColor), align: st.textAlign || null, valign: st.verticalAlign && st.verticalAlign !== 'top' ? st.verticalAlign : null, header: td.tagName === 'TH', ...(Object.keys(bd).length ? { borders: bd } : {}) });
      cols += colspan;
    }
    maxCols = Math.max(maxCols, cols);
    rows.push(cells);
  }
  // column widths (percent) from <col>
  let widths = Array.from(tbl.querySelectorAll('col')).map(c => parseFloat((c.style && c.style.width) || c.getAttribute('width')) || 0);
  if (widths.length !== maxCols || widths.some(w => !w)) widths = new Array(maxCols).fill(100 / Math.max(1, maxCols));
  const sum = widths.reduce((a, b) => a + b, 0) || 1;
  widths = widths.map(w => (w / sum) * 100);
  const styleCls = Array.from(tbl.classList || []).find(c => /^ts-/.test(c));
  const width = tbl.style && /%$/.test(tbl.style.width || '') ? parseFloat(tbl.style.width) : null;
  return { type: 'table', rows, widths, borderless: tbl.classList.contains('borderless'), cols: maxCols, headerRows, ...(styleCls ? { style: styleCls.slice(3) } : {}), ...(width && width < 100 ? { widthPct: width } : {}), ...(tbl.getAttribute('data-align') ? { align: tbl.getAttribute('data-align') } : {}) };
}

/** Heading numbers ("1.2") on numbered heading styles (styles.hN.numbered), in reading order. */
function numberHeadings(blocks, styles) {
  const num = headingNumberer(styles);
  if (!num.any) return;
  const walk = bs => bs.forEach(b => { if (b.type === 'para' && /^h[1-6]$/.test(b.tag)) { const n = num(b.tag); if (n) b.hnum = n; } else if (b.type === 'section') walk(b.blocks); });
  walk(blocks);
}

/** Text of a paragraph's runs (deleted text skipped). */
export function runsText(runs) { return runs.map(r => (r.del ? '' : r.text || '')).join('').replace(/\s+/g, ' ').trim(); }

/** Headings of a model for tables of contents: [{ level, text, index }] (index = top-level block index) */
export function modelHeadings(model, depth = 3) {
  const out = [];
  model.blocks.forEach((b, i) => {
    if (b.type !== 'para' || !/^h[1-6]$/.test(b.tag)) return;
    const level = +b.tag[1];
    if (level > depth) return;
    const text = runsText(b.runs);
    if (text) out.push({ level, text: b.hnum ? `${b.hnum} ${text}` : text, index: i });
  });
  return out;
}
/** Captions with a given label for a table of figures: [{ level: 1, text, index }] */
export function modelCaptions(model, label) {
  const out = [];
  model.blocks.forEach((b, i) => {
    if (b.type !== 'para' || !b.runs.some(r => r.seq === label)) return;
    const text = runsText(b.runs);
    if (text) out.push({ level: 1, text, index: i });
  });
  return out;
}
/** Entries of a toc block (headings or captions). */
export function tocEntries(model, b) { return b.kind === 'captions' ? modelCaptions(model, b.label || 'Abbildung') : modelHeadings(model, b.depth || 3); }

/** Tab stops: "120,240:r:dot" → [{ pos, align, leader }] (pos in pt). */
export function parseTabs(v) {
  const AL = { l: 'left', c: 'center', r: 'right', d: 'decimal' };
  return String(v || '').split(',').map(x => {
    const [p, a, l] = x.split(':');
    const pos = parseFloat(p);
    if (!(pos > 0 && pos < 2000)) return null;
    return { pos, align: AL[a] || 'left', leader: ['dot', 'dash', 'line'].includes(l) ? l : 'none' };
  }).filter(Boolean).sort((a, b) => a.pos - b.pos).slice(0, 20);
}
export function formatTabs(list) {
  const AL = { left: 'l', center: 'c', right: 'r', decimal: 'd' };
  return list.map(t => `${Math.round(t.pos * 10) / 10}${t.align !== 'left' || t.leader !== 'none' ? `:${AL[t.align] || 'l'}${t.leader !== 'none' ? `:${t.leader}` : ''}` : ''}`).join(',');
}

/** Plain text of a model (for .txt export and search). */
export function modelToText(model) {
  const out = [];
  const paraText = b => b.runs.map(r => (r.del ? '' : r.br ? '\n' : r.text || (r.img ? '' : ''))).join('');
  const walk = blocks => {
    for (const b of blocks) {
      if (b.type === 'para') {
        let prefix = b.hnum ? `${b.hnum} ` : '';
        if (b.list) prefix = '  '.repeat(b.list.level) + (b.list.ordered ? `${listLabel(b.list)} ` : '• ');
        out.push(prefix + paraText(b));
      } else if (b.type === 'table') {
        for (const row of b.rows) out.push(row.map(c => c.blocks.filter(x => x.type === 'para').map(paraText).join(' ')).join('\t'));
        out.push('');
      } else if (b.type === 'pagebreak') out.push('\f');
      else if (b.type === 'hr') out.push('----------');
      else if (b.type === 'section' || b.type === 'textbox') walk(b.blocks);
    }
  };
  walk(model.blocks);
  return out.join('\n').replace(/\n\f\n/g, '\n\n').replace(/\f/g, '');
}

/** Markdown export. */
export function modelToMarkdown(model) {
  const out = [];
  const notes = [];
  const inline = runs => runs.map(r => {
    if (r.del) return '';
    if (r.fn != null || r.en != null) { notes.push(r.fn != null ? r.fn : r.en); return `[^${notes.length}]`; }
    if (r.br) return '  \n';
    if (r.img) return r.img.alt ? `![${r.img.alt}]` : '';
    let t = (r.text || '').replace(/([*_`\\])/g, '\\$1');
    if (!t.trim()) return t;
    if (r.mono) t = '`' + t + '`';
    if (r.b) t = `**${t}**`;
    if (r.i) t = `*${t}*`;
    if (r.s) t = `~~${t}~~`;
    if (r.href) t = `[${t}](${r.href})`;
    return t;
  }).join('');
  const flat = [];
  const flatten = bs => bs.forEach(b => (b.type === 'section' || b.type === 'textbox' ? flatten(b.blocks) : flat.push(b)));
  flatten(model.blocks);
  for (const b of flat) {
    if (b.type === 'para') {
      const text = inline(b.runs);
      if (b.tag === 'title') out.push('# ' + text.replace(/\*\*/g, ''), '');
      else if (b.tag === 'quote') out.push('> ' + text, '');
      else if (b.tag === 'code') out.push('```', b.runs.map(r => (r.br ? '\n' : r.text || '')).join(''), '```', '');
      else if (/^h[1-6]$/.test(b.tag)) out.push('#'.repeat(+b.tag[1]) + ' ' + (b.hnum ? `${b.hnum} ` : '') + text.replace(/\*\*/g, ''), '');
      else if (b.list) out.push('   '.repeat(b.list.level) + (b.list.ordered ? `${b.list.index}. ` : '- ') + text);
      else out.push(text, '');
    } else if (b.type === 'table') {
      const rows = b.rows.map(r => '| ' + r.map(c => c.blocks.filter(x => x.type === 'para').map(p => inline(p.runs)).join(' ').replace(/\|/g, '\\|')).join(' | ') + ' |');
      if (rows.length) rows.splice(1, 0, '|' + ' --- |'.repeat(b.cols));
      out.push(...rows, '');
    } else if (b.type === 'hr' || b.type === 'pagebreak') out.push('---', '');
  }
  if (notes.length) out.push('', ...notes.map((t, i) => `[^${i + 1}]: ${t.replace(/\n/g, ' ')}`));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function alpha(n) { let s = '', k = n; while (k > 0) { k--; s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); } return s; }
function roman(n) { let s = '', k = n; for (const [v, r] of ROMAN) while (k >= v) { s += r; k -= v; } return s; }
/** Numbering text of a list paragraph: 1. · a. · iv. · 1.2.3. (ml="legal") · 1. a) i. (ml="outline") */
export function listLabel(l) {
  const n = l.index;
  if (l.ml === 'legal' && l.path && l.path.length) return l.path.join('.') + '.';
  if (l.ml === 'outline') { const lv = (l.level || 0) % 3; return lv === 0 ? `${n}.` : lv === 1 ? `${alpha(n)})` : `${roman(n)}.`; }
  if (l.type === 'a' || l.type === 'A') { const s = alpha(n); return (l.type === 'A' ? s.toUpperCase() : s) + '.'; }
  if (l.type === 'i' || l.type === 'I') { const s = roman(n); return (l.type === 'I' ? s.toUpperCase() : s) + '.'; }
  return n + '.';
}
export const BULLETS = { disc: '•', circle: '◦', square: '▪', dash: '–', check: '✓', arrow: '➢' };
export function bulletChar(l) { return BULLETS[l.bullet] || ['•', '◦', '▪'][(l.level || 0) % 3]; }

// ---------------- text / markdown → HTML ----------------
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function textToHtml(text) {
  const paras = String(text).replace(/\r\n?/g, '\n').split('\n');
  return paras.map(l => `<p>${l ? escH(l) : '<br>'}</p>`).join('');
}

let mdNotes = null; // footnote definitions of the Markdown text being converted
function mdInline(s) {
  let t = escH(s);
  if (mdNotes) t = t.replace(/\[\^([^\]\s]+)\]/g, (m, id) => (mdNotes.has(id) ? `<sup class="fn" data-fn="${escH(mdNotes.get(id))}" contenteditable="false"></sup>` : m));
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt) => alt ? `[${alt}]` : '');
  t = t.replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<strong>${a || b}</strong>`);
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return t;
}

export function markdownToHtml(md) {
  mdNotes = new Map();
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n').filter(l => { const m = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(l); if (m) { mdNotes.set(m[1], m[2].trim()); return false; } return true; });
  const out = [];
  let para = [];
  let listStack = [];
  let inCode = false, code = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(mdInline).join('<br>')}</p>`); para = []; } };
  const closeLists = (to = 0) => { while (listStack.length > to) out.push(`</li></${listStack.pop().tag}>`); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      if (inCode) { out.push(`<pre>${escH(code.join('\n'))}</pre>`); code = []; inCode = false; }
      else { flushPara(); closeLists(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeLists(); out.push(`<h${h[1].length}>${mdInline(h[2].replace(/\s#+$/, ''))}</h${h[1].length}>`); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(line)) { flushPara(); closeLists(); out.push('<hr>'); continue; }
    if (li) {
      flushPara();
      const depth = Math.floor(li[1].replace(/\t/g, '    ').length / 2);
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      const level = Math.min(depth, listStack.length);
      if (listStack.length > level + 1) closeLists(level + 1);
      if (listStack.length === level + 1 && listStack[level].tag !== tag) closeLists(level);
      if (listStack.length === level + 1) out.push('</li>');
      else if (listStack.length < level + 1) { out.push(`<${tag}>`); listStack.push({ tag }); }
      let text = li[3];
      const task = /^\[( |x)\]\s+(.*)$/i.exec(text);
      if (task) text = (task[1] === ' ' ? '☐ ' : '☑ ') + task[2];
      out.push(`<li>${mdInline(text)}`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) { flushPara(); closeLists(); out.push(`<blockquote><p>${mdInline(line.replace(/^\s*>\s?/, ''))}</p></blockquote>`); continue; }
    if (/^\|.*\|\s*$/.test(line.trim()) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara(); closeLists();
      const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(line);
      i++;
      const body = [];
      while (i + 1 < lines.length && /^\|.*\|\s*$/.test(lines[i + 1].trim())) { body.push(row(lines[++i])); }
      out.push('<table><tbody><tr>' + head.map(c => `<td><strong>${mdInline(c)}</strong></td>`).join('') + '</tr>' + body.map(r => '<tr>' + r.map(c => `<td>${mdInline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (!line.trim()) { flushPara(); closeLists(); continue; }
    if (listStack.length) { out.push('<br>' + mdInline(line.trim())); continue; }
    para.push(line.trim());
  }
  if (inCode) out.push(`<pre>${escH(code.join('\n'))}</pre>`);
  flushPara(); closeLists();
  return out.join('') || '<p><br></p>';
}
