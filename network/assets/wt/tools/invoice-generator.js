// Tool: invoice generator (no file intake). German page: all § 14 UStG details with a live check,
// VAT 19 / 7 / 0 % per line (mixed rates), small-business option (§ 19 UStG, no VAT + required note),
// note for 0 % lines, Leistungsdatum or -zeitraum. English page: generic invoice, currency + tax label +
// free rates, no claims about any country's law. Both: discount, payment terms, bank details + optional
// GiroCode (EPC QR, EUR), logo, numbering helper and "remember sender" (both opt-in, localStorage).
// Data never leaves the device. PDF via lib/new-invoice.js.
import { el, clear } from '../lib/dom.js';
import { ensureCss, T, iconBtn, ICON, userError } from '../lib/new-ui.js';
import { computeTotals, checks, money, isoDate, nextNumber, ibanValid, cleanIban, invoicePdf, EXEMPT_PRESETS, paymentText } from '../lib/new-invoice.js';

ensureCss();

const SENDER_KEY = 'fale-wt-invoice-sender';
const NUMBER_KEY = 'fale-wt-invoice-number';
const SENDER_FIELDS = ['sName', 'sStreet', 'sCity', 'sCountry', 'sPhone', 'sMail', 'sWeb', 'taxNo', 'vatId', 'bankHolder', 'bankName', 'iban', 'bic', 'noTax', 'terms', 'closing', 'currency', 'taxLabel'];
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let stageApi = null;

export default {
  labels: { back_to_files: { de: 'Zurück zur Rechnung', en: 'Back to the invoice' } },
  options: [],
  mountStage(stage, state, ctx) { stageApi = invoiceStage(stage, state, ctx); },

  status(values, inputs, lang) {
    const v = values.inv;
    if (!v) return null;
    const t = computeTotals(v);
    const miss = checks(v, lang).filter(c => !c.ok && !c.optional);
    const summary = { de: `Rechnung · ${money(t.gross, 'de', 'EUR')}`, en: `Invoice · ${money(t.gross, 'en', v.currency || 'EUR')}` };
    if (!String(v.number || '').trim() || !t.lines.some(l => l.ok)) return { ok: false, summary, hint: { de: 'Noch nötig: Rechnungsnummer und mindestens eine Position.', en: 'Still needed: invoice number and at least one line item.' } };
    if (miss.length) return { summary, hint: { de: `Es fehlen Pflichtangaben (${miss.length}) – siehe Check.`, en: `${miss.length} recommended ${miss.length === 1 ? 'detail is' : 'details are'} missing – see the checklist.` } };
    return { summary };
  },

  async run(inputs, opts, ctx) {
    const v = opts.inv;
    const t = computeTotals(v);
    if (!String(v.number || '').trim() || !t.lines.some(l => l.ok)) throw userError('Bitte gib eine Rechnungsnummer und mindestens eine vollständige Position an.', 'Please enter an invoice number and at least one complete line item.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const { bytes, pages, missing } = await invoicePdf(v, ctx.lang, stageApi?.logo() || null);
    stageApi?.afterRun();
    const miss = checks(v, ctx.lang).filter(c => !c.ok && !c.optional);
    if (miss.length) ctx.note({ de: `Achtung, es fehlen Pflichtangaben: ${miss.map(c => c.de).join('; ')}.`, en: `Missing: ${miss.map(c => c.en).join('; ')}.` });
    if (missing.length) ctx.note({ de: `Diese Zeichen kann die Schrift nicht darstellen und wurden ersetzt: ${missing.join(' ')}`, en: `These characters can’t be shown by the font and were replaced: ${missing.join(' ')}` });
    if (ctx.lang === 'de') ctx.note({ de: 'Hinweis: Das ist eine Ausfüllhilfe, keine Steuerberatung. Für Rechnungen an Unternehmen wird schrittweise ab 2027 eine E-Rechnung (z. B. XRechnung) Pflicht – dieses PDF ist keine E-Rechnung.', en: '' });
    const name = ctx.safeFileName(`${ctx.t({ de: 'Rechnung', en: 'Invoice' })} ${String(v.number).trim()}${v.rName ? ' – ' + String(v.rName).trim() : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: money(t.gross, ctx.lang, ctx.lang === 'de' ? 'EUR' : v.currency || 'EUR') }] };
  },
};

function invoiceStage(stage, state, ctx) {
  const lang = ctx.lang;
  const de = lang === 'de';
  const today = isoDate();
  const v = (state.values.inv ||= {
    number: '', date: today, serviceMode: 'same', serviceDate: today, from: '', to: '', terms: '14', discount: '',
    items: [{ desc: '', qty: '1', unit: de ? 'Stk.' : 'pcs', price: '', vat: de ? '19' : '20' }],
    noTax: false, girocode: true, currency: 'EUR', taxLabel: 'VAT', exemptNote: '', intro: '', closing: de ? 'Vielen Dank für Ihren Auftrag!' : 'Thank you for your business!',
  });
  let logo = null, logoUrl = null;
  // remembered sender (opt-in)
  const saved = store.get(SENDER_KEY);
  let remember = !!saved;
  if (saved && typeof saved === 'object') {
    for (const k of SENDER_FIELDS) if (saved[k] !== undefined && (v[k] === undefined || v[k] === '' || k === 'noTax')) v[k] = saved[k];
    if (saved.logo && /^data:image\/(png|jpeg);base64,/.test(saved.logo)) setLogoFromDataUrl(saved.logo);
  }
  const num = store.get(NUMBER_KEY);
  let counting = !!num;
  if (num && num.last && !v.number) v.number = nextNumber(num.last);
  if (!v.number && de) v.number = `${new Date().getFullYear()}-001`;
  if (!v.number) v.number = `INV-${new Date().getFullYear()}-001`;

  // ---------------------------------------------------------------- field helpers
  let uid = 0;
  const changed = () => { state.results.clear(); ctx.refresh(); renderLive(); };
  function field(key, label, { type = 'text', wide = false, hint = null, placeholder = '', autocomplete = 'off', inputmode = null, obj = v, onInput = null, maxLength = 200, validate = null } = {}) {
    const id = `new-inv-${key}-${++uid}`;
    const err = el('p', { class: 'new-f-err', id: id + '-err', hidden: true });
    const input = el(type === 'textarea' ? 'textarea' : 'input', {
      id, class: type === 'textarea' ? '' : 'wt-input', type: type === 'textarea' ? null : type, value: obj[key] ?? '', placeholder: T(lang, placeholder) || null,
      autocomplete, inputmode, maxlength: type === 'date' ? null : String(maxLength), rows: type === 'textarea' ? '3' : null,
      aria: { describedby: [hint ? id + '-hint' : '', id + '-err'].filter(Boolean).join(' ') },
    });
    if (type === 'textarea') input.value = obj[key] ?? '';
    const check = () => { const m = validate ? validate(input.value) : ''; err.textContent = m ? T(lang, m) : ''; err.hidden = !m; input.setAttribute('aria-invalid', String(!!m)); };
    input.addEventListener('input', () => { obj[key] = input.value; check(); onInput?.(input.value); if (remember && SENDER_FIELDS.includes(key)) saveSender(); changed(); });
    if (obj[key]) check();
    return el('div', { class: 'new-f' + (wide ? ' new-f-wide' : '') }, el('label', { for: id }, T(lang, label)), input,
      hint ? el('p', { class: 'new-f-hint', id: id + '-hint' }, T(lang, hint)) : null, err);
  }
  function select(key, label, choices, { obj = v, onChange = null, wide = false } = {}) {
    const id = `new-inv-${key}-${++uid}`;
    const s = el('select', { id, class: 'wt-input' }, choices.map(c => el('option', { value: c.value, selected: String(obj[key]) === String(c.value) }, T(lang, c.label))));
    s.addEventListener('change', () => { obj[key] = s.value; onChange?.(s.value); if (remember && SENDER_FIELDS.includes(key)) saveSender(); changed(); });
    return el('div', { class: 'new-f' + (wide ? ' new-f-wide' : '') }, el('label', { for: id }, T(lang, label)), s);
  }
  function checkbox(key, label, { hint = null, onChange = null, checked = !!v[key] } = {}) {
    const id = `new-inv-${key}-${++uid}`;
    const input = el('input', { type: 'checkbox', id, checked, aria: { describedby: hint ? id + '-hint' : null } });
    input.addEventListener('change', () => { if (key) v[key] = input.checked; onChange?.(input.checked); if (remember && SENDER_FIELDS.includes(key)) saveSender(); changed(); });
    return el('div', { class: 'new-f new-f-wide' }, el('label', { class: 'new-chk', for: id }, input, el('span', {}, T(lang, label))), hint ? el('p', { class: 'new-f-hint', id: id + '-hint' }, T(lang, hint)) : null);
  }
  const sec = (id, title, ...kids) => el('section', { class: 'new-box', aria: { labelledby: id } }, el('h2', { id }, T(lang, title)), ...kids);
  const grid = (...kids) => el('div', { class: 'new-inv-fields' }, ...kids);

  function saveSender() {
    if (!remember) { store.set(SENDER_KEY, null); return; }
    const o = Object.fromEntries(SENDER_FIELDS.map(k => [k, v[k] ?? '']));
    if (logo && logo.dataUrl && logo.dataUrl.length < 400000) o.logo = logo.dataUrl;
    store.set(SENDER_KEY, o);
  }
  function setLogoFromDataUrl(url) {
    const b64 = url.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    logo = { bytes, type: url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', dataUrl: url };
  }

  // ---------------------------------------------------------------- sections
  const ibanCheck = s => (cleanIban(s) && !ibanValid(s) ? { de: 'Diese IBAN ist ungültig (Prüfziffer stimmt nicht).', en: 'This IBAN is not valid (check digits do not match).' } : '');
  const logoPrev = el('img', { class: 'new-logo-prev', alt: T(lang, { de: 'Logo-Vorschau', en: 'Logo preview' }), hidden: true });
  const logoInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'wt-picker', tabindex: '-1' });
  const logoRemove = el('button', { type: 'button', class: 'wt-btn wt-btn-text wt-btn-sm', hidden: true, onclick: () => { logo = null; showLogo(); saveSender(); changed(); } }, T(lang, { de: 'Logo entfernen', en: 'Remove logo' }));
  logoInput.addEventListener('change', async () => {
    const f = logoInput.files[0];
    logoInput.value = '';
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      const url = c.toDataURL('image/png');
      c.width = c.height = 0;
      setLogoFromDataUrl(url);
      showLogo(); saveSender(); changed();
    } catch (err) { console.warn(err); }
  });
  function showLogo() {
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logoUrl = logo ? URL.createObjectURL(new Blob([logo.bytes], { type: logo.type })) : null;
    logoPrev.hidden = !logo; logoRemove.hidden = !logo;
    if (logoUrl) logoPrev.src = logoUrl; else logoPrev.removeAttribute('src');
  }
  showLogo();

  const vatChoices = [{ value: '19', label: '19 %' }, { value: '7', label: '7 %' }, { value: '0', label: '0 %' }];
  const itemsList = el('ul', { class: 'new-items' });
  const sums = new WeakMap();
  function renderItems() {
    clear(itemsList);
    v.items.forEach((it, i) => {
      const lineTotal = el('strong', { class: 'new-item-sum' });
      sums.set(it, lineTotal);
      const kids = [
        field('desc', { de: `Position ${i + 1}: Beschreibung`, en: `Item ${i + 1}: description` }, { obj: it, type: 'textarea', maxLength: 600, placeholder: { de: 'z. B. Webdesign Startseite', en: 'e.g. Website design' } }),
        field('qty', { de: 'Menge', en: 'Qty' }, { obj: it, inputmode: 'decimal', maxLength: 12 }),
        field('unit', { de: 'Einheit', en: 'Unit' }, { obj: it, maxLength: 20, placeholder: { de: 'Std.', en: 'hrs' } }),
        field('price', { de: 'Einzelpreis netto', en: 'Unit price' }, { obj: it, inputmode: 'decimal', maxLength: 16, placeholder: '0,00' }),
      ];
      if (!v.noTax) kids.push(de ? select('vat', 'USt.', vatChoices, { obj: it }) : field('vat', { de: 'Steuer %', en: `${v.taxLabel || 'Tax'} %` }, { obj: it, inputmode: 'decimal', maxLength: 6 }));
      const del = v.items.length > 1 ? iconBtn(ICON.trash, T(lang, { de: `Position ${i + 1} entfernen`, en: `Remove item ${i + 1}` }), () => { v.items.splice(i, 1); renderItems(); changed(); }, { cls: 'wt-btn wt-btn-text wt-btn-sm' }) : el('span');
      kids[0].classList.add('new-f-desc');
      itemsList.append(el('li', { class: 'new-item' }, ...kids, el('div', { class: 'new-item-foot' }, del, lineTotal)));
    });
    renderLive();
  }
  const addItem = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => {
    const last = v.items[v.items.length - 1] || {};
    v.items.push({ desc: '', qty: '1', unit: last.unit || '', price: '', vat: last.vat || (de ? '19' : '20') });
    renderItems(); changed();
    itemsList.lastElementChild?.querySelector('textarea')?.focus();
  } }, T(lang, { de: '+ Position hinzufügen', en: '+ Add item' }));

  const serviceBox = el('div', { class: 'new-inv-fields' });
  function renderService() {
    clear(serviceBox);
    serviceBox.append(select('serviceMode', { de: 'Leistungsdatum', en: 'Date of supply' }, [
      { value: 'same', label: { de: 'Gleich Rechnungsdatum', en: 'Same as invoice date' } },
      { value: 'date', label: { de: 'Anderes Datum', en: 'Other date' } },
      { value: 'period', label: { de: 'Zeitraum', en: 'Period' } },
      { value: 'none', label: { de: 'Nicht angeben', en: 'Don’t show' } },
    ], { onChange: () => renderService() }));
    if (v.serviceMode === 'date') serviceBox.append(field('serviceDate', { de: 'Liefer-/Leistungsdatum', en: 'Date of supply' }, { type: 'date' }));
    if (v.serviceMode === 'period') serviceBox.append(field('from', { de: 'Von', en: 'From' }, { type: 'date' }), field('to', { de: 'Bis', en: 'To' }, { type: 'date' }));
  }
  renderService();

  const exemptBox = el('div', {});
  function renderExempt() {
    clear(exemptBox);
    const t = computeTotals(v);
    if (!de || v.noTax || !t.groups.some(g => g.rate === 0)) return;
    const pre = el('div', { class: 'new-row' }, EXEMPT_PRESETS.map(p => el('button', { type: 'button', class: 'new-chip', onclick: () => { v.exemptNote = p.de; renderExempt(); changed(); } }, p.label)));
    exemptBox.append(field('exemptNote', 'Hinweis zur Steuerbefreiung (Pflicht bei 0 %)', { type: 'textarea', wide: true, maxLength: 400, hint: 'Wähl einen Vorschlag oder schreib den Grund selbst. Bei Reverse Charge gehört auch die USt-IdNr. des Kunden auf die Rechnung.' }), pre);
  }

  const taxBox = el('div', {});
  function renderTax() {
    clear(taxBox);
    if (de) {
      taxBox.append(checkbox('noTax', 'Kleinunternehmer (§ 19 UStG) – keine Umsatzsteuer ausweisen', { hint: 'Fügt den Pflichthinweis ein und lässt die Steuer weg.', onChange: () => { renderItems(); renderTax(); } }));
    } else {
      taxBox.append(checkbox('noTax', { de: '', en: 'Don’t charge tax on this invoice' }, { onChange: () => { renderItems(); renderTax(); } }));
      if (!v.noTax) taxBox.append(grid(field('taxLabel', { de: '', en: 'Name of the tax' }, { maxLength: 20, placeholder: 'VAT', onInput: () => renderItems() })));
    }
    taxBox.append(exemptBox);
    renderExempt();
  }
  renderTax();

  const sumTable = el('table', { class: 'new-sum' });
  const checkList = el('ul', { class: 'new-check' });
  const payLine = el('p', { class: 'new-muted' });
  function renderLive() {
    const t = computeTotals(v);
    const cur = de ? 'EUR' : v.currency || 'EUR';
    v.items.forEach((it, i) => { if (sums.get(it)) sums.get(it).textContent = t.lines[i].ok ? money(t.lines[i].cents, lang, cur) : '–'; });
    clear(sumTable);
    const row = (a, b, cls) => sumTable.append(el('tr', { class: cls || null }, el('td', {}, a), el('td', {}, b)));
    if (t.discountPct > 0) { row(T(lang, { de: 'Zwischensumme', en: 'Subtotal' }), money(t.subtotal, lang, cur)); row(T(lang, { de: `Rabatt ${t.discountPct} %`, en: `Discount ${t.discountPct} %` }), '− ' + money(t.discount, lang, cur)); }
    if (!v.noTax) {
      row(T(lang, { de: 'Netto', en: 'Net' }), money(t.net, lang, cur));
      for (const g of t.groups) row(`${de ? 'USt.' : (v.taxLabel || 'Tax')} ${g.rate} %`, money(g.tax, lang, cur));
    }
    row(T(lang, { de: 'Rechnungsbetrag', en: 'Total' }), money(t.gross, lang, cur), 'new-sum-total');
    payLine.textContent = paymentText(v, lang, t);
    clear(checkList);
    for (const c of checks(v, lang)) checkList.append(el('li', { class: c.ok ? 'is-ok' : c.optional ? 'is-opt' : 'is-miss' }, `${c.ok ? '✓' : c.optional ? '○' : '✗'} ${de ? c.de : c.en}`));
    renderExemptLazy();
  }
  let exemptTimer = 0;
  let lastZero = null;
  function renderExemptLazy() {
    const zero = !v.noTax && computeTotals(v).groups.some(g => g.rate === 0);
    if (zero === lastZero) return;
    lastZero = zero;
    clearTimeout(exemptTimer); exemptTimer = setTimeout(renderExempt, 0);
  }

  const rememberBox = checkbox(null, { de: 'Absender, Bankdaten und Logo auf diesem Gerät merken', en: 'Remember sender, bank details and logo on this device' }, {
    checked: remember, hint: { de: 'Nur in diesem Browser gespeichert. Ausschalten löscht die Daten.', en: 'Stored only in this browser. Switching off deletes the data.' },
    onChange: on => { remember = on; saveSender(); } });
  const numberBox = checkbox(null, { de: 'Rechnungsnummer auf diesem Gerät hochzählen', en: 'Count up the invoice number on this device' }, {
    checked: counting, hint: { de: 'Nach dem Erstellen wird die Nummer gemerkt und beim nächsten Mal die folgende vorgeschlagen.', en: 'After creating, the number is stored and the next one is suggested next time.' },
    onChange: on => { counting = on; if (!on) store.set(NUMBER_KEY, null); } });

  stage.append(
    sec('new-inv-h1', { de: 'Rechnungsdaten', en: 'Invoice details' }, grid(
      field('number', { de: 'Rechnungsnummer', en: 'Invoice number' }, { maxLength: 40 }),
      field('date', { de: 'Rechnungsdatum', en: 'Invoice date' }, { type: 'date' }),
      field('customerNo', { de: 'Kundennummer (optional)', en: 'Customer number (optional)' }, { maxLength: 40 }),
      select('terms', { de: 'Zahlungsziel', en: 'Payment terms' }, [
        { value: '0', label: { de: 'Sofort', en: 'On receipt' } }, { value: '7', label: { de: '7 Tage', en: '7 days' } }, { value: '14', label: { de: '14 Tage', en: '14 days' } }, { value: '30', label: { de: '30 Tage', en: '30 days' } }]),
      de ? null : select('currency', { de: '', en: 'Currency' }, ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD'].map(c => ({ value: c, label: c })), { onChange: () => renderItems() })),
    serviceBox, numberBox),
    sec('new-inv-h2', { de: 'Kunde', en: 'Bill to' }, grid(
      field('rName', { de: 'Firma / Name', en: 'Company / name' }, { wide: true }),
      field('rAttn', { de: 'z. Hd. (optional)', en: 'Attn. (optional)' }, { wide: true }),
      field('rStreet', { de: 'Straße und Hausnummer', en: 'Street' }),
      field('rCity', { de: 'PLZ und Ort', en: 'Postcode and town' }),
      field('rCountry', { de: 'Land (nur Ausland)', en: 'Country (optional)' }),
      field('rVatId', { de: 'USt-IdNr. des Kunden (optional)', en: 'Customer VAT number (optional)' }, { maxLength: 20 }))),
    sec('new-inv-h3', { de: 'Positionen', en: 'Line items' }, itemsList, el('div', { class: 'new-row' }, addItem),
      grid(field('discount', { de: 'Rabatt in % (optional)', en: 'Discount in % (optional)' }, { inputmode: 'decimal', maxLength: 6, validate: s => (s && !(parseFloat(String(s).replace(',', '.')) >= 0 && parseFloat(String(s).replace(',', '.')) <= 100) ? { de: 'Bitte 0 bis 100 eingeben.', en: 'Enter 0 to 100.' } : '') })),
      taxBox, sumTable, payLine),
    sec('new-inv-h4', { de: 'Dein Unternehmen', en: 'From' }, grid(
      field('sName', { de: 'Name / Firma', en: 'Name / company' }, { wide: true, autocomplete: 'organization' }),
      field('sStreet', { de: 'Straße und Hausnummer', en: 'Street' }, { autocomplete: 'address-line1' }),
      field('sCity', { de: 'PLZ und Ort', en: 'Postcode and town' }),
      field('sCountry', { de: 'Land (optional)', en: 'Country (optional)' }),
      field('sPhone', { de: 'Telefon (optional)', en: 'Phone (optional)' }, { type: 'tel', autocomplete: 'tel' }),
      field('sMail', { de: 'E-Mail (optional)', en: 'E-mail (optional)' }, { type: 'email', autocomplete: 'email' }),
      field('sWeb', { de: 'Website (optional)', en: 'Website (optional)' }),
      field('taxNo', { de: 'Steuernummer', en: 'Tax number (optional)' }, { maxLength: 30, hint: de ? { de: 'Steuernummer oder USt-IdNr. – eins von beiden ist Pflicht.', en: '' } : null }),
      field('vatId', { de: 'USt-IdNr.', en: 'VAT number (optional)' }, { maxLength: 20 })),
      el('div', { class: 'new-f' }, el('span', { class: 'new-f-hint' }, T(lang, { de: 'Logo (optional, PNG oder JPG)', en: 'Logo (optional, PNG or JPG)' })), logoPrev,
        el('div', { class: 'new-row' }, el('label', { class: 'wt-btn wt-btn-quiet wt-btn-sm' }, T(lang, { de: 'Logo wählen', en: 'Choose logo' }), logoInput), logoRemove)),
      rememberBox),
    sec('new-inv-h5', { de: 'Bankverbindung', en: 'Bank details' }, grid(
      field('bankHolder', { de: 'Kontoinhaber (falls abweichend)', en: 'Account holder (if different)' }),
      field('bankName', { de: 'Bank (optional)', en: 'Bank (optional)' }),
      field('iban', 'IBAN', { maxLength: 42, autocomplete: 'off', validate: ibanCheck }),
      field('bic', { de: 'BIC (optional)', en: 'BIC (optional)' }, { maxLength: 11 })),
      checkbox('girocode', { de: 'GiroCode (QR-Code zum Bezahlen) einfügen', en: 'Add a payment QR code (EPC / GiroCode, EUR only)' }, { hint: { de: 'Banking-Apps lesen damit Empfänger, IBAN, Betrag und Verwendungszweck ein.', en: 'Banking apps in the euro area read the payee, IBAN, amount and reference from it.' } })),
    sec('new-inv-h6', { de: 'Texte', en: 'Texts' }, grid(
      field('intro', { de: 'Einleitung (optional)', en: 'Intro (optional)' }, { type: 'textarea', wide: true, maxLength: 800, placeholder: { de: 'z. B. für die erbrachten Leistungen berechne ich Ihnen:', en: 'e.g. For the services provided I charge:' } }),
      field('closing', { de: 'Schlusstext (optional)', en: 'Closing text (optional)' }, { type: 'textarea', wide: true, maxLength: 800 }))),
    sec('new-inv-h7', de ? 'Pflichtangaben-Check (§ 14 UStG)' : { de: '', en: 'Checklist' }, checkList,
      el('p', { class: 'new-legal' }, T(lang, {
        de: 'Ausfüllhilfe, keine Steuerberatung. Geprüft wird nur, ob die Angaben ausgefüllt sind – nicht, ob sie stimmen. Im Zweifel frag deine Steuerberatung.',
        en: 'This tool helps you lay out an invoice. It does not give tax or legal advice – requirements differ between countries.' }))));
  renderItems();

  return {
    logo: () => (logo ? { bytes: logo.bytes, type: logo.type } : null),
    afterRun() { if (counting) store.set(NUMBER_KEY, { last: String(v.number || '').trim() }); if (remember) saveSender(); },
  };
}
