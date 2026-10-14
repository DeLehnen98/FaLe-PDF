// Document model → .docx (docx library, loaded lazily). Formatvorlagen, Absatzformate, Listen (auch mehrstufig),
// Tabellen (Kopfzeilen, Rahmen, Schattierung), Bilder (auch umflossen), Spalten-Abschnitte, Änderungen (w:ins/w:del),
// Seriendruckfelder, Kommentare, Fußnoten, Inhaltsverzeichnis, Kopf-/Fußzeilen.
import { loadDocx, imageToBytes, loadJSZip } from './vendor.js';
import { modelHeadings, bulletChar } from './docmodel.js';
import { normalizeStyles, STYLE_OF_TAG } from './docstyles.js';
import { fontKind } from './fonts.js';

const hex = c => (c ? c.replace('#', '').toUpperCase() : undefined);
const tw = pt => Math.round(pt * 20);
const FONT_OF_KIND = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };

export async function modelToDocx(model, { title = 'Dokument', page = null, hf = null, author = '', trackChanges = false } = {}) {
  const D = await loadDocx();
  const S = normalizeStyles(model.styles);
  const base = model.baseSize || S.normal.size || 11;
  if (!model.styles && base !== 11) S.normal.size = base;
  const pg = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
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

  // comments (numeric ids) + footnotes + tables of contents
  const cmtIds = new Map();
  const cmtNum = id => { if (!cmtIds.has(id)) cmtIds.set(id, cmtIds.size); return cmtIds.get(id); };
  let openCmt = null;
  const footnoteMap = {};
  let fnCount = 0;
  const tocs = [];
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
      if (r.br) { out.push(new D.TextRun({ break: 1 })); i++; continue; }
      if (r.field != null) { out.push(new D.SimpleMailMergeField(r.field)); i++; continue; }
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
        else out.push(...kids);
        continue;
      }
      if (r.text != null) out.push(...textRuns(r));
      i++;
    }
    return out;
  };

  const ALIGN = { center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED };
  const HEAD = { h1: D.HeadingLevel.HEADING_1, h2: D.HeadingLevel.HEADING_2, h3: D.HeadingLevel.HEADING_3, h4: D.HeadingLevel.HEADING_4, h5: D.HeadingLevel.HEADING_5, h6: D.HeadingLevel.HEADING_6, title: D.HeadingLevel.TITLE };
  const PSTYLE = { subtitle: 'Subtitle', quote: 'Quote', code: 'Code', nospace: 'NoSpacing' };

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

  const paragraph = (b, maxW, extraOpts = {}) => {
    const o = { children: inline(b.runs, maxW - (b.indent || 0)), ...extraOpts };
    if (HEAD[b.tag]) o.heading = HEAD[b.tag];
    else if (PSTYLE[b.tag]) o.style = PSTYLE[b.tag];
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
    if (b.tabs && b.tabs.length) o.tabStops = b.tabs.map(t => ({ type: D.TabStopType.LEFT, position: tw(t) }));
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
        const kids = convert(blocks, totalW * (span / Math.max(1, b.cols)) - 10).filter(x => !(x instanceof D.Table && false));
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

  // split top-level content into sections (multi-column sections become their own docx sections)
  const groups = [];
  let cur = { cols: 1, blocks: [] };
  for (const b of model.blocks) {
    if (b.type === 'section' && b.cols > 1) {
      if (cur.blocks.length) groups.push(cur);
      groups.push({ cols: b.cols, gap: b.gap || 18, blocks: b.blocks });
      cur = { cols: 1, blocks: [] };
    } else cur.blocks.push(b);
  }
  if (cur.blocks.length || !groups.length) groups.push(cur);
  const groupChildren = groups.map(g => {
    const kids = convert(g.blocks, g.cols > 1 ? (contentW - (g.cols - 1) * g.gap) / g.cols : contentW);
    return kids.length ? kids : [new D.Paragraph('')];
  });
  if (openCmt != null) { const tail = []; closeCmt(tail); groupChildren[groupChildren.length - 1].push(new D.Paragraph({ children: tail })); }

  const commentList = [...cmtIds.entries()].map(([id, n]) => {
    const c = model.comments[id] || {};
    const d = c.date ? new Date(c.date) : new Date();
    return { id: n, author: c.author || author || 'FaLe', initials: (c.author || author || 'F').split(/\s+/).map(x => x[0]).join('').slice(0, 3).toUpperCase(), date: isNaN(d) ? new Date() : d, children: [new D.Paragraph({ children: [new D.TextRun(c.text || '')] })] };
  });
  // header / footer / page numbers
  const pnRun = fmt => new D.TextRun({ children: fmt === 'n-of-m' ? ['Seite ', D.PageNumber.CURRENT, ' von ', D.PageNumber.TOTAL_PAGES] : [D.PageNumber.CURRENT], size: 18, color: '5A607F' });
  const AL = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT };
  const hfParas = (text, align, where) => {
    const pn = (hf && hf.pageNumbers) || 'none';
    const paras = [];
    const kids = text ? [new D.TextRun({ text, size: 18, color: '5A607F' })] : [];
    if (pn.startsWith(where)) {
      const a = pn.split('-')[1];
      if (text && a === align) paras.push(new D.Paragraph({ alignment: AL[a], children: [...kids, new D.TextRun({ text: ' · ', size: 18, color: '5A607F' }), pnRun(hf.pageFormat)] }));
      else { if (text) paras.push(new D.Paragraph({ alignment: AL[align] || AL.left, children: kids })); paras.push(new D.Paragraph({ alignment: AL[a], children: [pnRun(hf.pageFormat)] })); }
    } else if (text) paras.push(new D.Paragraph({ alignment: AL[align] || AL.left, children: kids }));
    return paras;
  };
  const sectionExtra = {};
  if (hf) {
    const hp = hfParas(hf.header || '', hf.headerAlign || 'left', 'header');
    const fp = hfParas(hf.footer || '', hf.footerAlign || 'left', 'footer');
    if (hp.length) sectionExtra.headers = { default: new D.Header({ children: hp }) };
    if (fp.length) sectionExtra.footers = { default: new D.Footer({ children: fp }) };
    if (hf.firstPage === false && (hp.length || fp.length)) {
      sectionExtra.properties = { titlePage: true };
      if (hp.length) sectionExtra.headers.first = new D.Header({ children: [new D.Paragraph('')] });
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
    const p = { spacing: { before: tw(st.before ?? 0), after: tw(st.after ?? 0), ...(st.line ? { line: Math.round(st.line * 240) } : {}) }, ...extra };
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
  ];
  const landscape = pg.w > pg.h;
  const pageProps = { size: { width: tw(Math.min(pg.w, pg.h)), height: tw(Math.max(pg.w, pg.h)), orientation: landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: tw(pg.mt), right: tw(pg.mr), bottom: tw(pg.mb), left: tw(pg.ml), header: tw(Math.min(36, pg.mt / 2)), footer: tw(Math.min(36, pg.mb / 2)) } };
  const sections = groups.map((g, i) => ({
    properties: {
      ...(i === 0 ? sectionExtra.properties || {} : {}),
      ...(i > 0 ? { type: D.SectionType.CONTINUOUS } : {}),
      page: pageProps,
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
    // German display names for the gallery in Word ("Überschrift 1" …) via aliases
    zip.file('word/styles.xml', xml);
  }
  // tables of contents as a real TOC field with cached entries (Word/LibreOffice can update it)
  if (tocs.length) {
    const dx = zip.file('word/document.xml');
    let xml = await dx.async('string');
    let pages = new Map();
    try { const { modelToPdf } = await import('./docpdf.js'); pages = await modelToPdf(model, { page: pg, measureOnly: true }); } catch (e) { console.warn('TOC-Seiten', e); }
    const right = tw(contentW);
    const esc2 = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    tocs.forEach((b, k) => {
      const entries = modelHeadings(model, b.depth || 3);
      const instr = ` TOC \\o "1-${b.depth || 3}" \\h \\z \\u `;
      const ppr = lv => `<w:pPr><w:pStyle w:val="TOC${lv}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${right}"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="${(lv - 1) * 280}"/></w:pPr>`;
      const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
      const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      let out = `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/><w:spacing w:before="120" w:after="160"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t xml:space="preserve">${esc2(b.title || 'Inhaltsverzeichnis')}</w:t></w:r></w:p>`;
      if (!entries.length) out += `<w:p>${ppr(1)}${begin}<w:r><w:t>Keine Überschriften gefunden.</w:t></w:r>${end}</w:p>`;
      entries.forEach((en, i) => {
        out += `<w:p>${ppr(en.level)}${i === 0 ? begin : ''}<w:r>${en.level === 1 ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc2(en.text)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${pages.get ? (pages.get(en.index) || '') : ''}</w:t></w:r>${i === entries.length - 1 ? end : ''}</w:p>`;
      });
      xml = xml.replace(new RegExp(`<w:p>(?:(?!<w:p>|<w:p ).)*?FALETOCMARK${k}X.*?</w:p>`, 's'), out);
    });
    zip.file('word/document.xml', xml);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

export { STYLE_OF_TAG, fontKind, FONT_OF_KIND };
