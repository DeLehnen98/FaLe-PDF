// New spreadsheet templates (Jahreskalender … Geschenkeliste): build + recalc each one and compare key cells with
// values computed independently here (plain JS date arithmetic / hand calculations). Exit code 1 on any failure.
//   node tests/suites/office_tpl/sheet_values.mjs
const ROOT = new URL('../../../js/office/', import.meta.url).href;
const T = await import(ROOT + 'sheet-templates.js');
const W = await import(ROOT + 'workbook.js');
const F = await import(ROOT + 'formula.js');
const FX = await import(ROOT + 'sheetfx.js');

// HEUTE() uses the clock, so the templates are built for the same day
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const Y = today.getFullYear();
const serial = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
const D = (y, m, d) => new Date(y, m - 1, d);
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// EDATE: same day n months later, clamped to the month's last day
const edate = (d, n) => { const t = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)); };
const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 86400000 + 1) / 7); };
const easter = y => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); const mo = Math.floor((h + l - 7 * m + 114) / 31); return D(y, mo, ((h + l - 7 * m + 114) % 31) + 1); };

let fails = 0, passes = 0;
const ok = (name, cond, info = '') => { if (cond) passes++; else { fails++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, eps = 0.005) => typeof a === 'number' && Math.abs(a - b) <= eps;

function build(id) {
  const t0 = Date.now();
  const wb = T.buildSheetTemplate(id, { today });
  wb.sheets.forEach(s => { FX.ensureSheetExtras(s); W.ensureSheetModel(s); });
  W.recalc(wb);
  const ms = Date.now() - t0;
  const errs = [];
  wb.sheets.forEach(sh => { for (const [k, c] of sh.cells) { const v = c.f ? c.cv : c.v; if (v && v.code) errs.push(`${sh.name}!${F.addr(W.R_OF(k), W.C_OF(k))}=${v.code}`); } });
  ok(`${id}: no formula errors`, !errs.length && !(wb._circ && wb._circ.length), errs.slice(0, 5).join(' '));
  ok(`${id}: builds + recalcs fast (${ms} ms)`, ms < 4000);
  return wb;
}
const sheetOf = (wb, name) => wb.sheets.find(s => s.name === name);
const val = (wb, ref) => { const [sn, a] = ref.split('!'); const sh = sheetOf(wb, sn); const p = F.parseAddr(a); const c = W.getCell(sh, p.r, p.c); return c ? (c.f ? c.cv : c.v) : null; };
const txt = (wb, ref) => { const [sn, a] = ref.split('!'); const sh = sheetOf(wb, sn); const p = F.parseAddr(a); return W.displayOf(W.getCell(sh, p.r, p.c)); };
const put = (wb, ref, v) => { const [sn, a] = ref.split('!'); const sh = sheetOf(wb, sn); const p = F.parseAddr(a); const c = W.getCell(sh, p.r, p.c) || {}; W.setCell(sh, p.r, p.c, { ...c, v, f: undefined, cv: undefined }); W.recalc(wb); };
const eq = (name, got, exp) => ok(name, typeof exp === 'number' ? near(got, exp) : got === exp, `got ${JSON.stringify(got)} expected ${JSON.stringify(exp)}`);

const NEW = ['jahreskalender', 'wochenplaner', 'abo-vertraege', 'schuldenabbau', 'rechnung-tabelle', 'reisebudget', 'bewerbungstracker', 'geschenkeliste'];
for (const id of NEW) ok(`${id}: listed in the gallery`, T.SHEET_TEMPLATE_LIST.some(t => t.id === id && t.title && t.desc && T.SHEET_TEMPLATE_CATS.includes(t.cat)));

// ---------------------------------------------------------------- Jahreskalender
{
  const wb = build('jahreskalender');
  const sh = sheetOf(wb, 'Kalender');
  ok('kalender: conditional formats + validation', sh.cf.length >= 8 && sh.dv.length >= 1);
  const check = year => {
    eq(`kalender ${year}: title`, val(wb, 'Kalender!A1'), `Jahreskalender ${year}`);
    for (let m = 1; m <= 12; m++) {
      const k = Math.floor((m - 1) / 3), b = (m - 1) % 3, r0 = 5 + k * 9, c0 = b * 9;
      const first = D(year, m, 1), wd = (first.getDay() + 6) % 7;
      const cell = `Kalender!${F.colName(c0 + 1 + wd)}${r0 + 2}`;
      eq(`kalender ${year}: 1.${m}. in the right weekday column`, val(wb, cell), serial(first));
      eq(`kalender ${year}: KW of the first row of month ${m}`, val(wb, `Kalender!${F.colName(c0)}${r0 + 2}`), isoWeek(addDays(first, -wd)));
      if (wd > 0) eq(`kalender ${year}: day before the 1.${m}. stays empty`, val(wb, `Kalender!${F.colName(c0 + wd)}${r0 + 2}`), '');
      // last day of the month
      const lastD = new Date(year, m, 0), n = wd + lastD.getDate() - 1;
      eq(`kalender ${year}: last day of month ${m}`, val(wb, `Kalender!${F.colName(c0 + 1 + (n % 7))}${r0 + 2 + Math.floor(n / 7)}`), serial(lastD));
    }
    eq(`kalender ${year}: Ostersonntag`, val(wb, 'Kalender!AC7'), serial(easter(year)));
    eq(`kalender ${year}: Pfingstmontag`, val(wb, 'Kalender!AC11'), serial(addDays(easter(year), 50)));
  };
  check(Y);
  // today is in the grid (CF "strong" marks it)
  let found = false;
  for (const [k, c] of sh.cells) if (c.f && c.cv === serial(today)) { found = true; void k; }
  ok('kalender: today appears in the grid', found);
  put(wb, 'Kalender!D3', 2027); check(2027);
  put(wb, 'Kalender!D3', serial(D(2028, 6, 15))); check(2028); // a date in the year works too
}

// ---------------------------------------------------------------- Wochenplaner
{
  const wb = build('wochenplaner');
  const mon = addDays(today, -((today.getDay() + 6) % 7));
  eq('woche: Monday in B5', val(wb, 'Woche!B5'), serial(mon));
  eq('woche: Sunday in H5', val(wb, 'Woche!H5'), serial(addDays(mon, 6)));
  eq('woche: calendar week', val(wb, 'Woche!C3'), `KW ${isoWeek(today)}`);
  eq('woche: progress 2 of 5 done', val(wb, 'Woche!L22'), 0.4);
  put(wb, 'Woche!B3', serial(addDays(mon, 9))); // a Wednesday of the following week
  eq('woche: any day of the week → Monday', val(wb, 'Woche!B5'), serial(addDays(mon, 7)));
}

// ---------------------------------------------------------------- Abo- & Vertragsübersicht
{
  const wb = build('abo-vertraege');
  const sh = sheetOf(wb, 'Verträge');
  ok('abo: CF + DV + chart', sh.cf.length >= 6 && sh.dv.length >= 4 && sh.charts.length === 1);
  const fromSerial = s => new Date(Date.UTC(1899, 11, 30) + s * 86400000);
  const local = s => { const u = fromSerial(s); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()); };
  let soon = 0;
  for (let r = 5; r <= 16; r++) {
    const g = val(wb, `Verträge!G${r}`), H = val(wb, `Verträge!H${r}`), I = val(wb, `Verträge!I${r}`), J = val(wb, `Verträge!J${r}`) || 0, st = val(wb, `Verträge!O${r}`);
    if (typeof g !== 'number' || typeof H !== 'number') { eq(`abo row ${r}: no term → no end`, val(wb, `Verträge!K${r}`), ''); continue; }
    const G = local(g);
    // next contract end (independent): first end G+H months − 1 day, then renew by I months until it is today or later
    let K;
    if (!I) K = addDays(edate(G, H), -1);
    else { let x = H; while (addDays(edate(G, x), -1) < today) x += I; K = addDays(edate(G, x), -1); }
    let L = K;
    if (I && edate(K, -J) < today) L = addDays(edate(addDays(K, 1), I), -1);
    const M = edate(L, -J);
    eq(`abo row ${r}: Nächstes Vertragsende`, val(wb, `Verträge!K${r}`), serial(K));
    eq(`abo row ${r}: Kündbar zum`, val(wb, `Verträge!L${r}`), serial(L));
    eq(`abo row ${r}: Kündigen bis`, val(wb, `Verträge!M${r}`), serial(M));
    const days = Math.round((M - today) / 86400000);
    eq(`abo row ${r}: In Tagen`, val(wb, `Verträge!N${r}`), st === 'Aktiv' ? days : '');
    if (st === 'Aktiv' && days >= 0 && days <= 30) soon++;
  }
  // hand calculation: active contracts per month 29,99 + 13,99 + 34,90 + 480/12 + 64,50/12 + 95 + 39,99 + 59,90/12 + 55,08·4/12 + 2,99
  eq('abo: cost per month (active)', val(wb, 'Verträge!S12'), 285.5866667);
  eq('abo: cost per year (active)', val(wb, 'Verträge!S13'), 3427.04);
  eq('abo: active contracts', val(wb, 'Verträge!S14'), 10);
  eq('abo: deadlines within 30 days', val(wb, 'Verträge!S15'), soon);
  eq('abo: saved by cancelling (10,99 × 12)', val(wb, 'Verträge!S16'), 131.88);
  eq('abo: category Versicherung per month (40 + 5,375)', val(wb, 'Verträge!S20'), 45.375);
  eq('abo: monthly from quarterly (Rundfunk 55,08 × 4 / 12)', val(wb, 'Verträge!E14'), 18.36);
}

// ---------------------------------------------------------------- Schuldenabbau
{
  const wb = build('schuldenabbau');
  // expected values from an independent month-by-month simulation (minimum rates first, extra money in priority order, cents rounded)
  const expect = (label, months, interest, total) => {
    months.forEach((m, i) => eq(`schulden ${label}: debt ${i + 1} paid off after`, val(wb, `Übersicht!F${8 + i}`), m));
    interest.forEach((x, i) => eq(`schulden ${label}: debt ${i + 1} interest`, val(wb, `Übersicht!H${8 + i}`), x));
    eq(`schulden ${label}: total interest`, val(wb, 'Übersicht!H13'), total);
    eq(`schulden ${label}: debt-free after`, val(wb, 'Übersicht!F13'), Math.max(...months));
  };
  eq('schulden: Schneeball order (smallest balance first)', [8, 9, 10, 11].map(r => val(wb, `Übersicht!E${r}`)).join(','), '3,1,4,2');
  expect('Schneeball', [17, 7, 26, 11], [381.04, 34.9, 505.59, 0], 921.53);
  eq('schulden: first month pays the whole budget', val(wb, 'Tilgungsplan!M6'), 450);
  eq('schulden: extra per month', val(wb, 'Übersicht!B15'), 100);
  put(wb, 'Übersicht!B3', 'Lawine');
  eq('schulden: Lawine order (highest rate first)', [8, 9, 10, 11].map(r => val(wb, `Übersicht!E${r}`)).join(','), '1,2,3,4');
  expect('Lawine', [13, 15, 25, 24], [209.03, 90.76, 491.67, 0], 791.46);
  put(wb, 'Übersicht!B4', 300);
  ok('schulden: warning when the budget is below the minimum rates', String(val(wb, 'Übersicht!A17')).startsWith('Achtung'));
}

// ---------------------------------------------------------------- Rechnung (Tabelle)
{
  const wb = build('rechnung-tabelle');
  // 3 × 85 + 250 + 89 = 594 at 19 %, 2 × 12,50 = 25 at 7 %
  eq('rechnung: net', val(wb, 'Rechnung!G30'), 619);
  eq('rechnung: VAT 19 %', val(wb, 'Rechnung!G31'), 112.86);
  eq('rechnung: VAT 7 %', val(wb, 'Rechnung!G32'), 1.75);
  eq('rechnung: total', val(wb, 'Rechnung!G33'), 733.61);
  eq('rechnung: due date = invoice date + 14', val(wb, 'Rechnung!G10'), serial(today) + 14);
  eq('rechnung: position numbers', [14, 15, 16, 17, 18].map(r => val(wb, `Rechnung!A${r}`)).join(','), '1,2,3,4,');
  put(wb, 'Rechnung!G11', 'Ja');
  eq('rechnung: small business → no VAT', val(wb, 'Rechnung!G33'), 619);
  ok('rechnung: § 19 note', /§ 19 UStG/.test(val(wb, 'Rechnung!A35')));
}

// ---------------------------------------------------------------- Reisebudget
{
  const wb = build('reisebudget');
  const spent = 357.6 + 300 + 24.9 + 112.8 / 0.94 + 27 / 0.94 + 45 / 0.94;
  eq('reise: days', val(wb, 'Budget!B6'), 7);
  eq('reise: travellers', val(wb, 'Budget!B7'), 3);
  eq('reise: spent in EUR (foreign currency converted)', val(wb, 'Budget!C20'), spent);
  eq('reise: left', val(wb, 'Budget!B22'), 1800 - spent);
  eq('reise: per day', val(wb, 'Budget!B24'), spent / 7);
  eq('reise: Anna gets back', val(wb, 'Budget!J5'), 357.6 + 120 - spent / 3);
  eq('reise: Carla pays', val(wb, 'Budget!J7'), 24.9 + 45 / 0.94 - spent / 3);
  eq('reise: balances sum to 0', ['J5', 'J6', 'J7'].reduce((a, c) => a + val(wb, `Budget!${c}`), 0), 0);
}

// ---------------------------------------------------------------- Bewerbungstracker
{
  const wb = build('bewerbungstracker');
  eq('bewerbung: sent', val(wb, 'Bewerbungen!N15'), 6);
  eq('bewerbung: answers', val(wb, 'Bewerbungen!N16'), 3);
  eq('bewerbung: answer rate', val(wb, 'Bewerbungen!N17'), 0.5);
  eq('bewerbung: invitation rate', val(wb, 'Bewerbungen!N18'), 2 / 6);
  eq('bewerbung: follow-ups overdue', val(wb, 'Bewerbungen!N19'), 2);
  eq('bewerbung: follow-up = applied + 14', val(wb, 'Bewerbungen!H7'), serial(today) - 10 + 14);
  eq('bewerbung: no follow-up after a rejection', val(wb, 'Bewerbungen!H8'), '');
}

// ---------------------------------------------------------------- Geschenkeliste
{
  const wb = build('geschenkeliste');
  let xmas = D(Y, 12, 24); if (today > xmas) xmas = D(Y + 1, 12, 24);
  eq('geschenke: days until Christmas Eve', val(wb, 'Geschenke!B3'), Math.round((xmas - today) / 86400000));
  eq('geschenke: Mama planned', val(wb, 'Geschenke!D6'), 83.99);
  eq('geschenke: Mama over budget', val(wb, 'Geschenke!F6'), -3.99);
  eq('geschenke: budget total', val(wb, 'Geschenke!C18'), 275);
  eq('geschenke: planned total', val(wb, 'Geschenke!D18'), 273.77);
  eq('geschenke: bought (status ≥ Bestellt)', val(wb, 'Geschenke!E18'), 114.87);
  eq('geschenke: ideas left', val(wb, 'Geschenke!E3'), 4);
}

console.log(`==== sheet templates: ${passes}/${passes + fails} checks passed ====`);
process.exit(fails ? 1 : 0);
