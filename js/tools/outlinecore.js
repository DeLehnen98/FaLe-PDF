// PDF bookmarks (document outline): read them as a flat list with levels, derive them from headings (layout
// analysis of js/tools/pdfstruct.js) and write them back as /Outlines with pdf-lib low-level objects.
// Import-free apart from its synced sibling pdfstruct.js – used by the app tool "Lesezeichen bearbeiten"
// (js/tools/bookmarks.js) and synced into the FaLe Werkzeuge (network/assets/wt/lib/shared/outlinecore.js).
import { analysePage, bodySize, paragraphs } from './pdfstruct.js';

/** Read the outline as a flat list [{title, page, top, level}] (pages 1-based). */
export async function readOutline(pdf, { untitled = 'Ohne Titel' } = {}) {
  let outline = null;
  try { outline = await pdf.getOutline(); } catch {}
  const flat = [];
  const walk = async (items, level) => {
    for (const it of items || []) {
      let page = null, top = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        if (Array.isArray(dest) && dest[0] != null) {
          page = typeof dest[0] === 'number' ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1;
          if (dest[1] && dest[1].name === 'XYZ' && typeof dest[3] === 'number') top = dest[3];
          else if (dest[1] && (dest[1].name === 'FitH' || dest[1].name === 'FitBH') && typeof dest[2] === 'number') top = dest[2];
        }
      } catch {}
      flat.push({ title: it.title || untitled, page: page || 1, top, level, url: it.url || null });
      if (it.items && it.items.length) await walk(it.items, level + 1);
    }
  };
  await walk(outline, 0);
  return flat;
}

/** Headings (via layout analysis) → flat bookmark list. onProgress(n, total) may return a promise (yield to the UI). */
export async function outlineFromHeadings(pdf, onProgress) {
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push({ n, page, a: await analysePage(page) });
    if (onProgress && n % 4 === 0) await onProgress(n, pdf.numPages);
  }
  const body = bodySize(pages.map(p => p.a));
  const out = [];
  for (const p of pages) {
    const base = p.page.getViewport({ scale: 1 });
    for (const para of paragraphs(p.a, body)) {
      if (!para.heading) continue;
      const title = para.text.replace(/\s+/g, ' ').trim();
      if (!title || title.length > 140 || /^\d+$/.test(title)) continue;
      const [, top] = base.convertToPdfPoint(0, Math.max(0, para.top - 6));
      out.push({ title, page: p.n, top, level: para.heading - 1 });
    }
  }
  // normalise levels: no jumps of more than one level, first item at level 0
  const used = [...new Set(out.map(o => o.level))].sort((a, b) => a - b);
  out.forEach(o => { o.level = used.indexOf(o.level); });
  for (let i = 0; i < out.length; i++) out[i].level = Math.min(out[i].level, i ? out[i - 1].level + 1 : 0);
  return out;
}

/** Write a flat list as /Outlines (replaces any existing outline). */
export function writeOutline(PDFLib, pdfDoc, flat) {
  const { PDFName, PDFHexString, PDFNumber } = PDFLib;
  const ctx = pdfDoc.context;
  const catalog = pdfDoc.catalog;
  const pages = pdfDoc.getPages();
  if (!flat.length) { catalog.delete(PDFName.of('Outlines')); return; }
  // tree from levels
  const root = { children: [] };
  const stack = [{ node: root, level: -1 }];
  for (const it of flat) {
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
    const node = { ...it, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node, level: it.level });
  }
  const outlinesRef = ctx.nextRef();
  const build = (nodes, parentRef) => {
    const refs = nodes.map(() => ctx.nextRef());
    nodes.forEach((n, i) => {
      const pg = pages[Math.max(0, Math.min(pages.length - 1, n.page - 1))];
      const { height, y } = pg.getCropBox();
      const top = n.top != null ? n.top : y + height;
      const dict = ctx.obj({ Parent: parentRef, Dest: [pg.ref, 'XYZ', null, +(+top).toFixed(2), null] });
      dict.set(PDFName.of('Title'), PDFHexString.fromText(n.title));
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < nodes.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      if (n.children.length) {
        const kids = build(n.children, refs[i]);
        dict.set(PDFName.of('First'), kids[0]);
        dict.set(PDFName.of('Last'), kids[kids.length - 1]);
        // first level open, deeper levels collapsed
        dict.set(PDFName.of('Count'), PDFNumber.of(n.level === 0 ? n.children.length : -n.children.length));
      }
      ctx.assign(refs[i], dict);
    });
    return refs;
  };
  const top = build(root.children, outlinesRef);
  const visible = root.children.reduce((s, n) => s + 1 + (n.level === 0 ? n.children.length : 0), 0);
  ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: top[0], Last: top[top.length - 1], Count: visible }));
  catalog.set(PDFName.of('Outlines'), outlinesRef);
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
