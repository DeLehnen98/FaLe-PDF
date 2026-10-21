// „Brief per Post“: the PDF that goes to the print service.
//   - an address sheet first: return line + recipient address in the window field of a DIN-lang window envelope
//     (DIN 5008 form B: field 20 mm from the left, 45 mm from the top, 85 × 45 mm; address zone below a 17.7 mm note
//     zone), Helvetica 11 pt, no bold – as print services read it
//   - then every page of the letter on A4 portrait (other sizes are scaled to fit, landscape is turned)
//   - saved WITHOUT object streams so the server can count the pages
import { loadPdfLib, loadEditable } from '../pdflib.js';

const MM = 72 / 25.4;
// scripts neither Helvetica nor Liberation Sans can print (addresses must be in Latin letters anyway)
const UNPRINTABLE = /[^\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}\p{P}\p{Zs}\p{Sc}\p{Sm}\p{Sk}\p{M}]/u;
const A4 = [595.28, 841.89];

/** Recipient lines as print services want them (abroad: city + country in capitals as the last lines). */
export function addressLines(a) {
  const intl = isAbroad(a.country);
  const city = [a.plz, a.ort].filter(Boolean).join(' ').trim();
  const lines = [a.name, a.zusatz, a.strasse, intl ? city.toUpperCase() : city];
  if (intl) lines.push((ISO.test(String(a.country).trim()) ? countryName(String(a.country).trim(), 'de') : String(a.country).trim()).toUpperCase());
  return lines.map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// ISO 3166-1 countries a letter can go to (the print service sends from Germany to every country)
export const COUNTRIES = ('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ '
  + 'DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KR KW KZ '
  + 'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA '
  + 'RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS XK YE ZA ZM ZW').split(' ');
const ISO = /^[A-Z]{2}$/;
/** Country name in a language (Intl), e.g. countryName('FR', 'de') → „Frankreich“. */
export function countryName(code, lang) {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || code; } catch { return code; }
}
export function isAbroad(country) {
  if (ISO.test(String(country || '').trim())) return String(country).trim() !== 'DE';
  const c = String(country || '').trim().toLowerCase();
  return !!c && !['deutschland', 'germany', 'de', 'brd', 'allemagne', 'alemania', 'germania', 'duitsland', 'niemcy', 'almanya'].includes(c);
}
/** What is missing in an address (empty array = complete). */
export function checkAddress(a) {
  const miss = [];
  if (!String(a.name || '').trim()) miss.push('name');
  if (!String(a.strasse || '').trim()) miss.push('strasse');
  if (!String(a.plz || '').trim() || !String(a.ort || '').trim()) miss.push('ort');
  if (!isAbroad(a.country) && a.plz && !/^\d{5}$/.test(String(a.plz).trim())) miss.push('plz');
  // letters for which no font of the app has a glyph (Chinese, Arabic …) would print as „?“
  if (UNPRINTABLE.test(['name', 'zusatz', 'strasse', 'plz', 'ort', 'country'].map(k => a[k] || '').join(''))) miss.push('script');
  return miss;
}

/** Build the mail-ready PDF → { bytes, pages } (pages incl. the address sheet; `sheet: false` = fax: A4 pages only). */
export async function buildMailPdf(srcBytes, name, { to = null, from = null, date = new Date(), key = null, sheet = true }) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, rgb, degrees } = PDFLib;
  const src = await loadEditable(srcBytes, name, { key });
  const out = await PDFDocument.create();
  // Helvetica for Western European letters; Liberation Sans (embedded subset) for Polish ł, Turkish ş, Czech ř …
  // so names and places print exactly as typed (checkAddress refuses scripts no font has)
  const U = await import('../office/unifont.js');
  const allText = sheet ? [...addressLines(to), from ? [from.name, from.strasse, from.plz, from.ort].join(' ') : ''].join('\n') : '';
  const font = await U.fontForText(out, allText, { PDFLib });
  const clean = s => U.cleanText(String(s || '').normalize('NFC'), font).text;

  // ---- address sheet (letters only)
  if (sheet) addressSheet();
  function addressSheet() {
    const p = out.addPage(A4);
    const H = A4[1];
    const top = mm => H - mm * MM;
    const x = 25 * MM; // field 20 mm + 5 mm inner margin
    if (from) {
      const ret = [from.name, from.strasse, [from.plz, from.ort].filter(Boolean).join(' ')].filter(s => String(s || '').trim()).join(' · ');
      if (ret) {
        const size = 7;
        const t = clean(ret).slice(0, 90);
        p.drawText(t, { x, y: top(45 + 14.5), size, font, color: rgb(0.2, 0.2, 0.2) });
        p.drawLine({ start: { x, y: top(45 + 15.2) }, end: { x: x + Math.min(font.widthOfTextAtSize(t, size), 75 * MM), y: top(45 + 15.2) }, thickness: 0.4, color: rgb(0.35, 0.35, 0.35) });
      }
    }
    const lines = addressLines(to).slice(0, 6);
    lines.forEach((l, i) => p.drawText(clean(l).slice(0, 48), { x, y: top(45 + 17.7 + 4.2 + i * 4.6), size: 11, font, color: rgb(0, 0, 0) }));
    const d = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    p.drawText(d, { x: 125 * MM, y: top(50), size: 10, font, color: rgb(0.2, 0.2, 0.2) });
    // (German on purpose: the sheet travels with the Deutsche Post letter)
    p.drawText(`Anlage: ${src.getPageCount()} ${src.getPageCount() === 1 ? 'Seite' : 'Seiten'}`, { x: 25 * MM, y: top(110), size: 10, font, color: rgb(0.2, 0.2, 0.2) });
  }

  // ---- the letter pages on A4 portrait
  const pages = src.getPages();
  const embedded = await out.embedPages(pages);
  pages.forEach((pg, i) => {
    const e = embedded[i];
    const rot = ((pg.getRotation().angle % 360) + 360) % 360;
    let w = e.width, h = e.height;
    const turned = rot === 90 || rot === 270;
    if (turned) [w, h] = [h, w];
    const landscape = w > h * 1.02;
    const page = out.addPage(A4);
    const [PW, PH] = A4;
    // shown size after rotation; landscape pages are turned to portrait
    const bw = landscape ? h : w, bh = landscape ? w : h;
    const s = Math.min(PW / bw, PH / bh, 1.0001) > 0.98 && Math.min(PW / bw, PH / bh) < 1.02 ? 1 : Math.min(PW / bw, PH / bh);
    // pdf-lib turns counter-clockwise; /Rotate turns clockwise → undo it, then turn landscape pages a quarter
    const angle = ((360 - rot) % 360 + (landscape ? 90 : 0)) % 360;
    const dw = bw * s, dh = bh * s;
    const ox = (PW - dw) / 2, oy = (PH - dh) / 2;
    // place the embedded page (un-rotated size e.width × e.height) so that it ends up upright inside the box
    const ew = e.width * s, eh = e.height * s;
    let px = ox, py = oy;
    if (angle === 90) { px = ox + dw; py = oy; }
    else if (angle === 180) { px = ox + dw; py = oy + dh; }
    else if (angle === 270) { px = ox; py = oy + dh; }
    page.drawPage(e, { x: px, y: py, width: ew, height: eh, rotate: degrees(angle) });
  });
  // copying pages can leave an unused copy of the original page (incl. form values) in the file – drop it
  // (after flush(): the embedded pages are written, so the copies they were made from are no longer needed)
  await out.flush();
  try { (await import('../tools/redact.js')).collectGarbage(PDFLib, out.context); } catch (e) { console.warn('cleanup', e); }
  out.setTitle(name.replace(/\.pdf$/i, ''));
  out.setProducer('FaLe PDF');
  const bytes = await out.save({ useObjectStreams: false });
  return { bytes, pages: out.getPageCount() };
}

/** The PDF that is faxed: every page on A4 portrait, nothing added → { bytes, pages }. */
export const buildFaxPdf = (srcBytes, name, { key = null } = {}) => buildMailPdf(srcBytes, name, { sheet: false, key });
