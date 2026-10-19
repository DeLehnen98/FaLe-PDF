// Briefkasten-Assistent: regelbasiertes Verstehen deutscher Briefe, Rechnungen und Kassenbons.
// Läuft komplett auf dem Gerät (kein Netzwerk, keine Abhängigkeiten, auch in Node testbar).
//
// Eingabe: Text (Zeilen mit \n, Spalten mit \t – so liefern ihn js/smart/textsrc.js aus PDF-Textebene
// oder OCR). Ausgabe: Dokumenttyp mit Sicherheit, Absender, Empfänger, Datum, Nummern (Kunden-,
// Rechnungs-, Vertragsnummer, Aktenzeichen, Steuernummer), Beträge, IBAN (Prüfsumme), BIC,
// Verwendungszweck, Fristen (auch berechnet), Kontakt, Vertragsdaten – plus Kassenbon-Felder
// (Händler, Brutto/Netto/MwSt, Zahlungsart, Arbeitskosten nach § 35a EStG) für die Steuer-Belege.
//
// Keine Rechts- oder Steuerberatung: berechnete Fristen sind Hinweise und werden als solche markiert.

// ------------------------------------------------------------------ dates
const MONTHS = {
  januar: 1, jan: 1, jänner: 1, februar: 2, feb: 2, märz: 3, maerz: 3, marz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10,
  november: 11, nov: 11, dezember: 12, dez: 12,
};
const MONTH_RE = '(januar|jänner|jan|februar|feb|märz|maerz|marz|mär|mrz|april|apr|mai|juni|jun|juli|jul|august|aug|september|sept|sep|oktober|okt|november|nov|dezember|dez)';
const pad = n => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export function toDate(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
export function isoDate(dt) { return isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
export function deDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
function validYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2099) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d;
}
function year4(y) { y = +y; if (y < 100) y += y >= 70 ? 1900 : 2000; return y; }

/** All dates in a string: [{iso, index, end, raw}] (numeric, written-out month names, ISO). */
export function findDates(s) {
  const out = [];
  const str = String(s || '');
  const push = (y, mo, d, index, raw) => { if (validYmd(y, mo, d)) out.push({ iso: isoOf(y, mo, d), index, end: index + raw.length, raw }); };
  let m;
  const num = /(?<![\d.,])(\d{1,2})\s?[.](\s?)(\d{1,2})\s?[.]\s?((?:19|20)\d{2}|\d{2})(?!\d|,\d|\.\d)/g;
  while ((m = num.exec(str))) push(year4(m[4]), +m[3], +m[1], m.index, m[0]);
  const txt = new RegExp(`(?<![\\d])(\\d{1,2})\\.?\\s*${MONTH_RE}\\.?\\s+((?:19|20)\\d{2})(?!\\d)`, 'giu');
  while ((m = txt.exec(str))) push(+m[3], MONTHS[m[2].toLowerCase()], +m[1], m.index, m[0]);
  const isoRe = /(?<!\d)((?:19|20)\d{2})-(\d{2})-(\d{2})(?!\d)/g;
  while ((m = isoRe.exec(str))) push(+m[1], +m[2], +m[3], m.index, m[0]);
  const slash = /(?<![\d/])(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})(?![\d/])/g;
  while ((m = slash.exec(str))) push(+m[3], +m[2], +m[1], m.index, m[0]);
  return out.sort((a, b) => a.index - b.index);
}
export function parseDate(s) { const d = findDates(s); return d.length ? d[0].iso : null; }

export function addDays(iso, n) { const d = toDate(iso); d.setDate(d.getDate() + n); return isoDate(d); }
/** Add calendar months; a day that does not exist moves to the month's last day (§ 188 Abs. 3 BGB). */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoOf(first.getFullYear(), first.getMonth() + 1, Math.min(d, last));
}
export function endOfMonth(iso) { const d = toDate(iso); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoOf(y, month, day);
}
const holidayCache = new Map();
/** Bundesweite gesetzliche Feiertage (ohne landesspezifische). */
export function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easter(y);
  const set = new Set([isoOf(y, 1, 1), addDays(e, -2), addDays(e, 1), isoOf(y, 5, 1), addDays(e, 39), addDays(e, 50), isoOf(y, 10, 3), isoOf(y, 12, 25), isoOf(y, 12, 26)]);
  holidayCache.set(y, set);
  return set;
}
export function isWorkday(iso) { const wd = toDate(iso).getDay(); return wd !== 0 && wd !== 6 && !holidays(+iso.slice(0, 4)).has(iso); }
/** Fristende an Samstag, Sonntag oder Feiertag → nächster Werktag (§ 193 BGB, § 108 Abs. 3 AO, § 31 Abs. 3 VwVfG). */
export function nextWorkday(iso) { let d = iso; for (let i = 0; i < 10 && !isWorkday(d); i++) d = addDays(d, 1); return d; }

/**
 * Widerspruchs-/Einspruchsfrist „ein Monat nach Bekanntgabe“ eines per Post versandten Bescheids.
 * Bekanntgabefiktion: bis Ende 2024 galt der Bescheid am 3. Tag nach Aufgabe zur Post als bekanntgegeben
 * (3-Tage-Fiktion), seit 1.1.2025 am 4. Tag (Postrechtsmodernisierungsgesetz). Fällt der Fiktionstag oder
 * das Fristende auf ein Wochenende/einen Feiertag, verschiebt es sich auf den nächsten Werktag.
 */
// whole sentences (no glued fragments) so the runtime translation can match them
function bekanntgabeHint(letterIso, fictionDays, bekanntgabe, period, end, moved) {
  const fx = fictionDays === 4 ? 'seit 2025 vier Tage, früher 3-Tage-Fiktion' : '3-Tage-Fiktion';
  return moved
    ? `Berechnet: Briefdatum ${deDate(letterIso)} + ${fictionDays} Tage Postlaufzeit-Fiktion (${fx}) = Bekanntgabe ${deDate(bekanntgabe)}, Frist ${period} → ${deDate(end)} (auf den nächsten Werktag verschoben). Ohne Gewähr – maßgeblich ist der tatsächliche Zugang.`
    : `Berechnet: Briefdatum ${deDate(letterIso)} + ${fictionDays} Tage Postlaufzeit-Fiktion (${fx}) = Bekanntgabe ${deDate(bekanntgabe)}, Frist ${period} → ${deDate(end)}. Ohne Gewähr – maßgeblich ist der tatsächliche Zugang.`;
}
export function bekanntgabeFrist(letterIso, { months = 1, weeks = 0 } = {}) {
  const fictionDays = letterIso >= '2025-01-01' ? 4 : 3;
  const bekanntgabe = nextWorkday(addDays(letterIso, fictionDays));
  let end = weeks ? addDays(bekanntgabe, weeks * 7) : addMonths(bekanntgabe, months);
  end = nextWorkday(end);
  return {
    date: end, bekanntgabe, fictionDays,
    hint: bekanntgabeHint(letterIso, fictionDays, bekanntgabe, weeks ? `${weeks} Wochen` : months === 1 ? 'ein Monat' : `${months} Monate`, end, end !== (weeks ? addDays(bekanntgabe, weeks * 7) : addMonths(bekanntgabe, months))),
  };
}

// ------------------------------------------------------------------ numbers / amounts
const AMOUNT_SRC = '(?<![\\d.,])([+-]?\\s?\\d{1,3}(?:[.\\u2009\' ]\\d{3})+,\\d{2}|[+-]?\\s?\\d+,\\d{2}|\\d+\\.\\d{2}(?=\\s?(?:€|EUR)))(?![\\d])(\\s?-(?![\\d]))?';
const amountRe = () => new RegExp(AMOUNT_SRC, 'g');
/** "1.234,56" / "1234,56" / "-12,30" / "12,30-" → number (or null). */
export function parseAmount(s) {
  if (s == null) return null;
  const str = String(s).trim();
  const m = new RegExp(AMOUNT_SRC).exec(str);
  if (!m) return null;
  let raw = m[1].replace(/\s/g, '');
  let neg = raw.startsWith('-') || !!m[2];
  raw = raw.replace(/^[+-]/, '');
  let v;
  if (/,\d{2}$/.test(raw)) v = parseFloat(raw.replace(/[. ' ]/g, '').replace(',', '.'));
  else v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  return Math.round((neg ? -v : v) * 100) / 100;
}
/** All amounts in a string: [{value, index, end, raw, currency}] */
export function findAmounts(s) {
  const out = [];
  const str = String(s || '');
  const re = amountRe();
  let m;
  while ((m = re.exec(str))) {
    const before = str.slice(Math.max(0, m.index - 5), m.index), after = str.slice(m.index + m[0].length, m.index + m[0].length + 5);
    // skip parts of dates like 12,05.2024 or percentages "19,00 %"
    if (/^\s?%/.test(after)) continue;
    const v = parseAmount(m[0]);
    if (v == null) continue;
    out.push({ value: v, index: m.index, end: m.index + m[0].length, raw: m[0], currency: /€|EUR|Euro/i.test(before + after) });
  }
  return out;
}
export function formatAmount(v, { currency = true } = {}) {
  if (v == null || !Number.isFinite(+v)) return '';
  const s = (+v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${s}\u00a0€` : s;
}
const round2 = v => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ IBAN / BIC
const IBAN_LEN = { DE: 22, AT: 20, CH: 21, NL: 18, BE: 16, FR: 27, IT: 27, ES: 24, LU: 20, PL: 28, DK: 18, CZ: 24, GB: 22, IE: 22, LI: 21, SE: 24, PT: 25, FI: 18 };
export function cleanIban(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
/** ISO 13616 mod-97 check (+ country length for known countries). */
export function validIban(s) {
  const iban = cleanIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const len = IBAN_LEN[iban.slice(0, 2)];
  if (len && iban.length !== len) return false;
  const re = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const code = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}
export function formatIban(s) { return cleanIban(s).replace(/(.{4})/g, '$1 ').trim(); }
const OCR_DIGIT = { O: '0', Q: '0', D: '0', I: '1', L: '1', l: '1', Z: '2', S: '5', B: '8', G: '6', T: '7' };
/** Find IBANs (also with OCR confusions in the numeric part of German IBANs). [{iban, index, valid, fixed}] */
export function findIbans(text) {
  const out = [];
  // line breaks inside an IBAN ("DE22 5900 0000\n0059 0015 00") are treated like spaces (same length → same indexes)
  const str = String(text || '').replace(/\n/g, ' ');
  const re = /(?<![A-Z0-9])([A-Z]{2}\s?\d{2}(?:[ ]?[A-Z0-9]{2,4}){3,8})(?![a-z])/gi;
  let m;
  while ((m = re.exec(str))) {
    let raw = m[1];
    let c = cleanIban(raw);
    if (!/^[A-Z]{2}/.test(raw.slice(0, 2).toUpperCase())) continue;
    const cc = c.slice(0, 2);
    let L = IBAN_LEN[cc];
    if (L && c.length > L) c = c.slice(0, L);
    if (validIban(c)) { out.push({ iban: c, index: m.index, valid: true, fixed: false }); continue; }
    if (cc === 'DE' && c.length === 22) {
      const fixedBody = c.slice(2).split('').map(ch => OCR_DIGIT[ch] || ch).join('');
      const f = 'DE' + fixedBody;
      if (/^DE\d{20}$/.test(f) && validIban(f)) { out.push({ iban: f, index: m.index, valid: true, fixed: true }); continue; }
    }
    if (/^DE\d{2}/.test(c) && c.length >= 20) out.push({ iban: c, index: m.index, valid: false, fixed: false });
  }
  return out;
}
const BIC_RE = /(?<![A-Z0-9])([A-Z]{4}(?:DE|AT|CH|NL|BE|FR|IT|ES|LU|PL|DK|GB|IE|LI)[A-Z0-9]{2}(?:[A-Z0-9]{3})?)(?![A-Z0-9])/g;

// ------------------------------------------------------------------ text preparation
const LIGATURES = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl' };
export function prepareText(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n').replace(/[   ]/g, ' ').replace(/[‐-―−]/g, '-')
    .replace(/[„“”«»]/g, '"').replace(/[‘’‚‹›]/g, "'").replace(/[ﬁﬂﬀﬃﬄ]/g, c => LIGATURES[c]).replace(/­/g, '');
  t = t.replace(/ {3,}/g, '\t').replace(/[ ]*\t[ \t]*/g, '\t');
  const lines = t.split('\n').map(l => l.replace(/ {2}/g, ' ').trim()).filter((l, i, arr) => l || (arr[i - 1] && arr[i - 1].trim()));
  return lines;
}
const cellsOf = line => line.split('\t').map(c => c.trim()).filter(Boolean);
const lower = s => String(s || '').toLocaleLowerCase('de');

// generic helpers
function firstMatch(lines, re, from = 0, to = lines.length) {
  for (let i = from; i < Math.min(to, lines.length); i++) { const m = re.exec(lines[i]); if (m) return { i, m }; }
  return null;
}

// ------------------------------------------------------------------ labelled values
const REF_TOKEN = '[A-Z0-9ÄÖÜ][A-Z0-9ÄÖÜ./_-]*';
function refValue(after) {
  const s = String(after || '').replace(/^[\s:.#=-]*(?:(?:Nr|No|Nummer)\.?\s*:?\s*)?/i, '');
  const cell = s.split('\t')[0];
  const toks = cell.split(/\s+/);
  const out = [];
  for (const t0 of toks) {
    const t = t0.replace(/[,;)]+$/, '');
    if (!t) break;
    if (!new RegExp(`^${REF_TOKEN}$`, 'u').test(t)) break;
    const hasDigit = /\d/.test(t);
    if (!out.length) { if (!hasDigit && !(t.length <= 4 && /^[A-ZÄÖÜ]+$/.test(t))) break; out.push(t); continue; }
    if (hasDigit || (t.length <= 3 && /^[A-Z]+$/.test(t) && out.length < 3)) out.push(t); else break;
    if (out.join(' ').length > 34) break;
  }
  while (out.length && !/\d/.test(out[out.length - 1])) out.pop();
  const v = out.join(' ').replace(/[./-]+$/, '');
  if (!/\d/.test(v) || v.replace(/\D/g, '').length < 2) return null;
  // dates are not references
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(v)) return null;
  return v;
}

/** Value after a label: same line (same cell or next cell), or in the line below (same column). */
function labeled(lines, labelRe, parse, { maxLines = lines.length, skip = null } = {}) {
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const line = lines[i];
    const re = new RegExp(labelRe.source, labelRe.flags.replace('g', '') + 'g');
    let m;
    while ((m = re.exec(line))) {
      if (skip && skip(line, m)) continue;
      const after = line.slice(m.index + m[0].length);
      let v = parse(after);
      if (v != null) return { value: v, line: i, label: m[0] };
      // next line, same column
      const cells = line.split('\t');
      let col = 0, pos = 0;
      for (let k = 0; k < cells.length; k++) { if (m.index >= pos && m.index < pos + cells[k].length + 1) { col = k; break; } pos += cells[k].length + 1; }
      const restCell = after.split('\t')[0].trim();
      if (!restCell && lines[i + 1] != null) {
        const nc = lines[i + 1].split('\t');
        const cand = cells.length > 1 && nc.length === cells.length ? nc[col] : nc[0];
        v = parse(cand || '');
        if (v != null) return { value: v, line: i + 1, label: m[0] };
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------ document types
export const DOC_TYPES = [
  { id: 'rechnung', label: 'Rechnung', plural: 'Rechnungen', icon: 'euro' },
  { id: 'mahnung', label: 'Mahnung', plural: 'Mahnungen', icon: 'bell' },
  { id: 'bescheid', label: 'Bescheid', plural: 'Bescheide', icon: 'scale' },
  { id: 'vertrag', label: 'Vertrag', plural: 'Verträge', icon: 'letter' },
  { id: 'kontoauszug', label: 'Kontoauszug', plural: 'Kontoauszüge', icon: 'chart' },
  { id: 'lohnabrechnung', label: 'Lohnabrechnung', plural: 'Lohnabrechnungen', icon: 'euro' },
  { id: 'versicherung', label: 'Versicherung', plural: 'Versicherungen', icon: 'shield' },
  { id: 'arzt', label: 'Arzt & Krankenkasse', plural: 'Gesundheit', icon: 'heart' },
  { id: 'werbung', label: 'Werbung', plural: 'Werbung', icon: 'gift' },
  { id: 'sonstiges', label: 'Sonstiges', plural: 'Sonstiges', icon: 'file' },
];
export const typeInfo = id => DOC_TYPES.find(t => t.id === id) || DOC_TYPES[DOC_TYPES.length - 1];
export const SUBTYPE_LABELS = {
  steuer: 'Steuerbescheid', behoerde: 'Behördenbescheid', kuendigungsbestaetigung: 'Kündigungsbestätigung', vertragsbestaetigung: 'Vertragsbestätigung',
  kassenbon: 'Kassenbon', handwerker: 'Handwerkerrechnung', spendenquittung: 'Spendenquittung', inkasso: 'Inkasso', arzt: 'Arztrechnung',
  beitrag: 'Beitragsinformation', nebenkosten: 'Nebenkostenabrechnung', energie: 'Energieabrechnung',
};

// [type, regex, weight]
const RULES = [
  ['rechnung', /(?<![\p{L}])rechnung(?![\p{L}])/iu, 3], ['rechnung', /rechnungs-?\s?(?:nummer|nr)/iu, 3], ['rechnung', /rechnungsdatum/iu, 2],
  ['rechnung', /rechnungsbetrag|zahlbetrag|zu zahlender betrag|endbetrag|gesamtbetrag/iu, 2], ['rechnung', /zahlbar\s+(?:bis|innerhalb|sofort)|zahlungsziel/iu, 2],
  ['rechnung', /leistungszeitraum|lieferdatum|leistungsdatum|abrechnungszeitraum/iu, 1.5], ['rechnung', /(?:mwst|ust|umsatzsteuer|mehrwertsteuer)/iu, 1],
  ['rechnung', /jahresabrechnung|verbrauchsabrechnung|stromrechnung|nebenkostenabrechnung|betriebskostenabrechnung|schlussrechnung|abrechnung/iu, 2],
  ['rechnung', /kassenbon|bon-?nr|beleg-?nr|rückgeld|gegeben|girocard|ec-karte|kartenzahlung|kassierer|^summe|summe\s+eur|zwischensumme/imu, 2.5],
  ['rechnung', /quittung|barzahlung|betrag dankend erhalten/iu, 2], ['rechnung', /arbeitskosten|lohnkosten|material(?:kosten)?|anfahrt/iu, 1.5],
  ['rechnung', /nachzahlung|abschlag/iu, 1], ['rechnung', /gesamtpreis|bezahlt mit|zahlungsart|fahrkarte|online-ticket|buchungsbestätigung/iu, 2],
  ['mahnung', /mahnung/iu, 7], ['mahnung', /zahlungserinnerung/iu, 7], ['mahnung', /mahngebühr|mahnkosten|mahnstufe/iu, 4],
  ['mahnung', /offener?\s+betrag|noch offen|ausstehend|offene forderung|gesamtforderung|zahlungsverzug|in verzug|säumnis/iu, 3],
  ['mahnung', /inkasso/iu, 5], ['mahnung', /keinen?\s+zahlungseingang|nicht beglichen|noch nicht bezahlt|überfällig|bisher nicht/iu, 3],
  ['bescheid', /bescheid/iu, 4], ['bescheid', /rechtsbehelfsbelehrung/iu, 6], ['bescheid', /(?<![\p{L}])widerspruch(?![\p{L}])|einspruch/iu, 2],
  ['bescheid', /festgesetzt|festsetzung/iu, 3], ['bescheid', /finanzamt/iu, 4], ['bescheid', /einkommensteuer|steuernummer|steuer-?id|identifikationsnummer/iu, 2],
  ['bescheid', /behörde|landratsamt|stadtverwaltung|bürgermeister|jobcenter|familienkasse|bundesagentur|kreisverwaltung|bezirksamt|wohngeldstelle|elterngeldstelle|landesamt|bürgeramt|ausländerbehörde|beitragsservice|rundfunkbeitrag/iu, 3],
  ['bescheid', /geschäftszeichen|aktenzeichen|kassenzeichen/iu, 1], ['bescheid', /bewilligt|bewilligung|antrag(?:es)? vom|abgelehnt/iu, 2],
  ['vertrag', /vertrag/iu, 1.5], ['vertrag', /vertragsbestätigung|auftragsbestätigung|willkommen bei|bestätigung ihres auftrags|ihr neuer tarif/iu, 5],
  ['vertrag', /kündigungsbestätigung|bestätigung ihrer kündigung|ihre kündigung|kündigung (?:ihres|ihrer|vom)|haben wir ihre kündigung/iu, 7],
  ['vertrag', /mindest(?:vertrags)?laufzeit|vertragslaufzeit|laufzeit/iu, 3], ['vertrag', /kündigungsfrist/iu, 3],
  ['vertrag', /vertragsbeginn|vertragsende|vertragsnummer|beginn der mitgliedschaft|mitgliedschaft/iu, 2.5], ['vertrag', /tarif|grundgebühr|monatlich/iu, 1],
  ['vertrag', /widerrufsbelehrung/iu, 1],
  ['kontoauszug', /kontoauszug/iu, 8], ['kontoauszug', /alter kontostand|neuer kontostand|kontostand|saldo/iu, 4], ['kontoauszug', /buchungstag|valuta|wertstellung|buchungsdatum/iu, 3],
  ['kontoauszug', /auszug\s*(?:nr|nummer)|blatt\s+\d/iu, 1],
  ['lohnabrechnung', /lohnabrechnung|gehaltsabrechnung|entgeltabrechnung|verdienstabrechnung|abrechnung der brutto|bezügeabrechnung|lohn-? und gehaltsabrechnung/iu, 9],
  ['lohnabrechnung', /gesamtbrutto|steuerbrutto|sv-brutto|bruttolohn|bruttogehalt|nettoverdienst|nettobezüge|auszahlungsbetrag|lohnsteuer|steuerklasse|personalnummer|arbeitgeber/iu, 2],
  ['lohnabrechnung', /solidaritätszuschlag|kirchensteuer|rentenversicherung|arbeitslosenversicherung|pflegeversicherung/iu, 1],
  ['versicherung', /versicherung/iu, 2], ['versicherung', /versicherungsschein|versicherungsnummer|versicherungsnehmer|police|versicherungsbeginn|versicherungsjahr|beitragsrechnung|beitragsanpassung|schadennummer|schadenmeldung|schadensfall|versicherungsschutz/iu, 3],
  ['versicherung', /haftpflicht|hausrat|kfz-versicherung|kasko|teilkasko|vollkasko|selbstbeteiligung|deckungssumme|rechtsschutz|berufsunfähigkeit|wohngebäude|unfallversicherung/iu, 3],
  ['arzt', /krankenkasse|krankenversicherung|aok|barmer|techniker krankenkasse|(?<![\p{L}])dak(?![\p{L}])|(?<![\p{L}])ikk(?![\p{L}])|(?<![\p{L}])bkk(?![\p{L}])|(?<![\p{L}])kkh(?![\p{L}])|knappschaft/iu, 3],
  ['arzt', /versichertennummer|krankenversichertennummer|gesundheitskarte|versichertenkarte|bonusprogramm|vorsorge|impfung|zahnarzt|praxis|dr\.\s?med|befund|diagnose|behandlung|patient|rezept|arbeitsunfähigkeit|kur(?:antrag)?|heilmittel|zuzahlung/iu, 2],
  ['werbung', /angebot|rabatt|gutschein|vorteilsangebot|aktionscode|vorteilstarif|% günstiger/iu, 2.5],
  ['werbung', /exklusiv|nur für kurze zeit|jetzt (?:bestellen|sichern|zugreifen|anmelden|testen|wechseln)|gewinnspiel|gewinnen sie|sonderaktion|kostenlos testen|gratis|sparen sie|\d+\s?€\s+sparen|neukunden/iu, 2.5],
  ['werbung', /newsletter|abbestellen|werbung|prospekt|unverbindlich|abmelden/iu, 2.5],
  ['werbung', /\d+\s?%\s*(?:rabatt|sparen|auf alles)|vorteilscode|bis zu \d+\s?%/iu, 3],
];
// strong subject words (in the "Betreff" line or a title line) count double
const SUBJECT_BOOST = 2;

function subjectLine(lines) {
  const b = firstMatch(lines, /^(?:betreff|betr\.)\s*:?\s*(.+)$/i, 0, 60);
  if (b) return { i: b.i, text: b.m[1] };
  const g = firstMatch(lines, /^(?:sehr geehrte|guten tag|hallo|liebe[rs]?\s|sehr geehrter|moin)/i, 0, 70);
  if (g) for (let k = g.i - 1; k >= Math.max(0, g.i - 4); k--) if (lines[k] && lines[k].length > 3 && !findDates(lines[k]).length) return { i: k, text: lines[k] };
  return null;
}

/** Classify a letter → {type, subtype, confidence, scores, ranked} */
export function classify(input) {
  const lines = Array.isArray(input) ? input : prepareText(input);
  const full = lines.join('\n');
  const subj = subjectLine(lines);
  const head = lines.slice(0, 30).join('\n');
  const scores = Object.fromEntries(DOC_TYPES.map(t => [t.id, 0]));
  for (const [type, re, w] of RULES) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const n = Math.min(3, (full.match(g) || []).length);
    if (!n) continue;
    let s = w * (1 + 0.35 * (n - 1));
    if (subj && re.test(subj.text)) s += w * SUBJECT_BOOST;
    else if (re.test(head)) s += w * 0.3;
    scores[type] += s;
  }
  // title lines (a line that is only the type word)
  for (const l of lines.slice(0, 40)) {
    const t = lower(l).replace(/[^\p{L} -]/gu, '').trim();
    if (/^(rechnung|stromrechnung|jahresabrechnung|rechnung nr|quittung|kassenbon)$/.test(t)) scores.rechnung += 4;
    if (/^(mahnung|\d?\.?\s*mahnung|zahlungserinnerung|letzte mahnung)$/.test(t)) scores.mahnung += 4;
    if (/^kontoauszug/.test(t)) scores.kontoauszug += 4;
    if (/bescheid/.test(t) && t.length < 80) scores.bescheid += 2;
  }
  // disambiguation
  if (scores.mahnung >= 7) scores.rechnung *= 0.55;
  if (scores.lohnabrechnung >= 9) { scores.arzt *= 0.2; scores.versicherung *= 0.2; scores.bescheid *= 0.3; scores.rechnung *= 0.4; }
  if (scores.kontoauszug >= 8) { scores.rechnung *= 0.4; scores.mahnung *= 0.4; scores.vertrag *= 0.4; scores.versicherung *= 0.4; scores.arzt *= 0.4; }
  if (/rechtsbehelfsbelehrung/i.test(full)) { scores.rechnung *= 0.5; scores.arzt *= 0.6; }
  if (/kündigungsbestätigung|bestätigung ihrer kündigung|haben wir ihre kündigung|ihre kündigung (?:vom|ist|haben)/i.test(full)) { scores.vertrag += 4; scores.rechnung *= 0.5; }
  const insurer = /versicherungsschein|versicherungsnehmer|versicherungsnummer|police/i.test(full);
  if (insurer && !/krankenkasse|krankenversicherung/i.test(full)) { scores.rechnung *= 0.6; scores.vertrag *= 0.75; }
  if (scores.arzt >= 6 && /krankenkasse|krankenversicherung|aok|barmer|techniker/i.test(full)) scores.versicherung *= 0.5;
  if (scores.werbung > 0 && (scores.rechnung > 6 || scores.mahnung > 6 || scores.bescheid > 8)) scores.werbung *= 0.4;
  if (/zuwendungsbestätigung|bestätigung über (?:geld)?zuwendungen|spendenbescheinigung/i.test(full)) { scores.sonstiges += 10; scores.rechnung *= 0.3; scores.bescheid *= 0.2; scores.werbung *= 0.2; }
  scores.sonstiges += 2.5;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let [type, s1] = ranked[0];
  const s2 = ranked[1][1];
  let confidence = Math.max(0.05, Math.min(0.99, 0.55 * (s1 / (s1 + s2 + 1)) + 0.45 * Math.min(1, (s1 - s2) / 8)));
  if (s1 < 4) { type = 'sonstiges'; confidence = Math.min(confidence, 0.4); }
  // subtypes
  let subtype = null;
  if (type === 'bescheid') subtype = /finanzamt|einkommensteuer|steuerbescheid|umsatzsteuer|grundsteuer|kirchensteuer/i.test(full) ? 'steuer' : 'behoerde';
  if (type === 'vertrag') subtype = /kündigungsbestätigung|bestätigung ihrer kündigung|haben wir ihre kündigung|ihre kündigung/i.test(full) ? 'kuendigungsbestaetigung' : 'vertragsbestaetigung';
  if (type === 'rechnung') {
    // a utility bill has a "Summe" line too – it is no till receipt
    if (/nebenkostenabrechnung|betriebskostenabrechnung/i.test(full)) subtype = 'nebenkosten';
    else if (/kassenbon|bon-?nr|rückgeld|kassierer|summe\s+eur|^summe/im.test(full) && !/rechnungsnummer|rechnung nr/i.test(full)) subtype = 'kassenbon';
    else if (/arbeitskosten|lohnkosten|arbeitslohn|handwerk|montage|meisterbetrieb|sanitär|elektro|malerbetrieb|dachdecker/i.test(full)) subtype = 'handwerker';
    else if (/strom|gas|fernwärme|stadtwerke|kwh|zählerstand/i.test(full)) subtype = 'energie';
    else if (/goä|gebührenordnung für ärzte|dr\.\s?med|zahnarzt|praxis/i.test(full)) subtype = 'arzt';
  }
  if (type === 'mahnung' && /inkasso/i.test(full)) subtype = 'inkasso';
  if (type === 'sonstiges' && /zuwendungsbestätigung|bestätigung über (?:geld)?zuwendungen|spendenbescheinigung/i.test(full)) subtype = 'spendenquittung';
  return { type, subtype, confidence: Math.round(confidence * 100) / 100, scores, ranked: ranked.map(([id, s]) => ({ id, score: Math.round(s * 10) / 10 })) };
}

// ------------------------------------------------------------------ parties
const LEGAL = /(?<![\p{L}])(GmbH(?:\s*&\s*Co\.?\s*KG)?|mbH|AG|SE|KG|KGaA|OHG|oHG|VVaG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|e\.\s?V\.|eG|e\.\s?K\.|Ltd\.?|Inc\.?|S\.A\.|B\.V\.|Partnerschaft|PartG)(?![\p{L}])/u;
const AUTH = /(?<![\p{L}])(Finanzamt|Stadtwerke|Stadt\s+\p{Lu}|Gemeinde|Landkreis|Landratsamt|Kreisverwaltung|Bezirksamt|Bürgeramt|Jobcenter|Agentur für Arbeit|Bundesagentur|Familienkasse|Deutsche Rentenversicherung|Rentenversicherung|Krankenkasse|AOK|BARMER|Techniker Krankenkasse|DAK-Gesundheit|IKK|BKK|KKH|Knappschaft|Amtsgericht|Landgericht|Polizei|Hauptzollamt|Beitragsservice|ARD ZDF|Sparkasse|Volksbank|Raiffeisenbank|Bank|Versicherung|Versicherungen|Klinikum|Krankenhaus|Praxis|Universität|Hochschule|Schule|Kita|Kindergarten|Verein|Hausverwaltung|Wohnungsbau|Immobilien|Energie|Telekom|Vodafone|Telefónica|Fitness|Inkasso|Landesamt|Bundesamt|Ministerium|Kasse|Studio|Apotheke|Elterngeldstelle|Wohngeldstelle|Kreis)(?![\p{L}])/u;
const STREET = /(?<![\p{L}])[\p{L}][\p{L}.\- ]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee|markt|steig|pfad|hof|berg|feld|garten|park)\s*\d+\s?[a-z]?(?![\d])/iu;
const PLZCITY = /(?<!\d)(?:D-)?(\d{5})\s+(\p{Lu}[\p{L}.\- ]{1,40}?)(?=$|\t|\s{2}|,|·|\|)/u;
const POSTFACH = /postfach\s*\d+/i;
const NOT_NAME = /^(?:rechnung|mahnung|kontoauszug|datum|seite|bescheid|betreff|kundennummer|telefon|tel\.?|fax|e-mail|www\.|ihr zeichen|unser zeichen|ihre nachricht|aktenzeichen|steuernummer|bankverbindung|iban|bic|herrn?|frau|an|empfänger|absender|postanschrift|hausanschrift|ansprechpartner|sachbearbeiter|durchwahl|öffnungszeiten|sprechzeiten)\b/i;

function cleanName(s) {
  return String(s || '').replace(/\s*[·|•]\s*.*$/, '').replace(/,\s*(?:[\p{L}]+\s?(?:str\.|straße).*|\d{5}.*|postfach.*)$/iu, '').replace(/\s{2,}/g, ' ').replace(/^[\s"'-]+|[\s"',;:-]+$/g, '').trim();
}

const INFO_LINE = /^(?:[\p{L}][\p{L} .\/-]{1,32}:(?:\s|$)|(?:ihre?|unser(?:e)?)\s|(?:kunden|rechnungs|vertrags|datum|telefon|tel\.|fax|e-mail|aktenzeichen|steuer|bestell|patient|kind|objekt|mieter|seite|blatt|auszug|personal|pers\.|abrechnungs|versicherungs|mitglieds|beitrags|kassenzeichen|teilnehmer|sachbearbeit|geb\.|kd\.|re\.|abo-|buchung|zeichen|durchwahl|zimmer|bearbeiter|ansprechp|erstellt|monat|zeitraum|auftrag|bestelldatum|lieferdatum|leistungsdatum|fällig)[\p{L}.-]*)/iu;
const infoLike = l => INFO_LINE.test(cellsOf(l)[0] || '');
function recipientBlock(lines) {
  // 1) "Herrn"/"Frau" (also "Herr"/"Familie") within the address window; right-column info lines are skipped
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const c0 = cellsOf(lines[i])[0] || '';
    const m = /^(Herrn?|Frau|Familie|Eheleute|Fam\.)(?:\s+(.+))?$/.exec(c0);
    if (!m) continue;
    const follow = [];
    for (let k = i + 1; k < Math.min(lines.length, i + 9) && follow.length < 4; k++) {
      const c0k = cellsOf(lines[k] || '')[0] || '';
      if (!lines[k] || infoLike(lines[k]) || !/\p{L}{2}/u.test(c0k) || (findDates(c0k).length && c0k.replace(/[\d.\s]/g, '').length < 3)) continue;
      follow.push(c0k);
    }
    let name = m[2] && m[2].trim().length > 2 ? m[2].trim() : (follow.shift() || '');
    if (m[1] === 'Familie' || m[1] === 'Eheleute') name = `${m[1]} ${name}`.trim();
    if (STREET.test(name) || PLZCITY.test(name)) { follow.unshift(name); name = ''; } // the name line was not recognised (OCR)
    const block = follow.slice(0, 3);
    const plzI = block.findIndex(b => PLZCITY.test(b));
    return { name: name ? cleanName(name) : null, street: plzI > 0 ? block[plzI - 1] : (STREET.test(block[0] || '') ? block[0] : null), city: plzI >= 0 ? block[plzI] : null, line: i };
  }
  // 2) block "Name / Street / PLZ City" after a return line (first PLZ line in the top area preceded by a street line)
  const ret = returnLine(lines);
  const plain = lines.map((l, i) => ({ l, i })).filter(x => x.l && !infoLike(x.l));
  for (let j = 2; j < plain.length && plain[j].i < 30; j++) {
    const i = plain[j].i;
    const c = cellsOf(lines[i])[0] || '';
    if (!PLZCITY.test(c) || /[·|•]/.test(lines[i])) continue;
    const st = cellsOf(plain[j - 1].l)[0] || '';
    if (!STREET.test(st) && !POSTFACH.test(st)) continue;
    const nm = cellsOf(plain[j - 2].l)[0] || '';
    // a block in the first lines without a return line above is the letterhead (sender / shop), not the recipient
    if (plain[j - 2].i < 3 && !(ret && ret.line < plain[j - 2].i)) continue;
    if (!nm || /[·|•]/.test(nm) || NOT_NAME.test(nm) || /\d{5}/.test(nm) || LEGAL.test(nm) && i < 6) continue;
    return { name: cleanName(nm), street: st, city: c, line: plain[j - 2].i };
  }
  return null;
}

function returnLine(lines) {
  for (let i = 0; i < Math.min(lines.length, 18); i++) {
    const l = lines[i];
    if (!/[·|•]|\s-\s|,\s/.test(l)) continue;
    const parts = l.split(/\s*[·|•]\s*|\s+-\s+|,\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const hasAddr = parts.some(p => PLZCITY.test(p) || STREET.test(p) || POSTFACH.test(p)) || /\d{5}\s+\p{Lu}/u.test(l);
    if (!hasAddr) continue;
    let name = parts[0];
    if (/,/.test(name) && !LEGAL.test(name)) name = name.split(',')[0];
    if (STREET.test(name) || PLZCITY.test(name) || name.length < 3 || /^(tel|fon|www|e-mail)/i.test(name)) continue;
    // a sender line, not a footer contact line
    if (/@|www\.|tel\.?\s*:?\s*\d/i.test(name) || /^inh(?:\.|aber)/i.test(name)) continue;
    return { name: cleanName(name), line: i, address: parts.slice(1).join(', ') };
  }
  return null;
}

function senderOf(lines, rcpt) {
  const cands = [];
  const add = (name, score, why, line) => {
    const n = cleanName(name);
    if (!n || n.length < 3 || n.length > 80 || NOT_NAME.test(n) || /^\d/.test(n) || findDates(n).length || /@/.test(n)) return;
    if (rcpt && rcpt.name && lower(n) === lower(rcpt.name)) return;
    if (/^(sehr geehrte|mit freundlichen|ihr(?:e)?\s+(?:kundennummer|rechnung|vertrag))/i.test(n)) return;
    cands.push({ name: n, score, why, line });
  };
  const ret = returnLine(lines);
  if (ret) add(ret.name, 12, 'return', ret.line);
  const rLine = rcpt ? rcpt.line : -1;
  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    if (rcpt && i >= rLine && i <= rLine + 3) continue;
    for (const c of cellsOf(lines[i])) {
      if (c.length > 70 || /[·|•]/.test(c)) continue;
      let s = 0;
      if (LEGAL.test(c)) s += 7;
      if (AUTH.test(c)) s += 6;
      if (!s) continue;
      if (/^(?:ihr|ihre|bei|an|von|für)\s/i.test(c)) s -= 3;
      if (/^inh(?:\.|aber)/i.test(c)) s -= 5;
      if (/\d{3,}/.test(c)) s -= 3;
      add(c, s + Math.max(0, 4 - i * 0.4), 'head', i);
    }
  }
  // signature: "Mit freundlichen Grüßen" + following line(s)
  const g = firstMatch(lines, /(?:mit freundlichen grüßen|freundliche grüße|mit besten grüßen|viele grüße|hochachtungsvoll|ihr[e]?\s+[\p{L}-]+-?team)/iu, 0);
  if (g) {
    const team = /ihr[e]?\s+(.+?)[-\s]team/iu.exec(lines[g.i]);
    if (team) add(team[1], 6, 'team', g.i);
    for (let k = g.i + 1; k < Math.min(lines.length, g.i + 4); k++) {
      const c = cellsOf(lines[k])[0] || '';
      if (LEGAL.test(c) || AUTH.test(c)) { add(c, 7, 'signature', k); break; }
    }
  }
  // footer
  for (let i = Math.max(0, lines.length - 14); i < lines.length; i++) {
    for (const c of lines[i].split(/\t|\s[·|•]\s/)) {
      if (LEGAL.test(c) && c.length < 70 && !/sitz|registergericht|amtsgericht|hrb|geschäftsführ|vorstand|ust-?id/i.test(c)) add(c, 4, 'footer', i);
    }
  }
  // e-mail / web domain as weak fallback
  const em = /(?:@|www\.)([a-z0-9-]+)\.(?:de|com|eu|net|org|at|ch)/i.exec(lines.join(' '));
  if (em && !/gmail|gmx|web|t-online|outlook|hotmail|yahoo|icloud|posteo|mailbox/i.test(em[1])) add(em[1].replace(/-/g, ' ').replace(/(^|\s)\p{L}/gu, x => x.toUpperCase()), 1, 'domain', -1);
  // first plausible line of the letterhead (letterheads usually start with the sender's name)
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const c = cellsOf(lines[i])[0] || '';
    if (c.length >= 4 && /\p{Lu}/u.test(c) && !findDates(c).length && !/\d{4,}/.test(c) && !/[·|•]/.test(c) && (!rcpt || i < rLine) && !/^(?:herrn?|frau|an\s)/i.test(c)) { add(c, cands.length ? 3 : 1, 'first', i); break; }
  }
  // merge equal names
  const by = new Map();
  for (const c of cands) {
    const k = lower(c.name).replace(/[^\p{L}\d]/gu, '');
    const prev = by.get(k);
    if (prev) { prev.score += c.score * 0.5; if (c.name.length > prev.name.length && c.why !== 'domain') prev.name = c.name; } else by.set(k, { ...c });
  }
  // a name contained in another (e.g. "Stadtwerke Musterstadt" ⊂ "Stadtwerke Musterstadt GmbH") supports it
  const list = [...by.values()];
  for (const a of list) for (const b of list) if (a !== b && lower(b.name).includes(lower(a.name)) && a.name.length >= 5) b.score += a.score * 0.4;
  list.sort((a, b) => b.score - a.score);
  const best = list[0] || null;
  if (!best) return null;
  // sender address (near the return line or the letterhead)
  let address = ret && ret.address ? ret.address : null;
  if (!address && best.line >= 0) {
    for (let k = best.line + 1; k < Math.min(lines.length, best.line + 4); k++) {
      const c = cellsOf(lines[k]);
      const st = c.find(x => STREET.test(x) || POSTFACH.test(x)), pc = c.find(x => PLZCITY.test(x));
      if (st || pc) { address = [st, pc || (cellsOf(lines[k + 1] || '').find(x => PLZCITY.test(x)))].filter(Boolean).join(', '); break; }
    }
  }
  return { name: best.name, score: best.score, why: best.why, address, candidates: list.slice(0, 4).map(c => c.name) };
}

// ------------------------------------------------------------------ references
const REF_LABELS = {
  kundennummer: /(?<![\p{L}])(?:ihre\s+)?(?:kunden-?\s?(?:nummer|nr\.?|-nr\.?)|kundennr\.?|kd\.?-?\s?nr\.?|kunden-?\s?konto|kundenkonto|kunden-id|kd-nummer|mitglieds-?\s?(?:nummer|nr\.?))/iu,
  rechnungsnummer: /(?<![\p{L}])(?:rechnungs-?\s?(?:nummer|nr\.?)|rechnung\s+(?:nr\.?|nummer)|re\.?-?\s?nr\.?|beleg-?\s?(?:nummer|nr\.?)|bon-?\s?(?:nummer|nr\.?)|quittungs-?\s?(?:nummer|nr\.?)|rechnung(?=\s+[A-Z]{0,4}[-/]?\d{3,}))/iu,
  vertragsnummer: /(?<![\p{L}])(?:vertrags-?\s?(?:nummer|nr\.?|konto(?:nummer)?)|abo-?\s?(?:nummer|nr\.?)|abonnement-?\s?(?:nummer|nr\.?)|vertragskontonummer|versicherungs-?\s?(?:schein-?\s?)?(?:nummer|nr\.?)|versicherungsschein|police(?:n)?-?\s?(?:nummer|nr\.?)?|policen-?\s?nr\.?)/iu,
  aktenzeichen: /(?<![\p{L}])(?:aktenzeichen|az\.|geschäftszeichen|gesch\.?-?z(?:eichen|\.)|unser zeichen|zeichen|bg-?nummer|kassenzeichen|beitragsnummer|vorgangsnummer|schadennummer|antragsnummer)/iu,
  steuernummer: /(?<![\p{L}])(?:steuernummer|st\.?-?\s?nr\.?|steuer-?nr\.?)/iu,
  steuerid: /(?<![\p{L}])(?:steuer-?id(?:entifikationsnummer)?|identifikationsnummer|idnr\.?)/iu,
  versichertennummer: /(?<![\p{L}])(?:versicherten-?\s?(?:nummer|nr\.?)|krankenversichertennummer|kv-?nr\.?)/iu,
  personalnummer: /(?<![\p{L}])(?:personal-?\s?(?:nummer|nr\.?)|pers\.?-?\s?nr\.?)/iu,
  mandatsreferenz: /(?<![\p{L}])mandatsreferenz/iu,
  glaeubigerid: /(?<![\p{L}])gläubiger-?\s?(?:id|identifikationsnummer)/iu,
};
function refsOf(lines) {
  const out = {};
  for (const [k, re] of Object.entries(REF_LABELS)) {
    const r = labeled(lines, re, refValue, {
      skip: (line, m) => (k === 'aktenzeichen' && /ihr zeichen|ihre zeichen/i.test(line.slice(Math.max(0, m.index - 5), m.index + 10)))
        || (k === 'kundennummer' && /gläubiger/i.test(line.slice(Math.max(0, m.index - 12), m.index)))
        || (k === 'vertragsnummer' && /versicherungsnehmer/i.test(line.slice(m.index, m.index + 20))),
    });
    if (r) out[k] = r.value.replace(/\s+/g, ' ');
  }
  if (out.steuerid) out.steuerid = out.steuerid.replace(/\s/g, '');
  if (out.aktenzeichen && out.aktenzeichen === out.steuernummer) delete out.aktenzeichen;
  return out;
}

// ------------------------------------------------------------------ amounts
const FILLER = /\b(?:eur|euro|in|von|der|des|ist|beträgt|betragen|i\.\s?h\.\s?v\.|insgesamt|brutto|netto|inkl\.?|zzgl\.?|mwst\.?|ust\.?|gesamt|höhe|den|die|das)\b/giu;
/** Amount that belongs to a label match m in line l: same line, close to the label (≤ 1 other word);
 *  in a numeric row ("Gesamtbetrag 10,22 1,19 11,41") the last value when lastInRow is set. */
function amountAfter(l, m, { lastInRow = false, am = findAmounts(l) } = {}) {
  let a = am.find(x => {
    if (x.index < m.index + m[0].length) return false;
    const between = l.slice(m.index + m[0].length, x.index);
    const btw = between.replace(/(?:am|vom|zum)?\s*\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/g, ' ');
    if (btw.length > 42 || /\d{3,}/.test(btw.replace(/\d{1,2}\s?%/g, ''))) return false;
    return (btw.replace(FILLER, '').match(/[\p{L}]{4,}/gu) || []).length <= 1;
  });
  if (a && lastInRow) {
    const rest = am.filter(x => x.index > a.index);
    const gap = (from, to) => /^[\s\t€EURur]*$/.test(l.slice(from, to));
    if (rest.length && gap(a.end, rest[0].index) && rest.every((x, k) => k === 0 || gap(rest[k - 1].end, x.index))) a = rest[rest.length - 1];
  }
  return a || null;
}
const AMOUNT_LABELS = [
  // [key, regex, priority]
  ['offen', /offene[rn]?\s+(?:betrag|forderung|rechnungsbetrag|posten|saldo)|noch offen|offen(?:stehend)?er?\s+betrag|ausstehende[rn]?\s+betrag|gesamtforderung|forderungsbetrag|zu zahlender gesamtbetrag|offener gesamtbetrag|gesamt offen|summe offen/iu, 10],
  ['zahlung', /zu zahlen(?:der betrag)?|zahlbetrag|bitte (?:zahlen|überweisen) sie|zahlungsbetrag|bitte überweisen|von ihnen zu zahlen|nachzahlung|noch zu zahlen|abzuführen|verbleibende beträge|zahlen sie bitte/iu, 9],
  ['erstattung', /erstattung|guthaben|wird erstattet|erstatten wir|überzahlung|gutschrift|zurückerstattet/iu, 8],
  ['gesamt', /gesamtbetrag|rechnungsbetrag|endbetrag|gesamtsumme|rechnungssumme|bruttobetrag|summe brutto|gesamt brutto|brutto gesamt|gesamt\s*\(brutto\)|bruttosumme|betrag gesamt|gesamtpreis|gesamt\s*eur|^summe|summe eur|^gesamt|zu zahlender betrag|^betrag(?:\s+eur)?$/imu, 7],
  ['auszahlung', /auszahlungsbetrag|überweisungsbetrag|netto-?\s?(?:verdienst|bezüge|lohn|gehalt)|auszahlung/iu, 7],
  ['kontostand', /neuer kontostand|kontostand neu|neuer saldo|saldo neu/iu, 7],
  ['festgesetzt', /festgesetzt(?:\s+auf)?|jahresbetrag|festsetzung/iu, 5],
  ['beitrag', /(?:jahres|monats|quartals)?beitrag|prämie|beitragsrechnung/iu, 5],
  ['monatlich', /monatlich(?:e[rn]?)?\s+(?:grundgebühr|beitrag|abschlag|rate|preis|kosten)|grundgebühr|abschlag/iu, 4],
  ['mahngebuehr', /mahngebühr|mahnkosten|inkassokosten|verzugszinsen/iu, 3],
  ['netto', /netto(?:betrag|summe)?|summe netto|zwischensumme/iu, 2],
  ['betrag', /(?<![\p{L}])betrag(?![\p{L}])|summe|gesamt/iu, 1],
];
function amountsOf(lines, type) {
  const list = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const am = findAmounts(l);
    for (const [key, re, prio] of AMOUNT_LABELS) {
      const g = new RegExp(re.source, re.flags.replace('g', '') + 'g');
      let m;
      while ((m = g.exec(l))) {
        // amount right after the label (same line, at most two other words in between), else in the next line
        let a = amountAfter(l, m, { am, lastInRow: ['gesamt', 'zahlung', 'offen', 'auszahlung', 'kontostand'].includes(key) });
        if (!a && !am.length && lines[i + 1]) {
          const nx = findAmounts(lines[i + 1]);
          const restLetters = lines[i + 1].replace(/€|eur(?:o)?/gi, '').replace(/[\d.,\s+-]/g, '');
          if (nx.length && !restLetters && (nx.length === 1 || cellsOf(lines[i + 1]).length <= 2)) a = nx[nx.length - 1];
        }
        if (!a) continue;
        // do not take a percentage rate line "19 % MwSt"
        list.push({ key, value: a.value, prio, line: i, label: m[0].trim() });
      }
    }
  }
  const pick = keys => { for (const k of keys) { const c = list.filter(x => x.key === k); if (c.length) return c[c.length - 1]; } return null; };
  const first = keys => { for (const k of keys) { const c = list.find(x => x.key === k); if (c) return c; } return null; };
  let main = null;
  if (type === 'mahnung') main = pick(['offen', 'zahlung', 'gesamt', 'betrag']);
  else if (type === 'bescheid') main = first(['zahlung', 'erstattung', 'offen', 'gesamt', 'festgesetzt', 'beitrag', 'betrag']);
  else if (type === 'lohnabrechnung') main = pick(['auszahlung', 'zahlung', 'gesamt']);
  else if (type === 'kontoauszug') main = pick(['kontostand']);
  else if (type === 'versicherung') main = first(['zahlung', 'beitrag', 'gesamt', 'offen', 'monatlich']);
  else if (type === 'vertrag') main = first(['monatlich', 'beitrag', 'gesamt', 'zahlung']);
  else main = pick(['zahlung', 'offen', 'erstattung', 'gesamt', 'auszahlung', 'beitrag', 'betrag']);
  if (!main && !['vertrag', 'werbung', 'sonstiges', 'kontoauszug', 'arzt'].includes(type)) {
    // fallback: largest amount with a currency marker
    const all = lines.flatMap((l, i) => findAmounts(l).filter(a => a.currency).map(a => ({ key: 'betrag', value: a.value, prio: 0, line: i, label: '' })));
    all.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    main = all[0] || null;
  }
  const val = k => { const x = pick([k]); return x ? x.value : null; };
  let sign = null;
  if (main && main.key === 'erstattung') sign = 'erstattung';
  else if (main && (main.key === 'zahlung' || main.key === 'offen')) sign = 'zahlung';
  return {
    main: main ? main.value : null, mainKey: main ? main.key : null, mainLabel: main ? main.label : null, art: sign,
    gesamt: val('gesamt'), offen: val('offen'), mahngebuehr: val('mahngebuehr'), monatlich: val('monatlich'),
    list: list.slice(0, 40),
  };
}

// ------------------------------------------------------------------ bank details
function bankOf(lines) {
  const text = lines.join('\n');
  const ibans = findIbans(text);
  const debitCtx = /lastschrift|abgebucht|abbuchen|abbuchung|einziehen|eingezogen|einzug|von ihrem konto|ihre bankverbindung|ihr konto|mandat|sepa-?basis/i;
  const payCtx = /überweis|bankverbindung|zahlbar|zahlungsempfänger|empfänger|konto(?:verbindung)?|bank|sparkasse|iban|einzahlen|zu zahlen/i;
  const cls = ibans.map(x => {
    const lineStart = text.lastIndexOf('\n', x.index) + 1;
    const prevStart = text.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1;
    const ctx = text.slice(prevStart, Math.min(text.length, x.index + 60));
    const lineCtx = text.slice(lineStart, x.index);
    const debit = debitCtx.test(lineCtx) || (debitCtx.test(ctx) && !/überweisen sie|auf (?:unser|das folgende) konto|bankverbindung:/i.test(ctx));
    return { ...x, debit, pay: payCtx.test(ctx) };
  });
  const payee = cls.find(x => x.valid && !x.debit && x.pay) || cls.find(x => x.valid && !x.debit) || null;
  let bic = null;
  const bicL = labeled(lines, /(?<![\p{L}])(?:BIC|SWIFT(?:-?code)?|BIC\/SWIFT)(?![\p{L}])/u, s => { const m = /^[\s:]*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)(?![A-Z0-9])/.exec(s); return m ? m[1] : null; });
  if (bicL) bic = bicL.value;
  else if (payee) {
    const near = text.slice(Math.max(0, payee.index - 120), payee.index + 140);
    const m = new RegExp(BIC_RE.source).exec(near);
    if (m) bic = m[1];
  }
  const directDebit = /(?:wird|werden)\s+(?:der betrag|der rechnungsbetrag|die beträge|der beitrag|der gesamtbetrag)?\s*(?:[\p{L}\d.,€ ]{0,40})?(?:von ihrem konto\s+)?(?:per|mittels|im)\s+(?:sepa-?)?(?:lastschrift|bankeinzug)|(?:abgebucht|eingezogen|abbuchen|einziehen)(?:\s|\.|,|$)|sepa-lastschrift|lastschriftverfahren/iu.test(text);
  let bank = null;
  const bk = /(?<![\p{L}])(?:bank(?:verbindung)?|kreditinstitut|geldinstitut)\s*:?\s*([\p{L}][\p{L} .&-]{2,40}?(?:bank|sparkasse|kasse|volksbank|commerzbank|postbank|ing|dkb|n26|bnp|santander|raiffeisen)[\p{L} .-]{0,30})(?=\t|,|·|\||iban|$)/iu.exec(text);
  if (bk) bank = bk[1].trim();
  return { iban: payee ? payee.iban : null, ibanValid: payee ? payee.valid : null, ibanFixed: payee ? payee.fixed : false, bic, bank, directDebit, all: cls.map(x => ({ iban: x.iban, valid: x.valid, debit: x.debit })) };
}

function purposeOf(lines, refs, type) {
  const r = labeled(lines, /(?<![\p{L}])(?:verwendungszweck|zahlungsreferenz|zahlungsgrund|überweisungstext)(?![\p{L}])/iu, s => {
    const c = s.replace(/^[\s:]+/, '').split('\t')[0].trim();
    return c.length >= 3 && c.length <= 140 && !/^bitte/i.test(c) ? c : null;
  });
  if (r) return { text: r.value, source: 'label' };
  const p = firstMatch(lines, /(?:bitte\s+(?:geben sie|immer)|unbedingt|stets)\s+(?:bei der (?:zahlung|überweisung)\s+)?(?:die|das|den|ihre|unser(?:e|en)?)?\s*(rechnungsnummer|kundennummer|kassenzeichen|aktenzeichen|steuernummer|vertragsnummer|referenz)\s*(\S.*)?\s*an/i);
  if (p && p.m[2] && /\d/.test(p.m[2])) return { text: p.m[2].replace(/[.:]$/, '').trim(), source: 'hint' };
  const parts = [];
  if (refs.kassenzeichen) parts.push(refs.kassenzeichen);
  if (type === 'bescheid' && refs.steuernummer) parts.push(`StNr ${refs.steuernummer}`);
  if (refs.rechnungsnummer) parts.push(`Rechnung ${refs.rechnungsnummer}`);
  if (refs.kundennummer) parts.push(`Kd-Nr ${refs.kundennummer}`);
  if (!parts.length && refs.aktenzeichen) parts.push(`Az ${refs.aktenzeichen}`);
  if (!parts.length && refs.vertragsnummer) parts.push(`Vertrag ${refs.vertragsnummer}`);
  return parts.length ? { text: parts.join(' ').slice(0, 140), source: 'refs' } : null;
}

// ------------------------------------------------------------------ dates & deadlines
const DATE_GOOD = /(?:^|\s|\t)(?:datum|rechnungsdatum|briefdatum|ausstellungsdatum|ausgestellt am|erstellt am|bescheid vom|schreiben vom|druckdatum|belegdatum|bon-?datum|kaufdatum|buchungsdatum)\s*:?\s*$/i;
const DATE_BAD = /(?:geburtsdatum|geb\.|geboren|zeitraum|leistungszeitraum|abrechnungszeitraum|vertragsbeginn|beginn|ende|vertragsende|laufzeit|fällig|zahlbar|bis zum|bis spätestens|bis|spätestens|ab dem|ab|gültig|lieferdatum|leistungsdatum|eingang|eingegangen|antrag vom|ihr schreiben vom|ihre nachricht vom|ihr antrag vom|letzte zahlung|abgebucht am|valuta|buchungstag|zählerstand|ablesung|frist)\s*:?\s*(?:vom\s*)?$/i;
function letterDateOf(lines) {
  const cands = [];
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    for (const d of findDates(l)) {
      const before = l.slice(Math.max(0, d.index - 40), d.index);
      const after = l.slice(d.end, d.end + 12);
      let s = 0;
      if (DATE_GOOD.test(before)) s += 6;
      if (/^[\p{Lu}][\p{L}.\- ]{1,30},\s*(?:den\s*)?$/u.test(before.split('\t').pop().trim() + ' ') || /^[\p{Lu}][\p{L}.\- ]{1,30},\s*(?:den\s*)?$/u.test(before.split('\t').pop())) s += 6;
      if (/^\s*$/.test(before.split('\t').pop()) && cellsOf(l).length >= 1 && l.trim().endsWith(d.raw.trim()) && i < n * 0.4) s += 1.5;
      if (DATE_BAD.test(before)) s -= 6;
      if (/^\s*(?:-|bis)\s*\d/.test(after)) s -= 5; // period "01.01. - 31.12."
      if (/^\s*\d{1,2}:\d{2}/.test(after)) s += 2; // receipt timestamp
      if (/bis\s*$|-\s*$/.test(before)) s -= 4;
      if (i < Math.max(14, n * 0.35)) s += 2; else if (i > n * 0.7) s -= 1;
      cands.push({ iso: d.iso, s, i });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s || a.i - b.i);
  return cands[0].s > -2 ? cands[0].iso : null;
}

const NUMWORDS = { ein: 1, eine: 1, einem: 1, einen: 1, einer: 1, eines: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, vierzehn: 14, achtzehn: 18, zwanzig: 20, dreißig: 30, vierundzwanzig: 24 };
const numOf = w => (/^\d+$/.test(w) ? +w : NUMWORDS[lower(w)] || null);
const NUMW = '(\\d{1,3}|eine[mnrs]?|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|vierzehn|achtzehn|zwanzig|dreißig|vierundzwanzig)';

function deadlinesOf(lines, letterIso, type, bank) {
  const out = [];
  const flat = lines.join(' \n ');
  const seen = new Set();
  const add = d => { const k = `${d.kind}|${d.date}`; if (!d.date || seen.has(k)) return; seen.add(k); out.push(d); };
  const snippet = (idx, len = 110) => flat.slice(Math.max(0, idx - 40), idx + len).replace(/\s*\n\s*/g, ' ').trim();
  // explicit dates after deadline words
  const re = /(zahlbar|fällig(?:keit)?|zu zahlen|überweisen|begleichen|zahlungsziel|zahlungseingang|spätestens|bis spätestens|bis zum|bis|frist|termin|abgabefrist|einreichen|vorlegen|zurücksenden|melden sie sich|wirksam zum|endet|vertragsende|laufzeitende|beendet|gekündigt zum|kündigung zum|zum|abbuchung|abgebucht|eingezogen|einzug)[^.\n]{0,70}?/giu;
  let m;
  while ((m = re.exec(flat))) {
    const windowStr = flat.slice(m.index, m.index + m[0].length + 30);
    const ds = findDates(windowStr);
    if (!ds.length) continue;
    const d = ds[0];
    const kw = lower(m[1]);
    const ctx = lower(flat.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20));
    const sStart = Math.max(flat.lastIndexOf('. ', m.index), flat.lastIndexOf('\n \n', m.index), m.index - 160);
    let sEnd = flat.indexOf('. ', m.index + m[0].length);
    if (sEnd < 0 || sEnd > m.index + 200) sEnd = m.index + 200;
    const sentence = lower(flat.slice(Math.max(0, sStart), sEnd));
    let kind = 'frist';
    if (/abbuchung|abgebucht|eingezogen|einzug/.test(kw) || (/lastschrift|abgebucht|eingezogen|abbuchen/.test(sentence) && bank && bank.directDebit && /zahl|fällig/.test(kw))) kind = 'abbuchung';
    else if (/zahlbar|fällig|zu zahlen|überweisen|begleichen|zahlungsziel|zahlungseingang/.test(kw) || /zahl|überweis|begleich|betrag/.test(ctx)) kind = 'zahlung';
    else if (/endet|vertragsende|laufzeitende|beendet|gekündigt zum|kündigung zum|wirksam zum/.test(kw) || (/^zum$/.test(kw) && /kündig|vertrag|mitgliedschaft|beend/.test(ctx))) kind = 'vertragsende';
    else if (/^zum$/.test(kw)) continue;
    else if (/^bis$/.test(kw) && !/frist|spätestens|einreich|vorleg|zurück|meld|abgabe|einspruch|widerspruch|antwort|nachweis|unterlagen/.test(ctx) && kind === 'frist') continue;
    if (letterIso && d.iso < letterIso && kind !== 'vertragsende') continue;
    if (/(?:vom|zeitraum)\s*$/i.test(windowStr.slice(0, d.index))) continue;
    add({ date: d.iso, kind, label: KIND_LABEL[kind], source: snippet(m.index), computed: false });
  }
  // relative: "innerhalb von 14 Tagen", "binnen 2 Wochen", "innerhalb eines Monats"
  const rel = new RegExp(`(innerhalb|binnen|in den nächsten|spätestens)\\s+(?:von\\s+)?${NUMW}\\s+(tagen|tage|tag|wochen|woche|monaten|monate|monats|monat)(?![\\p{L}])(?:\\s+(nach|ab|seit)\\s+([\\p{L}-]+(?:\\s+[\\p{L}-]+){0,2}))?`, 'giu');
  while ((m = rel.exec(flat))) {
    const n = numOf(m[2]);
    if (!n || !letterIso) continue;
    const unit = lower(m[3]);
    const ref = lower(m[5] || '');
    const ctx = lower(flat.slice(Math.max(0, m.index - 140), m.index + 160));
    const isRb = /widerspruch|einspruch|klage|rechtsbehelf/.test(ctx) && /bekanntgabe|zugang|zustellung|bekanntgegeben/.test(ref + ctx.slice(140));
    if (isRb) {
      const f = bekanntgabeFrist(letterIso, unit.startsWith('woche') ? { weeks: n } : { months: unit.startsWith('monat') ? n : 0, weeks: unit.startsWith('tag') ? 0 : 0 });
      let date = f.date;
      if (unit.startsWith('tag')) date = nextWorkday(addDays(f.bekanntgabe, n));
      add({ date, kind: 'widerspruch', label: /einspruch/.test(ctx) ? 'Einspruchsfrist' : 'Widerspruchsfrist', source: snippet(m.index, 160), computed: true, hint: f.hint, bekanntgabe: f.bekanntgabe });
      continue;
    }
    let date = unit.startsWith('tag') ? addDays(letterIso, n) : unit.startsWith('woche') ? addDays(letterIso, n * 7) : addMonths(letterIso, n);
    let kind = /zahl|überweis|begleich|betrag|rechnung|forderung|ausgleich/.test(ctx) ? 'zahlung' : 'frist';
    if (kind === 'zahlung' && bank && bank.directDebit && /abbuch|lastschrift|einzieh|eingezogen/.test(ctx)) kind = 'abbuchung';
    const per = unit.startsWith('tag') ? (n === 1 ? '1 Tag' : `${n} Tage`) : unit.startsWith('woche') ? (n === 1 ? '1 Woche' : `${n} Wochen`) : n === 1 ? '1 Monat' : `${n} Monate`;
    let hint = `Berechnet: ${deDate(letterIso)} + ${per} – ohne Gewähr.`;
    if (/zugang|erhalt|eingang|zustellung/.test(ref)) { date = addDays(date, 3); hint = `Berechnet: ${deDate(letterIso)} + ${per} + ca. 3 Tage Postlaufzeit (Zugang) – ohne Gewähr.`; }
    add({ date, kind, label: KIND_LABEL[kind], source: snippet(m.index, 140), computed: true, hint });
  }
  // "Einspruch/Widerspruch ... innerhalb eines Monats" phrased as "binnen eines Monats nach Bekanntgabe" handled above;
  // Rechtsbehelfsbelehrung without explicit number: "innerhalb eines Monats" (covered) – else fall back to 1 month
  if (letterIso && type === 'bescheid' && !out.some(d => d.kind === 'widerspruch') && /rechtsbehelfsbelehrung|widerspruch|einspruch/i.test(flat) && /monat/i.test(flat)) {
    const f = bekanntgabeFrist(letterIso);
    add({ date: f.date, kind: 'widerspruch', label: /einspruch/i.test(flat) ? 'Einspruchsfrist' : 'Widerspruchsfrist', source: '', computed: true, hint: f.hint, bekanntgabe: f.bekanntgabe });
  }
  // "sofort fällig" / "zahlbar sofort"
  if (letterIso && /(?:sofort|umgehend)\s+(?:fällig|zahlbar|zu zahlen)|zahlbar sofort|fällig sofort/i.test(flat) && !out.some(d => d.kind === 'zahlung')) add({ date: letterIso, kind: 'zahlung', label: 'Zahlung sofort fällig', source: '', computed: true, hint: 'Laut Schreiben sofort fällig.' });
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
const KIND_LABEL = { zahlung: 'Zahlung fällig', frist: 'Frist', vertragsende: 'Vertragsende', abbuchung: 'Abbuchung (Lastschrift)', widerspruch: 'Widerspruchsfrist', kuendigung: 'Kündigungsfrist' };

function primaryDeadline(deadlines, type) {
  const by = k => deadlines.filter(d => d.kind === k);
  if (type === 'bescheid') return by('widerspruch')[0] || by('zahlung')[0] || by('frist')[0] || null;
  if (type === 'rechnung' || type === 'mahnung') { const z = by('zahlung'); return z[z.length - 1] || by('frist')[0] || null; }
  if (type === 'versicherung') { const z = by('zahlung'); return z[z.length - 1] || by('kuendigung')[0] || by('frist')[0] || null; }
  if (type === 'vertrag') return by('kuendigung')[0] || by('vertragsende')[0] || by('frist')[0] || null;
  return by('frist')[0] || by('zahlung')[0] || by('widerspruch')[0] || null;
}

// ------------------------------------------------------------------ contact
function contactOf(lines, rcpt) {
  const text = lines.join('\n');
  let phone = null;
  const tel = /(?<![\p{L}])(?:tel(?:efon)?\.?|fon|telefonnummer|hotline|service-?(?:hotline|telefon|nummer)?|(?:service)?rufnummer|kundenservice|sekretariat|zentrale|kundenhotline|durchwahl|rufen sie (?:uns )?an(?: unter)?|erreichen sie uns unter|unter der (?:rufnummer|nummer))\s*(?:\([^)]*\))?\s*:?\s*((?:\+49|0049|0)[\d\s/()-]{5,22}\d)/giu;
  let m;
  while ((m = tel.exec(text))) {
    const pre = text.slice(Math.max(0, m.index - 12), m.index);
    if (/ihre|mobil|fax/i.test(pre)) continue;
    const digits = m[1].replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) continue;
    phone = m[1].replace(/\s{2,}/g, ' ').trim();
    break;
  }
  if (!phone) {
    // unlabelled number in the letterhead or footer
    const area = [...lines.slice(0, 8), ...lines.slice(-6)].join('\n');
    const pr = /(?<![\d\p{L}.,/])((?:\+49\s?|0)\d{2,5}(?:[ /-]?\d{2,}){1,4})(?![\d,.])/gu;
    let q;
    while ((q = pr.exec(area))) {
      const pre = area.slice(Math.max(0, q.index - 16), q.index);
      const dg = q[1].replace(/\D/g, '');
      if (dg.length < 7 || dg.length > 13 || /fax|iban|nr\.?\s*$|nummer|konto|blz|hrb|plz|ust|steuer/i.test(pre) || /^\d{5}\s/.test(q[1] + ' ')) continue;
      phone = q[1].trim();
      break;
    }
  }
  let email = null;
  const em = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const rn = rcpt && rcpt.name ? lower(rcpt.name).split(/\s+/).pop() : null;
  const priv = /@(?:gmail|gmx|web|t-online|outlook|hotmail|yahoo|icloud|posteo|mailbox|freenet|aol)\./i;
  email = em.find(e => !priv.test(e) && !(rn && lower(e).includes(rn))) || em.find(e => !(rn && lower(e).includes(rn))) || null;
  let web = (/(?<![@\w])(?:https?:\/\/)?(www\.[a-z0-9.-]+\.[a-z]{2,})/i.exec(text) || [])[1] || null;
  return { phone, email, web };
}

// ------------------------------------------------------------------ contracts
function contractOf(lines, letterIso, type, subtype) {
  const text = lines.join(' \n ');
  const c = {};
  const dateAfter = re => { const m = re.exec(text); if (!m) return null; const ds = findDates(text.slice(m.index + m[0].length - 2, m.index + m[0].length + 30)); return ds.length ? ds[0].iso : null; };
  c.start = dateAfter(/(?:vertragsbeginn|beginn der mitgliedschaft|mitgliedschaftsbeginn|vertragsstart|laufzeitbeginn|versicherungsbeginn|beginn der laufzeit|beginn des vertrag(?:e)?s|vertrag beginnt am|aktiviert am|freischaltung am|beginnt am|beginn)\s*:?\s*(?:am|zum|ab)?\s*/iu);
  if (!c.start) { const fm = /am\s+(\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4})\s+(?:freigeschaltet|aktiviert|in betrieb genommen|geschaltet)/iu.exec(text); if (fm) c.start = parseDate(fm[1]); }
  c.end = dateAfter(/(?:vertragsende|laufzeitende|ende der (?:mindest)?(?:vertrags)?laufzeit|ende der mitgliedschaft|endet (?:am|zum|mit ablauf des)|endet daher (?:am|zum|mit ablauf des)|beendet zum|gekündigt zum|kündigung (?:zum|wirksam zum|ist wirksam zum)|wirksam zum|läuft\s+(?:noch\s+)?(?:bis zum|bis|aus am)|laufzeit bis(?: zum)?|befristet bis(?: zum)?|vertragslaufzeit bis(?: zum)?|ablauf(?:datum)?|versicherungsablauf|mindestlaufzeit bis(?: zum)?)\s*:?\s*/iu);
  let m = new RegExp(`(?:mindest(?:vertrags)?laufzeit|vertragslaufzeit|erstlaufzeit|laufzeit|vertragsdauer)\\s*(?:beträgt|von|:)?\\s*(?:mindestens\\s+)?${NUMW}\\s*(monat|monate|monaten|jahr|jahre|jahren)`, 'iu').exec(text);
  if (m) c.minTermMonths = numOf(m[1]) * (/jahr/i.test(m[2]) ? 12 : 1);
  m = new RegExp(`kündigungsfrist\\s*(?:beträgt|von|:|ist)?\\s*(?:jeweils\\s+)?${NUMW}\\s*(tag|tage|tagen|woche|wochen|monat|monate|monaten)|mit einer frist von\\s*${NUMW}\\s*(tag|tage|tagen|woche|wochen|monat|monate|monaten)|${NUMW}\\s*(monat|monate|monaten|wochen)\\s+(?:vor|zum)\\s+(?:ablauf|ende)`, 'iu').exec(text);
  if (m) {
    const n = numOf(m[1] || m[3] || m[5]), u = lower(m[2] || m[4] || m[6] || '');
    if (n) { if (u.startsWith('monat')) c.noticeMonths = n; else if (u.startsWith('woch')) c.noticeDays = n * 7; else c.noticeDays = n; }
  }
  m = new RegExp(`verlängert sich\\s+(?:der vertrag\\s+|die mitgliedschaft\\s+)?(?:automatisch\\s+|stillschweigend\\s+|jeweils\\s+)*(?:um\\s+(?:jeweils\\s+|weitere\\s+)?${NUMW}\\s*(monat|monate|monaten|jahr|jahre|jahren)|auf unbestimmte zeit)`, 'iu').exec(text);
  if (m) { if (m[1]) c.renewalMonths = numOf(m[1]) * (/jahr/i.test(m[2]) ? 12 : 1); else c.renewalIndefinite = true; }
  if (/(?:jederzeit|monatlich)\s+(?:mit einer frist von\s+(?:einem|1)\s+monat\s+)?kündbar|jederzeit kündbar|monatlich kündbar/i.test(text)) c.renewalIndefinite = true;
  if (subtype === 'kuendigungsbestaetigung') { c.cancelled = true; if (!c.end) { const dl = findDates(text.replace(/\n/g, ' ')).find(d => d.iso > (letterIso || '0')); if (dl) c.end = dl.iso; } }
  m = /(?:monatlich(?:e[rn]?)?\s+(?:grundgebühr|beitrag|preis|kosten|gebühr)|grundgebühr|mitgliedsbeitrag|monatsbeitrag|beitrag)\s*(?:von|beträgt|:)?\s*(?:monatlich\s*)?([\d.]+,\d{2})/iu.exec(text);
  if (m) c.monthly = parseAmount(m[1]);
  const any = c.start || c.end || c.minTermMonths || c.noticeMonths || c.noticeDays || c.renewalMonths || c.renewalIndefinite || c.cancelled;
  if (!any) return null;
  if (!c.end && c.start && c.minTermMonths) c.end = addDays(addMonths(c.start, c.minTermMonths), -1);
  return c;
}

/**
 * Next cancellation date for a contract.
 * → {status:'gekuendigt'|'aktiv'|'unbekannt', end, deadline, text, noticeText}
 */
export function nextCancellation(c, todayIso = isoDate(new Date())) {
  if (!c) return { status: 'unbekannt' };
  const noticeText = c.noticeMonths ? `${c.noticeMonths} ${c.noticeMonths === 1 ? 'Monat' : 'Monate'}` : c.noticeDays ? (c.noticeDays % 7 === 0 ? `${c.noticeDays / 7} ${c.noticeDays === 7 ? 'Woche' : 'Wochen'}` : `${c.noticeDays} Tage`) : null;
  const minus = iso => (c.noticeMonths ? addMonths(iso, -c.noticeMonths) : c.noticeDays ? addDays(iso, -c.noticeDays) : iso);
  if (c.cancelled) return { status: 'gekuendigt', end: c.end || null, deadline: null, noticeText, text: c.end ? `Gekündigt – der Vertrag endet am ${deDate(c.end)}.` : 'Gekündigt.' };
  let end = c.end;
  if (!end) {
    if (c.renewalIndefinite) {
      const e = c.noticeMonths || c.noticeDays ? (c.noticeMonths ? addMonths(todayIso, c.noticeMonths) : addDays(todayIso, c.noticeDays)) : addMonths(todayIso, 1);
      return { status: 'aktiv', anytime: true, end: e, deadline: todayIso, noticeText: noticeText || '1 Monat', text: `Jederzeit kündbar mit ${noticeText || 'einem Monat'} Frist – bei Kündigung heute endet der Vertrag am ${deDate(e)}.` };
    }
    return { status: 'unbekannt', end: null, deadline: null, noticeText, text: noticeText ? `Kündigungsfrist ${noticeText}.` : '' };
  }
  let deadline = minus(end);
  let rolled = 0;
  while (deadline < todayIso && rolled < 40) {
    if (c.renewalIndefinite || (!c.renewalMonths && (c.minTermMonths || c.start) && end < todayIso)) {
      // after the minimum term: cancellable at any time with the notice period (§ 309 Nr. 9 BGB / TKG)
      const n = c.noticeMonths || (c.noticeDays ? 0 : 1);
      const e = n ? addMonths(todayIso, n) : addDays(todayIso, c.noticeDays);
      return { status: 'aktiv', anytime: true, end: e, deadline: todayIso, noticeText: noticeText || '1 Monat', text: `Mindestlaufzeit vorbei – jederzeit kündbar mit ${noticeText || 'einem Monat'} Frist (Ende frühestens ${deDate(e)}).` };
    }
    end = addMonths(end, c.renewalMonths || 12);
    if (c.end && /-(?:28|29|30|31)$/.test(c.end)) end = endOfMonth(end);
    deadline = minus(end);
    rolled++;
  }
  return {
    status: 'aktiv', end, deadline, noticeText, rolled,
    text: noticeText ? `Kündigungsfrist ${noticeText}, nächster Termin ${deDate(end)} – Kündigung muss bis ${deDate(deadline)} eingehen.` : `Nächster Termin ${deDate(end)}.`,
  };
}

// ------------------------------------------------------------------ receipts (Kassenbon / Rechnung für die Steuer)
const PAYMENT = [
  ['ec', /girocard|ec-?karte|ec[- ]?cash|electronic cash|debitkarte|maestro|v pay|kartenzahlung|(?<![\p{L}])karte(?![\p{L}])/iu, 'Girocard / EC-Karte'],
  ['kreditkarte', /kreditkarte|visa|mastercard|amex|american express/i, 'Kreditkarte'],
  ['paypal', /paypal/i, 'PayPal'],
  ['ueberweisung', /überweisung|überwiesen|überweisen|bankeinzug|auf (?:unser|das folgende) konto|bankverbindung/i, 'Überweisung'],
  ['lastschrift', /lastschrift|abgebucht|eingezogen/i, 'Lastschrift'],
  ['bar', /(?<![\p{L}])bar(?:geld|zahlung|\s+eur|\s+gegeben|\s+\d|$)|gegeben|rückgeld|bar\s*:/imu, 'Bar'],
];
export const PAYMENT_LABELS = Object.fromEntries(PAYMENT.map(p => [p[0], p[2]]));

function vatOf(lines, total) {
  const rates = new Map();
  const get = r => { if (!rates.has(r)) rates.set(r, { rate: r, net: null, tax: null, gross: null }); return rates.get(r); };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/\t/g, ' ');
    const rm = /(?<![\d,])(19|7|16|5)(?:[,.]0{1,2})?\s?%/.exec(l);
    if (!rm) continue;
    const rate = +rm[1];
    const am = findAmounts(l.slice(rm.index + rm[0].length));
    const ctx = lower(l);
    if (am.length >= 3) {
      const [a, b, c] = am.slice(-3).map(x => x.value);
      if (Math.abs(a + b - c) <= 0.02) { Object.assign(get(rate), { net: a, tax: b, gross: c }); continue; }
      if (Math.abs(b + c - a) <= 0.02) { Object.assign(get(rate), { gross: a, net: b, tax: c }); continue; }
      if (Math.abs(a - b - c) <= 0.02) { Object.assign(get(rate), { gross: a, tax: b, net: c }); continue; }
    }
    if (am.length === 2) {
      const [a, b] = am.map(x => x.value);
      if (Math.abs(round2(a * rate / 100) - b) <= 0.02) { Object.assign(get(rate), { net: a, tax: b, gross: round2(a + b) }); continue; }
      if (Math.abs(round2(a * rate / (100 + rate)) - b) <= 0.02) { Object.assign(get(rate), { gross: a, tax: b, net: round2(a - b) }); continue; }
      if (Math.abs(round2(b * rate / 100) - a) <= 0.02) { Object.assign(get(rate), { net: b, tax: a, gross: round2(a + b) }); continue; }
    }
    if (am.length >= 1 && /mwst|ust|umsatzsteuer|mehrwertsteuer|steuer/.test(ctx)) {
      const v = am[am.length - 1].value;
      const g = get(rate);
      if (/netto/.test(ctx) && !/mwst\s*\d|enth/.test(ctx)) g.net = g.net ?? v;
      else if (g.tax == null) g.tax = v;
    }
  }
  // "Netto 100,00" / "Brutto 119,00" lines for a single rate
  const netParse = s => { const a = findAmounts(s.split('\t').slice(0, 2).join(' ')); return a.length ? a[0].value : null; };
  const netL = labeled(lines, /(?<![\p{L}])(?:summe netto|nettobetrag|nettosumme|zwischensumme netto|gesamt netto|netto gesamt|summe \(netto\))(?![\p{L}])/iu, netParse)
    || labeled(lines, /(?<![\p{L}])netto(?![\p{L}])/iu, s => (s.trim() ? netParse(s) : null));
  const list = [...rates.values()];
  if (list.length === 1) {
    const g = list[0];
    if (g.net == null && netL) g.net = netL.value;
    if (g.gross == null && total != null && (g.net == null || Math.abs(total - g.net - (g.tax || 0)) <= 0.05)) g.gross = total;
    if (g.tax == null && g.net != null && g.gross != null) g.tax = round2(g.gross - g.net);
    if (g.net == null && g.tax != null) g.net = g.gross != null ? round2(g.gross - g.tax) : round2(g.tax * 100 / g.rate);
    if (g.gross == null && g.net != null && g.tax != null) g.gross = round2(g.net + g.tax);
    if (g.tax == null && g.gross != null) { g.tax = round2(g.gross * g.rate / (100 + g.rate)); g.net = round2(g.gross - g.tax); }
  } else {
    for (const g of list) {
      if (g.net == null && g.tax != null) g.net = round2(g.tax * 100 / g.rate);
      if (g.gross == null && g.net != null && g.tax != null) g.gross = round2(g.net + g.tax);
      if (g.tax == null && g.net != null) g.tax = round2(g.net * g.rate / 100);
    }
  }
  return list.filter(g => g.tax != null || g.net != null).sort((a, b) => b.rate - a.rate);
}

function merchantOf(lines, letter) {
  if (letter && letter.sender && letter.sender.why !== 'first' && letter.sender.why !== 'domain') return letter.sender.name;
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    for (const c of cellsOf(lines[i])) {
      const t = c.replace(/^[*=#\s-]+|[*=#\s-]+$/g, '');
      if (t.length < 3 || findDates(t).length || /^\d/.test(t) || /\d{4,}/.test(t)) continue;
      if (/^(kassenbon|beleg|rechnung|quittung|willkommen|herzlich|vielen dank|tel|fon|fax|www|uid|st\.?-?nr|steuer|ust|filiale\s*\d|markt\s*\d|kasse|bon|datum|uhrzeit|eur|summe)/i.test(t)) continue;
      if (STREET.test(t) || PLZCITY.test(t)) continue;
      if (!/\p{L}{3,}/u.test(t)) continue;
      return t.replace(/\s{2,}/g, ' ');
    }
  }
  return letter && letter.sender ? letter.sender.name : null;
}

/** Receipt / invoice fields for the tax overview. */
export function extractReceipt(input, { letter = null } = {}) {
  const lines = Array.isArray(input) ? input : prepareText(input);
  const text = lines.join('\n');
  const L = letter || extractLetter(lines);
  // total (gross)
  const TOTAL = [
    [/zu zahlen|zahlbetrag|zu zahlender betrag/iu, 10], [/(?<![\p{L}])summe(?:\s+eur)?(?![\p{L}])|gesamtsumme|summe brutto|bruttosumme/iu, 9],
    [/gesamtbetrag|rechnungsbetrag|endbetrag|gesamt\s*\(?brutto\)?|brutto\s*gesamt|betrag der zuwendung|spendenbetrag|gesamtpreis/iu, 8],
    [/(?<![\p{L}])(?:total|gesamt)(?![\p{L}])/iu, 6], [/(?<![\p{L}])brutto(?:betrag)?(?![\p{L}])/iu, 5], [/(?<![\p{L}])betrag(?![\p{L}])/iu, 3],
  ];
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/zwischensumme|gegeben|rückgeld|netto(?!.*brutto)|mwst|ust\.?|umsatzsteuer|steuer\s*%|davon|arbeitskosten|lohnkosten|materialkosten|anzahlung|bereits gezahlt|abschlag|\d\s?%/i.test(l) && !/zu zahlen|summe brutto|gesamtbetrag|rechnungsbetrag|betrag der zuwendung/i.test(l)) continue;
    for (const [re, p] of TOTAL) {
      const m = re.exec(l);
      if (!m) continue;
      let a = amountAfter(l, m, { lastInRow: true });
      if (!a && lines[i + 1] && !findAmounts(l).length && !lines[i + 1].replace(/€|eur(?:o)?/gi, '').replace(/[\d.,\s+-]/g, '')) a = findAmounts(lines[i + 1]).slice(-1)[0] || null;
      if (!a) continue;
      const v = a.value;
      if (v <= 0) continue;
      if (!best || p > best.p || (p === best.p && i > best.i)) best = { v, p, i };
      break;
    }
  }
  let total = best ? best.v : (L.amounts.main != null && L.amounts.main > 0 ? L.amounts.main : null);
  // date
  let date = null;
  const dl = labeled(lines, /(?<![\p{L}])(?:datum|belegdatum|rechnungsdatum|kaufdatum|bon-?datum|tag der zuwendung|datum der zuwendung)(?![\p{L}])/iu, s => parseDate(s.split('\t')[0]));
  if (dl) date = dl.value;
  if (!date) {
    for (const l of lines) { const m = /(\d{1,2}\.\d{1,2}\.\d{2,4})\s*(?:\/|-|um)?\s*\d{1,2}:\d{2}/.exec(l); if (m) { date = parseDate(m[1]); if (date) break; } }
  }
  if (!date) date = L.date;
  const vat = vatOf(lines, total);
  const net = vat.length ? round2(vat.reduce((s, g) => s + (g.net || 0), 0)) : null;
  let payment = null;
  for (const [id, re] of PAYMENT) { if (re.test(text)) { payment = id; break; } }
  if (payment === 'ueberweisung' && L.bank.directDebit) payment = 'lastschrift';
  if (!payment && L.bank.iban && !L.bank.directDebit) payment = 'ueberweisung';
  // § 35a: labour cost share
  let labor = null, laborNet = false;
  const LAB = /(?<![\p{L}])(?:arbeitskosten|lohnkosten|arbeitslohn|lohnanteil|arbeitsleistung|anteil (?:der )?arbeitskosten|montagekosten|davon lohn|lohn(?:-|\s)?und fahrtkosten|summe arbeitskosten|arbeits- und fahrtkosten)(?![\p{L}])/iu;
  const labC = [];
  for (let i = 0; i < lines.length; i++) {
    const m = LAB.exec(lines[i]);
    if (!m) continue;
    const ctxL = lines[i];
    const a = findAmounts(ctxL.slice(m.index + m[0].length).replace(/\([^)]*\)/g, ''));
    if (!a.length) continue;
    let s = 1;
    if (/inkl|brutto|enthalten|davon|anteil|35a|incl/i.test(ctxL)) s += 4;
    if (/\d\s*(?:std|h)\b|à|\sx\s/i.test(ctxL)) s -= 1;
    labC.push({ v: a[a.length - 1].value, s, gross: /inkl|brutto|enthalten|35a/i.test(ctxL) });
  }
  labC.sort((x, y) => y.s - x.s);
  if (labC.length) {
    labor = labC[0].v;
    if (!labC[0].gross) laborNet = true;
  }
  const donation = /zuwendungsbestätigung|bestätigung über (?:geld)?zuwendungen|spendenbescheinigung|spendenquittung/i.test(text);
  const merchant = merchantOf(lines, L);
  return {
    merchant, date, total, net, vat, payment, paymentLabel: payment ? PAYMENT_LABELS[payment] : null, labor, laborNet, donation,
    invoiceNo: L.refs.rechnungsnummer || null,
  };
}

// ------------------------------------------------------------------ tax categories (Steuer-Belege)
export const TAX_CATEGORIES = [
  { id: 'arbeitsmittel', label: 'Arbeitsmittel', group: 'Werbungskosten (Anlage N)', note: 'Geräte und Material für den Beruf. Bis 800 € netto (952 € brutto) im Kaufjahr voll absetzbar, darüber über die Nutzungsdauer verteilt.' },
  { id: 'fahrtkosten', label: 'Fahrtkosten', group: 'Werbungskosten (Anlage N)', note: 'Dienstreisen, Fahrten zu Fortbildungen. Der tägliche Arbeitsweg läuft über die Entfernungspauschale – dafür sind keine Belege nötig.' },
  { id: 'fortbildung', label: 'Fortbildung', group: 'Werbungskosten (Anlage N)', note: 'Kurse, Seminare, Fachliteratur, Prüfungsgebühren.' },
  { id: 'werbungskosten', label: 'Sonstige Werbungskosten', group: 'Werbungskosten (Anlage N)', note: 'z. B. Bewerbungen, Gewerkschaftsbeitrag, Kontoführung, beruflicher Umzug.' },
  { id: 'homeoffice', label: 'Homeoffice', group: 'Werbungskosten (Anlage N)', note: 'Homeoffice-Pauschale: 6 € pro Tag, höchstens 1.260 € im Jahr – dafür sind keine Belege nötig, nur die Anzahl der Tage.' },
  { id: 'versicherungen', label: 'Versicherungen', group: 'Sonderausgaben / Vorsorgeaufwendungen', note: 'Haftpflicht-, Unfall-, Berufsunfähigkeits-, Risikolebens-, Kranken- und Pflegeversicherung (Anlage Vorsorgeaufwand).' },
  { id: 'sonderausgaben', label: 'Sonderausgaben', group: 'Sonderausgaben', note: 'z. B. Kirchensteuer, eigene Berufsausbildung, Unterhalt an Ex-Partner, Altersvorsorge.' },
  { id: 'spenden', label: 'Spenden & Mitgliedsbeiträge', group: 'Sonderausgaben', note: 'Mit Zuwendungsbestätigung; bis 300 € reicht der Kontoauszug als Nachweis.' },
  { id: 'kinderbetreuung', label: 'Kinderbetreuung', group: 'Sonderausgaben (Anlage Kind)', note: 'Kita, Tagesmutter, Hort, Babysitter – ohne Verpflegung. Zahlung unbar.' },
  { id: 'krankheit', label: 'Krankheitskosten', group: 'Außergewöhnliche Belastungen', note: 'Zuzahlungen, Brille, Zahnersatz, ärztlich verordnete Behandlungen. Wirkt erst oberhalb der zumutbaren Belastung.' },
  { id: 'agb', label: 'Sonstige außergewöhnliche Belastungen', group: 'Außergewöhnliche Belastungen', note: 'z. B. Pflege, Beerdigung, Behinderung, Unwetterschäden.' },
  { id: 'haushaltsnah', label: 'Haushaltsnahe Dienstleistungen', group: '§ 35a EStG', note: '20 % der Arbeitskosten, höchstens 4.000 € Steuerermäßigung pro Jahr (z. B. Reinigung, Gartenpflege, Hausmeister). Nur unbar bezahlt.' },
  { id: 'handwerker', label: 'Handwerkerleistungen', group: '§ 35a EStG', note: '20 % der Arbeitskosten (ohne Material), höchstens 1.200 € Steuerermäßigung pro Jahr. Rechnung + Überweisung nötig, keine Barzahlung.' },
  { id: 'privat', label: 'Nicht steuerlich relevant', group: 'Sonstiges', note: 'Wird in der Übersicht nicht mitgezählt.' },
];
export const taxCategory = id => TAX_CATEGORIES.find(c => c.id === id) || TAX_CATEGORIES[TAX_CATEGORIES.length - 1];
const TAX_RULES = [
  ['spenden', /zuwendungsbestätigung|spende|spendenquittung|gemeinnützig|mitgliedsbeitrag/i, 6],
  ['handwerker', /handwerk|sanitär|heizung(?:swartung)?|elektro(?:installation|meister|betrieb)|maler|tapezier|dachdecker|fliesen|schreiner|tischler|klempner|reparatur|installation|montage|schornsteinfeger|rohrreinigung|meisterbetrieb|wartung/i, 4],
  ['haushaltsnah', /gebäudereinigung|reinigungsservice|haushaltshilfe|haushaltsnahe|gartenpflege|garten- und landschaftsbau|rasen mähen|hausmeister|treppenhausreinigung|winterdienst|fensterreinigung|pflegedienst|umzugsunternehmen|hundebetreuung/i, 5],
  ['kinderbetreuung', /kita|kindertagesstätte|kindergarten|tagesmutter|tagesvater|kindertagespflege|hort|babysitter|ferienbetreuung|krippe|betreuungsbeitrag|elternbeitrag/i, 6],
  ['krankheit', /apotheke|zuzahlung|rezept|arzt|ärztin|zahnarzt|praxis|optiker|brille|kontaktlinsen|hörgerät|physiotherapie|krankengymnastik|heilpraktiker|goä|klinik|krankenhaus|medikament/i, 4],
  ['versicherungen', /haftpflicht|unfallversicherung|berufsunfähigkeit|risikolebens|krankenversicherung|pflegeversicherung|versicherungsbeitrag|beitragsrechnung/i, 4],
  ['fortbildung', /seminar|fortbildung|weiterbildung|schulung|lehrgang|kursgebühr|kurs(?:gebühr)?|teilnahmegebühr|prüfungsgebühr|ihk|akademie|webinar|zertifizierung|workshop/i, 4],
  ['arbeitsmittel', /laptop|notebook|computer|pc-?system|monitor|bildschirm|drucker|tastatur|maus|headset|schreibtisch|bürostuhl|software|lizenz|toner|druckerpatrone|aktentasche|arbeitskleidung|berufskleidung|sicherheitsschuhe|fachbuch|ipad|tablet|smartphone|handy|router|dockingstation|webcam|ssd|festplatte|bürobedarf|ordner|papier/i, 3],
  ['fahrtkosten', /bahn|db fernverkehr|deutsche bahn|fahrkarte|ticket|bahncard|flug|hotel|übernachtung|taxi|parkhaus|parkgebühr|maut|mietwagen|carsharing|reisekosten|dienstreise|tankstelle|kraftstoff|super e10|diesel/i, 3],
  ['werbungskosten', /gewerkschaft|bewerbung|kontoführung|berufsverband|umzug|steuerberat|lohnsteuerhilfe/i, 3],
  ['sonderausgaben', /kirchensteuer|riester|rürup|basisrente|studiengebühr|semesterbeitrag|berufsausbildung|schulgeld/i, 4],
];
/** Suggest a tax category for a receipt text. → {id, confidence} */
export function suggestTaxCategory(text, receipt = null) {
  const t = String(text || '');
  const scores = {};
  for (const [id, re, w] of TAX_RULES) {
    const g = new RegExp(re.source, 'gi');
    const n = Math.min(3, (t.match(g) || []).length);
    if (n) scores[id] = (scores[id] || 0) + w * (1 + 0.3 * (n - 1));
  }
  if (receipt && receipt.donation) scores.spenden = (scores.spenden || 0) + 10;
  if (receipt && receipt.labor) { scores.handwerker = (scores.handwerker || 0) + 3; if (scores.haushaltsnah) scores.haushaltsnah += 2; }
  if (/supermarkt|lebensmittel|getränke|drogerie|kosmetik|bäckerei|restaurant|gaststätte|imbiss|kino|bekleidung|mode/i.test(t) && Object.values(scores).every(v => v < 5)) scores.privat = (scores.privat || 0) + 4;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { id: 'privat', confidence: 0.2 };
  const [id, s1] = ranked[0];
  const s2 = ranked[1] ? ranked[1][1] : 0;
  return { id, confidence: Math.round(Math.min(0.95, 0.4 + (s1 - s2) / 12 + s1 / 40) * 100) / 100 };
}

// ------------------------------------------------------------------ folder / tag suggestion
export function suggestFiling(r) {
  const t = typeInfo(r.type);
  const year = (r.date || '').slice(0, 4) || String(new Date().getFullYear());
  let folder = t.plural;
  if (r.type === 'bescheid' && r.subtype === 'steuer') folder = 'Steuer';
  if (r.type === 'rechnung' && r.subtype === 'kassenbon') folder = 'Belege';
  if (r.type === 'sonstiges' && r.subtype === 'spendenquittung') folder = 'Steuer';
  const tags = [t.label, year];
  const s = r.sender && r.sender.name ? r.sender.name.replace(LEGAL, '').replace(/\s{2,}/g, ' ').trim() : '';
  if (s && s.length <= 30) tags.push(s);
  if (r.subtype && SUBTYPE_LABELS[r.subtype] && r.subtype !== 'behoerde') tags.push(SUBTYPE_LABELS[r.subtype]);
  return { parent: 'Post', folder, tags: [...new Set(tags)].slice(0, 4) };
}

// ------------------------------------------------------------------ main entry
/**
 * Understand a letter. `opts.today` (ISO) only influences computed contract dates.
 * @returns {object} see module header
 */
export function extractLetter(input, opts = {}) {
  const lines = Array.isArray(input) ? input : prepareText(input);
  const cls = classify(lines);
  const rcpt = recipientBlock(lines);
  const sender = senderOf(lines, rcpt);
  const date = letterDateOf(lines);
  const refs = refsOf(lines);
  const amounts = amountsOf(lines, cls.type);
  const bank = bankOf(lines);
  if (cls.type === 'kontoauszug' || cls.type === 'lohnabrechnung') { bank.iban = null; bank.bic = null; bank.ibanValid = null; }
  const purpose = purposeOf(lines, refs, cls.type);
  const deadlines = deadlinesOf(lines, date, cls.type, bank);
  const contact = contactOf(lines, rcpt);
  const contract = ['vertrag', 'versicherung', 'rechnung', 'sonstiges', 'werbung'].includes(cls.type) || /laufzeit|kündigungsfrist|vertragsende/i.test(lines.join(' ')) ? contractOf(lines, date, cls.type, cls.subtype) : null;
  const today = opts.today || isoDate(new Date());
  let cancel = null;
  if (contract) {
    cancel = nextCancellation(contract, today);
    if (cancel.status === 'aktiv' && cancel.deadline && !cancel.anytime) deadlines.push({ date: cancel.deadline, kind: 'kuendigung', label: 'Kündigungsfrist', source: '', computed: true, hint: `${cancel.text} Ohne Gewähr – bitte Vertragsbedingungen prüfen.` });
  }
  const due = primaryDeadline(deadlines, cls.type);
  const subject = subjectLine(lines);
  const result = {
    type: cls.type, subtype: cls.subtype, typeLabel: typeInfo(cls.type).label, confidence: cls.confidence, ranked: cls.ranked,
    subject: subject ? subject.text.slice(0, 160) : null,
    sender, recipient: rcpt, date, refs, amounts, bank, purpose, deadlines, due, contact, contract, cancel,
    lines: lines.length,
  };
  result.filing = suggestFiling(result);
  result.facts = factsOf(result);
  return result;
}

/** Flat facts for the Dokumenten-Gedächtnis (contracts, amounts, deadlines, bank details). */
export function factsOf(r) {
  const subject = r.sender ? r.sender.name : null;
  const out = [];
  const base = { subject, docType: r.type, subtype: r.subtype || null, letterDate: r.date || null };
  if (r.contract) out.push({ ...base, kind: 'vertrag', label: r.subtype === 'kuendigungsbestaetigung' ? 'Gekündigter Vertrag' : 'Vertrag', value: r.cancel ? r.cancel.text : '', data: { ...r.contract, cancel: r.cancel, refs: r.refs } });
  if (r.amounts && r.amounts.main != null) out.push({ ...base, kind: 'betrag', label: r.amounts.mainLabel || 'Betrag', value: formatAmount(r.amounts.main), data: { amount: r.amounts.main, art: r.amounts.art } });
  for (const d of r.deadlines || []) out.push({ ...base, kind: 'frist', label: d.label, value: deDate(d.date), date: d.date, data: { kind: d.kind, computed: !!d.computed, hint: d.hint || null } });
  if (r.bank && r.bank.iban) out.push({ ...base, kind: 'iban', label: 'IBAN', value: formatIban(r.bank.iban), data: { iban: r.bank.iban, bic: r.bank.bic, bank: r.bank.bank } });
  for (const [k, v] of Object.entries(r.refs || {})) out.push({ ...base, kind: 'nummer', label: REF_NAMES[k] || k, value: v, data: { ref: k } });
  if (r.contact && (r.contact.phone || r.contact.email)) out.push({ ...base, kind: 'kontakt', label: 'Kontakt', value: [r.contact.phone, r.contact.email].filter(Boolean).join(' · '), data: r.contact });
  return out;
}
export const REF_NAMES = {
  kundennummer: 'Kundennummer', rechnungsnummer: 'Rechnungsnummer', vertragsnummer: 'Vertragsnummer', aktenzeichen: 'Aktenzeichen', steuernummer: 'Steuernummer',
  steuerid: 'Steuer-ID', versichertennummer: 'Versichertennummer', personalnummer: 'Personalnummer', mandatsreferenz: 'Mandatsreferenz', glaeubigerid: 'Gläubiger-ID',
};

/** Letter + receipt analysis in one go. */
export function analyze(text, opts = {}) {
  const lines = prepareText(text);
  const letter = extractLetter(lines, opts);
  const receipt = extractReceipt(lines, { letter });
  const tax = suggestTaxCategory(lines.join('\n'), receipt);
  return { ...letter, receipt, tax };
}
