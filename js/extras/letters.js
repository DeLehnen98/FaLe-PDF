// „Schreiben & Vorlagen“: geführte Generatoren für Alltagsbriefe nach DIN 5008 (eigene Formulierungen).
// Ausgabe als bearbeitbares Dokument (.docx im Editor) und als PDF. Keine Rechtsberatung.
import { $, $$, h, esc, toast, errorToast, openDialog, debounce } from '../ui.js';
import { oicon, KINDS } from '../office/kinds.js';
import { getProfile, fullName, streetLine, cityLine, formatBirthDate, profileRoute } from './profile.js';
import { track } from './stats.js';
import { t } from '../i18n/index.js';

// the „Briefe per Post“ card: hidden while the service is not set up on the server (and nothing was sent yet)
const postHidden = () => { try { return localStorage.getItem('fale-post-on') === '0' && !JSON.parse(localStorage.getItem('fale-post-jobs') || '[]').length; } catch { return false; } };

export const DISCLAIMER = 'Die Vorlagen sind allgemeine Formulierungshilfen und ersetzen keine Rechtsberatung. Bitte prüfe Fristen und Angaben selbst – im Zweifel helfen Verbraucherzentrale, Mieterverein oder eine Anwältin bzw. ein Anwalt weiter.';

// DIN 5008-orientierte Seite: links 25 mm, rechts 20 mm
export const DIN_PAGE = { w: 595.3, h: 841.9, mt: 48, mr: 56.7, mb: 56.7, ml: 70.9 };

// ---------------- helpers ----------------
const pad = n => String(n).padStart(2, '0');
export function isoToday(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function deDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return isoToday(dt); }
const money = v => (Math.round((+v || 0) * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const num = v => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const e = s => esc(String(s ?? '').trim());
const lines = arr => arr.filter(x => x && String(x).trim()).map(e).join('<br>');

/** Gesetzliche Kündigungsfrist für Mieter (3 Monate, § 573c BGB) – Zugang bis zum 3. Werktag (Mo–Fr). Ohne Feiertage, ohne Gewähr. */
export function mietEnde(zugangIso) {
  const [y, m, d] = zugangIso.split('-').map(Number);
  let count = 0, third = 0;
  for (let day = 1; day <= 10; day++) {
    const wd = new Date(y, m - 1, day).getDay();
    if (wd !== 0 && wd !== 6) { count++; if (count === 3) { third = day; break; } }
  }
  const addMonths = d <= third ? 2 : 3;
  return isoToday(new Date(y, m - 1 + addMonths + 1, 0));
}

function salutation(v) {
  const n = (v.r_person || '').trim();
  if (!n) return 'Sehr geehrte Damen und Herren,';
  if (v.r_anrede === 'frau') return `Sehr geehrte Frau ${n},`;
  if (v.r_anrede === 'herr') return `Sehr geehrter Herr ${n},`;
  return `Guten Tag ${n},`;
}

// ---------------- common field groups ----------------
const SENDER = [
  { id: 's_name', label: 'Dein Name', def: p => fullName(p), auto: 'name' },
  { id: 's_strasse', label: 'Straße und Hausnummer', def: p => streetLine(p), auto: 'street-address' },
  { id: 's_ort', label: 'PLZ und Ort', def: p => cityLine(p), auto: 'off' },
  { id: 's_tel', label: 'Telefon (optional)', def: p => (p && p.telefon) || '', half: true, type: 'tel' },
  { id: 's_mail', label: 'E-Mail (optional)', def: p => (p && p.email) || '', half: true, type: 'email' },
];
const RECIPIENT = (label = 'Empfänger', ph = 'z. B. Muster Telekom GmbH') => [
  { id: 'r_name', label, placeholder: ph, required: true },
  { id: 'r_zusatz', label: 'Abteilung / z. Hd. (optional)', placeholder: 'z. B. Kundenservice' },
  { id: 'r_strasse', label: 'Straße und Hausnummer / Postfach' },
  { id: 'r_ort', label: 'PLZ und Ort' },
];
const PERSON_SAL = [
  { id: 'r_anrede', label: 'Ansprechperson', type: 'seg', options: [['', 'Keine'], ['frau', 'Frau'], ['herr', 'Herr'], ['neutral', 'Neutral']], def: '' },
  { id: 'r_person', label: 'Nachname (bzw. voller Name bei „Neutral“)', when: v => !!v.r_anrede },
];
const DATE = { id: 'datum', label: 'Datum des Briefs', type: 'date', def: () => isoToday(), half: true };
const PLACE = { id: 'ort_brief', label: 'Ort (für die Datumszeile)', def: p => (p && p.ort) || '', half: true };
const TERMIN = [
  { id: 'termin', label: 'Kündigen zum', type: 'seg', options: [['naechst', 'Nächstmöglich'], ['datum', 'Bestimmtes Datum']], def: 'naechst' },
  { id: 'termin_datum', label: 'Datum des Vertragsendes', type: 'date', when: v => v.termin === 'datum' },
];
const STANDARD_OPTS = [
  { id: 'bestaetigung', label: 'Um schriftliche Bestätigung mit Vertragsende bitten', type: 'check', def: true },
  { id: 'lastschrift', label: 'SEPA-Lastschriftmandat zum Vertragsende widerrufen', type: 'check', def: true },
  { id: 'werbung', label: 'Rückgewinnungs-Anrufe und Werbung untersagen', type: 'check', def: false },
];

// ---------------- Kündigungen ----------------
const K_VARIANTS = {
  handy: { label: 'Handyvertrag', icon: 'phone', what: 'meinen Mobilfunkvertrag', subj: 'Kündigung meines Mobilfunkvertrags',
    fields: [{ id: 'kundennr', label: 'Kundennummer', half: true }, { id: 'rufnr', label: 'Rufnummer', half: true, type: 'tel' }, { id: 'vertragsnr', label: 'Vertragsnummer (optional)' },
      { id: 'portierung', label: 'Ich möchte meine Rufnummer mitnehmen', type: 'check', def: false }],
    refs: v => [['Kundennummer', v.kundennr], ['Rufnummer', v.rufnr], ['Vertragsnummer', v.vertragsnr]],
    extra: v => (v.portierung ? ['Ich möchte meine Rufnummer zu einem anderen Anbieter mitnehmen. Bitte geben Sie die Rufnummer für die Übertragung frei und bestätigen Sie mir dies.'] : []) },
  fitness: { label: 'Fitnessstudio', icon: 'heart', what: 'meine Mitgliedschaft', subj: 'Kündigung meiner Mitgliedschaft',
    fields: [{ id: 'mitgliedsnr', label: 'Mitgliedsnummer', half: true }, { id: 'studio', label: 'Studio / Standort (optional)', half: true }],
    refs: v => [['Mitgliedsnummer', v.mitgliedsnr], ['Standort', v.studio]] },
  strom: { label: 'Strom / Gas', icon: 'flash', what: 'meinen Energieliefervertrag', subj: 'Kündigung meines Energieliefervertrags',
    fields: [{ id: 'energie', label: 'Art', type: 'seg', options: [['Strom', 'Strom'], ['Gas', 'Gas'], ['Strom und Gas', 'Beides']], def: 'Strom' },
      { id: 'kundennr', label: 'Kundennummer', half: true }, { id: 'zaehler', label: 'Zählernummer', half: true },
      { id: 'lieferstelle', label: 'Lieferadresse (falls abweichend)' },
      { id: 'zaehlerstand', label: 'Zählerstand (optional)', half: true }, { id: 'ablesedatum', label: 'Abgelesen am', type: 'date', half: true, when: v => !!v.zaehlerstand }],
    what2: v => `meinen ${v.energie === 'Gas' ? 'Gasliefervertrag' : v.energie === 'Strom und Gas' ? 'Strom- und Gasliefervertrag' : 'Stromliefervertrag'}`,
    subj2: v => `Kündigung meines ${v.energie === 'Gas' ? 'Gasliefervertrags' : v.energie === 'Strom und Gas' ? 'Strom- und Gasliefervertrags' : 'Stromliefervertrags'}`,
    refs: v => [['Kundennummer', v.kundennr], ['Zählernummer', v.zaehler], ['Lieferstelle', v.lieferstelle]],
    extra: v => [v.zaehlerstand ? `Der Zählerstand betrug am ${deDate(v.ablesedatum) || 'Tag der Ablesung'}: ${e(v.zaehlerstand)}.` : '', 'Bitte senden Sie mir die Schlussrechnung an die oben genannte Anschrift.'] },
  versicherung: { label: 'Versicherung', icon: 'shield', what: 'meinen Versicherungsvertrag', subj: 'Kündigung meines Versicherungsvertrags',
    fields: [{ id: 'sparte', label: 'Versicherung', placeholder: 'z. B. Hausratversicherung', half: true }, { id: 'police', label: 'Versicherungsnummer', half: true }],
    what2: v => (v.sparte ? `meine ${e(v.sparte)}` : 'meinen Versicherungsvertrag'),
    subj2: v => (v.sparte ? `Kündigung meiner ${e(v.sparte)}` : 'Kündigung meines Versicherungsvertrags'),
    refs: v => [['Versicherungsnummer', v.police]] },
  abo: { label: 'Zeitung / Abo', icon: 'bookOpen', what: 'mein Abonnement', subj: 'Kündigung meines Abonnements',
    fields: [{ id: 'titel', label: 'Zeitung / Zeitschrift / Abo', half: true }, { id: 'abonr', label: 'Abo- oder Kundennummer', half: true }],
    what2: v => (v.titel ? `mein Abonnement „${e(v.titel)}“` : 'mein Abonnement'),
    refs: v => [['Abonummer', v.abonr]] },
  miete: { label: 'Mietvertrag Wohnung', icon: 'home', what: 'das Mietverhältnis', subj: 'Kündigung des Mietverhältnisses', signedPaper: true,
    fields: [{ id: 'objekt', label: 'Anschrift der Wohnung', def: p => [streetLine(p), cityLine(p)].filter(Boolean).join(', ') }, { id: 'lage', label: 'Lage (optional)', placeholder: 'z. B. 2. OG links', half: true },
      { id: 'mitmieter', label: 'Weitere Mieter (optional)', placeholder: 'Namen, durch Komma getrennt', half: true },
      { id: 'zugang', label: 'Der Brief erreicht den Vermieter voraussichtlich am', type: 'date', def: () => addDays(isoToday(), 2), hint: v => `Gesetzliche Frist für Mieter (3 Monate): Ende voraussichtlich am ${deDate(mietEnde(v.zugang || isoToday()))} – ohne Gewähr, Feiertage nicht berücksichtigt.` },
      { id: 'uebergabe', label: 'Um Termin für die Wohnungsübergabe bitten', type: 'check', def: true },
      { id: 'kaution', label: 'Um Abrechnung der Kaution bitten', type: 'check', def: true },
      { id: 'kaution_iban', label: 'IBAN für die Kautionsrückzahlung', def: p => (p && p.iban) || '', when: v => v.kaution }],
    what2: v => `das Mietverhältnis über die Wohnung ${e(v.objekt)}${v.lage ? ` (${e(v.lage)})` : ''}`,
    refs: () => [],
    terminText: v => (v.termin === 'datum' && v.termin_datum ? `zum ${deDate(v.termin_datum)}` : `fristgerecht zum nächstmöglichen Termin, nach meiner Berechnung zum ${deDate(mietEnde(v.zugang || isoToday()))}`),
    extra: v => [v.uebergabe ? 'Für die Übergabe der Wohnung und der Schlüssel bitte ich Sie, mir rechtzeitig mögliche Termine zu nennen.' : '', v.kaution ? `Bitte rechnen Sie die Mietkaution nach Ende des Mietverhältnisses ab und überweisen Sie das Guthaben${v.kaution_iban ? ` auf das Konto IBAN ${e(v.kaution_iban)}` : ''}.` : ''],
    noLastschrift: true, cosign: v => String(v.mitmieter || '').split(',').map(s => s.trim()).filter(Boolean) },
  arbeit: { label: 'Arbeitsvertrag', icon: 'idcard', what: 'mein Arbeitsverhältnis', subj: 'Kündigung meines Arbeitsverhältnisses', signedPaper: true,
    fields: [{ id: 'personalnr', label: 'Personalnummer (optional)', half: true }, { id: 'position', label: 'Position (optional)', half: true },
      { id: 'zeugnis', label: 'Um qualifiziertes Arbeitszeugnis bitten', type: 'check', def: true },
      { id: 'urlaub', label: 'Resturlaub ansprechen', type: 'check', def: false },
      { id: 'dank', label: 'Dank für die Zusammenarbeit', type: 'check', def: true }],
    refs: v => [['Personalnummer', v.personalnr]],
    extra: v => [v.zeugnis ? 'Bitte stellen Sie mir ein qualifiziertes Arbeitszeugnis aus.' : '', v.urlaub ? 'Bitte teilen Sie mir mit, wie mein verbleibender Resturlaub bis zum Ende des Arbeitsverhältnisses berücksichtigt wird.' : '', v.dank ? 'Für die bisherige Zusammenarbeit bedanke ich mich herzlich.' : ''],
    noLastschrift: true, noWerbung: true },
  streaming: { label: 'Streamingdienst', icon: 'play', what: 'mein Abonnement', subj: 'Kündigung meines Abonnements',
    fields: [{ id: 'dienst', label: 'Dienst', placeholder: 'Name des Dienstes', half: true }, { id: 'konto', label: 'E-Mail-Adresse des Kontos', type: 'email', def: p => (p && p.email) || '', half: true }, { id: 'kundennr', label: 'Kundennummer (optional)' }],
    what2: v => (v.dienst ? `mein Abonnement bei ${e(v.dienst)}` : 'mein Abonnement'),
    refs: v => [['Konto', v.konto], ['Kundennummer', v.kundennr]] },
};

function kuendigungDef(art) {
  const k = K_VARIANTS[art] || K_VARIANTS.handy;
  return {
    id: 'kuendigung', art, title: `Kündigung – ${k.label}`, fileTitle: `Kündigung ${k.label.replace(/\s*\/\s*/g, '-')}`,
    note: k.signedPaper ? 'Wichtig: Diese Kündigung muss auf Papier ausgedruckt und eigenhändig unterschrieben werden (E-Mail oder Fax reichen nicht).' : 'Tipp: Verschicke die Kündigung nachweisbar, z. B. per Einschreiben, oder nutze den Kündigungsbutton auf der Webseite des Anbieters.',
    sections: [
      { title: 'Vertrag', fields: [...k.fields, ...TERMIN] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT(art === 'miete' ? 'Vermieter / Hausverwaltung' : art === 'arbeit' ? 'Arbeitgeber' : 'Anbieter', art === 'miete' ? 'z. B. Hausverwaltung Beispiel' : art === 'arbeit' ? 'z. B. Beispiel GmbH' : 'z. B. Muster GmbH') },
      { title: 'Optionen', fields: STANDARD_OPTS.filter(f => !(f.id === 'lastschrift' && k.noLastschrift) && !(f.id === 'werbung' && k.noWerbung)) },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const what = k.what2 ? k.what2(v) : k.what;
      const refs = (k.refs ? k.refs(v) : []).filter(r => r[1]);
      const termin = k.terminText ? k.terminText(v) : v.termin === 'datum' && v.termin_datum ? `zum ${deDate(v.termin_datum)}` : 'fristgerecht zum nächstmöglichen Zeitpunkt';
      const body = [];
      const refText = refs.length && art !== 'miete' ? ` (${refs.map(r => `${r[0]}: ${e(r[1])}`).join(', ')})` : '';
      body.push(`hiermit kündige ich ${what}${refText} ${termin}.`);
      if (v.termin === 'datum' && v.termin_datum && art !== 'miete') body.push('Sollte eine Kündigung zu diesem Datum nicht möglich sein, gilt sie zum nächstmöglichen Zeitpunkt.');
      if (art === 'miete') { const co = k.cosign(v); if (co.length) body.push(`Die Kündigung erfolgt zugleich im Namen der weiteren Mieter (${co.map(e).join(', ')}).`); }
      (k.extra ? k.extra(v) : []).filter(Boolean).forEach(t => body.push(t));
      if (v.bestaetigung) body.push(`Bitte bestätigen Sie mir den Eingang dieser Kündigung und das genaue Ende ${art === 'arbeit' ? 'des Arbeitsverhältnisses' : art === 'miete' ? 'des Mietverhältnisses' : 'des Vertrags'} schriftlich.`);
      if (v.lastschrift && !k.noLastschrift) body.push('Ein erteiltes SEPA-Lastschriftmandat widerrufe ich mit Wirkung zum Vertragsende.');
      if (v.werbung && !k.noWerbung) body.push('Von Anrufen oder Nachrichten mit dem Ziel, mich als Kunden zurückzugewinnen, bitte ich abzusehen. Einer weiteren Nutzung meiner Daten für Werbezwecke widerspreche ich.');
      return {
        subject: (k.subj2 ? k.subj2(v) : k.subj) + (refs[0] && art !== 'miete' ? ` – ${refs[0][0]} ${e(refs[0][1])}` : ''),
        refs: art === 'miete' ? [] : refs, body, signedPaper: k.signedPaper,
        cosign: art === 'miete' ? k.cosign(v) : [],
      };
    },
    reminder: v => ({ title: `Bestätigung der Kündigung prüfen${v.r_name ? ` (${v.r_name})` : ''}`, type: 'termin', due: addDays(isoToday(), 14), leads: [0] }),
  };
}

// ---------------- other letters ----------------
function itemsField() {
  return { id: 'items', label: 'Positionen', type: 'items', def: () => [{ text: '', qty: '1', unit: 'Stk.', price: '' }] };
}
function taxField() {
  return { id: 'ust', label: 'Umsatzsteuer', type: 'select', options: [['19', '19 % USt.'], ['7', '7 % USt.'], ['0', '0 % (steuerfrei)'], ['klein', 'Kleinunternehmer (§ 19 UStG)']], def: 'klein' };
}
function sumItems(v) {
  const rows = (v.items || []).filter(it => (it.text || '').trim() || num(it.price));
  const net = rows.reduce((s, it) => s + Math.round(num(it.qty || 1) * num(it.price) * 100) / 100, 0);
  const rate = v.ust === 'klein' ? 0 : num(v.ust);
  const tax = Math.round(net * rate) / 100;
  return { rows, net: Math.round(net * 100) / 100, rate, tax, gross: Math.round((net + tax) * 100) / 100 };
}
function itemsTable(v) {
  const s = sumItems(v);
  const head = ['Pos.', 'Beschreibung', 'Menge', 'Einzelpreis', 'Gesamt'];
  const hd = (t, right) => `<td style="background-color:#E9E8FB"><p${right ? ' style="text-align:right"' : ''}><strong>${t}</strong></p></td>`;
  let html = `<table><colgroup><col style="width:8%"><col style="width:46%"><col style="width:14%"><col style="width:16%"><col style="width:16%"></colgroup><tbody><tr>${head.map((t, i) => hd(t, i >= 2)).join('')}</tr>`;
  s.rows.forEach((it, i) => {
    const total = num(it.qty || 1) * num(it.price);
    html += `<tr><td><p>${i + 1}</p></td><td><p>${e(it.text) || '–'}</p></td><td><p style="text-align:right">${e(it.qty || '1')} ${e(it.unit || '')}</p></td><td><p style="text-align:right">${money(num(it.price))}</p></td><td><p style="text-align:right">${money(total)}</p></td></tr>`;
  });
  if (!s.rows.length) html += '<tr><td><p>1</p></td><td><p>Leistung / Artikel</p></td><td><p style="text-align:right">1</p></td><td><p style="text-align:right">0,00 €</p></td><td><p style="text-align:right">0,00 €</p></td></tr>';
  html += '</tbody></table>';
  const row = (l, r, b) => `<tr><td><p><br></p></td><td><p>${b ? `<strong>${l}</strong>` : l}</p></td><td><p style="text-align:right">${b ? `<strong>${r}</strong>` : r}</p></td></tr>`;
  html += '<table class="borderless"><colgroup><col style="width:52%"><col style="width:28%"><col style="width:20%"></colgroup><tbody>';
  if (v.ust === 'klein') html += row('Gesamtbetrag', money(s.net), true);
  else html += row('Nettobetrag', money(s.net)) + row(`zzgl. ${s.rate.toLocaleString('de-DE')} % USt.`, money(s.tax)) + row('Gesamtbetrag', money(s.gross), true);
  html += '</tbody></table>';
  return { html, sums: s };
}
function nextInvoiceNo(prefix = '') {
  const y = new Date().getFullYear();
  let st = null;
  try { st = JSON.parse(localStorage.getItem('fale-invoice-seq') || 'null'); } catch {}
  const n = st && st.y === y ? st.n + 1 : 1;
  return `${prefix}${y}-${String(n).padStart(3, '0')}`;
}
function bumpInvoiceNo(no) {
  const m = /(\d{4})-(\d+)$/.exec(no || '');
  if (!m) return;
  try { localStorage.setItem('fale-invoice-seq', JSON.stringify({ y: +m[1], n: +m[2] })); } catch {}
}
function bankLine(p) {
  if (!p) return '';
  return [p.bank, p.iban ? `IBAN ${p.iban}` : '', p.bic ? `BIC ${p.bic}` : ''].filter(Boolean).join(' · ');
}
function taxIdLine(p) {
  if (!p) return '';
  return [p.steuernummer ? `Steuernummer ${p.steuernummer}` : '', p.ustid ? `USt-IdNr. ${p.ustid}` : ''].filter(Boolean).join(' · ');
}

const OTHER = {
  widerruf: {
    id: 'widerruf', title: 'Widerruf eines Kaufs oder Vertrags', fileTitle: 'Widerruf', icon: 'restore',
    note: 'Bei Online-Käufen und Verträgen außerhalb von Geschäftsräumen gilt meist eine Widerrufsfrist von 14 Tagen ab Erhalt der Ware bzw. Vertragsschluss. Ein Grund ist nicht nötig.',
    sections: [
      { title: 'Bestellung', fields: [
        { id: 'art', label: 'Es geht um', type: 'seg', options: [['ware', 'Ware'], ['dienst', 'Dienstleistung / Vertrag']], def: 'ware' },
        { id: 'gegenstand', label: 'Was wurde bestellt?', placeholder: 'z. B. Kaffeemaschine Modell XY', required: true },
        { id: 'bestellnr', label: 'Bestell- oder Vertragsnummer', half: true }, { id: 'bestellt', label: 'Bestellt am', type: 'date', half: true },
        { id: 'erhalten', label: 'Erhalten am', type: 'date', half: true, when: v => v.art === 'ware' },
        { id: 'ruecksendung', label: 'Rücksendung', type: 'seg', options: [['folgt', 'Folgt'], ['erfolgt', 'Bereits verschickt']], def: 'folgt', when: v => v.art === 'ware' },
        { id: 'iban', label: 'Erstattung auf Konto (optional)', placeholder: 'leer = gleicher Zahlungsweg', def: p => (p && p.iban) || '' },
      ] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT('Händler / Anbieter', 'z. B. Beispiel Versand GmbH') },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const refs = [['Bestellnummer', v.bestellnr], ['Bestellt am', deDate(v.bestellt)], ['Erhalten am', v.art === 'ware' ? deDate(v.erhalten) : '']].filter(r => r[1]);
      const body = [`hiermit widerrufe ich den mit Ihnen geschlossenen Vertrag über ${v.art === 'ware' ? 'den Kauf von' : 'die Leistung'} „${e(v.gegenstand) || '…'}“${v.bestellnr ? ` (Bestellnummer ${e(v.bestellnr)})` : ''}.`];
      if (v.art === 'ware') body.push(v.ruecksendung === 'erfolgt' ? 'Die Ware habe ich bereits an Sie zurückgeschickt.' : 'Die Ware sende ich Ihnen zurück.');
      body.push(`Bitte erstatten Sie mir alle geleisteten Zahlungen${v.art === 'ware' ? ' einschließlich der Hinsendekosten' : ''} unverzüglich, spätestens innerhalb von 14 Tagen, ${v.iban ? `auf das Konto IBAN ${e(v.iban)}` : 'über denselben Zahlungsweg'}.`);
      body.push('Bitte bestätigen Sie mir den Eingang dieses Widerrufs.');
      return { subject: `Widerruf${v.bestellnr ? ` – Bestellung ${e(v.bestellnr)}` : ''}`, refs, body };
    },
  },
  widerspruch: {
    id: 'widerspruch', title: 'Widerspruch gegen einen Bescheid', fileTitle: 'Widerspruch', icon: 'scale',
    note: 'Die Frist steht in der Rechtsbehelfsbelehrung des Bescheids – meist ein Monat ab Bekanntgabe. Gegen Steuerbescheide heißt der Rechtsbehelf „Einspruch“.',
    sections: [
      { title: 'Bescheid', fields: [
        { id: 'typ', label: 'Rechtsbehelf', type: 'seg', options: [['widerspruch', 'Widerspruch'], ['einspruch', 'Einspruch (Finanzamt)']], def: 'widerspruch' },
        { id: 'bescheidart', label: 'Art des Bescheids', placeholder: 'z. B. Bescheid über Wohngeld', required: true },
        { id: 'datum_bescheid', label: 'Bescheid vom', type: 'date', half: true }, { id: 'az', label: 'Aktenzeichen / Steuernummer', half: true },
        { id: 'begruendung', label: 'Begründung (optional)', type: 'textarea', placeholder: 'Leer lassen, wenn du die Begründung nachreichen möchtest.' },
        { id: 'frist_nachreichen', label: 'Begründung nachreichen bis', type: 'date', def: () => addDays(isoToday(), 28), when: v => !(v.begruendung || '').trim() },
        { id: 'akteneinsicht', label: 'Akteneinsicht beantragen', type: 'check', def: false },
      ] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT('Behörde', 'z. B. Stadt Musterstadt, Sozialamt') },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const w = v.typ === 'einspruch' ? 'Einspruch' : 'Widerspruch';
      const refs = [['Aktenzeichen', v.az], ['Bescheid vom', deDate(v.datum_bescheid)]].filter(r => r[1]);
      const body = [`gegen den ${e(v.bescheidart) || 'Bescheid'}${v.datum_bescheid ? ` vom ${deDate(v.datum_bescheid)}` : ''}${v.az ? ` (Aktenzeichen ${e(v.az)})` : ''} lege ich hiermit ${w} ein.`];
      if ((v.begruendung || '').trim()) { body.push('Begründung:'); String(v.begruendung).split(/\n{2,}/).forEach(p => body.push(e(p).replace(/\n/g, '<br>'))); }
      else body.push(`Eine ausführliche Begründung reiche ich nach. Ich bitte darum, bis ${v.frist_nachreichen ? `zum ${deDate(v.frist_nachreichen)}` : 'zum Eingang der Begründung'} von einer Entscheidung abzusehen.`);
      if (v.akteneinsicht) body.push('Zugleich beantrage ich Einsicht in die vollständige Verwaltungsakte. Bitte teilen Sie mir mit, wann und wo dies möglich ist, oder übersenden Sie mir Kopien.');
      body.push(`Bitte bestätigen Sie mir den Eingang dieses ${w}s.`);
      return { subject: `${w} gegen den ${e(v.bescheidart) || 'Bescheid'}${v.datum_bescheid ? ` vom ${deDate(v.datum_bescheid)}` : ''}`, refs, body, signedPaper: true };
    },
    reminder: v => (!(v.begruendung || '').trim() && v.frist_nachreichen ? { title: `Begründung zum ${v.typ === 'einspruch' ? 'Einspruch' : 'Widerspruch'} nachreichen`, type: 'termin', due: v.frist_nachreichen, leads: [7, 1] } : null),
  },
  mahnung: {
    id: 'mahnung', title: 'Mahnung / Zahlungserinnerung', fileTitle: 'Mahnung', icon: 'euro',
    sections: [
      { title: 'Offene Rechnung', fields: [
        { id: 'stufe', label: 'Stufe', type: 'select', options: [['1', 'Freundliche Zahlungserinnerung'], ['2', '1. Mahnung'], ['3', '2. Mahnung'], ['4', 'Letzte Mahnung']], def: '1' },
        { id: 're_nr', label: 'Rechnungsnummer', half: true, required: true }, { id: 're_datum', label: 'Rechnungsdatum', type: 'date', half: true },
        { id: 'betrag', label: 'Offener Betrag (€)', type: 'money', half: true, required: true }, { id: 'gebuehr', label: 'Mahngebühr (€, optional)', type: 'money', half: true, when: v => v.stufe !== '1' },
        { id: 'frist', label: 'Neue Zahlungsfrist', type: 'date', def: () => addDays(isoToday(), 10) },
        { id: 'kontakt', label: 'Fragen zur Rechnung anbieten', type: 'check', def: true },
      ] },
      { title: 'An wen geht der Brief?', fields: [...RECIPIENT('Kunde', 'z. B. Erika Muster'), ...PERSON_SAL] },
      { title: 'Absender & Bankverbindung', collapsed: true, fields: [...SENDER, { id: 'bank', label: 'Bankverbindung', def: p => bankLine(p) }, PLACE, DATE] },
    ],
    build(v) {
      const st = +v.stufe || 1;
      const amount = num(v.betrag), fee = st > 1 ? num(v.gebuehr) : 0;
      const refs = [['Rechnungsnummer', v.re_nr], ['Rechnungsdatum', deDate(v.re_datum)]].filter(r => r[1]);
      const reText = `meine Rechnung${v.re_nr ? ` Nr. ${e(v.re_nr)}` : ''}${v.re_datum ? ` vom ${deDate(v.re_datum)}` : ''} über ${money(amount)}`;
      const body = [];
      if (st === 1) body.push(`sicher ist es Ihrer Aufmerksamkeit entgangen: Für ${reText} konnte ich bisher keinen Zahlungseingang feststellen.`);
      else if (st === 2) body.push(`leider ist ${reText} trotz Fälligkeit noch nicht beglichen.`);
      else if (st === 3) body.push(`trotz meiner Erinnerung ist ${reText} weiterhin offen.`);
      else body.push(`trotz mehrfacher Erinnerung ist ${reText} bis heute nicht bezahlt.`);
      const total = amount + fee;
      body.push(`Bitte überweisen Sie ${fee ? `den Betrag zuzüglich ${money(fee)} Mahngebühr, insgesamt ${money(total)},` : 'den offenen Betrag'} bis spätestens ${deDate(v.frist) || '…'}${v.bank ? ` auf folgendes Konto: ${e(v.bank)}` : ''}.`);
      if (st === 4) body.push('Sollte der Betrag bis zu diesem Datum nicht eingehen, werde ich ohne weitere Ankündigung weitere Schritte zur Durchsetzung der Forderung einleiten. Die dadurch entstehenden Kosten gehen zu Ihren Lasten.');
      if (v.kontakt) body.push('Sollten Sie Fragen zur Rechnung haben oder sich die Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos bzw. melden Sie sich gerne bei mir.');
      const t = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung', 4: 'Letzte Mahnung' }[st];
      return { subject: `${t}${v.re_nr ? ` – Rechnung Nr. ${e(v.re_nr)}` : ''}`, refs, body, salutation: salutation(v) };
    },
    reminder: v => (v.frist ? { title: `Zahlungseingang prüfen${v.re_nr ? ` (Rechnung ${v.re_nr})` : ''}`, type: 'zahlung', due: v.frist, leads: [0] } : null),
  },
  rechnung: {
    id: 'rechnung', title: 'Rechnung', fileTitle: 'Rechnung', icon: 'euro', business: true,
    note: 'Pflichtangaben: vollständige Namen und Anschriften, Steuernummer oder USt-IdNr., Datum, fortlaufende Rechnungsnummer, Leistung und Leistungsdatum, Entgelt und Steuer (bzw. Hinweis auf § 19 UStG).',
    sections: [
      { title: 'Rechnung', fields: [
        { id: 're_nr', label: 'Rechnungsnummer', def: () => nextInvoiceNo(), half: true, required: true }, { id: 'kundennr', label: 'Kundennummer (optional)', half: true },
        { id: 'datum', label: 'Rechnungsdatum', type: 'date', def: () => isoToday(), half: true }, { id: 'leistung', label: 'Leistungsdatum / -zeitraum', def: () => deDate(isoToday()), half: true },
        itemsField(), taxField(),
        { id: 'ziel', label: 'Zahlungsziel', type: 'select', options: [['0', 'Sofort fällig'], ['7', '7 Tage'], ['14', '14 Tage'], ['30', '30 Tage']], def: '14' },
      ] },
      { title: 'Rechnung an', fields: [...RECIPIENT('Kunde (Name oder Firma)', 'z. B. Kunde GmbH'), ...PERSON_SAL] },
      { title: 'Dein Unternehmen', collapsed: true, fields: [
        { id: 's_firma', label: 'Firma (optional)', def: p => (p && p.firma) || '' }, ...SENDER,
        { id: 'steuer', label: 'Steuernummer / USt-IdNr.', def: p => taxIdLine(p), required: true }, { id: 'bank', label: 'Bankverbindung', def: p => bankLine(p) }, PLACE] },
    ],
    build(v) {
      const { html, sums } = itemsTable(v);
      const ziel = +v.ziel || 0;
      const refs = [['Rechnungsnummer', v.re_nr], ['Kundennummer', v.kundennr], ['Leistungsdatum', v.leistung]].filter(r => r[1]);
      const body = ['für meine Leistungen erlaube ich mir, folgende Rechnung zu stellen:'];
      const after = [];
      if (v.ust === 'klein') after.push('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
      after.push(ziel ? `Bitte überweisen Sie den Gesamtbetrag von ${money(sums.gross)} innerhalb von ${ziel} Tagen (bis ${deDate(addDays(v.datum || isoToday(), ziel))}) unter Angabe der Rechnungsnummer${v.bank ? ` auf folgendes Konto: ${e(v.bank)}` : ''}.` : `Der Betrag von ${money(sums.gross)} ist sofort ohne Abzug fällig${v.bank ? `. Bankverbindung: ${e(v.bank)}` : ''}.`);
      after.push('Vielen Dank für Ihren Auftrag!');
      return { subject: `Rechnung Nr. ${e(v.re_nr) || '…'}`, refs, body, table: html, after, salutation: salutation(v), footer: [v.s_firma || v.s_name, v.steuer, v.bank].filter(Boolean).map(e).join(' · '), headerTitle: 'Rechnung' };
    },
    onCreate: v => bumpInvoiceNo(v.re_nr),
    reminder: v => (+v.ziel ? { title: `Zahlung prüfen: Rechnung ${v.re_nr}${v.r_name ? ` (${v.r_name})` : ''}`, type: 'zahlung', due: addDays(v.datum || isoToday(), +v.ziel), leads: [0] } : null),
  },
  angebot: {
    id: 'angebot', title: 'Angebot', fileTitle: 'Angebot', icon: 'notes', business: true,
    sections: [
      { title: 'Angebot', fields: [
        { id: 'an_nr', label: 'Angebotsnummer', def: () => `A-${isoToday().replace(/-/g, '').slice(2)}`, half: true }, { id: 'gueltig', label: 'Gültig bis', type: 'date', def: () => addDays(isoToday(), 30), half: true },
        { id: 'einleitung', label: 'Einleitung', type: 'textarea', def: () => 'vielen Dank für Ihre Anfrage. Gerne biete ich Ihnen folgende Leistungen an:' },
        itemsField(), taxField(),
      ] },
      { title: 'Angebot an', fields: [...RECIPIENT('Kunde (Name oder Firma)', 'z. B. Kunde GmbH'), ...PERSON_SAL] },
      { title: 'Dein Unternehmen', collapsed: true, fields: [{ id: 's_firma', label: 'Firma (optional)', def: p => (p && p.firma) || '' }, ...SENDER, { id: 'steuer', label: 'Steuernummer / USt-IdNr. (optional)', def: p => taxIdLine(p) }, PLACE, DATE] },
    ],
    build(v) {
      const { html } = itemsTable(v);
      const refs = [['Angebotsnummer', v.an_nr], ['Gültig bis', deDate(v.gueltig)]].filter(r => r[1]);
      const after = [];
      if (v.ust === 'klein') after.push('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
      after.push(`Dieses Angebot ist gültig bis ${deDate(v.gueltig) || '…'}. Bei Fragen melden Sie sich gerne – ich freue mich auf Ihren Auftrag.`);
      return { subject: `Angebot Nr. ${e(v.an_nr) || '…'}`, refs, body: [e(v.einleitung || '').replace(/\n/g, '<br>')], table: html, after, salutation: salutation(v), footer: [v.s_firma || v.s_name, v.steuer].filter(Boolean).map(e).join(' · '), headerTitle: 'Angebot' };
    },
  },
  vollmacht: {
    id: 'vollmacht', title: 'Vollmacht', fileTitle: 'Vollmacht', icon: 'key', standalone: true,
    note: 'Für Bankgeschäfte, Grundstücke oder Gesundheitsfragen gelten besondere Anforderungen – dafür ist diese einfache Vollmacht nicht gedacht.',
    sections: [
      { title: 'Ich (Vollmachtgeber)', fields: [...SENDER.slice(0, 3), { id: 's_geb', label: 'Geburtsdatum', def: p => formatBirthDate(p), half: true }, PLACE, DATE] },
      { title: 'Bevollmächtigte Person', fields: [
        { id: 'b_name', label: 'Name', required: true }, { id: 'b_geb', label: 'Geburtsdatum (optional)', type: 'date', half: true }, { id: 'b_ort', label: 'Wohnort (optional)', half: true },
      ] },
      { title: 'Wofür?', fields: [
        { id: 'zweck', label: 'Zweck', type: 'select', options: [['paket', 'Abholung einer Sendung / eines Pakets'], ['dokumente', 'Abholung von Dokumenten'], ['behoerde', 'Erledigung bei einer Behörde'], ['kfz', 'An-/Ummeldung eines Fahrzeugs'], ['frei', 'Eigener Text']], def: 'paket' },
        { id: 'details', label: 'Details', placeholder: 'z. B. Sendungsnummer, Behörde, Kennzeichen …', type: 'textarea' },
        { id: 'gueltig', label: 'Gültigkeit', type: 'seg', options: [['einmalig', 'Einmalig'], ['bis', 'Bis Datum'], ['widerruf', 'Bis auf Widerruf']], def: 'einmalig' },
        { id: 'bis', label: 'Gültig bis', type: 'date', when: v => v.gueltig === 'bis', def: () => addDays(isoToday(), 30) },
      ] },
    ],
    build(v) {
      const zweck = { paket: 'eine an mich adressierte Sendung abzuholen und den Empfang zu quittieren', dokumente: 'Dokumente in meinem Namen abzuholen und entgegenzunehmen', behoerde: 'mich bei der folgenden Angelegenheit gegenüber der Behörde zu vertreten, Anträge zu stellen und Unterlagen entgegenzunehmen', kfz: 'die An-, Um- oder Abmeldung des folgenden Fahrzeugs in meinem Namen vorzunehmen', frei: '' }[v.zweck] || '';
      const g = v.gueltig === 'bis' ? `Die Vollmacht gilt bis zum ${deDate(v.bis)}.` : v.gueltig === 'widerruf' ? 'Die Vollmacht gilt bis auf schriftlichen Widerruf.' : 'Die Vollmacht gilt einmalig für den genannten Zweck.';
      const me = [e(v.s_name) || '…', v.s_geb ? `geboren am ${e(v.s_geb)}` : '', [e(v.s_strasse), e(v.s_ort)].filter(Boolean).join(', ')].filter(Boolean).join(', ');
      const you = [e(v.b_name) || '…', v.b_geb ? `geboren am ${deDate(v.b_geb)}` : '', v.b_ort ? `wohnhaft in ${e(v.b_ort)}` : ''].filter(Boolean).join(', ');
      const body = [`Hiermit bevollmächtige ich, ${me},`, `<strong>${you}</strong>,`, zweck ? `${zweck}${v.details ? ':' : '.'}` : ''];
      if ((v.details || '').trim()) body.push(e(v.details).replace(/\n/g, '<br>'));
      body.push(g, 'Die bevollmächtigte Person weist sich mit einem gültigen Ausweisdokument aus.');
      return { standalone: true, heading: 'Vollmacht', body: body.filter(Boolean), signLabel: 'Unterschrift Vollmachtgeber/in' };
    },
  },
  mietschuldenfreiheit: {
    id: 'mietschuldenfreiheit', title: 'Mietschuldenfreiheitsbescheinigung anfordern', fileTitle: 'Anfrage Mietschuldenfreiheitsbescheinigung', icon: 'home',
    sections: [
      { title: 'Mietverhältnis', fields: [
        { id: 'objekt', label: 'Anschrift der Wohnung', def: p => [streetLine(p), cityLine(p)].filter(Boolean).join(', ') },
        { id: 'seit', label: 'Mieter seit', type: 'date', half: true }, { id: 'mieternr', label: 'Mieternummer (optional)', half: true },
        { id: 'bis', label: 'Bitte zusenden bis', type: 'date', def: () => addDays(isoToday(), 14) },
        { id: 'vordruck', label: 'Vordruck zum Ausfüllen beilegen', type: 'check', def: true },
      ] },
      { title: 'An wen geht der Brief?', fields: [...RECIPIENT('Vermieter / Hausverwaltung', 'z. B. Hausverwaltung Beispiel'), ...PERSON_SAL] },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const refs = [['Mieternummer', v.mieternr]].filter(r => r[1]);
      const body = [`für meine Wohnungssuche benötige ich eine Bestätigung, dass ich meine Verpflichtungen aus dem Mietverhältnis über die Wohnung ${e(v.objekt) || '…'}${v.seit ? ` (Mieter seit ${deDate(v.seit)})` : ''} vollständig erfüllt habe und keine Mietrückstände bestehen.`,
        `Ich wäre Ihnen sehr dankbar, wenn Sie mir diese Mietschuldenfreiheitsbescheinigung bis zum ${deDate(v.bis) || '…'} zukommen lassen.${v.vordruck ? ' Zur Vereinfachung habe ich einen Vordruck beigefügt.' : ''}`,
        'Vielen Dank für Ihre Unterstützung.'];
      return { subject: 'Bitte um eine Mietschuldenfreiheitsbescheinigung', refs, body, salutation: salutation(v), attachments: v.vordruck ? 'Anlage: Vordruck Mietschuldenfreiheitsbescheinigung' : '',
        appendix: v.vordruck ? `<hr data-page-break><h2>Mietschuldenfreiheitsbescheinigung</h2><p>Hiermit bestätige ich/bestätigen wir als Vermieter/in bzw. Hausverwaltung, dass</p><p><strong>${e(v.s_name) || '…'}</strong></p><p>die Wohnung ${e(v.objekt) || '…'} seit ${deDate(v.seit) || '……………'} gemietet hat und bis heute alle Mietzahlungen einschließlich Nebenkosten vollständig und pünktlich geleistet hat. Es bestehen keine Mietrückstände.</p><p><br></p><p>Name und Anschrift Vermieter/in: ……………………………………………………………</p><p><br></p><p>……………………………………………………………<br>Ort, Datum, Unterschrift Vermieter/in</p>` : '' };
    },
  },
  bewerbung: {
    id: 'bewerbung', title: 'Bewerbung (Anschreiben)', fileTitle: 'Bewerbung', icon: 'person',
    note: 'Der Generator liefert einen soliden Entwurf. Passe ihn im Editor an – konkrete Beispiele aus deiner Erfahrung überzeugen am meisten.',
    sections: [
      { title: 'Stelle', fields: [
        { id: 'stelle', label: 'Stelle', placeholder: 'z. B. Kaufmännische Sachbearbeitung', required: true },
        { id: 'quelle', label: 'Gefunden über (optional)', placeholder: 'z. B. Ihre Stellenanzeige auf Ihrer Webseite', half: true }, { id: 'ref', label: 'Kennziffer (optional)', half: true },
        { id: 'aktuell', label: 'Deine aktuelle Tätigkeit', placeholder: 'z. B. Sachbearbeiterin bei der Muster AG' },
        { id: 'jahre', label: 'Berufserfahrung (Jahre)', type: 'number', half: true }, { id: 'eintritt', label: 'Frühester Eintritt', placeholder: 'z. B. 1. Februar 2027', half: true },
        { id: 'staerken', label: 'Deine Stärken (durch Komma getrennt)', placeholder: 'z. B. Organisationstalent, Kundenorientierung, Zahlenverständnis' },
        { id: 'motivation', label: 'Warum dieses Unternehmen? (optional)', type: 'textarea', placeholder: 'z. B. Ihr Fokus auf nachhaltige Produkte …' },
        { id: 'gehalt', label: 'Gehaltsvorstellung (optional)', placeholder: 'z. B. 48.000 € brutto jährlich' },
      ] },
      { title: 'Unternehmen', fields: [...RECIPIENT('Unternehmen', 'z. B. Beispiel GmbH'), ...PERSON_SAL] },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const st = String(v.staerken || '').split(',').map(s => s.trim()).filter(Boolean);
      const body = [`${v.quelle ? `über ${e(v.quelle)} bin ich` : 'mit großem Interesse bin ich'} auf Ihre Stelle als ${e(v.stelle) || '…'} aufmerksam geworden. Die Aufgaben passen sehr gut zu meinen Erfahrungen und zu dem, was ich beruflich erreichen möchte – deshalb bewerbe ich mich bei Ihnen.`];
      if (v.aktuell || v.jahre) body.push(`${v.aktuell ? `Derzeit arbeite ich als ${e(v.aktuell)}` : 'Ich bringe Berufserfahrung mit'}${v.jahre ? `${v.aktuell ? ' und habe' : ' –'} ${e(v.jahre)} Jahre Berufserfahrung gesammelt` : ''}. Dabei habe ich gelernt, Verantwortung zu übernehmen, Aufgaben strukturiert anzugehen und auch unter Zeitdruck verlässliche Ergebnisse zu liefern.`);
      if (st.length) body.push(`Besonders auszeichnen kann ich mich durch ${st.length > 1 ? `${st.slice(0, -1).map(e).join(', ')} und ${e(st[st.length - 1])}` : e(st[0])}. Diese Stärken möchte ich gerne in Ihr Team einbringen.`);
      if ((v.motivation || '').trim()) body.push(`An Ihrem Unternehmen reizt mich besonders: ${e(v.motivation).replace(/\n/g, ' ')}`);
      const last = [];
      if (v.eintritt) last.push(`Ich kann ab ${e(v.eintritt)} bei Ihnen beginnen.`);
      if (v.gehalt) last.push(`Meine Gehaltsvorstellung liegt bei ${e(v.gehalt)}.`);
      last.push('Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr.');
      body.push(last.join(' '));
      return { subject: `Bewerbung als ${e(v.stelle) || '…'}${v.ref ? ` – Kennziffer ${e(v.ref)}` : ''}`, refs: [], body, salutation: salutation(v), attachments: 'Anlagen: Lebenslauf, Zeugnisse' };
    },
  },
  // Antwort auf eine Mahnung / Zahlungsaufforderung (wird vom Briefkasten-Assistenten vorausgefüllt)
  'mahnung-antwort': {
    id: 'mahnung-antwort', title: 'Antwort auf Mahnung oder Zahlungsaufforderung', fileTitle: 'Antwort auf Zahlungsaufforderung', icon: 'euro',
    note: 'Antworte sachlich und nachweisbar. Berechtigte Forderungen solltest du rechtzeitig begleichen – so vermeidest du weitere Kosten. Unberechtigten Forderungen (z. B. von Inkassobüros) kannst du schriftlich widersprechen.',
    sections: [
      { title: 'Forderung', fields: [
        { id: 'grund', label: 'Deine Antwort', type: 'select', options: [['bezahlt', 'Ich habe bereits bezahlt'], ['raten', 'Ich bitte um Ratenzahlung'], ['stundung', 'Ich bitte um Zahlungsaufschub'], ['bestritten', 'Ich bestreite die Forderung'], ['nicht_erhalten', 'Ich habe keine Rechnung erhalten']], def: 'bezahlt' },
        { id: 'zeichen', label: 'Rechnungs-, Kundennummer oder Aktenzeichen', half: true }, { id: 'datum_schreiben', label: 'Ihr Schreiben vom', type: 'date', half: true },
        { id: 'betrag', label: 'Geforderter Betrag (€)', type: 'money', half: true },
        { id: 'bezahlt_am', label: 'Bezahlt am', type: 'date', half: true, when: v => v.grund === 'bezahlt' },
        { id: 'rate', label: 'Monatliche Rate (€)', type: 'money', half: true, when: v => v.grund === 'raten' },
        { id: 'bis', label: 'Zahlung möglich bis', type: 'date', half: true, when: v => v.grund === 'stundung' },
        { id: 'begruendung', label: 'Begründung (optional)', type: 'textarea', when: v => v.grund === 'bestritten' || v.grund === 'stundung' },
      ] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT('Absender der Forderung', 'z. B. Muster Versand GmbH') },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const ref = [v.zeichen ? `(${e(v.zeichen)})` : '', v.datum_schreiben ? `vom ${deDate(v.datum_schreiben)}` : ''].filter(Boolean).join(' ');
      const amt = num(v.betrag) ? ` über ${money(num(v.betrag))}` : '';
      const body = [];
      if (v.grund === 'bezahlt') body.push(`bezüglich Ihres Schreibens ${ref}${amt} teile ich Ihnen mit, dass ich den Betrag bereits${v.bezahlt_am ? ` am ${deDate(v.bezahlt_am)}` : ''} bezahlt habe. Bitte prüfen Sie den Zahlungseingang und betrachten Sie die Angelegenheit als erledigt. Einen Zahlungsnachweis füge ich auf Wunsch bei.`);
      if (v.grund === 'raten') body.push(`bezüglich Ihres Schreibens ${ref}${amt}: Ich erkenne die Forderung an, kann sie derzeit aber nicht in einer Summe begleichen. Ich bitte Sie daher um Ratenzahlung in Höhe von ${num(v.rate) ? money(num(v.rate)) : '… €'} monatlich, beginnend mit dem nächsten Monatsersten.`);
      if (v.grund === 'stundung') body.push(`bezüglich Ihres Schreibens ${ref}${amt} bitte ich Sie um einen Zahlungsaufschub${v.bis ? ` bis zum ${deDate(v.bis)}` : ''}.`);
      if (v.grund === 'bestritten') body.push(`Ihrer Forderung aus dem Schreiben ${ref}${amt} widerspreche ich hiermit. Ich bestreite die Forderung dem Grunde und der Höhe nach.`);
      if (v.grund === 'nicht_erhalten') body.push(`Ihr Schreiben ${ref}${amt} habe ich erhalten. Eine Rechnung zu dieser Forderung liegt mir jedoch nicht vor. Bitte senden Sie mir die Rechnung zu, damit ich die Forderung prüfen kann.`);
      if ((v.begruendung || '').trim()) String(v.begruendung).split(/\n{2,}/).forEach(p => body.push(e(p).replace(/\n/g, '<br>')));
      if (v.grund === 'raten' || v.grund === 'stundung') body.push('Bitte bestätigen Sie mir Ihr Einverständnis schriftlich. Für Ihr Entgegenkommen bedanke ich mich.');
      else if (v.grund === 'bestritten') body.push('Bitte unterlassen Sie bis zur Klärung weitere Mahnungen und eine Weitergabe meiner Daten an Dritte. Für Rückfragen stehe ich Ihnen gern zur Verfügung.');
      else body.push('Für Rückfragen stehe ich Ihnen gern zur Verfügung.');
      const subj = { bezahlt: 'Ihre Zahlungsaufforderung – Betrag bereits bezahlt', raten: 'Bitte um Ratenzahlung', stundung: 'Bitte um Zahlungsaufschub', bestritten: 'Widerspruch gegen Ihre Forderung', nicht_erhalten: 'Ihre Zahlungsaufforderung – Rechnung nicht erhalten' }[v.grund] || 'Ihre Zahlungsaufforderung';
      return { subject: `${subj}${v.zeichen ? ` – ${e(v.zeichen)}` : ''}`, refs: [['Ihr Zeichen', v.zeichen], ['Ihr Schreiben vom', deDate(v.datum_schreiben)]].filter(r => r[1]), body };
    },
  },
  // Antworten auf Behördenpost (Briefkasten-Assistent → „Antwort schreiben“)
  fristverlaengerung: {
    id: 'fristverlaengerung', title: 'Bitte um mehr Zeit (Fristverlängerung)', fileTitle: 'Antrag auf Fristverlängerung', icon: 'timer',
    note: 'Für Fristen, die dir eine Behörde oder Firma gesetzt hat (z. B. Unterlagen einreichen). Gesetzliche Fristen wie die Widerspruchs- oder Einspruchsfrist lassen sich nicht verlängern – dort lieber rechtzeitig Widerspruch einlegen und die Begründung nachreichen.',
    sections: [
      { title: 'Worum geht es?', fields: [
        { id: 'az', label: 'Aktenzeichen / Kundennummer', half: true }, { id: 'datum_schreiben', label: 'Ihr Schreiben vom', type: 'date', half: true },
        { id: 'sache', label: 'Was soll bis wann erledigt sein?', placeholder: 'z. B. Kontoauszüge einreichen', required: true },
        { id: 'frist_alt', label: 'Bisherige Frist', type: 'date', half: true }, { id: 'frist_neu', label: 'Gewünschte neue Frist', type: 'date', half: true, def: () => addDays(isoToday(), 21) },
        { id: 'grund', label: 'Grund', type: 'select', options: [['unterlagen', 'Ich warte noch auf Unterlagen'], ['krank', 'Ich bin krank'], ['urlaub', 'Ich bin verreist / im Urlaub'], ['beratung', 'Ich lasse mich noch beraten'], ['zeit', 'Ich brauche mehr Zeit'], ['anderer', 'Anderer Grund']], def: 'unterlagen' },
        { id: 'grund_text', label: 'Kurz erklären (optional)', type: 'textarea', placeholder: 'z. B. Die Bank schickt mir die Auszüge erst in zwei Wochen.' },
      ] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT('Behörde / Firma', 'z. B. Jobcenter Musterstadt') },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const ref = [v.az ? `(Aktenzeichen ${e(v.az)})` : '', v.datum_schreiben ? `vom ${deDate(v.datum_schreiben)}` : ''].filter(Boolean).join(' ');
      const why = { unterlagen: 'Mir liegen noch nicht alle nötigen Unterlagen vor; ich habe sie bereits angefordert.', krank: 'Ich bin derzeit erkrankt und kann mich deshalb nicht rechtzeitig darum kümmern.', urlaub: 'Ich bin in diesem Zeitraum verreist und kann die Frist deshalb nicht einhalten.', beratung: 'Ich lasse mich zu der Angelegenheit noch beraten und benötige dafür etwas mehr Zeit.', zeit: 'Ich benötige für die Bearbeitung etwas mehr Zeit.', anderer: '' }[v.grund] || '';
      const body = [`in Ihrem Schreiben${ref ? ' ' + ref : ''} haben Sie mir eine Frist${v.frist_alt ? ` bis zum ${deDate(v.frist_alt)}` : ''} gesetzt. Es geht um: ${e(v.sache) || '…'}.`];
      body.push(`Ich bitte Sie, die Frist${v.frist_neu ? ` bis zum ${deDate(v.frist_neu)}` : ' angemessen'} zu verlängern.${why ? ' ' + why : ''}`);
      if ((v.grund_text || '').trim()) String(v.grund_text).split(/\n{2,}/).forEach(p => body.push(e(p).replace(/\n/g, '<br>')));
      body.push('Bitte bestätigen Sie mir die Fristverlängerung kurz. Vielen Dank für Ihr Verständnis.');
      return { subject: `Antrag auf Fristverlängerung${v.az ? ` – ${e(v.az)}` : ''}`, refs: [['Aktenzeichen', v.az], ['Ihr Schreiben vom', deDate(v.datum_schreiben)]].filter(r => r[1]), body };
    },
    reminder: v => (v.frist_neu ? { title: `Frist (verlängert): ${String(v.sache || 'Erledigen').slice(0, 60)}`, type: 'termin', due: v.frist_neu, leads: [7, 1] } : null),
  },
  unterlagen: {
    id: 'unterlagen', title: 'Unterlagen nachreichen', fileTitle: 'Unterlagen nachgereicht', icon: 'folderMove',
    note: 'Schicke Kopien, keine Originale – außer sie werden ausdrücklich verlangt. Schreib auf jede Seite deinen Namen und das Aktenzeichen.',
    sections: [
      { title: 'Was schickst du mit?', fields: [
        { id: 'az', label: 'Aktenzeichen / Kundennummer', half: true }, { id: 'datum_schreiben', label: 'Ihr Schreiben vom', type: 'date', half: true },
        { id: 'liste', label: 'Anlagen (eine pro Zeile)', type: 'textarea', placeholder: 'Kontoauszüge Januar bis März\nMietvertrag\nLohnabrechnung März', required: true },
        { id: 'fehlt', label: 'Fehlt noch etwas? (optional)', type: 'textarea', placeholder: 'z. B. Die Nebenkostenabrechnung reiche ich nach, sobald ich sie habe.' },
      ] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT('Behörde / Firma', 'z. B. Familienkasse') },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const items = String(v.liste || '').split(/\n+/).map(x => x.replace(/^\s*[-–•·*\d.)]+\s*/, '').trim()).filter(Boolean);
      const ref = [v.az ? `(Aktenzeichen ${e(v.az)})` : '', v.datum_schreiben ? `vom ${deDate(v.datum_schreiben)}` : ''].filter(Boolean).join(' ');
      const body = [`wie in Ihrem Schreiben${ref ? ' ' + ref : ''} erbeten, sende ich Ihnen ${items.length === 1 ? 'die folgende Unterlage' : 'die folgenden Unterlagen'}:`];
      body.push(items.length ? items.map(x => `– ${e(x)}`).join('<br>') : '– …');
      if ((v.fehlt || '').trim()) String(v.fehlt).split(/\n{2,}/).forEach(p => body.push(e(p).replace(/\n/g, '<br>')));
      body.push('Sollte noch etwas fehlen, geben Sie mir bitte kurz Bescheid. Bitte bestätigen Sie mir den Eingang.');
      return { subject: `Nachreichen von Unterlagen${v.az ? ` – ${e(v.az)}` : ''}`, refs: [['Aktenzeichen', v.az], ['Ihr Schreiben vom', deDate(v.datum_schreiben)]].filter(r => r[1]), body, attachments: items.length ? `Anlagen: ${items.length}` : '' };
    },
  },
  rueckfrage: {
    id: 'rueckfrage', title: 'Rückfrage: Bitte um Erklärung', fileTitle: 'Rückfrage', icon: 'comment',
    note: 'Eine Rückfrage hält keine Frist an. Läuft eine Widerspruchsfrist, lege vorsorglich Widerspruch ein.',
    sections: [
      { title: 'Was ist unklar?', fields: [
        { id: 'az', label: 'Aktenzeichen / Kundennummer', half: true }, { id: 'datum_schreiben', label: 'Ihr Schreiben vom', type: 'date', half: true },
        { id: 'thema', label: 'Worum geht es in dem Schreiben?', placeholder: 'z. B. Nachzahlung Nebenkosten 2025', required: true },
        { id: 'frage', label: 'Was möchtest du wissen?', type: 'select', options: [['berechnung', 'Wie wurde der Betrag berechnet?'], ['grund', 'Warum bekomme ich das Schreiben?'], ['tun', 'Was genau muss ich tun?'], ['belege', 'Bitte um Kopien / Belege'], ['eigene', 'Eigene Frage']], def: 'berechnung' },
        { id: 'frage_text', label: 'Deine Frage (optional)', type: 'textarea', placeholder: 'z. B. Welche Kosten sind in der Position „Sonstiges“ enthalten?' },
        { id: 'rueckruf', label: 'Um Rückruf bitten', type: 'check', def: false },
      ] },
      { title: 'An wen geht der Brief?', fields: RECIPIENT('Absender des Schreibens', 'z. B. Hausverwaltung Muster GmbH') },
      { title: 'Absender', collapsed: true, fields: [...SENDER, PLACE, DATE] },
    ],
    build(v) {
      const ref = [v.az ? `(Aktenzeichen ${e(v.az)})` : '', v.datum_schreiben ? `vom ${deDate(v.datum_schreiben)}` : ''].filter(Boolean).join(' ');
      const q = { berechnung: 'Bitte erläutern Sie mir, wie sich der genannte Betrag zusammensetzt, und senden Sie mir eine nachvollziehbare Aufstellung.', grund: 'Mir ist nicht klar, aus welchem Grund ich dieses Schreiben erhalten habe. Bitte erläutern Sie mir den Hintergrund.', tun: 'Bitte teilen Sie mir genau mit, was ich bis wann tun muss und welche Unterlagen Sie von mir benötigen.', belege: 'Bitte senden Sie mir Kopien der zugrunde liegenden Belege bzw. Unterlagen zu.', eigene: '' }[v.frage] || '';
      const body = [`zu Ihrem Schreiben${ref ? ' ' + ref : ''} zum Thema „${e(v.thema) || '…'}“ habe ich eine Frage.`];
      if (q) body.push(q);
      if ((v.frage_text || '').trim()) String(v.frage_text).split(/\n{2,}/).forEach(p => body.push(e(p).replace(/\n/g, '<br>')));
      body.push(v.rueckruf && v.s_tel ? `Gern können Sie mich auch telefonisch unter ${e(v.s_tel)} erreichen.` : v.rueckruf ? 'Gern können Sie mich auch telefonisch erreichen.' : 'Vielen Dank für Ihre Hilfe.');
      return { subject: `Rückfrage zu Ihrem Schreiben${v.az ? ` – ${e(v.az)}` : ''}`, refs: [['Aktenzeichen', v.az], ['Ihr Schreiben vom', deDate(v.datum_schreiben)]].filter(r => r[1]), body };
    },
  },
};

// Prefill handed over by the Briefkasten-Assistent (js/smart/inbox.js): consumed once by the next generator of that id.
let pendingPrefill = null;
export function setLetterPrefill(id, values) { pendingPrefill = { id, values: { ...(values || {}) }, at: Date.now() }; }

export const LETTER_GROUPS = [
  { title: 'Verträge & Behörden', ids: ['widerruf', 'widerspruch', 'vollmacht', 'mietschuldenfreiheit'] },
  { title: 'Auf Post antworten', ids: ['fristverlaengerung', 'unterlagen', 'rueckfrage', 'mahnung-antwort'] },
  { title: 'Geld & Selbstständigkeit', ids: ['rechnung', 'angebot', 'mahnung'] },
  { title: 'Beruf', ids: ['bewerbung'] },
];
const DESCS = {
  widerruf: 'Online-Kauf oder Vertrag innerhalb der Frist zurückgeben', widerspruch: 'Gegen einen Bescheid vorgehen – auch als Einspruch', vollmacht: 'Paket, Dokumente oder Behördengang erledigen lassen',
  mietschuldenfreiheit: 'Für die nächste Wohnungsbewerbung', rechnung: 'Automatische Summen, USt. oder § 19 UStG', angebot: 'Positionen, Gültigkeit, Summen', mahnung: 'Freundlich erinnern bis zur letzten Mahnung', 'mahnung-antwort': 'Bezahlt, Raten, Aufschub oder Widerspruch', bewerbung: 'Anschreiben aus deinen Stichpunkten',
  fristverlaengerung: 'Mehr Zeit für eine Frist erbitten', unterlagen: 'Begleitbrief mit Liste deiner Anlagen', rueckfrage: 'Nachfragen, wenn ein Schreiben unklar ist',
};

export function letterDef(id, art) {
  if (id === 'kuendigung') return kuendigungDef(art);
  return OTHER[id] || null;
}

/** „So verschickst du den Brief“ – vorsichtige Hinweise je Brief-Art (keine Rechtsberatung). → {steps: string[], strict: bool} | null */
export function sendGuide(def, v) {
  let b = {};
  try { b = def.build(v) || {}; } catch { /* preview only */ }
  const id = def.id;
  if (id === 'widerspruch' && v.typ === 'einspruch') return { strict: false, steps: [
    'Am einfachsten über dein ELSTER-Konto (Formular „Einspruch“) – dann brauchst du kein Papier.',
    'Oder: ausdrucken, mit der Hand unterschreiben und per Post oder Fax ans Finanzamt schicken.',
    'Eine einfache E-Mail ist beim Finanzamt nicht sicher – nimm lieber ELSTER, Post oder Fax.',
  ] };
  if (id === 'widerspruch') return { strict: true, steps: [
    'Ausdrucken und mit der Hand unterschreiben.',
    'Per Post schicken (am besten als Einschreiben) oder per Fax – oder selbst bei der Behörde abgeben und dir den Eingang auf einer Kopie bestätigen lassen.',
    'Eine einfache E-Mail reicht nicht – auch nicht mit eingescannter Unterschrift.',
    'Der Brief muss vor Ablauf der Frist bei der Behörde ankommen.',
  ] };
  if (id === 'kuendigung' && b.signedPaper) return { strict: true, steps: [
    (b.cosign || []).length ? 'Ausdrucken und mit der Hand unterschreiben – auch alle anderen Mieter.' : 'Ausdrucken und mit der Hand unterschreiben.',
    'Das Original per Einschreiben schicken oder persönlich übergeben und dir den Empfang bestätigen lassen.',
    'E-Mail, Fax oder ein Foto des Briefs reichen nicht.',
  ] };
  if (id === 'kuendigung') return { strict: false, steps: [
    'Per Einschreiben schicken – dann kannst du den Zugang beweisen.',
    'Oder den Kündigungsbutton auf der Webseite des Anbieters nutzen, wenn es einen gibt.',
    'Viele Anbieter nehmen Kündigungen auch per E-Mail an – heb die Bestätigung gut auf.',
  ] };
  if (id === 'widerruf') return { strict: false, steps: [
    'Eine besondere Form ist nicht nötig: E-Mail, Brief oder das Formular des Händlers reichen.',
    'Wichtig ist ein Nachweis: Speichere die gesendete E-Mail oder schick den Brief als Einschreiben.',
    'Es reicht, wenn du den Widerruf innerhalb der Frist abschickst.',
  ] };
  if (id === 'mahnung-antwort') return { strict: false, steps: [
    'Per E-Mail oder Brief an den Absender der Forderung schicken und eine Kopie aufheben.',
    v.grund === 'bestritten' ? 'Weil du die Forderung bestreitest: am besten nachweisbar per Einschreiben.' : 'Bei Bedarf einen Zahlungsnachweis (z. B. Kontoauszug) beilegen.',
  ] };
  if (id === 'fristverlaengerung') return { strict: false, steps: [
    'So früh wie möglich schicken – vor Ablauf der alten Frist.',
    'Per Post, Fax, E-Mail oder über das Online-Postfach der Behörde.',
    'Die neue Frist gilt erst, wenn sie bestätigt wird – ruf im Zweifel kurz an.',
  ] };
  if (id === 'unterlagen') return { strict: false, steps: [
    'Kopien schicken, keine Originale – außer sie werden ausdrücklich verlangt.',
    'Auf jede Seite Name und Aktenzeichen schreiben.',
    'Per Post, Online-Postfach oder persönlich abgeben – und eine Kopie von allem aufheben.',
  ] };
  if (id === 'rueckfrage') return { strict: false, steps: [
    'Per E-Mail, Post oder Kontaktformular schicken.',
    'Achtung: Fristen laufen trotz deiner Frage weiter.',
  ] };
  if (def.standalone) return { strict: true, steps: ['Ausdrucken und mit der Hand unterschreiben.'] };
  return null;
}

/** Saved signature → <img> data for the letter (only where a printed, handwritten signature isn't required). */
export async function savedSignature() {
  try {
    const { listAssets } = await import('../tools/sigstore.js');
    const sig = (await listAssets('signature'))[0];
    if (!sig) return null;
    const src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(sig.blob); });
    let w = sig.w || 0, hh = sig.h || 0;
    if (!w || !hh) {
      const bmp = await createImageBitmap(sig.blob).catch(() => null);
      if (bmp) { w = bmp.width; hh = bmp.height; bmp.close && bmp.close(); }
    }
    if (!w || !hh) { w = 300; hh = 100; }
    const k = Math.min(160 / w, 48 / hh);
    return { src, w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(hh * k)) };
  } catch (err) { console.warn(err); return null; }
}

// ---------------- HTML (DIN 5008-orientiert) ----------------
/** Build the letter HTML (works with docmodel → .docx / PDF). */
export function letterHtml(def, v) {
  const b = def.build(v);
  const sender = [v.s_firma, v.s_name, v.s_strasse, v.s_ort].filter(x => x && String(x).trim());
  const contact = [v.s_tel ? `Tel. ${v.s_tel}` : '', v.s_mail].filter(Boolean);
  const dateLine = `${v.ort_brief ? `${e(v.ort_brief)}, ` : ''}${deDate(v.datum || isoToday())}`;
  let out = '';
  if (b.standalone) {
    out += `<h1 style="text-align:center">${e(b.heading)}</h1><p><br></p>`;
    b.body.forEach(p => { out += `<p>${p}</p>`; });
    out += `<p><br></p><p><br></p><table class="borderless"><colgroup><col style="width:50%"><col style="width:50%"></colgroup><tbody><tr><td><p>${dateLine}</p><p>……………………………………</p><p><span style="font-size:9pt;color:#5A607F">Ort, Datum</span></p></td><td><p><br></p><p>……………………………………</p><p><span style="font-size:9pt;color:#5A607F">${e(b.signLabel)} (${e(v.s_name)})</span></p></td></tr></tbody></table>`;
    return out;
  }
  // letterhead (sender, right) + return line + address field / info block
  out += `<p style="text-align:right"><span style="font-size:9.5pt">${lines([...sender, ...contact])}</span></p>`;
  if (b.headerTitle) out += `<h1><span style="color:#3B37A0">${e(b.headerTitle)}</span></h1>`;
  else out += '<p><br></p>';
  const ret = [v.s_name || v.s_firma, v.s_strasse, v.s_ort].filter(Boolean).map(e).join(' · ');
  const rcpt = lines([v.r_name, v.r_zusatz, v.r_strasse, v.r_ort]);
  const info = [...(b.refs || []).map(r => `${e(r[0])}: ${e(r[1])}`), `Datum: ${deDate(v.datum || isoToday())}`];
  out += `<table class="borderless"><colgroup><col style="width:60%"><col style="width:40%"></colgroup><tbody><tr><td><p><span style="font-size:7.5pt;color:#5A607F"><u>${ret}</u></span></p><p>${rcpt || '<br>'}</p></td><td><p><span style="font-size:9pt">${info.join('<br>')}</span></p></td></tr></tbody></table>`;
  out += `<p><br></p><p><strong>${b.subject}</strong></p><p><br></p>`;
  out += `<p>${b.salutation || salutation(v)}</p>`;
  b.body.forEach(p => { out += `<p>${p}</p>`; });
  if (b.table) out += b.table;
  (b.after || []).forEach(p => { out += `<p>${p}</p>`; });
  out += '<p>Mit freundlichen Grüßen</p>';
  const sig = !b.signedPaper && v.__sig && v.__sigData ? v.__sigData : null;
  out += b.signedPaper ? '<p><br></p><p><br></p><p>……………………………………</p>' : sig && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(sig.src) ? `<p><img src="${sig.src}" width="${sig.w}" height="${sig.h}" alt="Unterschrift"></p>` : '<p><br></p>';
  out += `<p>${e(v.s_name) || '<br>'}</p>`;
  (b.cosign || []).forEach(n => { out += `<p><br></p><p>……………………………………</p><p>${e(n)}</p>`; });
  if (b.attachments) out += `<p><br></p><p><span style="font-size:9.5pt;color:#5A607F">${e(b.attachments)}</span></p>`;
  if (b.footer) out += `<p><br></p><hr><p style="text-align:center"><span style="font-size:8pt;color:#5A607F">${b.footer}</span></p>`;
  if (b.appendix) out += b.appendix;
  return out;
}

// ---------------- screens ----------------
export async function mount(screen, { parts, params }) {
  const id = parts[1];
  if (!id) return hub(screen);
  const def = letterDef(id, params.get('art') || 'handy');
  if (!def) { location.replace('#/schreiben'); return; }
  return generator(screen, def);
}

function hub(screen) {
  const kcards = Object.entries(K_VARIANTS).map(([k, v]) => `<a class="lt-chip" href="#/schreiben/kuendigung?art=${k}" data-art="${k}">${oicon(v.icon)}<span>${esc(v.label)}</span></a>`).join('');
  const groups = LETTER_GROUPS.map(g => `<h2 class="section-title">${esc(g.title)}</h2><div class="tool-grid">${g.ids.map(id => {
    const d = OTHER[id];
    return `<a class="tool-card" href="#/schreiben/${id}" data-letter="${id}"><span class="tile-ic">${oicon(d.icon)}</span><span class="tc-text"><h3>${esc(d.title)}</h3><p>${esc(DESCS[id] || '')}</p></span></a>`;
  }).join('')}</div>`).join('');
  import('../post/api.js').then(m => m.warmPost()).catch(() => {}); // is „Briefe per Post“ set up? (for the card next time)
  screen.body.innerHTML = `<div class="screen-inner lt-hub">
    <div class="card lt-hero"><span class="lt-hero-ic">${oicon('letter')}</span><div><strong>Briefe, die sonst nerven – in einer Minute fertig</strong>
      <p>Wenige Fragen beantworten, Vorschau prüfen, fertig: als bearbeitbares Dokument und als PDF. Deine Absenderdaten kommen automatisch aus deinem <a href="${profileRoute}">Profil</a>.</p></div></div>
    <h2 class="section-title">Kündigen</h2>
    <div class="lt-chips" role="list">${kcards}</div>
    ${groups}
    <a class="card lt-postlink" href="#/post"${postHidden() ? ' hidden' : ''}>${oicon('mail')}<span><strong>Briefe per Post</strong><span class="muted small">FaLe druckt, kuvertiert und verschickt – auch als Einschreiben. Hier siehst du, was unterwegs ist.</span></span>${oicon('chevronRight')}</a>
    <p class="lt-disclaimer">${oicon('info')}<span>${esc(DISCLAIMER)}</span></p>
    <p class="muted small">Weitere Vorlagen (Lebenslauf, Briefpapier, Haushaltsbuch …) findest du unter <a href="#/vorlagen">Vorlagen</a>.</p>
  </div>`;
  screen.setFoot([]);
}

async function generator(screen, def) {
  const profile = await getProfile();
  screen.setTitle(def.title, 'Ausfüllen, Vorschau prüfen, fertig');
  const v = {};
  const allFields = def.sections.flatMap(s => s.fields);
  for (const f of allFields) {
    const d = typeof f.def === 'function' ? f.def(profile) : f.def;
    v[f.id] = d === undefined ? (f.type === 'check' ? false : '') : d;
  }
  if (pendingPrefill && pendingPrefill.id === def.id && Date.now() - pendingPrefill.at < 60000) {
    for (const [k, val] of Object.entries(pendingPrefill.values)) if (k in v && val != null && val !== '') v[k] = val;
    pendingPrefill = null;
  }
  const root = h(`<div class="lt-gen">
    <form class="lt-form" novalidate autocomplete="on"></form>
    <aside class="lt-side" aria-label="Vorschau">
      <div class="lt-side-head"><strong>Vorschau</strong><span class="muted small">So sieht dein Brief aus</span></div>
      <div class="lt-preview"><div class="lt-paper doc-page" aria-live="off"></div></div>
    </aside>
  </div>`);
  const form = $('.lt-form', root), paper = $('.lt-paper', root), previewBox = $('.lt-preview', root);
  if (def.note) form.appendChild(h(`<div class="notice">${oicon('info')}<span>${esc(def.note)}</span></div>`));
  // invoices to companies: the e-invoice (ZUGFeRD / XRechnung) is made by the „Rechnung schreiben“ tool
  if (def.id === 'rechnung') form.appendChild(h(`<div class="card lt-einv"><span>${oicon('checkCircle')}</span><p><strong>Rechnung an eine Firma oder Behörde?</strong> Dann als E-Rechnung (ZUGFeRD oder XRechnung) – für die meisten Firmen ab 2027/2028 Pflicht. <a href="#/web/invoice-generator">E-Rechnung erstellen</a></p></div>`));
  if (!profile) form.appendChild(h(`<div class="card lt-profile-tip"><span>${oicon('person')}</span><p>Tipp: Mit einem <a href="${profileRoute}">Profil</a> füllt FaLe deinen Absender künftig automatisch aus.</p></div>`));

  const fieldEls = [];
  def.sections.forEach((sec, si) => {
    const fs = h(`<details class="card lt-sec" ${sec.collapsed && profile ? '' : 'open'}><summary><span>${esc(sec.title)}</span>${sec.collapsed && profile ? `<span class="lt-sum muted small"></span>` : ''}${oicon('chevronDown')}</summary><div class="lt-grid"></div></details>`);
    const grid = $('.lt-grid', fs);
    sec.fields.forEach(f => {
      const el = renderField(f, v);
      fieldEls.push({ f, el });
      grid.appendChild(el);
    });
    fs.dataset.sec = si;
    form.appendChild(fs);
  });
  // saved signature (from „Unterschreiben“) – only offered where no handwritten signature on paper is needed
  const sigData = def.standalone ? null : await savedSignature();
  let sigRow = null;
  if (sigData) {
    v.__sigData = sigData;
    v.__sig = false;
    sigRow = h(`<label class="card check lt-check lt-sigembed"><input type="checkbox" name="__sig"> <span>Meine gespeicherte Unterschrift einfügen</span><img src="${sigData.src}" alt="" width="${sigData.w}" height="${sigData.h}"></label>`);
    form.appendChild(sigRow);
  }
  form.appendChild(h(`<p class="lt-disclaimer">${oicon('info')}<span>${esc(DISCLAIMER)}</span></p>`));
  screen.body.classList.add('lt-body');
  screen.body.appendChild(root);

  const btnDoc = h(`<button class="btn btn-ghost" type="button" data-out="doc">${oicon('kdoc')}<span>Als Dokument bearbeiten</span></button>`);
  const btnPdf = h(`<button class="btn btn-primary" type="button" data-out="pdf">${oicon('kpdf')}<span>PDF erstellen</span></button>`);
  const btnPrev = h(`<button class="btn btn-soft only-mobile" type="button" data-prev>${oicon('eye')}<span>Vorschau</span></button>`);
  screen.setFoot([btnPrev, btnDoc, btnPdf]);

  const update = () => {
    fieldEls.forEach(({ f, el }) => { el.hidden = !!(f.when && !f.when(v)); if (f.hint && typeof f.hint === 'function') { const hn = $('.hint', el); if (hn) hn.textContent = f.hint(v); } });
    $$('.lt-sec', form).forEach(sec => { const sum = $('.lt-sum', sec); if (sum) sum.textContent = [v.s_name, v.s_ort].filter(Boolean).join(', '); });
    if (sigRow) { let paper = false; try { paper = !!def.build(v).signedPaper; } catch { /* ignore */ } sigRow.hidden = paper; }
    try { paper.innerHTML = letterHtml(def, v); } catch (err) { console.warn(err); }
    fitPreview();
  };
  const fitPreview = () => {
    const w = previewBox.clientWidth;
    if (!w) return;
    paper.style.zoom = String(Math.min(1, (w - 2) / 794));
  };
  const ro = new ResizeObserver(fitPreview);
  ro.observe(previewBox);
  const later = debounce(update, 120);
  form.addEventListener('input', ev => { readField(ev.target, v, fieldEls); later(); });
  form.addEventListener('change', ev => { readField(ev.target, v, fieldEls); update(); });
  form.addEventListener('submit', ev => ev.preventDefault());
  btnPrev.addEventListener('click', () => { root.classList.toggle('show-preview'); btnPrev.querySelector('span').textContent = root.classList.contains('show-preview') ? 'Formular' : 'Vorschau'; fitPreview(); });
  update();

  const validate = () => {
    const missing = allFields.filter(f => f.required && !(f.when && !f.when(v)) && !String(v[f.id] ?? '').trim());
    if (missing.length) {
      toast(`Bitte noch ausfüllen: ${missing.map(f => f.label.replace(/\s*\(.*\)$/, '')).join(', ')}`, 'error', { timeout: 5000 });
      const el = fieldEls.find(x => x.f === missing[0]);
      if (el) { const sec = el.el.closest('details'); if (sec) sec.open = true; const inp = $('input,textarea,select', el.el); if (inp) inp.focus(); }
      return false;
    }
    if (!String(v.s_name || '').trim() && !def.standalone) { toast('Bitte gib deinen Namen als Absender ein.', 'error'); const sec = form.querySelector('details:last-of-type'); if (sec) sec.open = true; return false; }
    return true;
  };
  const fileBase = () => `${def.fileTitle} ${isoToday()}`;
  async function produce(kind) {
    if (!validate()) return;
    const btn = kind === 'doc' ? btnDoc : btnPdf;
    btn.disabled = true;
    try {
      const html = letterHtml(def, v);
      const { htmlToModel } = await import('../office/docmodel.js');
      const model = htmlToModel(html, { baseSize: 11 });
      let meta;
      if (kind === 'doc') {
        const { modelToDocx } = await import('../office/docx-write.js');
        const { saveFile } = await import('../library.js');
        const blob = new Blob([await modelToDocx(model, { title: def.fileTitle, page: DIN_PAGE })], { type: KINDS.docx.mime });
        meta = await saveFile({ blob, name: fileBase(), kind: 'docx', source: 'Erstellt' });
      } else {
        const { modelToPdf } = await import('../office/docpdf.js');
        const { saveResult } = await import('../library.js');
        const bytes = await modelToPdf(model, { title: def.fileTitle, page: DIN_PAGE });
        meta = await saveResult(bytes, fileBase() + '.pdf');
        track('pdf_exported');
      }
      track('letters_created');
      def.onCreate && def.onCreate(v);
      await afterCreate(meta, kind);
    } catch (err) { errorToast(err, 'Der Brief konnte nicht erstellt werden.'); }
    finally { btn.disabled = false; }
  }
  async function afterCreate(meta, kind) {
    const rem = def.reminder ? def.reminder(v) : null;
    const guide = sendGuide(def, v);
    const guideHtml = guide ? `<div class="lt-send${guide.strict ? ' strict' : ''}"><strong>${oicon(guide.strict ? 'pen' : 'mail')}<span>So verschickst du den Brief</span></strong><ul>${guide.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    let canShare = false;
    try { canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.pdf', { type: 'application/pdf' })] })); } catch { /* no share */ }
    try { if (!canShare) canShare = (await import('../platform.js')).isNative(); } catch { /* web */ }
    const shareAct = canShare ? { label: 'Teilen', value: 'share' } : { label: 'Herunterladen', value: 'dl' };
    // „Per Post senden“ (js/post): not for letters that need a pen signature (Schriftform)
    // (only once the service is set up on the server)
    let post = null;
    if (kind === 'pdf' && !(guide && guide.strict) && !def.build(v).standalone) {
      try { post = await (await import('../post/api.js')).postAvailable(); } catch { post = null; }
    }
    const from = post && post.prices ? (await import('../post/api.js')).euro(post.prices.base) : '1,99 €';
    const postHtml = post
      ? `<div class="lt-post">${oicon('mail')}<div><strong>Kein Drucker? FaLe verschickt den Brief für dich</strong><span data-no-i18n>${esc(t('Gedruckt, kuvertiert, auf Wunsch als Einschreiben – ab {price}.', { price: from }))}</span></div><button class="btn btn-soft btn-sm" type="submit" value="post">Per Post senden</button></div>` : '';
    const r = await openDialog({
      title: kind === 'doc' ? 'Dokument erstellt' : 'PDF erstellt',
      body: `<div class="result-mini">${oicon('check')}<div><strong>${esc(meta.name)}</strong><p class="muted small">Gespeichert in deinen Dateien.${kind === 'doc' ? ' Du kannst den Text jetzt frei anpassen.' : ''}</p></div></div>
        ${guideHtml}
        ${postHtml}
        ${rem ? `<label class="check lt-remind"><input type="checkbox" name="remind" checked> Erinnerung eintragen: „${esc(rem.title)}“ am ${deDate(rem.due)}</label>` : ''}`,
      actions: kind === 'doc' ? [{ label: 'Schließen', value: 'close' }, { label: 'Im Editor öffnen', value: 'open', kind: 'btn-primary', default: true }]
        : guide && guide.strict ? [shareAct, { label: 'Öffnen', value: 'open' }, { label: 'Drucken', value: 'print', kind: 'btn-primary', default: true }]
        : [shareAct, { label: 'Drucken', value: 'print' }, { label: 'Öffnen', value: 'open', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ({ remind: !!(dlg.querySelector('[name=remind]') || {}).checked }) }),
    });
    if (rem && r.data && r.data.remind && r.value) {
      try { const { addReminder } = await import('./reminders.js'); await addReminder({ ...rem, docId: meta.id }); toast('Erinnerung eingetragen', 'success'); } catch (err) { console.warn(err); }
    }
    if (r.value === 'post') {
      const [plz, ...ort] = String(v.r_ort || '').trim().split(/\s+/);
      const hasPlz = /^\d{4,5}$/.test(plz || '');
      const db = await import('../db.js');
      const bytes = new Uint8Array(await (await db.getFile(meta.id)).arrayBuffer());
      const { sendByPost } = await import('../post/send.js');
      await sendByPost({ docId: meta.id, name: meta.name, bytes,
        to: { name: v.r_name || '', zusatz: v.r_zusatz || '', strasse: v.r_strasse || '', plz: hasPlz ? plz : '', ort: hasPlz ? ort.join(' ') : String(v.r_ort || ''), registered: /kuendigung|widerruf|widerspruch/.test(def.id || '') ? 'r1' : '' },
        from: { name: v.s_name || v.s_firma || '', strasse: v.s_strasse || '', plz: '', ort: v.s_ort || '' } });
      return;
    }
    if (r.value === 'open') location.hash = kind === 'doc' ? `#/bearbeiten/${meta.id}` : `#/ansicht/${meta.id}`;
    else if (r.value === 'print') location.hash = `#/ansicht/${meta.id}?drucken=1`;
    else if (r.value === 'dl' || r.value === 'share') {
      const db = await import('../db.js');
      const ui = await import('../ui.js');
      const blob = await db.getFile(meta.id);
      if (r.value === 'dl') ui.downloadBlob(blob, meta.name); else ui.shareBlob(blob, meta.name, 'application/pdf');
    }
  }
  btnDoc.addEventListener('click', () => produce('doc'));
  btnPdf.addEventListener('click', () => produce('pdf'));
  root._letterApi = { values: v, set: (k, val) => { v[k] = val; const x = fieldEls.find(y => y.f.id === k); if (x) syncField(x, v); update(); }, html: () => letterHtml(def, v) };
  return () => ro.disconnect();
}

function renderField(f, v) {
  const val = v[f.id];
  const req = f.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  let el;
  if (f.type === 'check') {
    el = h(`<label class="check lt-check" data-f="${f.id}"><input type="checkbox" name="${f.id}" ${val ? 'checked' : ''}> <span>${esc(f.label)}</span></label>`);
  } else if (f.type === 'seg') {
    el = h(`<div class="field lt-field" data-f="${f.id}"><span class="field-label">${esc(f.label)}</span><div class="seg lt-seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map(([k, l]) => `<button type="button" role="radio" data-v="${esc(k)}" aria-checked="${String(val === k)}" aria-pressed="${String(val === k)}">${esc(l)}</button>`).join('')}</div></div>`);
  } else if (f.type === 'select') {
    el = h(`<label class="field lt-field" data-f="${f.id}"><span class="field-label">${esc(f.label)}${req}</span><select class="select" name="${f.id}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${val === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`);
  } else if (f.type === 'textarea') {
    el = h(`<label class="field lt-field" data-f="${f.id}"><span class="field-label">${esc(f.label)}${req}</span><textarea class="input lt-ta" name="${f.id}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(val || '')}</textarea></label>`);
  } else if (f.type === 'items') {
    el = h(`<div class="field lt-field lt-items" data-f="${f.id}"><span class="field-label">${esc(f.label)}</span><div class="lt-rows"></div>
      <button class="btn btn-soft btn-sm" type="button" data-additem>${oicon('plus')} Position hinzufügen</button><p class="lt-total muted small" aria-live="polite"></p></div>`);
    const rows = $('.lt-rows', el);
    const paint = () => {
      rows.innerHTML = '';
      (v[f.id] || []).forEach((it, i) => {
        rows.appendChild(h(`<div class="lt-item" data-i="${i}">
          <input class="input it-text" name="it-text" placeholder="Beschreibung" value="${esc(it.text)}" aria-label="Beschreibung Position ${i + 1}">
          <input class="input it-qty" name="it-qty" inputmode="decimal" placeholder="Menge" value="${esc(it.qty)}" aria-label="Menge Position ${i + 1}">
          <input class="input it-unit" name="it-unit" placeholder="Einheit" value="${esc(it.unit)}" aria-label="Einheit Position ${i + 1}">
          <input class="input it-price" name="it-price" inputmode="decimal" placeholder="Preis €" value="${esc(it.price)}" aria-label="Einzelpreis Position ${i + 1}">
          <button class="icon-btn" type="button" data-delitem aria-label="Position ${i + 1} entfernen">${oicon('trash')}</button></div>`));
      });
      const s = sumItems(v);
      $('.lt-total', el).textContent = v.ust === 'klein' ? `Summe: ${money(s.net)}` : `Netto ${money(s.net)} · USt. ${money(s.tax)} · Gesamt ${money(s.gross)}`;
    };
    el._paint = paint;
    paint();
    el.addEventListener('click', ev => {
      if (ev.target.closest('[data-additem]')) { v[f.id] = [...(v[f.id] || []), { text: '', qty: '1', unit: 'Stk.', price: '' }]; paint(); el.dispatchEvent(new Event('change', { bubbles: true })); setTimeout(() => { const last = el.querySelector('.lt-item:last-child .it-text'); last && last.focus(); }, 20); }
      const del = ev.target.closest('[data-delitem]');
      if (del) { const i = +del.closest('.lt-item').dataset.i; v[f.id] = (v[f.id] || []).filter((_, k) => k !== i); if (!v[f.id].length) v[f.id] = [{ text: '', qty: '1', unit: 'Stk.', price: '' }]; paint(); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  } else {
    const type = f.type === 'money' || f.type === 'number' ? 'text' : f.type || 'text';
    const mode = f.type === 'money' ? 'decimal' : f.type === 'number' ? 'numeric' : '';
    el = h(`<label class="field lt-field${f.half ? ' half' : ''}" data-f="${f.id}"><span class="field-label">${esc(f.label)}${req}</span>
      <input class="input" name="${f.id}" type="${type}" ${mode ? `inputmode="${mode}"` : ''} ${f.auto ? `autocomplete="${f.auto}"` : ''} placeholder="${esc(f.placeholder || '')}" value="${esc(val || '')}"></label>`);
  }
  if (f.half) el.classList.add('half');
  if (f.hint) el.appendChild(h(`<p class="hint">${esc(typeof f.hint === 'function' ? f.hint(v) : f.hint)}</p>`));
  if (f.type === 'seg') {
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-v]');
      if (!b) return;
      v[f.id] = b.dataset.v;
      $$('[data-v]', el).forEach(x => { x.setAttribute('aria-checked', String(x === b)); x.setAttribute('aria-pressed', String(x === b)); });
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  return el;
}

function readField(t, v, fieldEls) {
  if (!t || !t.name) return;
  const item = t.closest('.lt-item');
  if (item) {
    const box = t.closest('.lt-items');
    const fid = box.dataset.f;
    const i = +item.dataset.i;
    const key = t.name.replace('it-', '');
    v[fid][i] = { ...v[fid][i], [key]: t.value };
    const fe = fieldEls.find(x => x.f.id === fid);
    if (fe) { const s = sumItems(v); $('.lt-total', fe.el).textContent = v.ust === 'klein' ? `Summe: ${money(s.net)}` : `Netto ${money(s.net)} · USt. ${money(s.tax)} · Gesamt ${money(s.gross)}`; }
    return;
  }
  v[t.name] = t.type === 'checkbox' ? t.checked : t.value;
  if (t.name === 'ust') { const fe = fieldEls.find(x => x.f.type === 'items'); if (fe && fe.el._paint) fe.el._paint(); }
}

function syncField(x, v) {
  const inp = $('input,select,textarea', x.el);
  if (!inp) return;
  if (inp.type === 'checkbox') inp.checked = !!v[x.f.id]; else inp.value = v[x.f.id] ?? '';
}
