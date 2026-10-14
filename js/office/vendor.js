// Lazy loaders for the vendored office libraries (classic scripts → globals). Everything is local.
import { UserError } from '../ui.js';
import { LIMITS } from '../security.js';

const pending = new Map();

function loadScript(rel, globalName, label) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (pending.has(rel)) return pending.get(rel);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(rel, import.meta.url).href;
    s.async = true;
    s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new UserError(`${label} konnte nicht geladen werden.`)));
    s.onerror = () => { pending.delete(rel); reject(new UserError(`${label} konnte nicht geladen werden.`)); };
    document.head.appendChild(s);
  });
  pending.set(rel, p);
  return p;
}

export const loadJSZip = () => loadScript('../../vendor/jszip/jszip.min.js', 'JSZip', 'Die ZIP-Bibliothek');
export const loadDocx = () => loadScript('../../vendor/docx/docx.iife.js', 'docx', 'Die Word-Bibliothek');
export const loadPptxGen = async () => {
  await loadJSZip();
  return loadScript('../../vendor/pptxgenjs/pptxgen.bundle.js', 'PptxGenJS', 'Die Präsentations-Bibliothek');
};

/**
 * Open a zip (docx/xlsx/pptx) with a friendly error – and with zip-bomb limits (docs/SECURITY.md):
 * at most LIMITS.zipEntries entries, LIMITS.zipEntryBytes per entry, LIMITS.zipTotalBytes in total
 * (declared sizes, checked before anything is inflated), no extreme compression ratios, and every
 * entry is inflated through a stream that stops as soon as it produces more than it declared.
 */
export async function openZip(data, name = 'Datei') {
  const JSZip = await loadJSZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (e) {
    throw new UserError(`„${name}“ ist beschädigt oder kein gültiges Office-Dokument.`);
  }
  const files = Object.values(zip.files);
  const tooBig = () => new UserError(`„${name}“ ist ungewöhnlich groß verpackt (mögliche ZIP-Bombe) und wird aus Sicherheitsgründen nicht geöffnet.`);
  if (files.length > LIMITS.zipEntries) throw tooBig();
  let total = 0;
  for (const f of files) {
    if (f.dir) continue;
    const d = f._data || {};
    const size = Number(d.uncompressedSize), packed = Number(d.compressedSize);
    if (!Number.isFinite(size) || size < 0) continue; // no metadata (not loaded from bytes)
    total += size;
    if (size > LIMITS.zipEntryBytes || total > LIMITS.zipTotalBytes) throw tooBig();
    if (size > 1024 * 1024 && packed > 0 && size / packed > LIMITS.zipRatio) throw tooBig();
    capEntry(f, size);
  }
  return zip;
}

// Inflate one entry with a hard cap (its declared size): a lying header cannot make it expand without bound.
function capEntry(f, declared) {
  if (typeof f.internalStream !== 'function' || f._faleCapped) return;
  const orig = f.async.bind(f);
  const limit = declared + 64;
  f._faleCapped = true;
  f.async = (type, onUpdate) => {
    if (!['string', 'text', 'base64', 'uint8array', 'arraybuffer', 'blob', 'binarystring'].includes(type)) return orig(type, onUpdate);
    return new Promise((resolve, reject) => {
      const parts = [];
      let n = 0, done = false;
      let stream;
      try { stream = f.internalStream('uint8array'); } catch (e) { reject(e); return; }
      stream.on('data', chunk => {
        if (done) return;
        n += chunk.length;
        if (n > limit) { done = true; try { stream.pause(); } catch {} reject(new UserError('Die Datei ist beschädigt (Inhalt größer als angegeben).')); return; }
        parts.push(chunk);
      }).on('error', e => { if (!done) { done = true; reject(e); } }).on('end', () => {
        if (done) return;
        done = true;
        const u8 = new Uint8Array(n);
        let o = 0;
        for (const p of parts) { u8.set(p, o); o += p.length; }
        try { resolve(convertBytes(u8, type)); } catch (e) { reject(e); }
      }).resume();
    });
  };
}
function convertBytes(u8, type) {
  switch (type) {
    case 'string': case 'text': return new TextDecoder('utf-8').decode(u8);
    case 'uint8array': return u8;
    case 'arraybuffer': return u8.buffer;
    case 'blob': return new Blob([u8]);
    case 'base64': case 'binarystring': {
      let s = '';
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return type === 'base64' ? btoa(s) : s;
    }
    default: throw new Error('type');
  }
}

/** Parse XML text into a Document (namespace-agnostic helpers below). */
export function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new UserError('Die Datei enthält fehlerhafte Daten (XML).');
  return doc;
}

export async function zipXml(zip, path) {
  const f = zip.file(path);
  if (!f) return null;
  return parseXml(await f.async('string'));
}

/** Child elements with a given local name. */
export function kids(el, name) {
  const out = [];
  if (!el) return out;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c);
  return out;
}
export function kid(el, name) {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
}
/** Descendant by a path of local names, e.g. path(el, 'spPr', 'xfrm', 'off'). */
export function path(el, ...names) {
  let cur = el;
  for (const n of names) { cur = kid(cur, n); if (!cur) return null; }
  return cur;
}
/** All descendants with a local name. */
export function desc(el, name) {
  return el ? Array.from(el.getElementsByTagNameNS('*', name)) : [];
}
/** Attribute by local name (ignores prefixes such as w:val / r:id). */
export function attr(el, name) {
  if (!el) return null;
  if (el.hasAttribute(name)) return el.getAttribute(name);
  for (const a of el.attributes) if (a.localName === name) return a.value;
  return null;
}

/** The r:id attribute (relationships namespace) of an element. */
export function rid(el) {
  if (!el) return null;
  for (const a of el.attributes) if (a.localName === 'id' && /relationships/.test(a.namespaceURI || '')) return a.value;
  return null;
}

/** Relationship map of a part: id → { type, target (resolved path), external }. */
export async function readRels(zip, partPath) {
  const dir = partPath.includes('/') ? partPath.slice(0, partPath.lastIndexOf('/') + 1) : '';
  const relPath = dir + '_rels/' + partPath.slice(dir.length) + '.rels';
  const doc = await zipXml(zip, relPath);
  const map = new Map();
  if (!doc) return map;
  for (const r of Array.from(doc.getElementsByTagNameNS('*', 'Relationship'))) {
    const external = r.getAttribute('TargetMode') === 'External';
    const target = r.getAttribute('Target') || '';
    map.set(r.getAttribute('Id'), { type: (r.getAttribute('Type') || '').split('/').pop(), target: external ? target : resolvePath(dir, target), external });
  }
  return map;
}

export function resolvePath(dir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir + target).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/');
}

const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' };
export function mimeOf(path) { return MIME_BY_EXT[String(path).split('.').pop().toLowerCase()] || null; }

/** Read an image part as data URL (null for unsupported formats such as EMF/WMF). */
export async function zipImageDataUrl(zip, p) {
  const mime = mimeOf(p);
  const f = zip.file(p);
  if (!mime || !f || mime === 'image/tiff') return null;
  const b64 = await f.async('base64');
  return `data:${mime};base64,${b64}`;
}

export const tick = () => new Promise(r => setTimeout(r, 0));

export function xmlEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    // strip characters that are not allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

export function dataUrlToBytes(url) {
  const i = url.indexOf(',');
  const meta = url.slice(5, i);
  const b64 = meta.endsWith(';base64');
  const raw = b64 ? atob(url.slice(i + 1)) : decodeURIComponent(url.slice(i + 1));
  const out = new Uint8Array(raw.length);
  for (let k = 0; k < raw.length; k++) out[k] = raw.charCodeAt(k);
  return { bytes: out, mime: meta.replace(/;base64$/, '') };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

/** Re-encode any browser-readable image (webp, gif, svg …) to PNG or JPEG bytes, optionally downscaled. */
export async function imageToBytes(src, { maxSide = 2400, prefer = 'auto' } = {}) {
  let mime = src.startsWith('data:') ? src.slice(5, src.indexOf(';')) : '';
  const img = await loadImage(src);
  const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
  if ((mime === 'image/png' || mime === 'image/jpeg') && Math.max(w, h) <= maxSide && prefer === 'auto' && src.startsWith('data:')) {
    const { bytes } = dataUrlToBytes(src);
    return { bytes, type: mime === 'image/png' ? 'png' : 'jpg', width: w, height: h };
  }
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  const jpeg = prefer === 'jpg' || mime === 'image/jpeg';
  if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.9));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: jpeg ? 'jpg' : 'png', width: w, height: h };
}

/** Read a picked image file into a (downscaled) data URL. */
export async function fileToDataUrl(file, maxSide = 2000) {
  const url = await blobToDataUrl(file);
  const img = await loadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w, h) <= maxSide && /^data:image\/(png|jpeg)/.test(url)) return { url, w, h };
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const ctx = c.getContext('2d');
  const png = /png|gif|webp/.test(file.type);
  if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), w: c.width, h: c.height };
}

/** Decode a text file: UTF-8 (with/without BOM), UTF-16 BOM, else Windows-1252. */
export async function decodeText(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let start = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(start)); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

