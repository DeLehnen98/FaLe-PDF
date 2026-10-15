// Shared stage parts of the letter tools of the "Vorlagen" pack (payment reminder, withdrawal, cover letter,
// DIN letter): sender with opt-in "remember" (same storage as the cancellation letter, so a remembered sender
// shows up in every letter tool), recipient, signature, live PDF preview + plain text with "copy".
import { el, T, s, form, remember, signaturePad, copyButton, pdfPreview, textPreview, dateLine, isoDate } from './tpl-core.js';
import { letterPdf, letterText } from './tpl-pdf.js';

export const SENDER_KEY = 'fale-wt-letter-sender';
export const SENDER_FIELDS = ['sName', 'sStreet', 'sCity', 'sPhone', 'sMail', 'place'];

/** Sender/recipient/contact/date lines of a letter model from the common fields. */
export function baseModel(v, lang) {
  const lines = keys => keys.map(k => s(v[k])).filter(Boolean);
  return {
    sender: lines(['sName', 'sStreet', 'sCity']),
    contact: lines(['sPhone', 'sMail']),
    recipient: lines(['rName', 'rAttn', 'rStreet', 'rCity', 'rCountry']),
    dateLine: dateLine(v.place, v.letterDate || isoDate(), lang),
    name: s(v.sName),
    lang,
  };
}

export function senderSection(f, v, lang, { title = { de: 'Absender', en: 'Sender' }, id = 'tpl-h-sender', extra = [] } = {}) {
  const rem = remember({ key: SENDER_KEY, fields: SENDER_FIELDS, v, lang });
  const sec = f.sec(id, title,
    f.grid(f.field('sName', { de: 'Dein Name', en: 'Your name' }, { autocomplete: 'name', wide: true }), f.field('sStreet', { de: 'Straße und Hausnummer', en: 'Street and number' }, { autocomplete: 'address-line1', wide: true }),
      f.field('sCity', { de: 'PLZ und Ort', en: 'Postcode and town' }, { wide: true }), f.field('sPhone', { de: 'Telefon (optional)', en: 'Phone (optional)' }, { type: 'tel', autocomplete: 'tel' }),
      f.field('sMail', { de: 'E-Mail (optional)', en: 'E-mail (optional)' }, { type: 'email', autocomplete: 'email' }),
      ...extra,
      f.field('place', { de: 'Ort für die Datumszeile', en: 'Place for the date line' }), f.field('letterDate', { de: 'Datum des Briefs', en: 'Date of the letter' }, { type: 'date' })),
    rem.box);
  return { sec, rem };
}

export function recipientSection(f, lang, { title = { de: 'Empfänger', en: 'Recipient' }, id = 'tpl-h-rec', nameLabel = { de: 'Firma / Name', en: 'Company / name' } } = {}) {
  return f.sec(id, title, f.grid(
    f.field('rName', nameLabel, { autocomplete: 'organization', wide: true }), f.field('rAttn', { de: 'Abteilung / z. Hd. (optional)', en: 'Department / FAO (optional)' }, { wide: true }),
    f.field('rStreet', { de: 'Straße und Hausnummer oder Postfach', en: 'Street or PO box' }, { wide: true }), f.field('rCity', { de: 'PLZ und Ort', en: 'Postcode and town' }),
    f.field('rCountry', { de: 'Land (nur bei Auslandsbriefen)', en: 'Country (if abroad)' })));
}

export function signatureSection(f, lang, onChange, { title = { de: 'Unterschrift (optional)', en: 'Signature (optional)' }, id = 'tpl-h-sig' } = {}) {
  const pad = signaturePad(lang, onChange);
  const sec = f.sec(id, title, el('p', { class: 'img-muted' }, T(lang, { de: 'Unterschreib mit dem Finger – oder lass das Feld leer und unterschreib auf dem Ausdruck.', en: 'Sign with your finger – or leave it empty and sign the printout.' })), pad.root);
  return { sec, pad };
}

/**
 * Preview section: rendered PDF pages + the letter as plain text with "copy".
 * getModel() → letter model (without signature); getSig() → Promise<sig|null>.
 */
export function previewSection(f, lang, getModel, getSig, { id = 'tpl-h-pv', family = () => 'sans', foot = null } = {}) {
  const pv = pdfPreview(lang);
  const pre = textPreview(lang);
  const details = el('details', { class: 'img-lt-help tpl-textbox' }, el('summary', {}, T(lang, { de: 'Als Text anzeigen und kopieren', en: 'Show and copy as text' })),
    el('div', {}, pre, copyButton(() => letterText(getModel()), lang)));
  const sec = f.sec(id, { de: 'Vorschau', en: 'Preview' }, pv.root, details,
    foot || el('p', { class: 'img-muted' }, T(lang, { de: 'Gesetzt nach DIN 5008 für ein Fensterkuvert (DIN lang oder C5): Anschrift im Sichtfenster, Falz- und Lochmarken am Rand.', en: 'Laid out to DIN 5008 for a DL or C5 window envelope: address in the window, fold and punch marks on the edge.' })));
  const refresh = () => {
    pre.textContent = letterText(getModel());
    pv.schedule(async () => (await letterPdf({ ...getModel(), sig: await getSig() }, { lang, family: family() })).bytes);
  };
  return { sec, refresh, pv };
}

export { form };
