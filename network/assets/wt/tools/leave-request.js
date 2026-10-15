// Tool: leave request (Urlaubsantrag). One or more periods with automatic working-day count (weekends and the
// public holidays of the chosen German state, Easter-based ones included – lib/tpl-holidays.js; 5- or 6-day
// week, optional half days on 24/31 Dec), type of leave, entitlement and remaining days, stand-in, employee
// signature by finger, approval box with signature lines for supervisor and HR. Saarland is the default state
// on the German page; the English page starts with "no public holidays" and offers the German states.
import { el, T, s, form, userError, ensureCss, isoDate, fmtDate, note, remember, signaturePad, pdfPreview, entryList, dateLine, parseNum } from '../lib/tpl-core.js';
import { createWriter, collectText, mm } from '../lib/tpl-pdf.js';
import { STATES, NOTES, workingDays } from '../lib/tpl-holidays.js';
import { missingWarning } from '../lib/unifont.js';

ensureCss();

const KINDS = {
  rest: { de: 'Erholungsurlaub', en: 'Annual leave' }, special: { de: 'Sonderurlaub', en: 'Special leave' }, unpaid: { de: 'Unbezahlter Urlaub', en: 'Unpaid leave' },
  edu: { de: 'Bildungsurlaub', en: 'Educational leave' }, overtime: { de: 'Überstundenausgleich', en: 'Time off in lieu' },
};
const num = (x, lang) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 }).format(x);

/** Periods with their working days and the totals. */
export function compute(v) {
  const opts = { state: v.state === 'none' ? '__' : v.state || 'SL', days: +v.week === 6 ? 6 : 5, halfDays: !!v.halfDays };
  const rows = (v.periods || []).map(p => ({ ...p, r: workingDays(p.from, p.to || p.from, opts) }));
  const total = rows.reduce((t, p) => t + (p.r ? p.r.days : 0), 0);
  return { rows, total };
}

export function buildDoc(v, lang) {
  const de = lang === 'de';
  const c = compute(v);
  const ent = parseNum(v.entitlement, lang), taken = parseNum(v.taken, lang) || 0;
  const counted = v.kind === 'rest' || !v.kind;
  const rest = Number.isFinite(ent) && counted ? ent - taken - c.total : null;
  const stateName = v.state === 'none' ? (de ? 'keine Feiertage berücksichtigt' : 'no public holidays counted') : `${de ? 'Feiertage' : 'public holidays'}: ${STATES[v.state || 'SL']}`;
  return {
    lang, title: de ? 'Urlaubsantrag' : 'Leave request', kind: T(lang, KINDS[v.kind] || KINDS.rest),
    person: [[de ? 'Name' : 'Name', s(v.name)], [de ? 'Personalnummer' : 'Employee no.', s(v.staffNo)], [de ? 'Abteilung' : 'Department', s(v.dept)], [de ? 'Vorgesetzte/r' : 'Manager', s(v.boss)]].filter(r => r[1]),
    rows: c.rows.filter(p => p.from).map(p => [fmtDate(p.from, lang), fmtDate(p.to || p.from, lang), p.r ? num(p.r.days, lang) : '–']),
    total: c.total, totalText: num(c.total, lang),
    basis: `${+v.week === 6 ? (de ? '6-Tage-Woche (Mo–Sa)' : '6-day week (Mon–Sat)') : (de ? '5-Tage-Woche (Mo–Fr)' : '5-day week (Mon–Fri)')}, ${stateName}${v.halfDays ? (de ? ', 24.12./31.12. als halbe Tage' : ', 24/31 Dec as half days') : ''}`,
    account: Number.isFinite(ent) && counted ? [[de ? `Urlaubsanspruch ${yearOf(v)}` : `Entitlement ${yearOf(v)}`, num(ent, lang)], [de ? 'Bereits genommen / genehmigt' : 'Already taken / approved', num(taken, lang)],
      [de ? 'Dieser Antrag' : 'This request', num(c.total, lang)], [de ? 'Resturlaub danach' : 'Remaining afterwards', num(rest, lang)]] : [],
    rest, stand: s(v.stand), note: s(v.note), dateLine: dateLine(v.place, v.date || isoDate(), lang), name: s(v.name), boss: s(v.boss),
  };
}
const yearOf = v => ((v.periods || [])[0]?.from || isoDate()).slice(0, 4);

async function makePdf(d, sig, lang) {
  const de = lang === 'de';
  const w = await createWriter({ text: collectText(d).join('\n'), lang, margins: { t: 22, b: 20 } });
  w.newPage();
  w.para(d.title, { font: w.bold, size: 18, after: 4, lead: 1.2 });
  w.para(d.kind, { size: 11, color: w.GREY, after: 12 });
  if (d.person.length) { w.kv(d.person, { labelWidth: mm(38) }); w.space(8); }
  w.para(de ? 'Ich beantrage Urlaub für folgenden Zeitraum:' : 'I would like to request leave for the following period:', { after: 6 });
  w.table([{ label: de ? 'Von' : 'From', w: 1 }, { label: de ? 'Bis' : 'To', w: 1 }, { label: de ? 'Arbeitstage' : 'Working days', w: 0.8, align: 'right' }], d.rows.length ? d.rows : [['', '', '']],
    { foot: [[de ? 'Summe' : 'Total', '', d.totalText]], size: 10 });
  w.para(`${de ? 'Berechnet für' : 'Based on'}: ${d.basis}`, { size: 8.5, color: w.GREY, after: 10 });
  if (d.account.length) { w.kv(d.account, { labelWidth: mm(60) }); w.space(6); }
  if (d.stand) w.kv([[de ? 'Vertretung' : 'Stand-in', d.stand]], { labelWidth: mm(38) });
  if (d.note) w.kv([[de ? 'Bemerkung' : 'Notes', d.note]], { labelWidth: mm(38) });
  w.space(18);
  w.para(d.dateLine, { after: 2 });
  await w.signatures([{ caption: de ? 'Unterschrift Mitarbeiter/in' : 'Employee’s signature', sig, name: d.name }, { caption: de ? 'Unterschrift Vertretung (optional)' : 'Stand-in’s signature (optional)', name: d.stand }]);
  // approval box
  w.space(12);
  w.ensure(mm(62));
  const top = w.y, h = mm(58);
  w.page.drawRectangle({ x: w.L, y: top - h, width: w.TW, height: h, borderColor: w.LINE, borderWidth: 0.8, color: w.rgb(0.975, 0.977, 0.985) });
  w.y = top - 8;
  w.para(de ? 'Vom Arbeitgeber auszufüllen' : 'For the employer', { font: w.bold, size: 10, x: w.L + 8, width: w.TW - 16, after: 6 });
  const box = (x, label) => { w.page.drawRectangle({ x, y: w.y - 11, width: 10, height: 10, borderColor: w.INK, borderWidth: 0.8 }); w.line(label, x + 16, w.y - 10, { size: 10 }); };
  box(w.L + 8, de ? 'genehmigt' : 'approved');
  box(w.L + mm(40), de ? 'abgelehnt' : 'declined');
  box(w.L + mm(75), de ? 'genehmigt mit Änderung:' : 'approved with changes:');
  w.page.drawLine({ start: { x: w.L + mm(125), y: w.y - 11 }, end: { x: w.R - 8, y: w.y - 11 }, thickness: 0.5, color: w.LINE });
  w.space(30);
  await w.signatures([{ caption: de ? 'Datum, Unterschrift Vorgesetzte/r' : 'Date, manager’s signature', name: d.boss }, { caption: de ? 'Datum, Personalabteilung' : 'Date, HR' }], { x: w.L + 8, width: w.TW - 16, height: mm(14) });
  w.numberPages();
  return w.finish({ title: `${d.title} ${d.name}`.trim() });
}

let api = null;
const REQ = v => [{ ok: !!s(v.name), de: 'deinen Namen', en: 'your name' }, { ok: compute(v).rows.some(p => p.r), de: 'einen gültigen Zeitraum', en: 'a valid period' }];

export default {
  labels: { back_to_files: { de: 'Zurück zum Antrag', en: 'Back to the request' } },
  options: [],
  mountStage(stage, state, ctx) { api = stageFn(stage, state, ctx); },
  status(values, inputs, lang) {
    const v = values.lv || {};
    const t = compute(v).total;
    const summary = { de: `Urlaubsantrag · ${num(t, 'de')} Arbeitstage`, en: `Leave request · ${num(t, 'en')} working days` };
    const miss = REQ(v).filter(r => !r.ok);
    return miss.length ? { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } } : { summary };
  },
  async run(inputs, opts, ctx) {
    const v = opts.lv || {};
    if (REQ(v).some(r => !r.ok)) throw userError('Bitte gib deinen Namen und einen gültigen Zeitraum an.', 'Please enter your name and a valid period.');
    ctx.progress(0.3, { de: 'PDF wird erstellt …', en: 'Creating PDF …' });
    const d = buildDoc(v, ctx.lang);
    const { bytes, missing, pages } = await makePdf(d, await api?.sig(), ctx.lang);
    const mw = missingWarning(missing);
    if (mw) ctx.note(mw);
    if (d.rest != null && d.rest < 0) ctx.note({ de: 'Achtung: Der Antrag übersteigt deinen restlichen Urlaubsanspruch.', en: 'Note: this request exceeds your remaining entitlement.' });
    const name = ctx.safeFileName(`${d.title}${d.name ? ' ' + d.name : ''}${d.rows[0] ? ' ' + d.rows[0][0] : ''}.pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages, note: ctx.t({ de: `${d.totalText} Arbeitstage`, en: `${d.totalText} working days` }) }] };
  },
};

function stageFn(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const v = (state.values.lv ||= { state: de ? 'SL' : 'none', week: '5', halfDays: false, kind: 'rest', periods: [{ from: '', to: '' }], date: isoDate(), entitlement: '', taken: '' });
  const rem = remember({ key: 'fale-wt-leave-person', fields: ['name', 'staffNo', 'dept', 'boss', 'place', 'entitlement', 'state', 'week'], v, lang, label: { de: 'Meine Angaben auf diesem Gerät merken', en: 'Remember my details on this device' } });
  const pv = pdfPreview(lang);
  const pad = signaturePad(lang, () => changed('sig'));
  const sum = el('div', { class: 'tpl-sum', aria: { live: 'polite' } });
  const stateNote = el('div', {});
  const outs = [];
  const changed = key => {
    if (rem.fields.includes(key)) rem.save();
    renderSum();
    state.results.clear(); ctx.refresh();
    pv.schedule(async () => (await makePdf(buildDoc(v, lang), await pad.export(), lang)).bytes);
  };
  const f = form(v, lang, changed);
  function renderSum() {
    const c = compute(v);
    c.rows.forEach((p, i) => {
      const o = outs[i];
      if (!o) return;
      if (!p.from) { o.textContent = ''; return; }
      if (!p.r) { o.textContent = T(lang, { de: 'Das Enddatum liegt vor dem Startdatum.', en: 'The end date is before the start date.' }); return; }
      const hol = p.r.holidays.map(h => `${fmtDate(h.date, lang)} ${T(lang, h)}`);
      o.replaceChildren(el('span', { class: 'tpl-days' }, T(lang, { de: `${num(p.r.days, 'de')} Arbeitstage`, en: `${num(p.r.days, 'en')} working days` })),
        ` (${T(lang, { de: `${p.r.calendar} Kalendertage`, en: `${p.r.calendar} calendar days` })})`,
        hol.length ? el('ul', { class: 'tpl-hol' }, hol.map(h => el('li', {}, h))) : '');
    });
    const d = buildDoc(v, lang);
    sum.replaceChildren(el('p', { class: 'tpl-total' }, el('span', {}, T(lang, { de: 'Arbeitstage gesamt', en: 'Working days in total' })), el('span', {}, d.totalText)),
      d.rest != null ? el('p', {}, el('span', {}, T(lang, { de: 'Resturlaub danach', en: 'Remaining afterwards' })), el('span', {}, num(d.rest, lang))) : '');
    stateNote.replaceChildren(NOTES[v.state] && de ? note('de', NOTES[v.state]) : '');
  }
  const list = entryList({ items: v.periods, lang, min: 1, max: 12, labels: { add: { de: 'Weiteren Zeitraum', en: 'Add period' }, item: i => T(lang, { de: `Zeitraum ${i + 1}`, en: `Period ${i + 1}` }) },
    make: () => ({ from: '', to: '' }), onChange: () => changed('periods'),
    render: (p, i) => { const o = el('p', { class: 'img-muted', aria: { live: 'polite' } }); outs[i] = o; return el('div', {}, f.grid(f.field('from', { de: 'Von', en: 'From' }, { obj: p, type: 'date', id: `tpl-from-${i}` }), f.field('to', { de: 'Bis', en: 'To' }, { obj: p, type: 'date', id: `tpl-to-${i}` })), o); } });
  const stateChoices = [...(de ? [] : [{ value: 'none', label: 'No public holidays' }]), ...Object.entries(STATES).map(([k, n]) => ({ value: k, label: de ? n : `Germany – ${n}` })), ...(de ? [{ value: 'none', label: 'Keine Feiertage abziehen' }] : [])];
  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('tpl-h-period', { de: 'Zeitraum', en: 'Period' }, list.root, sum,
      f.grid(f.select('state', { de: 'Bundesland (Feiertage)', en: 'Public holidays' }, stateChoices), f.select('week', { de: 'Arbeitswoche', en: 'Working week' }, [{ value: '5', label: { de: '5 Tage (Mo–Fr)', en: '5 days (Mon–Fri)' } }, { value: '6', label: { de: '6 Tage (Mo–Sa)', en: '6 days (Mon–Sat)' } }])),
      stateNote,
      f.check('halfDays', { de: '24.12. und 31.12. als halbe Tage zählen', en: 'Count 24 and 31 December as half days' }),
      f.select('kind', { de: 'Art des Urlaubs', en: 'Type of leave' }, Object.entries(KINDS).map(([k, l]) => ({ value: k, label: l })), { wide: true })),
    f.sec('tpl-h-person', { de: 'Deine Angaben', en: 'Your details' }, f.grid(
      f.field('name', { de: 'Name', en: 'Name' }, { autocomplete: 'name' }), f.field('staffNo', { de: 'Personalnummer (optional)', en: 'Employee number (optional)' }),
      f.field('dept', { de: 'Abteilung (optional)', en: 'Department (optional)' }), f.field('boss', { de: 'Vorgesetzte/r (optional)', en: 'Manager (optional)' }),
      f.field('entitlement', { de: 'Urlaubsanspruch im Jahr (Tage, optional)', en: 'Annual entitlement (days, optional)' }, { inputmode: 'decimal' }), f.field('taken', { de: 'Bereits genommen / genehmigt (Tage)', en: 'Already taken / approved (days)' }, { inputmode: 'decimal' }),
      f.field('stand', { de: 'Vertretung (optional)', en: 'Stand-in (optional)' }), f.field('place', { de: 'Ort', en: 'Place' }), f.field('date', { de: 'Datum', en: 'Date' }, { type: 'date' }),
      f.area('note', { de: 'Bemerkung (optional)', en: 'Notes (optional)' }, { rows: 2 })), rem.box),
    f.sec('tpl-h-sig', { de: 'Deine Unterschrift (optional)', en: 'Your signature (optional)' }, pad.root)),
  el('div', { class: 'tpl-side' }, f.sec('tpl-h-pv', { de: 'Vorschau', en: 'Preview' }, pv.root,
    note(lang, { de: 'Gezählt werden die landesweiten gesetzlichen Feiertage. Örtliche Feiertage und betriebliche Regelungen (z. B. Brückentage, halbe Tage) prüfst du am besten selbst.', en: 'Only state-wide public holidays are counted. Check local holidays and company rules yourself.' })))));
  changed('init');
  return { sig: () => pad.export() };
}
