// Tool: payment reminder / dunning letter (Zahlungserinnerung, 1./2./letzte Mahnung) as a DIN 5008 letter.
// Open invoices table (partial payments), late-payment interest (German page: base rate user-editable with
// dated "please check" note, + 5 / + 9 points for consumers / businesses, 40 € flat fee for businesses;
// English page: one annual rate and an optional fee typed by the user), reminder fee, new deadline, tone
// presets, bank details. Not legal advice – said in the UI and the FAQ.
import { el, T, s, form, userError, ensureCss, isoDate, fmtDate, addDays, parseNum, money, note, entryList } from '../lib/tpl-core.js';
import { letterPdf } from '../lib/tpl-pdf.js';
import { reminderTotals, lateRate, BASE_RATE } from '../lib/tpl-interest.js';
import { missingWarning } from '../lib/unifont.js';
import { formatIban } from '../lib/new-invoice.js';
import { baseModel, senderSection, recipientSection, signatureSection, previewSection, SENDER_FIELDS } from '../lib/tpl-letterui.js';

ensureCss();

const LEVELS = {
  reminder: { de: 'Zahlungserinnerung', en: 'Payment reminder', days: 10 },
  m1: { de: '1. Mahnung', en: 'First reminder', days: 10 },
  m2: { de: '2. Mahnung', en: 'Second reminder', days: 7 },
  final: { de: 'Letzte Mahnung', en: 'Final notice', days: 7 },
};
const cents = (x, lang) => { const n = parseNum(x, lang); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

/** Numbers of the reminder (cents). */
export function totals(v, lang) {
  const de = lang === 'de';
  const inv = (v.invoices || []).map(r => ({ ...r, cents: cents(r.amount, lang), paidCents: cents(r.paid, lang) })).filter(r => r.cents > 0);
  const rate = de ? lateRate(parseNum(v.baseRate, lang), v.b2b) : Math.max(0, parseNum(v.rate, lang) || 0);
  return reminderTotals(inv, { interest: !!v.interest && rate > 0, rate, until: v.until || v.letterDate || isoDate(), flatFee: de && v.b2b && v.flat ? 4000 : 0, fee: cents(v.fee, lang) + (!de ? cents(v.enFlat, lang) : 0) });
}

const INTRO = {
  de: {
    reminder: { friendly: 'sicher ist es Ihrer Aufmerksamkeit entgangen: Für die folgende Rechnung konnten wir bis heute keinen Zahlungseingang feststellen.', neutral: 'bei der Durchsicht unserer Buchhaltung haben wir festgestellt, dass die folgende Rechnung noch nicht beglichen ist.', firm: 'die folgende Rechnung ist fällig und bis heute nicht beglichen.' },
    m1: { friendly: 'leider konnten wir für die folgende Rechnung trotz Fälligkeit noch keinen Zahlungseingang feststellen.', neutral: 'trotz Fälligkeit ist die folgende Rechnung noch nicht beglichen.', firm: 'Sie befinden sich mit der Zahlung der folgenden Rechnung im Rückstand.' },
    m2: { friendly: 'auf unser letztes Schreiben haben wir leider noch keine Zahlung erhalten. Folgender Betrag ist weiterhin offen:', neutral: 'auf unsere bisherigen Schreiben haben Sie nicht reagiert. Folgender Betrag ist weiterhin offen:', firm: 'trotz unserer Mahnung ist folgender Betrag weiterhin offen:' },
    final: { friendly: 'trotz mehrfacher Erinnerung ist folgender Betrag weiterhin offen. Mit diesem Schreiben mahnen wir Sie letztmalig.', neutral: 'trotz mehrfacher Erinnerung ist folgender Betrag weiterhin offen. Dies ist unsere letzte Mahnung.', firm: 'trotz mehrfacher Mahnung haben Sie den folgenden Betrag nicht bezahlt. Dies ist unsere letzte Mahnung.' },
  },
  en: {
    reminder: { friendly: 'This may simply have slipped through: we have not yet received payment for the following invoice.', neutral: 'According to our records, the following invoice has not yet been paid.', firm: 'The following invoice is due and has not been paid.' },
    m1: { friendly: 'Unfortunately we have not yet received payment for the following invoice, although it is due.', neutral: 'Although it is due, the following invoice has not been paid.', firm: 'Payment of the following invoice is overdue.' },
    m2: { friendly: 'We have not yet received payment following our last letter. The following amount is still outstanding:', neutral: 'You have not responded to our previous letters. The following amount is still outstanding:', firm: 'Despite our reminder, the following amount is still outstanding:' },
    final: { friendly: 'Despite several reminders, the following amount is still outstanding. This is our final reminder.', neutral: 'Despite several reminders, the following amount is still outstanding. This is our final notice.', firm: 'Despite several reminders, you have not paid the following amount. This is our final notice.' },
  },
};

const PLURAL = {
  de: {
    reminder: { friendly: 'sicher ist es Ihrer Aufmerksamkeit entgangen: Für die folgenden Rechnungen konnten wir bis heute keinen Zahlungseingang feststellen.', neutral: 'bei der Durchsicht unserer Buchhaltung haben wir festgestellt, dass die folgenden Rechnungen noch nicht beglichen sind.', firm: 'die folgenden Rechnungen sind fällig und bis heute nicht beglichen.' },
    m1: { friendly: 'leider konnten wir für die folgenden Rechnungen trotz Fälligkeit noch keinen Zahlungseingang feststellen.', neutral: 'trotz Fälligkeit sind die folgenden Rechnungen noch nicht beglichen.', firm: 'Sie befinden sich mit der Zahlung der folgenden Rechnungen im Rückstand.' },
  },
  en: {
    reminder: { friendly: 'This may simply have slipped through: we have not yet received payment for the following invoices.', neutral: 'According to our records, the following invoices have not yet been paid.', firm: 'The following invoices are due and have not been paid.' },
    m1: { friendly: 'Unfortunately we have not yet received payment for the following invoices, although they are due.', neutral: 'Although they are due, the following invoices have not been paid.', firm: 'Payment of the following invoices is overdue.' },
  },
};

export function buildModel(v, lang) {
  const de = lang === 'de';
  const cur = de ? 'EUR' : v.currency || 'EUR';
  const M = c => money(c, lang, cur);
  const t = totals(v, lang);
  const lv = LEVELS[v.level] || LEVELS.reminder;
  const tone = ['friendly', 'neutral', 'firm'].includes(v.tone) ? v.tone : 'neutral';
  const base = baseModel(v, lang);
  const nos = t.rows.map(r => s(r.no)).filter(Boolean);
  const blocks = [];
  let intro = INTRO[de ? 'de' : 'en'][v.level in LEVELS ? v.level : 'reminder'][tone];
  if (t.rows.length > 1) intro = (PLURAL[de ? 'de' : 'en'][v.level] || {})[tone] || intro;
  blocks.push(intro);
  const head = de ? ['Rechnung', 'Datum', 'Fällig am', 'Betrag', 'Bereits bezahlt', 'Offen'] : ['Invoice', 'Date', 'Due', 'Amount', 'Paid', 'Outstanding'];
  const anyPaid = t.rows.some(r => r.paidCents > 0);
  const cols = [{ label: head[0], w: 1.3 }, { label: head[1], w: 1.1 }, { label: head[2], w: 1.1 }, { label: head[3], w: 1.1, align: 'right' }, ...(anyPaid ? [{ label: head[4], w: 1.1, align: 'right' }] : []), { label: head[5], w: 1.1, align: 'right' }];
  const rows = t.rows.map(r => [s(r.no), fmtDate(r.date, lang), fmtDate(r.due, lang), M(r.cents), ...(anyPaid ? [M(r.paidCents)] : []), M(r.open)]);
  const pad = Array(cols.length - 2).fill('');
  const foot = [];
  const line = (label, c) => foot.push([label, ...pad, M(c)]);
  if (t.interest || t.flat || t.fee) line(de ? 'Offene Rechnungsbeträge' : 'Outstanding invoices', t.open);
  if (t.interest) line(de ? 'Verzugszinsen' : 'Late-payment interest', t.interest);
  if (t.flat) line(de ? 'Verzugspauschale' : 'Flat-rate compensation', t.flat);
  if (t.fee) line(de ? 'Mahnkosten' : 'Fees', t.fee);
  line(de ? 'Gesamtbetrag' : 'Total due', t.total);
  blocks.push({ table: { cols, rows, foot } });
  if (t.interest) {
    const until = fmtDate(v.until || v.letterDate || isoDate(), lang);
    if (de) {
      const baseR = parseNum(v.baseRate, lang);
      blocks.push(`Die Verzugszinsen betragen ${v.b2b ? 'neun' : 'fünf'} Prozentpunkte über dem Basiszinssatz von ${fmtPct(baseR, lang)} %, also ${fmtPct(lateRate(baseR, v.b2b), lang)} % pro Jahr, jeweils ab dem Tag nach Fälligkeit bis zum ${until} (§ 288 BGB).${t.flat ? ' Außerdem berechnen wir die Verzugspauschale von 40 € je Rechnung (§ 288 Abs. 5 BGB).' : ''}`);
    } else blocks.push(`Interest of ${fmtPct(parseNum(v.rate, lang), lang)} % per year is charged from the day after the due date until ${until}.`);
  } else if (t.flat) blocks.push('Außerdem berechnen wir die Verzugspauschale von 40 € je Rechnung (§ 288 Abs. 5 BGB).');
  const dl = fmtDate(v.deadline, lang);
  blocks.push(de ? `Bitte überweisen Sie den Gesamtbetrag von ${M(t.total)} ${dl ? `bis spätestens ${dl}` : 'umgehend'} auf das unten genannte Konto${nos.length ? ` und geben Sie als Verwendungszweck ${nos.length === 1 ? 'die Rechnungsnummer' : 'die Rechnungsnummern'} ${nos.join(', ')} an` : ''}.`
    : `Please transfer the total of ${M(t.total)} ${dl ? `by ${dl}` : 'without delay'} to the account below${nos.length ? `, quoting ${nos.length === 1 ? 'invoice number' : 'invoice numbers'} ${nos.join(', ')}` : ''}.`);
  if (v.level === 'final') blocks.push(de ? 'Sollte der Betrag bis zu diesem Datum nicht bei uns eingegangen sein, werden wir ohne weitere Ankündigung weitere Schritte einleiten, etwa ein gerichtliches Mahnverfahren oder die Beauftragung eines Inkassounternehmens. Die dadurch entstehenden Kosten können Ihnen zusätzlich in Rechnung gestellt werden.'
    : 'If we have not received the amount by this date, we will take further steps without further notice, such as legal proceedings or passing the claim to a debt collection agency. Any resulting costs may be charged to you.');
  else if (v.level === 'm2' || tone === 'firm') blocks.push(de ? 'Sollte die Zahlung ausbleiben, behalten wir uns weitere Schritte vor.' : 'If payment is not made, we reserve the right to take further steps.');
  if (v.level !== 'final') blocks.push(de ? 'Sollten Sie die Zahlung in den letzten Tagen bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.' : 'If you have already paid in the last few days, please disregard this letter.');
  if (tone === 'friendly' && v.level !== 'final') blocks.push(de ? 'Bei Fragen zur Rechnung melden Sie sich gern bei uns.' : 'If you have any questions about the invoice, please get in touch.');
  const bank = [[de ? 'Kontoinhaber' : 'Account holder', s(v.holder) || s(v.sName)], ['IBAN', s(v.iban) ? formatIban(v.iban) : ''], [de ? 'BIC' : 'BIC / SWIFT', s(v.bic)], [de ? 'Bank' : 'Bank', s(v.bank)]].filter(r => r[1]);
  if (s(v.iban)) blocks.push({ kv: bank });
  return {
    ...base, form: 'B', notices: [],
    info: [[de ? 'Kundennummer' : 'Customer no.', s(v.customerNo)], [de ? 'Rechnung' : 'Invoice', nos.slice(0, 3).join(', ') + (nos.length > 3 ? ' …' : '')]],
    subject: `${lv[de ? 'de' : 'en']}${nos.length ? (de ? ` – Rechnung${nos.length > 1 ? 'en' : ''} ${nos.slice(0, 3).join(', ')}` : ` – invoice${nos.length > 1 ? 's' : ''} ${nos.slice(0, 3).join(', ')}`) : ''}`,
    salutation: s(v.salutation) || (de ? 'Sehr geehrte Damen und Herren,' : 'Dear Sir or Madam,'), blocks, closing: de ? 'Mit freundlichen Grüßen' : 'Yours sincerely,',
    totals: t,
  };
}
const fmtPct = (x, lang) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 3 }).format(Number.isFinite(x) ? x : 0);

let api = null;
const REQ = (v, lang) => [{ ok: !!s(v.sName), de: 'deinen Namen', en: 'your name' }, { ok: !!s(v.rName), de: 'den Empfänger', en: 'the recipient' },
  { ok: totals(v, lang).rows.length > 0, de: 'mindestens eine Rechnung mit Betrag', en: 'at least one invoice with an amount' }];

export default {
  labels: { back_to_files: { de: 'Zurück zur Mahnung', en: 'Back to the reminder' } },
  options: [],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); },
  status(values, inputs, lang) {
    const v = values.pr || {};
    const t = totals(v, lang);
    const summary = { de: `${LEVELS[v.level]?.de || 'Zahlungserinnerung'} · ${money(t.total, 'de')}`, en: `${LEVELS[v.level]?.en || 'Payment reminder'} · ${money(t.total, 'en', v.currency || 'EUR')}` };
    const miss = REQ(v, lang).filter(r => !r.ok);
    return miss.length ? { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } } : { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.pr || {};
    if (REQ(v, ctx.lang).some(r => !r.ok)) throw userError('Bitte gib Absender, Empfänger und mindestens eine Rechnung mit Betrag an.', 'Please enter sender, recipient and at least one invoice with an amount.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const m = buildModel(v, ctx.lang);
    const { bytes, missing, pages } = await letterPdf({ ...m, sig: await api?.sig() }, { lang: ctx.lang });
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    if (ctx.lang === 'de') ctx.note({ de: 'Hinweis: Das ist eine Formulierungshilfe, keine Rechtsberatung. Prüf vor dem Versand den Basiszinssatz und ob der Schuldner bereits im Verzug ist.', en: '' });
    const name = ctx.safeFileName(`${ctx.t(LEVELS[v.level] || LEVELS.reminder)}${v.rName ? ' – ' + s(v.rName) : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: money(m.totals.total, ctx.lang, ctx.lang === 'de' ? 'EUR' : v.currency || 'EUR') }] };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const today = isoDate();
  const v = (state.values.pr ||= {
    level: 'reminder', tone: 'neutral', b2b: false, interest: false, flat: false, baseRate: de ? String(BASE_RATE.rate).replace('.', ',') : '', rate: '', fee: '', enFlat: '',
    letterDate: today, deadline: addDays(today, LEVELS.reminder.days), until: today, currency: 'EUR',
    invoices: [{ no: '', date: '', due: '', amount: '', paid: '' }],
  });
  let rem = null, pvs = null;
  const sumBox = el('div', { class: 'tpl-sum', aria: { live: 'polite' } });
  const intBox = el('div', {});
  const changed = key => {
    if (rem && SENDER_FIELDS.includes(key)) rem.save();
    if (key === 'level') { v.deadline = addDays(v.letterDate || today, LEVELS[v.level].days); const d = stage.querySelector('#tpl-deadline'); if (d) d.value = v.deadline; }
    if (key === 'letterDate' && !v.untilTouched) { v.until = v.letterDate; const u = stage.querySelector('#tpl-until'); if (u) u.value = v.until; }
    if (key === 'until') v.untilTouched = true;
    if (key === 'interest' || key === 'b2b') renderInterest();
    state.results.clear(); ctx.refresh(); pvs?.refresh(); renderSum();
  };
  const f = form(v, lang, changed);
  const cur = () => (de ? 'EUR' : v.currency || 'EUR');
  function renderSum() {
    const t = totals(v, lang);
    const row = (a, b, cls = '') => el('p', { class: cls }, el('span', {}, a), el('span', {}, money(b, lang, cur())));
    sumBox.replaceChildren(row(T(lang, { de: 'Offen', en: 'Outstanding' }), t.open),
      t.interest ? row(T(lang, { de: `Verzugszinsen (${t.rows.map(r => r.days).join(' / ')} Tage)`, en: `Interest (${t.rows.map(r => r.days).join(' / ')} days)` }), t.interest) : '',
      t.flat ? row(T(lang, { de: 'Verzugspauschale', en: 'Flat fee' }), t.flat) : '', t.fee ? row(T(lang, { de: 'Mahnkosten', en: 'Fees' }), t.fee) : '',
      row(T(lang, { de: 'Gesamtbetrag', en: 'Total due' }), t.total, 'tpl-total'));
  }
  function renderInterest() {
    const kids = [];
    if (de) {
      kids.push(f.seg('b2b', { de: 'Schuldner ist', en: 'Debtor' }, [{ value: false, label: { de: 'Verbraucher (+ 5 Punkte)', en: '' } }, { value: true, label: { de: 'Unternehmen (+ 9 Punkte)', en: '' } }], { onChange: x => { v.b2b = x === true || x === 'true'; } }));
      if (v.interest) {
        kids.push(f.grid(
          f.field('baseRate', 'Basiszinssatz in %', { id: 'tpl-baseRate', inputmode: 'decimal', hint: `Stand: ${fmtDate(BASE_RATE.since, 'de')} (${String(BASE_RATE.rate).replace('.', ',')} %) – bitte prüfen. Der Basiszinssatz ändert sich zum 1. Januar und 1. Juli und wird von der Deutschen Bundesbank veröffentlicht.`,
            validate: x => (Number.isFinite(parseNum(x, 'de')) ? '' : { de: 'Bitte eine Zahl eingeben, z. B. 1,52', en: '' }) }),
          f.field('until', 'Zinsen berechnen bis', { id: 'tpl-until', type: 'date' })));
        kids.push(el('p', { class: 'img-muted' }, `Zinssatz: ${fmtPct(lateRate(parseNum(v.baseRate, 'de'), v.b2b), 'de')} % pro Jahr, taggenau (Tage / 365) ab dem Tag nach Fälligkeit.`));
      }
      if (v.b2b) kids.push(f.check('flat', 'Verzugspauschale 40 € je Rechnung (nur gegenüber Unternehmen)', { id: 'tpl-flat' }));
      kids.push(note('de', 'Zinsen und Pauschale kannst du in der Regel erst verlangen, wenn der Schuldner in Verzug ist – z. B. nach einer Mahnung, bei einem fest vereinbarten Zahlungsdatum oder 30 Tage nach Fälligkeit und Zugang der Rechnung (bei Verbrauchern nur, wenn die Rechnung darauf hinweist). Das Werkzeug rechnet vereinfacht ab dem Tag nach Fälligkeit und mit einem Basiszinssatz für den ganzen Zeitraum. Keine Rechtsberatung.'));
    } else if (v.interest) {
      kids.push(f.grid(f.field('rate', 'Interest rate, % per year', { id: 'tpl-rate', inputmode: 'decimal', hint: 'Use the rate agreed in your terms or allowed by the law that applies to you.' }),
        f.field('until', 'Calculate interest until', { id: 'tpl-until', type: 'date' })));
    }
    if (!de) kids.push(f.field('enFlat', 'Late-payment fee (optional)', { id: 'tpl-enFlat', inputmode: 'decimal' }));
    intBox.replaceChildren(...kids);
  }
  const invList = entryList({ items: v.invoices, lang, labels: { add: { de: 'Weitere Rechnung', en: 'Add invoice' }, item: (i, it) => (s(it.no) ? `${de ? 'Rechnung' : 'Invoice'} ${s(it.no)}` : `${de ? 'Rechnung' : 'Invoice'} ${i + 1}`) }, min: 1, max: 30,
    make: () => ({ no: '', date: '', due: '', amount: '', paid: '' }), onChange: () => changed('invoices'),
    render: (it, i) => f.grid(f.field('no', { de: 'Rechnungsnummer', en: 'Invoice number' }, { obj: it, id: `tpl-inv-no-${i}` }), f.field('amount', { de: 'Rechnungsbetrag', en: 'Invoice amount' }, { obj: it, id: `tpl-inv-amount-${i}`, inputmode: 'decimal', placeholder: de ? '119,00' : '119.00' }),
      f.field('date', { de: 'Rechnungsdatum', en: 'Invoice date' }, { obj: it, id: `tpl-inv-date-${i}`, type: 'date' }), f.field('due', { de: 'Fällig am', en: 'Due on' }, { obj: it, id: `tpl-inv-due-${i}`, type: 'date' }),
      f.field('paid', { de: 'Bereits bezahlt (optional)', en: 'Already paid (optional)' }, { obj: it, id: `tpl-inv-paid-${i}`, inputmode: 'decimal' })) });
  const sender = senderSection(f, v, lang, { extra: [f.field('customerNo', { de: 'Kundennummer des Empfängers (optional)', en: 'Customer number (optional)' })] }); rem = sender.rem;
  const sig = signatureSection(f, lang, () => changed('sig'));
  pvs = previewSection(f, lang, () => buildModel(v, lang), () => sig.pad.export());
  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-level', { de: 'Mahnstufe und Ton', en: 'Level and tone' },
      f.seg('level', { de: 'Stufe', en: 'Level' }, Object.entries(LEVELS).map(([k, l]) => ({ value: k, label: l }))),
      f.select('tone', { de: 'Tonfall', en: 'Tone' }, [{ value: 'friendly', label: { de: 'Freundlich', en: 'Friendly' } }, { value: 'neutral', label: { de: 'Sachlich', en: 'Neutral' } }, { value: 'firm', label: { de: 'Bestimmt', en: 'Firm' } }]),
      f.grid(f.field('deadline', { de: 'Neue Zahlungsfrist', en: 'New payment deadline' }, { type: 'date' }), f.field('fee', { de: 'Mahnkosten (optional)', en: 'Reminder fee (optional)' }, { inputmode: 'decimal',
        hint: { de: 'Nur tatsächliche Kosten wie Porto – für die erste Mahnung meist keine.', en: 'Only if your terms allow it.' } })),
      de ? '' : f.select('currency', 'Currency', ['EUR', 'GBP', 'USD', 'CHF'].map(c => ({ value: c, label: c })))),
    f.sec('tpl-h-inv', { de: 'Offene Rechnungen', en: 'Open invoices' }, invList.root, sumBox),
    f.sec('tpl-h-int', { de: 'Verzugszinsen', en: 'Late-payment interest' }, f.check('interest', { de: 'Verzugszinsen berechnen', en: 'Charge interest' }), intBox),
    recipientSection(f, lang, { title: { de: 'Schuldner (Empfänger)', en: 'Debtor (recipient)' } }),
    sender.sec,
    f.sec('tpl-h-bank', { de: 'Bankverbindung', en: 'Bank details' }, f.grid(f.field('iban', 'IBAN', { autocomplete: 'off' }), f.field('bic', { de: 'BIC (optional)', en: 'BIC / SWIFT (optional)' }),
      f.field('bank', { de: 'Bank (optional)', en: 'Bank (optional)' }), f.field('holder', { de: 'Kontoinhaber (falls anders)', en: 'Account holder (if different)' }))),
    sig.sec), el('div', { class: 'tpl-side' }, pvs.sec)));
  renderInterest(); renderSum();
  pvs.refresh();
  ctx.refresh();
  return { sig: () => sig.pad.export() };
}
