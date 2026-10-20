// „Formular mit Gedächtnis“ (PDF+, Stufe 1): eine in FaLe ausgefüllte und unterschriebene PDF sieht in jedem Programm
// fertig aus (Felder fixiert, Text und Unterschrift auf der Seite) – FaLe kann sie aber später wieder bearbeitbar machen.
// Dafür merkt sich die Datei in einem eigenen Katalog-Eintrag (/FaLePlus, von anderen Programmen übergangen):
//   - den Seiteninhalt und die Anmerkungen von VOR dem Ausfüllen (Verweise auf die unveränderten Objekte),
//   - die Formularfelder (sie bleiben in der Datei, nur abgehängt),
//   - die eigenen Einträge (Text, Häkchen, Unterschrift als PNG) als JSON,
//   - einen Prüfwert je Seite: wurde die Seite außerhalb von FaLe geändert, wird nichts zurückgebaut.
// Nichts davon ist mehr als das, was ohnehin sichtbar auf der Seite steht.

const VERSION = 1;
const KEY = 'FaLePlus';

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function streamBytes(PDFLib, obj) {
  const { PDFRawStream, PDFContentStream, PDFStream, decodePDFRawStream } = PDFLib;
  if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode();
  if (PDFContentStream && obj instanceof PDFContentStream) return obj.getUnencodedContents();
  if (obj instanceof PDFStream && obj.getUnencodedContents) return obj.getUnencodedContents();
  return new Uint8Array(0);
}

/** Fingerprint of what a page shows: its content streams (decoded) + how many annotations it has. */
async function pageHash(PDFLib, page) {
  const { PDFName, PDFArray } = PDFLib;
  const node = page.node;
  const c = node.lookup(PDFName.of('Contents'));
  const list = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => c.lookup(i)) : c ? [c] : [];
  const parts = list.map(s => streamBytes(PDFLib, s));
  const annots = node.lookup(PDFName.of('Annots'));
  const n = annots instanceof PDFArray ? annots.size() : 0;
  const total = parts.reduce((a, p) => a + p.length + 1, 0);
  const all = new Uint8Array(total + 16);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; all[o++] = 10; }
  all.set(new TextEncoder().encode(`#annots ${n}`).subarray(0, 16), o);
  return hex(await crypto.subtle.digest('SHA-256', all));
}

const copyOf = (PDFLib, ctx, v) => (v instanceof PDFLib.PDFArray ? ctx.obj(Array.from({ length: v.size() }, (_, i) => v.get(i))) : v);

/** Before anything is changed: remember the page contents, annotations and form fields as they are. */
export function snapshot(PDFLib, pdfDoc) {
  const { PDFName, PDFDict } = PDFLib;
  const ctx = pdfDoc.context;
  const pages = pdfDoc.getPages().map(p => ({ c: copyOf(PDFLib, ctx, p.node.get(PDFName.of('Contents'))), a: copyOf(PDFLib, ctx, p.node.get(PDFName.of('Annots'))) }));
  const acro = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  const fields = acro instanceof PDFDict ? copyOf(PDFLib, ctx, acro.get(PDFName.of('Fields'))) : null;
  const na = acro instanceof PDFDict ? acro.get(PDFName.of('NeedAppearances')) : null;
  return { pages, fields, na };
}

/**
 * Fix the form fields on the pages (like flattening), but keep the field objects in the file so FaLe can bring them back.
 * Widgets are drawn into the page and taken off the page; the fields leave the form's list. Nothing is deleted.
 */
export function softFlatten(PDFLib, pdfDoc, form) {
  const { PDFName, PDFDict, PDFArray, pushGraphicsState, popGraphicsState, translate, drawObject } = PDFLib;
  const widgetDicts = new Set();
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      widgetDicts.add(widget.dict);
      let page, ref;
      try { page = form.findWidgetPage(widget); ref = form.findWidgetAppearanceRef(field, widget); } catch { continue; }
      const key = page.node.newXObject('FlatWidget', ref);
      const r = widget.getRectangle();
      page.pushOperators(pushGraphicsState(), translate(r.x, r.y), drawObject(key), popGraphicsState());
    }
  }
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.lookup(i);
      if (a instanceof PDFDict && (widgetDicts.has(a) || String(a.get(PDFName.of('Subtype'))) === '/Widget')) annots.remove(i);
    }
  }
  const acro = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  if (acro instanceof PDFDict) { acro.set(PDFName.of('Fields'), pdfDoc.context.obj([])); acro.delete(PDFName.of('NeedAppearances')); }
}

/** Take a single field off the pages and out of the form (kept in the file for the memory). */
export function detachField(PDFLib, pdfDoc, form, field) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const dicts = new Set(field.acroField.getWidgets().map(w => w.dict));
  dicts.add(field.acroField.dict);
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) if (dicts.has(annots.lookup(i))) annots.remove(i);
  }
  const acro = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  const list = acro instanceof PDFDict ? acro.lookup(PDFName.of('Fields')) : null;
  if (list instanceof PDFArray) for (let i = list.size() - 1; i >= 0; i--) if (list.lookup(i) === field.acroField.dict) list.remove(i);
}

/** After filling and drawing: write the memory (snapshot + entries + fingerprints) into the document. */
export async function attachMemory(PDFLib, pdfDoc, snap, data) {
  const { PDFName, PDFString } = PDFLib;
  const ctx = pdfDoc.context;
  const pages = pdfDoc.getPages();
  const hashes = [];
  for (const p of pages) hashes.push(await pageHash(PDFLib, p));
  const json = JSON.stringify({ v: VERSION, app: 'FaLe PDF', kind: 'form', ...data, hashes });
  const dataRef = ctx.register(ctx.flateStream(new TextEncoder().encode(json), {}));
  const dict = ctx.obj({ V: VERSION });
  dict.set(PDFName.of('Pages'), ctx.obj(snap.pages.map(s => {
    const d = ctx.obj({});
    if (s.c) d.set(PDFName.of('C'), s.c);
    if (s.a) d.set(PDFName.of('A'), s.a);
    return d;
  })));
  if (snap.fields) dict.set(PDFName.of('Fields'), snap.fields);
  if (snap.na) dict.set(PDFName.of('NA'), snap.na);
  dict.set(PDFName.of('Data'), dataRef);
  dict.set(PDFName.of('About'), PDFString.of('FaLe PDF: Eingaben bleiben in FaLe bearbeitbar'));
  pdfDoc.catalog.set(PDFName.of(KEY), dict);
}

/** Read the memory of a loaded pdf-lib document → null | {data, ok, reason} (ok = the pages are as FaLe left them). */
export async function readMemory(PDFLib, pdfDoc) {
  const { PDFName, PDFDict, PDFArray, PDFStream } = PDFLib;
  const dict = pdfDoc.catalog.lookup(PDFName.of(KEY));
  if (!(dict instanceof PDFDict)) return null;
  let data = null;
  try {
    const s = dict.lookup(PDFName.of('Data'));
    if (s instanceof PDFStream) data = JSON.parse(new TextDecoder().decode(streamBytes(PDFLib, s)));
  } catch { data = null; }
  if (!data || data.v !== VERSION) return { data: null, ok: false, reason: 'format' };
  const pages = pdfDoc.getPages();
  const snapPages = dict.lookup(PDFName.of('Pages'));
  if (!(snapPages instanceof PDFArray) || snapPages.size() !== pages.length || !Array.isArray(data.hashes) || data.hashes.length !== pages.length) return { data, ok: false, reason: 'pages' };
  for (let i = 0; i < pages.length; i++) if (await pageHash(PDFLib, pages[i]) !== data.hashes[i]) return { data, ok: false, reason: 'changed' };
  return { data, ok: true, reason: '' };
}

/** Bring the document back to its state before filling (fields, page contents); returns the remembered entries. */
export function restore(PDFLib, pdfDoc) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const ctx = pdfDoc.context;
  const dict = pdfDoc.catalog.lookup(PDFName.of(KEY));
  const snapPages = dict.lookup(PDFName.of('Pages'));
  pdfDoc.getPages().forEach((p, i) => {
    const s = snapPages.lookup(i);
    const c = s instanceof PDFDict ? s.get(PDFName.of('C')) : null;
    const a = s instanceof PDFDict ? s.get(PDFName.of('A')) : null;
    if (c) p.node.set(PDFName.of('Contents'), c instanceof PDFArray ? copyOf(PDFLib, ctx, c) : c); else p.node.delete(PDFName.of('Contents'));
    if (a) p.node.set(PDFName.of('Annots'), copyOf(PDFLib, ctx, a)); else p.node.delete(PDFName.of('Annots'));
  });
  const fields = dict.get(PDFName.of('Fields'));
  if (fields) {
    let acro = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (!(acro instanceof PDFDict)) { acro = ctx.obj({}); pdfDoc.catalog.set(PDFName.of('AcroForm'), acro); }
    acro.set(PDFName.of('Fields'), copyOf(PDFLib, ctx, ctx.lookup(fields)));
    const na = dict.get(PDFName.of('NA'));
    if (na) acro.set(PDFName.of('NeedAppearances'), na);
  }
  pdfDoc.catalog.delete(PDFName.of(KEY));
}

/** Quick check on a pdf.js-free path: does this pdf-lib document carry a FaLe memory? */
export const hasMemory = (PDFLib, pdfDoc) => pdfDoc.catalog.lookup(PDFLib.PDFName.of(KEY)) instanceof PDFLib.PDFDict;
