// FaLe PDF – client-side security helpers in ONE place (see docs/SECURITY.md).
//
//   safeUrl(href)               → normalised http(s)/mailto/tel URL or null (never javascript:, data:, file: …)
//   openExternal(href)          → asks before leaving the app, then opens with noopener/noreferrer
//   cssColor(value, fallback)   → a value that is safe inside style="…" (hex / rgb() / named colour only)
//   copySecret(text)            → clipboard copy that is cleared again after 60 s (recovery key, Wi-Fi password)
//   screenSecure(on)            → Android: FLAG_SECURE while sensitive screens are open (no screenshots / recents preview)
//   loadPurify() / sanitizeDocHtml(html)  → DOMPurify (vendored, lazy) for rich document HTML (docx/md import, paste)
//   LIMITS / assertImageSize()  → resource limits against decompression / dimension bombs
//
// Escaping of untrusted text into HTML stays ui.js esc() (used everywhere); this module adds the
// pieces that need more than escaping.

// ---------------------------------------------------------------- resource limits
export const LIMITS = Object.freeze({
  imagePixels: 100e6,          // decoded image (≈ 400 MB RGBA) – pdf.js maxImageSize and our own decoders
  canvasPixels: 40e6,          // one rendered canvas (≈ 160 MB RGBA)
  zipEntries: 20000,           // entries in a .docx/.xlsx/.pptx
  zipTotalBytes: 1024 * 1024 * 1024, // declared uncompressed size of all entries (1 GiB)
  zipEntryBytes: 512 * 1024 * 1024,  // one entry (512 MiB)
  zipRatio: 1000,              // compression ratio of one entry above 1 MiB (zip bomb signature)
});

export class LimitError extends Error {
  constructor(msg) { super(msg); this.name = 'LimitError'; this.userMessage = msg; }
}

/** Throws a user-facing LimitError when an image is larger than LIMITS.imagePixels. */
export function assertImageSize(w, h, what = 'Das Bild') {
  const px = Number(w) * Number(h);
  if (!Number.isFinite(px) || px > LIMITS.imagePixels) {
    throw new LimitError(`${what} ist zu groß (${Math.round(w)} × ${Math.round(h)} Pixel). Bitte verkleinere es zuerst.`);
  }
}

/**
 * Image dimensions from the file header (PNG, JPEG, GIF, BMP, WebP) WITHOUT decoding the pixels –
 * so a 50 000 × 50 000 "dimension bomb" is rejected before the browser allocates gigabytes.
 * Resolves {w, h} or null (unknown format → the caller's own checks apply).
 */
export async function probeImageSize(blob) {
  if (!blob || typeof blob.slice !== 'function') return null;
  const b = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const u16be = i => (b[i] << 8) | b[i + 1], u16le = i => b[i] | (b[i + 1] << 8);
  const u32be = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u32le = i => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32be(16), h: u32be(20) }; // PNG IHDR
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16le(6), h: u16le(8) }; // GIF
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { w: Math.abs(u32le(18) | 0), h: Math.abs(u32le(22) | 0) }; // BMP
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) { // RIFF…WEBP
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (tag === 'VP8L') { const v = u32le(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
    if (tag === 'VP8 ') return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG: walk the markers to the first SOFn
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = u16be(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(i + 7), h: u16be(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** Reject image files whose header declares more than LIMITS.imagePixels (before decoding them). */
export async function assertImageBlob(blob, what = 'Das Bild') {
  let d = null;
  try { d = await probeImageSize(blob); } catch { d = null; }
  if (d) assertImageSize(d.w, d.h, what);
  return d;
}

/** Scale factor (≤ 1) that keeps a canvas of w × h within LIMITS.canvasPixels. */
export function canvasScaleCap(w, h, max = LIMITS.canvasPixels) {
  const px = w * h;
  return px > max ? Math.sqrt(max / px) : 1;
}

// ---------------------------------------------------------------- URLs
export const SAFE_SCHEMES = Object.freeze(['http:', 'https:', 'mailto:', 'tel:']);

/** Normalised URL string when it uses an allowed scheme, else null. Relative URLs resolve against `base`. */
export function safeUrl(href, { schemes = SAFE_SCHEMES, base = null } = {}) {
  if (href == null) return null;
  const raw = String(href).replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, '').trim();
  if (!raw || raw.length > 4096) return null;
  let u;
  try { u = base ? new URL(raw, base) : new URL(raw); } catch { return null; }
  if (!schemes.includes(u.protocol)) return null;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && (!u.hostname || u.username || u.password)) return null; // no user:pass@ tricks
  return u.href;
}

let confirmFn = null;
/** Ask before opening an external link (shows the real target), then open it without opener/referrer. */
export async function openExternal(href, { confirm = true, source = '' } = {}) {
  const url = safeUrl(href);
  const ui = await import('./ui.js');
  if (!url) { ui.toast('Dieser Link wird aus Sicherheitsgründen nicht geöffnet.', 'error'); return false; }
  if (confirm) {
    const u = new URL(url);
    const shown = u.protocol === 'mailto:' || u.protocol === 'tel:' ? url : `${u.protocol}//${u.host}${u.pathname.length > 1 ? u.pathname : ''}${u.search}`;
    const ok = await (confirmFn || ui.confirmDialog)('Externen Link öffnen?',
      `${source ? source + ' ' : ''}Der Link führt zu ${shown.length > 300 ? shown.slice(0, 300) + '…' : shown} – öffne nur Links, denen du vertraust.`, { okLabel: 'Öffnen' });
    if (!ok) return false;
  }
  if (/^(mailto|tel):/i.test(url)) { location.href = url; return true; }
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w) { try { w.opener = null; } catch {} }
  return true;
}
/** Tests only: replace the confirmation dialog. */
export function _setConfirm(fn) { confirmFn = fn; }

/**
 * Capture-phase click guard for a container with untrusted links (PDF annotation layer, imported
 * documents): every <a href> to an external target goes through openExternal(); in-document links
 * (#…) keep working; everything else (javascript:, data:, file:, blob: …) is blocked.
 */
export function guardLinks(root, { source = '' } = {}) {
  const onClick = e => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !root.contains(a)) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return; // internal destination (pdf.js handles it)
    e.preventDefault(); e.stopPropagation();
    openExternal(a.href, { source });
  };
  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener('click', onClick, true);
}

// ---------------------------------------------------------------- CSS values
const NAMED = /^[a-z]{3,20}$/i;
/** A colour that is safe inside style="…": #rgb/#rrggbb(aa), rgb()/rgba()/hsl()/hsla() with numbers, or a plain colour name. */
export function cssColor(v, fallback = '#888888') {
  const s = String(v == null ? '' : v).trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^(?:rgb|hsl)a?\(\s*[-\d.%\s,/]+\)$/i.test(s)) return s;
  if (NAMED.test(s)) return s;
  return fallback;
}

// ---------------------------------------------------------------- clipboard
let clipTimer = 0, clipValue = null, clipCopiedSince = false;
if (typeof document !== 'undefined') {
  // the user copied something else in the app after us → never overwrite their clipboard
  document.addEventListener('copy', () => { if (clipValue !== null) clipCopiedSince = true; }, true);
  document.addEventListener('cut', () => { if (clipValue !== null) clipCopiedSince = true; }, true);
}
/**
 * Copy a secret and clear it from the clipboard after `clearAfterMs` – only if the clipboard still holds
 * exactly this secret (checked when the browser allows reading) and nothing else was copied in the app.
 */
export async function copySecret(text, { clearAfterMs = 60000 } = {}) {
  const value = String(text);
  let ok = false;
  try { await navigator.clipboard.writeText(value); ok = true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = value; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (!ok) return false;
  clearTimeout(clipTimer);
  clipValue = value; clipCopiedSince = false;
  clipTimer = setTimeout(clearSecret, Math.max(1000, clearAfterMs));
  return true;
}
async function clearSecret() {
  const value = clipValue;
  clipValue = null;
  if (value === null || clipCopiedSince) return;
  try {
    let current = null;
    try { current = await navigator.clipboard.readText(); } catch { current = null; } // reading may be denied
    if (current === null || current === value) await navigator.clipboard.writeText('');
  } catch { /* clipboard not available (page hidden) – nothing we can do */ }
}
/** Tests only. */
export function _clipboardState() { return { pending: clipValue !== null, copiedSince: clipCopiedSince }; }

// ---------------------------------------------------------------- Android FLAG_SECURE
let secureCount = 0;
/**
 * Mark a sensitive screen (vault, recovery key, passwords) as secure while it is open: in the Android app
 * the window gets FLAG_SECURE (no screenshots, screen recordings or app-switcher previews). Ref-counted;
 * returns a release function. No-op on the web (browsers have no equivalent).
 */
export function screenSecure(on = true) {
  if (!on) return () => {};
  secureCount++;
  if (secureCount === 1) setFlag(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    secureCount = Math.max(0, secureCount - 1);
    if (!secureCount) setFlag(false);
  };
}
function setFlag(on) {
  import('./platform.js').then(p => {
    if (!p.isNative()) return;
    const pl = p.plugin('FaleIncoming');
    if (pl && typeof pl.setSecure === 'function') pl.setSecure({ on }).catch(() => {});
  }).catch(() => {});
}
/** Tests only. */
export function _secureCount() { return secureCount; }

// ---------------------------------------------------------------- DOMPurify (lazy)
let purifyP = null;
/** Load the vendored DOMPurify (vendor/dompurify/purify.min.js) once. Resolves window.DOMPurify. */
export function loadPurify() {
  if (window.DOMPurify && window.DOMPurify.sanitize) return Promise.resolve(window.DOMPurify);
  if (purifyP) return purifyP;
  purifyP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/dompurify/purify.min.js', import.meta.url).href;
    s.async = true;
    s.onload = () => (window.DOMPurify && window.DOMPurify.sanitize ? resolve(window.DOMPurify) : reject(new Error('DOMPurify missing')));
    s.onerror = () => { purifyP = null; reject(new Error('DOMPurify could not be loaded')); };
    document.head.appendChild(s);
  });
  return purifyP;
}
export function purifyLoaded() { return !!(window.DOMPurify && window.DOMPurify.sanitize); }

// Tags/attributes the document editor (js/office/writer.js) works with – everything else is dropped.
const DOC_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col', 'caption',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sup', 'sub', 'mark', 'code', 'kbd', 'pre', 'blockquote', 'hr', 'br', 'span', 'div', 'a', 'img', 'font', 'small', 'big', 'cite', 'q'];
const DOC_ATTRS = ['href', 'src', 'alt', 'title', 'width', 'height', 'style', 'class', 'colspan', 'rowspan', 'type', 'start', 'contenteditable', 'lang', 'dir', 'color', 'size', 'face', 'align'];
const DOC_URI = /^(?:https?:|mailto:|tel:|#)/i;
let hooked = false;
function hookPurify(P) {
  if (hooked) return;
  hooked = true;
  P.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const href = node.getAttribute('href') || '';
      if (!DOC_URI.test(href.trim())) node.removeAttribute('href'); // (links in the editor open via openExternal)
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!/^(?:data:image\/(?:png|jpe?g|gif|webp|bmp|avif|svg\+xml)[;,]|blob:)/i.test(src)) node.removeAttribute('src'); // no remote loads (tracking pixels)
    }
    if (node.hasAttribute && node.hasAttribute('style') && /url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding/i.test(node.getAttribute('style'))) node.removeAttribute('style');
    if (node.hasAttribute && node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false') node.removeAttribute('contenteditable');
  });
}
/** Synchronous sanitizer for document HTML; requires loadPurify() first. Keeps data-* attributes (editor markers). */
export function sanitizeDocHtmlSync(html) {
  const P = window.DOMPurify;
  if (!P || !P.sanitize) throw new Error('DOMPurify not loaded');
  hookPurify(P);
  return P.sanitize(String(html == null ? '' : html), {
    ALLOWED_TAGS: DOC_TAGS, ALLOWED_ATTR: DOC_ATTRS, ALLOW_DATA_ATTR: true, ALLOWED_URI_REGEXP: DOC_URI,
    // non-URL attributes must not be checked against DOC_URI (else colspan/width/start … are dropped)
    ADD_URI_SAFE_ATTR: ['colspan', 'rowspan', 'width', 'height', 'type', 'start', 'contenteditable', 'lang', 'dir', 'color', 'size', 'face', 'align'],
    ALLOW_UNKNOWN_PROTOCOLS: false, FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'template', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    KEEP_CONTENT: true, RETURN_TRUSTED_TYPE: false, WHOLE_DOCUMENT: false,
  });
}
/** Load DOMPurify (if needed) and sanitize document HTML. */
export async function sanitizeDocHtml(html) {
  await loadPurify();
  return sanitizeDocHtmlSync(html);
}
