// Mail merge (Serienbrief) logic, pure and unit-tested (merge_unit.mjs): a table (header + rows of text) →
// placeholders {Column} filled per row, a proper German/English salutation from title/gender/name columns,
// address lines without gaps for empty fields, the usual export problems fixed (lost leading zeros in
// postcodes), and checks for placeholders that match no column or rows that miss data.

const RX = {
  anrede: /^(anrede|salutation|geschlecht|gender|sex)$/i,
  titel: /^(titel|akad(emischer|\.)? ?titel|title|academic ?title)$/i,
  vorname: /^(vorname|vornamen|first ?name|given ?name|forename)$/i,
  nachname: /^(nachname|familienname|zuname|last ?name|surname|family ?name)$/i,
  name: /^(name|vollständiger name|full ?name)$/i,
  firma: /^(firma|unternehmen|company|organi[sz]ation|betrieb)$/i,
  zusatz: /^(z\.? ?hd\.?|abteilung|zusatz|department|attn|c\/o)$/i,
  strasse: /^(stra(ß|ss)e|straße und hausnummer|strasse und hausnummer|stra(ß|ss)e ?\/? ?nr\.?|adresse|anschrift|street|address|address ?1|street address)$/i,
  hausnr: /^(hausnummer|hausnr\.?|nr\.?|house ?number|number)$/i,
  plz: /^(plz|postleitzahl|zip|zip ?code|postcode|postal ?code)$/i,
  ort: /^(ort|stadt|wohnort|city|town)$/i,
  land: /^(land|country)$/i,
};

/** Column roles found in the header: { anrede: 'Anrede', vorname: 'Vorname', … } (first match each). */
export function detectColumns(cols) {
  const out = {};
  for (const [role, rx] of Object.entries(RX)) {
    const c = cols.find(n => rx.test(String(n).trim()));
    if (c) out[role] = c;
  }
  return out;
}

/** Rows of strings → { cols, rows } with unique, non-empty column names; empty rows dropped. */
export function tableOf(raw, { header = true } = {}) {
  const width = Math.max(0, ...raw.map(r => r.length));
  const letter = i => { let s = ''; i++; while (i) { s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = Math.floor((i - 1) / 26); } return s; };
  const used = new Set();
  const names = [];
  for (let c = 0; c < width; c++) {
    let n = header ? String(raw[0]?.[c] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : '';
    if (!n) n = `Spalte ${letter(c)}`;
    let u = n, k = 2;
    while (used.has(u.toLowerCase())) u = `${n} ${k++}`;
    used.add(u.toLowerCase());
    names.push(u);
  }
  const rows = (header ? raw.slice(1) : raw)
    .map(r => names.map((_, c) => String(r[c] ?? '').replace(/\r/g, '').trim()))
    .filter(r => r.some(x => x));
  // drop columns that are empty in the header and in every row (trailing separators)
  const keep = names.map((n, c) => !/^Spalte [A-Z]+$/.test(n) || rows.some(r => r[c]));
  return { cols: names.filter((_, c) => keep[c]), rows: rows.map(r => r.filter((_, c) => keep[c])) };
}

/** German postcodes that lost their leading zero (01067 → 1067). Only when the column also has 5-digit codes
 *  and no country column points abroad. → number of fixed cells (rows are changed in place). */
export function fixPostcodes(table) {
  const roles = detectColumns(table.cols);
  if (!roles.plz) return 0;
  const p = table.cols.indexOf(roles.plz), l = roles.land ? table.cols.indexOf(roles.land) : -1;
  const vals = table.rows.map(r => r[p]);
  if (!vals.some(v => /^\d{5}$/.test(v))) return 0;
  let n = 0;
  for (const r of table.rows) {
    const abroad = l >= 0 && r[l] && !/^(de|deu|d|deutschland|germany)$/i.test(r[l].trim());
    if (!abroad && /^\d{4}$/.test(r[p])) { r[p] = '0' + r[p]; n++; }
  }
  return n;
}

const SPECIAL = {
  salutation: ['Briefanrede', 'Salutation'],
  addrTitle: ['Anrede Anschrift', 'Address title'],
  date: ['Datum', 'Date'],
};
/** Placeholder names used in a text ({Name}). */
export function placeholders(text) {
  return [...String(text || '').matchAll(/\{([^{}\n]{1,60})\}/g)].map(m => m[1].trim());
}
/** Placeholders that match neither a column nor a special one. */
export function unknownPlaceholders(texts, cols) {
  const known = new Set([...cols, ...Object.values(SPECIAL).flat()].map(x => x.toLowerCase()));
  const out = new Set();
  for (const t of texts) for (const p of placeholders(t)) if (!known.has(p.toLowerCase())) out.add(p);
  return [...out];
}

function genderOf(v) {
  const t = String(v || '').trim().toLowerCase();
  if (/^(frau|fr\.|ms\.?|mrs\.?|miss|w|weiblich|f|female)\b/.test(t)) return 'f';
  if (/^(herr|herrn|hr\.|mr\.?|m|männlich|maennlich|male)\b/.test(t)) return 'm';
  if (/^familie|^family/.test(t)) return 'family';
  return '';
}

/** Letter salutation for a record ({ column: value }). */
export function salutationOf(rec, roles, lang = 'de') {
  const g = genderOf(rec[roles.anrede]);
  const titel = String(rec[roles.titel] || '').trim();
  let last = String(rec[roles.nachname] || '').trim();
  let first = String(rec[roles.vorname] || '').trim();
  if (!last && roles.name) { const parts = String(rec[roles.name] || '').trim().split(/\s+/); last = parts.pop() || ''; first = parts.join(' '); }
  const tl = titel ? titel + ' ' : '';
  if (lang === 'en') {
    if (g === 'f' && last) return `Dear Ms ${tl}${last},`;
    if (g === 'm' && last) return `Dear Mr ${tl}${last},`;
    if (g === 'family' && last) return `Dear ${last} family,`;
    if (last) return `Dear ${[first, last].filter(Boolean).join(' ')},`;
    return 'Dear Sir or Madam,';
  }
  if (g === 'f' && last) return `Sehr geehrte Frau ${tl}${last},`;
  if (g === 'm' && last) return `Sehr geehrter Herr ${tl}${last},`;
  if (g === 'family' && last) return `Sehr geehrte Familie ${last},`;
  if (last) return `Guten Tag ${[tl.trim(), first, last].filter(Boolean).join(' ')},`;
  return 'Sehr geehrte Damen und Herren,';
}

/** "Herrn" / "Frau" for the address block (DIN 5008), '' otherwise. */
export function addressTitleOf(rec, roles, lang = 'de') {
  const g = genderOf(rec[roles.anrede]);
  if (lang === 'en') return g === 'f' ? 'Ms' : g === 'm' ? 'Mr' : '';
  return g === 'f' ? 'Frau' : g === 'm' ? 'Herrn' : g === 'family' ? 'Familie' : '';
}

/** Record object for row i. */
export const recordOf = (table, row) => Object.fromEntries(table.cols.map((c, i) => [c, row[i] ?? '']));

/**
 * Fill a text: {Column} → value, special placeholders, unknown → ''. Lines that contained placeholders and
 * end up empty are removed; doubled spaces left by empty fields are collapsed.
 */
export function fill(text, rec, roles, { lang = 'de', date = '' } = {}) {
  const lower = new Map(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));
  const special = p => {
    const k = p.toLowerCase();
    if (SPECIAL.salutation.some(x => x.toLowerCase() === k)) return salutationOf(rec, roles, lang);
    if (SPECIAL.addrTitle.some(x => x.toLowerCase() === k)) return addressTitleOf(rec, roles, lang);
    if (SPECIAL.date.some(x => x.toLowerCase() === k)) return date;
    return null;
  };
  return String(text || '').split('\n').map(line => {
    if (!/\{[^{}\n]+\}/.test(line)) return line;
    const out = line.replace(/\{([^{}\n]{1,60})\}/g, (m, p) => { const s = special(p.trim()); return s != null ? s : (lower.get(p.trim().toLowerCase()) ?? ''); })
      .replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').trim();
    return /[\p{L}\p{N}]/u.test(out) ? out : null;   // only punctuation left → drop the line
  }).filter(l => l !== null).join('\n');
}

/** Default address block from the detected columns. */
export function defaultAddress(roles, lang = 'de') {
  const b = c => (c ? `{${c}}` : '');
  const lines = [];
  if (roles.firma) lines.push(b(roles.firma));
  if (roles.zusatz) lines.push(b(roles.zusatz));
  const who = [roles.anrede ? `{${lang === 'de' ? 'Anrede Anschrift' : 'Address title'}}` : '', b(roles.titel), b(roles.vorname), b(roles.nachname) || b(roles.name)].filter(Boolean).join(' ');
  if (who) lines.push(who);
  if (roles.strasse) lines.push([b(roles.strasse), b(roles.hausnr)].filter(Boolean).join(' '));
  if (roles.plz || roles.ort) lines.push([b(roles.plz), b(roles.ort)].filter(Boolean).join(' '));
  if (roles.land) lines.push(b(roles.land));
  return lines.join('\n');
}

/** Rows whose address is incomplete (no name/company, street or town). → [row numbers, 1-based] */
export function incompleteRows(table, addressTemplate, roles) {
  const out = [];
  table.rows.forEach((row, i) => {
    const lines = fill(addressTemplate, recordOf(table, row), roles).split('\n').filter(Boolean);
    if (lines.length < 3) out.push(i + 1);
  });
  return out;
}

/** File name from a pattern like "{Nachname} {Vorname}" – safe characters only. */
export function fileNameOf(pattern, rec, roles, index) {
  const t = fill(pattern || '', rec, roles).replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;.–-]+|[\s,;–-]+$/g, '').slice(0, 80);
  return t || `Brief ${index + 1}`;
}
