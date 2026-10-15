// Text helpers for PDF output with pdf-lib: standard fonts (WinAnsi: umlauts, ß, €, „“ … work) and, for text
// beyond that (Polish, Czech, Turkish, Greek, Cyrillic …), Liberation Sans as an embedded Unicode subset
// (./unifont.js). fontKit(...).pick(text, family, b, i) chooses; safeText(text, font) makes it drawable.
import { loadPdfLib } from '../pdflib.js';
import { uniFont, needsUnicode, styleKey } from './unifont.js';

export { needsUnicode };

/** Does any string in a (model) object need the Unicode font? Data URLs are skipped. */
export function needsUnicodeDeep(obj, seen = new Set()) {
  if (typeof obj === 'string') return !obj.startsWith('data:') && needsUnicode(obj);
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return false;
  seen.add(obj);
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return false;
  const vals = Array.isArray(obj) ? obj : obj instanceof Map || obj instanceof Set ? [...obj.values()] : Object.values(obj);
  for (const v of vals) if (needsUnicodeDeep(v, seen)) return true;
  return false;
}

/**
 * Text for drawing with `font`: standard fonts get winAnsi(); the Unicode font keeps every character it has
 * and maps the rest like winAnsi does (arrows/ticks to ASCII, emoji dropped, otherwise '?').
 */
export function safeText(str, font) {
  if (!font || !font.isUnicode) return winAnsi(str);
  const cmap = font.embedder.uniTtf.cmap;
  const has = ch => cmap.has(ch.codePointAt(0));
  let out = '';
  for (const ch of String(str ?? '').normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (ch === '\t') { out += '    '; continue; }
    if (c < 0x20 || c === 0xad || (c >= 0x200b && c <= 0x200f) || c === 0xfeff || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    if (c >= 0x2000 && c <= 0x200a) { out += ' '; continue; }
    if (has(ch)) { out += ch; continue; }
    if (FALLBACK[ch] != null && [...FALLBACK[ch]].every(has)) { out += FALLBACK[ch]; continue; }
    if (/\p{Extended_Pictographic}/u.test(ch) || /\p{M}/u.test(ch)) continue;
    out += '?';
  }
  return out;
}

// Characters WinAnsiEncoding can represent beyond Latin-1.
const WIN_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const WIN_SET = new Set(WIN_EXTRA);
const FALLBACK = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '∞': 'unendlich', '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '-',
  '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '☐': '[ ]', '☑': '[x]', '☒': '[x]', '◦': '•', '▪': '•', '■': '•', '●': '•', '○': 'o', '◆': '•', '►': '>', '▶': '>',
  '★': '*', '☆': '*', '′': "'", '″': '"', '‹': '‹', '›': '›', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '­': '',
  '€': '€', 'ł': 'l', 'Ł': 'L', 'ő': 'ö', 'ű': 'ü', 'ș': 's', 'ț': 't', 'ă': 'a', 'č': 'c', 'ć': 'c', 'ę': 'e', 'ą': 'a', 'ń': 'n', 'ś': 's', 'ź': 'z', 'ż': 'z', 'ř': 'r', 'ě': 'e', 'ů': 'u', 'ğ': 'g', 'ı': 'i', 'İ': 'I', 'ş': 's',
};

export function winAnsi(str) {
  const s = String(str ?? '').normalize('NFC');
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_SET.has(ch)) { out += ch === ' ' ? ' ' : ch; continue; }
    if (ch === '\t') { out += '    '; continue; }
    if (c < 0x20) continue;
    if (FALLBACK[ch] != null) { out += FALLBACK[ch]; continue; }
    // strip accents for other Latin letters
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    if (base && base !== ch && [...base].every(b => b.codePointAt(0) < 0x250)) { out += winAnsi(base); continue; }
    if (/\p{Extended_Pictographic}/u.test(ch) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0x200d) continue;
    out += '?';
  }
  return out;
}

/** Lazily embedded standard font family. family: 'sans' | 'serif' | 'mono'. */
export async function fontKit(pdfDoc) {
  const PDFLib = await loadPdfLib();
  const SF = PDFLib.StandardFonts;
  const NAMES = {
    sans: [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique, SF.HelveticaBoldOblique],
    serif: [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic, SF.TimesRomanBoldItalic],
    mono: [SF.Courier, SF.CourierBold, SF.CourierOblique, SF.CourierBoldOblique],
  };
  const cache = new Map();
  const get = async (family = 'sans', b = false, i = false) => {
    const key = `${family}${b ? 'b' : ''}${i ? 'i' : ''}`;
    if (!cache.has(key)) cache.set(key, await pdfDoc.embedFont(NAMES[family][(b ? 1 : 0) + (i ? 2 : 0)]));
    return cache.get(key);
  };
  // preload the common sans faces so layout can be synchronous
  await Promise.all([get('sans'), get('sans', true), get('sans', false, true), get('sans', true, true)]);
  const uni = new Map(); // styleKey → Unicode PDFFont (only after ensureUnicode)
  const sync = (family, b, i) => cache.get(`${family}${b ? 'b' : ''}${i ? 'i' : ''}`) || cache.get('sans');
  return {
    PDFLib,
    get,
    sync,
    async ensure(family) { await Promise.all([get(family), get(family, true), get(family, false, true), get(family, true, true)]); },
    /** Load the four Unicode faces (embedded only if text is drawn with them). False if they are unavailable. */
    async ensureUnicode() {
      try {
        for (const [b, i] of [[false, false], [true, false], [false, true], [true, true]]) if (!uni.has(styleKey(b, i))) uni.set(styleKey(b, i), await uniFont(pdfDoc, { bold: b, italic: i, PDFLib }));
        return true;
      } catch (e) { console.warn('Unicode-Schrift nicht verfügbar', e); return false; }
    },
    /** Standard font when it can show `text`, otherwise the Unicode face (serif/mono text then in sans). */
    pick(text, family = 'sans', b = false, i = false) {
      if (uni.size && needsUnicode(text)) return uni.get(styleKey(!!b, !!i)) || uni.get('r');
      return sync(family, b, i);
    },
  };
}

export function rgbOf(PDFLib, hexColor, fallback = [0, 0, 0]) {
  if (!hexColor) return PDFLib.rgb(...fallback);
  const h = hexColor.replace('#', '');
  return PDFLib.rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** Simple word wrap for a single font/size. Returns lines. */
export function wrapPlain(text, font, size, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (font.widthOfTextAtSize(test, size) <= maxW || !line.trim()) {
        if (font.widthOfTextAtSize(test, size) > maxW && !line.trim()) {
          // break a very long word
          let part = '';
          for (const ch of w) {
            if (font.widthOfTextAtSize(part + ch, size) > maxW && part) { lines.push(part); part = ''; }
            part += ch;
          }
          line = part;
        } else line = test;
      } else {
        lines.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** Add a clickable URI link annotation. */
export function addLink(PDFLib, pdfDoc, page, rect, url) {
  try {
    const ctx = pdfDoc.context;
    const annot = ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFLib.PDFString.of(url) },
    });
    page.node.addAnnot(ctx.register(annot));
  } catch (e) { console.warn('link', e); }
}
