// Bookmarks (document outline) for pdf-lib documents: one flat level, e.g. one entry per merged file.

/**
 * @param doc     pdf-lib PDFDocument
 * @param PDFLib  pdf-lib namespace
 * @param {{title: string, pageIndex: number}[]} items
 */
export function setOutline(doc, PDFLib, items) {
  const { PDFName, PDFHexString, PDFNumber } = PDFLib;
  const ctx = doc.context;
  const pages = doc.getPages();
  const list = items.filter(it => pages[it.pageIndex]);
  if (!list.length) return;
  const root = ctx.nextRef();
  const refs = list.map(() => ctx.nextRef());
  list.forEach((it, i) => {
    const d = ctx.obj({});
    d.set(PDFName.of('Title'), PDFHexString.fromText(String(it.title).slice(0, 200)));
    d.set(PDFName.of('Parent'), root);
    d.set(PDFName.of('Dest'), ctx.obj([pages[it.pageIndex].ref, PDFName.of('XYZ'), null, null, null]));
    if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < list.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], d);
  });
  const o = ctx.obj({});
  o.set(PDFName.of('Type'), PDFName.of('Outlines'));
  o.set(PDFName.of('First'), refs[0]);
  o.set(PDFName.of('Last'), refs[refs.length - 1]);
  o.set(PDFName.of('Count'), PDFNumber.of(refs.length));
  ctx.assign(root, o);
  doc.catalog.set(PDFName.of('Outlines'), root);
}
