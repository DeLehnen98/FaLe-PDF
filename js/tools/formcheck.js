// „Prüfen vor dem Speichern“: finds what would make a form come back – empty required fields, a date that does not
// exist, an IBAN with a typo (check digits), an incomplete e-mail address, a postcode with letters, text in a number
// field. Rules come from the PDF itself (Pflichtfeld flag, the field's own format: AFDate_/AFNumber_/AFSpecial_) and
// from the field's name or label („IBAN“, „Geburtsdatum“, „E-Mail“, „PLZ“ …). Nothing leaves the device.

const RX = {
  iban: /\biban\b|kontonummer \(iban\)/i,
  date: /datum|\bdate\b|geburtstag|geboren am|\bdob\b|\bfecha\b|\bdata\b/i,
  mail: /e-?mail|\bmail\b|courriel|correo/i,
  zip: /\bplz\b|postleitzahl|\bzip\b|postcode|postal code|code postal|\bcap\b/i,
};

/** The field's own format from its JavaScript actions (/AA /F or /K): {kind:'date', pattern} | {kind:'number'} | {kind:'zip'}. */
export function formatSpec(PDFLib, dict) {
  try {
    const { PDFName, PDFDict, PDFString, PDFHexString, PDFStream } = PDFLib;
    const aa = dict.lookup(PDFName.of('AA'));
    if (!(aa instanceof PDFDict)) return null;
    let js = '';
    for (const k of ['F', 'K']) {
      const a = aa.lookup(PDFName.of(k));
      if (!(a instanceof PDFDict)) continue;
      const s = a.lookup(PDFName.of('JS'));
      if (s instanceof PDFString || s instanceof PDFHexString) js += s.decodeText() + '\n';
      else if (s instanceof PDFStream) {
        try { js += new TextDecoder('latin1').decode(PDFLib.decodePDFRawStream(s).decode()) + '\n'; } catch { /* unreadable */ }
      }
    }
    let m = js.match(/AFDate_(?:Format|Keystroke)Ex\(\s*["']([^"']+)["']/);
    if (m) return { kind: 'date', pattern: m[1] };
    m = js.match(/AFDate_(?:Format|Keystroke)\(\s*(\d+)/);
    if (m) return { kind: 'date', pattern: ['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][+m[1]] || '' };
    if (/AFNumber_(?:Format|Keystroke)|AFPercent_/.test(js)) return { kind: 'number' };
    m = js.match(/AFSpecial_(?:Format|Keystroke)\(\s*(\d)/);
    if (m && (m[1] === '0' || m[1] === '1')) return { kind: 'zip' };
  } catch { /* no format */ }
  return null;
}

/** What to check for one field: {required, kind: 'iban'|'date'|'mail'|'zip'|'number'|null, pattern}. */
export function ruleFor({ name = '', label = '', type = 'text', required = false, fmt = null }) {
  const text = `${label} ${name}`.replace(/[_.]+/g, ' ');
  let kind = fmt ? fmt.kind : null;
  if (!kind && type === 'text') {
    if (RX.iban.test(text)) kind = 'iban';
    else if (RX.mail.test(text)) kind = 'mail';
    else if (RX.zip.test(text) && !/\bort\b|\bstadt\b|\bcity\b|\btown\b|\bville\b|ciudad|citt|cidade|wohnort/i.test(text)) kind = 'zip'; // „PLZ / Ort“ holds both
    else if (RX.date.test(text)) kind = 'date';
  }
  return { required: !!required, kind, pattern: fmt && fmt.pattern || '' };
}

const IBAN_LEN = { DE: 22, AT: 20, CH: 21, LI: 21, LU: 20, FR: 27, NL: 18, BE: 16, IT: 27, ES: 24, PT: 25, PL: 28, CZ: 24, SK: 24, DK: 18,
  SE: 24, NO: 15, FI: 18, IE: 22, GB: 22, HU: 28, SI: 19, HR: 21, RO: 24, BG: 22, GR: 27, TR: 26, UA: 29, EE: 20, LV: 21, LT: 20, MT: 31, CY: 28 };

/** IBAN: country length + check digits (mod 97). */
export function ibanOk(v) {
  const s = String(v).replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const len = IBAN_LEN[s.slice(0, 2)];
  if (len && s.length !== len) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of r) {
    const d = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const c of d) rest = (rest * 10 + +c) % 97;
  }
  return rest === 1;
}

/** A date as people write it (24.12.2026, 24/12/26, 2026-12-24 …) → {y, m, d} | null; `order` = 'dmy' | 'mdy' | 'ymd'. */
export function parseDate(v, order = 'dmy') {
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m) return real(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2}|\d{4})$/);
  if (!m) return null;
  let y = +m[3];
  if (m[3].length === 2) y += y > 50 ? 1900 : 2000;
  return order === 'mdy' ? real(y, +m[1], +m[2]) : real(y, +m[2], +m[1]);
}
function real(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || y < 1000 || y > 2999) return { bad: true };
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d > days ? { bad: true } : { y, m: mo, d };
}

const dateHint = pattern => {
  if (/^m/i.test(pattern) && !/^mmm/i.test(pattern)) return 'Bitte als Datum eintragen, z. B. 12/24/2026.';
  if (/^y/i.test(pattern)) return 'Bitte als Datum eintragen, z. B. 2026-12-24.';
  return 'Bitte als Datum eintragen, z. B. 24.12.2026.';
};

/**
 * Check one value → null (fine) or a short message for the person.
 * `type`: text | check | radio | select | sig.
 */
export function problem(rule, value, type = 'text') {
  const empty = value == null || value === false || String(value).trim() === '';
  if (empty) {
    if (!rule.required) return null;
    if (type === 'check') return 'Bitte ankreuzen – das ist ein Pflichtfeld.';
    if (type === 'radio' || type === 'select') return 'Bitte eine Auswahl treffen – das ist ein Pflichtfeld.';
    if (type === 'sig') return null; // signature fields: the signature step tells its own story
    return 'Pflichtfeld – bitte ausfüllen.';
  }
  if (type !== 'text') return null;
  const v = String(value).trim();
  switch (rule.kind) {
    case 'iban':
      if (!ibanOk(v)) return 'Diese IBAN stimmt nicht – bitte Ziffer für Ziffer prüfen.';
      return null;
    case 'date': {
      const order = /^m/i.test(rule.pattern) && !/^mmm/i.test(rule.pattern) ? 'mdy' : 'dmy';
      if (/mmm|h:|HH/.test(rule.pattern)) return null; // month names / times: too many ways to write them
      let d = parseDate(v, order);
      if (!d) { // „Saarbrücken, 20.10.2026“, „am 1.2.26“: check the date inside; month names („20. Oktober 2026“) are fine
        const inner = v.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})(?!\d)/);
        if (inner) d = parseDate(inner[0], order);
        else if (/\p{L}/u.test(v)) return null;
      }
      if (!d) return dateHint(rule.pattern);
      if (d.bad) return 'Dieses Datum gibt es nicht – bitte Tag und Monat prüfen.';
      return null;
    }
    case 'mail':
      return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(v) ? null : 'Die E-Mail-Adresse sieht unvollständig aus.';
    case 'zip':
      return /^\d{4,5}$/.test(v.replace(/\s/g, '')) || /^\d{4,5}\s+\p{L}/u.test(v) || /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i.test(v) || /^\d{5}-\d{4}$/.test(v) ? null : 'Bitte die Postleitzahl prüfen.';
    case 'number':
      return /^[-+]?(\d{1,3}([.,\s]\d{3})*|\d+)([.,]\d+)?\s*(%|€|EUR)?$/.test(v) ? null : 'Hier gehört nur eine Zahl hin.';
    default:
      return null;
  }
}
