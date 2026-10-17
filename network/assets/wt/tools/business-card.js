// Tool: business card → contact (vCard). Photos of one or many cards are read with text recognition; name,
// company, position, phone / mobile / fax, e-mail, web and address are recognised (lib/shared/ocr/bizcard-parse.js,
// shared with the app). Every contact can be corrected in a form, then saved as .vcf (one file per contact or all
// in one), as CSV for a spreadsheet or CRM – or scanned straight into the phone from a QR code, no file transfer.
// Checks: phone numbers in international form (+49 …), e-mail domain vs. website. No account, no card limit,
// nothing is uploaded.
import { el, clear } from '../lib/dom.js';
import { loadCanvas, release } from '../lib/img-core.js';
import { ensureCss, T, userError } from '../lib/new-ui.js';
import { LANG_OPTION, loadOcr, ocrBest } from './ocr-pdf.js';
import { parseCard, toVCard } from '../lib/shared/ocr/bizcard-parse.js';

ensureCss();

export const FIELDS = [
  ['name', { de: 'Name', en: 'Name' }, 'text', 'name'], ['firma', { de: 'Firma', en: 'Company' }, 'text', 'organization'],
  ['position', { de: 'Position', en: 'Position' }, 'text', 'organization-title'],
  ['telefon', { de: 'Telefon', en: 'Phone' }, 'tel', 'tel'], ['mobil', { de: 'Mobil', en: 'Mobile' }, 'tel', 'tel'], ['fax', { de: 'Fax', en: 'Fax' }, 'tel', 'off'],
  ['email', { de: 'E-Mail', en: 'E-mail' }, 'email', 'email'], ['web', { de: 'Web', en: 'Web' }, 'url', 'url'],
  ['strasse', { de: 'Straße', en: 'Street' }, 'text', 'street-address'], ['plz', { de: 'PLZ', en: 'Postcode' }, 'text', 'postal-code'],
  ['ort', { de: 'Ort', en: 'City' }, 'text', 'address-level2'], ['land', { de: 'Land', en: 'Country' }, 'text', 'country-name'],
];
const CSV_COLS = ['name', 'firma', 'position', 'telefon', 'mobil', 'fax', 'email', 'web', 'strasse', 'plz', 'ort', 'land', 'notiz'];

/** National number → international form: "0681 / 123 456" → "+49 681 123456" (country code from the option). */
export function intlPhone(s, cc = '49') {
  const t = String(s || '').trim();
  if (!t) return '';
  let d = t.replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+')) return '+' + d.slice(1).replace(/^(\d{2})(\d{2,5})(\d+)$/, '$1 $2 $3');
  if (d.startsWith('0') && d.length >= 6) {
    const groups = t.replace(/^\s*\(?0\)?\s*/, '').split(/[^\d]+/).filter(Boolean);
    return `+${cc} ${groups.length > 1 ? `${groups[0]} ${groups.slice(1).join('')}` : groups[0] || d.slice(1)}`;
  }
  return t;
}

/** Problems worth a look: e-mail domain ≠ website domain. */
export function checks(c) {
  const out = [];
  const host = String(c.web || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const mailDom = String(c.email || '').toLowerCase().split('@')[1] || '';
  if (host && mailDom && !mailDom.endsWith(host) && !host.endsWith(mailDom) && !/(gmail|gmx|web|t-online|outlook|hotmail|yahoo|icloud|posteo|mailbox|freenet|aol)\./.test(mailDom)) {
    out.push({ de: `E-Mail-Domain (${mailDom}) passt nicht zur Website (${host}) – vielleicht falsch gelesen?`, en: `E-mail domain (${mailDom}) doesn’t match the website (${host}) – maybe misread?` });
  }
  return out;
}

const csvCell = v => (/[";\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function toCsv(list, lang) {
  const head = CSV_COLS.map(k => (k === 'notiz' ? (lang === 'en' ? 'Note' : 'Notiz') : (FIELDS.find(f => f[0] === k)[1][lang] || k)));
  return '﻿' + [head, ...list.map(c => CSV_COLS.map(k => c[k] || ''))].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
const fileBase = c => (c.name || c.firma || 'Kontakt').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Kontakt';

export default {
  options: [
    LANG_OPTION,
    { id: 'intl', type: 'toggle', default: true, label: { de: 'Telefonnummern international (+49 …)', en: 'Phone numbers in international form (+49 …)' },
      hint: { de: 'So funktionieren sie auch im Ausland und in Messengern.', en: 'So they also work abroad and in messengers.' } },
    { id: 'cc', type: 'select', default: '49', when: v => v.intl, label: { de: 'Ländervorwahl für Nummern ohne +', en: 'Country code for numbers without +' },
      choices: [{ value: '49', label: '+49 Deutschland' }, { value: '43', label: '+43 Österreich' }, { value: '41', label: '+41 Schweiz' }, { value: '44', label: '+44 UK' }, { value: '1', label: '+1 USA / Canada' }] },
  ],

  async run(inputs, opts, ctx) {
    const ocr = await loadOcr();
    const contacts = [];
    const empty = [];
    for (const [i, input] of inputs.entries()) {
      ctx.progress(i / inputs.length, { de: `Karte ${i + 1} von ${inputs.length} wird gelesen …`, en: `Reading card ${i + 1} of ${inputs.length} …` });
      const { canvas } = await loadCanvas(input, { maxPixels: 16e6 });
      let res;
      try {
        res = await ocrBest(ocr, canvas, { lang: opts.lang, signal: ctx.signal,
          onProgress: (phase, p) => ctx.progress((i + (phase === 'recognize' ? p * 0.95 : 0)) / inputs.length, { de: `Karte ${i + 1} von ${inputs.length} wird gelesen …`, en: `Reading card ${i + 1} of ${inputs.length} …` }) });
      } finally { release(canvas); }
      const lines = (res.lines || []).map(l => ({ text: l.text, size: Math.max(0, ...l.words.map(w => w.size || 0)) }));
      const c = parseCard(lines);
      c.notiz = (c.rest || []).join('\n');
      if (opts.intl) for (const k of ['telefon', 'mobil', 'fax']) c[k] = intlPhone(c[k], opts.cc);
      if (!c.name && !c.firma && !c.email && !c.telefon && !c.mobil) empty.push(input.name);
      c.source = input.name;
      c.raw = (res.lines || []).map(l => l.text).join('\n');
      contacts.push(c);
      await ctx.tick();
    }
    if (empty.length === inputs.length) throw userError(
      'Auf den Fotos wurden keine Kontaktdaten erkannt. Fotografiere die Karte gerade, scharf und ohne Spiegelung.',
      'No contact details were recognised in the photos. Photograph the card straight, sharp and without glare.');
    const outputs = [];
    const all = contacts.filter(c => !empty.includes(c.source));
    if (all.length === 1) outputs.push({ name: `${fileBase(all[0])}.vcf`, blob: new Blob([toVCard(all[0])], { type: 'text/vcard;charset=utf-8' }), meta: { contacts: all } });
    else {
      outputs.push({ name: ctx.t({ de: 'Kontakte.vcf', en: 'Contacts.vcf' }), blob: new Blob([all.map(toVCard).join('')], { type: 'text/vcard;charset=utf-8' }), meta: { contacts: all },
        note: ctx.t({ de: `${all.length} Kontakte in einer Datei`, en: `${all.length} contacts in one file` }) });
      outputs.push({ name: ctx.t({ de: 'Kontakte.csv', en: 'Contacts.csv' }), blob: new Blob([toCsv(all, ctx.lang)], { type: 'text/csv;charset=utf-8' }), note: ctx.t({ de: 'Für Excel oder dein CRM', en: 'For Excel or your CRM' }) });
    }
    if (empty.length) ctx.note({ de: `Keine Kontaktdaten erkannt in: ${empty.join(', ')}.`, en: `No contact details recognised in: ${empty.join(', ')}.` });
    ctx.note({ de: 'Prüf die Felder unten kurz – Korrekturen landen direkt in der Datei, die du dort speicherst.', en: 'Give the fields below a quick check – corrections go straight into the file you save there.' });
    return { outputs };
  },

  onResult(result, res, ctx) {
    const contacts = res.outputs.find(o => o.meta?.contacts)?.meta.contacts;
    if (!contacts?.length) return;
    const lang = ctx.lang;
    const sec = el('section', { class: 'new-box bc-panel', aria: { labelledby: 'bc-h' } }, el('h3', { id: 'bc-h' }, T(lang, { de: 'Kontakte prüfen und speichern', en: 'Check and save contacts' })));
    const list = contacts.map(c => ({ ...c }));
    list.forEach((c, i) => sec.append(card(c, i)));
    if (list.length > 1) {
      const allVcf = el('button', { type: 'button', class: 'wt-btn wt-btn-primary', onclick: () => save(new Blob([list.map(toVCard).join('')], { type: 'text/vcard;charset=utf-8' }), T(lang, { de: 'Kontakte.vcf', en: 'Contacts.vcf' })) },
        T(lang, { de: `Alle ${list.length} als .vcf speichern`, en: `Save all ${list.length} as .vcf` }));
      const allCsv = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => save(new Blob([toCsv(list, lang)], { type: 'text/csv;charset=utf-8' }), T(lang, { de: 'Kontakte.csv', en: 'Contacts.csv' })) },
        T(lang, { de: 'Alle als CSV', en: 'All as CSV' }));
      sec.append(el('div', { class: 'new-row' }, allVcf, allCsv));
    }
    const outs = result.querySelector('.wt-outputs, .wt-output');
    if (outs) outs.parentNode.insertBefore(sec, outs.nextSibling); else result.append(sec);

    async function save(blob, name) { const { download } = await import('../lib/download.js'); download(blob, name); }

    function card(c, i) {
      const id = k => `bc-${i}-${k}`;
      const warn = el('div', { class: 'bc-warn', role: 'status' });
      const qr = el('div', { class: 'bc-qr', hidden: true });
      const inputs = FIELDS.map(([k, label, type, ac]) => {
        const inp = el('input', { id: id(k), class: 'wt-input', type, autocomplete: ac, value: c[k] || '', inputmode: type === 'tel' ? 'tel' : null, oninput: () => { c[k] = inp.value.trim(); update(); } });
        return el('div', { class: `wt-opt bc-f bc-${k}` }, el('label', { for: id(k) }, T(lang, label)), inp);
      });
      const note = el('textarea', { id: id('notiz'), class: 'wt-input', rows: '2', oninput: () => { c.notiz = note.value; update(); } });
      note.value = c.notiz || '';
      const vcf = el('button', { type: 'button', class: 'wt-btn wt-btn-primary', onclick: () => save(new Blob([toVCard(c)], { type: 'text/vcard;charset=utf-8' }), `${fileBase(c)}.vcf`) },
        T(lang, { de: 'Kontakt speichern (.vcf)', en: 'Save contact (.vcf)' }));
      const qrBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', aria: { expanded: 'false' }, onclick: async () => {
        qr.hidden = !qr.hidden;
        qrBtn.setAttribute('aria-expanded', String(!qr.hidden));
        if (!qr.hidden) await drawQr();
      } }, T(lang, { de: 'Als QR-Code aufs Handy', en: 'To your phone as a QR code' }));
      async function drawQr() {
        const { encodeQR, drawQR } = await import('../lib/shared/qr.js');
        clear(qr);
        try {
          const code = encodeQR(toVCard({ ...c, notiz: '' }), { ecc: 'L' });
          const side = (code.size + 8) * Math.max(3, Math.floor(300 / (code.size + 8)));   // whole pixels per module
          const cv = el('canvas', { class: 'bc-qr-img', width: side, height: side, role: 'img', aria: { label: T(lang, { de: 'QR-Code mit dem Kontakt', en: 'QR code with the contact' }) } });
          drawQR(cv.getContext('2d'), code, 0, 0, side, { border: 4 });
          qr.append(cv, el('p', { class: 'new-muted' }, T(lang, { de: 'Mit der Kamera-App des Handys scannen – der Kontakt lässt sich direkt speichern.', en: 'Scan with the phone’s camera app – the contact can be saved right away.' })));
        } catch {
          qr.append(el('p', { class: 'new-muted' }, T(lang, { de: 'Zu viele Daten für einen QR-Code – speichere die .vcf-Datei.', en: 'Too much data for a QR code – save the .vcf file.' })));
        }
      }
      function update() {
        clear(warn);
        for (const w of checks(c)) warn.append(el('p', {}, T(lang, w)));
        if (!qr.hidden) drawQr();
      }
      update();
      return el('article', { class: 'bc-card' },
        el('h4', {}, T(lang, { de: `Karte ${i + 1}`, en: `Card ${i + 1}` }), el('span', { class: 'new-muted' }, ` · ${c.source}`)),
        el('div', { class: 'bc-grid' }, ...inputs),
        el('div', { class: 'wt-opt' }, el('label', { for: id('notiz') }, T(lang, { de: 'Notiz', en: 'Note' })), note),
        warn,
        el('div', { class: 'new-row' }, vcf, qrBtn), qr,
        el('details', {}, el('summary', {}, T(lang, { de: 'Erkannter Text', en: 'Recognised text' })), el('pre', { class: 'bc-raw' }, c.raw || '')));
    }
  },
};
