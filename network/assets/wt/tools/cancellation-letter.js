// Tool: cancellation letter generator (no file intake). Contract types with their reference fields,
// "next possible date" or a date, optional extraordinary cancellation with reason, written confirmation,
// SEPA mandate revocation, GDPR Art. 17 deletion request; DIN 5008 layout (form B, window envelope),
// drawn signature, copy text. German page: German letter + generic notice-period help (not legal advice);
// English page: generic English letter without claims about any country's law. Data stays local;
// "remember sender" is opt-in (localStorage).
import { el, icon, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { ensureCss, newCanvas, ctx2d, release, T, segmented, field, check, userError } from '../lib/img-core.js';

ensureCss();

const SENDER_KEY = 'fale-wt-letter-sender';
const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (iso, lang) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return ''; return lang === 'de' ? `${m[3]}.${m[2]}.${m[1]}` : new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };

/** Tenant notice (3 months, receipt by the 3rd working day Mon–Sat... here Mon–Fri, no holidays) – German page helper only. */
export function tenancyEnd(receiptIso) {
  const [y, m, d] = receiptIso.split('-').map(Number);
  let count = 0, third = 0;
  for (let day = 1; day <= 10; day++) { const wd = new Date(y, m - 1, day).getDay(); if (wd !== 0 && wd !== 6) { count++; if (count === 3) { third = day; break; } } }
  return isoToday(new Date(y, m - 1 + (d <= third ? 2 : 3) + 1, 0));
}

// ---------------------------------------------------------------- contract types
const F = (id, de, en, extra = {}) => ({ id, label: { de, en }, ...extra });
const TYPES = {
  handy: { label: { de: 'Handyvertrag', en: 'Mobile phone' },
    what: { de: 'meinen Mobilfunkvertrag', en: 'my mobile phone contract' }, subj: { de: 'Kündigung meines Mobilfunkvertrags', en: 'Cancellation of my mobile phone contract' },
    fields: [F('customer', 'Kundennummer', 'Customer number'), F('phone', 'Rufnummer', 'Phone number', { type: 'tel' }), F('contract', 'Vertragsnummer (optional)', 'Contract number (optional)'),
      F('port', 'Ich möchte meine Rufnummer mitnehmen', 'I want to keep my phone number', { type: 'check' })],
    refs: [['customer', 'Kundennummer', 'Customer number'], ['phone', 'Rufnummer', 'Phone number'], ['contract', 'Vertragsnummer', 'Contract number']],
    extra: (v, lang) => (v.port ? [lang === 'de' ? 'Ich möchte meine Rufnummer zu einem anderen Anbieter mitnehmen. Bitte geben Sie die Rufnummer für die Übertragung frei und bestätigen Sie mir dies.' : 'I would like to take my phone number to another provider. Please release the number for porting and confirm this to me.'] : []) },
  internet: { label: { de: 'Internet / DSL', en: 'Internet / broadband' },
    what: { de: 'meinen Internetvertrag', en: 'my internet contract' }, subj: { de: 'Kündigung meines Internetvertrags', en: 'Cancellation of my internet contract' },
    fields: [F('customer', 'Kundennummer', 'Customer number'), F('contract', 'Vertragsnummer (optional)', 'Contract number (optional)'), F('line', 'Anschluss / Rufnummer (optional)', 'Line / phone number (optional)')],
    refs: [['customer', 'Kundennummer', 'Customer number'], ['contract', 'Vertragsnummer', 'Contract number'], ['line', 'Anschluss', 'Line']],
    extra: (v, lang) => [lang === 'de' ? 'Bitte teilen Sie mir mit, ob und wohin ich überlassene Geräte (z. B. den Router) zurücksenden soll.' : 'Please let me know whether and where I should return any equipment provided (e.g. the router).'] },
  fitness: { label: { de: 'Fitnessstudio', en: 'Gym' },
    what: { de: 'meine Mitgliedschaft', en: 'my membership' }, subj: { de: 'Kündigung meiner Mitgliedschaft', en: 'Cancellation of my membership' },
    fields: [F('member', 'Mitgliedsnummer', 'Membership number'), F('site', 'Studio / Standort (optional)', 'Location (optional)')],
    refs: [['member', 'Mitgliedsnummer', 'Membership number'], ['site', 'Standort', 'Location']] },
  energy: { label: { de: 'Strom / Gas', en: 'Electricity / gas' },
    what: { de: 'meinen Energieliefervertrag', en: 'my energy supply contract' }, subj: { de: 'Kündigung meines Energieliefervertrags', en: 'Cancellation of my energy supply contract' },
    fields: [F('customer', 'Kundennummer', 'Customer number'), F('meter', 'Zählernummer', 'Meter number'), F('reading', 'Zählerstand (optional)', 'Meter reading (optional)'), F('readingDate', 'Abgelesen am', 'Read on', { type: 'date', when: v => !!v.reading })],
    refs: [['customer', 'Kundennummer', 'Customer number'], ['meter', 'Zählernummer', 'Meter number']],
    extra: (v, lang) => [v.reading ? (lang === 'de' ? `Der Zählerstand betrug am ${fmtDate(v.readingDate, lang) || 'Tag der Ablesung'}: ${v.reading}.` : `The meter reading on ${fmtDate(v.readingDate, lang) || 'the day of reading'} was ${v.reading}.`) : '',
      lang === 'de' ? 'Bitte senden Sie mir die Schlussrechnung an die oben genannte Anschrift.' : 'Please send the final bill to the address above.'] },
  insurance: { label: { de: 'Versicherung', en: 'Insurance' },
    what: { de: 'meinen Versicherungsvertrag', en: 'my insurance policy' }, subj: { de: 'Kündigung meines Versicherungsvertrags', en: 'Cancellation of my insurance policy' },
    fields: [F('kind', 'Art der Versicherung (optional)', 'Type of insurance (optional)', { placeholder: { de: 'z. B. Hausratversicherung', en: 'e.g. home contents insurance' } }), F('policy', 'Versicherungsnummer', 'Policy number')],
    whatFn: (v, lang) => (v.kind ? (lang === 'de' ? `meine ${v.kind}` : `my ${v.kind} policy`) : null),
    refs: [['policy', 'Versicherungsnummer', 'Policy number']] },
  magazine: { label: { de: 'Zeitschrift / Abo', en: 'Magazine / subscription' },
    what: { de: 'mein Abonnement', en: 'my subscription' }, subj: { de: 'Kündigung meines Abonnements', en: 'Cancellation of my subscription' },
    fields: [F('title', 'Zeitschrift / Abo', 'Magazine / subscription'), F('subno', 'Abo- oder Kundennummer', 'Subscription or customer number')],
    whatFn: (v, lang) => (v.title ? (lang === 'de' ? `mein Abonnement „${v.title}“` : `my subscription to “${v.title}”`) : null),
    refs: [['subno', 'Abonummer', 'Subscription number']] },
  streaming: { label: { de: 'Streaming', en: 'Streaming' },
    what: { de: 'mein Abonnement', en: 'my subscription' }, subj: { de: 'Kündigung meines Abonnements', en: 'Cancellation of my subscription' },
    fields: [F('service', 'Dienst', 'Service'), F('account', 'E-Mail-Adresse des Kontos', 'Account e-mail address', { type: 'email' }), F('customer', 'Kundennummer (optional)', 'Customer number (optional)')],
    whatFn: (v, lang) => (v.service ? (lang === 'de' ? `mein Abonnement bei ${v.service}` : `my ${v.service} subscription`) : null),
    refs: [['account', 'Konto', 'Account'], ['customer', 'Kundennummer', 'Customer number']] },
  rent: { label: { de: 'Mietwohnung (Mieter)', en: 'Rented home (tenant)' }, paper: true,
    what: { de: 'das Mietverhältnis', en: 'the tenancy' }, subj: { de: 'Kündigung des Mietverhältnisses', en: 'Notice to end my tenancy' },
    fields: [F('object', 'Anschrift der Wohnung', 'Address of the property'), F('floor', 'Lage (optional)', 'Flat / floor (optional)', { placeholder: { de: 'z. B. 2. OG links', en: 'e.g. flat 4, 2nd floor' } }),
      F('cotenants', 'Weitere Mieter (optional)', 'Other tenants (optional)', { placeholder: { de: 'Namen, durch Komma getrennt', en: 'names, separated by commas' } }),
      F('handover', 'Um Termin für die Wohnungsübergabe bitten', 'Ask for a handover appointment', { type: 'check', def: true }),
      F('deposit', 'Um Abrechnung der Kaution bitten', 'Ask for the deposit to be settled', { type: 'check', def: true }),
      F('iban', 'IBAN für die Kautionsrückzahlung (optional)', 'Account for the deposit refund (optional)', { when: v => v.deposit !== false })],
    whatFn: (v, lang) => (v.object ? (lang === 'de' ? `das Mietverhältnis über die Wohnung ${v.object}${v.floor ? ` (${v.floor})` : ''}` : `the tenancy of ${v.object}${v.floor ? ` (${v.floor})` : ''}`) : null),
    refs: [], noSepa: true,
    extra: (v, lang) => {
      const out = [];
      const co = String(v.cotenants || '').split(',').map(s => s.trim()).filter(Boolean);
      if (co.length) out.push(lang === 'de' ? `Die Kündigung erfolgt zugleich im Namen der weiteren Mieter (${co.join(', ')}).` : `This notice is also given on behalf of the other tenants (${co.join(', ')}).`);
      if (v.handover !== false) out.push(lang === 'de' ? 'Für die Übergabe der Wohnung und der Schlüssel bitte ich Sie, mir rechtzeitig mögliche Termine zu nennen.' : 'Please suggest possible dates for handing over the property and the keys.');
      if (v.deposit !== false) out.push(lang === 'de' ? `Bitte rechnen Sie die Mietkaution nach Ende des Mietverhältnisses ab und überweisen Sie das Guthaben${v.iban ? ` auf das Konto IBAN ${v.iban}` : ''}.` : `Please settle the deposit after the tenancy ends and transfer the balance${v.iban ? ` to the account ${v.iban}` : ''}.`);
      return out;
    } },
  club: { label: { de: 'Verein', en: 'Club / association' },
    what: { de: 'meine Mitgliedschaft', en: 'my membership' }, subj: { de: 'Kündigung meiner Mitgliedschaft', en: 'Cancellation of my membership' },
    fields: [F('member', 'Mitgliedsnummer (optional)', 'Membership number (optional)')],
    refs: [['member', 'Mitgliedsnummer', 'Membership number']] },
  other: { label: { de: 'Sonstiges', en: 'Other' },
    what: { de: 'meinen Vertrag', en: 'my contract' }, subj: { de: 'Kündigung meines Vertrags', en: 'Cancellation of my contract' },
    fields: [F('thing', 'Was kündigst du?', 'What are you cancelling?', { placeholder: { de: 'z. B. meinen Vertrag über die Gartenpflege', en: 'e.g. my gardening service contract' } }), F('number', 'Vertrags- oder Kundennummer (optional)', 'Contract or customer number (optional)')],
    whatFn: v => v.thing || null,
    refs: [['number', 'Vertrags-/Kundennummer', 'Reference']] },
};

const REASONS = {
  price: { de: 'Preiserhöhung', en: 'Price increase', text: { de: 'wegen der angekündigten Preis- bzw. Beitragserhöhung', en: 'because of the announced price increase' } },
  move: { de: 'Umzug', en: 'Moving house', text: { de: 'wegen meines Umzugs', en: 'because I am moving house' } },
  service: { de: 'Leistung nicht erbracht', en: 'Service not provided', text: { de: 'weil die vereinbarte Leistung wiederholt nicht erbracht wurde', en: 'because the agreed service has repeatedly not been provided' } },
  custom: { de: 'Eigener Grund', en: 'Own reason', text: null },
};

// generic notice-period help (German page). Deliberately cautious: typical cases, not legal advice.
const HELP_DE = {
  handy: 'Hat sich der Vertrag nach der Mindestlaufzeit automatisch verlängert, ist er in der Regel monatlich kündbar (Frist ein Monat). Während der Mindestlaufzeit meist zu deren Ende.',
  internet: 'Wie beim Handyvertrag: nach der Mindestlaufzeit und automatischer Verlängerung in der Regel monatlich kündbar. Beim Umzug gibt es unter Umständen ein Sonderkündigungsrecht, wenn der Anbieter am neuen Wohnort nicht liefern kann.',
  fitness: 'Bei Verträgen, die seit März 2022 geschlossen wurden, gilt nach einer stillschweigenden Verlängerung meist eine Frist von einem Monat. Ältere Verträge: siehe Vertrag.',
  energy: 'In der Grundversorgung meist zwei Wochen. Bei Sonderverträgen steht die Frist im Vertrag; nach Preiserhöhungen besteht oft ein Sonderkündigungsrecht.',
  insurance: 'Oft drei Monate zum Ende des Versicherungsjahres. Nach einer Beitragserhöhung oder einem Schadenfall kann ein Sonderkündigungsrecht bestehen.',
  magazine: 'Nach der Mindestlaufzeit verlängerte Abos sind bei Verträgen seit März 2022 meist monatlich kündbar. Die genaue Frist steht in den AGB.',
  streaming: 'Meist zum Ende des bezahlten Zeitraums kündbar – oft auch direkt im Konto oder über den Kündigungsbutton auf der Webseite.',
  rent: 'Für Mieter in der Regel drei Monate; der Brief muss spätestens am dritten Werktag eines Monats ankommen, damit dieser Monat mitzählt. Die Kündigung braucht deine eigenhändige Unterschrift auf Papier – E-Mail reicht nicht.',
  club: 'Steht in der Satzung des Vereins – oft zum Ende des Kalender- oder Geschäftsjahres.',
  other: 'Die Frist steht in deinem Vertrag oder in den AGB.',
};

// ---------------------------------------------------------------- letter model (plain text, per language)
export function buildLetter(v, lang) {
  const k = TYPES[v.type] || TYPES.other;
  const de = lang === 'de';
  const what = (k.whatFn && k.whatFn(v, lang)) || T(lang, k.what);
  const refs = k.refs.map(([id, lde, len]) => [de ? lde : len, String(v[id] || '').trim()]).filter(r => r[1]);
  const refText = refs.length && v.type !== 'rent' ? ` (${refs.map(r => `${r[0]}: ${r[1]}`).join(', ')})` : '';
  const date = fmtDate(v.date, lang);
  let when;
  if (v.type === 'rent' && de && v.when !== 'date') when = `fristgerecht zum nächstmöglichen Termin, nach meiner Berechnung zum ${fmtDate(tenancyEnd(v.receipt || isoToday()), lang)}`;
  else if (v.when === 'date' && date) when = de ? `zum ${date}` : `with effect from ${date}`;
  else when = de ? 'fristgerecht zum nächstmöglichen Zeitpunkt' : 'at the earliest possible date';
  const body = [];
  if (v.extraordinary) {
    const r = REASONS[v.reason] || REASONS.custom;
    const reason = v.reason === 'custom' ? String(v.reasonText || '').trim() : T(lang, r.text);
    const wd = v.when === 'date' && date ? (de ? ` zum ${date}` : ` with effect from ${date}`) : (de ? ' fristlos' : ' with immediate effect');
    body.push(de ? `hiermit kündige ich ${what}${refText} außerordentlich${wd}${reason ? `, ${reason}` : ''}.` : `I hereby give extraordinary notice to cancel ${what}${refText}${wd}${reason ? `, ${reason}` : ''}.`);
    body.push(de ? 'Hilfsweise kündige ich fristgerecht zum nächstmöglichen Zeitpunkt.' : 'Alternatively, I cancel at the earliest possible date.');
  } else {
    body.push(de ? `hiermit kündige ich ${what}${refText} ${when}.` : `I hereby cancel ${what}${refText} ${when}.`);
    if (v.when === 'date' && date && v.type !== 'rent') body.push(de ? 'Sollte eine Kündigung zu diesem Datum nicht möglich sein, gilt sie zum nächstmöglichen Zeitpunkt.' : 'If cancellation on this date is not possible, please treat this as cancellation at the earliest possible date.');
  }
  for (const t of (k.extra ? k.extra(v, lang) : [])) if (t) body.push(t);
  if (v.confirm !== false) body.push(de ? `Bitte bestätigen Sie mir den Eingang dieser Kündigung und das genaue Ende ${v.type === 'rent' ? 'des Mietverhältnisses' : 'des Vertrags'} schriftlich.` : `Please confirm in writing that you have received this cancellation and the exact end date of the ${v.type === 'rent' ? 'tenancy' : 'contract'}.`);
  if (v.sepa !== false && !k.noSepa) body.push(de ? 'Ein erteiltes SEPA-Lastschriftmandat widerrufe ich mit Wirkung zum Vertragsende.' : 'I withdraw any direct debit authorisation with effect from the end of the contract.');
  if (v.gdpr) body.push(de ? 'Zudem bitte ich Sie, meine personenbezogenen Daten gemäß Art. 17 DSGVO zu löschen, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen, und mir die Löschung zu bestätigen.' : 'I also ask you to erase my personal data under applicable data protection law (for example Art. 17 GDPR), unless you are legally required to keep it, and to confirm the erasure.');
  if (v.noAds) body.push(de ? 'Von Anrufen oder Nachrichten mit dem Ziel, mich als Kunden zurückzugewinnen, bitte ich abzusehen.' : 'Please do not contact me with offers to win me back as a customer.');
  const subject = T(lang, k.subj) + (refs[0] && v.type !== 'rent' ? ` – ${refs[0][0]} ${refs[0][1]}` : '');
  const name = String(v.sName || '').trim();
  const recipient = [v.rName, v.rAttn, v.rStreet, v.rCity, v.rCountry].map(s => String(s || '').trim()).filter(Boolean);
  const sender = [name, v.sStreet, v.sCity].map(s => String(s || '').trim()).filter(Boolean);
  const contact = [v.sPhone, v.sMail].map(s => String(s || '').trim()).filter(Boolean);
  const place = String(v.place || '').trim();
  const dateLine = `${place ? place + ', ' : ''}${fmtDate(v.letterDate || isoToday(), lang)}`;
  return { subject, salutation: de ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,', body, closing: de ? 'Mit freundlichen Grüßen' : 'Yours faithfully,', name, recipient, sender, contact, dateLine, refs: v.type === 'rent' ? [] : refs, paper: !!k.paper };
}

export function letterText(m) {
  return [m.sender.join('\n') + (m.contact.length ? '\n' + m.contact.join(' · ') : ''), '', m.recipient.join('\n'), '', m.dateLine, '', m.subject, '', m.salutation, '', ...m.body.flatMap(p => [p, '']), m.closing, '', '', m.name].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------------------------------------------------------------- PDF (DIN 5008 form B)
const WINANSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** Map text to what the standard PDF font can show; returns [text, replaced?]. */
export function winAnsi(s) {
  let out = '', changed = false;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI.has(ch)) { out += ch; continue; }
    if (ch === '\t') { out += ' '; continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const map = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', 'ø': 'o', '‐': '-', '‑': '-', '−': '-', ' ': ' ', ' ': ' ' };
    const r = map[ch] || ([...base].every(x => x.codePointAt(0) < 256) ? base : '?');
    out += r;
    changed = true;
  }
  return [out, changed];
}

async function makePdf(m, sig, lang) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mm = v => v * 72 / 25.4;
  const W = 595.28, H = 841.89;
  let replaced = false;
  const txt = s => { const [t, c] = winAnsi(s); if (c) replaced = true; return t; };
  let page = doc.addPage([W, H]);
  const marks = p => {
    for (const y of [105, 210]) p.drawLine({ start: { x: mm(3), y: H - mm(y) }, end: { x: mm(8), y: H - mm(y) }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) });
    p.drawLine({ start: { x: mm(3), y: H - mm(148.5) }, end: { x: mm(10), y: H - mm(148.5) }, thickness: 0.4, color: rgb(0.6, 0.6, 0.6) });
  };
  marks(page);
  const L = mm(25), R = W - mm(20), TW = R - L;
  const draw = (s, x, y, size = 11, f = font, color = rgb(0.08, 0.08, 0.1)) => page.drawText(txt(s), { x, y, size, font: f, color });
  // letterhead (sender) top right
  let y = H - mm(17);
  for (const [i, s] of [...m.sender, m.contact.join(' · ')].filter(Boolean).entries()) {
    const f = i === 0 ? bold : font, size = i === 0 ? 12 : 9.5;
    const w = f.widthOfTextAtSize(txt(s), size);
    draw(s, R - w, y, size, f);
    y -= size * 1.35;
  }
  // address field: 20 mm from the left, 45 mm from the top, 85 × 45 mm; return line in the top zone
  const ret = txt(m.sender.join(', '));
  const retSize = 7;
  if (ret) {
    const fitted = font.widthOfTextAtSize(ret, retSize) > mm(80) ? ret.slice(0, Math.floor(ret.length * mm(80) / font.widthOfTextAtSize(ret, retSize))) : ret;
    draw(fitted, L, H - mm(45 + 17.7) + 2, retSize, font, rgb(0.35, 0.35, 0.4));
    page.drawLine({ start: { x: L, y: H - mm(45 + 17.7) }, end: { x: L + font.widthOfTextAtSize(fitted, retSize), y: H - mm(45 + 17.7) }, thickness: 0.3, color: rgb(0.35, 0.35, 0.4) });
  }
  y = H - mm(45 + 17.7) - 13;
  for (const s of m.recipient.slice(0, 6)) { draw(s, L, y, 11); y -= 13.5; }
  // information block: x 125 mm, from 50 mm
  y = H - mm(50);
  const info = [...m.refs.map(r => `${r[0]}: ${r[1]}`), m.dateLine];
  for (const s of info) {
    const t = txt(s);
    const size = font.widthOfTextAtSize(t, 9.5) > R - mm(125) ? 8 : 9.5;
    draw(s, mm(125), y, size, font, rgb(0.2, 0.2, 0.25));
    y -= 13;
  }
  // subject at ~ 103 mm
  y = H - mm(103.4);
  const wrap = (s, f, size, width) => {
    const words = txt(s).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(t, size) <= width || !line) line = t; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  };
  const LH = 11 * 1.38;
  const newPage = () => { page = doc.addPage([W, H]); marks(page); y = H - mm(25); };
  const para = (s, f = font, size = 11) => {
    for (const ln of wrap(s, f, size, TW)) {
      if (y < mm(25)) newPage();
      page.drawText(ln, { x: L, y, size, font: f, color: rgb(0.08, 0.08, 0.1) });
      y -= size * 1.38;
    }
  };
  para(m.subject, bold, 11.5);
  y -= LH;
  para(m.salutation);
  y -= LH * 0.5;
  for (const p of m.body) { para(p); y -= LH * 0.5; }
  y -= LH * 0.3;
  if (y < mm(25) + 80) newPage();
  para(m.closing);
  if (sig) {
    const png = await doc.embedPng(sig.bytes);
    const h = mm(16), w = Math.min(mm(70), h * (sig.width / sig.height));
    page.drawImage(png, { x: L, y: y - h + 6, width: w, height: w * (sig.height / sig.width) });
    y -= h + 2;
  } else y -= LH * 2.2;
  if (m.name) para(m.name);
  doc.setTitle(txt(m.subject));
  doc.setLanguage(lang === 'de' ? 'de-DE' : 'en');
  const bytes = await saveDoc(doc, { title: txt(m.subject) });
  return { bytes, replaced };
}

// ---------------------------------------------------------------- signature pad
function signaturePad(lang, onChange) {
  const canvas = el('canvas', { class: 'img-sig-canvas', width: 900, height: 300, aria: { label: T(lang, { de: 'Unterschriftsfeld – mit Finger oder Maus unterschreiben', en: 'Signature field – sign with your finger or mouse' }) }, role: 'img' });
  const g = ctx2d(canvas);
  let drawing = false, last = null, ink = false;
  const pos = ev => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * canvas.width / r.width, (ev.clientY - r.top) * canvas.height / r.height]; };
  canvas.addEventListener('pointerdown', ev => { ev.preventDefault(); drawing = true; last = pos(ev); try { canvas.setPointerCapture(ev.pointerId); } catch { /* optional */ } dot(last); });
  canvas.addEventListener('pointermove', ev => {
    if (!drawing) return;
    const p = pos(ev);
    g.strokeStyle = '#141a3a'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke();
    last = p; ink = true;
  });
  const end = () => { if (drawing) { drawing = false; onChange(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  function dot(p) { g.fillStyle = '#141a3a'; g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill(); ink = true; }
  const clearBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { g.clearRect(0, 0, canvas.width, canvas.height); ink = false; onChange(); } }, icon('close'), T(lang, { de: 'Löschen', en: 'Clear' }));
  return {
    root: el('div', { class: 'img-sig' }, el('div', { class: 'img-sig-box' }, canvas, el('span', { class: 'img-sig-line', 'aria-hidden': 'true' })), el('div', { class: 'img-btn-row' }, clearBtn)),
    has: () => ink,
    /** PNG of the ink, cropped to its bounding box. */
    async export() {
      if (!ink) return null;
      const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (d[(y * canvas.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < x0) return null;
      const c = newCanvas(x1 - x0 + 9, y1 - y0 + 9);
      ctx2d(c).drawImage(canvas, x0 - 4, y0 - 4, c.width, c.height, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const out = { bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
      release(c);
      return out;
    },
  };
}

// ---------------------------------------------------------------- tool
let stageCtl = null;
const REQUIRED = v => ({ sName: !!String(v.sName || '').trim(), rName: !!String(v.rName || '').trim(), rAddr: !!String(v.rStreet || '').trim() && !!String(v.rCity || '').trim() });

export default {
  labels: { back_to_files: { de: 'Zurück zum Bearbeiten', en: 'Back to editing' } },
  options: [],
  mountStage(stage, state, ctx) { stageCtl = letterStage(stage, state, ctx); },

  status(v) {
    const L = v.letter || {};
    const r = REQUIRED(L);
    const missing = [];
    if (!r.sName) missing.push({ de: 'deinen Namen', en: 'your name' });
    if (!r.rName) missing.push({ de: 'den Empfänger', en: 'the recipient' });
    if (!r.rAddr) missing.push({ de: 'die Anschrift des Empfängers', en: 'the recipient’s address' });
    const name = TYPES[L.type || 'handy'].label;
    if (missing.length) return { ok: false, summary: name, hint: { de: `Noch nötig: ${missing.map(x => x.de).join(', ')}.`, en: `Still needed: ${missing.map(x => x.en).join(', ')}.` } };
    return { summary: name };
  },

  async run(inputs, opts, ctx) {
    const v = opts.letter || {};
    const r = REQUIRED(v);
    if (!r.sName || !r.rName || !r.rAddr) throw userError('Bitte fülle Absender, Empfänger und dessen Anschrift aus.', 'Please fill in sender, recipient and the recipient’s address.');
    const m = buildLetter(v, ctx.lang);
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const sig = stageCtl ? await stageCtl.signature() : null;
    const { bytes, replaced } = await makePdf(m, sig, ctx.lang);
    const k = TYPES[v.type] || TYPES.other;
    const name = ctx.safeFileName(`${ctx.t({ de: 'Kündigung', en: 'Cancellation' })} ${ctx.t(k.label).replace(/\s*\/\s*/g, '-')}${v.rName ? ' – ' + String(v.rName).trim() : ''}.pdf`);
    if (replaced) ctx.note({ de: 'Einige Sonderzeichen kann die PDF-Standardschrift nicht darstellen; sie wurden vereinfacht (z. B. „ł“ → „l“). Der kopierte Text enthält sie unverändert.', en: 'Some special characters can’t be shown by the standard PDF font and were simplified (e.g. “ł” → “l”). The copied text keeps them unchanged.' });
    if (k.paper && ctx.lang === 'de') ctx.note({ de: 'Wichtig: Diese Kündigung musst du ausdrucken und eigenhändig unterschreiben – eine E-Mail oder eine eingefügte Unterschrift reicht nicht.', en: '' });
    else if (k.paper) ctx.note({ de: '', en: 'Some contracts, such as tenancies, may require a handwritten signature on paper – check your agreement.' });
    ctx.note({ de: 'Tipp: Verschick die Kündigung nachweisbar, z. B. per Einschreiben, und heb den Beleg auf.', en: 'Tip: send the letter in a way you can prove, e.g. by recorded delivery, and keep the receipt.' });
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages: null, note: m.subject }] };
  },
};

function letterStage(stage, state, ctx) {
  const lang = ctx.lang;
  const de = lang === 'de';
  const v = (state.values.letter ||= { type: 'handy', when: 'next', confirm: true, sepa: true, gdpr: false, letterDate: isoToday(), reason: 'price', handover: true, deposit: true });
  // remembered sender (opt-in)
  let remember = false;
  try {
    const saved = JSON.parse(localStorage.getItem(SENDER_KEY) || 'null');
    if (saved && typeof saved === 'object') { remember = true; for (const k of ['sName', 'sStreet', 'sCity', 'sPhone', 'sMail', 'place']) if (typeof saved[k] === 'string' && !v[k]) v[k] = saved[k]; }
  } catch { /* storage unavailable */ }
  const saveSender = () => {
    try {
      if (remember) localStorage.setItem(SENDER_KEY, JSON.stringify(Object.fromEntries(['sName', 'sStreet', 'sCity', 'sPhone', 'sMail', 'place'].map(k => [k, String(v[k] || '')]))));
      else localStorage.removeItem(SENDER_KEY);
    } catch { /* storage unavailable */ }
  };

  const typeSel = el('select', { id: 'img-lt-type', class: 'wt-input', onchange: e => { v.type = e.target.value; renderType(); changed(); } },
    Object.entries(TYPES).map(([id, t]) => el('option', { value: id, selected: id === v.type }, T(lang, t.label))));
  const typeFields = el('div', { class: 'img-fields' });
  const help = el('details', { class: 'img-lt-help' });
  const whenBox = el('div', {});
  const preview = el('pre', { class: 'img-lt-preview', tabindex: '0', aria: { label: T(lang, { de: 'Vorschau des Brieftexts', en: 'Preview of the letter text' }) } });
  const copyMsg = el('span', { class: 'img-muted', role: 'status' });
  const sig = signaturePad(lang, () => changed());
  let copyTimer = 0;
  const copyBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: async () => {
    const text = letterText(buildLetter(v, lang));
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* fall back */ }
    if (!ok) {
      const ta = el('textarea', { class: 'img-sr', 'aria-hidden': 'true' });
      ta.value = text; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    copyMsg.textContent = T(lang, ok ? { de: 'Text kopiert.', en: 'Text copied.' } : { de: 'Kopieren nicht möglich – markiere den Text in der Vorschau.', en: 'Copying isn’t possible – select the text in the preview.' });
    clearTimeout(copyTimer); copyTimer = setTimeout(() => { copyMsg.textContent = ''; }, 4000);
  } }, icon('file'), T(lang, { de: 'Text kopieren', en: 'Copy text' }));

  const f = (key, label, o = {}) => field({ id: `img-lt-${key}`, label, value: v[key] ?? '', lang, onInput: x => { v[key] = x; if (key.startsWith('s') || key === 'place') saveSender(); changed(); }, ...o });
  const sec = (id, title, ...kids) => el('section', { class: 'img-box img-lt-sec', aria: { labelledby: id } }, el('h2', { class: 'img-h', id }, T(lang, title)), ...kids);

  function renderType() {
    const k = TYPES[v.type] || TYPES.other;
    clear(typeFields);
    for (const fd of k.fields) {
      if (fd.when && !fd.when(v)) continue;
      if (fd.type === 'check') {
        if (v[fd.id] === undefined && fd.def !== undefined) v[fd.id] = fd.def;
        typeFields.append(check({ id: `img-lt-${fd.id}`, label: fd.label, checked: v[fd.id] !== false && !!(v[fd.id] ?? fd.def), lang, onChange: x => { v[fd.id] = x; renderType(); changed(); } }));
      } else typeFields.append(f(fd.id, fd.label, { type: fd.type || 'text', placeholder: fd.placeholder || '', wide: true }));
    }
    clear(help);
    if (de) {
      help.append(el('summary', {}, icon('alert'), 'Welche Frist gilt? (Hilfe)'), el('div', {},
        el('p', {}, HELP_DE[v.type] || HELP_DE.other),
        v.type === 'rent' ? el('p', {}, `Wenn der Brief am ${fmtDate(v.receipt || isoToday(), 'de')} ankommt, endet das Mietverhältnis voraussichtlich am ${fmtDate(tenancyEnd(v.receipt || isoToday()), 'de')} (ohne Feiertage).`) : null,
        el('p', { class: 'img-muted' }, 'Das sind typische Fälle, keine Rechtsberatung. Maßgeblich sind dein Vertrag, die AGB und die aktuelle Rechtslage. Online geschlossene Verträge kannst du oft auch über den Kündigungsbutton auf der Webseite kündigen.')));
    } else {
      help.append(el('summary', {}, icon('alert'), 'Which notice period applies? (help)'), el('div', {},
        el('p', {}, 'Check your contract or the terms and conditions for the notice period. Many subscriptions can be cancelled at the end of the current billing period; tenancies often need several months’ notice and a signed letter.'),
        el('p', { class: 'img-muted' }, 'This is general information, not legal advice. Rules differ between countries and contracts.')));
    }
    renderWhen();
  }

  function renderWhen() {
    clear(whenBox);
    const seg = segmented({ name: 'img-lt-when', label: { de: 'Kündigen zum', en: 'Cancel' }, lang, value: v.when || 'next',
      choices: [{ value: 'next', label: { de: 'Nächstmöglicher Zeitpunkt', en: 'Earliest possible date' } }, { value: 'date', label: { de: 'Bestimmtes Datum', en: 'Specific date' } }],
      onChange: x => { v.when = x; renderWhen(); changed(); } });
    whenBox.append(seg.root);
    if (v.when === 'date') whenBox.append(f('date', { de: 'Vertragsende am', en: 'End date' }, { type: 'date' }));
    if (v.type === 'rent' && de && v.when !== 'date') {
      if (!v.receipt) { const d = new Date(); d.setDate(d.getDate() + 2); v.receipt = isoToday(d); }
      whenBox.append(f('receipt', { de: 'Der Brief kommt voraussichtlich an am', en: 'Expected delivery date' }, { type: 'date', hint: { de: `Ende voraussichtlich am ${fmtDate(tenancyEnd(v.receipt), 'de')} – ohne Gewähr, Feiertage nicht berücksichtigt.`, en: '' } }));
    }
    whenBox.append(check({ id: 'img-lt-extra', label: { de: 'Außerordentliche Kündigung / Sonderkündigung', en: 'Extraordinary / special cancellation' }, checked: !!v.extraordinary, lang,
      hint: { de: 'Nur wenn du einen besonderen Grund hast, z. B. eine Preiserhöhung. Der Brief kündigt dann hilfsweise auch fristgerecht.', en: 'Only if you have a special reason, e.g. a price increase. The letter then also cancels at the earliest regular date as a fallback.' },
      onChange: x => { v.extraordinary = x; renderWhen(); changed(); } }));
    if (v.extraordinary) {
      const sel = el('select', { id: 'img-lt-reason', class: 'wt-input', onchange: e => { v.reason = e.target.value; renderWhen(); changed(); } },
        Object.entries(REASONS).map(([id, r]) => el('option', { value: id, selected: id === v.reason }, de ? r.de : r.en)));
      whenBox.append(el('div', { class: 'img-field' }, el('label', { for: 'img-lt-reason' }, T(lang, { de: 'Grund', en: 'Reason' })), sel));
      if (v.reason === 'custom') whenBox.append(f('reasonText', { de: 'Grund in eigenen Worten', en: 'Reason in your own words' }, { placeholder: { de: 'z. B. wegen dauerhafter Störung meines Anschlusses', en: 'e.g. because my connection has been down for weeks' } }));
    }
  }

  const rememberBox = check({ id: 'img-lt-remember', label: { de: 'Absender auf diesem Gerät merken', en: 'Remember sender on this device' }, checked: remember, lang,
    hint: { de: 'Wird nur in diesem Browser gespeichert. Ausschalten löscht die gespeicherten Daten.', en: 'Stored only in this browser. Switching off deletes the stored data.' },
    onChange: x => { remember = x; saveSender(); } });

  stage.append(
    sec('img-lt-h1', { de: 'Was kündigst du?', en: 'What are you cancelling?' },
      el('div', { class: 'img-field' }, el('label', { for: 'img-lt-type' }, T(lang, { de: 'Vertragsart', en: 'Type of contract' })), typeSel), typeFields, whenBox, help),
    sec('img-lt-h2', { de: 'An wen geht der Brief?', en: 'Who is the letter for?' },
      el('div', { class: 'img-fields' }, f('rName', { de: 'Firma / Empfänger', en: 'Company / recipient' }, { autocomplete: 'organization' }), f('rAttn', { de: 'Abteilung / z. Hd. (optional)', en: 'Department / FAO (optional)' }),
        f('rStreet', { de: 'Straße und Hausnummer oder Postfach', en: 'Street or PO box' }), f('rCity', { de: 'PLZ und Ort', en: 'Postcode and town' }), f('rCountry', { de: 'Land (nur bei Auslandsbriefen)', en: 'Country (if abroad)' }))),
    sec('img-lt-h3', { de: 'Optionen', en: 'Options' },
      check({ id: 'img-lt-confirm', label: { de: 'Um schriftliche Bestätigung mit Vertragsende bitten', en: 'Ask for written confirmation with the end date' }, checked: v.confirm !== false, lang, onChange: x => { v.confirm = x; changed(); } }),
      check({ id: 'img-lt-sepa', label: { de: 'SEPA-Lastschriftmandat zum Vertragsende widerrufen', en: 'Withdraw the direct debit authorisation' }, checked: v.sepa !== false, lang, onChange: x => { v.sepa = x; changed(); } }),
      check({ id: 'img-lt-gdpr', label: { de: 'Löschung meiner Daten verlangen (Art. 17 DSGVO)', en: 'Ask for my data to be erased (e.g. Art. 17 GDPR)' }, checked: !!v.gdpr, lang, onChange: x => { v.gdpr = x; changed(); } }),
      check({ id: 'img-lt-noads', label: { de: 'Rückgewinnungs-Anrufe untersagen', en: 'No win-back calls' }, checked: !!v.noAds, lang, onChange: x => { v.noAds = x; changed(); } })),
    sec('img-lt-h4', { de: 'Absender', en: 'Sender' },
      el('div', { class: 'img-fields' }, f('sName', { de: 'Dein Name', en: 'Your name' }, { autocomplete: 'name' }), f('sStreet', { de: 'Straße und Hausnummer', en: 'Street and number' }, { autocomplete: 'street-address' }),
        f('sCity', { de: 'PLZ und Ort', en: 'Postcode and town' }), f('sPhone', { de: 'Telefon (optional)', en: 'Phone (optional)' }, { type: 'tel', wide: false, autocomplete: 'tel' }),
        f('sMail', { de: 'E-Mail (optional)', en: 'E-mail (optional)' }, { type: 'email', wide: false, autocomplete: 'email' }),
        f('place', { de: 'Ort für die Datumszeile', en: 'Place for the date line' }, { wide: false }), f('letterDate', { de: 'Datum des Briefs', en: 'Date of the letter' }, { type: 'date', wide: false })),
      rememberBox),
    sec('img-lt-h5', { de: 'Unterschrift (optional)', en: 'Signature (optional)' },
      el('p', { class: 'img-muted' }, T(lang, { de: 'Unterschreib mit dem Finger – oder lass das Feld leer und unterschreib auf dem Ausdruck.', en: 'Sign with your finger – or leave it empty and sign the printout.' })), sig.root),
    sec('img-lt-h6', { de: 'Vorschau', en: 'Preview' }, preview, el('div', { class: 'img-btn-row' }, copyBtn, copyMsg),
      el('p', { class: 'img-muted' }, T(lang, { de: 'Das PDF ist für ein Fensterkuvert (DIN lang oder C5) nach DIN 5008 gesetzt: Anschrift im Sichtfenster, Falzmarken am Rand.', en: 'The PDF is laid out for a DL or C5 window envelope (DIN 5008): address in the window, fold marks on the edge.' }))));

  let timer = 0;
  function changed() { state.results.clear(); ctx.refresh(); clearTimeout(timer); timer = setTimeout(renderPreview, 120); }
  function renderPreview() { preview.textContent = letterText(buildLetter(v, lang)); }
  renderType();
  renderPreview();
  ctx.refresh();
  return { signature: () => sig.export() };
}
