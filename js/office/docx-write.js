// Document model → .docx (docx library, loaded lazily).
import { loadDocx, imageToBytes, loadJSZip } from './vendor.js';
import { HEADING_PT, PARA_SPACE, modelHeadings } from './docmodel.js';

const hex = c => (c ? c.replace('#', '').toUpperCase() : undefined);
const tw = pt => Math.round(pt * 20);

export async function modelToDocx(model, { title = 'Dokument', page = null, hf = null, author = '' } = {}) {
  const D = await loadDocx();
  const base = model.baseSize || 11;
  const pg = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  const contentW = pg.w - pg.ml - pg.mr;

  // pre-encode images
  const images = new Map();
  const collect = blocks => blocks.forEach(b => {
    if (b.type === 'para') b.runs.forEach(r => { if (r.img && !images.has(r.img.src)) images.set(r.img.src, null); });
    if (b.type === 'table') b.rows.forEach(row => row.forEach(c => collect(c.blocks)));
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
  const closeCmt = out => {
    if (openCmt == null) return;
    const n = cmtNum(openCmt);
    out.push(new D.CommentRangeEnd(n), new D.TextRun({ children: [new D.CommentReference(n)] }));
    openCmt = null;
  };
  let olInstance = 0;
  const listInstances = new Map();
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
    if (r.mono) o.font = 'Courier New';
    else if (r.serif) o.font = 'Times New Roman';
    return o;
  };

  const textRuns = (r, extra) => {
    const parts = String(r.text).split('\t');
    const out = [];
    parts.forEach((p, i) => {
      if (i > 0) out.push(new D.TextRun({ ...runOpts(r, extra), children: [new D.Tab()] }));
      if (p) out.push(new D.TextRun({ ...runOpts(r, extra), text: p }));
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
      if (r.img) {
        const im = images.get(r.img.src);
        if (im) {
          let w = r.img.w || im.width, h = r.img.h || im.height;
          if (!r.img.h && r.img.w) h = Math.round(im.height * (r.img.w / im.width));
          const maxPx = maxW / 0.75;
          if (w > maxPx) { h = Math.round(h * (maxPx / w)); w = Math.round(maxPx); }
          out.push(new D.ImageRun({ type: im.type, data: im.bytes, transformation: { width: Math.max(1, w), height: Math.max(1, h) }, altText: r.img.alt ? { name: r.img.alt, description: r.img.alt, title: r.img.alt } : undefined }));
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
  const HEAD = { h1: D.HeadingLevel.HEADING_1, h2: D.HeadingLevel.HEADING_2, h3: D.HeadingLevel.HEADING_3, h4: D.HeadingLevel.HEADING_4, h5: D.HeadingLevel.HEADING_5, h6: D.HeadingLevel.HEADING_6 };
  const OLREF = { 1: 'fale-ol-1', a: 'fale-ol-a', A: 'fale-ol-A', i: 'fale-ol-i', I: 'fale-ol-I' };

  const paragraph = (b, maxW) => {
    const o = { children: inline(b.runs, maxW - (b.indent || 0)) };
    if (HEAD[b.tag]) o.heading = HEAD[b.tag];
    if (b.tag === 'subtitle') o.style = 'Subtitle';
    if (ALIGN[b.align]) o.alignment = ALIGN[b.align];
    if (b.bg) o.shading = { type: D.ShadingType.CLEAR, fill: hex(b.bg), color: 'auto' };
    if (b.list) {
      if (b.list.ordered) {
        if (!listInstances.has(b.list.id)) listInstances.set(b.list.id, ++olInstance);
        o.numbering = { reference: OLREF[b.list.type] || OLREF[1], level: Math.min(8, b.list.level), instance: listInstances.get(b.list.id) };
      } else o.numbering = { reference: 'fale-ul', level: Math.min(8, b.list.level) };
      o.spacing = { after: tw(PARA_SPACE.li[1]) };
    } else if (b.indent) o.indent = { left: tw(b.indent) };
    if (!o.children.length) o.children = [new D.TextRun('')];
    return new D.Paragraph(o);
  };

  const NONE = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const LINE = { style: D.BorderStyle.SINGLE, size: 4, color: 'A6ABBD' };
  const table = (b, maxW) => {
    const colW = b.widths.map(p => Math.max(200, Math.round(tw(maxW) * p / 100)));
    const rows = b.rows.map(row => new D.TableRow({
      children: row.map(c => {
        const span = c.colspan || 1;
        const kids = convert(c.blocks, maxW * (span / Math.max(1, b.cols)) - 10);
        const cell = { children: kids.length ? kids : [new D.Paragraph('')], margins: { top: 60, bottom: 60, left: 100, right: 100 } };
        if (span > 1) cell.columnSpan = span;
        if ((c.rowspan || 1) > 1) cell.rowSpan = c.rowspan;
        if (c.bg) cell.shading = { type: D.ShadingType.CLEAR, fill: hex(c.bg), color: 'auto' };
        if (b.borderless) cell.borders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
        return new D.TableCell(cell);
      }),
    }));
    const B = b.borderless ? NONE : LINE;
    return new D.Table({
      rows, columnWidths: colW,
      width: { size: colW.reduce((a, c) => a + c, 0), type: D.WidthType.DXA },
      borders: { top: B, bottom: B, left: B, right: B, insideHorizontal: B, insideVertical: B },
    });
  };

  const convert = (blocks, maxW) => {
    const out = [];
    for (const b of blocks) {
      if (b.type === 'para') out.push(paragraph(b, maxW));
      else if (b.type === 'table' && b.rows.length) { out.push(table(b, maxW)); out.push(new D.Paragraph({ spacing: { after: 0 }, children: [] })); }
      else if (b.type === 'pagebreak') out.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      else if (b.type === 'toc') { out.push(new D.Paragraph({ children: [new D.TextRun(`FALETOCMARK${tocs.length}X`)] })); tocs.push(b); }
      else if (b.type === 'hr') out.push(new D.Paragraph({ border: { bottom: { color: 'A6ABBD', space: 1, style: D.BorderStyle.SINGLE, size: 6 } }, children: [] }));
    }
    // a table must not be the last element of a cell/body
    return out;
  };

  const children = convert(model.blocks, contentW);
  if (openCmt != null) { const tail = []; closeCmt(tail); children.push(new D.Paragraph({ children: tail })); }
  if (!children.length) children.push(new D.Paragraph(''));
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

  const lvl = (fmt, textFn) => Array.from({ length: 9 }, (_, l) => ({
    level: l, format: fmt, text: textFn(l), alignment: D.AlignmentType.START,
    style: { paragraph: { indent: { left: 360 + l * 360, hanging: 300 } } },
  }));
  const bullets = ['•', '◦', '▪'];
  const headingStyle = (tag, color) => ({
    run: { size: Math.round(HEADING_PT[tag] * 2), bold: true, color, font: 'Arial' },
    paragraph: { spacing: { before: tw(PARA_SPACE[tag][0]), after: tw(PARA_SPACE[tag][1]) }, keepNext: true },
  });
  const landscape = pg.w > pg.h;
  const doc = new D.Document({
    creator: 'FaLe PDF',
    title,
    description: 'Erstellt mit FaLe PDF',
    ...(commentList.length ? { comments: { children: commentList } } : {}),
    ...(fnCount ? { footnotes: footnoteMap } : {}),
    ...(tocs.length ? { features: { updateFields: true } } : {}),
    styles: {
      default: {
        document: { run: { font: 'Arial', size: Math.round(base * 2) }, paragraph: { spacing: { after: tw(PARA_SPACE.p[1]), line: 276 } } },
        heading1: headingStyle('h1', '1B1E33'), heading2: headingStyle('h2', '1B1E33'), heading3: headingStyle('h3', '2B2F4A'),
        heading4: headingStyle('h4', '2B2F4A'), heading5: headingStyle('h5', '2B2F4A'), heading6: headingStyle('h6', '2B2F4A'),
        hyperlink: { run: { color: '0563C1', underline: {} } },
      },
      paragraphStyles: [{ id: 'Normal', name: 'Normal', quickFormat: true, run: { font: 'Arial', size: Math.round(base * 2) }, paragraph: { spacing: { after: tw(PARA_SPACE.p[1]), line: 276 } } },
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(HEADING_PT.subtitle * 2), color: '5A607F' }, paragraph: { spacing: { after: tw(PARA_SPACE.subtitle[1]) } } }],
    },
    numbering: {
      config: [
        { reference: 'fale-ul', levels: lvl(D.LevelFormat.BULLET, l => bullets[l % 3]) },
        { reference: 'fale-ol-1', levels: lvl(D.LevelFormat.DECIMAL, l => `%${l + 1}.`) },
        { reference: 'fale-ol-a', levels: lvl(D.LevelFormat.LOWER_LETTER, l => `%${l + 1}.`) },
        { reference: 'fale-ol-A', levels: lvl(D.LevelFormat.UPPER_LETTER, l => `%${l + 1}.`) },
        { reference: 'fale-ol-i', levels: lvl(D.LevelFormat.LOWER_ROMAN, l => `%${l + 1}.`) },
        { reference: 'fale-ol-I', levels: lvl(D.LevelFormat.UPPER_ROMAN, l => `%${l + 1}.`) },
      ],
    },
    sections: [{
      properties: { ...(sectionExtra.properties || {}), page: { size: { width: tw(Math.min(pg.w, pg.h)), height: tw(Math.max(pg.w, pg.h)), orientation: landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: tw(pg.mt), right: tw(pg.mr), bottom: tw(pg.mb), left: tw(pg.ml), header: tw(Math.min(36, pg.mt / 2)), footer: tw(Math.min(36, pg.mb / 2)) } } },
      ...(sectionExtra.headers ? { headers: sectionExtra.headers } : {}),
      ...(sectionExtra.footers ? { footers: sectionExtra.footers } : {}),
      children,
    }],
  });
  const blob = await D.Packer.toBlob(doc);
  // mark "Normal" as the default paragraph style (some readers need an explicit default)
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const st = zip.file('word/styles.xml');
  if (st) {
    let xml = await st.async('string');
    if (!/w:default="1"[^>]*w:type="paragraph"|w:type="paragraph"[^>]*w:default="1"/.test(xml)) {
      xml = xml.replace(/<w:style w:type="paragraph" w:styleId="Normal"/, '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"');
      zip.file('word/styles.xml', xml);
    }
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
      const ppr = lvl => `<w:pPr><w:pStyle w:val="TOC${lvl}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${right}"/></w:tabs><w:spacing w:after="60"/><w:ind w:left="${(lvl - 1) * 280}"/></w:pPr>`;
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
