// GENERATED – synced copy of js/office/docx-write.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Document model → .docx (docx library, loaded lazily). Formatvorlagen (auch eigene), Absatzformate, Tabstopps mit
// Füllzeichen, Listen (auch mehrstufig), nummerierte Überschriften, Tabellen (Kopfzeilen, Rahmen, Schattierung,
// Formelfelder), Bilder (auch umflossen), Abschnitte (Spalten, Hoch-/Querformat je Abschnitt), Änderungen
// (w:ins/w:del), Seriendruckfelder, Kommentare, Fuß- und Endnoten, Textmarken, interne Links, Querverweise,
// Beschriftungen (SEQ), Inhalts- und Abbildungsverzeichnis, Kopf-/Fußzeilen (drei Bereiche, erste/gerade Seiten,
// Seitenzahlformat), Wasserzeichen, Initialen.
import { loadDocx, imageToBytes, loadJSZip } from './vendor.js';
import { bulletChar, tocEntries } from './docmodel.js';
import { normalizeStyles, STYLE_OF_TAG, customStyleIds } from './docstyles.js';
import { fontKind } from './fonts.js';
import { isAdvanced, fieldParts } from './hfnorm.js';

const hex = c => (c ? c.replace('#', '').toUpperCase() : undefined);
const tw = pt => Math.round(pt * 20);
const FONT_OF_KIND = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };
const esc2 = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Word bookmark names: letter first, letters/digits/underscore, max. 40 characters. */
export const bookmarkName = n => { let s = String(n || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+(?!Ref)/, ''); if (!/^[A-Za-z_]/.test(s)) s = 'M' + s; return s.slice(0, 40) || 'Marke'; };
/** Word number picture for a table formula display format. */


export async function modelToDocx(model, { title = 'Dokument', page = null, hf = null, author = '', trackChanges = false } = {}) {
  const D = await loadDocx();
  const S = normalizeStyles(model.styles);
  const base = model.baseSize || S.normal.size || 11;
  if (!model.styles && base !== 11) S.normal.size = base;
  const pg = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  const pgOf = orient => { const pw = Math.min(pg.w, pg.h), ph = Math.max(pg.w, pg.h); const land = orient ? orient === 'landscape' : pg.w > pg.h; return { ...pg, w: land ? ph : pw, h: land ? pw : ph }; };
  const contentW = pg.w - pg.ml - pg.mr;

  // pre-encode images
  const images = new Map();
  const collect = blocks => blocks.forEach(b => {
    if (b.type === 'para') b.runs.forEach(r => { if (r.img && !images.has(r.img.src)) images.set(r.img.src, null); });
    if (b.type === 'table') b.rows.forEach(row => row.forEach(c => collect(c.blocks)));
    if (b.type === 'section' || b.type === 'textbox') collect(b.blocks);
  });
  collect(model.blocks);
  for (const src of images.keys()) {
    try { images.set(src, await imageToBytes(src)); } catch (e) { console.warn('Bild übersprungen', e); }
  }

  // comments (numeric ids) + foot-/endnotes + tables of contents + drop caps
  const cmtIds = new Map();
  const cmtNum = id => { if (!cmtIds.has(id)) cmtIds.set(id, cmtIds.size); return cmtIds.get(id); };
  let openCmt = null;
  const footnoteMap = {}, endnoteMap = {};
  let fnCount = 0, enCount = 0;
  const tocs = [], dropCaps = [], tfs = [];
  let revId = 1;
  const closeCmt = out => {
    if (openCmt == null) return;
    const n = cmtNum(openCmt);
    out.push(new D.CommentRangeEnd(n), new D.TextRun({ children: [new D.CommentReference(n)] }));
    openCmt = null;
  };
  const runOpts = (r, extra = {}) => {
    const o = { ...extra };
    if (r.b) o.bold = true;
    if (r.i) o.italics = true;
    if (r.u) o.underline = {};
    if (r.s) o.strike = true;
    if (r.color) o.color = hex(r.color);
    if (r.size) o.size = Math.round(r.size * 2);
    if (r.bg) o.shading = { type: D.ShadingType.CLEAR, fill: hex(r.bg), color: 'auto' };
    if (r.sup) o.superScript = true;
    if (r.sub) o.subScript = true;
    if (r.smallCaps) o.smallCaps = true;
    if (r.font) o.font = r.font;
    else if (r.mono) o.font = 'Courier New';
    else if (r.serif) o.font = 'Times New Roman';
    return o;
  };
  const revOf = r => {
    const x = r.ins || r.del;
    const d = x && x.date ? new Date(x.date) : new Date();
    return { id: revId++, author: (x && x.author) || author || 'FaLe', date: (isNaN(d) ? new Date() : d).toISOString() };
  };
  const textRuns = (r, extra) => {
    const parts = String(r.text).split('\t');
    const out = [];
    const make = (o) => {
      if (r.ins) return new D.InsertedTextRun({ ...o, ...revOf(r) });
      if (r.del) return new D.DeletedTextRun({ ...o, ...revOf(r) });
      return new D.TextRun(o);
    };
    parts.forEach((p, i) => {
      if (i > 0) out.push(make({ ...runOpts(r, extra), children: [new D.Tab()] }));
      if (p) out.push(make({ ...runOpts(r, extra), text: p }));
    });
    return out;
  };
  /** A field with a cached result (w:fldSimple) – Word/LibreOffice update it, other readers show the result. */
  const field = (instr, r) => new D.SimpleField(instr, r && r.text != null ? String(r.text) : '');

  const inline = (runs, maxW) => {
    const out = [];
    let i = 0;
    while (i < runs.length) {
      const r = runs[i];
      if (r.text != null && (r.cmt || null) !== openCmt) {
        closeCmt(out);
        if (r.cmt && model.comments && model.comments[r.cmt]) { openCmt = r.cmt; out.push(new D.CommentRangeStart(cmtNum(r.cmt))); }
      }
      if (r.fn != null) { fnCount++; footnoteMap[fnCount] = { children: [new D.Paragraph({ children: [new D.TextRun({ text: r.fn, size: 18 })] })] }; out.push(new D.FootnoteReferenceRun(fnCount)); i++; continue; }
      if (r.en != null) { enCount++; endnoteMap[enCount] = { children: [new D.Paragraph({ children: [new D.TextRun({ text: r.en, size: 18 })] })] }; out.push(new D.EndnoteReferenceRun(enCount)); i++; continue; }
      if (r.bm != null) { out.push(new D.Bookmark({ id: bookmarkName(r.bm), children: [] })); i++; continue; }
      if (r.br) { out.push(new D.TextRun({ break: 1 })); i++; continue; }
      if (r.field != null) { out.push(new D.SimpleMailMergeField(r.field)); i++; continue; }
      if (r.xref) { out.push(field(r.xref.kind === 'page' ? ` PAGEREF ${bookmarkName(r.xref.name)} \\h ` : ` REF ${bookmarkName(r.xref.name)} \\h `, r)); i++; continue; }
      if (r.seq) { out.push(field(` SEQ ${String(r.seq).replace(/[^\p{L}\p{N}_]/gu, '')} \\* ARABIC `, r)); i++; continue; }
      if (r.tf) {
        // table formula: the result as text inside a tagged content control (Word and LibreOffice show the value;
        // our reader restores the live formula from the tag) – formula fields would be recalculated to 0 by
        // readers that do not recognise "85,00 €" as a number
        const k = tfs.length;
        tfs.push(r.tf);
        out.push(new D.TextRun({ text: `FALETFA${k}X` }), ...textRuns(r), new D.TextRun({ text: `FALETFB${k}X` }));
        i++; continue;
      }
      if (r.img) {
        const im = images.get(r.img.src);
        if (im) {
          let w = r.img.w || im.width, h = r.img.h || im.height;
          if (!r.img.h && r.img.w) h = Math.round(im.height * (r.img.w / im.width));
          const maxPx = maxW / 0.75;
          if (w > maxPx) { h = Math.round(h * (maxPx / w)); w = Math.round(maxPx); }
          const opts = { type: im.type, data: im.bytes, transformation: { width: Math.max(1, w), height: Math.max(1, h) }, altText: r.img.alt ? { name: r.img.alt, description: r.img.alt, title: r.img.alt } : undefined };
          if (r.img.wrap === 'left' || r.img.wrap === 'right') {
            opts.floating = {
              horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.COLUMN, align: r.img.wrap === 'left' ? D.HorizontalPositionAlign.LEFT : D.HorizontalPositionAlign.RIGHT },
              verticalPosition: { relative: D.VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
              wrap: { type: D.TextWrappingType.SQUARE, side: D.TextWrappingSide.BOTH_SIDES },
              margins: { left: 114300, right: 114300, top: 0, bottom: 57150 },
            };
          } else if (r.img.wrap === 'center' && runs.some(x => x !== r && ((x.text && x.text.trim()) || x.img))) {
            opts.floating = {
              horizontalPosition: { relative: D.HorizontalPositionRelativeFrom.COLUMN, align: D.HorizontalPositionAlign.CENTER },
              verticalPosition: { relative: D.VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
              wrap: { type: D.TextWrappingType.TOP_AND_BOTTOM },
              margins: { top: 57150, bottom: 57150 },
            };
          }
          out.push(new D.ImageRun(opts));
        }
        i++; continue;
      }
      if (r.href) {
        const href = r.href;
        const kids = [];
        while (i < runs.length && runs[i].href === href && runs[i].text != null) { kids.push(...textRuns(runs[i], { color: hex(runs[i].color) || '0563C1', underline: {} })); i++; }
        if (/^(https?:|mailto:|tel:)/i.test(href)) out.push(new D.ExternalHyperlink({ link: href, children: kids }));
        else if (href.startsWith('#') && href.length > 1) out.push(new D.InternalHyperlink({ anchor: bookmarkName(decodeURIComponent(href.slice(1))), children: kids }));
        else out.push(...kids);
        continue;
      }
      if (r.text != null) out.push(...textRuns(r));
      i++;
    }
    return out;
  };

  const ALIGN = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };
  const HEAD = { h1: D.HeadingLevel.HEADING_1, h2: D.HeadingLevel.HEADING_2, h3: D.HeadingLevel.HEADING_3, h4: D.HeadingLevel.HEADING_4, h5: D.HeadingLevel.HEADING_5, h6: D.HeadingLevel.HEADING_6, title: D.HeadingLevel.TITLE };
  const PSTYLE = { subtitle: 'Subtitle', quote: 'Quote', code: 'Code', nospace: 'NoSpacing', caption: 'Caption' };
  const TABTYPE = { left: D.TabStopType.LEFT, center: D.TabStopType.CENTER, right: D.TabStopType.RIGHT, decimal: D.TabStopType.DECIMAL };
  const LEADER = { dot: D.LeaderType.DOT, dash: D.LeaderType.HYPHEN, line: D.LeaderType.UNDERSCORE };
  const customId = id => `FaleStyle${id.slice(1)}`;

  // numbering configurations (created on demand)
  const numConfigs = new Map();
  const listInstances = new Map();
  const listStarts = new Map();
  let instanceNo = 0;
  const lvl = (fmt, textFn, start = 1, extra = {}) => Array.from({ length: 9 }, (_, l) => ({
    level: l, format: typeof fmt === 'function' ? fmt(l) : fmt, text: textFn(l), alignment: D.AlignmentType.START, start: l === 0 ? start : 1,
    style: { paragraph: { indent: { left: 360 + l * 360, hanging: 300 } }, ...(extra.run ? { run: extra.run(l) } : {}) },
  }));
  const OLFMT = { 1: D.LevelFormat.DECIMAL, a: D.LevelFormat.LOWER_LETTER, A: D.LevelFormat.UPPER_LETTER, i: D.LevelFormat.LOWER_ROMAN, I: D.LevelFormat.UPPER_ROMAN };
  function numRef(list) {
    let key, make;
    const start = list.ordered && list.level === 0 && list.startIndex > 1 ? list.startIndex : 1;
    if (!list.ordered) {
      key = `fale-ul-${list.bullet || 'std'}`;
      make = () => lvl(D.LevelFormat.BULLET, l => (list.bullet ? bulletChar({ bullet: list.bullet, level: l }) : ['•', '◦', '▪'][l % 3]), 1, { run: () => (list.bullet === 'check' || list.bullet === 'arrow' ? { font: 'Segoe UI Symbol' } : {}) });
    } else if (list.ml === 'legal') {
      key = `fale-ol-legal-s${start}`;
      make = () => lvl(D.LevelFormat.DECIMAL, l => Array.from({ length: l + 1 }, (_, k) => `%${k + 1}`).join('.') + '.', start);
    } else if (list.ml === 'outline') {
      key = `fale-ol-outline-s${start}`;
      make = () => lvl(l => [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN][l % 3], l => [`%${l + 1}.`, `%${l + 1})`, `%${l + 1}.`][l % 3], start);
    } else {
      const t = OLFMT[list.type] ? list.type : '1';
      key = `fale-ol-${t}-s${start}`;
      make = () => lvl(OLFMT[t], l => `%${l + 1}.`, start);
    }
    if (!numConfigs.has(key)) numConfigs.set(key, { reference: key, levels: make() });
    return key;
  }
  // numbered headings: 1 / 1.1 / 1.1.1 followed by a space (German convention, no trailing dot)
  const headingNumRef = () => {
    if (!numConfigs.has('fale-headings')) numConfigs.set('fale-headings', { reference: 'fale-headings', levels: Array.from({ length: 9 }, (_, l) => ({ level: l, format: D.LevelFormat.DECIMAL, text: Array.from({ length: l + 1 }, (_, k) => `%${k + 1}`).join('.'), alignment: D.AlignmentType.START, start: 1, suffix: D.LevelSuffix.SPACE, style: { paragraph: { indent: { left: 0, hanging: 0 } } } })) });
    return 'fale-headings';
  };

  const paragraph = (b, maxW, extraOpts = {}) => {
    let runs = b.runs;
    // drop cap: the first letter becomes a framed paragraph (inserted before this one after packing)
    let dropMark = null;
    if (b.dropCap) {
      const k = runs.findIndex(r => r.text && r.text.trim());
      if (k >= 0) {
        const t = runs[k].text.replace(/^\s+/, '');
        const letter = Array.from(t)[0];
        runs = runs.slice(); runs[k] = { ...runs[k], text: t.slice(letter.length) };
        dropMark = `FALEDROPCAP${dropCaps.length}X`;
        dropCaps.push({ letter, run: runs[k], style: S[STYLE_OF_TAG[b.tag] || 'normal'] || S.normal });
      }
    }
    // bookmarks on headings / captions span the text, so a reference shows "Abbildung 2" or the heading
    const marks = runs.filter(r => r.bm != null).map(r => bookmarkName(r.bm));
    let children;
    const spanning = marks.length && (/^h[1-6]$/.test(b.tag) || b.tag === 'caption' || b.tag === 'title');
    if (spanning) {
      const rest = runs.filter(r => r.bm == null);
      const cut = b.tag === 'caption' ? rest.findIndex(r => r.seq) + 1 : rest.length;
      const head = inline(rest.slice(0, cut || rest.length), maxW - (b.indent || 0));
      const tail = cut ? inline(rest.slice(cut), maxW - (b.indent || 0)) : [];
      let inner = head;
      marks.forEach((m, k) => { inner = [new D.Bookmark({ id: m, children: k === 0 ? inner : [] })]; });
      children = [...inner, ...tail];
    } else if (marks.length) {
      // other paragraphs: a bookmark covers the text up to the next bookmark / the end of the paragraph
      children = [];
      let segRuns = [], mark = null;
      const flushSeg = () => { const kids = inline(segRuns, maxW - (b.indent || 0)); if (mark) children.push(new D.Bookmark({ id: mark, children: kids })); else children.push(...kids); segRuns = []; };
      for (const r of runs) { if (r.bm != null) { flushSeg(); mark = bookmarkName(r.bm); } else segRuns.push(r); }
      flushSeg();
    } else children = inline(runs, maxW - (b.indent || 0));
    if (dropMark) children.unshift(new D.TextRun({ text: dropMark, vanish: true }));
    const o = { children, ...extraOpts };
    if (HEAD[b.tag]) o.heading = HEAD[b.tag];
    else if (PSTYLE[b.tag]) o.style = PSTYLE[b.tag];
    if (b.cstyle && S[b.cstyle]) o.style = customId(b.cstyle);
    if (ALIGN[b.align]) o.alignment = ALIGN[b.align];
    else if (b.align == null) { const im = b.runs.length === 1 && b.runs[0].img; if (im && im.wrap === 'center') o.alignment = D.AlignmentType.CENTER; }
    if (b.bg) o.shading = { type: D.ShadingType.CLEAR, fill: hex(b.bg), color: 'auto' };
    const spacing = {};
    if (b.before != null) spacing.before = tw(b.before);
    if (b.after != null) spacing.after = tw(b.after);
    if (b.line) { spacing.line = Math.round(b.line * 240); spacing.lineRule = D.LineRuleType ? D.LineRuleType.AUTO : 'auto'; }
    if (b.list) {
      const root = b.list.root || b.list.id;
      if (!listStarts.has(root)) listStarts.set(root, b.list.level === 0 ? b.list.index : 1);
      const ref = numRef({ ...b.list, startIndex: listStarts.get(root) });
      const ik = `${ref}|${root}`;
      if (!listInstances.has(ik)) listInstances.set(ik, ++instanceNo);
      o.numbering = { reference: ref, level: Math.min(8, b.list.level), instance: listInstances.get(ik) };
      if (spacing.after == null) spacing.after = tw(3);
    } else {
      if (b.hnum && HEAD[b.tag] && b.tag !== 'title') o.numbering = { reference: headingNumRef(), level: Math.min(8, +b.tag[1] - 1), instance: 0 };
      const ind = {};
      if (b.indent) ind.left = tw(b.indent);
      if (b.indentR) ind.right = tw(b.indentR);
      if (b.firstLine > 0) ind.firstLine = tw(b.firstLine);
      if (b.firstLine < 0) ind.hanging = tw(-b.firstLine);
      if (Object.keys(ind).length) o.indent = ind;
    }
    if (Object.keys(spacing).length) o.spacing = spacing;
    if (b.keepNext) o.keepNext = true;
    if (b.pageBreakBefore) o.pageBreakBefore = true;
    if (b.tabDefs && b.tabDefs.length) o.tabStops = b.tabDefs.map(t => ({ type: TABTYPE[t.align] || D.TabStopType.LEFT, position: tw(t.pos), ...(LEADER[t.leader] ? { leader: LEADER[t.leader] } : {}) }));
    else if (b.tabs && b.tabs.length) o.tabStops = b.tabs.map(t => ({ type: D.TabStopType.LEFT, position: tw(t) }));
    if (!o.children.length) o.children = [new D.TextRun('')];
    return new D.Paragraph(o);
  };

  const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const LINE = { style: D.BorderStyle.SINGLE, size: 4, color: 'A6ABBD' };
  const TABLE_STYLES = {
    grid: { border: LINE },
    plain: { border: { style: D.BorderStyle.SINGLE, size: 4, color: '1A1A1A' } },
    header: { border: LINE, head: '3B37A0', headColor: 'FFFFFF' },
    striped: { border: { style: D.BorderStyle.SINGLE, size: 4, color: 'D5D8E6' }, head: 'E9E8FB', band: 'F5F6FA' },
    minimal: { inner: { style: D.BorderStyle.SINGLE, size: 4, color: 'C9CCDA' }, outer: NONE, head: null, bottomHead: { style: D.BorderStyle.SINGLE, size: 12, color: '1A1A1A' } },
  };
  const bstyle = s => (s === 'double' ? D.BorderStyle.DOUBLE : s === 'dashed' ? D.BorderStyle.DASHED : s === 'dotted' ? D.BorderStyle.DOTTED : D.BorderStyle.SINGLE);
  const table = (b, maxW) => {
    const tStyle = b.style && TABLE_STYLES[b.style] ? TABLE_STYLES[b.style] : null;
    const totalW = maxW * ((b.widthPct || 100) / 100);
    const colW = b.widths.map(p => Math.max(200, Math.round(tw(totalW) * p / 100)));
    const rows = b.rows.map((row, ri) => new D.TableRow({
      tableHeader: ri < (b.headerRows || 0) ? true : undefined,
      cantSplit: undefined,
      children: row.map(c => {
        const span = c.colspan || 1;
        const isHead = ri < (b.headerRows || 0) || (tStyle && tStyle.head && ri === 0);
        let blocks = c.blocks;
        if (tStyle && tStyle.headColor && isHead) blocks = blocks.map(x => (x.type === 'para' ? { ...x, runs: x.runs.map(r => ({ ...r, color: r.color || '#' + tStyle.headColor, b: true })) } : x));
        const kids = convert(blocks, totalW * (span / Math.max(1, b.cols)) - 10);
        const cell = { children: kids.length ? kids : [new D.Paragraph('')], margins: { top: 60, bottom: 60, left: 100, right: 100 } };
        if (span > 1) cell.columnSpan = span;
        if ((c.rowspan || 1) > 1) cell.rowSpan = c.rowspan;
        const fill = c.bg ? hex(c.bg) : tStyle && isHead && tStyle.head ? tStyle.head : tStyle && tStyle.band && ri % 2 === 0 && ri > 0 ? tStyle.band : null;
        if (fill) cell.shading = { type: D.ShadingType.CLEAR, fill, color: 'auto' };
        if (c.valign === 'middle' || c.valign === 'center') cell.verticalAlign = D.VerticalAlign.CENTER;
        else if (c.valign === 'bottom') cell.verticalAlign = D.VerticalAlign.BOTTOM;
        if (b.borderless) cell.borders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
        if (c.borders) {
          const bd = {};
          for (const [k, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
            const x = c.borders[k];
            if (!x) continue;
            bd[side] = x.none ? NONE : { style: bstyle(x.style), size: Math.max(2, Math.round((x.w || 0.75) * 8)), color: hex(x.color) || '1A1A1A' };
          }
          cell.borders = { ...(cell.borders || {}), ...bd };
        }
        if (tStyle && tStyle.bottomHead && isHead) cell.borders = { ...(cell.borders || {}), bottom: tStyle.bottomHead };
        return new D.TableCell(cell);
      }),
    }));
    const B = b.borderless ? NONE : tStyle && tStyle.border ? tStyle.border : LINE;
    const outer = tStyle && tStyle.outer ? tStyle.outer : B, inner = tStyle && tStyle.inner ? tStyle.inner : B;
    return new D.Table({
      rows, columnWidths: colW,
      width: { size: colW.reduce((a, c) => a + c, 0), type: D.WidthType.DXA },
      borders: { top: outer, bottom: outer, left: outer, right: outer, insideHorizontal: inner, insideVertical: tStyle && tStyle.inner ? NONE : inner },
      ...(b.align === 'center' ? { alignment: D.AlignmentType.CENTER } : b.align === 'right' ? { alignment: D.AlignmentType.RIGHT } : {}),
    });
  };
  const textbox = (b, maxW) => {
    const w = b.w ? Math.min(maxW, b.w) : maxW;
    const border = { style: D.BorderStyle.SINGLE, size: 6, color: hex(b.border) || '8086A6' };
    return new D.Table({
      rows: [new D.TableRow({ children: [new D.TableCell({ children: convert(b.blocks, w - 12).concat(b.blocks.length ? [] : [new D.Paragraph('')]), margins: { top: 100, bottom: 100, left: 140, right: 140 }, ...(b.bg ? { shading: { type: D.ShadingType.CLEAR, fill: hex(b.bg), color: 'auto' } } : {}) })] })],
      columnWidths: [tw(w)], width: { size: tw(w), type: D.WidthType.DXA },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: NONE, insideVertical: NONE },
      ...(b.float === 'right' ? { alignment: D.AlignmentType.RIGHT } : b.float === 'center' ? { alignment: D.AlignmentType.CENTER } : {}),
    });
  };

  const convert = (blocks, maxW) => {
    const out = [];
    for (const b of blocks) {
      if (b.type === 'para') out.push(paragraph(b, maxW));
      else if (b.type === 'table' && b.rows.length) { out.push(table(b, maxW)); out.push(new D.Paragraph({ spacing: { after: 0 }, children: [] })); }
      else if (b.type === 'textbox') { out.push(textbox(b, maxW)); out.push(new D.Paragraph({ spacing: { after: 0 }, children: [] })); }
      else if (b.type === 'pagebreak') out.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      else if (b.type === 'toc') { out.push(new D.Paragraph({ children: [new D.TextRun(`FALETOCMARK${tocs.length}X`)] })); tocs.push(b); }
      else if (b.type === 'hr') out.push(new D.Paragraph({ border: { bottom: { color: 'A6ABBD', space: 1, style: D.BorderStyle.SINGLE, size: 6 } }, children: [] }));
      else if (b.type === 'section') out.push(...convert(b.blocks, (maxW - (b.cols - 1) * (b.gap || 18)) / b.cols));
    }
    return out;
  };

  // split top-level content into sections: multi-column parts (continuous) and section breaks (next page,
  // optionally with another orientation)
  const groups = [];
  let cur = { cols: 1, blocks: [], orient: null, nextPage: false };
  for (const b of model.blocks) {
    if (b.type === 'section' && b.cols > 1) {
      if (cur.blocks.length) groups.push(cur);
      groups.push({ cols: b.cols, gap: b.gap || 18, blocks: b.blocks, orient: cur.orient, nextPage: !cur.blocks.length && cur.nextPage });
      cur = { cols: 1, blocks: [], orient: cur.orient, nextPage: false };
    } else if (b.type === 'pagebreak' && b.section) {
      if (cur.blocks.length || !groups.length) groups.push(cur);
      cur = { cols: 1, blocks: [], orient: b.orient || cur.orient, nextPage: true };
    } else cur.blocks.push(b);
  }
  if (cur.blocks.length || !groups.length || cur.nextPage) groups.push(cur);
  const groupChildren = groups.map(g => {
    const gp = pgOf(g.orient);
    const cw = gp.w - gp.ml - gp.mr;
    const kids = convert(g.blocks, g.cols > 1 ? (cw - (g.cols - 1) * g.gap) / g.cols : cw);
    return kids.length ? kids : [new D.Paragraph('')];
  });
  if (openCmt != null) { const tail = []; closeCmt(tail); groupChildren[groupChildren.length - 1].push(new D.Paragraph({ children: tail })); }

  const commentList = [...cmtIds.entries()].map(([id, n]) => {
    const c = model.comments[id] || {};
    const d = c.date ? new Date(c.date) : new Date();
    return { id: n, author: c.author || author || 'FaLe', initials: (c.author || author || 'F').split(/\s+/).map(x => x[0]).join('').slice(0, 3).toUpperCase(), date: isNaN(d) ? new Date() : d, children: [new D.Paragraph({ children: [new D.TextRun(c.text || '')] })] };
  });
  // header / footer / page numbers
  const HF_RUN = { size: 18, color: '5A607F' };
  const pnRun = fmt => new D.TextRun({ children: fmt === 'n-of-m' ? ['Seite ', D.PageNumber.CURRENT, ' von ', D.PageNumber.TOTAL_PAGES] : [D.PageNumber.CURRENT], ...HF_RUN });
  const AL = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT };
  const hfParas = (text, align, where) => {
    const pn = (hf && hf.pageNumbers) || 'none';
    const paras = [];
    const kids = text ? [new D.TextRun({ text, ...HF_RUN })] : [];
    if (pn.startsWith(where)) {
      const a = pn.split('-')[1];
      if (text && a === align) paras.push(new D.Paragraph({ alignment: AL[a], children: [...kids, new D.TextRun({ text: ' · ', ...HF_RUN }), pnRun(hf.pageFormat)] }));
      else { if (text) paras.push(new D.Paragraph({ alignment: AL[align] || AL.left, children: kids })); paras.push(new D.Paragraph({ alignment: AL[a], children: [pnRun(hf.pageFormat)] })); }
    } else if (text) paras.push(new D.Paragraph({ alignment: AL[align] || AL.left, children: kids }));
    return paras;
  };
  // advanced: one paragraph with centre/right tab stops (left · centre · right) and real fields
  const zoneRuns = text => fieldParts(text || '').map(p => {
    if (p.text != null) return new D.TextRun({ text: p.text, ...HF_RUN });
    if (p.field === 'PAGE') return new D.TextRun({ children: [D.PageNumber.CURRENT], ...HF_RUN });
    if (p.field === 'NUMPAGES') return new D.TextRun({ children: [D.PageNumber.TOTAL_PAGES], ...HF_RUN });
    if (p.field === 'DATE') return new D.SimpleField(' DATE \\@ "dd.MM.yyyy" ', new Date().toLocaleDateString('de-DE'));
    return new D.SimpleField(' TITLE ', title);
  });
  const zonePara = zones => {
    const z = [0, 1, 2].map(k => (zones && zones[k]) || '');
    const filled = z.map((t, k) => [t, k]).filter(([t]) => t);
    if (!filled.length) return [new D.Paragraph('')];
    if (filled.length === 1) return [new D.Paragraph({ alignment: [AL.left, AL.center, AL.right][filled[0][1]], children: zoneRuns(filled[0][0]) })];
    const tab = () => new D.TextRun({ children: [new D.Tab()], ...HF_RUN });
    return [new D.Paragraph({ tabStops: [{ type: D.TabStopType.CENTER, position: tw(contentW / 2) }, { type: D.TabStopType.RIGHT, position: tw(contentW) }], children: [...zoneRuns(z[0]), tab(), ...zoneRuns(z[1]), tab(), ...zoneRuns(z[2])] })];
  };
  const sectionExtra = {};
  let evenAndOdd = false;
  const wm = hf && hf.watermark && hf.watermark.text ? hf.watermark : null;
  if (hf && isAdvanced(hf)) {
    const H = {}, F = {};
    H.default = new D.Header({ children: zonePara(hf.zones.h) });
    F.default = new D.Footer({ children: zonePara(hf.zones.f) });
    if (hf.first) { H.first = new D.Header({ children: zonePara(hf.first.h) }); F.first = new D.Footer({ children: zonePara(hf.first.f) }); sectionExtra.properties = { titlePage: true }; }
    if (hf.even) { H.even = new D.Header({ children: zonePara(hf.even.h) }); F.even = new D.Footer({ children: zonePara(hf.even.f) }); evenAndOdd = true; }
    sectionExtra.headers = H; sectionExtra.footers = F;
    const NF = { i: D.NumberFormat.LOWER_ROMAN, I: D.NumberFormat.UPPER_ROMAN, a: D.NumberFormat.LOWER_LETTER, A: D.NumberFormat.UPPER_LETTER };
    if ((hf.pnStart != null && +hf.pnStart !== 1) || NF[hf.pnStyle]) sectionExtra.pageNumbers = { ...(hf.pnStart != null && +hf.pnStart !== 1 ? { start: +hf.pnStart } : {}), ...(NF[hf.pnStyle] ? { formatType: NF[hf.pnStyle] } : {}) };
  } else if (hf) {
    const hp = hfParas(hf.header || '', hf.headerAlign || 'left', 'header');
    const fp = hfParas(hf.footer || '', hf.footerAlign || 'left', 'footer');
    if (hp.length || wm) sectionExtra.headers = { default: new D.Header({ children: hp.length ? hp : [new D.Paragraph('')] }) };
    if (fp.length) sectionExtra.footers = { default: new D.Footer({ children: fp }) };
    if (hf.firstPage === false && (hp.length || fp.length)) {
      sectionExtra.properties = { titlePage: true };
      if (hp.length || wm) sectionExtra.headers.first = new D.Header({ children: [new D.Paragraph('')] });
      if (fp.length) sectionExtra.footers.first = new D.Footer({ children: [new D.Paragraph('')] });
    }
  }

  // styles (Formatvorlagen)
  const runOf = (st, isNormal = false) => {
    const r = {};
    const font = st.font || (isNormal ? 'Arial' : null);
    if (font) r.font = font;
    if (st.size) r.size = Math.round(st.size * 2);
    if (st.color) r.color = hex(st.color);
    if (st.b != null && !isNormal) r.bold = !!st.b;
    if (st.i != null && !isNormal) r.italics = !!st.i;
    if (st.u) r.underline = {};
    return r;
  };
  const parOf = (st, extra = {}) => {
    // w:line without w:lineRule: Word reads "auto" (multiple), LibreOffice an exact height (clips pictures)
    const p = { spacing: { before: tw(st.before ?? 0), after: tw(st.after ?? 0), ...(st.line ? { line: Math.round(st.line * 240), lineRule: D.LineRuleType ? D.LineRuleType.AUTO : 'auto' } : {}) }, ...extra };
    if (st.align && ALIGN[st.align]) p.alignment = ALIGN[st.align];
    if (st.keepNext) p.keepNext = true;
    if (st.indent) p.indent = { left: tw(st.indent) };
    return p;
  };
  const headingStyle = id => ({ run: runOf(S[id]), paragraph: parOf(S[id], { keepNext: true, keepLines: true }) });
  const paragraphStyles = [
    { id: 'Normal', name: 'Normal', quickFormat: true, run: runOf(S.normal, true), paragraph: parOf(S.normal) },
    { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: runOf(S.subtitle), paragraph: parOf(S.subtitle) },
    { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: runOf(S.quote), paragraph: { ...parOf(S.quote), border: { left: { color: 'C9CCDA', space: 8, style: D.BorderStyle.SINGLE, size: 18 } } } },
    { id: 'Code', name: 'Code', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { ...runOf(S.code), font: S.code.font || 'Courier New' }, paragraph: { ...parOf(S.code), ...(S.code.bg ? { shading: { type: D.ShadingType.CLEAR, fill: hex(S.code.bg), color: 'auto' } } : {}) } },
    { id: 'NoSpacing', name: 'No Spacing', basedOn: 'Normal', quickFormat: true, run: runOf(S.nospace), paragraph: parOf(S.nospace) },
    { id: 'Caption', name: 'caption', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: runOf(S.caption), paragraph: parOf(S.caption) },
    ...customStyleIds(S).map(id => ({ id: customId(id), name: S[id].name || `Formatvorlage ${id.slice(1)}`, basedOn: 'Normal', next: customId(id), quickFormat: true, run: runOf(S[id]), paragraph: parOf(S[id]) })),
  ];
  const landscape = pg.w > pg.h;
  const pagePropsOf = (gp, first) => ({ size: { width: tw(Math.min(gp.w, gp.h)), height: tw(Math.max(gp.w, gp.h)), orientation: gp.w > gp.h ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: tw(gp.mt), right: tw(gp.mr), bottom: tw(gp.mb), left: tw(gp.ml), header: tw(Math.min(36, gp.mt / 2)), footer: tw(Math.min(36, gp.mb / 2)) }, ...(first && sectionExtra.pageNumbers ? { pageNumbers: sectionExtra.pageNumbers } : {}) });
  void landscape;
  const sections = groups.map((g, i) => ({
    properties: {
      ...(i === 0 ? sectionExtra.properties || {} : {}),
      ...(i > 0 ? { type: g.nextPage ? D.SectionType.NEXT_PAGE : D.SectionType.CONTINUOUS } : {}),
      page: pagePropsOf(pgOf(g.orient), i === 0),
      ...(g.cols > 1 ? { column: { count: g.cols, space: tw(g.gap || 18), equalWidth: true } } : {}),
    },
    ...(i === 0 && sectionExtra.headers ? { headers: sectionExtra.headers } : {}),
    ...(i === 0 && sectionExtra.footers ? { footers: sectionExtra.footers } : {}),
    children: groupChildren[i],
  }));
  // children of the first sections are generated before the numbering config is complete → build the doc now
  const doc = new D.Document({
    creator: 'FaLe PDF',
    title,
    description: 'Erstellt mit FaLe PDF',
    ...(commentList.length ? { comments: { children: commentList } } : {}),
    ...(fnCount ? { footnotes: footnoteMap } : {}),
    ...(enCount ? { endnotes: endnoteMap } : {}),
    ...(evenAndOdd ? { evenAndOddHeaderAndFooters: true } : {}),
    features: { ...(tocs.length ? { updateFields: true } : {}), ...(trackChanges ? { trackRevisions: true } : {}) },
    styles: {
      default: {
        document: { run: runOf(S.normal, true), paragraph: parOf(S.normal) },
        title: { run: runOf(S.title), paragraph: parOf(S.title) },
        heading1: headingStyle('h1'), heading2: headingStyle('h2'), heading3: headingStyle('h3'),
        heading4: headingStyle('h4'), heading5: headingStyle('h5'), heading6: headingStyle('h6'),
        hyperlink: { run: { color: '0563C1', underline: {} } },
      },
      paragraphStyles,
    },
    numbering: { config: numConfigs.size ? [...numConfigs.values()] : [{ reference: 'fale-ul-std', levels: lvl(D.LevelFormat.BULLET, l => ['•', '◦', '▪'][l % 3]) }] },
    sections,
  });
  const blob = await D.Packer.toBlob(doc);
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const st = zip.file('word/styles.xml');
  if (st) {
    let xml = await st.async('string');
    // mark "Normal" as the default paragraph style (some readers need an explicit default)
    if (!/w:default="1"[^>]*w:type="paragraph"|w:type="paragraph"[^>]*w:default="1"/.test(xml)) {
      xml = xml.replace(/<w:style w:type="paragraph" w:styleId="Normal"/, '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"');
    }
    // user-defined styles are marked as such (Word lists them under "custom", our reader restores them)
    xml = xml.replace(/<w:style w:type="paragraph" w:styleId="(FaleStyle\d+)"/g, '<w:style w:type="paragraph" w:customStyle="1" w:styleId="$1"');
    zip.file('word/styles.xml', xml);
  }
  const dx = zip.file('word/document.xml');
  let docXml = await dx.async('string');
  // tables of contents / figures as real TOC fields with cached entries (Word/LibreOffice can update them)
  if (tocs.length) {
    let pages = new Map();
    try { const { modelToPdf } = await import('./docpdf.js'); pages = await modelToPdf(model, { page: pg, hf, measureOnly: true }); } catch (e) { console.warn('TOC-Seiten', e); }
    const right = tw(contentW);
    tocs.forEach((b, k) => {
      const entries = tocEntries(model, b);
      const caps = b.kind === 'captions';
      const instr = caps ? ` TOC \\h \\z \\c "${String(b.label || 'Abbildung').replace(/"/g, '')}" ` : ` TOC \\o "1-${b.depth || 3}" \\h \\z \\u `;
      const ppr = lv => `<w:pPr><w:pStyle w:val="${caps ? 'TableofFigures' : `TOC${lv}`}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${right}"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="${caps ? 0 : (lv - 1) * 280}"/></w:pPr>`;
      const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve">${instr.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
      const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      let out = `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/><w:spacing w:before="120" w:after="160"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t xml:space="preserve">${esc2(b.title || 'Inhaltsverzeichnis')}</w:t></w:r></w:p>`;
      if (!entries.length) out += `<w:p>${ppr(1)}${begin}<w:r><w:t>${caps ? 'Keine Beschriftungen gefunden.' : 'Keine Überschriften gefunden.'}</w:t></w:r>${end}</w:p>`;
      entries.forEach((en, i) => {
        out += `<w:p>${ppr(en.level)}${i === 0 ? begin : ''}<w:r>${en.level === 1 && !caps ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc2(en.text)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${pages.get ? (pages.get(en.index) || '') : ''}</w:t></w:r>${i === entries.length - 1 ? end : ''}</w:p>`;
      });
      docXml = docXml.replace(new RegExp(`<w:p>(?:(?!<w:p>|<w:p ).)*?FALETOCMARK${k}X.*?</w:p>`, 's'), out);
    });
  }
  // drop caps: a framed paragraph with the first letter in front of the paragraph
  dropCaps.forEach((dc, k) => {
    const size = (dc.run.size || dc.style.size || S.normal.size || base);
    const lineMul = dc.style.line || S.normal.line || 1.15;
    const lineTw = Math.round(size * lineMul * 1.17 * 3 * 20);
    const sz = Math.round(size * lineMul * 3 * 0.92 * 2);
    const font = dc.run.font || dc.style.font || S.normal.font || 'Arial';
    const color = dc.run.color ? hex(dc.run.color) : null;
    const dropP = `<w:p><w:pPr><w:keepNext/><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/><w:spacing w:before="0" w:after="0" w:line="${lineTw}" w:lineRule="exact"/><w:textAlignment w:val="baseline"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${esc2(font)}" w:hAnsi="${esc2(font)}"/><w:position w:val="-6"/><w:sz w:val="${sz}"/>${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr><w:t>${esc2(dc.letter)}</w:t></w:r></w:p>`;
    const re = new RegExp(`(<w:p>|<w:p [^>]*>)((?:(?!<w:p>|<w:p ).)*?)<w:r>(?:(?!</w:r>).)*?FALEDROPCAP${k}X(?:(?!</w:r>).)*?</w:r>`, 's');
    docXml = docXml.replace(re, (m, open, mid) => `${dropP}${open}${mid}`);
  });
  tfs.forEach((t, k) => {
    const re = new RegExp(`<w:r>(?:(?!</w:r>).)*?FALETFA${k}X(?:(?!</w:r>).)*?</w:r>(.*?)<w:r>(?:(?!</w:r>).)*?FALETFB${k}X(?:(?!</w:r>).)*?</w:r>`, 's');
    docXml = docXml.replace(re, (m, inner) => `<w:sdt><w:sdtPr><w:alias w:val="Formel"/><w:tag w:val="${esc2(`fale-tf:${t.fmt || ''}|${t.f}`)}"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`);
  });
  zip.file('word/document.xml', docXml);
  // watermark: VML text shape behind the text in every header of the first section
  if (wm) {
    const names = Object.keys(zip.files).filter(n => /^word\/header\d*\.xml$/.test(n));
    for (const n of names) {
      let xml = await zip.file(n).async('string');
      if (!/xmlns:v=/.test(xml)) xml = xml.replace(/<w:hdr\b/, '<w:hdr xmlns:v="urn:schemas-microsoft-com:vml"');
      if (!/xmlns:o=/.test(xml)) xml = xml.replace(/<w:hdr\b/, '<w:hdr xmlns:o="urn:schemas-microsoft-com:office:office"');
      xml = xml.replace(/(<w:p\b[^>]*>(?:<w:pPr>.*?<\/w:pPr>)?)/s, `$1${watermarkRun(wm, pg)}`);
      zip.file(n, xml);
    }
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

/** Word's diagonal text watermark (VML text path, behind the text, centred on the page margin box). */
function watermarkRun(wm, pg) {
  const text = esc2(wm.text);
  const w = Math.round(Math.min(pg.w, pg.h) * 0.85 * 10) / 10;
  const h = Math.round(w / Math.max(4, wm.text.length * 0.62) * 10) / 10;
  const color = /^#[0-9a-f]{6}$/i.test(wm.color || '') ? wm.color : '#B4B8CC';
  const op = Math.max(0.05, Math.min(1, +wm.opacity || 0.45));
  return '<w:r><w:rPr><w:noProof/></w:rPr><w:pict>'
    + '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>'
    + `<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${w}pt;height:${h}pt;rotation:315;z-index:-251657216;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="${color}" stroked="f"><v:fill opacity="${op}"/><v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt" string="${text}"/><w10:wrap anchorx="margin" anchory="margin" xmlns:w10="urn:schemas-microsoft-com:office:word"/></v:shape>`
    + '</w:pict></w:r>';
}

export { STYLE_OF_TAG, fontKind, FONT_OF_KIND };
