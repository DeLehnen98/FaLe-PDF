// .docx reader (own parser on top of JSZip): WordprocessingML → clean, editable HTML.
// Supports paragraphs, runs (bold/italic/underline/strike/colour/size/highlight), headings, alignment,
// numbered + bulleted lists, tables (colspan/rowspan/shading), inline images, hyperlinks, line + page breaks.
import { openZip, zipXml, kids, kid, attr, rid as relId, readRels, zipImageDataUrl, desc } from './vendor.js';
import { esc, UserError } from '../ui.js';

const HIGHLIGHT = { yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000' };
const on = el => el && !['0', 'false', 'off', 'none'].includes(String(attr(el, 'val') ?? 'true'));

export async function docxToHtml(data, name = 'Dokument') {
  const zip = await openZip(data, name);
  // main part via package relationships (usually word/document.xml)
  const pkgRels = await readRels(zip, '');
  let mainPath = 'word/document.xml';
  for (const r of pkgRels.values()) if (r.type === 'officeDocument') mainPath = r.target;
  const doc = await zipXml(zip, mainPath);
  if (!doc) throw new UserError(`„${name}“ enthält kein Word-Dokument.`);
  const rels = await readRels(zip, mainPath);
  const dir = mainPath.slice(0, mainPath.lastIndexOf('/') + 1);
  let styles = null, numbering = null, commentsDoc = null, footnotesDoc = null;
  for (const r of rels.values()) {
    if (r.type === 'styles') styles = await zipXml(zip, r.target);
    if (r.type === 'numbering') numbering = await zipXml(zip, r.target);
    if (r.type === 'comments') commentsDoc = await zipXml(zip, r.target);
    if (r.type === 'footnotes') footnotesDoc = await zipXml(zip, r.target);
  }
  if (!styles) styles = await zipXml(zip, dir + 'styles.xml');
  if (!numbering) numbering = await zipXml(zip, dir + 'numbering.xml');

  const ctx = { zip, rels, styles: readStyles(styles), num: readNumbering(numbering), images: new Map(), listCounters: new Map(), comments: readNotes(commentsDoc, 'comment'), footnotes: readNotes(footnotesDoc, 'footnote'), openCmts: [], inToc: false, tocDone: false };
  const body = desc(doc, 'body')[0];
  if (!body) throw new UserError(`„${name}“ ist leer oder beschädigt.`);

  // page setup from the last section
  const sect = kids(body, 'sectPr').pop() || desc(body, 'sectPr').pop();
  const page = { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  if (sect) {
    const sz = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    const tw = v => (v != null && !isNaN(+v) ? +v / 20 : null);
    if (sz) { page.w = tw(attr(sz, 'w')) || page.w; page.h = tw(attr(sz, 'h')) || page.h; }
    if (mar) { page.mt = tw(attr(mar, 'top')) ?? page.mt; page.mr = tw(attr(mar, 'right')) ?? page.mr; page.mb = tw(attr(mar, 'bottom')) ?? page.mb; page.ml = tw(attr(mar, 'left')) ?? page.ml; }
  }
  const blocks = await renderBlocks(kids(body), ctx);
  const html = closeLists(blocks).join('') || '<p><br></p>';
  const hf = sect ? await readHeaderFooter(zip, rels, sect) : null;
  return { html, page, baseSize: ctx.styles.baseSize, baseFont: ctx.styles.baseFont, hf };
}

/** comments.xml / footnotes.xml → Map(id → {text, author, date}) */
function readNotes(doc, tag) {
  const map = new Map();
  if (!doc) return map;
  for (const el of desc(doc, tag)) {
    const id = attr(el, 'id');
    if (tag === 'footnote' && (attr(el, 'type') === 'separator' || attr(el, 'type') === 'continuationSeparator')) continue;
    const text = desc(el, 'p').map(p => desc(p, 't').map(t => t.textContent).join('')).join('\n').trim();
    map.set(id, { text, author: attr(el, 'author') || '', date: attr(el, 'date') || '' });
  }
  return map;
}

/** Default header/footer text + page-number detection. */
async function readHeaderFooter(zip, rels, sect) {
  const out = { header: '', headerAlign: 'left', footer: '', footerAlign: 'left', pageNumbers: 'none', pageFormat: 'n' };
  let any = false;
  for (const [tag, key] of [['headerReference', 'header'], ['footerReference', 'footer']]) {
    const ref = kids(sect, tag).find(r => attr(r, 'type') === 'default') || kids(sect, tag)[0];
    const rel = ref && rels.get(relId(ref));
    if (!rel) continue;
    const doc = await zipXml(zip, rel.target);
    if (!doc) continue;
    const paras = desc(doc, 'p');
    const texts = [];
    for (const p of paras) {
      const instr = desc(p, 'instrText').map(x => x.textContent).join(' ') + ' ' + desc(p, 'fldSimple').map(x => attr(x, 'instr') || '').join(' ');
      const jc = desc(p, 'jc')[0];
      const align = { center: 'center', right: 'right', end: 'right' }[jc && attr(jc, 'val')] || 'left';
      const t = desc(p, 't').map(x => x.textContent).join('').trim();
      if (/\bPAGE\b/.test(instr)) {
        out.pageNumbers = `${key}-${align}`;
        out.pageFormat = /NUMPAGES/.test(instr) ? 'n-of-m' : 'n';
        const rest = t.replace(/^Seite\s*/i, '').replace(/\s*von\s*$/i, '').replace(/[·\-–]\s*$/, '').trim();
        if (rest && !/^\d+$/.test(rest)) { texts.push(rest); out[`${key}Align`] = align; }
      } else if (t) { texts.push(t); out[`${key}Align`] = align; }
    }
    if (texts.length) out[key] = texts.join(' ');
    if (texts.length || out.pageNumbers !== 'none') any = true;
  }
  if (attr(kid(sect, 'titlePg'), 'val') !== '0' && kid(sect, 'titlePg')) out.firstPage = false;
  return any ? out : null;
}

// ---------------- styles ----------------
function readStyles(doc) {
  const map = new Map();
  const res = { map, baseSize: 11, baseFont: '', defaultPara: null };
  if (!doc) return res;
  const dd = desc(doc, 'docDefaults')[0];
  if (dd) {
    const sz = desc(dd, 'sz')[0];
    if (sz && attr(sz, 'val')) res.baseSize = +attr(sz, 'val') / 2;
    const f = desc(dd, 'rFonts')[0];
    if (f) res.baseFont = attr(f, 'ascii') || '';
  }
  for (const s of desc(doc, 'style')) {
    const id = attr(s, 'styleId');
    const nameEl = kid(s, 'name');
    const st = {
      id, type: attr(s, 'type'), name: (nameEl ? attr(nameEl, 'val') : id || '').toLowerCase(),
      basedOn: kid(s, 'basedOn') ? attr(kid(s, 'basedOn'), 'val') : null,
      pPr: kid(s, 'pPr'), rPr: kid(s, 'rPr'), tblPr: kid(s, 'tblPr'),
      isDefault: attr(s, 'default') === '1' || attr(s, 'default') === 'true',
    };
    map.set(id, st);
    if (st.type === 'paragraph' && st.isDefault) res.defaultPara = id;
  }
  const normal = res.defaultPara && map.get(res.defaultPara);
  if (normal && normal.rPr) { const sz = kid(normal.rPr, 'sz'); if (sz) res.baseSize = +attr(sz, 'val') / 2; }
  return res;
}

function styleChain(ctx, id) {
  const out = [];
  let cur = id && ctx.styles.map.get(id);
  let guard = 0;
  while (cur && guard++ < 12) { out.push(cur); cur = cur.basedOn && ctx.styles.map.get(cur.basedOn); }
  return out;
}

function headingLevel(ctx, styleId, pPr) {
  const ol = pPr && kid(pPr, 'outlineLvl');
  if (ol && +attr(ol, 'val') < 6) return +attr(ol, 'val') + 1;
  for (const st of styleChain(ctx, styleId)) {
    const m = /^(heading|überschrift|berschrift)\s*(\d)$/.exec(st.name) || /^(heading|berschrift|uberschrift|title)(\d)?$/i.exec(st.id || '');
    if (st.name === 'title' || /^title$/i.test(st.id)) return 1;
    if (st.name === 'subtitle' || /^subtitle$/i.test(st.id)) return 0;
    if (m && m[2]) return Math.min(6, +m[2]);
    const sOl = st.pPr && kid(st.pPr, 'outlineLvl');
    if (sOl && +attr(sOl, 'val') < 6) return +attr(sOl, 'val') + 1;
  }
  return null;
}

function styleProp(ctx, styleId, which, name) {
  for (const st of styleChain(ctx, styleId)) {
    const el = st[which] && kid(st[which], name);
    if (el) return el;
  }
  return null;
}

// ---------------- numbering ----------------
function readNumbering(doc) {
  const abs = new Map(), nums = new Map();
  if (!doc) return { abs, nums };
  for (const a of desc(doc, 'abstractNum')) {
    const lv = [];
    for (const l of kids(a, 'lvl')) {
      const fmt = kid(l, 'numFmt'), start = kid(l, 'start'), txt = kid(l, 'lvlText');
      lv[+attr(l, 'ilvl')] = { fmt: fmt ? attr(fmt, 'val') : 'decimal', start: start ? +attr(start, 'val') : 1, text: txt ? attr(txt, 'val') : '' };
    }
    abs.set(attr(a, 'abstractNumId'), lv);
  }
  for (const n of desc(doc, 'num')) {
    const a = kid(n, 'abstractNumId');
    if (a) nums.set(attr(n, 'numId'), attr(a, 'val'));
  }
  return { abs, nums };
}

function listInfo(ctx, numId, ilvl) {
  if (!numId || numId === '0') return null;
  const a = ctx.num.abs.get(ctx.num.nums.get(numId));
  const lv = (a && a[ilvl]) || { fmt: 'bullet', start: 1 };
  if (lv.fmt === 'none') return null;
  const ordered = lv.fmt !== 'bullet';
  const type = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' }[lv.fmt] || '1';
  return { ordered, level: ilvl, type, start: lv.start, key: numId };
}

// ---------------- blocks ----------------
// Block output: array of strings; list paragraphs are emitted as markers {li, level, ordered, html} and grouped later.
const TOC_BLOCK = (title = 'Inhaltsverzeichnis') => `<div class="toc" data-toc data-toc-title="${esc(title)}" contenteditable="false"></div>`;
async function renderBlocks(nodes, ctx) {
  const out = [];
  for (const n of nodes) {
    const ln = n.localName;
    if (ln === 'p') {
      const pStyle = desc(n, 'pStyle')[0];
      const sv = pStyle ? attr(pStyle, 'val') || '' : '';
      const instr = desc(n, 'instrText').map(x => x.textContent).join(' ');
      if (/^TOCHeading$|^Inhaltsverzeichnisberschrift$/i.test(sv) && !ctx.tocDone) { ctx.tocTitle = desc(n, 't').map(t => t.textContent).join('').trim(); continue; }
      if (/\bTOC\b/.test(instr) && !ctx.tocDone) {
        ctx.inToc = true; ctx.tocDone = true;
        out.push(TOC_BLOCK(ctx.tocTitle || 'Inhaltsverzeichnis'));
        if (desc(n, 'fldChar').some(f => attr(f, 'fldCharType') === 'end')) ctx.inToc = false;
        continue;
      }
      if (ctx.inToc) { if (desc(n, 'fldChar').some(f => attr(f, 'fldCharType') === 'end')) ctx.inToc = false; continue; }
      out.push(...await renderParagraph(n, ctx));
    }
    else if (ln === 'tbl') out.push(await renderTable(n, ctx));
    else if (ln === 'sdt') {
      const gal = desc(n, 'docPartGallery')[0];
      if (gal && /table of contents/i.test(attr(gal, 'val') || '') && !ctx.tocDone) { ctx.tocDone = true; out.push(TOC_BLOCK()); continue; }
      out.push(...await renderBlocks(kids(kid(n, 'sdtContent')), ctx));
    }
    else if (ln === 'customXml' || ln === 'smartTag') out.push(...await renderBlocks(kids(n), ctx));
    else if (ln === 'AlternateContent') out.push(...await renderBlocks(kids(kid(n, 'Choice') || kid(n, 'Fallback')), ctx));
  }
  return out;
}

async function renderParagraph(p, ctx) {
  const pPr = kid(p, 'pPr');
  const styleId = pPr && kid(pPr, 'pStyle') ? attr(kid(pPr, 'pStyle'), 'val') : ctx.styles.defaultPara;
  const level = headingLevel(ctx, styleId, pPr);
  // list?
  let numPr = pPr && kid(pPr, 'numPr');
  if (!numPr) numPr = styleProp(ctx, styleId, 'pPr', 'numPr');
  let list = null;
  if (numPr && kid(numPr, 'numId')) list = listInfo(ctx, attr(kid(numPr, 'numId'), 'val'), kid(numPr, 'ilvl') ? +attr(kid(numPr, 'ilvl'), 'val') : 0);
  // alignment / indentation
  const jcEl = (pPr && kid(pPr, 'jc')) || styleProp(ctx, styleId, 'pPr', 'jc');
  const jc = jcEl ? attr(jcEl, 'val') : null;
  const styles = [];
  const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc];
  if (align) styles.push(`text-align:${align}`);
  const ind = pPr && kid(pPr, 'ind');
  if (ind && !list) {
    const left = +(attr(ind, 'left') ?? attr(ind, 'start') ?? 0) / 20;
    if (left >= 6) styles.push(`margin-left:${Math.round(left)}pt`);
  }
  const shd = pPr && kid(pPr, 'shd');
  const fill = shd && attr(shd, 'fill');
  if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF') styles.push(`background-color:#${fill}`);
  const pbBefore = (pPr && on(kid(pPr, 'pageBreakBefore'))) || false;

  // paragraph-level run defaults from the style (e.g. bold "Strong" paragraph styles), not for headings
  const segments = [];
  const extra = [];
  let cur = [];
  const st = { ctx, styleId, isHeading: !!level || level === 0, extra };
  for (const c of kids(p)) {
    await renderInline(c, st, cur, () => { segments.push(cur); cur = []; });
  }
  segments.push(cur);

  const out = [];
  if (pbBefore) out.push('<hr data-page-break>');
  segments.forEach((seg, i) => {
    if (i > 0) out.push('<hr data-page-break>');
    const inner = seg.join('');
    if (i > 0 && !inner.trim()) return;
    if (i === 0 && !inner.trim() && segments.length > 1 && !list) return; // paragraph holding only a page break
    const content = inner || '<br>';
    const sAttr = styles.length ? ` style="${styles.join(';')}"` : '';
    if (list && i === 0) out.push({ li: true, level: list.level, ordered: list.ordered, type: list.type, start: list.start, key: list.key, html: content, style: sAttr });
    else if (level) out.push(`<h${level}${sAttr}>${content}</h${level}>`);
    else if (level === 0) out.push(`<p class="subtitle"${sAttr}>${content}</p>`);
    else out.push(`<p${sAttr}>${content}</p>`);
  });
  out.push(...extra);
  return out;
}

function runStyle(rPr, st) {
  const ctx = st.ctx;
  let rStyle = rPr && kid(rPr, 'rStyle') ? attr(kid(rPr, 'rStyle'), 'val') : null;
  const get = name => (rPr && kid(rPr, name)) || (rStyle && styleProp(ctx, rStyle, 'rPr', name)) || (!st.isHeading && st.styleId && st.styleId !== ctx.styles.defaultPara ? styleProp(ctx, st.styleId, 'rPr', name) : null);
  const f = {};
  const b = get('b'); if (b && on(b)) f.b = true;
  const i = get('i'); if (i && on(i)) f.i = true;
  const u = get('u'); if (u && attr(u, 'val') && attr(u, 'val') !== 'none') f.u = true;
  const s = get('strike') || get('dstrike'); if (s && on(s)) f.s = true;
  const color = get('color'); const cv = color && attr(color, 'val');
  if (cv && /^[0-9a-f]{6}$/i.test(cv) && cv !== '000000') f.color = '#' + cv.toUpperCase();
  const sz = get('sz'); if (sz && !st.isHeading) { const pt = +attr(sz, 'val') / 2; if (pt && Math.abs(pt - ctx.styles.baseSize) >= 0.5) f.size = pt; }
  const hl = get('highlight'); if (hl && HIGHLIGHT[attr(hl, 'val')]) f.bg = HIGHLIGHT[attr(hl, 'val')];
  const shd = get('shd'); const sf = shd && attr(shd, 'fill'); if (!f.bg && sf && /^[0-9a-f]{6}$/i.test(sf) && sf.toUpperCase() !== 'FFFFFF' && sf !== 'auto') f.bg = '#' + sf;
  const va = get('vertAlign'); if (va) f.va = attr(va, 'val');
  const caps = get('caps'); if (caps && on(caps)) f.caps = true;
  const fonts = get('rFonts'); const ff = fonts && (attr(fonts, 'ascii') || attr(fonts, 'hAnsi'));
  if (ff && /courier|consol|mono/i.test(ff)) f.mono = true;
  else if (ff && /times|georgia|garamond|cambria|serif|book/i.test(ff)) f.serif = true;
  return f;
}

function wrapRun(text, f) {
  if (!text) return '';
  let h = text;
  if (f.b) h = `<strong>${h}</strong>`;
  if (f.i) h = `<em>${h}</em>`;
  if (f.u) h = `<u>${h}</u>`;
  if (f.s) h = `<s>${h}</s>`;
  if (f.va === 'superscript') h = `<sup>${h}</sup>`;
  if (f.va === 'subscript') h = `<sub>${h}</sub>`;
  const css = [];
  if (f.color) css.push(`color:${f.color}`);
  if (f.size) css.push(`font-size:${f.size}pt`);
  if (f.bg) css.push(`background-color:${f.bg}`);
  if (f.caps) css.push('text-transform:uppercase');
  if (f.mono) css.push('font-family:monospace');
  if (f.serif) css.push('font-family:serif');
  if (css.length) h = `<span style="${css.join(';')}">${h}</span>`;
  return h;
}

function wrapCmt(html, ctx) {
  if (!ctx.openCmts.length || !html) return html;
  const id = ctx.openCmts[ctx.openCmts.length - 1];
  const c = ctx.comments.get(id);
  if (!c) return html;
  return `<span class="cmt" data-cmt="c${esc(id)}" data-cmt-text="${esc(c.text)}" data-cmt-author="${esc(c.author)}" data-cmt-date="${esc(c.date)}">${html}</span>`;
}
async function renderInline(n, st, cur, pageBreak, link = null) {
  const ln = n.localName;
  if (ln === 'commentRangeStart') { st.ctx.openCmts.push(attr(n, 'id')); return; }
  if (ln === 'commentRangeEnd') { const id = attr(n, 'id'); st.ctx.openCmts = st.ctx.openCmts.filter(x => x !== id); return; }
  if (ln === 'r') {
    const f = runStyle(kid(n, 'rPr'), st);
    let buf = '';
    const flush = () => { if (buf) { cur.push(wrapCmt(wrapRun(buf, f), st.ctx)); buf = ''; } };
    for (const c of kids(n)) {
      const cn = c.localName;
      if (cn === 't') buf += esc(c.textContent);
      else if (cn === 'tab' || cn === 'ptab') buf += '\t';
      else if (cn === 'br' || cn === 'cr') {
        const type = attr(c, 'type');
        if (type === 'page') { flush(); pageBreak(); }
        else buf += '<br>';
      } else if (cn === 'noBreakHyphen') buf += '-';
      else if (cn === 'softHyphen') buf += '';
      else if (cn === 'sym') { const ch = attr(c, 'char'); if (ch && /^f0[a-f0-9]{2}$/i.test(ch)) buf += '•'; }
      else if (cn === 'drawing' || cn === 'pict' || cn === 'object') { flush(); cur.push(await renderDrawing(c, st)); }
      else if (cn === 'AlternateContent') { flush(); const ch = kid(c, 'Choice') || kid(c, 'Fallback'); if (ch) for (const d of kids(ch)) if (['drawing', 'pict'].includes(d.localName)) cur.push(await renderDrawing(d, st)); }
      else if (cn === 'lastRenderedPageBreak') { /* layout hint only */ }
      else if (cn === 'footnoteReference') { flush(); const fn = st.ctx.footnotes.get(attr(c, 'id')); if (fn) cur.push(`<sup class="fn" data-fn="${esc(fn.text)}" contenteditable="false"></sup>`); }
      else if (cn === 'commentReference') { /* anchor only */ }
    }
    flush();
    return;
  }
  if (ln === 'hyperlink') {
    const rid = relId(n);
    const rel = rid && st.ctx.rels.get(rid);
    const href = rel && rel.external ? rel.target : null;
    const inner = [];
    for (const c of kids(n)) await renderInline(c, st, inner, pageBreak);
    const html = inner.join('');
    if (href && /^(https?:|mailto:|tel:)/i.test(href)) cur.push(`<a href="${esc(href)}">${html}</a>`);
    else cur.push(html);
    return;
  }
  if (['ins', 'smartTag', 'customXml', 'fldSimple', 'bdo', 'dir', 'moveTo'].includes(ln)) { for (const c of kids(n)) await renderInline(c, st, cur, pageBreak); return; }
  if (ln === 'sdt') { for (const c of kids(kid(n, 'sdtContent'))) await renderInline(c, st, cur, pageBreak); return; }
  if (ln === 'AlternateContent') { const ch = kid(n, 'Choice') || kid(n, 'Fallback'); if (ch) for (const c of kids(ch)) await renderInline(c, st, cur, pageBreak); }
  // del, moveFrom, bookmarks, proofErr, commentRange …: ignored
}

async function renderDrawing(el, st) {
  const ctx = st.ctx;
  let html = '';
  // text boxes: render their content after the paragraph
  for (const tx of desc(el, 'txbxContent')) {
    const blocks = closeLists(await renderBlocks(kids(tx), ctx));
    if (blocks.length) st.extra.push(`<div class="textbox">${blocks.join('')}</div>`);
  }
  const blip = desc(el, 'blip')[0];
  const vimg = desc(el, 'imagedata')[0];
  const rid = blip ? (attr(blip, 'embed') || attr(blip, 'link')) : vimg ? relId(vimg) : null;
  if (!rid) return html;
  const rel = ctx.rels.get(rid);
  if (!rel || rel.external) return html;
  let url = ctx.images.get(rel.target);
  if (url === undefined) { url = await zipImageDataUrl(ctx.zip, rel.target); ctx.images.set(rel.target, url); }
  if (!url) return html + '<span class="img-missing">[Grafik]</span>';
  const ext = desc(el, 'extent')[0];
  let w = null, h = null;
  if (ext) { w = Math.round(+attr(ext, 'cx') / 9525); h = Math.round(+attr(ext, 'cy') / 9525); }
  const descr = desc(el, 'docPr')[0];
  const alt = descr ? attr(descr, 'descr') || attr(descr, 'name') || '' : '';
  return html + `<img src="${url}" alt="${esc(alt)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`;
}

async function renderTable(tbl, ctx) {
  const tblPr = kid(tbl, 'tblPr');
  // borders: explicit table borders or a grid style
  let bordered = false;
  const tStyle = tblPr && kid(tblPr, 'tblStyle') ? attr(kid(tblPr, 'tblStyle'), 'val') : null;
  const bordersEl = (tblPr && kid(tblPr, 'tblBorders')) || (tStyle && styleChain(ctx, tStyle).map(s => s.tblPr && kid(s.tblPr, 'tblBorders')).find(Boolean));
  if (bordersEl) bordered = kids(bordersEl).some(b => !['nil', 'none'].includes(attr(b, 'val')));
  if (!bordersEl && tStyle && /grid|gitter|table/i.test(tStyle) && !/normal/i.test(tStyle)) bordered = true;
  // collect grid with vMerge
  const rows = kids(tbl, 'tr');
  const grid = [];
  for (const tr of rows) {
    const cells = [];
    let col = 0;
    for (const tc of kids(tr).flatMap(c => (c.localName === 'sdt' ? kids(kid(c, 'sdtContent')) : [c]))) {
      if (tc.localName !== 'tc') continue;
      const tcPr = kid(tc, 'tcPr');
      const span = tcPr && kid(tcPr, 'gridSpan') ? +attr(kid(tcPr, 'gridSpan'), 'val') || 1 : 1;
      const vm = tcPr && kid(tcPr, 'vMerge');
      const vmerge = vm ? (attr(vm, 'val') === 'restart' ? 'restart' : 'cont') : null;
      const shd = tcPr && kid(tcPr, 'shd');
      const fill = shd && attr(shd, 'fill');
      cells.push({ tc, col, span, vmerge, fill: fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF' ? '#' + fill : null, rowspan: 1 });
      col += span;
    }
    grid.push(cells);
  }
  // compute rowspans
  grid.forEach((cells, ri) => cells.forEach(c => {
    if (c.vmerge !== 'restart') return;
    for (let r = ri + 1; r < grid.length; r++) {
      const below = grid[r].find(x => x.col === c.col);
      if (below && below.vmerge === 'cont') { c.rowspan++; below.skip = true; } else break;
    }
  }));
  // column widths
  const cols = desc(kid(tbl, 'tblGrid'), 'gridCol').map(g => +attr(g, 'w') / 20);
  const total = cols.reduce((a, b) => a + b, 0);
  let out = `<table${bordered ? '' : ' class="borderless"'}>`;
  if (cols.length && total > 0) out += '<colgroup>' + cols.map(w => `<col style="width:${(w / total * 100).toFixed(2)}%">`).join('') + '</colgroup>';
  out += '<tbody>';
  for (const cells of grid) {
    out += '<tr>';
    for (const c of cells) {
      if (c.skip) continue;
      const inner = closeLists(await renderBlocks(kids(c.tc), ctx)).join('') || '<p><br></p>';
      const at = (c.span > 1 ? ` colspan="${c.span}"` : '') + (c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '') + (c.fill ? ` style="background-color:${c.fill}"` : '');
      out += `<td${at}>${inner}</td>`;
    }
    out += '</tr>';
  }
  return out + '</tbody></table>';
}

/** Group list markers into nested <ul>/<ol>. */
function closeLists(blocks) {
  const out = [];
  let stack = []; // {tag, level, html[]}
  const closeTo = lvl => {
    while (stack.length && stack[stack.length - 1].level > lvl) {
      const top = stack.pop();
      const html = `<${top.tag}${top.attrs}>${top.items.join('')}</${top.tag}>`;
      if (stack.length) { const parent = stack[stack.length - 1]; parent.items[parent.items.length - 1] = parent.items[parent.items.length - 1].replace(/<\/li>$/, html + '</li>'); }
      else out.push(html);
    }
  };
  for (const b of blocks) {
    if (typeof b === 'object' && b && b.li) {
      const tag = b.ordered ? 'ol' : 'ul';
      closeTo(b.level);
      let top = stack[stack.length - 1];
      if (top && top.level === b.level && top.tag !== tag) { closeTo(b.level - 1); top = stack[stack.length - 1]; }
      if (!top || top.level < b.level) {
        const attrs = tag === 'ol' ? `${b.type !== '1' ? ` type="${b.type}"` : ''}${b.start > 1 ? ` start="${b.start}"` : ''}` : '';
        stack.push({ tag, level: b.level, items: [], attrs });
        top = stack[stack.length - 1];
        // nested list without a parent item: create an empty one
        if (stack.length > 1) { const parent = stack[stack.length - 2]; if (!parent.items.length) parent.items.push('<li></li>'); }
      }
      top.items.push(`<li${b.style || ''}>${b.html}</li>`);
    } else {
      closeTo(-1);
      out.push(b);
    }
  }
  closeTo(-1);
  return out;
}

/** Plain text of a docx (for the search index). */
export async function docxText(data) {
  const { html } = await docxToHtml(data);
  return htmlToText(html);
}

export function htmlToText(html) {
  const d = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  d.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  d.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,tr,div').forEach(e => e.append('\n'));
  d.querySelectorAll('td').forEach(e => e.append('\t'));
  return (d.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
