// Shared drawing helpers for the "edit" tools (page numbers, watermark, header/footer, crop, resize,
// n-up, booklet, letterhead, PDF editor). Everything is drawn in the *visual* frame of a page – the
// page as a viewer shows it: CropBox (with any origin offset) and /Rotate applied, origin bottom-left,
// x right, y up, size W × H in points. frame(page) gives the matrix from that frame to PDF user space.
//
//   const f = frame(page);                       // {W, H, rot, box, m}
//   drawVisual(page, PDFLib, f, () => { page.drawText('1', {x: f.W / 2, y: 20, size: 10, font}); }, {under: false});
//
// Text: the 14 standard PDF fonts only know WinAnsi (Western European). winAnsi(text) maps what it can
// (typographic quotes, dashes, accents of other Latin scripts via decomposition) and reports every
// character it had to replace, so the tools can warn instead of silently dropping text.

import { saveDoc, saveEncrypted } from './pdf.js';

export const MM = 72 / 25.4;
export const mm = v => v * MM;
export const toMm = pt => pt / MM;

export const SHEETS = {
  a3: [841.89, 1190.55], a4: [595.28, 841.89], a5: [419.53, 595.28], a6: [297.64, 419.53],
  letter: [612, 792], legal: [612, 1008],
};

export const normRot = r => ((Math.round((Number(r) || 0) / 90) * 90) % 360 + 360) % 360;

/** Visual frame of a pdf-lib page. */
export function frame(page) {
  const b = page.getCropBox ? page.getCropBox() : page.getMediaBox();
  const rot = normRot(page.getRotation().angle);
  const cw = b.width, ch = b.height, cx = b.x, cy = b.y;
  const swap = rot === 90 || rot === 270;
  const W = swap ? ch : cw, H = swap ? cw : ch;
  let m;
  if (rot === 0) m = [1, 0, 0, 1, cx, cy];
  else if (rot === 90) m = [0, 1, -1, 0, cx + H, cy];
  else if (rot === 180) m = [-1, 0, 0, -1, cx + cw, cy + ch];
  else m = [0, -1, 1, 0, cx, cy + ch];
  return { W, H, rot, box: { x: cx, y: cy, width: cw, height: ch }, m };
}

/** Apply a matrix [a b c d e f] to a point. */
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const mul = (m, n) => [ // m · n (n applied first)
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Visual rectangle (top-left based: x, y from the top, w, h) → PDF user-space rectangle {x, y, width, height}. */
export function visualRectToPdf(f, { x, y, w, h }) {
  const pts = [apply(f.m, x, f.H - y), apply(f.m, x + w, f.H - y - h)];
  const x0 = Math.min(pts[0][0], pts[1][0]), y0 = Math.min(pts[0][1], pts[1][1]);
  return { x: x0, y: y0, width: Math.abs(pts[1][0] - pts[0][0]), height: Math.abs(pts[1][1] - pts[0][1]) };
}

/**
 * Draw into a page in its visual frame. fn() uses the normal pdf-lib page.draw* methods with visual
 * coordinates. A fresh content stream is used; with under: true it is moved before the page content.
 */
export function drawVisual(page, PDFLib, f, fn, { under = false } = {}) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
  page.getContentStream(false); // new stream for this layer (pdf-lib wraps the existing content in q … Q)
  const ref = page.contentStreamRef;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...f.m));
  fn();
  page.pushOperators(popGraphicsState());
  if (under) moveStreamToFront(page, PDFLib, ref);
  return ref;
}

export function moveStreamToFront(page, PDFLib, ref) {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFLib.PDFArray)) return;
  let idx = -1;
  for (let i = 0; i < contents.size(); i++) if (contents.get(i) === ref) idx = i;
  if (idx <= 0) return;
  contents.remove(idx);
  contents.insert(0, ref);
}

/**
 * Matrix that draws an embedded page XObject (made with embedPage(page, cropBoxBoundingBox(page)))
 * upright – the way a viewer shows the source page, /Rotate applied – scaled by s with its visual
 * lower-left corner at (tx, ty).
 */
export function placeMatrix(rot, cw, ch, s, tx, ty) {
  let g;
  if (rot === 0) g = [1, 0, 0, 1, 0, 0];
  else if (rot === 90) g = [0, -1, 1, 0, 0, cw];
  else if (rot === 180) g = [-1, 0, 0, -1, cw, ch];
  else g = [0, 1, -1, 0, ch, 0];
  return [s * g[0], s * g[1], s * g[2], s * g[3], s * g[4] + tx, s * g[5] + ty];
}

/** CropBox as embedPage bounding box (pdf-lib's default ignores MediaBox offsets and the CropBox). */
export function cropBoundingBox(page) {
  const b = page.getCropBox();
  return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height };
}

/** Embed source pages for imposition: returns [{emb, rot, cw, ch, W, H}] in the order of indices (cached per index). */
export async function embedSourcePages(out, src, indices) {
  const pages = src.getPages();
  const cache = new Map();
  const res = [];
  for (const i of indices) {
    if (!cache.has(i)) {
      const p = pages[i];
      const f = frame(p);
      const emb = await out.embedPage(p, cropBoundingBox(p));
      cache.set(i, { emb, rot: f.rot, cw: f.box.width, ch: f.box.height, W: f.W, H: f.H });
    }
    res.push(cache.get(i));
  }
  return res;
}

/** Draw an embedded page (from embedSourcePages) upright into a rect on an output page (rotation 0 page). */
export function drawEmbedded(page, PDFLib, item, s, tx, ty, { opacity = null, clip = null } = {}) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib;
  const name = page.node.newXObject('FaLePg', item.emb.ref);
  const ops = [pushGraphicsState()];
  if (clip) ops.push(...clipOps(PDFLib, clip));
  if (opacity != null && opacity < 1) {
    const gs = page.doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity });
    ops.push(PDFLib.setGraphicsState(page.node.newExtGState('GS', gs)));
  }
  ops.push(concatTransformationMatrix(...placeMatrix(item.rot, item.cw, item.ch, s, tx, ty)), drawObject(name), popGraphicsState());
  page.pushOperators(...ops);
}

export function clipOps(PDFLib, { x, y, width, height }) {
  const { PDFOperator, PDFNumber } = PDFLib;
  const n = v => PDFNumber.of(Math.round(v * 1000) / 1000);
  return [PDFOperator.of('re', [n(x), n(y), n(width), n(height)]), PDFOperator.of('W'), PDFOperator.of('n')];
}

// ---------------------------------------------------------------- colours, fonts, text
export function hexColor(PDFLib, hex, fallback = '#000000') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')) || /^#?([0-9a-f]{6})$/i.exec(fallback);
  const v = parseInt(m[1], 16);
  return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

export const FONT_CHOICES = [
  { value: 'sans', label: { de: 'Serifenlos', en: 'Sans serif' } },
  { value: 'sans-bold', label: { de: 'Serifenlos fett', en: 'Sans serif bold' } },
  { value: 'serif', label: { de: 'Mit Serifen', en: 'Serif' } },
  { value: 'serif-bold', label: { de: 'Mit Serifen, fett', en: 'Serif bold' } },
  { value: 'mono', label: { de: 'Schreibmaschine', en: 'Typewriter' } },
];
const STD = {
  sans: 'Helvetica', 'sans-bold': 'HelveticaBold', 'sans-italic': 'HelveticaOblique', 'sans-bold-italic': 'HelveticaBoldOblique',
  serif: 'TimesRoman', 'serif-bold': 'TimesRomanBold', 'serif-italic': 'TimesRomanItalic', 'serif-bold-italic': 'TimesRomanBoldItalic',
  mono: 'Courier', 'mono-bold': 'CourierBold', 'mono-italic': 'CourierOblique', 'mono-bold-italic': 'CourierBoldOblique',
};
/** CSS font stack that matches a standard font key (for on-screen previews). */
export const FONT_CSS = {
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/** Per-document font cache: fonts(doc, PDFLib)('sans-bold') → PDFFont */
export function fontCache(doc, PDFLib) {
  const cache = new Map();
  return async key => {
    const k = STD[key] ? key : 'sans';
    if (!cache.has(k)) cache.set(k, await doc.embedFont(PDFLib.StandardFonts[STD[k]]));
    return cache.get(k);
  };
}

// WinAnsi (CP1252) = Latin-1 + these extras in 0x80–0x9F
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const EXTRA = new Set(CP1252_EXTRA);
const SUBST = {
  'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't', 'Ŧ': 'T', 'ŋ': 'n', 'ĸ': 'k', 'ſ': 's',
  '‐': '-', '‑': '-', '‒': '–', '―': '—', '−': '-', '′': "'", '″': '"', '‹': '‹', '‛': "'", '‟': '"',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '',
  '✓': '', '✔': '', '✗': '', '✘': '', // never reached for drawn marks, but keep text clean
  '\t': '    ',
};
export function isWinAnsi(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.has(ch);
}

/**
 * Make text drawable with a standard font. Returns {text, lost} – lost: Map original char → replacement.
 * Newlines are kept.
 */
export function winAnsi(input) {
  let text = '';
  const lost = new Map();
  for (const ch of String(input ?? '').normalize('NFC')) {
    if (ch === '\n' || isWinAnsi(ch)) { text += ch; continue; }
    if (ch === '\r') continue;
    let rep;
    if (ch in SUBST) rep = SUBST[ch];
    else {
      const base = ch.normalize('NFD').replace(/\p{M}+/gu, '');
      rep = base && [...base].every(isWinAnsi) ? base : '?';
    }
    text += rep;
    if (!(ch in SUBST) || (rep !== ' ' && rep !== '' && !/^[-–—'"]$/.test(rep))) lost.set(ch, rep || '∅');
  }
  return { text, lost };
}

/** Merge "lost" maps and build a user-facing warning ({de, en}) – null if nothing was replaced. */
export function lostWarning(...maps) {
  const all = new Map();
  for (const m of maps) for (const [k, v] of m || []) all.set(k, v);
  if (!all.size) return null;
  const list = [...all].slice(0, 12).map(([k, v]) => `${k} → ${v}`).join(', ') + (all.size > 12 ? ' …' : '');
  return {
    de: `Die eingebauten PDF-Schriften kennen nur westeuropäische Zeichen. Ersetzt: ${list}.`,
    en: `The built-in PDF fonts only cover Western European characters. Replaced: ${list}.`,
  };
}

export function roman(n, upper = true) {
  if (!(n > 0 && n < 4000)) return String(n);
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return upper ? s.toUpperCase() : s;
}

/** Page selection helper: 'all' | 'odd' | 'even' | 'range' (+ text) → Set of 0-based indices. */
export function selectPages(mode, text, count, parse) {
  const all = Array.from({ length: count }, (_, i) => i);
  if (mode === 'odd') return new Set(all.filter(i => i % 2 === 0));
  if (mode === 'even') return new Set(all.filter(i => i % 2 === 1));
  if (mode === 'range' && String(text || '').trim()) return new Set(parse(text, count));
  return new Set(all);
}

/** Copy one page of a (cached) source document into a fresh one-page document (for exact previews). */
export async function onePageDoc(PDFLib, src, index) {
  const d = await PDFLib.PDFDocument.create();
  const [p] = await d.copyPages(src, [index]);
  d.addPage(p);
  return d;
}

/** Save a preview document quickly (no object streams). */
export const savePreview = doc => doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });

/** Lang of the page (tool modules are loaded by a page of one language). */
export const pageLang = () => (typeof document !== 'undefined' && /^en/i.test(document.documentElement.lang || '') ? 'en' : 'de');

/** Load the edit tools' stylesheet once (CSP style-src 'self': a <link>, no inline styles). */
let cssLoaded = false;
export function loadEditCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./edit-ui.css', import.meta.url).href;
  document.head.append(link);
}

/** Throw a user-facing error. */
export function userError(de, en) { return Object.assign(new Error(en), { userMessage: { de, en } }); }

/** Save a result; a password-protected source keeps its (user) password. */
export async function saveResult(doc, ctx, { title = null } = {}) {
  const pw = doc.wtPassword || null;
  if (pw) {
    ctx.note({ de: 'Der Passwortschutz bleibt erhalten – es gilt dasselbe Passwort wie vorher.', en: 'Password protection is kept – the password is the same as before.' });
    return saveEncrypted(doc, pw, { title });
  }
  return saveDoc(doc, { title });
}

/** Cached pdf-lib copy of an input for previews (one per input; parsing a big PDF once is enough). */
export function previewSource() {
  let id = null, doc = null;
  return async input => {
    if (id !== input.id || !doc) { id = input.id; doc = null; doc = await input.pdfDoc(); }
    return doc;
  };
}

/**
 * Draw text or an embedded image (from imgembed.embedImage) centred at (cx, cy), rotated by `angle`
 * degrees (counter-clockwise). item: {text, font, size, color} | {img: {image, width, height, orientation}, w, h}
 */
export function drawCentered(page, PDFLib, item, cx, cy, angle, opacity = 1) {
  const { degrees } = PDFLib;
  const op = opacity < 1 ? opacity : undefined;
  const start = (a, hw, hh) => {
    const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [cx - hw * c + hh * s, cy - hw * s - hh * c];
  };
  if (item.text != null) {
    const tw = item.font.widthOfTextAtSize(item.text, item.size);
    const th = item.font.heightAtSize(item.size, { descender: false });
    const [x, y] = start(angle, tw / 2, th / 2);
    page.drawText(item.text, { x, y, size: item.size, font: item.font, color: item.color, opacity: op, rotate: degrees(angle) });
  } else {
    const o = item.img.orientation || 1;
    const extra = o === 6 ? -90 : o === 8 ? 90 : o === 3 ? 180 : 0;
    const swap = o === 6 || o === 8;
    const w = swap ? item.h : item.w, h = swap ? item.w : item.h;
    const a = angle + extra;
    const [x, y] = start(a, w / 2, h / 2);
    page.drawImage(item.img.image, { x, y, width: w, height: h, opacity: op, rotate: degrees(a) });
  }
}

/** Size of an item's rotated bounding box. */
export function rotatedBox(w, h, angle) {
  const r = angle * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return [w * c + h * s, w * s + h * c];
}
