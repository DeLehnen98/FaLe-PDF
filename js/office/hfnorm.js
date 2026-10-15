// Kopf- und Fußzeilen der Textverarbeitung: ein Datenmodell für Editor, Seitenansicht, PDF und .docx.
//
// hf (alles optional):
//   Einfach (ältere Dateien, Seite einrichten): { header, headerAlign, footer, footerAlign, pageNumbers: 'none'|'footer-center'|…,
//            pageFormat: 'n'|'n-of-m', firstPage: false (= nichts auf Seite 1) }
//   Erweitert: { zones: { h: [links, mitte, rechts], f: [l, m, r] },          Standard (bzw. ungerade Seiten)
//                first: { h: [...], f: [...] } | undefined,                    erste Seite anders (leere Felder = nichts)
//                even:  { h: [...], f: [...] } | undefined,                    gerade Seiten anders
//                pnStart: 1, pnStyle: '1'|'i'|'I'|'a'|'A' }
//   Beide: watermark: { text, color, opacity } | undefined
// Feldplatzhalter im Text: {SEITE} {SEITEN} {DATUM} {TITEL}
// Reine Funktionen ohne DOM – auch in Node nutzbar.

export const HF_FIELDS = [['{SEITE}', 'Seitenzahl'], ['{SEITEN}', 'Seitenanzahl'], ['{DATUM}', 'Datum'], ['{TITEL}', 'Titel']];
const EMPTY = ['', '', ''];
const ZI = { left: 0, center: 1, right: 2 };

/** Is anything (text, page numbers, watermark) configured? */
export function hfHas(hf) {
  if (!hf) return false;
  if (hf.watermark && hf.watermark.text) return true;
  if (hf.zones) return [hf.zones, hf.first, hf.even].some(z => z && [...(z.h || []), ...(z.f || [])].some(Boolean));
  return !!(hf.header || hf.footer || (hf.pageNumbers && hf.pageNumbers !== 'none'));
}
export const isAdvanced = hf => !!(hf && hf.zones);

/** Zones [l, c, r] of the standard header ('h') or footer ('f'), converting the simple format. */
function baseZones(hf, where) {
  if (!hf) return EMPTY.slice();
  if (hf.zones) return [...(hf.zones[where] || EMPTY), '', '', ''].slice(0, 3);
  const z = EMPTY.slice();
  const key = where === 'h' ? 'header' : 'footer';
  const text = hf[key] || '';
  const align = hf[`${key}Align`] || 'left';
  if (text) z[ZI[align] ?? 0] = text;
  const pn = hf.pageNumbers || 'none';
  if (pn.startsWith(where === 'h' ? 'header' : 'footer')) {
    const a = ZI[pn.split('-')[1]] ?? 1;
    const label = hf.pageFormat === 'n-of-m' ? 'Seite {SEITE} von {SEITEN}' : '{SEITE}';
    z[a] = z[a] ? `${z[a]} · ${label}` : label;
  }
  return z;
}

/** Which header set a page uses: 'first' | 'even' | 'odd'. i = 0-based page index. */
export function pageKind(hf, i) {
  if (i === 0 && hf && ((hf.zones && hf.first) || hf.firstPage === false)) return 'first';
  if (hf && hf.zones && hf.even && (i + 1) % 2 === 0) return 'even';
  return 'odd';
}

/** Zones for page index i (0-based). */
export function zonesFor(hf, i, where, kindOverride = null) {
  const kind = kindOverride || pageKind(hf, i);
  if (kind === 'first') {
    if (!hf.zones) return EMPTY.slice(); // simple format: nothing on the title page
    return [...(hf.first[where] || EMPTY), '', '', ''].slice(0, 3);
  }
  if (kind === 'even') return [...(hf.even[where] || EMPTY), '', '', ''].slice(0, 3);
  return baseZones(hf, where);
}

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
export function pageLabel(n, style = '1') {
  if (style === 'i' || style === 'I') { let s = '', k = Math.max(1, n); for (const [v, r] of ROMAN) while (k >= v) { s += r; k -= v; } return style === 'I' ? s.toUpperCase() : s; }
  if (style === 'a' || style === 'A') { let s = '', k = Math.max(1, n); while (k > 0) { k--; s = String.fromCharCode(97 + (k % 26)) + s; k = Math.floor(k / 26); } return style === 'A' ? s.toUpperCase() : s; }
  return String(n);
}
/** Displayed page number of page index i. */
export function pageNumberOf(hf, i) {
  const start = hf && Number.isFinite(+hf.pnStart) && hf.pnStart !== '' && hf.pnStart != null ? +hf.pnStart : 1;
  return pageLabel(i + start, (hf && hf.pnStyle) || '1');
}

/** Replace field placeholders. ctx: { i (0-based page), pages, title, date } */
export function fillFields(text, hf, ctx) {
  if (!text) return '';
  const date = ctx.date || new Date();
  return String(text)
    .replace(/\{SEITE\}/g, pageNumberOf(hf, ctx.i || 0))
    .replace(/\{SEITEN\}/g, ctx.pages == null ? 'N' : String(ctx.pages))
    .replace(/\{DATUM\}/g, date.toLocaleDateString('de-DE'))
    .replace(/\{TITEL\}/g, ctx.title || '');
}

/** Ready-to-draw zones for page index i: [l, c, r] strings (fields filled). */
export function hfTexts(hf, i, where, ctx, kindOverride = null) {
  return zonesFor(hf, i, where, kindOverride).map(t => fillFields(t, hf, { ...ctx, i }));
}

/**
 * Simple format → advanced format (used when the advanced dialog saves). The watermark is kept.
 */
export function toAdvanced(hf) {
  if (!hf) return { zones: { h: EMPTY.slice(), f: EMPTY.slice() }, pnStart: 1, pnStyle: '1' };
  if (hf.zones) return JSON.parse(JSON.stringify(hf));
  const out = { zones: { h: baseZones(hf, 'h'), f: baseZones(hf, 'f') }, pnStart: 1, pnStyle: '1' };
  if (hf.firstPage === false) out.first = { h: EMPTY.slice(), f: EMPTY.slice() };
  if (hf.watermark) out.watermark = { ...hf.watermark };
  return out;
}

/**
 * Advanced → simple when nothing is lost (one text + optional page number per header/footer, standard numbering,
 * no different first/even pages except "nothing on page 1"). Returns null when not representable.
 */
export function toSimple(hf) {
  if (!hf || !hf.zones) return hf || null;
  if (hf.even || (hf.pnStyle && hf.pnStyle !== '1') || (hf.pnStart != null && +hf.pnStart !== 1)) return null;
  if (hf.first && [...hf.first.h, ...hf.first.f].some(Boolean)) return null;
  const out = { header: '', headerAlign: 'left', footer: '', footerAlign: 'left', pageNumbers: 'none', pageFormat: 'n' };
  const NAMES = ['left', 'center', 'right'];
  for (const [where, key] of [['h', 'header'], ['f', 'footer']]) {
    const z = hf.zones[where] || EMPTY;
    for (let k = 0; k < 3; k++) {
      let t = z[k] || '';
      if (!t) continue;
      const m = /^(.*?)(?:\s*·\s*)?(Seite \{SEITE\} von \{SEITEN\}|\{SEITE\})$/.exec(t);
      if (m) {
        if (out.pageNumbers !== 'none') return null;
        out.pageNumbers = `${key}-${NAMES[k]}`;
        out.pageFormat = m[2] === '{SEITE}' ? 'n' : 'n-of-m';
        t = m[1];
        if (!t) continue;
      }
      if (/\{(SEITE|SEITEN|DATUM|TITEL)\}/.test(t) || out[key]) return null;
      out[key] = t; out[`${key}Align`] = NAMES[k];
    }
  }
  if (hf.first) out.firstPage = false;
  if (hf.watermark) out.watermark = { ...hf.watermark };
  return out;
}

/** Text pieces of a field string for writers that build real fields: [{text} | {field: 'PAGE'|'NUMPAGES'|'DATE'|'TITLE'}] */
export function fieldParts(text) {
  const out = [];
  const re = /\{(SEITE|SEITEN|DATUM|TITEL)\}/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ field: { SEITE: 'PAGE', SEITEN: 'NUMPAGES', DATUM: 'DATE', TITEL: 'TITLE' }[m[1]] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
