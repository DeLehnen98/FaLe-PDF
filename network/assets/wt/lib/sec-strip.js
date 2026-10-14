// Inventory and removal of "hidden" document data: document properties, XMP metadata, attachments,
// JavaScript and other actions, application private data, thumbnails, comment authors.
// Used by edit-metadata, redact-pdf and flatten-pdf.
import { removeUnreachable } from './pdfopt.js';

export const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'];
const JS_TYPES = new Set(['JavaScript', 'Launch', 'ImportData', 'ResetForm', 'SubmitForm', 'Rendition', 'GoToE', 'RichMediaExecute']);

function walkAll(PDFLib, doc, fn) {
  const { PDFDict, PDFStream } = PDFLib;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) fn(obj.dict, ref, true);
    else if (obj instanceof PDFDict) fn(obj, ref, false);
  }
}

const nameOf = v => (v && typeof v.asString === 'function' ? v.asString().replace(/^\//, '') : v ? String(v).replace(/^\//, '') : '');

function decodeText(PDFLib, v) {
  const { PDFString, PDFHexString } = PDFLib;
  if (v instanceof PDFString || v instanceof PDFHexString) { try { return v.decodeText(); } catch { return ''; } }
  return '';
}

/** Read the Info dictionary as plain strings (dates as Date objects). */
export function readInfo(PDFLib, doc) {
  const { PDFDict, PDFName } = PDFLib;
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  const out = { custom: {} };
  if (!(info instanceof PDFDict)) return out;
  for (const [k, v] of info.entries()) {
    const key = k.asString().slice(1);
    const val = info.lookup(PDFName.of(key));
    const text = decodeText(PDFLib, val) || (val && typeof val.asString === 'function' ? val.asString() : '');
    if (INFO_KEYS.includes(key)) out[key] = /Date$/.test(key) ? parsePdfDate(text) : text;
    else if (text) out.custom[key] = text;
  }
  return out;
}

/** "D:20200501100000Z" / "D:20200501120000+02'00'" → Date (null if unreadable). */
export function parsePdfDate(s) {
  const m = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(String(s || '').trim());
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', H = '00', Mi = '00', S = '00', tz, th = '00', tm = '00'] = m;
  let t = Date.UTC(+Y, +Mo - 1, +D, +H, +Mi, +S);
  if (tz === '+' || tz === '-') t -= (tz === '+' ? 1 : -1) * ((+th) * 60 + (+tm)) * 60000;
  const d = new Date(t);
  return isNaN(d) ? null : d;
}

function readXmp(PDFLib, doc) {
  const { PDFName, PDFRawStream, PDFStream } = PDFLib;
  const m = doc.catalog.lookup(PDFName.of('Metadata'));
  if (!(m instanceof PDFStream)) return null;
  try {
    let bytes = m instanceof PDFRawStream ? m.contents : m.getContents();
    const filter = m.dict.lookup(PDFName.of('Filter'));
    if (filter && PDFLib.decodePDFRawStream && m instanceof PDFRawStream) bytes = PDFLib.decodePDFRawStream(m).decode();
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}

/** Names tree leaves (Names/Kids) → [[name, valueRef], …]. */
function nameTree(PDFLib, ctx, node, out = [], depth = 0) {
  const { PDFDict, PDFArray, PDFName } = PDFLib;
  if (!(node instanceof PDFDict) || depth > 32) return out;
  const names = node.lookup(PDFName.of('Names'));
  if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) out.push([decodeText(PDFLib, names.lookup(i)), names.get(i + 1)]);
  const kids = node.lookup(PDFName.of('Kids'));
  if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) nameTree(PDFLib, ctx, kids.lookup(i), out, depth + 1);
  return out;
}

function fileSpecInfo(PDFLib, ctx, spec) {
  const { PDFDict, PDFName, PDFStream } = PDFLib;
  const d = spec instanceof PDFDict ? spec : ctx.lookup(spec);
  if (!(d instanceof PDFDict)) return null;
  const name = decodeText(PDFLib, d.lookup(PDFName.of('UF'))) || decodeText(PDFLib, d.lookup(PDFName.of('F'))) || '?';
  const desc = decodeText(PDFLib, d.lookup(PDFName.of('Desc')));
  let size = null;
  const ef = d.lookup(PDFName.of('EF'));
  if (ef instanceof PDFDict) {
    const f = ef.lookup(PDFName.of('F')) || ef.lookup(PDFName.of('UF'));
    if (f instanceof PDFStream) {
      const params = f.dict.lookup(PDFName.of('Params'));
      const s = params instanceof PDFDict ? params.lookup(PDFName.of('Size')) : null;
      size = s && typeof s.asNumber === 'function' ? s.asNumber() : null;
    }
  }
  return { name, desc, size };
}

function isActionDict(PDFLib, d) {
  const { PDFDict, PDFName } = PDFLib;
  return d instanceof PDFDict && d.lookup(PDFName.of('S')) instanceof PDFLib.PDFName;
}

/**
 * Everything a user might not know is in the file.
 * @returns {{info, xmp, attachments: Array<{name, desc, size, where}>, scripts: Array<{where, kind}>, pieceInfo: number,
 *   thumbs: number, authors: string[], fields: number, links: number, annots: number, pages: number}}
 */
export function inventory(PDFLib, doc) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const ctx = doc.context;
  const cat = doc.catalog;
  const res = { info: readInfo(PDFLib, doc), xmp: readXmp(PDFLib, doc), attachments: [], scripts: [], pieceInfo: 0, thumbs: 0, authors: [], fields: 0, links: 0, annots: 0, pages: doc.getPageCount(), xmpStreams: 0 };
  const names = cat.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) {
    for (const [n, ref] of nameTree(PDFLib, ctx, names.lookup(PDFName.of('EmbeddedFiles')))) {
      const fi = fileSpecInfo(PDFLib, ctx, ref);
      if (fi) res.attachments.push({ ...fi, name: fi.name !== '?' ? fi.name : n, where: 'doc' });
    }
    for (const [n] of nameTree(PDFLib, ctx, names.lookup(PDFName.of('JavaScript')))) res.scripts.push({ where: 'doc', kind: 'JavaScript', name: n });
  }
  const oa = cat.lookup(PDFName.of('OpenAction'));
  if (isActionDict(PDFLib, oa) && JS_TYPES.has(nameOf(oa.lookup(PDFName.of('S'))))) res.scripts.push({ where: 'open', kind: nameOf(oa.lookup(PDFName.of('S'))) });
  if (cat.lookup(PDFName.of('AA')) instanceof PDFDict) res.scripts.push({ where: 'doc-aa', kind: 'AA' });
  const acro = cat.lookup(PDFName.of('AcroForm'));
  if (acro instanceof PDFDict && acro.get(PDFName.of('XFA'))) res.scripts.push({ where: 'xfa', kind: 'XFA' });
  doc.getPages().forEach((p, i) => {
    if (p.node.get(PDFName.of('AA'))) res.scripts.push({ where: `page ${i + 1}`, kind: 'AA' });
    if (p.node.get(PDFName.of('Thumb'))) res.thumbs++;
    const annots = p.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookup(k);
      if (!(a instanceof PDFDict)) continue;
      res.annots++;
      const st = nameOf(a.lookup(PDFName.of('Subtype')));
      if (st === 'Link') res.links++;
      if (st === 'Widget') res.fields++;
      if (st === 'FileAttachment') { const fi = fileSpecInfo(PDFLib, ctx, a.get(PDFName.of('FS'))); if (fi) res.attachments.push({ ...fi, where: `page ${i + 1}` }); }
      const act = a.lookup(PDFName.of('A'));
      if (isActionDict(PDFLib, act) && JS_TYPES.has(nameOf(act.lookup(PDFName.of('S'))))) res.scripts.push({ where: `page ${i + 1}`, kind: nameOf(act.lookup(PDFName.of('S'))) });
      if (a.get(PDFName.of('AA'))) res.scripts.push({ where: `page ${i + 1}`, kind: 'AA' });
      const t = decodeText(PDFLib, a.lookup(PDFName.of('T')));
      if (t && st !== 'Widget' && !res.authors.includes(t)) res.authors.push(t);
    }
  });
  walkAll(PDFLib, doc, (d, ref, isStream) => {
    if (d.get(PDFName.of('PieceInfo'))) res.pieceInfo++;
    if (d !== cat && d.get(PDFName.of('Metadata'))) res.xmpStreams++;
  });
  return res;
}

function dropActionsIn(PDFLib, d) {
  const { PDFName } = PDFLib;
  let n = 0;
  const act = d.lookup(PDFName.of('A'));
  if (isActionDict(PDFLib, act) && JS_TYPES.has(nameOf(act.lookup(PDFName.of('S'))))) { d.delete(PDFName.of('A')); n++; }
  if (d.get(PDFName.of('AA'))) { d.delete(PDFName.of('AA')); n++; }
  return n;
}

/**
 * Remove private / active content in place. Returns counts of what was removed.
 * @param {object} what  {info, xmp, attachments, scripts, pieceInfo, thumbs, authors}  (all default true)
 */
export async function stripPrivate(PDFLib, doc, what = {}) {
  const w = { info: true, xmp: true, attachments: true, scripts: true, pieceInfo: true, thumbs: true, authors: true, ...what };
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const ctx = doc.context;
  const cat = doc.catalog;
  const n = { info: 0, xmp: 0, attachments: 0, scripts: 0, pieceInfo: 0, thumbs: 0, authors: 0 };
  if (w.info) {
    const info = ctx.lookup(ctx.trailerInfo.Info);
    if (info instanceof PDFDict) for (const [k] of info.entries()) { info.delete(k); n.info++; }
  }
  const names = cat.lookup(PDFName.of('Names'));
  if (names instanceof PDFDict) {
    if (w.attachments && names.get(PDFName.of('EmbeddedFiles'))) { n.attachments += Math.max(1, nameTree(PDFLib, ctx, names.lookup(PDFName.of('EmbeddedFiles'))).length); names.delete(PDFName.of('EmbeddedFiles')); }
    if (w.scripts && names.get(PDFName.of('JavaScript'))) { n.scripts += Math.max(1, nameTree(PDFLib, ctx, names.lookup(PDFName.of('JavaScript'))).length); names.delete(PDFName.of('JavaScript')); }
  }
  if (w.attachments) { cat.delete(PDFName.of('AF')); cat.delete(PDFName.of('Collection')); }
  if (w.scripts) {
    const oa = cat.lookup(PDFName.of('OpenAction'));
    if (isActionDict(PDFLib, oa) && JS_TYPES.has(nameOf(oa.lookup(PDFName.of('S'))))) { cat.delete(PDFName.of('OpenAction')); n.scripts++; }
    if (cat.get(PDFName.of('AA'))) { cat.delete(PDFName.of('AA')); n.scripts++; }
    const acro = cat.lookup(PDFName.of('AcroForm'));
    if (acro instanceof PDFDict && acro.get(PDFName.of('XFA'))) { acro.delete(PDFName.of('XFA')); n.scripts++; }
  }
  for (const p of doc.getPages()) {
    if (w.scripts && p.node.get(PDFName.of('AA'))) { p.node.delete(PDFName.of('AA')); n.scripts++; }
    if (w.thumbs && p.node.get(PDFName.of('Thumb'))) { p.node.delete(PDFName.of('Thumb')); n.thumbs++; }
    if (w.attachments) p.node.delete(PDFName.of('AF'));
    const annots = p.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let k = annots.size() - 1; k >= 0; k--) {
      const a = annots.lookup(k);
      if (!(a instanceof PDFDict)) continue;
      const st = nameOf(a.lookup(PDFName.of('Subtype')));
      if (w.attachments && st === 'FileAttachment') { annots.remove(k); n.attachments++; continue; }
      if (w.scripts) n.scripts += dropActionsIn(PDFLib, a);
      if (w.authors && st !== 'Widget' && a.get(PDFName.of('T'))) { a.delete(PDFName.of('T')); n.authors++; }
    }
  }
  // form fields (parents of widgets) can carry actions too; XMP / PieceInfo on any object
  walkAll(PDFLib, doc, (d, ref, isStream) => {
    if (w.scripts && !isStream && d.get(PDFName.of('FT'))) n.scripts += dropActionsIn(PDFLib, d);
    if (w.pieceInfo && d.get(PDFName.of('PieceInfo'))) { d.delete(PDFName.of('PieceInfo')); n.pieceInfo++; }
    if (w.xmp && d.get(PDFName.of('Metadata'))) { d.delete(PDFName.of('Metadata')); n.xmp++; }
  });
  if (w.xmp && cat.get(PDFName.of('Metadata'))) { cat.delete(PDFName.of('Metadata')); n.xmp++; }
  await doc.flush();
  removeUnreachable(doc, PDFLib);
  return n;
}
