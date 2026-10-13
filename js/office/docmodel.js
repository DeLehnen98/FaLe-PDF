// Neutral document model shared by the .docx writer, the PDF exporter and text export.
// Built from editor HTML (tags + inline styles only, no layout needed → works off-screen).

export const HEADING_PT = { h1: 20, h2: 16, h3: 13.5, h4: 12, h5: 11, h6: 11, subtitle: 13 };
export const PARA_SPACE = { p: [0, 6], h1: [14, 8], h2: [14, 6], h3: [12, 4], h4: [10, 4], h5: [8, 4], h6: [8, 4], subtitle: [0, 10], li: [0, 3] };

const FONT_KEYWORDS = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 };
const FONT_TAG_SIZES = { 1: 7.5, 2: 10, 3: 12, 4: 13.5, 5: 18, 6: 24, 7: 36 };
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TBODY', 'THEAD', 'TR', 'TD', 'TH']);

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
  if (t === 'U' || t === 'INS') n.u = true;
  if (t === 'S' || t === 'STRIKE' || t === 'DEL') n.s = true;
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
    if (/mono|courier|consolas/i.test(ff)) n.mono = true; else if (/serif|times|georgia|garamond/i.test(ff) && !/sans/i.test(ff)) n.serif = true;
    if (st.verticalAlign === 'super') n.sup = true;
    if (st.verticalAlign === 'sub') n.sub = true;
    if (st.textTransform === 'uppercase') n.upper = true;
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
  if (t === 'IMG') {
    const src = c.getAttribute('src');
    if (src) runs.push({ img: { src, w: +c.getAttribute('width') || c.naturalWidth || 0, h: +c.getAttribute('height') || c.naturalHeight || 0, alt: c.getAttribute('alt') || '' } });
    return;
  }
  if (t === 'SCRIPT' || t === 'STYLE' || (c.classList && c.classList.contains('img-missing'))) return;
  if (c.hasAttribute && c.hasAttribute('data-page-break')) return;
  if (BLOCK_TAGS.has(t)) { // block inside inline context: separate by a line break
    if (runs.length && !runs[runs.length - 1].br) runs.push({ br: true });
  }
  inlineRuns(c, fmtFromElement(c, f), runs);
}

function pickFmt(f) {
  const o = {};
  for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'serif', 'color', 'bg', 'size', 'href', 'cmt']) if (f[k]) o[k] = f[k];
  return o;
}

function blockAttrs(el) {
  const st = el.style || {};
  const a = {};
  const ta = st.textAlign || el.getAttribute('align');
  if (ta && ['center', 'right', 'justify'].includes(ta)) a.align = ta;
  if (st.marginLeft) { const v = parseSize(st.marginLeft, 12); if (v > 2) a.indent = v; }
  if (st.paddingLeft && el.tagName !== 'LI') { const v = parseSize(st.paddingLeft, 12); if (v > 2) a.indent = (a.indent || 0) + v; }
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
export function htmlToModel(rootOrHtml, { baseSize = 11 } = {}) {
  let root = rootOrHtml;
  if (typeof rootOrHtml === 'string') {
    root = new DOMParser().parseFromString(`<body>${rootOrHtml}</body>`, 'text/html').body;
  }
  const base = { base: baseSize };
  const blocks = [];
  walkBlocks(root, base, blocks, { level: -1, indent: 0 });
  const comments = {};
  root.querySelectorAll('[data-cmt]').forEach(el => {
    const id = el.getAttribute('data-cmt');
    if (!comments[id]) comments[id] = { text: el.getAttribute('data-cmt-text') || '', author: el.getAttribute('data-cmt-author') || '', date: el.getAttribute('data-cmt-date') || '' };
  });
  return { blocks, baseSize, comments };
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
    if (c.hasAttribute('data-toc')) { out.push({ type: 'toc', title: c.getAttribute('data-toc-title') || 'Inhaltsverzeichnis', depth: +(c.getAttribute('data-toc-depth') || 3) }); continue; }
    const ff = fmtFromElement(c, f);
    if (t === 'HR') { out.push(c.hasAttribute('data-page-break') ? { type: 'pagebreak' } : { type: 'hr' }); continue; }
    if (t === 'TABLE') { out.push(tableModel(c, ff)); continue; }
    if (t === 'UL' || t === 'OL') { listModel(c, ff, out, ctx.level + 1, ctx.indent || 0); continue; }
    if (/^H[1-6]$/.test(t) || t === 'P' || (t === 'DIV' && !hasBlockChild(c)) || t === 'PRE' || t === 'LI') {
      const tag = /^H[1-6]$/.test(t) ? t.toLowerCase() : c.classList.contains('subtitle') ? 'subtitle' : 'p';
      const fm = t === 'PRE' ? { ...ff, mono: true } : ff;
      const runs = trimRuns(inlineRuns(c, fm, []));
      out.push({ type: 'para', tag, runs, ...blockAttrs(c), indent: (blockAttrs(c).indent || 0) + (ctx.indent || 0) });
      continue;
    }
    if (t === 'BLOCKQUOTE') { walkBlocks(c, { ...ff, i: true }, out, { ...ctx, indent: (ctx.indent || 0) + 24 }); continue; }
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

function listModel(listEl, f, out, level, indent) {
  const ordered = listEl.tagName === 'OL';
  const type = listEl.getAttribute('type') || '1';
  let n = parseInt(listEl.getAttribute('start'), 10) || 1;
  const listId = Math.random().toString(36).slice(2, 9);
  for (let li = listEl.firstElementChild; li; li = li.nextElementSibling) {
    if (li.tagName === 'UL' || li.tagName === 'OL') { listModel(li, f, out, level + 1, indent); continue; }
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
    out.push({ type: 'para', tag: 'p', runs: trimRuns(runs), ...blockAttrs(li), indent, list: { ordered, level, index: n, type, id: listId } });
    n++;
    nested.forEach(nl => listModel(nl, lf, out, level + 1, indent));
  }
}

function tableModel(tbl, f) {
  const rows = [];
  const trs = Array.from(tbl.rows || tbl.querySelectorAll('tr'));
  let maxCols = 0;
  for (const tr of trs) {
    const cells = [];
    let cols = 0;
    for (const td of Array.from(tr.cells || [])) {
      const cf = fmtFromElement(td, td.tagName === 'TH' ? { ...f, b: true } : f);
      const blocks = [];
      walkBlocks(td, cf, blocks, { level: -1, indent: 0 });
      const colspan = Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1);
      const rowspan = Math.max(1, parseInt(td.getAttribute('rowspan'), 10) || 1);
      cells.push({ blocks, colspan, rowspan, bg: normColor(td.style && td.style.backgroundColor), align: td.style && td.style.textAlign || null, header: td.tagName === 'TH' });
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
  return { type: 'table', rows, widths, borderless: tbl.classList.contains('borderless'), cols: maxCols };
}

/** Headings of a model for tables of contents: [{ level, text, index }] */
export function modelHeadings(model, depth = 3) {
  const out = [];
  model.blocks.forEach((b, i) => {
    if (b.type !== 'para' || !/^h[1-6]$/.test(b.tag)) return;
    const level = +b.tag[1];
    if (level > depth) return;
    const text = b.runs.map(r => r.text || '').join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ level, text, index: i });
  });
  return out;
}

/** Plain text of a model (for .txt export and search). */
export function modelToText(model) {
  const out = [];
  const paraText = b => b.runs.map(r => (r.br ? '\n' : r.text || (r.img ? '' : ''))).join('');
  const walk = blocks => {
    for (const b of blocks) {
      if (b.type === 'para') {
        let prefix = '';
        if (b.list) prefix = '  '.repeat(b.list.level) + (b.list.ordered ? `${listLabel(b.list)} ` : '• ');
        out.push(prefix + paraText(b));
      } else if (b.type === 'table') {
        for (const row of b.rows) out.push(row.map(c => c.blocks.filter(x => x.type === 'para').map(paraText).join(' ')).join('\t'));
        out.push('');
      } else if (b.type === 'pagebreak') out.push('\f');
      else if (b.type === 'hr') out.push('----------');
    }
  };
  walk(model.blocks);
  return out.join('\n').replace(/\n\f\n/g, '\n\n').replace(/\f/g, '');
}

/** Markdown export. */
export function modelToMarkdown(model) {
  const out = [];
  const inline = runs => runs.map(r => {
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
  for (const b of model.blocks) {
    if (b.type === 'para') {
      const text = inline(b.runs);
      if (/^h[1-6]$/.test(b.tag)) out.push('#'.repeat(+b.tag[1]) + ' ' + text.replace(/\*\*/g, ''), '');
      else if (b.list) out.push('   '.repeat(b.list.level) + (b.list.ordered ? `${b.list.index}. ` : '- ') + text);
      else out.push(text, '');
    } else if (b.type === 'table') {
      const rows = b.rows.map(r => '| ' + r.map(c => c.blocks.filter(x => x.type === 'para').map(p => inline(p.runs)).join(' ').replace(/\|/g, '\\|')).join(' | ') + ' |');
      if (rows.length) rows.splice(1, 0, '|' + ' --- |'.repeat(b.cols));
      out.push(...rows, '');
    } else if (b.type === 'hr' || b.type === 'pagebreak') out.push('---', '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
export function listLabel(l) {
  const n = l.index;
  if (l.type === 'a' || l.type === 'A') {
    let s = '', k = n;
    while (k > 0) { k--; s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); }
    return (l.type === 'A' ? s.toUpperCase() : s) + '.';
  }
  if (l.type === 'i' || l.type === 'I') {
    let s = '', k = n;
    for (const [v, r] of ROMAN) while (k >= v) { s += r; k -= v; }
    return (l.type === 'I' ? s.toUpperCase() : s) + '.';
  }
  return n + '.';
}

// ---------------- text / markdown → HTML ----------------
const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function textToHtml(text) {
  const paras = String(text).replace(/\r\n?/g, '\n').split('\n');
  return paras.map(l => `<p>${l ? escH(l) : '<br>'}</p>`).join('');
}

function mdInline(s) {
  let t = escH(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, alt) => alt ? `[${alt}]` : '');
  t = t.replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<strong>${a || b}</strong>`);
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return t;
}

export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
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
