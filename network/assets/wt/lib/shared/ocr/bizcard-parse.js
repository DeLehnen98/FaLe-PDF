// GENERATED – synced copy of js/ocr/bizcard-parse.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Business card parsing (German + English heuristics) and vCard 3.0 output. Pure functions.

const COMPANY = /\b(GmbH|mbH|AG|KG|KGaA|UG|OHG|GbR|PartG|e\.\s?K\.|e\.\s?V\.|SE|Ltd\.?|Limited|LLC|LLP|Inc\.?|Corp\.?|Corporation|Co\.|Company|PLC|S\.A\.|S\.L\.|B\.V\.|N\.V\.|S\.r\.l\.|Holding|Group|Gruppe|Partner(?:schaft)?\b.*\b(GmbH|mbB)|Kanzlei|Praxis|Studio|Agentur|Agency|Solutions|Consulting|Technologies|Systems|Werke?|Bank|Versicherung|Verlag)\b/i;
const POSITION = /\b(Geschäftsführer(in)?|Inhaber(in)?|Gründer(in)?|Mitgründer(in)?|Vorstand|Vorsitzende[r]?|Prokurist(in)?|Leiter(in)?|Leitung|Abteilungsleiter(in)?|Teamleiter(in)?|Bereichsleiter(in)?|Berater(in)?|Beraterin|Referent(in)?|Sachbearbeiter(in)?|Assistent(in)?|Assistenz|Ingenieur(in)?|Entwickler(in)?|Architekt(in)?|Designer(in)?|Projektmanager(in)?|Vertrieb|Verkauf|Einkauf|Marketing|Rechtsanwalt|Rechtsanwältin|Steuerberater(in)?|Notar(in)?|Fachanwalt|Fachanwältin|Ärztin|Arzt|Manager(in)?|Director|Head of|Chief|CEO|CTO|CFO|COO|CMO|VP|Vice President|President|Founder|Co-?Founder|Owner|Partner|Consultant|Engineer|Developer|Analyst|Specialist|Officer|Coordinator|Associate|Representative|Sales|Account|Executive|Lead|Advisor|Attorney|Lawyer|Accountant)\b/i;
// German compound job titles: Projektleiterin, Vertriebsmanager, Steuerfachangestellte …
const POSITION_COMPOUND = /\p{L}{3,}(leiter|leiterin|manager|managerin|berater|beraterin|referent|referentin|ingenieur|ingenieurin|entwickler|entwicklerin|assistent|assistentin|koordinator|koordinatorin|techniker|technikerin|kaufmann|kauffrau|angestellte|angestellter|meister|meisterin|planer|planerin|spezialist|spezialistin)\b/iu;
const STREET = /(stra(ss|ß)e|str\.|weg\b|platz\b|allee\b|gasse\b|ring\b|damm\b|ufer\b|chaussee\b|markt\b|steig\b|pfad\b|hof\b|\bstreet\b|\bst\.|\broad\b|\brd\.?\b|\bavenue\b|\bave\.?\b|\blane\b|\bway\b|\bdrive\b|\bboulevard\b|\bblvd\.?\b|\bsquare\b|\bplace\b|\bcourt\b|\bterrace\b)/i;
const PLZ_DE = /\b(?:D-|DE-|A-|CH-)?(\d{4,5})\s+([A-ZÄÖÜ][\p{L}.\- ]+?)(?:\s*,|\s*$)/u;
const UK_POST = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/;
const US_ZIP = /,\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;
const PHONE = /(?:\+|00)?\d[\d\s()\/.\-–]{5,}\d/g;
const EMAIL = /[\p{L}0-9._%+\-]+@[\p{L}0-9.\-]+\.[\p{L}]{2,}/u;
const WEB = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9\-]+)*\.(?:de|com|net|org|eu|at|ch|uk|co\.uk|io|info|biz|me|app|dev|shop|online|digital|nl|fr|it|es|us)(?:\/\S*)?)\b/i;

const LABEL_MOBILE = /\b(mobil|mobile|handy|cell|cellular|m\.?)\s*[:.]?\s*(?=[+0(])/i;
const LABEL_FAX = /\b(fax|telefax|f\.?)\s*[:.]?\s*(?=[+0(])/i;
const LABEL_PHONE = /\b(tel(efon)?|phone|fon|festnetz|office|direct|direkt|t\.?|p\.?)\s*[:.]?\s*(?=[+0(])/i;

function cleanPhone(s) {
  return s.replace(/[–]/g, '-').replace(/\s+/g, ' ').replace(/\s*([/\-])\s*/g, '$1').trim();
}
function isMobileNumber(n) {
  const d = n.replace(/[^\d+]/g, '');
  return /^(\+49|0049|0)1[5-7]\d/.test(d) || /^(\+44|0044|0)7\d/.test(d) || /^(\+43|0043|0)6\d/.test(d) || /^(\+41|0041|0)7[5-9]/.test(d);
}

/**
 * @param {Array<string|{text:string,size?:number}>} lines  OCR lines in reading order
 * @returns {{name, firma, position, telefon, mobil, fax, email, web, strasse, plz, ort, land, rest: string[]}}
 */
export function parseCard(lines) {
  const L = lines.map(l => (typeof l === 'string' ? { text: l, size: 0 } : { text: l.text || '', size: l.size || 0 }))
    .map(l => ({ ...l, text: l.text.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter(l => l.text.length > 1);
  const out = { name: '', firma: '', position: '', telefon: '', mobil: '', fax: '', email: '', web: '', strasse: '', plz: '', ort: '', land: '', rest: [] };
  const used = new Set();

  L.forEach((l, i) => {
    let t = l.text;
    // e-mail (OCR sometimes adds spaces around @ and dots)
    const em = EMAIL.exec(t.replace(/\s*@\s*/g, '@').replace(/\s*\.\s*(?=[a-z]{2,}\b)/gi, '.'));
    if (em && !out.email) {
      out.email = em[0].replace(/^(e-?mail|mail)[:.]?/i, '').replace(/[.,;]+$/, '');
      used.add(i);
      return;
    }
    // phone numbers (several on one line are possible: "Tel. … Fax …")
    const nums = [];
    let m;
    PHONE.lastIndex = 0;
    while ((m = PHONE.exec(t))) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 16) continue;
      if (/^\d{4,5}$/.test(m[0].trim())) continue; // postal codes
      nums.push({ s: m[0], at: m.index });
    }
    if (nums.length && !STREET.test(t.replace(/(tel|fon|fax).*/i, '')) && !(PLZ_DE.test(t) && nums.length === 1 && nums[0].s.replace(/\D/g, '').length <= 5)) {
      nums.forEach(n => {
        const before = t.slice(Math.max(0, n.at - 14), n.at + 1);
        const num = cleanPhone(n.s);
        if (LABEL_FAX.test(before) && !LABEL_MOBILE.test(before)) { if (!out.fax) out.fax = num; }
        else if (LABEL_MOBILE.test(before) || (!LABEL_PHONE.test(before) && isMobileNumber(num))) { if (!out.mobil) out.mobil = num; else if (!out.telefon) out.telefon = num; }
        else if (!out.telefon) out.telefon = num;
        else if (!out.mobil && isMobileNumber(num)) out.mobil = num;
      });
      used.add(i);
      return;
    }
    // website
    const wm = WEB.exec(t);
    if (wm && !/@/.test(t) && t.replace(wm[0], '').replace(/^(web|internet|www|url|site|website)[:.]?/i, '').trim().length < 4) {
      if (!out.web) out.web = wm[1].replace(/[.,;]+$/, '');
      used.add(i);
      return;
    }
    // address: "Straße 5, 12345 Ort" / "221 Baker Street, London NW1 6XE" / separate lines
    const plz = PLZ_DE.exec(t);
    const uk = UK_POST.exec(t);
    const us = US_ZIP.exec(t);
    if (STREET.test(t) && /\d/.test(t) && !out.strasse) {
      const parts = t.split(/\s*,\s*/);
      out.strasse = parts[0];
      if (parts.length > 1) cityPart(parts.slice(1).join(', '));
      used.add(i);
      return;
    }
    if ((plz && /\d{4,5}/.test(plz[1]) && !/[@]/.test(t)) || uk || us) {
      if (!out.plz && !out.ort) { cityPart(t); used.add(i); return; }
    }
  });

  function cityPart(s) {
    s = s.trim();
    const p = PLZ_DE.exec(s + ',');
    const u = UK_POST.exec(s);
    const us = US_ZIP.exec(', ' + s.replace(/^.*?,\s*/, ''));
    if (p && !u) { out.plz = p[1]; out.ort = p[2].trim(); const rest = s.replace(p[0].replace(/,$/, ''), '').replace(/^[\s,]+|[\s,]+$/g, ''); if (rest) out.land = rest; }
    else if (u) { out.plz = u[1].replace(/\s+/, ' '); out.ort = s.replace(u[0], '').replace(/[\s,]+$/g, '').trim(); if (!out.land) out.land = 'United Kingdom'; }
    else if (us) { out.plz = us[2]; out.ort = s.replace(/,?\s*[A-Z]{2}\s+\d{5}.*$/, '').trim(); }
    else out.ort = s;
  }

  // company / position / name among the remaining lines
  const restIdx = L.map((_, i) => i).filter(i => !used.has(i));
  for (const i of restIdx) {
    const t = L[i].text;
    if (!out.firma && COMPANY.test(t)) { out.firma = t; used.add(i); }
  }
  for (const i of restIdx) {
    if (used.has(i)) continue;
    const t = L[i].text;
    if (!out.position && (POSITION.test(t) || POSITION_COMPOUND.test(t)) && t.split(' ').length <= 7 && !/\b(GmbH|AG|KG|UG|e\.?\s?K|Ltd|Inc|LLC)\b/.test(t)) { out.position = t; used.add(i); }
  }
  const nameLike = t => !/\d|@|www\./i.test(t) && /^((Dr|Prof|Dipl|Mag|Ing|Mr|Mrs|Ms|Herr|Frau)\.?[\s-]*)*[\p{Lu}][\p{L}'’.-]+(\s+[\p{Lu}][\p{L}'’.-]+){1,3}$/u.test(t);
  const local = (out.email.split('@')[0] || '').toLowerCase().replace(/ae/g, 'ä').replace(/oe/g, 'ö').replace(/ue/g, 'ü');
  const cands = restIdx.filter(i => !used.has(i) && nameLike(L[i].text));
  if (cands.length) {
    const score = i => {
      const t = L[i].text.toLowerCase();
      let s = L[i].size || 0;
      if (local && t.split(/\s+/).some(w => w.length > 2 && (local.includes(w.replace(/[.]/g, '')) || local.includes(w.normalize('NFD').replace(/\p{M}/gu, ''))))) s += 1000;
      return s - i * 0.01;
    };
    const best = cands.sort((a, b) => score(b) - score(a))[0];
    out.name = L[best].text; used.add(best);
  }
  // still no company: a remaining capitalised line that is neither name nor position
  if (!out.firma) {
    const i = restIdx.find(k => !used.has(k) && /[\p{L}]{3,}/u.test(L[k].text) && !nameLike(L[k].text));
    if (i != null && out.name) { out.firma = L[i].text; used.add(i); }
  }
  out.rest = L.filter((_, i) => !used.has(i)).map(l => l.text);
  return out;
}

const vEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function splitName(full) {
  const titles = [];
  let rest = String(full || '').trim();
  let m;
  while ((m = /^((Dr|Prof|Dipl|Mag|Mr|Mrs|Ms)\.?(-\w+\.?)?)\s+/i.exec(rest))) { titles.push(m[1]); rest = rest.slice(m[0].length); }
  const parts = rest.split(/\s+/).filter(Boolean);
  const family = parts.length > 1 ? parts.pop() : parts.pop() || '';
  return { family, given: parts.shift() || '', middle: parts.join(' '), prefix: titles.join(' ') };
}

function fold(line) {
  // fold lines longer than 75 octets (RFC 2425/6350), continuation lines start with a space
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** vCard 3.0 text (CRLF line endings). */
export function toVCard(c) {
  const n = splitName(c.name);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0',
    `N:${vEsc(n.family)};${vEsc(n.given)};${vEsc(n.middle)};${vEsc(n.prefix)};`,
    `FN:${vEsc(c.name || c.firma || 'Kontakt')}`];
  if (c.firma) lines.push(`ORG:${vEsc(c.firma)}`);
  if (c.position) lines.push(`TITLE:${vEsc(c.position)}`);
  if (c.telefon) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(c.telefon)}`);
  if (c.mobil) lines.push(`TEL;TYPE=CELL,VOICE:${vEsc(c.mobil)}`);
  if (c.fax) lines.push(`TEL;TYPE=WORK,FAX:${vEsc(c.fax)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${vEsc(c.email)}`);
  if (c.web) lines.push(`URL:${vEsc(/^https?:\/\//i.test(c.web) ? c.web : 'https://' + c.web)}`);
  if (c.strasse || c.ort || c.plz || c.land) lines.push(`ADR;TYPE=WORK:;;${vEsc(c.strasse)};${vEsc(c.ort)};;${vEsc(c.plz)};${vEsc(c.land)}`);
  if (c.notiz) lines.push(`NOTE:${vEsc(c.notiz)}`);
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}
