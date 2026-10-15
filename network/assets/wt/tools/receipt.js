// Tool: receipt (Quittung). Amount in digits and words (German/English number words, lib/tpl-words.js),
// optional VAT included with net/tax split or as a small-amount invoice (Kleinbetragsrechnung, total incl. tax
// and rate, German page), small-business note, payment method, payer/receiver, receipt number, finger signature,
// 1/2/3 receipts per A4 page (original + copies, cut marks). Empty fields print as lines to fill in by hand,
// so blank receipt forms work too.
import { el, T, s, form, ensureCss, isoDate, fmtDate, parseNum, money, note, remember, signaturePad, pdfPreview } from '../lib/tpl-core.js';
import { createWriter, collectText, mm, drawSig } from '../lib/tpl-pdf.js';
import { amountWords } from '../lib/tpl-words.js';
import { missingWarning } from '../lib/unifont.js';

ensureCss();

const PAY = { cash: { de: 'bar', en: 'cash' }, transfer: { de: 'per Überweisung', en: 'bank transfer' }, card: { de: 'per Karte', en: 'card' }, other: { de: 'sonstige', en: 'other' } };

/** Numbers of a receipt: gross/net/tax cents (null amount = blank form). */
export function receiptNumbers(v, lang) {
  const g = parseNum(v.amount, lang);
  if (!Number.isFinite(g) || g <= 0) return null;
  const gross = Math.round(g * 100);
  const rate = v.vat === 'incl' ? Math.max(0, parseNum(v.rate === 'custom' ? v.rateCustom : v.rate, lang) || 0) : 0;
  const net = rate ? Math.round(gross / (1 + rate / 100)) : gross;
  return { gross, net, tax: gross - net, rate };
}

export function buildReceipt(v, lang) {
  const de = lang === 'de';
  const cur = de ? 'EUR' : v.currency || 'EUR';
  const n = receiptNumbers(v, lang);
  const pct = r => new Intl.NumberFormat(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 2 }).format(r);
  let vatLine = '';
  if (n && n.rate) {
    vatLine = de && v.small ? `Gesamtbetrag ${money(n.gross, lang, cur)} inkl. ${pct(n.rate)} % USt.`
      : de ? `Nettobetrag ${money(n.net, lang, cur)} + ${pct(n.rate)} % MwSt. ${money(n.tax, lang, cur)} = Gesamtbetrag ${money(n.gross, lang, cur)}`
        : `Net ${money(n.net, lang, cur)} + ${pct(n.rate)} % ${s(v.taxLabel) || 'VAT'} ${money(n.tax, lang, cur)} = total ${money(n.gross, lang, cur)}`;
  }
  const ku = de && v.ku && !(n && n.rate) ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : '';
  return {
    lang, number: s(v.number),
    amount: n ? money(n.gross, lang, cur) : '', words: n ? amountWords(n.gross, lang, cur) : '',
    vatLine, ku,
    payer: [s(v.payer), s(v.payerAddr)].filter(Boolean).join(', '), purpose: s(v.purpose), pay: v.pay && PAY[v.pay] ? (v.pay === 'other' && s(v.payOther) ? s(v.payOther) : T(lang, PAY[v.pay])) : '',
    receiver: [s(v.receiver), s(v.receiverAddr)].filter(Boolean).join(', '), taxNo: s(v.taxNo),
    place: s(v.place), date: v.date ? fmtDate(v.date, lang) : '',
    perPage: [1, 2, 3].includes(+v.perPage) ? +v.perPage : 1, markCopy: v.markCopy !== false,
  };
}

async function makePdf(r, sig, lang) {
  const de = lang === 'de';
  const w = await createWriter({ text: collectText(r).join('\n') + ' Quittung Receipt Durchschrift', lang, margins: { l: 15, r: 15, t: 0, b: 0 } });
  w.newPage();
  const N = r.perPage;
  const slot = w.H / N;                       // pt
  const k = N === 3 ? 0.86 : 1;               // compact type on three per page
  const X = mm(15), RX = w.W - mm(15), WD = RX - X;
  const label = (t, x, y) => w.line(t, x, y, { size: 7.5 * k, color: w.GREY });
  const value = (t, x, y, width, size = 11 * k, f = w.font) => {
    if (t) return w.line(t, x, y, { size, font: f, maxWidth: width });
    w.page.drawLine({ start: { x, y: y - 2 }, end: { x: x + width, y: y - 2 }, thickness: 0.5, color: w.LINE });
    return 0;
  };
  for (let i = 0; i < N; i++) {
    const top = w.H - i * slot - mm(N === 1 ? 15 : 9);
    const bottom = N === 1 ? w.H - mm(15) - mm(150) : w.H - (i + 1) * slot + mm(9);
    const h = top - bottom;
    // frame
    w.page.drawRectangle({ x: X, y: bottom, width: WD, height: h, borderColor: w.rgb(0.55, 0.57, 0.63), borderWidth: 0.8 });
    const P = mm(6);
    let y = top - P - 14 * k;
    w.line(de ? 'Quittung' : 'Receipt', X + P, y, { size: 17 * k, font: w.bold });
    const tag = N > 1 && r.markCopy ? (i === 0 ? 'Original' : (de ? 'Durchschrift' : 'Copy')) : '';
    w.line([r.number ? `${de ? 'Nr.' : 'No.'} ${r.number}` : '', tag].filter(Boolean).join(' · '), RX - P, y, { size: 9.5 * k, color: w.GREY, align: 'right' });
    // amount box
    y -= 14 * k + 8;
    const bw = mm(62), bh = 30 * k;
    w.page.drawRectangle({ x: RX - P - bw, y: y - bh + 10 * k, width: bw, height: bh, color: w.rgb(0.95, 0.96, 0.98), borderColor: w.LINE, borderWidth: 0.6 });
    label(de ? 'Betrag' : 'Amount', RX - P - bw + 6, y + 10 * k - 9 * k);
    value(r.amount, RX - P - bw + 6, y - bh + 10 * k + 7 * k, bw - 12, 15 * k, w.bold);
    label(de ? 'Empfangen von' : 'Received from', X + P, y);
    value(r.payer, X + P, y - 13 * k, WD - bw - P * 3);
    y -= bh + 4 * k;
    const LW = WD - P * 2;
    const rowH = (N === 3 ? 21 : 25) * k;
    label(de ? 'Betrag in Worten' : 'Amount in words', X + P, y); value(r.words, X + P, y - 13 * k, LW, 10.5 * k, w.italic); y -= rowH;
    label(de ? 'für' : 'For', X + P, y); value(r.purpose, X + P, y - 13 * k, LW); y -= rowH;
    if (r.vatLine || r.ku) { y -= 7 * k; w.line(r.vatLine || r.ku, X + P, y, { size: 9 * k, maxWidth: LW }); y -= 16 * k; }
    label(de ? 'Zahlungsart' : 'Payment method', X + P, y);
    label(de ? 'Empfänger' : 'Received by', X + P + LW * 0.36, y);
    value(r.pay, X + P, y - 13 * k, LW * 0.32);
    value([r.receiver, r.taxNo ? `${de ? 'St.-Nr.' : 'Tax no.'} ${r.taxNo}` : ''].filter(Boolean).join(' · '), X + P + LW * 0.36, y - 13 * k, LW * 0.64);
    y -= rowH;
    w.line(de ? 'Betrag dankend erhalten.' : 'Received with thanks.', X + P, y - 4, { size: 10 * k });
    // place/date + signature at the bottom of the frame
    const sy = bottom + P + 10 * k;
    label(de ? 'Ort, Datum' : 'Place, date', X + P, sy - 10 * k);
    value([r.place, r.date].filter(Boolean).join(', '), X + P, sy + 2, LW * 0.4);
    const sx = X + P + LW * 0.5, sw = LW * 0.5;
    w.page.drawLine({ start: { x: sx, y: sy }, end: { x: sx + sw, y: sy }, thickness: 0.6, color: w.INK });
    label(de ? 'Unterschrift / Stempel des Empfängers' : 'Signature / stamp of the recipient', sx, sy - 10 * k);
    if (sig) await drawSig(w, sig, sx + 4, sy + 1, Math.min(sw - 8, mm(60)), Math.min(mm(14), y - sy - 14));
    // cut line between receipts
    if (N > 1 && i < N - 1) {
      const cy = w.H - (i + 1) * slot;
      for (let x = mm(6); x < w.W - mm(6); x += 8) w.page.drawLine({ start: { x, y: cy }, end: { x: Math.min(x + 4, w.W - mm(6)), y: cy }, thickness: 0.5, color: w.LINE });
    }
  }
  return w.finish({ title: `${de ? 'Quittung' : 'Receipt'}${r.number ? ' ' + r.number : ''}` });
}

let api = null;

export default {
  labels: { back_to_files: { de: 'Zurück zur Quittung', en: 'Back to the receipt' } },
  options: [],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); },
  status(values, inputs, lang) {
    const v = values.rc || {};
    const n = receiptNumbers(v, lang);
    return { summary: n ? { de: `Quittung · ${money(n.gross, 'de')}`, en: `Receipt · ${money(n.gross, 'en', v.currency || 'EUR')}` } : { de: 'Quittung (Betrag leer – zum Ausfüllen von Hand)', en: 'Receipt (no amount – to fill in by hand)' } };
  },
  async run(inputs, opts, ctx) {
    const v = opts.rc || {};
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const r = buildReceipt(v, ctx.lang);
    const { bytes, missing, pages } = await makePdf(r, await api?.sig(), ctx.lang);
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    if (!r.amount) ctx.note({ de: 'Ohne Betrag erstellt: Die leeren Felder kannst du von Hand ausfüllen.', en: 'Created without an amount: fill in the empty fields by hand.' });
    const name = ctx.safeFileName(`${ctx.t({ de: 'Quittung', en: 'Receipt' })}${r.number ? ' ' + r.number : ''}${s(v.payer) ? ' – ' + s(v.payer) : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: r.amount ? `${r.amount} – ${r.words}` : null }] };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.rc ||= { amount: '', vat: 'none', rate: de ? '19' : '20', pay: 'cash', perPage: '1', markCopy: true, date: isoDate(), currency: 'EUR', small: false, ku: false, taxLabel: 'VAT' });
  const rem = remember({ key: 'fale-wt-receipt-receiver', fields: ['receiver', 'receiverAddr', 'taxNo', 'place'], v, lang, label: { de: 'Empfänger-Angaben (dich) auf diesem Gerät merken', en: 'Remember the recipient (you) on this device' } });
  const pv = pdfPreview(lang);
  const pad = signaturePad(lang, () => changed('sig'));
  const words = el('p', { class: 'tpl-words', aria: { live: 'polite' } });
  const vatBox = el('div', {});
  const payBox = el('div', {});
  const changed = key => {
    if (rem.fields.includes(key)) rem.save();
    if (['vat', 'rate', 'amount', 'small', 'ku'].includes(key)) renderVat();
    if (key === 'pay') renderPay();
    const r = buildReceipt(v, lang);
    words.textContent = r.words ? `${T(lang, { de: 'In Worten', en: 'In words' })}: ${r.words}` : '';
    state.results.clear(); ctx.refresh();
    pv.schedule(async () => (await makePdf(r, await pad.export(), lang)).bytes);
  };
  const f = form(v, lang, changed);
  function renderVat() {
    const kids = [];
    if (v.vat === 'incl') {
      kids.push(f.grid(f.select('rate', { de: 'Steuersatz', en: 'Tax rate' }, de ? [{ value: '19', label: '19 %' }, { value: '7', label: '7 %' }, { value: 'custom', label: 'Anderer …' }] : [{ value: '20', label: '20 %' }, { value: '5', label: '5 %' }, { value: 'custom', label: 'Other …' }], { id: 'tpl-rate' }),
        v.rate === 'custom' ? f.field('rateCustom', { de: 'Steuersatz in %', en: 'Tax rate in %' }, { id: 'tpl-rateCustom', inputmode: 'decimal' }) : de ? '' : f.field('taxLabel', 'Tax name', { id: 'tpl-taxLabel' })));
      const n = receiptNumbers(v, lang);
      if (de) {
        kids.push(f.check('small', 'Als Kleinbetragsrechnung (bis 250 € brutto): nur Gesamtbetrag und Steuersatz', { id: 'tpl-small' }));
        if (v.small && n && n.gross > 25000) kids.push(note('de', 'Über 250 € brutto ist keine Kleinbetragsrechnung möglich – dann braucht es eine vollständige Rechnung mit Steuernummer, Rechnungsnummer und getrennt ausgewiesener Steuer.', 'tpl-warn'));
        else if (v.small) kids.push(note('de', 'Eine Kleinbetragsrechnung braucht: deinen vollständigen Namen und deine Anschrift als leistendes Unternehmen, das Ausstellungsdatum, Menge und Art der Leistung („für“), den Gesamtbetrag und den Steuersatz.'));
      }
    } else if (de) kids.push(f.check('ku', 'Kleinunternehmer: Hinweis „keine Umsatzsteuer nach § 19 UStG“ drucken', { id: 'tpl-ku' }));
    vatBox.replaceChildren(...kids);
  }
  function renderPay() { payBox.replaceChildren(v.pay === 'other' ? f.field('payOther', { de: 'Zahlungsart', en: 'Payment method' }, { id: 'tpl-payOther' }) : ''); }
  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-amount', { de: 'Betrag', en: 'Amount' },
      f.grid(f.field('amount', { de: 'Betrag (brutto)', en: 'Amount (total)' }, { inputmode: 'decimal', placeholder: de ? '123,45' : '123.45', hint: { de: 'Leer lassen für eine Blanko-Quittung zum Ausfüllen von Hand.', en: 'Leave empty for a blank receipt to fill in by hand.' } }),
        f.field('number', { de: 'Quittungsnummer (optional)', en: 'Receipt number (optional)' }), de ? '' : f.select('currency', 'Currency', ['EUR', 'GBP', 'USD', 'CHF'].map(c => ({ value: c, label: c })))),
      words,
      f.seg('vat', { de: 'Umsatzsteuer', en: 'Tax' }, [{ value: 'none', label: { de: 'Ohne Ausweis', en: 'Not shown' } }, { value: 'incl', label: { de: 'Inkl. MwSt. ausweisen', en: 'Tax included' } }]),
      vatBox),
    f.sec('tpl-h-what', { de: 'Wofür und von wem?', en: 'What for and from whom?' }, f.grid(
      f.field('purpose', { de: 'Für (Leistung / Ware)', en: 'For (goods / service)' }, { wide: true, placeholder: { de: 'z. B. Nachhilfe im Oktober, 4 Stunden', en: 'e.g. tutoring in October, 4 hours' } }),
      f.field('payer', { de: 'Empfangen von (Name)', en: 'Received from (name)' }), f.field('payerAddr', { de: 'Anschrift des Zahlers (optional)', en: 'Payer’s address (optional)' }),
      f.select('pay', { de: 'Zahlungsart', en: 'Payment method' }, Object.entries(PAY).map(([k, p]) => ({ value: k, label: p }))), payBox)),
    f.sec('tpl-h-recv', { de: 'Empfänger (du)', en: 'Recipient (you)' }, f.grid(
      f.field('receiver', { de: 'Name / Firma', en: 'Name / company' }, { autocomplete: 'name' }), f.field('receiverAddr', { de: 'Anschrift', en: 'Address' }),
      de ? f.field('taxNo', 'Steuernummer (optional)') : '', f.field('place', { de: 'Ort', en: 'Place' }), f.field('date', { de: 'Datum', en: 'Date' }, { type: 'date' })), rem.box,
      el('p', { class: 'img-muted' }, T(lang, { de: 'Unterschrift (optional) – oder auf dem Ausdruck unterschreiben:', en: 'Signature (optional) – or sign the printout:' })), pad.root),
    f.sec('tpl-h-layout', { de: 'Druck', en: 'Printing' },
      f.seg('perPage', { de: 'Quittungen pro A4-Seite', en: 'Receipts per A4 page' }, [{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]),
      f.check('markCopy', { de: 'Erste als „Original“, weitere als „Durchschrift“ kennzeichnen', en: 'Mark the first as “Original”, the others as “Copy”' }))),
  el('div', { class: 'tpl-side' }, f.sec('tpl-h-pv', { de: 'Vorschau', en: 'Preview' }, pv.root))));
  renderVat(); renderPay();
  changed('init');
  return { sig: () => pad.export() };
}
