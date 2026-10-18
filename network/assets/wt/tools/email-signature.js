// Tool: e-mail signature generator (E-Mail-Signatur erstellen). Name, position, contact details, address,
// links to profiles (as text – no tracking images), an optional logo by URL; three layouts and an accent
// colour. Built the way mail programs want it: tables, inline styles, web-safe fonts, mid-tone colours that
// survive dark mode, no background images. Checks the mandatory details for German business letters by legal
// form (§ 35a GmbHG, § 37a / § 125a / § 177a HGB, § 80 AktG). Copy into the mail program as formatted text,
// as HTML code, or save as .htm (Outlook classic, Apple Mail, Thunderbird) plus a plain-text version.
import { el, icon, clear } from '../lib/dom.js';
import { ensureCss, T, segmented, field } from '../lib/img-core.js';
import { copyText } from '../lib/seo-ui.js';

ensureCss();

const FORMS = [
  { value: 'none', de: 'Privat / keine Angaben', en: 'Private / none' },
  { value: 'small', de: 'Kleingewerbe / Freiberufler', en: 'Sole trader / freelancer' },
  { value: 'ek', de: 'Eingetragener Kaufmann (e.K.)', en: 'Registered merchant (e.K.)' },
  { value: 'gmbh', de: 'GmbH', en: 'GmbH' },
  { value: 'ug', de: 'UG (haftungsbeschränkt)', en: 'UG (haftungsbeschränkt)' },
  { value: 'gmbhcokg', de: 'GmbH & Co. KG', en: 'GmbH & Co. KG' },
  { value: 'ohg', de: 'OHG', en: 'OHG' },
  { value: 'kg', de: 'KG', en: 'KG' },
  { value: 'ag', de: 'AG', en: 'AG' },
  { value: 'gbr', de: 'GbR (nicht eingetragen)', en: 'GbR (not registered)' },
  { value: 'egbr', de: 'eGbR (eingetragen)', en: 'eGbR (registered)' },
  { value: 'ev', de: 'Eingetragener Verein (e.V.)', en: 'Registered association (e.V.)' },
];
// which legal fields a form needs (required) or may use (optional)
const NEEDS = {
  none: { req: [], opt: [] },
  small: { req: ['street', 'city'], opt: ['vat'] },
  ek: { req: ['company', 'seat', 'court', 'reg', 'street', 'city'], opt: ['vat'] },
  gmbh: { req: ['company', 'seat', 'court', 'reg', 'managers', 'street', 'city'], opt: ['chair', 'vat'] },
  ug: { req: ['company', 'seat', 'court', 'reg', 'managers', 'street', 'city'], opt: ['vat'] },
  gmbhcokg: { req: ['company', 'seat', 'court', 'reg', 'partner', 'managers', 'street', 'city'], opt: ['vat'] },
  ohg: { req: ['company', 'seat', 'court', 'reg', 'street', 'city'], opt: ['vat'] },
  kg: { req: ['company', 'seat', 'court', 'reg', 'street', 'city'], opt: ['vat'] },
  ag: { req: ['company', 'seat', 'court', 'reg', 'board', 'chair', 'street', 'city'], opt: ['vat'] },
  gbr: { req: ['company', 'partners', 'street', 'city'], opt: ['vat'] },
  egbr: { req: ['company', 'seat', 'court', 'reg', 'street', 'city'], opt: ['partners', 'vat'] },
  ev: { req: [], opt: ['company', 'seat', 'court', 'reg', 'board', 'vat'] },
};
const LEGAL_LABEL = {
  company: { de: 'Firma mit Rechtsform', en: 'Company name incl. legal form' },
  seat: { de: 'Sitz der Gesellschaft', en: 'Registered office' },
  court: { de: 'Registergericht', en: 'Register court' },
  reg: { de: 'Registernummer', en: 'Register number' },
  managers: { de: 'Geschäftsführer (alle, Vor- und Nachname)', en: 'Managing directors (all, full names)' },
  partner: { de: 'Persönlich haftende Gesellschafterin (Firma, Sitz, Registergericht, Nummer)', en: 'General partner (name, office, court, number)' },
  board: { de: 'Vorstand (alle Mitglieder, Vorsitz kennzeichnen)', en: 'Board (all members, mark the chair)' },
  chair: { de: 'Vorsitz des Aufsichtsrats', en: 'Chair of the supervisory board' },
  partners: { de: 'Gesellschafter (alle, Vor- und Nachname)', en: 'Partners (all, full names)' },
  vat: { de: 'USt-IdNr. (optional)', en: 'VAT ID (optional)' },
  street: { de: 'Straße und Hausnummer', en: 'Street' },
  city: { de: 'PLZ und Ort', en: 'Postcode and city' },
};
const PLACE = { reg: { de: 'HRB 12345', en: 'HRB 12345' }, court: { de: 'Amtsgericht Saarbrücken', en: 'Amtsgericht Saarbrücken' }, seat: { de: 'Saarbrücken', en: 'Saarbrücken' } };
const SOCIAL = [['linkedin', 'LinkedIn'], ['xing', 'XING'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['tiktok', 'TikTok']];
const FONT = 'Arial, Helvetica, sans-serif';
const INK = '#2b2f3a', GREY = '#6b7080';

const clean = s => String(s ?? '').trim();
/** http(s) URL or '' – adds https:// to bare domains, rejects anything else (javascript: etc.). */
export function safeUrl(s) {
  const t = clean(s);
  if (!t) return '';
  const u = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : 'https://' + t.replace(/^\/+/, '');
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; }
}
export const telHref = s => { const t = clean(s).replace(/\(0\)/g, '').replace(/[^\d+]/g, ''); return t.length >= 4 ? 'tel:' + t : ''; };
const shortUrl = u => u.replace(/^https?:\/\//, '').replace(/^www\./, 'www.').replace(/\/$/, '');

/** Missing mandatory details for the legal form → [field ids]. */
export function missing(s) {
  return (NEEDS[s.form] || NEEDS.none).req.filter(k => !clean(s[k]));
}

/** Legal lines (strings) in the usual order. */
export function legalLines(s, lang) {
  const w = (de, en) => (lang === 'de' ? de : en);
  const out = [];
  const f = s.form;
  if (f === 'none') return out;
  const reg = [clean(s.seat) && w(`Sitz: ${clean(s.seat)}`, `Registered office: ${clean(s.seat)}`), clean(s.court) && clean(s.reg) ? `${clean(s.court)}, ${clean(s.reg)}` : clean(s.court) || clean(s.reg)].filter(Boolean).join(' · ');
  if (reg) out.push(reg);
  if (f === 'gmbhcokg' && clean(s.partner)) out.push(w(`Persönlich haftende Gesellschafterin: ${clean(s.partner)}`, `General partner: ${clean(s.partner)}`));
  if (clean(s.managers)) out.push(w(`Geschäftsführung: ${clean(s.managers)}`, `Managing directors: ${clean(s.managers)}`));
  if (clean(s.board)) out.push(w(`Vorstand: ${clean(s.board)}`, `Board: ${clean(s.board)}`));
  if (clean(s.chair)) out.push(w(`Vorsitz des Aufsichtsrats: ${clean(s.chair)}`, `Chair of the supervisory board: ${clean(s.chair)}`));
  if (clean(s.partners)) out.push(w(`Gesellschafter: ${clean(s.partners)}`, `Partners: ${clean(s.partners)}`));
  if (clean(s.vat)) out.push(w(`USt-IdNr.: ${clean(s.vat)}`, `VAT ID: ${clean(s.vat)}`));
  return out;
}

/** Plain-text signature. */
export function plainText(s, lang) {
  const w = (de, en) => (lang === 'de' ? de : en);
  const L = ['-- '];
  if (clean(s.name)) L.push(clean(s.name));
  const role = [clean(s.title), clean(s.company)].filter(Boolean).join(' | ');
  if (role) L.push(role);
  if (clean(s.phone)) L.push(`${w('Tel.', 'Phone')} ${clean(s.phone)}`);
  if (clean(s.mobile)) L.push(`${w('Mobil', 'Mobile')} ${clean(s.mobile)}`);
  if (clean(s.email)) L.push(clean(s.email));
  if (safeUrl(s.web)) L.push(shortUrl(safeUrl(s.web)));
  const addr = [clean(s.street), clean(s.city)].filter(Boolean).join(', ');
  if (addr) L.push(addr);
  for (const [k, n] of SOCIAL) if (safeUrl(s[k])) L.push(`${n}: ${safeUrl(s[k])}`);
  const legal = legalLines(s, lang);
  if (legal.length) L.push('', ...legal);
  if (clean(s.note)) L.push('', clean(s.note));
  return L.join('\n');
}

// ---------------------------------------------------------------- HTML signature (DOM with inline styles)
function css(node, styles) { Object.assign(node.style, styles); return node; }
function a(href, text, color) {
  const x = el('a', { href }, text);
  return css(x, { color, textDecoration: 'underline' });
}
/** Build the signature as a DOM table. Its outerHTML is what goes into the mail program. */
export function buildSignature(s, lang) {
  const w = (de, en) => (lang === 'de' ? de : en);
  const accent = /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#3b5bdb';
  const td = (styles = {}) => css(el('td'), { fontFamily: FONT, fontSize: '13px', lineHeight: '1.45', color: INK, verticalAlign: 'top', padding: '0', ...styles });
  const line = (...kids) => css(el('div', {}, ...kids), { margin: '0' });
  const details = [];
  if (clean(s.name)) details.push(css(el('div', {}, clean(s.name)), { fontSize: '16px', fontWeight: 'bold', color: s.layout === 'classic' ? accent : INK, margin: '0' }));
  const role = [clean(s.title), clean(s.company)].filter(Boolean).join(' | ');
  if (role) details.push(css(line(role), { color: GREY, marginBottom: '6px' }));
  const contact = [];
  const tel = telHref(s.phone), mob = telHref(s.mobile), web = safeUrl(s.web);
  if (clean(s.phone)) contact.push([w('T ', 'T '), tel ? a(tel, clean(s.phone), INK) : clean(s.phone)]);
  if (clean(s.mobile)) contact.push([w('M ', 'M '), mob ? a(mob, clean(s.mobile), INK) : clean(s.mobile)]);
  if (clean(s.email)) contact.push([w('E ', 'E '), a('mailto:' + clean(s.email), clean(s.email), accent)]);
  if (web) contact.push([w('W ', 'W '), a(web, shortUrl(web), accent)]);
  for (const [label, val] of contact) details.push(line(css(el('span', {}, label), { color: GREY }), val));
  const addr = [clean(s.street), clean(s.city)].filter(Boolean).join(', ');
  if (addr) details.push(css(line(addr), { color: GREY }));
  const socials = SOCIAL.filter(([k]) => safeUrl(s[k]));
  if (socials.length) {
    const row = css(el('div'), { marginTop: '6px' });
    socials.forEach(([k, n], i) => { if (i) row.append(css(el('span', {}, ' · '), { color: GREY })); row.append(a(safeUrl(s[k]), n, accent)); });
    details.push(row);
  }
  const legal = legalLines(s, lang);
  const legalBox = legal.length || clean(s.note) ? css(el('div'), { marginTop: '10px', fontSize: '11px', lineHeight: '1.4', color: GREY }) : null;
  if (legalBox) {
    if (legal.length && clean(s.company)) legalBox.append(line(clean(s.company)));
    legal.forEach(t => legalBox.append(line(t)));
    if (clean(s.note)) legalBox.append(css(line(clean(s.note)), { marginTop: legal.length ? '6px' : '0' }));
  }
  const logoUrl = safeUrl(s.logo);
  const logoW = Math.max(40, Math.min(240, +s.logoWidth || 120));
  const logo = logoUrl ? css(el('img', { src: logoUrl, alt: clean(s.company) || clean(s.name) || 'Logo', width: String(logoW) }), { display: 'block', width: logoW + 'px', height: 'auto', border: '0' }) : null;

  const table = css(el('table', { cellpadding: '0', cellspacing: '0', border: '0', role: 'presentation' }), { borderCollapse: 'collapse', fontFamily: FONT, color: INK });
  const tr = el('tr');
  table.append(el('tbody', {}, tr));
  if (s.layout === 'logo' && logo) {
    tr.append(td({ paddingRight: '14px' }), td({ borderLeft: `3px solid ${accent}`, paddingLeft: '14px' }));
    tr.firstChild.append(logo);
    tr.lastChild.append(...details);
  } else if (s.layout === 'bar') {
    tr.append(td({ borderLeft: `3px solid ${accent}`, paddingLeft: '12px' }));
    if (logo) tr.firstChild.append(css(logo, { marginBottom: '8px' }));
    tr.firstChild.append(...details);
  } else {
    tr.append(td());
    tr.firstChild.append(...details);
    if (logo) tr.firstChild.append(css(logo, { marginTop: '10px' }));
  }
  if (legalBox) { const tr2 = el('tr'); tr2.append(td()); tr2.firstChild.colSpan = tr.children.length; tr2.firstChild.append(legalBox); table.firstChild.append(tr2); }
  return table;
}

export default {
  shareFirst: false,
  labels: { back_to_files: { de: 'Zurück zur Signatur', en: 'Back to the signature' } },
  mountStage(stage, state, ctx) { stage.append(build(state, ctx)); },
  status(v) {
    const s = v.sig || {};
    if (!clean(s.name) && !clean(s.company)) return { ok: false, hint: { de: 'Trag mindestens deinen Namen ein.', en: 'Enter at least your name.' } };
    const m = missing(s);
    if (m.length) return { summary: { de: `Signatur · ${m.length} Pflichtangabe${m.length === 1 ? '' : 'n'} fehlen`, en: `Signature · ${m.length} required detail${m.length === 1 ? '' : 's'} missing` } };
    return { summary: { de: 'Signatur fertig', en: 'Signature ready' } };
  },
  async run(inputs, opts, ctx) {
    const s = opts.sig, lang = ctx.lang;
    const html = buildSignature(s, lang).outerHTML;
    const doc = `<!DOCTYPE html>\n<html lang="${lang}"><head><meta charset="utf-8"><title>${lang === 'de' ? 'E-Mail-Signatur' : 'E-mail signature'}</title></head><body>\n${html}\n</body></html>\n`;
    const base = ctx.safeFileName(`${lang === 'de' ? 'E-Mail-Signatur' : 'Email signature'} ${clean(s.name) || clean(s.company)}`.trim());
    return { outputs: [
      { name: `${base}.htm`, blob: new Blob([doc], { type: 'text/html;charset=utf-8' }), note: ctx.t({ de: 'Für Outlook (klassisch), Apple Mail und Thunderbird', en: 'For classic Outlook, Apple Mail and Thunderbird' }) },
      { name: `${base}.txt`, blob: new Blob([plainText(s, lang) + '\n'], { type: 'text/plain;charset=utf-8' }), note: ctx.t({ de: 'Reiner Text, z. B. fürs iPhone', en: 'Plain text, e.g. for iPhone' }) },
    ] };
  },
};

function build(state, ctx) {
  const lang = ctx.lang;
  const w = (de, en) => T(lang, { de, en });
  const v = state.values;
  const s = (v.sig ||= { layout: 'bar', color: '#3b5bdb', form: 'none', logoWidth: 120 });
  const preview = el('div', { class: 'sig-preview', id: 'sig-preview' });
  const frame = el('div', { class: 'sig-frame' }, preview);
  const checkBox = el('div', { class: 'sig-check', aria: { live: 'polite' } });
  const sizeNote = el('p', { class: 'img-muted', id: 'sig-size' });
  const live = el('p', { class: 'seo-sr', role: 'status', aria: { live: 'polite' } });
  let timer = 0;
  const changed = () => { clearTimeout(timer); timer = setTimeout(render, 60); state.results.clear(); ctx.refresh(); };
  const f = (key, label, opts = {}) => field({ id: `sig-${key}`, label, value: s[key] ?? '', lang, onInput: x => { s[key] = x; changed(); }, ...opts });

  // legal fields, re-rendered when the form changes
  const legalBox = el('div', { class: 'img-fields' });
  const formSel = el('select', { id: 'sig-form', class: 'wt-input' }, FORMS.map(o => el('option', { value: o.value, selected: o.value === s.form }, T(lang, o))));
  formSel.addEventListener('change', () => { s.form = formSel.value; renderLegal(); changed(); });
  function renderLegal() {
    clear(legalBox);
    const n = NEEDS[s.form] || NEEDS.none;
    for (const k of ['company', 'seat', 'court', 'reg', 'partner', 'managers', 'board', 'chair', 'partners', 'vat']) {
      if (!n.req.includes(k) && !n.opt.includes(k)) continue;
      if (k === 'company') continue;   // asked above
      legalBox.append(f(k, LEGAL_LABEL[k], { maxLength: 300, placeholder: PLACE[k] || '', wide: !['seat', 'court', 'reg', 'vat'].includes(k) }));
    }
    if (s.form !== 'none') legalBox.append(el('p', { class: 'img-muted' }, w('Geschäftliche E-Mails sind Geschäftsbriefe: Die Angaben gehören in jede Mail, ein Link aufs Impressum reicht nicht. Keine Rechtsberatung – im Zweifel IHK oder Anwalt fragen.',
      'Business e-mails count as business letters in Germany: the details belong in every e-mail, a link to the imprint is not enough. Not legal advice.')));
  }

  const layoutSeg = segmented({ name: 'sig-layout', label: { de: 'Aufbau', en: 'Layout' }, lang, value: s.layout, onChange: x => { s.layout = x; changed(); },
    choices: [{ value: 'bar', label: { de: 'Mit Linie', en: 'With a line' } }, { value: 'classic', label: { de: 'Klassisch', en: 'Classic' } }, { value: 'logo', label: { de: 'Logo links', en: 'Logo left' } }] });
  const colorIn = el('input', { type: 'color', id: 'sig-color', class: 'sig-color', value: s.color, aria: { label: w('Akzentfarbe', 'Accent colour') } });
  colorIn.addEventListener('input', () => { s.color = colorIn.value; changed(); });
  const darkChk = el('input', { type: 'checkbox', id: 'sig-dark' });
  darkChk.addEventListener('change', () => frame.classList.toggle('is-dark', darkChk.checked));
  const noteTa = el('textarea', { id: 'sig-note', class: 'wt-input sig-ta', rows: '2', maxlength: '400' });
  noteTa.value = s.note || '';
  noteTa.addEventListener('input', () => { s.note = noteTa.value; changed(); });

  // copy buttons
  const copyRich = el('button', { type: 'button', class: 'wt-btn wt-btn-primary', id: 'sig-copy' }, w('Signatur kopieren', 'Copy signature'));
  const copyHtml = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', id: 'sig-copy-html' }, w('HTML-Code kopieren', 'Copy HTML code'));
  const copyTxt = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', id: 'sig-copy-txt' }, w('Als Text kopieren', 'Copy as text'));
  const say = ok => { live.textContent = ok ? w('Kopiert – jetzt in die Signatur-Einstellungen einfügen.', 'Copied – now paste it into your signature settings.') : w('Kopieren hat nicht geklappt.', 'Copying didn’t work.'); flash(ok); };
  const flash = ok => { const b = el('span', { class: 'sig-flash' + (ok ? '' : ' is-bad') }, ok ? w('Kopiert', 'Copied') : w('Nicht kopiert', 'Not copied')); actions.append(b); setTimeout(() => b.remove(), 1600); };
  copyRich.addEventListener('click', () => {
    // Put the exact signature HTML and the text version on the clipboard through a copy event: nothing is
    // re-parsed into this page (no inline styles needed here) and no page colours leak into the signature.
    const html = buildSignature(s, lang).outerHTML, text = plainText(s, lang);
    let wrote = false;
    const onCopy = e => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text); e.preventDefault(); wrote = true; };
    document.addEventListener('copy', onCopy, { once: true });
    let ok = false;
    try { ok = document.execCommand('copy') && wrote; } catch { ok = false; }
    document.removeEventListener('copy', onCopy);
    say(ok);
  });
  copyHtml.addEventListener('click', async () => say(await copyText(buildSignature(s, lang).outerHTML)));
  copyTxt.addEventListener('click', async () => say(await copyText(plainText(s, lang))));
  const actions = el('div', { class: 'sig-actions' }, copyRich, copyHtml, copyTxt);

  function render() {
    clear(preview).append(buildSignature(s, lang));
    const m = missing(s);
    clear(checkBox);
    if (s.form !== 'none') {
      checkBox.append(m.length
        ? el('p', { class: 'img-note' }, icon('alert'), el('span', {}, w(`Es fehlen Pflichtangaben: ${m.map(k => T(lang, LEGAL_LABEL[k])).join(', ')}.`, `Required details missing: ${m.map(k => T(lang, LEGAL_LABEL[k])).join(', ')}.`)))
        : el('p', { class: 'sig-ok' }, icon('check'), el('span', {}, w('Alle Pflichtangaben für diese Rechtsform sind drin.', 'All required details for this legal form are included.'))));
    }
    const len = buildSignature(s, lang).outerHTML.length;
    sizeNote.textContent = len > 10000 ? w(`Achtung: ${len} Zeichen – Gmail erlaubt höchstens 10.000. Lass Profile oder den Zusatztext weg.`, `Note: ${len} characters – Gmail allows at most 10,000. Drop some profiles or the extra text.`) : '';
    sizeNote.classList.toggle('is-warn', len > 10000);
  }

  const help = (title, steps) => el('details', { class: 'sig-help' }, el('summary', {}, title), el('ol', {}, steps.map(t => el('li', {}, t))));
  renderLegal();
  render();
  return el('section', { class: 'img-box sig', aria: { labelledby: 'sig-h' } },
    el('h2', { class: 'img-h', id: 'sig-h' }, w('Deine Angaben', 'Your details')),
    el('div', { class: 'img-fields' },
      f('name', { de: 'Name', en: 'Name' }, { wide: false, autocomplete: 'name' }), f('title', { de: 'Position', en: 'Job title' }, { wide: false, autocomplete: 'organization-title' }),
      f('company', { de: 'Firma (mit Rechtsform, z. B. „Muster GmbH“)', en: 'Company (incl. legal form)' }, { autocomplete: 'organization' }),
      f('phone', { de: 'Telefon', en: 'Phone' }, { wide: false, type: 'tel', autocomplete: 'tel' }), f('mobile', { de: 'Mobil', en: 'Mobile' }, { wide: false, type: 'tel' }),
      f('email', { de: 'E-Mail', en: 'E-mail' }, { wide: false, type: 'email', autocomplete: 'email' }), f('web', { de: 'Webseite', en: 'Website' }, { wide: false, type: 'url', inputmode: 'url', placeholder: 'www.' }),
      f('street', LEGAL_LABEL.street, { wide: false, autocomplete: 'street-address' }), f('city', LEGAL_LABEL.city, { wide: false, autocomplete: 'address-level2' })),
    el('details', { class: 'sig-more' }, el('summary', {}, w('Profile und Logo', 'Profiles and logo')),
      el('div', { class: 'img-fields' },
        ...SOCIAL.map(([k, n]) => f(k, n, { wide: false, type: 'url', inputmode: 'url', placeholder: `${n.toLowerCase()}.com/…`, maxLength: 300 })),
        f('logo', { de: 'Logo-Adresse (https://…, PNG mit transparentem Hintergrund)', en: 'Logo address (https://…, PNG with transparent background)' }, { type: 'url', inputmode: 'url', maxLength: 500,
          hint: { de: 'Das Logo muss im Internet liegen, z. B. auf deiner Webseite – eingebettete Bilder entfernt Gmail. Die Vorschau lädt es direkt von dort.', en: 'The logo has to be online, e.g. on your website – Gmail removes embedded images. The preview loads it straight from there.' } }),
        f('logoWidth', { de: 'Logo-Breite in Pixel', en: 'Logo width in pixels' }, { wide: false, inputmode: 'numeric', maxLength: 3 }))),
    el('h2', { class: 'img-h' }, w('Pflichtangaben', 'Legal details')),
    el('div', { class: 'img-field' }, el('label', { for: 'sig-form' }, w('Rechtsform', 'Legal form')), formSel), legalBox,
    el('div', { class: 'img-field' }, el('label', { for: 'sig-note' }, w('Zusatz (optional), z. B. Erreichbarkeit oder Vertraulichkeitshinweis', 'Extra line (optional), e.g. availability or confidentiality note')), noteTa),
    el('h2', { class: 'img-h' }, w('Aussehen', 'Look')),
    layoutSeg.root,
    el('div', { class: 'sig-color-row' }, el('label', { for: 'sig-color' }, w('Akzentfarbe', 'Accent colour')), colorIn),
    el('h2', { class: 'img-h' }, w('Vorschau', 'Preview')),
    el('div', { class: 'img-check' }, el('label', { for: 'sig-dark' }, darkChk, el('span', {}, w('Auf dunklem Hintergrund zeigen (Dark Mode)', 'Show on a dark background (dark mode)')))),
    frame, checkBox, sizeNote, actions, live,
    help(w('So fügst du sie in Gmail ein', 'How to add it in Gmail'), [w('„Signatur kopieren“ antippen.', 'Click “Copy signature”.'), w('In Gmail: Zahnrad → Alle Einstellungen → Allgemein → Signatur → Neu.', 'In Gmail: gear → See all settings → General → Signature → Create new.'), w('Ins Feld einfügen (Strg+V / ⌘V), unten „Änderungen speichern“.', 'Paste into the box (Ctrl+V / ⌘V) and click “Save changes” at the bottom.')]),
    help(w('So fügst du sie in Outlook ein', 'How to add it in Outlook'), [w('„Signatur kopieren“ antippen.', 'Click “Copy signature”.'), w('Neues Outlook und Outlook im Web: Einstellungen → Konten → Signaturen. Klassisches Outlook: Datei → Optionen → E-Mail → Signaturen.', 'New Outlook and Outlook on the web: Settings → Accounts → Signatures. Classic Outlook: File → Options → Mail → Signatures.'), w('Neue Signatur anlegen, einfügen, speichern und als Standard wählen.', 'Create a new signature, paste, save and set it as default.')]),
    help(w('So fügst du sie in Apple Mail und Thunderbird ein', 'How to add it in Apple Mail and Thunderbird'), [w('Apple Mail: Einstellungen → Signaturen → „+“, Inhalt einfügen und „Immer mit meiner Standardschrift“ ausschalten.', 'Apple Mail: Settings → Signatures → “+”, paste and untick “Always match my default message font”.'), w('Thunderbird: Kontoeinstellungen → „Stattdessen eine Datei als Signatur anhängen“ → die gespeicherte .htm-Datei wählen.', 'Thunderbird: Account settings → “Attach the signature from a file instead” → choose the saved .htm file.'), w('iPhone-Mail: Einstellungen → Apps → Mail → Signatur – dort klappt am besten die Textversion.', 'iPhone Mail: Settings → Apps → Mail → Signature – the text version works best there.')]),
    el('p', { class: 'img-muted' }, w('Deine Angaben bleiben auf dieser Seite und werden nicht gespeichert.', 'Your details stay on this page and are not stored.')));
}
