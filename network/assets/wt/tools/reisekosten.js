// Tool: travel expense report (Reisekostenabrechnung). Trip start/end → meal allowances per day with the
// 2026 rates (14 €/28 €), provided meals ticked per day reduce them; car/motorbike mileage; receipts for
// tickets, hotel (breakfast taken off), other costs, each with a photo or PDF that is attached to the report;
// flat-rate nights; advance → payout. One PDF with tables, signatures and the receipts behind it.
// Personal details are kept only when "remember" is ticked; receipts never leave the browser.
import { el, s, form, userError, ensureCss, isoDate, fmtDate, clear, entryList, remember, money, icon } from '../lib/tpl-core.js';
import { createWriter, mm } from '../lib/tpl-pdf.js';
import { signatureSection } from '../lib/tpl-letterui.js';
import { RATES, mealDays, statement, mileage, toCents } from '../lib/travel.js';
import { InputFile } from '../lib/files.js';
import { embedImage, drawFitted } from '../lib/imgembed.js';
import { loadPdfLib } from '../lib/pdf.js';

ensureCss();
const KEEP = 'fale-wt-travel-person';
const PERSON = ['pName', 'pNo', 'pDept', 'pCompany'];
const eur = (c, lang) => money(c, lang);
const KIND = { travel: { de: 'Fahrkarte / Flug / Taxi', en: 'Ticket / flight / taxi' }, hotel: { de: 'Hotel / Übernachtung', en: 'Hotel / accommodation' }, other: { de: 'Sonstiges (Parken, Maut …)', en: 'Other (parking, tolls …)' } };
const VEH = { car: { de: 'Pkw (0,30 €/km)', en: 'Car (€0.30/km)' }, moto: { de: 'Motorrad / Roller (0,20 €/km)', en: 'Motorbike / scooter (€0.20/km)' }, custom: { de: 'Eigener Satz', en: 'Own rate' } };
let uid = 0;
const nid = () => `r${Date.now().toString(36)}${++uid}`;
const files = new Map();   // receipt id → File (kept out of the state, never stored)

function input(v) {
  return {
    trip: { start: v.start, end: v.end, overnight: !v.noNight },
    meals: v.meals, drives: v.drives, receipts: v.receipts, nights: v.nights, advance: v.advance,
  };
}
const dt = (s2, lang) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(s2 || ''); return m ? `${fmtDate(m[1], lang)}, ${m[2]}` : ''; };

let api = null;

export default {
  labels: { back_to_files: { de: 'Zurück zur Abrechnung', en: 'Back to the report' } },
  mountStage(stage, state, ctx) { api = travelStage(stage, state, ctx); },
  takeFiles(list) { api?.addFiles(list); },
  status(values) {
    const v = values.trip;
    if (!v) return { ok: false };
    const r = statement(input(v));
    if (!s(v.pName)) return { ok: false, hint: { de: 'Trag deinen Namen ein.', en: 'Enter your name.' } };
    if (!r.days.length && !r.drive && !r.total) return { ok: false, hint: { de: 'Trag Beginn und Ende der Reise ein.', en: 'Enter the start and end of the trip.' } };
    return { summary: { de: `Erstattung ${eur(r.payout, 'de')}`, en: `Reimbursement ${eur(r.payout, 'en')}` } };
  },
  async run(inputs, opts, ctx) {
    const v = opts.trip, lang = ctx.lang, de = lang === 'de';
    const w2 = (a, b) => (de ? a : b);
    const r = statement(input(v));
    if (!s(v.pName)) throw userError('Bitte trag deinen Namen ein.', 'Please enter your name.');
    const all = [v.pName, v.pNo, v.pDept, v.pCompany, v.purpose, v.dest, ...v.drives.map(d => d.route), ...v.receipts.map(x => x.text)].join('\n');
    const w = await createWriter({ text: all, lang });
    w.newPage();
    w.para(w2('Reisekostenabrechnung', 'Travel expense report'), { font: w.bold, size: 18, after: 6 });
    w.kv([
      [w2('Name', 'Name'), s(v.pName)], ...(s(v.pNo) ? [[w2('Personalnummer', 'Staff number'), s(v.pNo)]] : []),
      ...(s(v.pDept) || s(v.pCompany) ? [[w2('Firma / Abteilung', 'Company / department'), [s(v.pCompany), s(v.pDept)].filter(Boolean).join(' · ')]] : []),
      [w2('Anlass', 'Purpose'), s(v.purpose) || '–'], [w2('Reiseziel', 'Destination'), s(v.dest) || '–'],
      [w2('Beginn', 'Start'), dt(v.start, lang) || '–'], [w2('Ende', 'End'), dt(v.end, lang) || '–'],
    ], { size: 10 });
    w.space(8);
    const sec = t => { w.ensure(60); w.para(t, { font: w.bold, size: 12, after: 4 }); };
    if (r.days.length) {
      sec(w2('Verpflegungsmehraufwand', 'Meal allowance'));
      const kindL = { single: w2('Eintägig', 'Single day'), arrival: w2('Anreisetag', 'Arrival day'), departure: w2('Abreisetag', 'Departure day'), full: w2('Ganzer Tag', 'Full day') };
      w.table([{ label: w2('Datum', 'Date'), w: 1.2 }, { label: w2('Art', 'Type'), w: 1.3 }, { label: w2('Stunden', 'Hours'), w: 0.8, align: 'right' }, { label: w2('Pauschale', 'Rate'), w: 1, align: 'right' }, { label: w2('Gestellte Mahlzeiten', 'Meals provided'), w: 2 }, { label: w2('Betrag', 'Amount'), w: 1, align: 'right' }],
        r.days.map(d => [fmtDate(d.date, lang), kindL[d.kind], d.hours.toFixed(1).replace('.', de ? ',' : '.'), eur(d.rate, lang),
          [d.meals.breakfast && w2('Frühstück', 'Breakfast'), d.meals.lunch && w2('Mittag', 'Lunch'), d.meals.dinner && w2('Abend', 'Dinner')].filter(Boolean).join(', ') || '–', eur(d.allowance, lang)]),
        { foot: [[w2('Summe Verpflegung', 'Total meals'), '', '', '', '', eur(r.meal, lang)]] });
      w.space(10);
    }
    const drives = v.drives.filter(d => s(d.km));
    if (drives.length) {
      sec(w2('Fahrtkosten mit eigenem Fahrzeug', 'Mileage, own vehicle'));
      w.table([{ label: w2('Datum', 'Date'), w: 1.1 }, { label: w2('Strecke', 'Route'), w: 3 }, { label: 'km', w: 0.8, align: 'right' }, { label: w2('Satz', 'Rate'), w: 1, align: 'right' }, { label: w2('Betrag', 'Amount'), w: 1, align: 'right' }],
        drives.map(d => [d.date ? fmtDate(d.date, lang) : '', s(d.route), s(d.km), d.vehicle === 'custom' ? `${s(d.rate)} €` : eur(d.vehicle === 'moto' ? RATES.moto : RATES.car, lang), eur(mileage(d.km, d.vehicle, d.rate), lang)]),
        { foot: [[w2('Summe Fahrtkosten', 'Total mileage'), '', '', '', eur(r.drive, lang)]] });
      w.space(10);
    }
    const rec = v.receipts.filter(x => s(x.amount));
    if (rec.length || r.flatNights) {
      sec(w2('Belege und Übernachtung', 'Receipts and accommodation'));
      const rows = rec.map((x, i) => [String(i + 1), T2(KIND[x.kind], lang), s(x.text) + (x.kind === 'hotel' && +x.breakfasts ? w2(` (abzgl. ${x.breakfasts} × Frühstück à 5,60 €)`, ` (less ${x.breakfasts} × breakfast at €5.60)`) : ''), eur(toCents(x.amount), lang), files.has(x.id) ? w2('angehängt', 'attached') : '–']);
      if (r.flatNights) rows.push(['', w2('Übernachtungspauschale', 'Overnight flat rate'), `${Math.round(r.flatNights / RATES.night)} × ${eur(RATES.night, lang)}`, eur(r.flatNights, lang), '–']);
      if (r.breakfastCut) rows.push(['', w2('Kürzung Frühstück', 'Breakfast deduction'), w2('in Hotelrechnungen enthalten', 'included in hotel bills'), eur(-r.breakfastCut, lang), '']);
      w.table([{ label: w2('Nr.', 'No.'), w: 0.5 }, { label: w2('Art', 'Type'), w: 1.8 }, { label: w2('Beschreibung', 'Description'), w: 3 }, { label: w2('Betrag', 'Amount'), w: 1, align: 'right' }, { label: w2('Beleg', 'Receipt'), w: 0.9 }], rows);
      w.space(10);
    }
    sec(w2('Zusammenfassung', 'Summary'));
    const sumRows = [[w2('Verpflegungsmehraufwand', 'Meal allowance'), eur(r.meal, lang)], [w2('Fahrtkosten eigenes Fahrzeug', 'Mileage'), eur(r.drive, lang)], [w2('Fahrkarten, Flüge, Taxi', 'Tickets, flights, taxi'), eur(r.travel, lang)],
      [w2('Übernachtung', 'Accommodation'), eur(r.hotel + r.flatNights, lang)], [w2('Sonstige Kosten', 'Other costs'), eur(r.other, lang)]].filter(x => x[1] !== eur(0, lang));
    w.table([{ label: w2('Position', 'Item'), w: 4 }, { label: w2('Betrag', 'Amount'), w: 1.2, align: 'right' }], sumRows,
      { foot: [[w2('Gesamt', 'Total'), eur(r.total, lang)], ...(r.advance ? [[w2('abzüglich Vorschuss', 'less advance'), eur(-r.advance, lang)]] : []), [r.payout >= 0 ? w2('Auszuzahlen', 'To be paid') : w2('Zurückzuzahlen', 'To be repaid'), eur(Math.abs(r.payout), lang)]] });
    w.space(6);
    w.para(w2(`Pauschalen für Inlandsreisen nach § 9 Abs. 4a EStG (Stand ${RATES.year}). Gestellte Mahlzeiten kürzen den Tag um 20 % (Frühstück) bzw. 40 % (Mittag, Abend) der vollen Pauschale.`,
      `Flat rates for domestic trips under German § 9 (4a) EStG (as of ${RATES.year}). Provided meals reduce a day by 20 % (breakfast) or 40 % (lunch, dinner) of the full-day rate.`), { size: 8.5, color: w.GREY, after: 18 });
    const sig = await api?.sig();
    await w.signatures([{ caption: w2('Datum, Unterschrift Reisende/r', 'Date, signature of traveller'), sig }, { caption: w2('Sachlich geprüft / genehmigt', 'Checked / approved') }]);
    // receipts behind the report
    const PDFLib = await loadPdfLib();
    let n = 0;
    for (const [i, x] of rec.entries()) {
      const file = files.get(x.id);
      if (!file) continue;
      ctx.progress(0.5 + 0.4 * (++n / Math.max(1, files.size)), { de: 'Belege werden angehängt …', en: 'Attaching receipts …' });
      await ctx.tick();
      const inp = await InputFile.from(file);
      const caption = `${w2('Beleg', 'Receipt')} ${i + 1}: ${T2(KIND[x.kind], lang)}${s(x.text) ? ' – ' + s(x.text) : ''} · ${eur(toCents(x.amount), lang)}`;
      try {
        if (inp.format === 'pdf') {
          const src = await PDFLib.PDFDocument.load(await inp.bytes(), { ignoreEncryption: true });
          const pages = await w.doc.copyPages(src, src.getPageIndices());
          pages.forEach((p, k) => { w.doc.addPage(p); if (k === 0) { const { width, height } = p.getSize(); p.drawText(w.txt(caption), { x: 12, y: height - 14, size: 8, font: w.font, color: w.GREY }); void width; } });
        } else if (inp.kind === 'image') {
          const e = await embedImage(w.doc, inp, { maxSide: 2400, quality: 0.85 });
          w.newPage();
          w.line(caption, w.L, w.top, { size: 9, color: w.GREY, maxWidth: w.TW });
          drawFitted(w.page, e, PDFLib, { x: w.L, y: w.bottom, width: w.TW, height: w.top - w.bottom - 16 });
        }
      } catch { ctx.note({ de: `Beleg ${i + 1} ließ sich nicht anhängen.`, en: `Receipt ${i + 1} could not be attached.` }); }
    }
    const res = await w.finish({ title: w2('Reisekostenabrechnung', 'Travel expense report') });
    const name = ctx.safeFileName(`${w2('Reisekostenabrechnung', 'Travel expenses')} ${s(v.dest) || ''} ${(v.start || '').slice(0, 10)}`.replace(/\s+/g, ' ').trim());
    return { outputs: [{ name: `${name}.pdf`, blob: new Blob([res.bytes], { type: 'application/pdf' }), pages: w.doc.getPageCount(), note: w2(`Erstattung ${eur(r.payout, lang)}`, `Reimbursement ${eur(r.payout, lang)}`) }] };
  },
};
const T2 = (o, lang) => (lang === 'de' ? o.de : o.en);

function travelStage(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const w = (a, b) => (de ? a : b);
  const today = isoDate();
  const v = (state.values.trip ||= { start: `${today}T08:00`, end: `${today}T17:00`, noNight: false, purpose: '', dest: '', meals: {}, drives: [], receipts: [], nights: '', advance: '' });
  const rem = remember({ key: KEEP, fields: PERSON, v, lang, id: 'rk-remember', label: { de: 'Meine Angaben auf diesem Gerät merken', en: 'Remember my details on this device' } });
  const changed = key => { if (PERSON.includes(key)) rem.save(); if (key === 'start' || key === 'end' || key === 'noNight') renderDays(); sum(); state.results.clear(); ctx.refresh(); };
  const f = form(v, lang, k => changed(k), 'rk');

  // ---------------------------------------------------------------- meal days
  const daysBox = el('div', { class: 'rk-days', id: 'rk-days' });
  function renderDays() {
    clear(daysBox);
    const days = mealDays(v.start, v.end, { overnight: !v.noNight });
    if (!days.length) { daysBox.append(el('p', { class: 'img-muted' }, w('Trag Beginn und Ende ein – das Ende muss nach dem Beginn liegen.', 'Enter start and end – the end must be after the start.'))); return; }
    const kind = { single: w('Eintägig', 'Single day'), arrival: w('Anreise', 'Arrival'), departure: w('Abreise', 'Departure'), full: w('Ganzer Tag', 'Full day') };
    for (const d of days) {
      const m = (v.meals[d.date] ||= {});
      const box = (k, label) => {
        const id = `rk-meal-${d.date}-${k}`;
        const inp = el('input', { type: 'checkbox', id, checked: !!m[k], onchange: e => { m[k] = e.target.checked; changed('meals'); } });
        return el('label', { class: 'rk-meal', for: id }, inp, el('span', {}, label));
      };
      daysBox.append(el('div', { class: 'rk-day' },
        el('div', { class: 'rk-day-head' }, el('b', {}, fmtDate(d.date, lang)), el('span', { class: 'img-muted' }, `${kind[d.kind]} · ${d.hours.toFixed(1).replace('.', de ? ',' : '.')} h · ${eur(d.rate, lang)}`)),
        d.rate ? el('div', { class: 'rk-meals' }, el('span', { class: 'img-muted' }, w('Gestellt:', 'Provided:')), box('breakfast', w('Frühstück', 'Breakfast')), box('lunch', w('Mittag', 'Lunch')), box('dinner', w('Abend', 'Dinner')))
          : el('p', { class: 'img-muted' }, w('Nicht mehr als 8 Stunden unterwegs – keine Pauschale.', 'Not more than 8 hours away – no allowance.'))));
    }
  }

  // ---------------------------------------------------------------- drives + receipts
  const drives = entryList({ items: v.drives, lang, max: 40, labels: { add: { de: 'Fahrt hinzufügen', en: 'Add drive' }, item: (i, d) => s(d.route) || w(`Fahrt ${i + 1}`, `Drive ${i + 1}`) },
    make: () => ({ date: (v.start || '').slice(0, 10), route: '', km: '', vehicle: 'car', rate: '' }), onChange: () => changed('drives'),
    render: d => f.grid(f.field('date', { de: 'Datum', en: 'Date' }, { obj: d, type: 'date' }), f.field('route', { de: 'Strecke (von – nach – zurück)', en: 'Route (from – to – back)' }, { obj: d, wide: true, maxLength: 160 }),
      f.field('km', { de: 'Gefahrene km', en: 'Kilometres driven' }, { obj: d, inputmode: 'decimal', maxLength: 8 }),
      f.select('vehicle', { de: 'Fahrzeug', en: 'Vehicle' }, Object.entries(VEH).map(([k, l]) => ({ value: k, label: l })), { obj: d, onChange: () => drives.render() }),
      d.vehicle === 'custom' ? f.field('rate', { de: 'Satz in € pro km', en: 'Rate in € per km' }, { obj: d, inputmode: 'decimal', maxLength: 6 }) : null) });
  const receipts = entryList({ items: v.receipts, lang, max: 60, labels: { add: { de: 'Beleg hinzufügen', en: 'Add receipt' }, item: (i, x) => `${w('Beleg', 'Receipt')} ${i + 1}${s(x.text) ? ' · ' + s(x.text) : ''}` },
    make: () => ({ id: nid(), kind: 'travel', text: '', amount: '', breakfasts: '' }), onChange: () => changed('receipts'),
    render: x => {
      const fileId = `rk-file-${x.id}`;
      const fin = el('input', { type: 'file', id: fileId, class: 'rk-file', accept: 'image/*,.heic,.pdf,application/pdf', onchange: e => { const fl = e.target.files?.[0]; if (fl) { files.set(x.id, fl); receipts.render(); changed('file'); } } });
      const att = files.get(x.id);
      return f.grid(
        f.select('kind', { de: 'Art', en: 'Type' }, Object.entries(KIND).map(([k, l]) => ({ value: k, label: l })), { obj: x, onChange: () => receipts.render() }),
        f.field('text', { de: 'Beschreibung', en: 'Description' }, { obj: x, wide: true, maxLength: 120 }),
        f.field('amount', { de: 'Betrag (€)', en: 'Amount (€)' }, { obj: x, inputmode: 'decimal', maxLength: 10 }),
        x.kind === 'hotel' ? f.field('breakfasts', { de: 'Davon Frühstücke auf der Rechnung', en: 'Breakfasts included in the bill' }, { obj: x, inputmode: 'numeric', maxLength: 2 }) : null,
        el('div', { class: 'tpl-f tpl-f-wide rk-attach' }, fin,
          el('label', { for: fileId, class: 'wt-btn wt-btn-quiet wt-btn-sm' }, icon('plus'), el('span', {}, att ? w('Anderes Foto/PDF wählen', 'Choose another photo/PDF') : w('Foto oder PDF anhängen', 'Attach photo or PDF'))),
          att ? el('span', { class: 'img-muted' }, `${att.name}`) : null));
    } });

  // ---------------------------------------------------------------- summary
  const sumBox = el('div', { class: 'rk-sum', id: 'rk-sum', aria: { live: 'polite' } });
  function sum() {
    const r = statement(input(v));
    clear(sumBox);
    const row = (label, c, main) => el('div', { class: 'rk-row' + (main ? ' is-main' : '') }, el('span', {}, label), el('b', {}, eur(c, lang)));
    sumBox.append(row(w('Verpflegung', 'Meals'), r.meal), row(w('Fahrtkosten', 'Mileage'), r.drive), row(w('Fahrkarten, Flüge, Taxi', 'Tickets, flights, taxi'), r.travel),
      row(w('Übernachtung', 'Accommodation'), r.hotel + r.flatNights), row(w('Sonstiges', 'Other'), r.other), row(w('Gesamt', 'Total'), r.total, true));
    if (r.advance) sumBox.append(row(w('abzüglich Vorschuss', 'less advance'), -r.advance), row(r.payout >= 0 ? w('Auszuzahlen', 'To be paid') : w('Zurückzuzahlen', 'To be repaid'), Math.abs(r.payout), true));
  }

  const addFiles = list => {
    for (const fl of list) {
      if (!/^image\/|application\/pdf/.test(fl.type || '') && !/\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(fl.name || '')) continue;
      const x = { id: nid(), kind: /hotel/i.test(fl.name || '') ? 'hotel' : 'other', text: (fl.name || '').replace(/\.\w+$/, '').slice(0, 60), amount: '', breakfasts: '' };
      v.receipts.push(x); files.set(x.id, fl);
    }
    receipts.render(); changed('receipts');
  };
  const sig = signatureSection(f, lang, () => changed('sig'), { title: { de: 'Unterschrift (optional)', en: 'Signature (optional)' } });

  stage.append(el('div', { class: 'rk' },
    f.sec('rk-h-person', { de: 'Reisende Person', en: 'Traveller' },
      f.grid(f.field('pName', { de: 'Name', en: 'Name' }, { autocomplete: 'name', wide: true }), f.field('pNo', { de: 'Personalnummer (optional)', en: 'Staff number (optional)' }),
        f.field('pCompany', { de: 'Firma (optional)', en: 'Company (optional)' }, { autocomplete: 'organization' }), f.field('pDept', { de: 'Abteilung / Kostenstelle (optional)', en: 'Department / cost centre (optional)' })),
      rem.box),
    f.sec('rk-h-trip', { de: 'Reise', en: 'Trip' },
      f.grid(f.field('purpose', { de: 'Anlass', en: 'Purpose' }, { wide: true, maxLength: 160 }), f.field('dest', { de: 'Reiseziel', en: 'Destination' }, { wide: true, maxLength: 120 }),
        f.field('start', { de: 'Beginn (Abfahrt)', en: 'Start (departure)' }, { type: 'datetime-local' }), f.field('end', { de: 'Ende (Rückkehr)', en: 'End (return)' }, { type: 'datetime-local' })),
      f.check('noNight', { de: 'Über Nacht unterwegs, aber ohne Übernachtung', en: 'Travelling overnight, but no overnight stay' }, { hint: { de: 'Dann zählt die Reise als ein Tag – auf dem Kalendertag mit den meisten Stunden.', en: 'Then the trip counts as one day – on the calendar day with the most hours.' } }),
      el('h3', { class: 'rk-h3' }, w('Verpflegungspauschalen', 'Meal allowances')),
      el('p', { class: 'img-muted' }, w('Mehr als 8 Stunden: 14 €, An- und Abreisetag 14 €, volle Tage 28 €. Hak an, wenn dir Mahlzeiten gestellt wurden (z. B. Frühstück im Hotel) – das kürzt den Tag.', 'More than 8 hours: €14, arrival and departure day €14, full days €28. Tick meals you were given (e.g. hotel breakfast) – they reduce the day.')),
      daysBox),
    f.sec('rk-h-drive', { de: 'Fahrten mit eigenem Fahrzeug', en: 'Drives with your own vehicle' }, drives.root),
    f.sec('rk-h-rec', { de: 'Belege', en: 'Receipts' },
      el('p', { class: 'img-muted' }, w('Bahn, Flug, Taxi, Hotel, Parken: Betrag eintragen und Foto oder PDF anhängen – die Belege kommen hinter die Abrechnung. Du kannst Fotos auch einfach hierher ziehen.', 'Train, flight, taxi, hotel, parking: enter the amount and attach a photo or PDF – receipts are added behind the report. You can also drag photos here.')),
      receipts.root,
      f.grid(f.field('nights', { de: 'Nächte ohne Hotelrechnung (Pauschale 20 €)', en: 'Nights without a hotel bill (flat €20)' }, { inputmode: 'numeric', maxLength: 2 }),
        f.field('advance', { de: 'Erhaltener Vorschuss (€)', en: 'Advance received (€)' }, { inputmode: 'decimal', maxLength: 10 }))),
    sig.sec,
    f.sec('rk-h-sum', { de: 'Ergebnis', en: 'Result' }, sumBox)));
  renderDays(); sum(); ctx.refresh();
  return { sig: () => sig.pad.export(), addFiles };
}
