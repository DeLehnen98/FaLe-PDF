// Smart file names for scans – on the device, from the recognised text (no cloud):
//   "Rechnung Stadtwerke Saarbrücken Okt 2026", "Mahnung Telekom Sep 2026", "Kontoauszug Sparkasse Okt 2026"
// Letters the analysis does not recognise (other languages, notes, forms …) get their title line instead,
// e.g. "Invoice Acme Okt 2026" or "Anmeldung zum Schwimmkurs Okt 2026". Nothing usable → null (keep "Scan <date>").
import { t, locale } from '../i18n/index.js';

const BAD = /[\\/:*?"<>|\u0000-\u001f]+/g;
const MAX = 80;

const letters = s => (String(s).match(/\p{L}/gu) || []).length;
// small words a shortened name must not end with ("Akademie für", "Finanzamt Saarbrücken Am")
const TAIL = /\s+(?:für|und|der|die|das|des|dem|den|am|im|an|in|zu|zum|zur|von|vom|bei|mit|auf|of|and|the|for|at|on|de|du|la|le|et|y|e|di|del|van|der)$/i;
const clip = (s, n) => {
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length > n) {
    const cut = s.slice(0, n + 1);
    const sp = cut.lastIndexOf(' ');
    s = sp > 0 ? cut.slice(0, sp) : s.slice(0, n); // whole words only (a single long word is cut)
  }
  for (let i = 0; i < 3 && TAIL.test(s); i++) s = s.replace(TAIL, '');
  return s.replace(/[\s,;:.\-–/&]+$/, '');
};
// "RECHNUNG" / "INVOICE NO." → "Rechnung" / "Invoice No." (scripts without case stay as they are)
const unshout = s => {
  const l = letters(s);
  if (l < 4 || s !== s.toLocaleUpperCase() || s === s.toLocaleLowerCase()) return s;
  return s.toLocaleLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
};
// a line that reads like a heading: mostly letters, not an address / date / number line, not a greeting
const USELESS = /^(?:seite|page|blatt|datum|date|tel|fax|e-?mail|www\.|http|iban|bic|kundennummer|sehr geehrte|dear|hallo|guten tag|betreff|subject|herrn?|frau|mr\.?|mrs\.?|ms\.?)\b/i;
function headingOk(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 90) return false;
  const l = letters(s);
  if (l < 3 || l / s.replace(/\s/g, '').length < 0.6) return false;
  if (USELESS.test(s)) return false;
  if (/\b\d{5}\b/.test(s) && /\b(?:str(?:aße|\.)?|weg|platz|allee|gasse|street|road|ave)\b/i.test(s)) return false; // address
  return true;
}

function monthYear(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '');
  const d = m ? new Date(+m[1], +m[2] - 1, 1) : new Date();
  try { return new Intl.DateTimeFormat(locale(), { month: 'short', year: 'numeric' }).format(d).replace(/\.(?=\s|$)/g, ''); }
  catch { return `${m ? m[2] : d.getMonth() + 1}-${m ? m[1] : d.getFullYear()}`; }
}

const LABEL = {
  arzt: txt => (/krankenkasse|krankenversicherung|\baok\b|barmer|techniker|\bdak\b|\bikk\b|\bbkk\b|knappschaft/i.test(txt) ? 'Krankenkasse' : 'Arztbrief'),
};

/** The biggest text line in the upper part of the page (from the OCR lines) – usually the title. */
function titleLine(ocr) {
  const lines = (ocr && ocr.lines) || [];
  if (!lines.length) return null;
  const H = ocr.height || Math.max(...lines.map(l => (l.bbox ? l.bbox.y1 : 0)), 1);
  const sizes = lines.map(l => l.size || 0).filter(Boolean).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  let best = null;
  for (const l of lines) {
    if (!l.bbox || l.bbox.y0 > H * 0.55) continue;
    if (l.conf != null && l.conf < 55) continue;
    const txt = (l.text || '').trim();
    if (!headingOk(txt)) continue;
    const score = (l.size || 0) * (1 - (l.bbox.y0 / H) * 0.35);
    if (!best || score > best.score) best = { txt, score, size: l.size || 0 };
  }
  // only a real heading (clearly bigger than the body text) – otherwise the first line would just be a random address line
  return best && (!median || best.size >= median * 1.25) ? best.txt : null;
}

/**
 * @param {{text: string, lines?: object[], height?: number}} ocr  result of ocr/engine.recognize (first page)
 * @returns {Promise<string|null>}
 */
export async function suggestScanName(ocr) {
  const text = String((ocr && ocr.text) || '');
  if (text.replace(/\s/g, '').length < 15) return null;
  let r = null;
  try { r = (await import('../smart/extract.js')).extractLetter(text); } catch (e) { console.warn('smartname', e); }
  const parts = [];
  const sender = senderName(r);
  if (r && r.type !== 'sonstiges' && r.confidence >= 0.5) {
    const sub = r.subtype && r.subtype !== 'behoerde' ? ({
      steuer: 'Steuerbescheid', kuendigungsbestaetigung: 'Kündigungsbestätigung', vertragsbestaetigung: 'Vertragsbestätigung',
      kassenbon: 'Kassenbon', handwerker: 'Handwerkerrechnung', spendenquittung: 'Spendenquittung', inkasso: 'Inkasso', arzt: 'Arztrechnung',
      nebenkosten: 'Nebenkostenabrechnung', energie: 'Energieabrechnung',
    })[r.subtype] : null;
    const label = sub || (LABEL[r.type] ? LABEL[r.type](text) : r.typeLabel);
    parts.push(t(label));
    if (sender && sender.toLocaleLowerCase() !== label.toLocaleLowerCase()) parts.push(sender);
  } else {
    let title = r && r.subject && headingOk(r.subject) ? r.subject : titleLine(ocr);
    if (title) parts.push(clip(unshout(title.replace(/^(?:betreff|betr\.|subject|re)\s*:\s*/i, '')), 48));
    else if (sender) parts.push(sender); // e.g. a receipt from a shop: "Rosen-Apotheke Okt 2026"
    else return null;
  }
  parts.push(monthYear(r && r.date));
  const name = clip(parts.join(' ').replace(BAD, ' ').replace(/\s{2,}/g, ' '), MAX);
  return letters(name) >= 3 ? name : null;
}

function senderName(r) {
  let s = r && r.sender && r.sender.name ? String(r.sender.name) : '';
  s = s.replace(/(?<![\p{L}])(GmbH(?:\s*&\s*Co\.?\s*KG)?|mbH|AG|SE|KG|KGaA|OHG|oHG|VVaG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|e\.\s?V\.|e\.\s?K\.|eG|Ltd\.?|Inc\.?|LLC|S\.A\.|B\.V\.)(?![\p{L}])/gu, '')
    .replace(BAD, ' ').replace(/\s{2,}/g, ' ').replace(/[\s,;:.\-–]+$/, '').trim();
  return s && headingOk(s) ? clip(unshout(s), 34) : '';
}
