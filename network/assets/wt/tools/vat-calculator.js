// Tool: VAT calculator (Mehrwertsteuer-Rechner). Net → gross, gross → net, or from the tax amount; 19 % / 7 %
// and Austria / Switzerland, own rate. Cent-exact rounding (the tax is gross minus net, so the parts always add
// up). Several line items: totals per rate, with the rounding difference between "per line" and "on the total"
// shown instead of hidden – the classic surprise on invoices. Primary action: the items as CSV.
import { el, clear } from '../lib/dom.js';
import { T, calcCss, parseNum, money, fmt, cents, field, segmented, copyBtn, liveRegion, warn } from '../lib/calc-core.js';

calcCss();
const COUNTRIES = {
  DE: { cur: 'EUR', rates: [19, 7, 0], label: { de: 'Deutschland', en: 'Germany' } },
  AT: { cur: 'EUR', rates: [20, 13, 10, 0], label: { de: 'Österreich', en: 'Austria' } },
  CH: { cur: 'CHF', rates: [8.1, 3.8, 2.6, 0], label: { de: 'Schweiz', en: 'Switzerland' } },
};
const DIRS = [
  { value: 'net', label: { de: 'Netto → Brutto', en: 'Net → gross' } },
  { value: 'gross', label: { de: 'Brutto → Netto', en: 'Gross → net' } },
  { value: 'tax', label: { de: 'Aus der Steuer', en: 'From the tax' } },
];

/** One amount → { net, tax, gross } in cents-rounded values (null when the input is not usable). */
export function vat(amount, rate, dir) {
  const r = rate / 100;
  if (!Number.isFinite(amount) || !Number.isFinite(r) || r < 0) return null;
  if (dir === 'gross') { const net = cents(amount / (1 + r)); return { net, tax: cents(amount - net), gross: cents(amount) }; }
  if (dir === 'tax') { if (!r) return null; const net = cents(amount / r); return { net, tax: cents(amount), gross: cents(net + amount) }; }
  const net = cents(amount), tax = cents(net * r);
  return { net, tax, gross: cents(net + tax) };
}

let ctl = null;
export default {
  labels: { back_to_files: { de: 'Zurück zum Rechner', en: 'Back to the calculator' } },
  mountStage(stage, state, ctx) { ctl = vatStage(stage, state, ctx); },
  status(v) {
    if (!(v.vatRows || []).length) return { ok: false, hint: { de: 'Gib einen Betrag ein.', en: 'Enter an amount.' } };
    return { summary: { de: `Brutto ${money(v.vatTotal, v.vatCur, 'de')}`, en: `Gross ${money(v.vatTotal, v.vatCur, 'en')}` } };
  },
  async run(inputs, opts, ctx) {
    const rows = opts.vatRows || [];
    const de = ctx.lang === 'de';
    const q = s => (/[;"\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    const n = x => x.toFixed(2).replace('.', de ? ',' : '.');
    const head = de ? ['Position', 'Steuersatz %', 'Netto', 'MwSt', 'Brutto'] : ['Item', 'Rate %', 'Net', 'VAT', 'Gross'];
    const lines = [head.join(';'), ...rows.map(r => [q(r.name), String(r.rate).replace('.', de ? ',' : '.'), n(r.net), n(r.tax), n(r.gross)].join(';'))];
    const tot = rows.reduce((s, r) => ({ net: s.net + r.net, tax: s.tax + r.tax, gross: s.gross + r.gross }), { net: 0, tax: 0, gross: 0 });
    lines.push([de ? 'Summe' : 'Total', '', n(cents(tot.net)), n(cents(tot.tax)), n(cents(tot.gross))].join(';'));
    return { outputs: [{ name: de ? 'Mehrwertsteuer.csv' : 'VAT.csv', blob: new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }) }] };
  },
};

function vatStage(stage, state, ctx) {
  const v = state.values;
  const lang = ctx.lang;
  const st = { country: 'DE', dir: 'net', rate: 19, custom: '', items: [{ name: '', amount: '', rate: 19 }] };
  const live = liveRegion();
  const countrySel = el('select', { class: 'wt-input', id: 'vat-country', aria: { label: T({ de: 'Land', en: 'Country' }) } },
    Object.entries(COUNTRIES).map(([k, c]) => el('option', { value: k }, T(c.label))));
  countrySel.addEventListener('change', () => { st.country = countrySel.value; st.rate = COUNTRIES[st.country].rates[0]; st.items.forEach(i => { i.rate = st.rate; }); buildRates(); render(); });
  const dirSeg = segmented({ name: 'vat-dir', label: T({ de: 'Rechenrichtung', en: 'Direction' }), choices: DIRS.map(d => ({ value: d.value, label: T(d.label) })), value: st.dir,
    onChange: d => { st.dir = d; render(); } });
  const rateBox = el('div', { class: 'calc-field' });
  const custom = field({ id: 'vat-custom', label: T({ de: 'Eigener Steuersatz', en: 'Own rate' }), suffix: '%', onInput: x => { st.custom = x; const r = parseNum(x, lang); if (Number.isFinite(r)) { st.rate = r; } render(); } });
  custom.wrap.hidden = true;
  function buildRates() {
    clear(rateBox);
    const choices = [...COUNTRIES[st.country].rates.map(r => ({ value: String(r), label: `${fmt(r, { max: 1 })} %` })), { value: 'own', label: T({ de: 'Eigener', en: 'Other' }) }];
    rateBox.append(el('span', { class: 'calc-label', id: 'vat-rate-l' }, T({ de: 'Steuersatz', en: 'VAT rate' })),
      segmented({ name: 'vat-rate', label: T({ de: 'Steuersatz', en: 'VAT rate' }), choices, value: String(st.rate), onChange: r => {
        custom.wrap.hidden = r !== 'own';
        if (r === 'own') { custom.input.focus(); const x = parseNum(st.custom, lang); if (Number.isFinite(x)) st.rate = x; }
        else st.rate = Number(r);
        render();
      } }));
  }
  buildRates();
  const amount = field({ id: 'vat-amount', label: T({ de: 'Betrag', en: 'Amount' }), suffix: '€', onInput: x => { st.items[0].amount = x; render(); } });
  const amountLabel = amount.wrap.querySelector('label');
  const out = el('div', { class: 'calc-out', aria: { live: 'polite' } });
  const way = el('p', { class: 'calc-way' });
  const err = el('div');

  // several line items
  const itemsBody = el('tbody');
  const totals = el('div', { class: 'calc-out' });
  const addBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { st.items.push({ name: '', amount: '', rate: st.rate }); render(true); itemsBody.lastChild?.querySelector('input')?.focus(); } },
    T({ de: '+ Position hinzufügen', en: '+ Add item' }));
  const multi = el('details', { class: 'calc-card vat-multi' },
    el('summary', {}, el('strong', {}, T({ de: 'Mehrere Positionen (Rechnung)', en: 'Several items (invoice)' }))),
    el('p', { class: 'calc-hint' }, T({ de: 'Für Rechnungen mit mehreren Posten oder Steuersätzen. Die erste Zeile ist der Betrag von oben.', en: 'For invoices with several items or rates. The first row is the amount above.' })),
    el('div', { class: 'calc-table-wrap' }, el('table', { class: 'calc-table' },
      el('thead', {}, el('tr', {}, el('th', {}, T({ de: 'Position', en: 'Item' })), el('th', { class: 'num' }, T({ de: 'Betrag', en: 'Amount' })), el('th', {}, T({ de: 'Satz', en: 'Rate' })), el('th', { class: 'num' }, T({ de: 'Brutto', en: 'Gross' })), el('th', {}, ''))),
      itemsBody)),
    el('div', { class: 'calc-actions' }, addBtn), totals);
  multi.addEventListener('toggle', () => render(true));

  const card = el('section', { class: 'img-box calc', aria: { labelledby: 'vat-h' } },
    el('h2', { class: 'img-h', id: 'vat-h' }, T({ de: 'Mehrwertsteuer berechnen', en: 'Calculate VAT' })),
    el('div', { class: 'calc-grid calc-grid-2' }, el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'vat-country' }, T({ de: 'Land', en: 'Country' })), countrySel),
      el('div', { class: 'calc-field' }, el('span', { class: 'calc-label' }, T({ de: 'Rechenrichtung', en: 'Direction' })), dirSeg)),
    rateBox, custom.wrap, amount.wrap, err, out, way, multi, live);
  stage.append(card);

  const rowOut = (label, value, main = false) => el('div', { class: 'calc-row' + (main ? ' is-main' : '') },
    el('span', { class: 'calc-row-label' }, label), el('span', { class: 'calc-row-val' }, value),
    copyBtn(() => value.replace(/[^\d,.-]/g, ''), T({ de: `${label} kopieren`, en: `Copy ${label}` }), live));

  function itemRows() {
    clear(itemsBody);
    st.items.forEach((it, i) => {
      if (i === 0) { it.rate = st.rate; }
      const name = el('input', { class: 'wt-input', value: it.name, placeholder: i === 0 ? T({ de: 'Betrag oben', en: 'Amount above' }) : T({ de: `Position ${i + 1}`, en: `Item ${i + 1}` }), aria: { label: T({ de: `Bezeichnung Position ${i + 1}`, en: `Name of item ${i + 1}` }) } });
      name.addEventListener('input', () => { it.name = name.value; sync(); });
      const amt = el('input', { class: 'wt-input calc-in', value: it.amount, inputmode: 'decimal', disabled: i === 0, aria: { label: T({ de: `Betrag Position ${i + 1}`, en: `Amount of item ${i + 1}` }) } });
      amt.addEventListener('input', () => { it.amount = amt.value; sync(); });
      const rsel = el('select', { class: 'wt-input', disabled: i === 0, aria: { label: T({ de: `Steuersatz Position ${i + 1}`, en: `Rate of item ${i + 1}` }) } },
        [...new Set([...COUNTRIES[st.country].rates, st.rate])].map(r => el('option', { value: String(r), selected: r === it.rate }, `${fmt(r, { max: 1 })} %`)));
      rsel.addEventListener('change', () => { it.rate = Number(rsel.value); sync(); });
      const gross = el('td', { class: 'num' });
      const rm = i === 0 ? el('span') : el('button', { type: 'button', class: 'wt-rm', aria: { label: T({ de: `Position ${i + 1} entfernen`, en: `Remove item ${i + 1}` }) }, onclick: () => { st.items.splice(i, 1); render(true); } }, '×');
      it._gross = gross;
      itemsBody.append(el('tr', {}, el('td', {}, name), el('td', { class: 'num' }, amt), el('td', {}, rsel), gross, el('td', {}, rm)));
    });
  }

  let lastItems = -1;
  function render(rebuildItems = false) {
    const cur = COUNTRIES[st.country].cur;
    amount.wrap.querySelector('.calc-suffix').textContent = cur === 'EUR' ? '€' : 'CHF';
    amountLabel.textContent = st.dir === 'net' ? T({ de: 'Nettobetrag', en: 'Net amount' }) : st.dir === 'gross' ? T({ de: 'Bruttobetrag', en: 'Gross amount' }) : T({ de: 'Steuerbetrag', en: 'Tax amount' });
    if (rebuildItems || lastItems !== st.items.length) { itemRows(); lastItems = st.items.length; }
    else if (st.items[0]) { const tr = itemsBody.firstChild; if (tr) tr.querySelector('.calc-in').value = st.items[0].amount; }
    sync();
  }

  function sync() {
    const cur = COUNTRIES[st.country].cur;
    clear(out); clear(err); clear(totals);
    const a = parseNum(st.items[0].amount, lang);
    const r = vat(a, st.rate, st.dir);
    if (st.items[0].amount.trim() && !Number.isFinite(a)) err.append(warn(T({ de: 'Das ist keine Zahl. Beispiel: 1.234,56', en: 'That is not a number. Example: 1,234.56' })));
    if (st.dir === 'tax' && st.rate === 0) err.append(warn(T({ de: 'Bei 0 % lässt sich aus der Steuer kein Betrag berechnen.', en: 'With 0 % no amount can be worked out from the tax.' })));
    const rateTxt = `${fmt(st.rate, { max: 2 })} %`;
    if (r) {
      out.append(rowOut(T({ de: 'Netto', en: 'Net' }), money(r.net, cur, lang), st.dir === 'gross'),
        rowOut(T({ de: `MwSt (${rateTxt})`, en: `VAT (${rateTxt})` }), money(r.tax, cur, lang)),
        rowOut(T({ de: 'Brutto', en: 'Gross' }), money(r.gross, cur, lang), st.dir !== 'gross'));
      const f = (st.rate / 100 + 1).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: 4 });
      way.textContent = st.dir === 'net'
        ? T({ de: `${money(r.net, cur, lang)} × ${rateTxt} = ${money(r.tax, cur, lang)} Steuer · ${money(r.net, cur, lang)} + ${money(r.tax, cur, lang)} = ${money(r.gross, cur, lang)}`, en: `${money(r.net, cur, lang)} × ${rateTxt} = ${money(r.tax, cur, lang)} VAT · ${money(r.net, cur, lang)} + ${money(r.tax, cur, lang)} = ${money(r.gross, cur, lang)}` })
        : st.dir === 'gross'
          ? T({ de: `${money(r.gross, cur, lang)} ÷ ${f} = ${money(r.net, cur, lang)} netto · Steuer = Brutto − Netto = ${money(r.tax, cur, lang)}`, en: `${money(r.gross, cur, lang)} ÷ ${f} = ${money(r.net, cur, lang)} net · VAT = gross − net = ${money(r.tax, cur, lang)}` })
          : T({ de: `${money(r.tax, cur, lang)} ÷ ${rateTxt} = ${money(r.net, cur, lang)} netto · + Steuer = ${money(r.gross, cur, lang)}`, en: `${money(r.tax, cur, lang)} ÷ ${rateTxt} = ${money(r.net, cur, lang)} net · + VAT = ${money(r.gross, cur, lang)}` });
      way.hidden = false;
    } else way.hidden = true;

    // items: per-line rounding vs. rounding on the total, per rate
    const rows = [];
    (multi.open ? st.items : st.items.slice(0, 1)).forEach((it, i) => {
      const amt = parseNum(i === 0 ? st.items[0].amount : it.amount, lang);
      const rr = vat(amt, i === 0 ? st.rate : it.rate, st.dir);
      if (it._gross) it._gross.textContent = rr ? money(rr.gross, cur, lang) : '–';
      if (rr) rows.push({ name: it.name || (i === 0 ? T({ de: 'Betrag', en: 'Amount' }) : T({ de: `Position ${i + 1}`, en: `Item ${i + 1}` })), rate: i === 0 ? st.rate : it.rate, raw: amt, ...rr });
    });
    if (multi.open && rows.length) {
      const byRate = new Map();
      for (const x of rows) { const g = byRate.get(x.rate) || { net: 0, tax: 0, gross: 0, raw: 0 }; g.net += x.net; g.tax += x.tax; g.gross += x.gross; g.raw += x.raw; byRate.set(x.rate, g); }
      let diffNote = null;
      for (const [rate, g] of byRate) {
        totals.append(el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, T({ de: `Netto ${fmt(rate, { max: 2 })} %`, en: `Net ${fmt(rate, { max: 2 })} %` })), el('span', { class: 'calc-row-val' }, money(cents(g.net), cur, lang))),
          el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, T({ de: `MwSt ${fmt(rate, { max: 2 })} %`, en: `VAT ${fmt(rate, { max: 2 })} %` })), el('span', { class: 'calc-row-val' }, money(cents(g.tax), cur, lang))));
        const once = vat(g.raw, rate, st.dir);
        if (once && Math.abs(once.tax - cents(g.tax)) >= 0.005) diffNote = { rate, line: cents(g.tax), total: once.tax };
      }
      const tot = rows.reduce((s, x) => s + x.gross, 0);
      totals.append(el('div', { class: 'calc-row is-main' }, el('span', { class: 'calc-row-label' }, T({ de: 'Gesamt brutto', en: 'Total gross' })), el('span', { class: 'calc-row-val' }, money(cents(tot), cur, lang))));
      if (diffNote) totals.append(warn(T({
        de: `Rundungsdifferenz bei ${fmt(diffNote.rate, { max: 2 })} %: Steuer je Position gerundet ${money(diffNote.line, cur, lang)}, auf die Summe gerechnet ${money(diffNote.total, cur, lang)}. Beides ist zulässig – entscheide dich für eine Methode und bleib dabei.`,
        en: `Rounding difference at ${fmt(diffNote.rate, { max: 2 })} %: VAT rounded per item ${money(diffNote.line, cur, lang)}, on the total ${money(diffNote.total, cur, lang)}. Both are allowed – pick one method and stick to it.` })));
    }
    v.vatRows = rows;
    v.vatCur = cur;
    v.vatTotal = cents(rows.reduce((s, x) => s + x.gross, 0));
    state.results.clear();
    ctx.refresh();
  }
  render(true);
  setTimeout(() => amount.input.focus({ preventScroll: true }), 50);
  return { render };
}
