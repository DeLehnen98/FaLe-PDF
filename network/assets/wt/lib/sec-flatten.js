// Flatten annotations and form fields into the page content: each visible annotation's normal
// appearance stream (PDF 32000 §12.5.5) is drawn as a Form XObject at the annotation rectangle, then
// the annotation (and the AcroForm) is removed. Used by flatten-pdf and fill-pdf-form.

const A = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const mul = (m, n) => [ // m then n
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const fx = v => String(+(+v).toFixed(5));

function nums(PDFLib, arr, n) {
  const { PDFArray, PDFNumber } = PDFLib;
  if (!(arr instanceof PDFArray) || arr.size() < n) return null;
  const out = [];
  for (let i = 0; i < n; i++) { const v = arr.lookup(i); if (!(v instanceof PDFNumber)) return null; out.push(v.asNumber()); }
  return out;
}

/** Normal appearance stream (respecting /AS for state dictionaries) → {stream, ref} or null. */
function normalAppearance(PDFLib, ctx, annot) {
  const { PDFName, PDFDict, PDFStream, PDFRef } = PDFLib;
  const ap = annot.lookup(PDFName.of('AP'));
  if (!(ap instanceof PDFDict)) return null;
  let nRaw = ap.get(PDFName.of('N'));
  let n = ap.lookup(PDFName.of('N'));
  if (n instanceof PDFDict && !(n instanceof PDFStream)) {
    const as = annot.lookup(PDFName.of('AS'));
    if (!(as instanceof PDFName)) return null;
    nRaw = n.get(as);
    n = n.lookup(as);
  }
  if (!(n instanceof PDFStream)) return null;
  return { stream: n, ref: nRaw instanceof PDFRef ? nRaw : ctx.register(n) };
}

/**
 * @param {object} PDFLib
 * @param {object} doc  pdf-lib document
 * @param {{forms?: boolean, annots?: boolean, keepLinks?: boolean, tick?: Function, onPage?: Function}} opts
 * @returns {Promise<{drawn: number, removed: number, missing: number, fields: number}>}
 */
export async function flattenDoc(PDFLib, doc, { forms = true, annots = true, keepLinks = true, tick = null, onPage = null } = {}) {
  const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFOperator, PDFOperatorNames: Op } = PDFLib;
  const ctx = doc.context;
  const stat = { drawn: 0, removed: 0, missing: 0, fields: 0 };
  const pages = doc.getPages();
  let seq = 0;
  for (let pi = 0; pi < pages.length; pi++) {
    onPage?.(pi, pages.length);
    const page = pages[pi];
    const list = page.node.lookup(PDFName.of('Annots'));
    if (!(list instanceof PDFArray)) { if (tick) await tick(); continue; }
    const keep = [];
    const ops = [];
    for (let i = 0; i < list.size(); i++) {
      const raw = list.get(i);
      const a = list.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const st = a.lookup(PDFName.of('Subtype'))?.asString?.().slice(1) || '';
      const isWidget = st === 'Widget';
      const isLink = st === 'Link';
      const isPopup = st === 'Popup';
      const target = isWidget ? forms : isLink ? !keepLinks : isPopup ? annots : annots;
      if (!target) { keep.push(raw); continue; }
      if (isWidget) stat.fields++;
      stat.removed++;
      if (isLink || isPopup) continue; // nothing visible to draw
      const flags = a.lookup(PDFName.of('F'));
      const f = flags instanceof PDFNumber ? flags.asNumber() : 0;
      if (f & 2 || f & 32) continue; // Hidden / NoView
      const app = normalAppearance(PDFLib, ctx, a);
      const rect = nums(PDFLib, a.lookup(PDFName.of('Rect')), 4);
      if (!app || !rect) { stat.missing++; continue; }
      const bbox = nums(PDFLib, app.stream.dict.lookup(PDFName.of('BBox')), 4) || [0, 0, 1, 1];
      const mtx = nums(PDFLib, app.stream.dict.lookup(PDFName.of('Matrix')), 6) || [1, 0, 0, 1, 0, 0];
      // transformed bbox
      const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => A(mtx, x, y));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bx0 = Math.min(...xs), by0 = Math.min(...ys), bx1 = Math.max(...xs), by1 = Math.max(...ys);
      const rx0 = Math.min(rect[0], rect[2]), ry0 = Math.min(rect[1], rect[3]), rx1 = Math.max(rect[0], rect[2]), ry1 = Math.max(rect[1], rect[3]);
      const bw = bx1 - bx0, bh = by1 - by0;
      if (bw <= 0 || bh <= 0) { stat.missing++; continue; }
      const sx = (rx1 - rx0) / bw, sy = (ry1 - ry0) / bh;
      const toRect = [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy];
      // the XObject's own /Matrix is applied by the viewer when it paints the form; we only add toRect
      if (!app.stream.dict.get(PDFName.of('Type'))) app.stream.dict.set(PDFName.of('Type'), PDFName.of('XObject'));
      if (!app.stream.dict.get(PDFName.of('Subtype'))) app.stream.dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
      const name = page.node.newXObject(`FaLeFlat${pi}_${++seq}`, app.ref);
      ops.push(
        PDFOperator.of(Op.PushGraphicsState),
        PDFOperator.of(Op.ConcatTransformationMatrix, toRect.map(v => PDFNumber.of(+fx(v)))),
        PDFOperator.of(Op.DrawObject, [name]),
        PDFOperator.of(Op.PopGraphicsState),
      );
      stat.drawn++;
    }
    if (ops.length) page.pushOperators(...ops);
    if (keep.length !== list.size()) {
      if (keep.length) page.node.set(PDFName.of('Annots'), ctx.obj(keep));
      else page.node.delete(PDFName.of('Annots'));
    }
    if (tick) await tick();
  }
  if (forms) {
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
    if (acro instanceof PDFDict) doc.catalog.delete(PDFName.of('AcroForm'));
  }
  return stat;
}

/** Count annotations by kind (for the UI). */
export function countAnnots(PDFLib, doc) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const c = { widgets: 0, links: 0, other: 0, noAppearance: 0 };
  for (const p of doc.getPages()) {
    const list = p.node.lookup(PDFName.of('Annots'));
    if (!(list instanceof PDFArray)) continue;
    for (let i = 0; i < list.size(); i++) {
      const a = list.lookup(i);
      if (!(a instanceof PDFDict)) continue;
      const st = a.lookup(PDFName.of('Subtype'))?.asString?.().slice(1) || '';
      if (st === 'Widget') c.widgets++; else if (st === 'Link') c.links++; else if (st !== 'Popup') c.other++;
      if (st !== 'Link' && st !== 'Popup' && !(a.lookup(PDFName.of('AP')) instanceof PDFDict)) c.noAppearance++;
    }
  }
  return c;
}

/** Text value(s) of a pdf-lib form field ('' for buttons). */
export function fieldValueText(field) {
  try {
    if (typeof field.getText === 'function') return field.getText() || '';
    if (typeof field.getSelected === 'function') return [].concat(field.getSelected() || []).join('\n');
  } catch { /* unreadable */ }
  return '';
}

/**
 * Give form fields fresh appearance streams. `font`: a PDFFont (e.g. Helvetica – WinAnsi: umlauts, ß, €) or
 * a function value → PDFFont (e.g. Helvetica or the Unicode font of lib/unifont.js, which has a
 * `unsupported(text)` check via cleanText). Fields whose value cannot be drawn keep their old appearance;
 * returns the names of those fields.
 */
export function refreshFieldAppearances(PDFLib, doc, font, { unsupported = null } = {}) {
  const failed = [];
  let form;
  try { form = doc.getForm(); } catch { return failed; }
  for (const field of form.getFields()) {
    try {
      const value = fieldValueText(field);
      const f = typeof font === 'function' ? font(value) : font;
      if (unsupported && unsupported(value, f)) { failed.push(field.getName()); continue; }
      if (typeof field.defaultUpdateAppearances === 'function') field.defaultUpdateAppearances(f);
      else if (typeof field.updateAppearances === 'function') field.updateAppearances(f);
    } catch { failed.push(field.getName()); }
  }
  return failed;
}
