// Tool: read an e-invoice (XRechnung UBL/CII, ZUGFeRD 2.x / Factur-X PDF). The stage shows the essentials at
// once – who wants how much by when, where to pay (IBAN, reference, GiroCode to scan), the plausibility check
// and the line items. The main button saves a readable PDF (+ the files embedded in the invoice, and for
// ZUGFeRD PDFs the XML for bookkeeping). Everything stays in the browser.
import { el, clear } from '../lib/dom.js';
import { ensureCss, tr, ic, btn, userError } from '../lib/sec-ui.js';
import { parseEInvoice, xmlFromPdf, decodeAttachments, profileName, label, PAYMENT_MEANS, isDirectDebit, EInvoiceError } from '../lib/einvoice.js';
import { fmtDate, fmtMoney, fmtNum, unitLabel, docTitle, formatIban, payable, paymentReference, girocodePayload, einvoicePdf } from '../lib/einvoice-pdf.js';
import { encodeQR, drawQR } from '../lib/shared/qr.js';

const cache = new Map(); // input.id → {model, xml, fromPdf} | {error}

function decodeXml(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const enc = (/encoding=["']([\w-]+)["']/i.exec(head) || [])[1] || 'utf-8';
  try { return new TextDecoder(enc.toLowerCase()).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

async function load(input) {
  if (cache.has(input.id)) return cache.get(input.id);
  let res;
  try {
    let xml, fromPdf = false;
    if (input.kind === 'pdf') {
      xml = await xmlFromPdf(await input.pdfjs());
      fromPdf = true;
      if (!xml) throw new EInvoiceError('Diese PDF enthält keine E-Rechnung (keine XML-Daten). Es ist eine normale PDF-Rechnung – öffne sie einfach mit einem PDF-Programm.', 'This PDF contains no e-invoice (no XML data). It is an ordinary PDF invoice – just open it with a PDF viewer.');
    } else {
      const bytes = await input.bytes();
      if (bytes.length > 20 * 1048576) throw new EInvoiceError('Die Datei ist zu groß für eine E-Rechnung.', 'The file is too large for an e-invoice.');
      xml = decodeXml(bytes);
    }
    res = { model: parseEInvoice(xml), xml, fromPdf };
  } catch (err) {
    if (!(err instanceof EInvoiceError)) console.warn(err);
    res = { error: err.userMessage || { de: 'Die Datei konnte nicht gelesen werden.', en: 'The file could not be read.' } };
  }
  cache.set(input.id, res);
  return res;
}

function copyRow(L, labelText, value, copyValue = value) {
  const v = el('span', { class: 'einv-val', dataset: { noI18n: '' } }, value);
  const b = btn('copy', null, async () => {
    try { await navigator.clipboard.writeText(copyValue); b.classList.add('is-done'); setTimeout(() => b.classList.remove('is-done'), 1200); } catch { /* clipboard blocked */ }
  }, { label: tr(L, `${labelText} kopieren`, `Copy ${labelText}`) });
  return el('div', { class: 'einv-row' }, el('span', { class: 'einv-k' }, labelText), v, b);
}

function render(stage, L, res, input) {
  clear(stage);
  if (res.error) {
    stage.append(el('p', { class: 'sec-info is-warn', role: 'alert' }, ic('alert'), tr(L, res.error.de, res.error.en)));
    return;
  }
  const m = res.model;
  const cur = m.currency || 'EUR';
  const M = v => fmtMoney(v, L, cur);
  const T = m.totals;
  const due = T.payable != null ? T.payable : T.gross;
  const card = el('section', { class: 'sec-card einv-card', aria: { label: tr(L, 'Zusammenfassung der Rechnung', 'Invoice summary') } });
  card.append(
    el('h3', { class: 'sec-h' }, ic('form'), `${docTitle(m, L)}${m.number ? ' ' + m.number : ''}`),
    el('p', { class: 'sec-sub' }, `${tr(L, 'von', 'from')} `, el('strong', { dataset: { noI18n: '' } }, (m.seller && m.seller.name) || '—'), ` · ${profileName(m)}${res.fromPdf ? tr(L, ' (aus der PDF gelesen)', ' (read from the PDF)') : ''}`),
  );
  const credit = m.kind === 'credit';
  const amountBox = el('div', { class: 'einv-amount' },
    el('span', { class: 'einv-amount-k' }, credit ? tr(L, 'Gutschrift', 'Credit') : tr(L, 'Zu zahlen', 'Amount due')),
    el('strong', { class: 'einv-amount-v', dataset: { noI18n: '' } }, M(due)));
  if (m.dueDate) {
    const days = Math.round((Date.parse(m.dueDate + 'T00:00:00') - new Date(new Date().toDateString()).getTime()) / 864e5);
    const when = days < 0 ? tr(L, `fällig seit ${-days} ${-days === 1 ? 'Tag' : 'Tagen'} (${fmtDate(m.dueDate, L)})`, `overdue by ${-days} ${-days === 1 ? 'day' : 'days'} (${fmtDate(m.dueDate, L)})`)
      : days === 0 ? tr(L, 'heute fällig', 'due today') : tr(L, `fällig am ${fmtDate(m.dueDate, L)} (in ${days} ${days === 1 ? 'Tag' : 'Tagen'})`, `due on ${fmtDate(m.dueDate, L)} (in ${days} ${days === 1 ? 'day' : 'days'})`);
    amountBox.append(el('span', { class: 'einv-due' + (days < 0 ? ' is-late' : '') }, when));
  } else if (m.issueDate) amountBox.append(el('span', { class: 'einv-due' }, tr(L, `Rechnungsdatum ${fmtDate(m.issueDate, L)}`, `Invoice date ${fmtDate(m.issueDate, L)}`)));
  card.append(amountBox);

  // payment
  const p = m.payment || {};
  const pay = el('div', { class: 'einv-pay' });
  const rows = el('div', { class: 'einv-rows' });
  if (p.meansCode) rows.append(el('div', { class: 'einv-row' }, el('span', { class: 'einv-k' }, tr(L, 'Zahlungsart', 'Method')), el('span', { class: 'einv-val' }, label(PAYMENT_MEANS, p.meansCode, L))));
  if (isDirectDebit(p.meansCode)) {
    rows.append(el('p', { class: 'sec-small' }, tr(L, 'Der Betrag wird per Lastschrift eingezogen – du musst nichts überweisen.', 'The amount will be collected by direct debit – you do not need to transfer anything.')));
  } else {
    const name = p.accountName || (m.payee && m.payee.name) || (m.seller && m.seller.name) || '';
    if (name && p.iban) rows.append(copyRow(L, tr(L, 'Empfänger', 'Payee'), name));
    if (p.iban) rows.append(copyRow(L, 'IBAN', formatIban(p.iban), String(p.iban).replace(/\s+/g, '')));
    if (p.bic) rows.append(copyRow(L, 'BIC', p.bic));
    if (p.iban) rows.append(copyRow(L, tr(L, 'Verwendungszweck', 'Reference'), paymentReference(m, L)));
    if (p.iban && due != null) rows.append(copyRow(L, tr(L, 'Betrag', 'Amount'), M(due), due.toFixed(2)));
  }
  if (p.terms) rows.append(el('p', { class: 'sec-small einv-terms', dataset: { noI18n: '' } }, p.terms));
  pay.append(rows);
  const amt = payable(m);
  if (amt) {
    const qr = encodeQR(girocodePayload({ name: p.accountName || (m.payee && m.payee.name) || (m.seller && m.seller.name), iban: p.iban, bic: p.bic, amount: amt, text: paymentReference(m, L) }), { ecc: 'M' });
    const px = 4, border = 2, c = el('canvas', { class: 'einv-qr', width: (qr.size + border * 2) * px, height: (qr.size + border * 2) * px, role: 'img', aria: { label: tr(L, `GiroCode über ${M(amt)}`, `EPC QR for ${M(amt)}`) } });
    drawQR(c.getContext('2d'), qr, 0, 0, c.width, { border });
    pay.append(el('figure', { class: 'einv-qrbox' }, c, el('figcaption', {}, tr(L, 'Mit der Banking-App scannen – Betrag und IBAN sind schon eingetragen.', 'Scan with your banking app – amount and IBAN are filled in.'))));
  }
  if (rows.childElementCount || amt) card.append(el('h4', { class: 'einv-h4' }, tr(L, 'Bezahlen', 'Payment')), pay);

  // check
  if (m.checks.length) {
    const list = el('ul', { class: 'einv-checks' });
    for (const c of m.checks) list.append(el('li', { class: c.ok ? 'is-ok' : c.level === 'info' ? 'is-info' : 'is-warn' }, ic(c.ok ? 'checkmark' : 'alert'), tr(L, c.de, c.en)));
    const bad = m.checks.filter(c => !c.ok && c.level !== 'info').length;
    card.append(el('h4', { class: 'einv-h4' }, tr(L, 'Prüfung', 'Check')),
      el('p', { class: 'sec-small' }, bad ? tr(L, `${bad} ${bad === 1 ? 'Auffälligkeit' : 'Auffälligkeiten'} gefunden – frag im Zweifel beim Absender nach.`, `${bad} ${bad === 1 ? 'issue' : 'issues'} found – if in doubt, ask the sender.`) : tr(L, 'Summen, Steuer und IBAN sind stimmig.', 'Sums, VAT and IBAN are consistent.')),
      list);
  }

  // line items
  const det = el('details', { class: 'sec-details einv-lines' });
  det.append(el('summary', {}, tr(L, `${m.lines.length} ${m.lines.length === 1 ? 'Position' : 'Positionen'} ansehen`, `View ${m.lines.length} line ${m.lines.length === 1 ? 'item' : 'items'}`)));
  const ol = el('ol', { class: 'einv-items' });
  for (const l of m.lines.slice(0, 200)) {
    ol.append(el('li', {},
      el('span', { class: 'einv-item-n', dataset: { noI18n: '' } }, l.name || l.desc || '—'),
      el('span', { class: 'einv-item-q', dataset: { noI18n: '' } }, `${fmtNum(l.qty, L)} ${unitLabel(l.unitCode, L)}`.trim()),
      el('span', { class: 'einv-item-v', dataset: { noI18n: '' } }, M(l.net))));
  }
  det.append(el('div', { class: 'sec-body' }, ol, m.lines.length > 200 ? el('p', { class: 'sec-small' }, tr(L, 'Alle Positionen stehen in der PDF.', 'All line items are in the PDF.')) : null));
  card.append(det);
  const files = decodeAttachments(m);
  if (files.length) card.append(el('p', { class: 'sec-info' }, ic('pages'), tr(L, `Die Rechnung enthält ${files.length === 1 ? 'einen Anhang' : `${files.length} Anhänge`} (${files.map(f => f.name).join(', ')}). ${files.length === 1 ? 'Er wird' : 'Sie werden'} mit ausgegeben.`, `The invoice contains ${files.length === 1 ? 'an attachment' : `${files.length} attachments`} (${files.map(f => f.name).join(', ')}). ${files.length === 1 ? 'It is' : 'They are'} included in the download.`)));
  if (res.fromPdf) card.append(el('p', { class: 'sec-small' }, tr(L, 'Zusätzlich bekommst du die XML-Datei aus der PDF – die braucht deine Buchhaltung.', 'You also get the XML file from the PDF – that is what your bookkeeping needs.')));
  stage.append(card);
  void input;
}

export default {
  options: [],

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._lang = ctx.lang;
    this.onInputs(state.inputs.filter(i => !i.error && !i.locked));
  },

  async onInputs(inputs) {
    const stage = this._stage;
    if (!stage) return;
    const L = this._lang;
    const input = inputs.find(i => !i.locked);
    if (!input) {
      clear(stage).append(el('p', { class: 'sec-info' }, ic('alert'), tr(L, 'Wähle eine E-Rechnung: eine XRechnung (.xml) oder eine ZUGFeRD-/Factur-X-PDF.', 'Choose an e-invoice: an XRechnung (.xml) or a ZUGFeRD/Factur-X PDF.')));
      return;
    }
    this._key = input.id;
    clear(stage).append(el('p', { class: 'sec-status', role: 'status' }, tr(L, 'Rechnung wird gelesen …', 'Reading the invoice …')));
    const res = await load(input);
    if (this._key !== input.id) return;
    render(stage, L, res, input);
  },

  async run(inputs, opts, ctx) {
    const L = ctx.lang;
    const input = inputs[0];
    if (!input) throw userError('Wähle zuerst eine E-Rechnung aus.', 'Choose an e-invoice first.');
    ctx.progress(0.1, { de: 'Rechnung wird gelesen …', en: 'Reading the invoice …' });
    const res = await load(input);
    if (res.error) throw Object.assign(new Error(res.error.en), { userMessage: res.error });
    await ctx.tick();
    ctx.progress(0.4, { de: 'PDF wird erstellt …', en: 'Creating the PDF …' });
    const { bytes, pages, missing } = await einvoicePdf(res.model, L);
    const base = (res.model.number ? `${docTitle(res.model, L)} ${res.model.number}` : input.name.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]+/g, '-');
    const outputs = [{ name: ctx.fileName(base, L === 'de' ? ' (lesbar)' : ' (readable)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages }];
    for (const f of decodeAttachments(res.model)) outputs.push({ name: ctx.safeFileName(f.name), blob: new Blob([f.bytes], { type: f.mime }), note: f.desc || null });
    if (res.fromPdf) outputs.push({ name: ctx.fileName(base, '', 'xml'), blob: new Blob([res.xml], { type: 'application/xml' }) });
    if (missing.length) ctx.note({ de: `Einige Zeichen (${missing.slice(0, 8).join(' ')}) gibt es in der Schrift nicht – sie stehen als „?“ in der PDF.`, en: `Some characters (${missing.slice(0, 8).join(' ')}) are not in the font – they appear as “?” in the PDF.` });
    return { outputs };
  },
};
