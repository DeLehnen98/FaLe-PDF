// GENERATED – synced copy of js/office/docx-read.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// .docx reader (own parser on top of JSZip): WordprocessingML → clean, editable HTML.
// Supports paragraphs, runs (bold/italic/underline/strike/colour/size/highlight), headings, alignment,
// numbered + bulleted lists, tables (colspan/rowspan/shading), inline images, hyperlinks, line + page breaks.
import { openZip, zipXml, kids, kid, attr, rid as relId, readRels, zipImageDataUrl, desc } from './vendor.js';
import { esc, UserError } from '../../conv-office-shim.js';
import { fontCss } from './fonts.js';
import { toSimple } from './hfnorm.js';

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
  let styles = null, numbering = null, commentsDoc = null, footnotesDoc = null, endnotesDoc = null, settingsDoc = null;
  for (const r of rels.values()) {
    if (r.type === 'styles') styles = await zipXml(zip, r.target);
    if (r.type === 'numbering') numbering = await zipXml(zip, r.target);
    if (r.type === 'comments') commentsDoc = await zipXml(zip, r.target);
    if (r.type === 'footnotes') footnotesDoc = await zipXml(zip, r.target);
    if (r.type === 'endnotes') endnotesDoc = await zipXml(zip, r.target);
    if (r.type === 'settings') settingsDoc = await zipXml(zip, r.target);
  }
  if (!styles) styles = await zipXml(zip, dir + 'styles.xml');
  if (!numbering) numbering = await zipXml(zip, dir + 'numbering.xml');

  const body = desc(doc, 'body')[0];
  if (!body) throw new UserError(`„${name}“ ist leer oder beschädigt.`);
  const used = new Set(desc(body, 'pStyle').map(x => attr(x, 'val')));
  const ctx = { zip, rels, styles: readStyles(styles, used), num: readNumbering(numbering), images: new Map(), listCounters: new Map(), comments: readNotes(commentsDoc, 'comment'), footnotes: readNotes(footnotesDoc, 'footnote'), endnotes: readNotes(endnotesDoc, 'endnote'), openCmts: [], inToc: false, tocDone: false, depth: 0, numberedHeadings: new Set(), dropLetter: null };

  // sections: paragraph-level w:sectPr end a section, the body-level one describes the last section
  const sect = kids(body, 'sectPr').pop() || null;
  const allSects = [...desc(body, 'pPr').map(p => kid(p, 'sectPr')).filter(Boolean), ...(sect ? [sect] : [])];
  const tw = v => (v != null && !isNaN(+v) ? +v / 20 : null);
  // page setup from the first section (later sections may switch orientation)
  const sect0 = allSects[0] || sect;
  const page = { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  if (sect0) {
    const sz = kid(sect0, 'pgSz'), mar = kid(sect0, 'pgMar');
    if (sz) { page.w = tw(attr(sz, 'w')) || page.w; page.h = tw(attr(sz, 'h')) || page.h; }
    if (mar) { page.mt = tw(attr(mar, 'top')) ?? page.mt; page.mr = tw(attr(mar, 'right')) ?? page.mr; page.mb = tw(attr(mar, 'bottom')) ?? page.mb; page.ml = tw(attr(mar, 'left')) ?? page.ml; }
  }
  const blocks = await renderBlocks(kids(body), ctx);
  const parts = [];
  let curPart = [];
  for (const b of blocks) {
    if (b && typeof b === 'object' && b.sectEnd) { parts.push({ ...b.info, items: curPart }); curPart = []; continue; }
    curPart.push(b);
  }
  parts.push({ ...sectInfo(sect), items: curPart });
  const firstOrient = orientOf(sect0) || (page.w > page.h ? 'landscape' : 'portrait');
  let prevOrient = firstOrient;
  const html = parts.map((pt, i) => {
    const inner = closeLists(pt.items).join('');
    const body2 = pt.cols > 1 && inner ? `<div class="sect" data-cols="${Math.min(4, pt.cols)}" data-gap="${Math.round(pt.gap || 18)}" style="columns:${Math.min(4, pt.cols)};column-gap:${Math.round(pt.gap || 18)}pt">${inner}</div>` : inner;
    let brk = '';
    const orient = pt.orient || prevOrient;
    if (i > 0 && pt.type !== 'continuous' && (orient !== prevOrient || pt.type === 'nextPage' || pt.type === 'oddPage' || pt.type === 'evenPage')) brk = `<hr data-page-break data-break="section"${orient !== prevOrient || orient !== firstOrient ? ` data-orient="${orient}"` : ''}>`;
    prevOrient = orient;
    return brk + body2;
  }).join('') || '<p><br></p>';
  // header/footer of the first section that defines one
  const hfSect = allSects.find(sp => kids(sp, 'headerReference').length || kids(sp, 'footerReference').length) || sect;
  const evenAndOdd = !!(settingsDoc && desc(settingsDoc, 'evenAndOddHeaders')[0] && on(desc(settingsDoc, 'evenAndOddHeaders')[0]));
  const hf = hfSect ? await readHeaderFooter(zip, rels, hfSect, evenAndOdd) : null;
  // numbered headings (heading paragraphs with decimal numbering) → numbered heading styles
  let defs = ctx.styles.defs;
  if (ctx.numberedHeadings.size) { defs = { ...(defs || {}) }; for (const l of ctx.numberedHeadings) defs[`h${l}`] = { ...(defs[`h${l}`] || {}), numbered: true }; }
  return { html, page, baseSize: ctx.styles.baseSize, baseFont: ctx.styles.baseFont, hf, styles: defs, math: ctx.math || 0 };
}

const orientOf = sp => { const sz = sp && kid(sp, 'pgSz'); if (!sz) return null; const w = +attr(sz, 'w'), h = +attr(sz, 'h'); return attr(sz, 'orient') === 'landscape' || (w && h && w > h) ? 'landscape' : 'portrait'; };
const sectInfo = sp => { const cols = sp && kid(sp, 'cols'); const ty = sp && kid(sp, 'type'); return { cols: cols ? +(attr(cols, 'num') || 1) : 1, gap: cols ? +(attr(cols, 'space') || 425) / 20 : 18, orient: orientOf(sp), type: ty ? attr(ty, 'val') : 'nextPage' }; };

/** comments.xml / footnotes.xml → Map(id → {text, author, date}) */
function readNotes(doc, tag) {
  const map = new Map();
  if (!doc) return map;
  for (const el of desc(doc, tag)) {
    const id = attr(el, 'id');
    if ((tag === 'footnote' || tag === 'endnote') && /separator|continuationNotice/i.test(attr(el, 'type') || '')) continue;
    const text = desc(el, 'p').map(p => desc(p, 't').map(t => t.textContent).join('')).join('\n').trim();
    map.set(id, { text, author: attr(el, 'author') || '', date: attr(el, 'date') || '' });
  }
  return map;
}

/** Header/footer zones (left · centre · right with fields), first/even pages, numbering format, watermark. */
async function readHeaderFooter(zip, rels, sect, evenAndOdd = false) {
  const refs = { h: {}, f: {} };
  for (const [tag, w] of [['headerReference', 'h'], ['footerReference', 'f']]) for (const r of kids(sect, tag)) refs[w][attr(r, 'type') || 'default'] = r;
  let watermark = null;
  const parse = async ref => {
    const rel = ref && rels.get(relId(ref));
    if (!rel) return null;
    const doc = await zipXml(zip, rel.target);
    if (!doc) return null;
    if (!watermark) {
      const tp = desc(doc, 'textpath').find(x => attr(x, 'string'));
      if (tp) {
        const shape = tp.parentNode;
        const fill = shape && desc(shape, 'fill')[0];
        const fc = (shape && attr(shape, 'fillcolor')) || '';
        const op = fill && attr(fill, 'opacity');
        const opv = op ? (/f$/.test(op) ? +op.slice(0, -1) / 65536 : +op) : 0.45;
        watermark = { text: attr(tp, 'string').slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(fc) ? fc.toUpperCase() : fc === 'silver' ? '#B4B8CC' : '#B4B8CC', opacity: Number.isFinite(opv) && opv > 0 ? Math.round(opv * 100) / 100 : 0.45 };
      }
    }
    return zonesOfPart(doc);
  };
  const z = { h: {}, f: {} };
  for (const w of ['h', 'f']) for (const t of ['default', 'first', 'even']) z[w][t] = await parse(refs[w][t]);
  const titlePg = !!(kid(sect, 'titlePg') && on(kid(sect, 'titlePg')));
  const E = ['', '', ''];
  const adv = { zones: { h: z.h.default || E.slice(), f: z.f.default || E.slice() } };
  if (titlePg) adv.first = { h: z.h.first || E.slice(), f: z.f.first || E.slice() };
  if (evenAndOdd && (z.h.even || z.f.even)) adv.even = { h: z.h.even || E.slice(), f: z.f.even || E.slice() };
  const pnt = kid(sect, 'pgNumType');
  if (pnt) {
    const st = attr(pnt, 'start'), fmt = attr(pnt, 'fmt');
    if (st != null && !isNaN(+st)) adv.pnStart = +st;
    const F = { lowerRoman: 'i', upperRoman: 'I', lowerLetter: 'a', upperLetter: 'A' };
    if (F[fmt]) adv.pnStyle = F[fmt];
  }
  if (watermark) adv.watermark = watermark;
  const any = [adv.zones, adv.first, adv.even].some(x => x && [...x.h, ...x.f].some(Boolean));
  if (!any && !watermark) return null;
  if (!any) return { watermark };
  return toSimple(adv) || adv;
}

/** One header/footer part → [left, centre, right] with {SEITE}/{SEITEN}/{DATUM}/{TITEL} fields. */
function zonesOfPart(doc) {
  const out = ['', '', ''];
  const add = (k, t) => { t = t.replace(/\s+/g, ' ').trim(); if (t) out[k] = out[k] ? `${out[k]} ${t}` : t; };
  for (const p of desc(doc, 'p')) {
    if (p.parentNode && p.parentNode.localName === 'txbxContent') continue;
    const pPr = kid(p, 'pPr');
    const jc = pPr && kid(pPr, 'jc');
    const align = { center: 1, right: 2, end: 2 }[jc && attr(jc, 'val')] ?? 0;
    const tabs = pPr && kid(pPr, 'tabs') ? kids(kid(pPr, 'tabs'), 'tab').map(t => attr(t, 'val')).filter(v => v !== 'clear') : [];
    // segments split at tabs; fields become placeholders
    const segs = [''];
    const segAlign = [align];
    let fld = null;
    const fieldTok = instr => { const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES|DATE|TIME|TITLE)\b/i.exec(instr || ''); return m ? { PAGE: '{SEITE}', NUMPAGES: '{SEITEN}', SECTIONPAGES: '{SEITEN}', DATE: '{DATUM}', TIME: '{DATUM}', TITLE: '{TITEL}' }[m[1].toUpperCase()] : null; };
    const walk = el => {
      for (const c of kids(el)) {
        const ln = c.localName;
        if (ln === 'fldSimple') { const tok = fieldTok(attr(c, 'instr')); if (tok) segs[segs.length - 1] += tok; else walk(c); continue; }
        if (ln === 'r') {
          // a run may hold text, field characters and instructions in any order (e.g. "Seite " PAGE " von " NUMPAGES)
          for (const x of kids(c)) {
            const xl = x.localName;
            if (xl === 'fldChar') { const t = attr(x, 'fldCharType'); if (t === 'begin') fld = { instr: '', phase: 'instr' }; else if (t === 'separate' && fld) fld.phase = 'result'; else if (t === 'end' && fld) { const tok = fieldTok(fld.instr); segs[segs.length - 1] += tok || fld.result || ''; fld = null; } continue; }
            if (xl === 'instrText') { if (fld) fld.instr += x.textContent; continue; }
            if (fld && fld.phase === 'instr') continue;
            if (xl === 't') { if (fld && fld.phase === 'result') fld.result = (fld.result || '') + x.textContent; else segs[segs.length - 1] += x.textContent; }
            else if (xl === 'tab') { segs.push(''); segAlign.push(null); }
            else if (xl === 'ptab') { segs.push(''); segAlign.push({ center: 1, right: 2 }[attr(x, 'alignment')] ?? null); }
            else if (xl === 'pgNum') segs[segs.length - 1] += '{SEITE}';
          }
          continue;
        }
        if (['hyperlink', 'smartTag', 'sdt', 'sdtContent', 'ins', 'customXml'].includes(ln)) walk(c);
      }
    };
    walk(p);
    if (segs.length === 1) { add(align, segs[0]); continue; }
    // tab positions: centre/right stops (or a default "left · centre · right" layout)
    const kinds = segs.map((_, i) => (i === 0 ? 0 : segAlign[i] != null ? segAlign[i] : null));
    let ti = 0;
    for (let i = 1; i < segs.length; i++) {
      if (kinds[i] != null) continue;
      const tv = tabs[ti++];
      kinds[i] = tv === 'center' ? 1 : tv === 'right' || tv === 'end' ? 2 : segs.length === 2 ? 2 : Math.min(2, i);
    }
    segs.forEach((t, i) => add(kinds[i], t));
  }
  return out;
}

// ---------------- styles ----------------
function readStyles(doc, used = new Set()) {
  const map = new Map();
  const res = { map, baseSize: 11, baseFont: '', defaultPara: null, defs: null };
  if (!doc) return res;
  const dd = desc(doc, 'docDefaults')[0];
  let ddR = null, ddP = null;
  if (dd) {
    ddR = desc(dd, 'rPr')[0] || null; ddP = desc(dd, 'pPr')[0] || null;
    const sz = desc(dd, 'sz')[0];
    if (sz && attr(sz, 'val')) res.baseSize = +attr(sz, 'val') / 2;
    const f = desc(dd, 'rFonts')[0];
    if (f) res.baseFont = attr(f, 'ascii') || '';
  }
  for (const s of desc(doc, 'style')) {
    const id = attr(s, 'styleId');
    const nameEl = kid(s, 'name');
    const st = {
      id, type: attr(s, 'type'), name: (nameEl ? attr(nameEl, 'val') : id || '').toLowerCase(), displayName: nameEl ? attr(nameEl, 'val') : id || '', custom: attr(s, 'customStyle') === '1' || attr(s, 'customStyle') === 'true',
      basedOn: kid(s, 'basedOn') ? attr(kid(s, 'basedOn'), 'val') : null,
      pPr: kid(s, 'pPr'), rPr: kid(s, 'rPr'), tblPr: kid(s, 'tblPr'),
      isDefault: attr(s, 'default') === '1' || attr(s, 'default') === 'true',
    };
    map.set(id, st);
    if (st.type === 'paragraph' && st.isDefault) res.defaultPara = id;
  }
  const normal = res.defaultPara && map.get(res.defaultPara);
  if (normal && normal.rPr) { const sz = kid(normal.rPr, 'sz'); if (sz) res.baseSize = +attr(sz, 'val') / 2; }
  // Formatvorlagen of the editor (Standard, Titel, Überschriften …) from the file's styles
  const find = (ids, names) => { for (const i of ids) if (map.has(i)) return i; for (const st of map.values()) if (st.type === 'paragraph' && names.includes(st.name)) return st.id; return null; };
  const chainOf = id => { const out = []; let cur = id && map.get(id), g = 0; while (cur && g++ < 12) { out.push(cur); cur = cur.basedOn && map.get(cur.basedOn); } return out; };
  const prop = (chain, which, name, extra) => { for (const st of chain) { const el = st[which] && kid(st[which], name); if (el) return el; } return extra ? kid(extra, name) : null; };
  const onv = el => el && !['0', 'false', 'off'].includes(String(attr(el, 'val') ?? 'true'));
  const defOf = (id, isNormal = false) => {
    if (!id) return null;
    const ch = chainOf(id);
    const d = {};
    const f = prop(ch, 'rPr', 'rFonts', isNormal ? ddR : null);
    const fn = f && (attr(f, 'ascii') || attr(f, 'hAnsi'));
    if (fn) d.font = fn;
    const sz = prop(ch, 'rPr', 'sz', isNormal ? ddR : null); if (sz && attr(sz, 'val')) d.size = +attr(sz, 'val') / 2;
    const col = prop(ch, 'rPr', 'color'); const cv = col && attr(col, 'val'); if (cv && /^[0-9a-f]{6}$/i.test(cv)) d.color = cv.toUpperCase() === '000000' ? null : '#' + cv.toUpperCase();
    const b = prop(ch, 'rPr', 'b'); if (b) d.b = onv(b);
    const it = prop(ch, 'rPr', 'i'); if (it) d.i = onv(it);
    const sp = prop(ch, 'pPr', 'spacing', isNormal ? ddP : null);
    if (sp) {
      if (attr(sp, 'before') != null) d.before = +attr(sp, 'before') / 20;
      if (attr(sp, 'after') != null) d.after = +attr(sp, 'after') / 20;
      if (attr(sp, 'line') != null && (!attr(sp, 'lineRule') || attr(sp, 'lineRule') === 'auto')) d.line = Math.round(+attr(sp, 'line') / 240 * 100) / 100;
    }
    const jc = prop(ch, 'pPr', 'jc'); const al = jc && { center: 'center', right: 'right', end: 'right', both: 'justify' }[attr(jc, 'val')]; if (al) d.align = al;
    return d;
  };
  const ids = {
    normal: res.defaultPara, title: find(['Title', 'Titel'], ['title', 'titel']), subtitle: find(['Subtitle', 'Untertitel'], ['subtitle', 'untertitel']),
    h1: find(['Heading1', 'berschrift1', 'Überschrift1'], ['heading 1', 'überschrift 1']), h2: find(['Heading2', 'berschrift2', 'Überschrift2'], ['heading 2', 'überschrift 2']),
    h3: find(['Heading3', 'berschrift3', 'Überschrift3'], ['heading 3', 'überschrift 3']), h4: find(['Heading4', 'berschrift4', 'Überschrift4'], ['heading 4', 'überschrift 4']),
    quote: find(['Quote', 'Zitat'], ['quote', 'zitat']), code: find(['Code', 'HTMLPreformatted', 'HTMLVorformatiert'], ['code', 'html preformatted', 'html vorformatiert']),
    nospace: find(['NoSpacing', 'KeinLeerraum'], ['no spacing', 'kein leerraum']),
    caption: find(['Caption', 'Beschriftung'], ['caption', 'beschriftung']),
  };
  // user-defined paragraph styles that the document uses → u1, u2 … (max. 30)
  let un = 0;
  for (const st of map.values()) {
    if (un >= 30) break;
    if (st.type !== 'paragraph' || !st.custom || !used.has(st.id) || Object.values(ids).includes(st.id)) continue;
    if (/^(toc|verzeichnis|header|footer|kopfzeile|fußzeile|list|listenabsatz)/i.test(st.name)) continue;
    ids[`u${++un}`] = st.id;
  }
  res.ids = ids;
  res.styleIdMap = new Map(Object.entries(ids).filter(([, v]) => v).map(([k, v]) => [v, k]));
  const defs = {};
  for (const [k, id] of Object.entries(ids)) {
    const d = defOf(id, k === 'normal');
    if (/^u\d+$/.test(k)) { const st = map.get(id); defs[k] = { ...(d || {}), name: (st.displayName || id).slice(0, 40), custom: true }; const ind = prop(chainOf(id), 'pPr', 'ind'); const left = ind && +(attr(ind, 'left') ?? attr(ind, 'start') ?? 0) / 20; if (left > 2) defs[k].indent = left; continue; }
    if (d && Object.keys(d).length) defs[k] = d;
  }
  if (defs.normal && !defs.normal.size) defs.normal.size = res.baseSize;
  res.defs = Object.keys(defs).length ? defs : null;
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
  const abs = new Map(), nums = new Map(), starts = new Map();
  if (!doc) return { abs, nums, starts };
  for (const a of desc(doc, 'abstractNum')) {
    const lv = [];
    for (const l of kids(a, 'lvl')) {
      const fmt = kid(l, 'numFmt'), start = kid(l, 'start'), txt = kid(l, 'lvlText');
      lv[+attr(l, 'ilvl')] = { fmt: fmt ? attr(fmt, 'val') : 'decimal', start: start ? +attr(start, 'val') : 1, text: txt ? attr(txt, 'val') : '' };
    }
    const l1 = lv[1] || {};
    lv.ml = /%1/.test(l1.text || '') && l1.fmt === 'decimal' ? 'legal' : (lv[0] && lv[0].fmt === 'decimal' && l1.fmt === 'lowerLetter' && /\)/.test(l1.text || '') ? 'outline' : null);
    abs.set(attr(a, 'abstractNumId'), lv);
  }
  for (const n of desc(doc, 'num')) {
    const a = kid(n, 'abstractNumId');
    if (a) nums.set(attr(n, 'numId'), attr(a, 'val'));
    for (const ov of kids(n, 'lvlOverride')) { const so = kid(ov, 'startOverride'); if (so && attr(ov, 'ilvl') === '0') starts.set(attr(n, 'numId'), +attr(so, 'val')); }
  }
  return { abs, nums, starts };
}

const BULLET_KIND = { '–': 'dash', '-': 'dash', '✓': 'check', '✔': 'check', '\uF0FC': 'check', '➢': 'arrow', '→': 'arrow', '\uF0D8': 'arrow', '▪': 'square', '■': 'square', '\uF0A7': 'square', 'o': 'circle', '◦': 'circle' };
function listInfo(ctx, numId, ilvl) {
  if (!numId || numId === '0') return null;
  const a = ctx.num.abs.get(ctx.num.nums.get(numId));
  const lv = (a && a[ilvl]) || { fmt: 'bullet', start: 1 };
  if (lv.fmt === 'none') return null;
  const ordered = lv.fmt !== 'bullet';
  const type = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' }[lv.fmt] || '1';
  const start = ilvl === 0 && ctx.num.starts.has(numId) ? ctx.num.starts.get(numId) : lv.start;
  return { ordered, level: ilvl, type, start, key: numId, ml: a && a.ml, bullet: !ordered ? BULLET_KIND[lv.text] || null : null };
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
      if (/^TOCHeading$|^Inhaltsverzeichnisberschrift$/i.test(sv) && !ctx.inToc) { ctx.tocTitle = desc(n, 't').map(t => t.textContent).join('').trim(); continue; }
      if (/\bTOC\b/.test(instr) && !ctx.inToc) {
        ctx.inToc = true; ctx.tocDone = true;
        const cap = /\\c\s+"?([^"\\]+?)"?\s*(\\|$)/.exec(instr);
        out.push(cap ? `<div class="toc" data-toc data-toc-kind="${esc(cap[1].trim())}" data-toc-title="${esc(ctx.tocTitle || `${cap[1].trim()}sverzeichnis`)}" contenteditable="false"></div>` : TOC_BLOCK(ctx.tocTitle || 'Inhaltsverzeichnis'));
        ctx.tocTitle = null;
        if (desc(n, 'fldChar').some(f => attr(f, 'fldCharType') === 'end')) ctx.inToc = false;
        continue;
      }
      if (ctx.inToc) { if (desc(n, 'fldChar').some(f => attr(f, 'fldCharType') === 'end')) ctx.inToc = false; continue; }
      const pPr = kid(n, 'pPr'), sp = pPr && kid(pPr, 'sectPr');
      // an empty paragraph that only carries the section properties is not content
      if (sp && ctx.depth === 0 && !desc(n, 't').length && !desc(n, 'drawing').length && !desc(n, 'pict').length && !desc(n, 'br').length) { out.push({ sectEnd: true, info: sectInfo(sp) }); continue; }
      out.push(...await renderParagraph(n, ctx));
      if (sp && ctx.depth === 0) out.push({ sectEnd: true, info: sectInfo(sp) });
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
  // our style of this paragraph (Titel, Zitat, Code …) via the style chain
  let sid = null;
  for (const st of styleChain(ctx, styleId)) { const k = ctx.styles.styleIdMap && ctx.styles.styleIdMap.get(st.id); if (k) { sid = k; break; } }
  let level = headingLevel(ctx, styleId, pPr);
  if (sid === 'title') level = null;
  const known = !!sid;
  // list?
  let numPr = pPr && kid(pPr, 'numPr');
  if (!numPr) numPr = styleProp(ctx, styleId, 'pPr', 'numPr');
  let list = null;
  if (numPr && kid(numPr, 'numId')) list = listInfo(ctx, attr(kid(numPr, 'numId'), 'val'), kid(numPr, 'ilvl') ? +attr(kid(numPr, 'ilvl'), 'val') : 0);
  // numbered headings stay headings (the numbering becomes the heading style's "numbered" option)
  if (list && level >= 1 && sid !== 'title') { if (list.ordered) ctx.numberedHeadings.add(level); list = null; }
  // alignment / indentation / spacing (direct formatting; style values come from the Formatvorlagen)
  const jcEl = (pPr && kid(pPr, 'jc')) || (known ? null : styleProp(ctx, styleId, 'pPr', 'jc'));
  const jc = jcEl ? attr(jcEl, 'val') : null;
  const styles = [];
  const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc] || ((jc === 'left' || jc === 'start') && pPr && kid(pPr, 'jc') ? 'left' : null);
  if (align) styles.push(`text-align:${align}`);
  const ind = (pPr && kid(pPr, 'ind')) || (known ? null : styleProp(ctx, styleId, 'pPr', 'ind'));
  if (ind && !list) {
    const left = +(attr(ind, 'left') ?? attr(ind, 'start') ?? 0) / 20;
    if (left >= 6) styles.push(`margin-left:${Math.round(left * 10) / 10}pt`);
    const right = +(attr(ind, 'right') ?? attr(ind, 'end') ?? 0) / 20;
    if (right >= 6) styles.push(`margin-right:${Math.round(right * 10) / 10}pt`);
    const fl = +(attr(ind, 'firstLine') ?? 0) / 20, hg = +(attr(ind, 'hanging') ?? 0) / 20;
    if (fl >= 2) styles.push(`text-indent:${Math.round(fl * 10) / 10}pt`);
    else if (hg >= 2) styles.push(`text-indent:-${Math.round(hg * 10) / 10}pt`);
  }
  const sp = pPr && kid(pPr, 'spacing');
  if (sp) {
    if (attr(sp, 'before') != null && !attr(sp, 'beforeAutospacing')) styles.push(`margin-top:${+attr(sp, 'before') / 20}pt`);
    if (attr(sp, 'after') != null && !attr(sp, 'afterAutospacing')) styles.push(`margin-bottom:${+attr(sp, 'after') / 20}pt`);
    const ln = attr(sp, 'line'), rule = attr(sp, 'lineRule');
    if (ln != null && (!rule || rule === 'auto')) { const m = +ln / 240; if (m > 0.5 && m < 5 && Math.abs(m - 1) > 0.01) styles.push(`line-height:${Math.round(m * 1.13 * 100) / 100}`); }
  }
  const shd = pPr && kid(pPr, 'shd');
  const fill = shd && attr(shd, 'fill');
  if (fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF') styles.push(`background-color:#${fill}`);
  const pbBefore = (pPr && on(kid(pPr, 'pageBreakBefore'))) || false;
  const keepNext = (pPr && on(kid(pPr, 'keepNext'))) && !level;
  const tabsEl = pPr && kid(pPr, 'tabs');
  const TAB_AL = { center: 'c', right: 'r', end: 'r', decimal: 'd' }, TAB_LD = { dot: 'dot', middleDot: 'dot', hyphen: 'dash', underscore: 'line', heavy: 'line' };
  const tabs = tabsEl ? kids(tabsEl, 'tab').filter(t => attr(t, 'val') !== 'clear' && attr(t, 'pos') != null).map(t => { const pos = Math.round(+attr(t, 'pos') / 2) / 10; const a = TAB_AL[attr(t, 'val')] || '', l = TAB_LD[attr(t, 'leader')] || ''; return pos > 0 && pos < 2000 ? `${pos}${a || l ? `:${a || 'l'}${l ? `:${l}` : ''}` : ''}` : null; }).filter(Boolean).slice(0, 20) : [];
  // drop cap: a framed paragraph holding the first letter of the next paragraph
  const frame = pPr && kid(pPr, 'framePr');
  if (frame && /drop|margin/.test(attr(frame, 'dropCap') || '')) {
    const letter = desc(p, 't').map(t => t.textContent).join('').trim();
    if (letter && letter.length <= 3) { ctx.dropLetter = letter; return []; }
  }
  const dropLetter = ctx.dropLetter;
  ctx.dropLetter = null;

  const segments = [];
  const extra = [];
  let cur = [];
  const st = { ctx, styleId, isHeading: !!level || level === 0 || sid === 'title', extra, sid, field: null };
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
    const content = (i === 0 && dropLetter ? esc(dropLetter) : '') + inner || '<br>';
    const sAttr = (styles.length ? ` style="${styles.join(';')}"` : '') + (keepNext ? ' data-keep-next' : '') + (tabs.length ? ` data-tabs="${tabs.join(',')}"` : '') + (i === 0 && dropLetter ? ' data-dropcap' : '');
    if (list && i === 0) out.push({ li: true, level: list.level, ordered: list.ordered, type: list.type, start: list.start, key: list.key, ml: list.ml, bullet: list.bullet, html: content, style: sAttr });
    else if (level) out.push(`<h${level}${sAttr}>${content}</h${level}>`);
    else if (sid === 'title') out.push(`<p class="title"${sAttr}>${content}</p>`);
    else if (level === 0 || sid === 'subtitle') out.push(`<p class="subtitle"${sAttr}>${content}</p>`);
    else if (sid === 'quote') out.push(`<p class="quote"${sAttr}>${content}</p>`);
    else if (sid === 'nospace') out.push(`<p class="nospace"${sAttr}>${content}</p>`);
    else if (sid === 'code') out.push(`<pre${sAttr}>${content}</pre>`);
    else if (sid === 'caption') out.push(`<p class="caption"${sAttr}>${content}</p>`);
    else if (sid && /^u\d+$/.test(sid)) out.push(`<p class="us-${sid}"${sAttr}>${content}</p>`);
    else out.push(`<p${sAttr}>${content}</p>`);
  });
  out.push(...extra);
  return out;
}

function runStyle(rPr, st) {
  const ctx = st.ctx;
  let rStyle = rPr && kid(rPr, 'rStyle') ? attr(kid(rPr, 'rStyle'), 'val') : null;
  const get = name => (rPr && kid(rPr, name)) || (rStyle && styleProp(ctx, rStyle, 'rPr', name)) || (!st.isHeading && !st.sid && st.styleId && st.styleId !== ctx.styles.defaultPara ? styleProp(ctx, st.styleId, 'rPr', name) : null);
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
  const sc = get('smallCaps'); if (sc && on(sc)) f.smallCaps = true;
  const fonts = rPr && kid(rPr, 'rFonts') || (rStyle && styleProp(ctx, rStyle, 'rPr', 'rFonts'));
  const ff = fonts && (attr(fonts, 'ascii') || attr(fonts, 'hAnsi'));
  if (ff && ff !== ctx.styles.baseFont && st.sid !== 'code') f.font = ff;
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
  if (f.smallCaps) css.push('font-variant:small-caps');
  if (f.font) css.push(`font-family:${fontCss(f.font).replace(/"/g, "'")}`);
  if (css.length) h = `<span style="${esc(css.join(';'))}">${h}</span>`;
  return h;
}

function wrapCmt(html, ctx) {
  if (!ctx.openCmts.length || !html) return html;
  const id = ctx.openCmts[ctx.openCmts.length - 1];
  const c = ctx.comments.get(id);
  if (!c) return html;
  return `<span class="cmt" data-cmt="c${esc(id)}" data-cmt-text="${esc(c.text)}" data-cmt-author="${esc(c.author)}" data-cmt-date="${esc(c.date)}">${html}</span>`;
}
/** REF / PAGEREF / SEQ / = (formula) fields → editor spans with the cached result. */
const specialKind = instr => { const m = /^\s*(REF|PAGEREF|SEQ|=)/i.exec(instr || ''); return m ? m[1].toUpperCase() : null; };
const FMT_OF_PIC = { '#.##0,00 €': '0,00 €', '#,##0.00 €': '0,00 €', '#.##0,00': '0,00', '#,##0.00': '0,00', '0': '0', '0 %': '0 %', '0%': '0 %' };
function specialField(instr, result) {
  const kind = specialKind(instr);
  const res = esc(String(result || '').trim());
  if (kind === 'REF' || kind === 'PAGEREF') { const m = /^\s*(?:REF|PAGEREF)\s+"?([^"\s\\]+)/i.exec(instr); if (!m) return res; return `<span class="xref" data-ref="${esc(m[1])}" data-xk="${kind === 'PAGEREF' ? 'page' : 'text'}" contenteditable="false">${res || '?'}</span>`; }
  if (kind === 'SEQ') { const m = /^\s*SEQ\s+"?([^"\s\\]+)/i.exec(instr); return `<span class="seq" data-seq="${esc(m ? m[1] : 'Abbildung')}" contenteditable="false">${res || '1'}</span>`; }
  if (kind === '=') {
    const pic = /\\#\s*"([^"]+)"/.exec(instr) || /\\#\s*(\S+)/.exec(instr);
    const f = instr.replace(/\\#\s*("[^"]*"|\S+)/, '').replace(/\\\*\s*\S+/g, '').trim();
    return `<span class="tf" data-f="${esc(f)}" data-fmt="${esc(pic ? FMT_OF_PIC[pic[1].trim()] || '' : '')}" contenteditable="false">${res || '0'}</span>`;
  }
  return res;
}
const fieldName = instr => { const m = /MERGEFIELD\s+"?([^"\\]+?)"?(\s+\\|\s*$)/i.exec(String(instr).trim() + ' '); return m ? m[1].trim() : null; };
const mfHtml = name => `<span class="mf" data-field="${esc(name)}" contenteditable="false">«${esc(name)}»</span>`;
/** OMML → linear text: fractions (a)/(b), scripts x^2 / x_i, roots √(…), delimiters, n-ary operators. */
function mathText(n) {
  const ln = n.localName;
  const part = name => { const k = kid(n, name); return k ? mathText(k) : ''; };
  const grp = s => (s.length > 1 && !/^[\w.]+$/.test(s) ? `(${s})` : s);
  const prVal = (pr, name, def) => { const p = kid(n, pr); const v = p && kid(p, name); return v ? (attr(v, 'val') ?? '') : def; };
  switch (ln) {
    case 't': return n.textContent;
    case 'f': return `${grp(part('num'))}/${grp(part('den'))}`;
    case 'sSup': return `${part('e')}^${grp(part('sup'))}`;
    case 'sSub': return `${part('e')}_${grp(part('sub'))}`;
    case 'sSubSup': return `${part('e')}_${grp(part('sub'))}^${grp(part('sup'))}`;
    case 'sPre': return `${grp(part('sub'))}${grp(part('sup'))}${part('e')}`;
    case 'rad': { const deg = part('deg'); return `${deg ? deg : ''}√(${part('e')})`; }
    case 'd': { const es = kids(n).filter(c => c.localName === 'e').map(mathText); return prVal('dPr', 'begChr', '(') + es.join(prVal('dPr', 'sepChr', '|')) + prVal('dPr', 'endChr', ')'); }
    case 'nary': { const sub = part('sub'), sup = part('sup'); return `${prVal('naryPr', 'chr', '∫')}${sub ? '_' + grp(sub) : ''}${sup ? '^' + grp(sup) : ''} ${part('e')}`; }
    case 'oMathPara': return kids(n).filter(c => c.localName === 'oMath').map(mathText).join('   ');
    default: return ln && ln.endsWith('Pr') ? '' : kids(n).map(mathText).join('');
  }
}
async function renderInline(n, st, cur, pageBreak, link = null) {
  const ln = n.localName;
  if (ln === 'commentRangeStart') { st.ctx.openCmts.push(attr(n, 'id')); return; }
  if (ln === 'commentRangeEnd') { const id = attr(n, 'id'); st.ctx.openCmts = st.ctx.openCmts.filter(x => x !== id); return; }
  if (ln === 'bookmarkStart') { const nm = attr(n, 'name') || ''; if (nm && !/^_(GoBack|Toc|Hlk)/i.test(nm) && nm.length <= 60) cur.push(`<span class="bm" data-bm="${esc(nm)}" contenteditable="false"></span>`); return; }
  if (ln === 'r') {
    // complex fields: begin → instrText → separate → result → end (MERGEFIELD, REF/PAGEREF, SEQ, = formulas)
    const fc = kid(n, 'fldChar');
    if (fc) {
      const t = attr(fc, 'fldCharType');
      if (t === 'begin') { if (st.field) st.field.depth = (st.field.depth || 0) + 1; else st.field = { instr: '', phase: 'instr', result: '' }; }
      else if (t === 'separate' && st.field && !st.field.depth) st.field.phase = 'result';
      else if (t === 'end' && st.field) {
        if (st.field.depth) { st.field.depth--; return; }
        const f = st.field; st.field = null;
        const nm = fieldName(f.instr);
        if (nm) cur.push(mfHtml(nm));
        else { const h = specialField(f.instr, f.result); if (h) cur.push(h); }
      }
      return;
    }
    if (st.field && st.field.phase === 'instr') { const it = kid(n, 'instrText'); if (it) st.field.instr += it.textContent; return; }
    if (st.field && st.field.phase === 'result' && (fieldName(st.field.instr) || specialKind(st.field.instr))) { st.field.result += desc(n, 't').map(x => x.textContent).join(''); return; }
    const f = runStyle(kid(n, 'rPr'), st);
    let buf = '';
    const flush = () => { if (buf) { cur.push(wrapCmt(wrapRun(buf, f), st.ctx)); buf = ''; } };
    for (const c of kids(n)) {
      const cn = c.localName;
      if (cn === 't' || cn === 'delText') buf += esc(c.textContent);
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
      else if (cn === 'endnoteReference') { flush(); const en = st.ctx.endnotes.get(attr(c, 'id')); if (en) cur.push(`<sup class="en" data-en="${esc(en.text)}" contenteditable="false"></sup>`); }
      else if (cn === 'commentReference') { /* anchor only */ }
    }
    flush();
    return;
  }
  if (ln === 'hyperlink') {
    const rid = relId(n);
    const rel = rid && st.ctx.rels.get(rid);
    const anchor = attr(n, 'anchor');
    const href = rel && rel.external ? rel.target : anchor && !/^_Toc/i.test(anchor) ? `#${anchor}` : null;
    const inner = [];
    for (const c of kids(n)) await renderInline(c, st, inner, pageBreak);
    const html = inner.join('');
    if (href && /^(https?:|mailto:|tel:|#)/i.test(href)) cur.push(`<a href="${esc(href)}">${html}</a>`);
    else cur.push(html);
    return;
  }
  if (ln === 'ins' || ln === 'del') {
    const inner = [];
    for (const c of kids(n)) await renderInline(c, st, inner, pageBreak);
    const html = inner.join('');
    if (html) cur.push(`<${ln} class="tc" data-author="${esc(attr(n, 'author') || '')}" data-date="${esc(attr(n, 'date') || '')}">${html}</${ln}>`);
    return;
  }
  if (ln === 'fldSimple') {
    const instr = attr(n, 'instr') || '';
    const nm = fieldName(instr);
    if (nm) { cur.push(mfHtml(nm)); return; }
    if (specialKind(instr)) { const h = specialField(instr, desc(n, 't').map(x => x.textContent).join('')); if (h) cur.push(h); return; }
    for (const c of kids(n)) await renderInline(c, st, cur, pageBreak);
    return;
  }
  if (['smartTag', 'customXml', 'bdo', 'dir', 'moveTo'].includes(ln)) { for (const c of kids(n)) await renderInline(c, st, cur, pageBreak); return; }
  if (ln === 'sdt') {
    const tag = desc(kid(n, 'sdtPr'), 'tag')[0];
    const tv = tag ? attr(tag, 'val') || '' : '';
    if (tv.startsWith('fale-tf:')) {
      const [fmt, ...f] = tv.slice(8).split('|');
      const inner = [];
      for (const c of kids(kid(n, 'sdtContent'))) await renderInline(c, st, inner, pageBreak);
      const raw = inner.join('');
      const text = raw.replace(/<[^>]+>/g, '');
      const span = `<span class="tf" data-f="${esc(f.join('|'))}" data-fmt="${esc(fmt)}" contenteditable="false">${text || '0'}</span>`;
      cur.push(/<strong>/.test(raw) ? `<strong>${span}</strong>` : span);
      return;
    }
    for (const c of kids(kid(n, 'sdtContent'))) await renderInline(c, st, cur, pageBreak);
    return;
  }
  if (ln === 'AlternateContent') { const ch = kid(n, 'Choice') || kid(n, 'Fallback'); if (ch) for (const c of kids(ch)) await renderInline(c, st, cur, pageBreak); }
  // Office Math (OMML): no formula layout – the formula is kept as readable linear text (a/b, x^2, √(…))
  if (ln === 'oMath' || ln === 'oMathPara') { const t = mathText(n).trim(); if (t) { st.ctx.math = (st.ctx.math || 0) + 1; cur.push(`<i>${esc(t)}</i>`); } return; }
  // del, moveFrom, bookmarks, proofErr, commentRange …: ignored
}

async function renderDrawing(el, st) {
  const ctx = st.ctx;
  let html = '';
  // text boxes: render their content after the paragraph
  for (const tx of desc(el, 'txbxContent')) {
    ctx.depth++;
    const blocks = closeLists((await renderBlocks(kids(tx), ctx)).filter(b => !(b && b.sectEnd)));
    ctx.depth--;
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
  const alt = descr ? attr(descr, 'descr') || attr(descr, 'title') || '' : '';
  let wrap = '';
  const anchor = desc(el, 'anchor')[0];
  if (anchor && !desc(anchor, 'wrapNone')[0] && !desc(anchor, 'wrapTopAndBottom')[0]) {
    const ph = desc(anchor, 'positionH')[0];
    const al = ph && desc(ph, 'align')[0];
    const off = ph && desc(ph, 'posOffset')[0];
    const side = al ? (/right|outside/.test(al.textContent) ? 'right' : /center/.test(al.textContent) ? 'center' : 'left') : (off && +off.textContent > 1800000 ? 'right' : 'left');
    if (side !== 'center') wrap = side;
  } else if (anchor && desc(anchor, 'wrapTopAndBottom')[0]) wrap = 'center';
  return html + `<img src="${url}" alt="${esc(alt)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}${wrap ? ` data-wrap="${wrap}"` : ''}>`;
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
  const hdr = rows.map(tr => { const trPr = kid(tr, 'trPr'); return !!(trPr && on(kid(trPr, 'tblHeader'))); });
  const bdCss = (tcPr) => {
    const b = tcPr && kid(tcPr, 'tcBorders');
    if (!b) return '';
    let css = '';
    for (const [side, prop] of [['top', 'border-top'], ['bottom', 'border-bottom'], ['left', 'border-left'], ['start', 'border-left'], ['right', 'border-right'], ['end', 'border-right']]) {
      const e = kid(b, side);
      if (!e) continue;
      const v = attr(e, 'val');
      if (v === 'nil' || v === 'none') { css += `${prop}:none;`; continue; }
      const w = Math.max(0.5, (+attr(e, 'sz') || 4) / 8), col = attr(e, 'color');
      css += `${prop}:${w}pt ${v === 'double' ? 'double' : /dash/.test(v || '') ? 'dashed' : /dot/.test(v || '') ? 'dotted' : 'solid'} ${col && /^[0-9a-f]{6}$/i.test(col) ? '#' + col : '#1A1A1A'};`;
    }
    return css;
  };
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
      const va = tcPr && kid(tcPr, 'vAlign') ? attr(kid(tcPr, 'vAlign'), 'val') : null;
      cells.push({ tc, col, span, vmerge, fill: fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toUpperCase() !== 'FFFFFF' ? '#' + fill : null, rowspan: 1, bd: bdCss(tcPr), va: va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : null });
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
  ctx.depth++;
  for (let ri = 0; ri < grid.length; ri++) {
    const cells = grid[ri];
    out += `<tr${hdr[ri] && hdr.slice(0, ri).every(Boolean) ? ' data-hdr' : ''}>`;
    for (const c of cells) {
      if (c.skip) continue;
      const inner = closeLists(await renderBlocks(kids(c.tc), ctx)).join('') || '<p><br></p>';
      const css = (c.fill ? `background-color:${c.fill};` : '') + (c.va ? `vertical-align:${c.va};` : '') + (c.bd || '');
      const at = (c.span > 1 ? ` colspan="${c.span}"` : '') + (c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '') + (css ? ` style="${css}"` : '');
      out += `<td${at}>${inner}</td>`;
    }
    out += '</tr>';
  }
  ctx.depth--;
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
        const attrs = tag === 'ol' ? `${b.type !== '1' ? ` type="${b.type}"` : ''}${b.start > 1 ? ` start="${b.start}"` : ''}${b.ml && b.level === 0 ? ` data-ml="${b.ml}"` : ''}` : `${b.bullet ? ` data-bullet="${b.bullet}"` : ''}`;
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
