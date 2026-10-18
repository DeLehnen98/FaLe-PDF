// Tool: operating cost statement for private landlords (Nebenkostenabrechnung). Billing period, house (total
// living area, flats, persons), cost items from the § 2 BetrKV list with their key (living area, persons,
// flats, consumption, or amounts per tenancy e.g. from the heating statement), tenancies with move-in/out
// dates and prepayments. Each tenant gets a DIN 5008 letter: total costs, key explained, own share, minus
// prepayments, back payment or credit, household-services share (§ 35a EStG) and an optional new monthly
// prepayment. Vacancy stays with the landlord automatically. Overview as CSV. All in the browser; kept on
// the device only when "remember" is ticked.
import { el, T, s, form, userError, ensureCss, isoDate, fmtDate, clear, checkRow, entryList, money } from '../lib/tpl-core.js';
import { letterPdf } from '../lib/tpl-pdf.js';
import { senderSection, signatureSection, previewSection } from '../lib/tpl-letterui.js';
import { COST_TYPES, compute, basisText, deadline, daysIncl } from '../lib/nk.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';

ensureCss();
const KEEP = 'fale-wt-nk';
const KEY_LABEL = {
  area: { de: 'Wohnfläche', en: 'Living area' }, persons: { de: 'Personen', en: 'Persons' }, units: { de: 'Wohnungen', en: 'Flats' },
  consumption: { de: 'Verbrauch (Zähler)', en: 'Consumption (meters)' }, direct: { de: 'Betrag je Mieter (z. B. Heizkostenabrechnung)', en: 'Amount per tenant (e.g. heating statement)' },
};
const typeLabel = (id, lang) => T(lang, COST_TYPES.find(c => c.id === id) || { de: 'Kosten', en: 'Costs' });
let uid = 0;
const nid = p => `${p}${Date.now().toString(36)}${++uid}`;

function lastYear() { const y = new Date().getFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
function defaults(lang) {
  const p = lastYear();
  const item = (type, key) => ({ id: nid('i'), type, label: '', amount: '', key, hhd: ['gebaeudereinigung', 'garten', 'hauswart', 'schornstein'].includes(type) });
  return {
    pFrom: p.from, pTo: p.to, hStreet: '', hCity: '', hArea: '', hUnits: '', hPersons: '', hCons: '',
    items: [item('grundsteuer', 'area'), item('wasser', 'persons'), item('abwasser', 'persons'), item('muell', 'persons'), item('versicherung', 'area'), item('beleuchtung', 'area'), item('heizung', 'direct')],
    tenancies: [{ id: nid('t'), name: '', unit: '', area: '', persons: '1', from: '', to: '', prepaid: '', consumption: '', direct: {} }],
    salutation: lang === 'de' ? 'Sehr geehrte Damen und Herren,' : 'Dear tenant,', closing: lang === 'de' ? 'Mit freundlichen Grüßen' : 'Kind regards',
    iban: '', payDays: '30', creditMode: 'transfer', adjust: false, adjustFrom: '', letterDate: isoDate(),
  };
}

/** Input for lib/nk.js from the form values (items without an amount are left out). */
export function nkInput(v) {
  const items = v.items.filter(i => (i.key === 'direct' ? v.tenancies.some(t => s(t.direct?.[i.id])) : s(i.amount)));
  return {
    period: { from: v.pFrom, to: v.pTo }, house: { area: v.hArea, units: v.hUnits, persons: v.hPersons, consumption: v.hCons },
    tenancies: v.tenancies, items,
  };
}

const eur = (c, lang) => money(c, lang);   // money() takes cents
const dmy = (iso, lang) => (iso ? fmtDate(iso, lang) : '');

/** Letter model for tenancy i. */
function modelFor(v, r, i, lang) {
  const de = lang === 'de';
  const t = r.tenancies[i];
  if (!t) return { sender: [], recipient: [], blocks: [], lang };
  const P = `${dmy(v.pFrom, lang)} – ${dmy(v.pTo, lang)}`;
  const use = `${dmy(t.use.from, lang)} – ${dmy(t.use.to, lang)}`;
  const items = nkInput(v).items;
  const rows = t.lines.map(l => {
    const it = items.find(x => x.id === l.item) || {};
    const name = s(it.label) || typeLabel(it.type, lang);
    return [name, l.total == null ? '' : eur(l.total, lang), basisText(l.basis, lang), eur(l.share, lang)];
  });
  const back = t.balance > 0;
  const blocks = [
    de ? `hiermit erhalten Sie die Abrechnung der Betriebskosten für ${s(t.unit) ? `die Wohnung ${s(t.unit)}` : 'Ihre Wohnung'}${s(v.hStreet) ? ` im Haus ${s(v.hStreet)}` : ''} für den Abrechnungszeitraum ${P}. Ihr Nutzungszeitraum: ${use} (${t.days} von ${r.periodDays} Tagen).`
      : `Please find the operating cost statement for ${s(t.unit) ? `flat ${s(t.unit)}` : 'your flat'}${s(v.hStreet) ? ` at ${s(v.hStreet)}` : ''} for the period ${P}. Your period of use: ${use} (${t.days} of ${r.periodDays} days).`,
    { table: {
      cols: [{ label: de ? 'Kostenart' : 'Cost type', w: 2.6 }, { label: de ? 'Gesamtkosten' : 'Total', w: 1.4, align: 'right' }, { label: de ? 'Verteilung' : 'Allocation', w: 3.2 }, { label: de ? 'Ihr Anteil' : 'Your share', w: 1.3, align: 'right' }],
      rows,
      foot: [[de ? 'Ihre Kosten' : 'Your costs', '', '', eur(t.sum, lang)], [de ? 'abzüglich Ihrer Vorauszahlungen' : 'less your prepayments', '', '', eur(-t.prepaid, lang)],
        [back ? (de ? 'Nachzahlung' : 'Amount due') : (de ? 'Guthaben' : 'Credit'), '', '', eur(Math.abs(t.balance), lang)]],
    } },
  ];
  if (back) {
    const due = new Date(Date.parse((v.letterDate || isoDate()) + 'T12:00:00Z') + (parseInt(v.payDays, 10) || 30) * 86400000).toISOString().slice(0, 10);
    blocks.push(de ? `Bitte überweisen Sie die Nachzahlung von ${eur(t.balance, lang)} bis zum ${dmy(due, lang)}${s(v.iban) ? ` auf das Konto ${s(v.iban)}` : ''}.`
      : `Please transfer the amount due of ${eur(t.balance, lang)} by ${dmy(due, lang)}${s(v.iban) ? ` to account ${s(v.iban)}` : ''}.`);
  } else if (t.balance < 0) {
    blocks.push(v.creditMode === 'offset'
      ? (de ? `Ihr Guthaben von ${eur(-t.balance, lang)} verrechnen wir mit der nächsten Mietzahlung.` : `We will offset your credit of ${eur(-t.balance, lang)} against the next rent payment.`)
      : (de ? `Ihr Guthaben von ${eur(-t.balance, lang)} überweisen wir Ihnen in den nächsten Tagen.` : `We will transfer your credit of ${eur(-t.balance, lang)} to you in the next few days.`));
  }
  if (v.adjust && t.days) {
    const months = (t.days / r.periodDays) * 12;
    const monthly = Math.ceil(t.sum / months / 100);
    blocks.push(de ? `Auf Grundlage dieser Abrechnung beträgt Ihre monatliche Vorauszahlung${s(v.adjustFrom) ? ` ab dem ${dmy(v.adjustFrom, lang)}` : ''} ${eur(monthly * 100, lang)}.`
      : `Based on this statement your monthly prepayment will be ${eur(monthly * 100, lang)}${s(v.adjustFrom) ? ` from ${dmy(v.adjustFrom, lang)}` : ''}.`);
  }
  if (t.hhd > 0) blocks.push({ kv: [[de ? 'Haushaltsnahe Dienstleistungen (§ 35a EStG)' : 'Household services (German § 35a EStG)', de ? `${eur(t.hhd, lang)} Ihres Anteils – für Ihre Steuererklärung` : `${eur(t.hhd, lang)} of your share – for your tax return`]] });
  blocks.push(de ? 'Die Rechnungen und Belege können Sie nach Absprache bei uns einsehen.' : 'You may inspect the invoices and receipts by arrangement.');
  return {
    sender: [s(v.sName), s(v.sStreet), s(v.sCity)].filter(Boolean), contact: [s(v.sPhone), s(v.sMail)].filter(Boolean),
    recipient: [s(t.name), s(v.hStreet), s(v.hCity)].filter(Boolean),
    dateLine: `${s(v.place) ? s(v.place) + ', ' : ''}${fmtDate(v.letterDate || isoDate(), lang)}`, name: s(v.sName), lang,
    form: 'B', notices: [], info: [], refLine: null,
    subject: de ? `Betriebskostenabrechnung ${P}${s(t.unit) ? ` – ${s(t.unit)}` : ''}` : `Operating cost statement ${P}${s(t.unit) ? ` – ${s(t.unit)}` : ''}`,
    salutation: s(v.salutation), blocks, closing: s(v.closing), signerExtra: [], enclosures: [], cc: [], marks: { folds: true, punch: true },
  };
}

let api = null;

export default {
  labels: { back_to_files: { de: 'Zurück zur Abrechnung', en: 'Back to the statement' } },
  options: [
    { id: 'out', type: 'radio', default: 'one', label: { de: 'Ausgabe', en: 'Output' },
      choices: [{ value: 'one', label: { de: 'Eine PDF für alle Mieter', en: 'One PDF for all tenants' }, hint: { de: 'Zum Drucken', en: 'For printing' } },
        { value: 'zip', label: { de: 'Eine PDF pro Mieter (ZIP)', en: 'One PDF per tenant (ZIP)' }, hint: { de: 'Zum Verschicken per E-Mail', en: 'For sending by e-mail' } }] },
  ],
  mountStage(stage, state, ctx) { api = nkStage(stage, state, ctx); },
  status(values) {
    const v = values.nk;
    if (!v) return { ok: false };
    const r = compute(nkInput(v));
    const named = r.tenancies.filter(t => s(t.name));
    if (r.errors.includes('period')) return { ok: false, hint: { de: 'Wähle den Abrechnungszeitraum.', en: 'Choose the billing period.' } };
    if (r.errors.includes('area')) return { ok: false, hint: { de: 'Trag die Gesamtwohnfläche des Hauses ein.', en: 'Enter the total living area of the house.' } };
    if (!named.length) return { ok: false, hint: { de: 'Trag mindestens einen Mieter ein.', en: 'Enter at least one tenant.' } };
    if (!nkInput(v).items.length) return { ok: false, hint: { de: 'Trag mindestens eine Kostenart mit Betrag ein.', en: 'Enter at least one cost item with an amount.' } };
    if (!s(v.sName)) return { ok: false, hint: { de: 'Noch nötig: dein Name als Vermieter.', en: 'Still needed: your name as landlord.' } };
    return { summary: { de: `${named.length} ${named.length === 1 ? 'Abrechnung' : 'Abrechnungen'}`, en: `${named.length} ${named.length === 1 ? 'statement' : 'statements'}` } };
  },
  async run(inputs, opts, ctx) {
    const v = opts.nk, lang = ctx.lang;
    const r = compute(nkInput(v));
    if (r.errors.includes('period') || r.errors.includes('area')) throw userError('Zeitraum und Gesamtwohnfläche fehlen.', 'Period and total living area are missing.');
    const list = r.tenancies.map((t, i) => ({ t, i })).filter(x => s(x.t.name));
    const sig = await api?.sig();
    const pdfs = [];
    for (const [k, { t, i }] of list.entries()) {
      ctx.progress(k / (list.length + 1), { de: `Abrechnung ${k + 1} von ${list.length}`, en: `Statement ${k + 1} of ${list.length}` });
      await ctx.tick();
      const { bytes } = await letterPdf({ ...modelFor(v, r, i, lang), sig }, { lang });
      pdfs.push({ bytes, name: ctx.safeFileName(`${lang === 'de' ? 'Betriebskostenabrechnung' : 'Operating costs'} ${v.pTo.slice(0, 4)} ${s(t.unit) || ''} ${s(t.name)}`.replace(/\s+/g, ' ').trim()) });
    }
    // overview for the landlord
    const de = lang === 'de';
    const q = x => (/[";\n]/.test(x) ? `"${String(x).replace(/"/g, '""')}"` : x);
    const n2 = c => (c / 100).toFixed(2).replace('.', de ? ',' : '.');
    const lines = [[de ? 'Mieter' : 'Tenant', de ? 'Wohnung' : 'Flat', de ? 'Tage' : 'Days', de ? 'Kosten' : 'Costs', de ? 'Vorauszahlungen' : 'Prepayments', de ? 'Nachzahlung (+) / Guthaben (−)' : 'Due (+) / credit (−)', de ? 'davon § 35a' : 'of which § 35a']];
    for (const { t } of list) lines.push([s(t.name), s(t.unit), String(t.days), n2(t.sum), n2(t.prepaid), n2(t.balance), n2(t.hhd)]);
    lines.push([], [de ? 'Beim Vermieter (Leerstand, eigene Nutzung)' : 'Borne by the landlord (vacancy, own use)', '', '', n2(r.landlord)]);
    const csv = '﻿' + lines.map(l => l.map(c => q(String(c ?? ''))).join(de ? ';' : ',')).join('\r\n') + '\r\n';
    const overview = { name: `${de ? 'Übersicht Betriebskosten' : 'Operating costs overview'} ${v.pTo.slice(0, 4)}.csv`, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), note: de ? 'Für deine Unterlagen' : 'For your records' };
    if (opts.out === 'zip') {
      const { createZip } = await import('../lib/shared/zip.js');
      const zip = await createZip(pdfs.map(p => ({ name: `${p.name}.pdf`, data: p.bytes })));
      return { outputs: [{ name: `${de ? 'Betriebskostenabrechnungen' : 'Operating cost statements'} ${v.pTo.slice(0, 4)}.zip`, blob: new Blob([zip], { type: 'application/zip' }), note: de ? `${pdfs.length} PDF-Dateien` : `${pdfs.length} PDF files` }, overview] };
    }
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    for (const p of pdfs) { const src = await PDFLib.PDFDocument.load(p.bytes); for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg); }
    const bytes = await saveDoc(out, { title: de ? 'Betriebskostenabrechnung' : 'Operating cost statement' });
    return { outputs: [{ name: `${de ? 'Betriebskostenabrechnung' : 'Operating cost statement'} ${v.pTo.slice(0, 4)}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }), pages: out.getPageCount() }, overview] };
  },
};

function nkStage(stage, state, ctx) {
  const lang = ctx.lang, de = lang === 'de';
  const w = (a, b) => (de ? a : b);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEEP) || 'null'); } catch { /* private mode */ }
  const v = (state.values.nk ||= { ...defaults(lang), ...(saved || {}) });
  let pvs = null, current = 0;
  const keep = checkRow({ id: 'nk-keep', label: { de: 'Angaben auf diesem Gerät merken (fürs nächste Jahr)', en: 'Remember on this device (for next year)' }, checked: !!saved, lang,
    hint: { de: 'Ohne Haken wird nichts gespeichert.', en: 'Without the tick nothing is stored.' }, onChange: x => { if (!x) try { localStorage.removeItem(KEEP); } catch { /* ignore */ } persist(); } });
  const persist = () => { if (!keep.querySelector('input').checked) return; try { localStorage.setItem(KEEP, JSON.stringify(v)); } catch { /* full */ } };
  const changed = key => { state.results.clear(); ctx.refresh(); pvs?.refresh(); summary(); persist(); if (key === 'itemsKey') tenants.render(); };
  const f = form(v, lang, k => changed(k), 'nk');

  // ---------------------------------------------------------------- items
  const items = entryList({ items: v.items, lang, max: 30, labels: { add: { de: 'Kostenart hinzufügen', en: 'Add cost item' }, item: (i, it) => s(it.label) || typeLabel(it.type, lang) },
    make: () => ({ id: nid('i'), type: 'sonstige', label: '', amount: '', key: 'area', hhd: false }), onChange: () => changed('itemsKey'),
    render: (it) => f.grid(
      f.select('type', { de: 'Kostenart (§ 2 BetrKV)', en: 'Cost type' }, COST_TYPES.map(c => ({ value: c.id, label: c }) ), { obj: it, onChange: () => items.render() }),
      f.field('label', { de: 'Eigene Bezeichnung (optional)', en: 'Own name (optional)' }, { obj: it, maxLength: 80 }),
      f.select('key', { de: 'Verteilung nach', en: 'Allocate by' }, Object.entries(KEY_LABEL).map(([k, l]) => ({ value: k, label: l })), { obj: it, onChange: () => { changed('itemsKey'); items.render(); } }),
      it.key === 'direct' ? el('p', { class: 'img-muted' }, w('Den Betrag trägst du unten bei jedem Mieter ein.', 'Enter the amount for each tenant below.'))
        : f.field('amount', { de: 'Gesamtkosten im Zeitraum (€)', en: 'Total costs in the period (€)' }, { obj: it, inputmode: 'decimal', maxLength: 14 }),
      f.check('hhd', { de: 'Haushaltsnahe Dienstleistung (§ 35a EStG) ausweisen', en: 'Show as household service (§ 35a EStG)' }, { obj: it })) });

  // ---------------------------------------------------------------- tenants
  const tenants = entryList({ items: v.tenancies, lang, max: 60, labels: { add: { de: 'Mieter hinzufügen', en: 'Add tenant' }, item: (i, t) => [s(t.unit), s(t.name)].filter(Boolean).join(' · ') || w(`Mieter ${i + 1}`, `Tenant ${i + 1}`) },
    make: () => ({ id: nid('t'), name: '', unit: '', area: '', persons: '1', from: '', to: '', prepaid: '', consumption: '', direct: {} }), onChange: () => changed('tenants'),
    render: (t) => {
      t.direct ||= {};
      const usesCons = v.items.some(i => i.key === 'consumption');
      const direct = v.items.filter(i => i.key === 'direct');
      return f.grid(
        f.field('name', { de: 'Name des Mieters', en: 'Tenant name' }, { obj: t, wide: true, maxLength: 120 }),
        f.field('unit', { de: 'Wohnung (z. B. EG links)', en: 'Flat (e.g. ground floor left)' }, { obj: t, maxLength: 60 }),
        f.field('area', { de: 'Wohnfläche m²', en: 'Living area m²' }, { obj: t, inputmode: 'decimal', maxLength: 10 }),
        f.field('persons', { de: 'Personen', en: 'Persons' }, { obj: t, inputmode: 'numeric', maxLength: 3 }),
        f.field('prepaid', { de: 'Vorauszahlungen im Zeitraum (€)', en: 'Prepayments in the period (€)' }, { obj: t, inputmode: 'decimal', maxLength: 14 }),
        f.field('from', { de: 'Einzug (falls im Zeitraum)', en: 'Moved in (if in the period)' }, { obj: t, type: 'date' }),
        f.field('to', { de: 'Auszug (falls im Zeitraum)', en: 'Moved out (if in the period)' }, { obj: t, type: 'date' }),
        usesCons ? f.field('consumption', { de: 'Verbrauch laut Zähler', en: 'Meter consumption' }, { obj: t, inputmode: 'decimal', maxLength: 12 }) : null,
        ...direct.map(i => f.field(i.id, { de: `${s(i.label) || typeLabel(i.type, lang)} (€)`, en: `${s(i.label) || typeLabel(i.type, lang)} (€)` }, { obj: t.direct, inputmode: 'decimal', maxLength: 14 })));
    } });

  // ---------------------------------------------------------------- summary for the landlord
  const sumBox = el('div', { class: 'nk-sum', id: 'nk-sum', aria: { live: 'polite' } });
  function summary() {
    const r = compute(nkInput(v));
    clear(sumBox);
    const warn = text => sumBox.append(el('p', { class: 'img-note' }, text));
    if (r.errors.includes('period-long')) warn(w('Der Abrechnungszeitraum darf höchstens 12 Monate lang sein.', 'The billing period may be at most 12 months.'));
    if (r.errors.includes('area-sum')) warn(w('Die Wohnungen sind zusammen größer als die Gesamtwohnfläche – bitte prüfen.', 'The flats add up to more than the total living area – please check.'));
    if (r.errors.includes('units')) warn(w('Für die Verteilung nach Wohnungen fehlt die Zahl der Wohnungen im Haus.', 'The number of flats in the house is missing for the per-flat key.'));
    const named = r.tenancies.filter(t => s(t.name));
    if (!named.length || r.errors.includes('period') || r.errors.includes('area')) return;
    const tb = el('table', { class: 'mm-table nk-table' }, el('thead', {}, el('tr', {}, [w('Mieter', 'Tenant'), w('Tage', 'Days'), w('Kosten', 'Costs'), w('Vorauszahlung', 'Prepaid'), w('Ergebnis', 'Result')].map(h => el('th', {}, h)))),
      el('tbody', {}, named.map(t => el('tr', {}, el('td', {}, [s(t.unit), s(t.name)].filter(Boolean).join(' · ')), el('td', {}, String(t.days)), el('td', {}, eur(t.sum, lang)), el('td', {}, eur(t.prepaid, lang)),
        el('td', { class: t.balance > 0 ? 'nk-due' : 'nk-credit' }, `${t.balance > 0 ? w('Nachzahlung', 'Due') : w('Guthaben', 'Credit')} ${eur(Math.abs(t.balance), lang)}`)))));
    sumBox.append(el('div', { class: 'mm-table-wrap' }, tb));
    sumBox.append(el('p', { class: 'img-muted' }, w(`Beim Vermieter bleiben ${eur(r.landlord, lang)} (Leerstand, eigene Nutzung, Rundung).`, `${eur(r.landlord, lang)} stay with the landlord (vacancy, own use, rounding).`)));
    const dl = deadline(v.pTo);
    if (dl) sumBox.append(el('p', { class: 'img-muted' }, w(`Frist: Die Abrechnung muss den Mietern bis zum ${dmy(dl, lang)} zugehen – danach ist keine Nachforderung mehr möglich (§ 556 Abs. 3 BGB).`, `Deadline: tenants must receive the statement by ${dmy(dl, lang)} – after that no back payment can be claimed (German § 556 (3) BGB).`)));
  }

  const adjustBox = el('div', { hidden: !v.adjust }, f.field('adjustFrom', { de: 'Neue Vorauszahlung ab', en: 'New prepayment from' }, { type: 'date' }));
  const sender = senderSection(f, v, lang, { title: { de: 'Vermieter', en: 'Landlord' } });
  const sig = signatureSection(f, lang, () => changed('sig'));
  const pos = el('span', { class: 'mm-pos', id: 'nk-pos' });
  const go = d => { const n = v.tenancies.length; if (!n) return; current = (current + d + n) % n; pos.textContent = `${current + 1} / ${n}`; pvs?.refresh(); };
  const stepper = el('div', { class: 'mm-step' },
    el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', id: 'nk-prev', aria: { label: w('Vorheriger Mieter', 'Previous tenant') }, onclick: () => go(-1) }, '‹'), pos,
    el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', id: 'nk-next', aria: { label: w('Nächster Mieter', 'Next tenant') }, onclick: () => go(1) }, '›'));
  pvs = previewSection(f, lang, () => { const r = compute(nkInput(v)); current = Math.min(current, Math.max(0, r.tenancies.length - 1)); pos.textContent = `${current + 1} / ${r.tenancies.length}`; return modelFor(v, r, current, lang); }, () => sig.pad.export());

  stage.append(el('div', { class: 'tpl-split' }, el('div', {},
    f.sec('nk-h-period', { de: 'Zeitraum und Haus', en: 'Period and house' },
      f.grid(f.field('pFrom', { de: 'Abrechnungszeitraum von', en: 'Billing period from' }, { type: 'date' }), f.field('pTo', { de: 'bis', en: 'to' }, { type: 'date' }),
        f.field('hStreet', { de: 'Straße und Hausnummer des Hauses', en: 'Street of the house' }, { wide: true }), f.field('hCity', { de: 'PLZ und Ort', en: 'Postcode and town' }),
        f.field('hArea', { de: 'Gesamtwohnfläche des Hauses (m²)', en: 'Total living area of the house (m²)' }, { inputmode: 'decimal', hint: { de: 'Alle Wohnungen, auch leere und selbst bewohnte.', en: 'All flats, including empty and owner-occupied ones.' } }),
        f.field('hUnits', { de: 'Anzahl Wohnungen', en: 'Number of flats' }, { inputmode: 'numeric' }),
        f.field('hPersons', { de: 'Personen im Haus (optional)', en: 'Persons in the house (optional)' }, { inputmode: 'numeric', hint: { de: 'Nur nötig, wenn auch du oder andere ohne Abrechnung dort wohnen. Sonst zählen die Personentage der Mieter.', en: 'Only needed if you or others without a statement live there too. Otherwise the tenants’ person-days count.' } }),
        f.field('hCons', { de: 'Gesamtverbrauch (optional)', en: 'Total consumption (optional)' }, { inputmode: 'decimal', hint: { de: 'Leer = Summe der Mieterzähler.', en: 'Empty = sum of the tenants’ meters.' } }))),
    f.sec('nk-h-items', { de: 'Kosten', en: 'Costs' }, el('p', { class: 'img-muted' }, w('Nur umlagefähige Betriebskosten, die im Mietvertrag vereinbart sind. Reparaturen und Verwaltung gehören nicht hinein. Kostenarten ohne Betrag fallen weg.', 'Only operating costs that may be passed on and are agreed in the lease. Repairs and administration don’t belong here. Items without an amount are left out.')), items.root),
    f.sec('nk-h-tenants', { de: 'Mieter', en: 'Tenants' }, el('p', { class: 'img-muted' }, w('Bei einem Mieterwechsel trägst du beide Mieter mit Aus- und Einzugsdatum ein – die Kosten werden nach Tagen geteilt.', 'For a change of tenant, enter both tenants with move-out and move-in dates – the costs are split by days.')), tenants.root),
    f.sec('nk-h-letter', { de: 'Schreiben', en: 'Letter' },
      f.field('salutation', { de: 'Anrede', en: 'Salutation' }, { wide: true }),
      f.grid(f.field('iban', { de: 'Dein Konto für Nachzahlungen (IBAN)', en: 'Your account for payments (IBAN)' }, { wide: true, maxLength: 42 }), f.field('payDays', { de: 'Zahlungsziel in Tagen', en: 'Payment term in days' }, { inputmode: 'numeric', maxLength: 3 })),
      f.seg('creditMode', { de: 'Guthaben', en: 'Credit' }, [{ value: 'transfer', label: { de: 'Überweisen', en: 'Transfer' } }, { value: 'offset', label: { de: 'Mit Miete verrechnen', en: 'Offset with rent' } }]),
      f.check('adjust', { de: 'Neue monatliche Vorauszahlung vorschlagen', en: 'Propose a new monthly prepayment' }, { onChange: () => { adjustBox.hidden = !v.adjust; } }),
      adjustBox,
      f.field('closing', { de: 'Grußformel', en: 'Closing' }, { wide: true })),
    sender.sec, sig.sec,
    f.sec('nk-h-sum', { de: 'Übersicht', en: 'Overview' }, sumBox, keep)),
  el('div', { class: 'tpl-side' }, el('div', { class: 'mm-pvhead' }, el('span', { class: 'img-muted' }, w('Vorschau für Mieter', 'Preview for tenant')), stepper), pvs.sec)));
  summary(); pvs.refresh(); ctx.refresh();
  return { sig: () => sig.pad.export() };
}
