// Tool: withdrawal from a distance contract (online/phone purchase) as a DIN 5008 letter. Goods or service,
// order/receipt dates, order number, items, refund request (incl. original delivery costs), optional account
// for the refund and return label request. German page: wording close to the statutory model form and a
// generic 14-day hint (not legal advice); English page: generic wording without claims about any country's law.
import { el, T, s, form, userError, ensureCss, isoDate, fmtDate, addDays, note } from '../lib/tpl-core.js';
import { letterPdf } from '../lib/tpl-pdf.js';
import { missingWarning } from '../lib/unifont.js';
import { baseModel, senderSection, recipientSection, signatureSection, previewSection, SENDER_FIELDS } from '../lib/tpl-letterui.js';
import { briefVorlage } from '../lib/arc2-brief.js';

ensureCss();

export function buildModel(v, lang) {
  const de = lang === 'de';
  const m = baseModel(v, lang);
  const goods = v.kind !== 'service';
  const items = String(v.items || '').split('\n').map(x => x.trim()).filter(Boolean);
  const order = s(v.orderNo);
  const od = fmtDate(v.orderDate, lang), rd = fmtDate(v.receivedDate, lang);
  const blocks = [];
  if (de) {
    blocks.push(`hiermit widerrufe ich den von mir abgeschlossenen Vertrag über ${goods ? 'den Kauf der folgenden Waren' : 'die Erbringung der folgenden Dienstleistung'}${order ? ` (Bestellnummer ${order})` : ''}:`);
  } else {
    blocks.push(`I hereby give notice that I withdraw from my contract for ${goods ? 'the purchase of the following goods' : 'the provision of the following service'}${order ? ` (order number ${order})` : ''}:`);
  }
  if (items.length) blocks.push(items.map(i => `– ${i}`).join('\n'));
  const dates = [od ? (de ? `Bestellt am: ${od}` : `Ordered on: ${od}`) : '', goods && rd ? (de ? `Erhalten am: ${rd}` : `Received on: ${rd}`) : ''].filter(Boolean);
  if (dates.length) blocks.push(dates.join('\n'));
  if (v.refund !== false) {
    const acct = s(v.iban);
    blocks.push(de ? `Bitte erstatten Sie mir alle geleisteten Zahlungen einschließlich der Kosten der ursprünglichen Lieferung ${acct ? `auf das Konto IBAN ${acct}${s(v.holder) ? ` (Kontoinhaber: ${s(v.holder)})` : ''}` : 'über das Zahlungsmittel, das ich bei der Bestellung verwendet habe'}.`
      : `Please refund all payments I have made, including the original delivery costs, ${acct ? `to the account ${acct}${s(v.holder) ? ` (account holder: ${s(v.holder)})` : ''}` : 'using the same payment method I used for the order'}.`);
  }
  if (goods && v.label) blocks.push(de ? 'Bitte senden Sie mir für die Rücksendung ein Retourenetikett bzw. teilen Sie mir mit, wohin ich die Ware zurückschicken soll.' : 'Please send me a returns label or tell me where to return the goods.');
  if (goods && v.sent) blocks.push(de ? `Die Ware habe ich ${v.sentDate ? `am ${fmtDate(v.sentDate, lang)} ` : ''}an Sie zurückgeschickt${s(v.tracking) ? ` (Sendungsnummer ${s(v.tracking)})` : ''}.` : `I sent the goods back to you${v.sentDate ? ` on ${fmtDate(v.sentDate, lang)}` : ''}${s(v.tracking) ? ` (tracking number ${s(v.tracking)})` : ''}.`);
  if (v.confirm !== false) blocks.push(de ? 'Bitte bestätigen Sie mir den Eingang dieses Widerrufs.' : 'Please confirm that you have received this notice of withdrawal.');
  return {
    ...m, form: 'B', notices: [],
    info: [[de ? 'Bestellnummer' : 'Order number', order], [de ? 'Kundennummer' : 'Customer number', s(v.customerNo)]],
    subject: de ? `Widerruf meiner Bestellung${order ? ` ${order}` : ''}` : `Withdrawal from my order${order ? ` ${order}` : ''}`,
    salutation: de ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,', blocks, closing: de ? 'Mit freundlichen Grüßen' : 'Yours faithfully,',
  };
}

/** Generic deadline helper: 14 days after receipt (goods) or the contract date (services). */
export function deadline(v) {
  const start = v.kind === 'service' ? v.orderDate : v.receivedDate;
  return start ? addDays(start, 14) : '';
}

let api = null;
const REQ = v => [{ ok: !!s(v.sName), de: 'deinen Namen', en: 'your name' }, { ok: !!s(v.rName), de: 'den Händler', en: 'the seller' }, { ok: !!(s(v.items) || s(v.orderNo)), de: 'Bestellnummer oder Artikel', en: 'order number or items' }];

export default {
  labels: { back_to_files: { de: 'Zurück zum Widerruf', en: 'Back to the letter' } },
  options: [],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); briefVorlage('withdrawal-letter', 'wd', stage, state, ctx, () => { api = stageFn(stage, state, ctx); }); },
  status(values) {
    const v = values.wd || {};
    const miss = REQ(v).filter(r => !r.ok);
    const summary = { de: 'Widerruf', en: 'Withdrawal letter' };
    return miss.length ? { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } } : { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.wd || {};
    if (REQ(v).some(r => !r.ok)) throw userError('Bitte gib deinen Namen, den Händler und die Bestellnummer oder die Artikel an.', 'Please enter your name, the seller and the order number or the items.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const m = buildModel(v, ctx.lang);
    const { bytes, missing, pages } = await letterPdf({ ...m, sig: await api?.sig() }, { lang: ctx.lang });
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    ctx.note({ de: 'Tipp: Schick den Widerruf so, dass du den rechtzeitigen Zugang beweisen kannst – etwa per E-Mail mit dem PDF im Anhang oder per Einschreiben. Eine kommentarlose Rücksendung der Ware reicht in der Regel nicht.', en: 'Tip: send the letter in a way you can prove, e.g. by e-mail with the PDF attached or by recorded delivery.' });
    const name = ctx.safeFileName(`${ctx.t({ de: 'Widerruf', en: 'Withdrawal' })}${v.orderNo ? ' ' + s(v.orderNo) : ''}${v.rName ? ' – ' + s(v.rName) : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: m.subject }] };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.wd ||= { kind: 'goods', refund: true, confirm: true, label: false, sent: false, letterDate: isoDate(), orderDate: '', receivedDate: '' });
  let rem = null, pvs = null;
  const dl = el('div', {});
  const sentBox = el('div', {});
  const changed = key => {
    if (rem && SENDER_FIELDS.includes(key)) rem.save();
    state.results.clear(); ctx.refresh(); pvs?.refresh(); renderDeadline();
    if (key === 'kind' || key === 'sent') renderSent();
  };
  const f = form(v, lang, changed);
  function renderDeadline() {
    const d = deadline(v);
    const today = isoDate();
    const late = d && d < today;
    dl.replaceChildren(note(lang, de
      ? `${d ? `Bei einer Frist von 14 Tagen ab ${v.kind === 'service' ? 'Vertragsschluss' : 'Erhalt der Ware'} wäre der letzte Tag der ${fmtDate(d, 'de')}${late ? ' – dieser Tag liegt schon zurück. Prüf trotzdem deine Unterlagen: Wurdest du nicht oder falsch über dein Widerrufsrecht belehrt, kann die Frist länger sein.' : '.'} ` : ''}Bei Online- und Telefonkäufen hast du als Verbraucher meist 14 Tage Widerrufsrecht. Maßgeblich sind die Widerrufsbelehrung des Händlers und die aktuelle Rechtslage – das ist keine Rechtsberatung. Es genügt, den Widerruf rechtzeitig abzuschicken.`
      : `${d ? `If a 14-day period applies from ${v.kind === 'service' ? 'the contract date' : 'receipt of the goods'}, the last day would be ${fmtDate(d, 'en')}${late ? ' – that day has already passed.' : '.'} ` : ''}In many countries consumers can withdraw from online or phone purchases within a period such as 14 days. Check the seller’s terms and the law where you live – this is not legal advice.`, late ? 'tpl-warn' : ''));
  }
  function renderSent() {
    sentBox.replaceChildren(...(v.kind !== 'service' ? [f.check('label', { de: 'Um ein Retourenetikett bitten', en: 'Ask for a returns label' }, { id: 'tpl-label' }),
      f.check('sent', { de: 'Ware bereits zurückgeschickt', en: 'Goods already sent back' }, { id: 'tpl-sent' }),
      v.sent ? f.grid(f.field('sentDate', { de: 'Verschickt am', en: 'Sent on' }, { type: 'date', id: 'tpl-sentDate' }), f.field('tracking', { de: 'Sendungsnummer (optional)', en: 'Tracking number (optional)' }, { id: 'tpl-tracking' })) : ''] : []));
  }
  const sender = senderSection(f, v, lang); rem = sender.rem;
  const sig = signatureSection(f, lang, () => changed('sig'), { title: { de: 'Unterschrift (nur bei Brief auf Papier nötig)', en: 'Signature (only needed on paper)' } });
  const recvField = el('div', {});
  pvs = previewSection(f, lang, () => buildModel(v, lang), () => sig.pad.export());
  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-what', { de: 'Was widerrufst du?', en: 'What are you withdrawing from?' },
      f.seg('kind', { de: 'Vertrag über', en: 'Contract for' }, [{ value: 'goods', label: { de: 'Waren', en: 'Goods' } }, { value: 'service', label: { de: 'Dienstleistung', en: 'A service' } }], { onChange: () => { recvField.hidden = v.kind === 'service'; } }),
      f.grid(f.field('orderNo', { de: 'Bestellnummer', en: 'Order number' }), f.field('customerNo', { de: 'Kundennummer (optional)', en: 'Customer number (optional)' }),
        f.field('orderDate', { de: 'Bestellt am', en: 'Ordered on' }, { type: 'date' }), recvField),
      f.area('items', { de: 'Waren / Dienstleistung (eine pro Zeile)', en: 'Goods / service (one per line)' }, { rows: 3, placeholder: { de: 'z. B. Winterjacke, Größe M, Art.-Nr. 12345', en: 'e.g. winter jacket, size M, item no. 12345' } }),
      dl),
    recipientSection(f, lang, { title: { de: 'Händler', en: 'Seller' }, nameLabel: { de: 'Firma', en: 'Company' } }),
    f.sec('tpl-h-refund', { de: 'Rückzahlung und Rücksendung', en: 'Refund and return' },
      f.check('refund', { de: 'Um Rückzahlung bitten (inkl. Hinsendekosten)', en: 'Ask for a refund (incl. original delivery costs)' }),
      f.grid(f.field('iban', { de: 'IBAN für die Erstattung (optional)', en: 'Account for the refund (optional)' }, { hint: { de: 'Leer lassen: Erstattung über das ursprüngliche Zahlungsmittel.', en: 'Leave empty to be refunded via the original payment method.' } }),
        f.field('holder', { de: 'Kontoinhaber (optional)', en: 'Account holder (optional)' })),
      sentBox, f.check('confirm', { de: 'Um Eingangsbestätigung bitten', en: 'Ask for confirmation of receipt' })),
    sender.sec, sig.sec), el('div', { class: 'tpl-side' }, pvs.sec)));
  recvField.append(f.field('receivedDate', { de: 'Erhalten am', en: 'Received on' }, { type: 'date' }));
  recvField.hidden = v.kind === 'service';
  renderDeadline(); renderSent();
  pvs.refresh();
  ctx.refresh();
  return { sig: () => sig.pad.export() };
}
