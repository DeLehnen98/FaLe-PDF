// What a scanned code contains, in plain words – and how risky a link in it looks. Pure functions (no DOM),
// shared by tools/qr-scanner.js and the unit test tests/suites/webtools/qrcontent_unit.mjs.
//
// Nothing here contacts a server: the link check only looks at the address itself (scheme, host, look-alike
// letters, short links, downloads …). It cannot know whether a site is a scam – it points out the signs that
// make one likely and always shows the real destination.

// ---------------------------------------------------------------- small helpers
const unescapeField = s => s.replace(/\\(.)/g, '$1');
/** Fields of WIFI:/MECARD:/MATMSG: style payloads (KEY:value; with \; escapes). */
function fieldsOf(body) {
  const out = {};
  const re = /([A-Za-z]+):((?:\\.|[^;\\])*);?/g;
  let m;
  while ((m = re.exec(body))) {
    const k = m[1].toUpperCase();
    (out[k] ||= []).push(unescapeField(m[2]));
  }
  return out;
}

// ---------------------------------------------------------------- punycode (RFC 3492), decode only
function punyDecode(label) {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const out = [];
  let i = 0, n = 128, bias = 72;
  const basic = label.lastIndexOf('-');
  for (let j = 0; j < Math.max(0, basic); j++) out.push(label.charCodeAt(j));
  const adapt = (delta, num, first) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / num);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) { delta = Math.floor(delta / (base - tMin)); k += base; }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < label.length;) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= label.length) throw new Error('bad punycode');
      const c = label.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) throw new Error('bad punycode');
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
/** Host name as people read it (xn--… labels decoded). */
export function unicodeHost(host) {
  return host.split('.').map(l => { if (!/^xn--/i.test(l)) return l; try { return punyDecode(l.slice(4).toLowerCase()); } catch { return l; } }).join('.');
}

// two-part public suffixes that are common in our region; enough to show "the" domain of a host
const SUFFIX2 = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'co.at', 'or.at', 'gv.at', 'ac.at', 'com.au', 'net.au', 'org.au',
  'co.nz', 'co.za', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.tr', 'com.cn', 'com.mx', 'com.ar', 'co.in', 'co.il', 'com.pl', 'com.es', 'com.pt', 'com.gr',
  'co.kr', 'com.sg', 'com.hk', 'com.tw', 'gov.de', 'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com',
  'blogspot.com', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'appspot.com', 'workers.dev', 'ngrok.io', 'ngrok-free.app']);
/** The registrable domain of a host (example.co.uk for a.b.example.co.uk), best effort without the full list. */
export function siteOf(host) {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return SUFFIX2.has(last2) ? parts.slice(-3).join('.') : last2;
}

// services that only forward to another address – the destination is unknown until the link is opened
const SHORTENERS = new Set(['bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 's.id', 'qrco.de', 'qr.codes', 't.ly', 'shorte.st', 'adf.ly', 'bl.ink', 'lnkd.in', 'trib.al', 'soo.gd', 'clck.ru', 'u.to', 'x.gd',
  'tiny.one', 'urlz.fr', 'kurzelinks.de', 'kurzlink.de', 'l.ead.me', 'linktr.ee', 'qr.link', 'me-qr.com', 'qrfy.io', 'scnv.io', 'qr1.be', 'tr.ee', 'urlshortener.at']);
// endings used much more for throw-away scam sites than for real shops or authorities
const ODD_TLD = new Set(['zip', 'mov', 'xyz', 'top', 'click', 'country', 'gq', 'tk', 'ml', 'cf', 'ga', 'work', 'support', 'loan', 'rest', 'cam', 'icu', 'buzz',
  'monster', 'quest', 'cfd', 'sbs', 'lol', 'bond', 'beauty', 'hair', 'mom', 'skin', 'autos', 'boats', 'yachts', 'cyou', 'win', 'bid', 'date', 'review', 'party', 'trade']);
const DOWNLOAD = /\.(apk|aab|xapk|exe|msi|bat|cmd|com|scr|pif|vbs|vbe|js|jse|wsf|hta|jar|dmg|pkg|app|ps1|lnk|iso|img|reg|mobileconfig|appx|msix|deb|rpm|sh)$/i;
// words that phishing pages put into their address to look official
const BAIT = /(?:^|[.\-_])(login|log-in|signin|sign-in|verify|verifizierung|verification|secure|security|sicherheit|account|konto|update|bestaetigen|bestätigen|confirm|unlock|entsperren|support|kundenservice|zahlung|payment|refund|erstattung|paket|parcel|zustellung|delivery|tracking|sendung|gebuehr|gebühr|strafzettel|bussgeld|bußgeld|parking|parken|wallet|bonus|gewinn|prize)(?=$|[.\-_\d])/i;

/** Latin + Cyrillic/Greek mixed in one label: a classic look-alike trick (аpple with a Cyrillic а). */
function mixedScript(label) {
  const latin = /[a-z]/i.test(label), cyr = /[\u0400-\u04FF]/.test(label), greek = /[\u0370-\u03FF]/.test(label);
  return (latin && (cyr || greek)) || (cyr && greek);
}

/**
 * Check a link without opening it. → { url, href, scheme, host, display (unicode host), site, level, notes[] }
 * level: 'ok' | 'note' | 'warn' | 'danger' – notes: [{ level, de, en }]. href is null when it must not be opened.
 */
export function checkLink(raw) {
  const text = String(raw || '').trim();
  const notes = [];
  const add = (level, de, en) => notes.push({ level, de, en });
  let u;
  try { u = new URL(/^www\./i.test(text) ? 'https://' + text : text); } catch { return { url: text, href: null, scheme: '', host: '', display: '', site: '', level: 'warn', notes: [{ level: 'warn', de: 'Das ist keine gültige Internetadresse.', en: 'This is not a valid web address.' }] }; }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    const danger = ['javascript', 'data', 'vbscript', 'file', 'blob', 'intent', 'filesystem', 'jar', 'ms-msdt', 'search-ms', 'ms-appinstaller'].includes(scheme);
    add(danger ? 'danger' : 'warn',
      danger ? `Der Code startet „${scheme}:“ – damit kann Programmcode laufen oder etwas installiert werden. Nicht öffnen.` : `Der Code öffnet eine App über „${scheme}:“. Öffne ihn nur, wenn du weißt, welche App das ist.`,
      danger ? `The code starts “${scheme}:” – this can run code or install something. Don’t open it.` : `The code opens an app via “${scheme}:”. Only open it if you know which app that is.`);
    return { url: text, href: danger ? null : u.href, scheme, host: '', display: '', site: '', level: danger ? 'danger' : 'warn', notes };
  }
  const host = u.hostname.toLowerCase();
  const display = unicodeHost(host);
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  const site = ip ? host : siteOf(host);
  const siteDisplay = unicodeHost(site);
  if (u.username || u.password) {
    add('danger', `Vor dem „@“ steht nur Tarnung – die Adresse führt in Wahrheit zu ${display}.`, `Everything before the “@” is a disguise – the address really leads to ${display}.`);
  }
  if (/xn--/i.test(host)) {
    const mixed = display.split('.').some(mixedScript);
    add(mixed ? 'danger' : 'warn',
      mixed ? `Die Adresse mischt lateinische mit kyrillischen oder griechischen Buchstaben (${display}). So werden bekannte Adressen nachgeahmt.` : `Die Adresse enthält Sonderzeichen (${display}). Prüfe genau, ob jeder Buchstabe stimmt.`,
      mixed ? `The address mixes Latin with Cyrillic or Greek letters (${display}). This is how well-known addresses are imitated.` : `The address contains special letters (${display}). Check carefully that every letter is right.`);
  }
  if (ip) add('warn', 'Statt eines Namens steht eine nackte IP-Adresse im Link. Seriöse Seiten tun das fast nie.', 'The link uses a bare IP address instead of a name. Legitimate sites almost never do that.');
  if (scheme === 'http') add('warn', 'Die Verbindung ist nicht verschlüsselt (http statt https). Gib dort keine Passwörter oder Zahlungsdaten ein.', 'The connection is not encrypted (http instead of https). Don’t enter passwords or payment details there.');
  if (SHORTENERS.has(host) || SHORTENERS.has(site)) add('note', 'Das ist ein Kurz- oder Weiterleitungslink: Wohin er wirklich führt, siehst du erst nach dem Öffnen. Achte dann auf die Adresszeile.', 'This is a short or redirect link: where it really goes is only visible after opening. Then check the address bar.');
  const tld = host.split('.').pop();
  if (!ip && ODD_TLD.has(tld)) add('warn', `Die Endung „.${tld}“ wird oft für kurzlebige Betrugsseiten genutzt.`, `The ending “.${tld}” is often used for short-lived scam sites.`);
  const sub = ip ? '' : host.slice(0, Math.max(0, host.length - site.length - 1));
  if (sub && sub.split('.').some(l => /^(com|de|net|org|at|ch|eu|info|biz|co|uk|fr|it|nl|es|pl|gov|bank)$/.test(l))) {
    add('warn', `Die Adresse beginnt wie eine andere Seite („${unicodeHost(sub)}…“), gehört aber zu ${siteDisplay}. Entscheidend ist immer der Teil direkt vor der Endung.`, `The address starts like another site (“${unicodeHost(sub)}…”) but belongs to ${siteDisplay}. What counts is always the part right before the ending.`);
  } else if (sub && BAIT.test(sub)) {
    add(/-/.test(sub) || sub.split('.').length > 1 ? 'warn' : 'note', `Wörter wie „login“, „konto“ oder „paket“ vor der eigentlichen Domain ${siteDisplay} sind bei Betrugsseiten häufig. Prüfe, ob ${siteDisplay} wirklich der Anbieter ist, den du erwartest.`, `Words like “login”, “account” or “parcel” in front of the real domain ${siteDisplay} are common on scam sites. Check that ${siteDisplay} really is the provider you expect.`);
  } else if (!ip && BAIT.test(site) && (site.match(/-/g) || []).length >= 1) add('note', `Die Domain ${siteDisplay} enthält Wörter wie „login“ oder „konto“ mit Bindestrich – das sieht man oft bei nachgemachten Seiten.`, `The domain ${siteDisplay} contains words like “login” or “account” with a hyphen – common on imitation sites.`);
  if (!ip && host.split('.').length >= 5) add('note', 'Die Adresse hat ungewöhnlich viele Teile vor der Domain.', 'The address has unusually many parts in front of the domain.');
  if (u.port && !['80', '443'].includes(u.port)) add('note', `Ungewöhnlicher Port ${u.port}.`, `Unusual port ${u.port}.`);
  const file = decodeURIComponent(u.pathname.split('/').pop() || '');
  if (DOWNLOAD.test(file)) add('danger', `Der Link lädt direkt eine App oder ein Programm herunter („${file}“). Installiere nichts aus QR-Codes von Aufklebern, Zetteln oder Briefen.`, `The link downloads an app or program directly (“${file}”). Don’t install anything from QR codes on stickers, flyers or letters.`);
  else if (/\.pdf$/i.test(file)) add('note', 'Der Link öffnet eine PDF-Datei.', 'The link opens a PDF file.');
  const rank = { ok: 0, note: 1, warn: 2, danger: 3 };
  const level = notes.reduce((m, n) => (rank[n.level] > rank[m] ? n.level : m), 'ok');
  return { url: text, href: u.href, scheme, host, display, site: siteDisplay, level, notes };
}

// ---------------------------------------------------------------- IBAN / EPC payment codes
export function ibanValid(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const re = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (let i = 0; i < re.length; i += 7) r = Number(String(r) + re.slice(i, i + 7)) % 97;
  return r === 1;
}
export const ibanGroups = iban => String(iban || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

function parseEpc(s) {
  const L = s.split(/\r?\n/);
  if (L.length < 7 || L[0].trim() !== 'BCD' || !/^00[12]$/.test(L[1].trim()) || L[3].trim() !== 'SCT') return null;
  const amountRaw = (L[7] || '').trim();
  const m = amountRaw.match(/^([A-Z]{3})(\d+(?:\.\d{1,2})?)$/);
  return {
    type: 'payment', bic: (L[4] || '').trim(), name: (L[5] || '').trim(), iban: (L[6] || '').replace(/\s+/g, '').toUpperCase(),
    currency: m ? m[1] : '', amount: m ? Number(m[2]) : null, purpose: (L[8] || '').trim(), reference: (L[9] || '').trim(),
    text: (L[10] || '').trim(), info: (L[11] || '').trim(), ibanOk: ibanValid(L[6]),
  };
}

// ---------------------------------------------------------------- vCard / calendar
function unfold(s) { return s.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function propList(s, name) {
  const out = [];
  const re = new RegExp(`^(?:item\\d+\\.)?${name}((?:;[^:\\n]*)?):(.*)$`, 'gim');
  let m;
  while ((m = re.exec(s))) out.push({ params: m[1], value: m[2].replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim() });
  return out;
}
const prop = (s, name) => propList(s, name)[0]?.value || '';

function parseVcard(raw) {
  const s = unfold(raw);
  const n = prop(s, 'N').split(';');
  const name = prop(s, 'FN') || [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ').trim();
  const adr = propList(s, 'ADR').map(a => a.value.split(';').map(x => x.trim()).filter(Boolean).join(', '));
  return { type: 'contact', name, org: prop(s, 'ORG').replace(/;/g, ', '), title: prop(s, 'TITLE'), tel: propList(s, 'TEL').map(t => t.value),
    email: propList(s, 'EMAIL').map(t => t.value), url: propList(s, 'URL').map(t => t.value), adr, note: prop(s, 'NOTE'), vcard: raw.replace(/\r?\n/g, '\r\n') };
}

const vEsc = v => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function parseMecard(body) {
  const f = fieldsOf(body);
  const nm = (f.N?.[0] || '').split(',').map(x => x.trim());
  const name = nm.length > 1 ? `${nm[1]} ${nm[0]}`.trim() : nm[0] || '';
  const tel = f.TEL || [], email = f.EMAIL || [], url = f.URL || [];
  const adr = f.ADR || [];
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(nm[0] || '')};${vEsc(nm[1] || '')};;;`, `FN:${vEsc(name)}`];
  if (f.ORG) lines.push(`ORG:${vEsc(f.ORG[0])}`);
  for (const t of tel) lines.push(`TEL:${vEsc(t)}`);
  for (const e of email) lines.push(`EMAIL:${vEsc(e)}`);
  for (const w of url) lines.push(`URL:${vEsc(w)}`);
  for (const a of adr) lines.push(`ADR:;;${vEsc(a)};;;;`);
  if (f.NOTE) lines.push(`NOTE:${vEsc(f.NOTE[0])}`);
  lines.push('END:VCARD');
  return { type: 'contact', name, org: f.ORG?.[0] || '', title: '', tel, email, url, adr, note: f.NOTE?.[0] || '', vcard: lines.join('\r\n') + '\r\n' };
}

/** 20261017T093000Z / 20261017 / 20261017T0930 → Date or null (floating times as local time). */
export function icsDate(v) {
  const m = String(v || '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return { date: new Date(+y, +mo - 1, +d), allDay: true };
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0))) : new Date(+y, +mo - 1, +d, +hh, +mi, +(ss || 0));
  return { date, allDay: false };
}
function parseEvent(raw) {
  const s = unfold(raw);
  const ev = (s.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/i) || [s])[0];
  const ics = /BEGIN:VCALENDAR/i.test(raw) ? raw : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//FaleNetwork//QR//DE\r\n${raw.trim()}\r\nEND:VCALENDAR`;
  return { type: 'event', title: prop(ev, 'SUMMARY'), start: icsDate(prop(ev, 'DTSTART')), end: icsDate(prop(ev, 'DTEND')), location: prop(ev, 'LOCATION'),
    description: prop(ev, 'DESCRIPTION'), ics: ics.replace(/\r?\n/g, '\r\n') + (/\r?\n$/.test(ics) ? '' : '\r\n') };
}

// ---------------------------------------------------------------- everything else
function parseOtp(s) {
  try {
    const u = new URL(s);
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const [iss, acc] = label.includes(':') ? label.split(/:(.*)/s) : ['', label];
    return { type: 'otp', kind: u.hostname, issuer: u.searchParams.get('issuer') || iss.trim(), account: (acc || '').trim(), hasSecret: !!u.searchParams.get('secret') };
  } catch { return { type: 'otp', kind: '', issuer: '', account: '', hasSecret: true }; }
}

function parseMail(s) {
  if (/^MATMSG:/i.test(s)) { const f = fieldsOf(s.slice(7)); return { type: 'email', to: f.TO?.[0] || '', subject: f.SUB?.[0] || '', body: f.BODY?.[0] || '' }; }
  if (/^SMTP:/i.test(s)) { const [, to, sub, ...body] = s.split(':'); return { type: 'email', to: to || '', subject: sub || '', body: body.join(':') }; }
  try {
    const u = new URL(s);
    return { type: 'email', to: decodeURIComponent(u.pathname), subject: u.searchParams.get('subject') || '', body: u.searchParams.get('body') || '', cc: u.searchParams.get('cc') || '' };
  } catch { return { type: 'email', to: s.slice(7), subject: '', body: '' }; }
}

function parseSms(s) {
  const m = s.match(/^(?:sms|smsto|mms|mmsto):([^:?]*)(?:[:?](?:body=)?([\s\S]*))?$/i);
  let body = m?.[2] || '';
  try { body = decodeURIComponent(body.replace(/\+/g, ' ')); } catch { /* keep raw */ }
  return { type: 'sms', number: (m?.[1] || '').trim(), body };
}

/** EAN-13 / EAN-8 / UPC-A check digit. */
export function eanValid(code) {
  const s = String(code || '');
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < s.length - 1; i++) sum += +s[s.length - 2 - i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === +s[s.length - 1];
}

/**
 * Turn the raw text of a code into something readable. → { type, … } with type one of
 * link, wifi, contact, event, payment, email, sms, phone, geo, otp, crypto, product, text.
 */
export function parseContent(raw, format = 'qr_code') {
  const s = String(raw ?? '');
  const t = s.trim();
  if (/^(ean_13|ean_8|upc_a|upc_e)$/.test(format) || (/^\d{8}$|^\d{12,14}$/.test(t) && format !== 'qr_code' && eanValid(t))) return { type: 'product', code: t, valid: eanValid(t) };
  if (/^WIFI:/i.test(t)) {
    const f = fieldsOf(t.slice(5));
    const sec = (f.T?.[0] || '').toUpperCase();
    return { type: 'wifi', ssid: f.S?.[0] || '', password: f.P?.[0] || '', security: sec === 'NOPASS' || !sec ? (f.P?.[0] ? 'WPA' : 'nopass') : sec, hidden: /^true$/i.test(f.H?.[0] || '') };
  }
  if (/^BEGIN:VCARD/i.test(t)) return parseVcard(t);
  if (/^MECARD:/i.test(t)) return parseMecard(t.slice(7));
  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(t)) return parseEvent(t);
  if (/^BCD\r?\n/.test(t)) { const p = parseEpc(t); if (p) return p; }
  if (/^otpauth(-migration)?:\/\//i.test(t)) return parseOtp(t);
  if (/^(mailto:|MATMSG:|SMTP:)/i.test(t)) return parseMail(t);
  if (/^(sms|smsto|mms|mmsto):/i.test(t)) return parseSms(t);
  if (/^tel:/i.test(t)) return { type: 'phone', number: decodeURIComponent(t.slice(4)).trim() };
  const geo = t.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,[^?;]*)?(?:[;?].*?(?:q=([^&]*))?)?$/i);
  if (geo && Math.abs(+geo[1]) <= 90 && Math.abs(+geo[2]) <= 180) {
    let q = geo[3] || '';
    try { q = decodeURIComponent(q.replace(/\+/g, ' ')); } catch { /* raw */ }
    return { type: 'geo', lat: +geo[1], lon: +geo[2], label: q };
  }
  const crypto = t.match(/^(bitcoin|ethereum|litecoin|monero|dogecoin|bitcoincash|solana|tron):([^?]+)(?:\?(.*))?$/i);
  if (crypto) {
    const q = new URLSearchParams(crypto[3] || '');
    return { type: 'crypto', coin: crypto[1].toLowerCase(), address: crypto[2], amount: q.get('amount') || '', label: q.get('label') || q.get('message') || '' };
  }
  if (/^(https?:\/\/|www\.)\S+$/i.test(t) || /^[a-z][a-z0-9+.-]{1,20}:\/\/\S+$/i.test(t) || /^(javascript|data|vbscript|intent):/i.test(t)) return { type: 'link', ...checkLink(t) };
  return { type: 'text', text: s };
}

/** One line for lists and the CSV export (never the secret of a 2-factor code). */
export function summaryOf(c, lang = 'de') {
  const de = lang === 'de';
  switch (c.type) {
    case 'link': return c.display ? `${c.display}${c.href ? c.href.slice(c.href.indexOf(c.host) + c.host.length) : ''}` : c.url;
    case 'wifi': return `${de ? 'WLAN' : 'Wi-Fi'} „${c.ssid}“`;
    case 'contact': return [c.name, c.org].filter(Boolean).join(' · ') || (de ? 'Kontakt' : 'Contact');
    case 'event': return c.title || (de ? 'Termin' : 'Event');
    case 'payment': return `${c.name} · ${c.amount != null ? c.amount.toFixed(2) + ' ' + c.currency : ''}`.trim();
    case 'email': return c.to;
    case 'sms': return c.number;
    case 'phone': return c.number;
    case 'geo': return `${c.lat}, ${c.lon}`;
    case 'otp': return `${de ? 'Zwei-Faktor-Schlüssel' : 'Two-factor key'}${c.issuer ? ' · ' + c.issuer : ''}`;
    case 'crypto': return `${c.coin}: ${c.address}`;
    case 'product': return c.code;
    default: return String(c.text || '').replace(/\s+/g, ' ').slice(0, 200);
  }
}
