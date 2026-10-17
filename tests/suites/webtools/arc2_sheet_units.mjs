// arc2: unit test of all spreadsheet templates (js/office/sheet-templates.js) in Node – every template builds,
// recalculates without error values, the new templates produce the expected key results, and every header cell
// (head styles) is explained in the archive data (network/tools/vorlagen/tabellen/<id>.json → cols).
// Run: node arc2_sheet_units.mjs [--dump]   (exit 1 on failures)
import { readFileSync, existsSync } from 'node:fs';
const ROOT = '/home/claude/FalePDF/';
process.removeAllListeners('warning');
const T = await import(ROOT + 'js/office/sheet-templates.js');
const W = await import(ROOT + 'js/office/workbook.js');
const F = await import(ROOT + 'js/office/formula.js');
const FX = await import(ROOT + 'js/office/sheetfx.js');

let pass = 0; const fails = [];
const ok = (name, cond, info = '') => { if (cond) pass++; else fails.push(`${name} ${info}`); };
const TODAY = new Date(2026, 9, 15); // fixed date → deterministic checks

function build(id) {
  const wb = T.buildSheetTemplate(id, { today: TODAY });
  wb.sheets.forEach(s => { FX.ensureSheetExtras(s); W.ensureSheetModel(s); });
  // HEUTE() in the engine uses the real clock; the checks below only use values independent of it or relative
  W.recalc(wb);
  return wb;
}
const val = (wb, sheet, a) => { const sh = typeof sheet === 'number' ? wb.sheets[sheet] : wb.sheets.find(s => s.name === sheet); const p = F.parseAddr(a); const c = sh.cells.get(W.KEY(p.r, p.c)); return c ? (c.f ? c.cv : c.v) : undefined; };
const near = (a, b, tol = 0.006) => typeof a === 'number' && Math.abs(a - b) <= tol;

const ids = T.SHEET_TEMPLATE_DEFS.map(d => d.id);
ok('template count ≥ 38', ids.length >= 38, String(ids.length));
ok('unique ids', new Set(ids).size === ids.length);
for (const d of T.SHEET_TEMPLATE_DEFS) {
  ok(`${d.id}: category`, T.SHEET_TEMPLATE_CATS.includes(d.cat), d.cat);
  let wb;
  try { wb = build(d.id); } catch (e) { ok(`${d.id}: builds`, false, e.message); continue; }
  for (const sh of wb.sheets) {
    let errs = [];
    for (const [k, c] of sh.cells) {
      if (!c.f) continue;
      if (c.cv && typeof c.cv === 'object' && c.cv.code) errs.push(`${F.colName(W.C_OF(k))}${W.R_OF(k) + 1} ${c.f} → ${c.cv.code}`);
    }
    ok(`${d.id}/${sh.name}: no error values`, errs.length === 0, errs.slice(0, 4).join(' | '));
  }
  // every head cell is explained in the archive data
  const f = `${ROOT}network/tools/vorlagen/tabellen/${d.id}.json`;
  if (existsSync(f)) {
    const data = JSON.parse(readFileSync(f, 'utf8'));
    ok(`${d.id}: archive category = template category`, data.cat === d.cat && data.id === d.id, `${data.cat} / ${d.cat}`);
    const explained = new Set((data.cols || []).flatMap(c => c[0].split(' · ')));
    const heads = new Set();
    for (const sd of d.sheets) {
      const sh = wb.sheets.find(s => s.name === sd.name.slice(0, 31));
      for (const [, c] of sh.cells) if (c.s && c.s.b && c.s.fill && typeof c.v === 'string' && c.v.trim()) heads.add(c.v.trim());
    }
    const missing = [...heads].filter(h => !explained.has(h));
    ok(`${d.id}: every column explained`, missing.length === 0, missing.join(', '));
  } else ok(`${d.id}: archive data exists`, false, f);
}

// ---------------------------------------------------------------- key results of the new templates
{
  const wb = build('schichtplan');
  ok('schicht: F hours 7.5', near(val(wb, 0, 'Q6'), 7.5), val(wb, 0, 'Q6'));
  ok('schicht: N over midnight 7.5', near(val(wb, 0, 'Q8'), 7.5), val(wb, 0, 'Q8'));
  ok('schicht: Anna 5×F = 37.5 h', near(val(wb, 0, 'I6'), 37.5), val(wb, 0, 'I6'));
  ok('schicht: Anna 5 shifts', val(wb, 0, 'J6') === 5, val(wb, 0, 'J6'));
  ok('schicht: Greta (Urlaub) 0 h', val(wb, 0, 'I12') === 0, val(wb, 0, 'I12'));
  ok('schicht: Monday early count', val(wb, 0, 'B17') === 2, val(wb, 0, 'B17'));   // Anna F, Fatma F
  ok('schicht: empty row blank', val(wb, 0, 'I14') === '', JSON.stringify(val(wb, 0, 'I14')));
}
{
  const wb = build('hochzeitsbudget');
  ok('hochzeit: Ansatz uses offer', val(wb, 0, 'J8') === 3800);
  ok('hochzeit: Ansatz falls back to plan', val(wb, 0, 'J9') === 5400);
  const total = [3800, 5400, 1650, 1750, 900, 800, 1090, 210, 120, 450].reduce((a, b) => a + b, 0);
  ok('hochzeit: Ansatz total', near(val(wb, 0, 'E3'), total), val(wb, 0, 'E3'));
  ok('hochzeit: per guest', near(val(wb, 0, 'E4'), total / 60), val(wb, 0, 'E4'));
  ok('hochzeit: left', near(val(wb, 0, 'B5'), 15000 - total), val(wb, 0, 'B5'));
  ok('hochzeit: category sum', near(val(wb, 0, 'M9'), 5850), val(wb, 0, 'M9'));
  ok('hochzeit: rest offen', near(val(wb, 0, 'F8'), 2800), val(wb, 0, 'F8'));
}
{
  const wb = build('familienbudget');
  ok('familie: yearly → monthly', near(val(wb, 0, 'E11'), 40), val(wb, 0, 'E11'));
  ok('familie: quarterly', near(val(wb, 0, 'F13'), 220.32), val(wb, 0, 'F13'));
  ok('familie: Einnahmen/Monat', near(val(wb, 0, 'K11'), 4810), val(wb, 0, 'K11'));
  const kinder = 180 + 120 * 2 / 12 + 600 / 12 + 40;
  ok('familie: Kinder', near(val(wb, 0, 'K14'), kinder), val(wb, 0, 'K14'));
  ok('familie: pro Kind', near(val(wb, 0, 'K19'), kinder / 2), val(wb, 0, 'K19'));
}
{
  const wb = build('vereinskasse');
  ok('verein: Beiträge', near(val(wb, 0, 'B8'), 1840) || val(wb, 0, 'B8') === 0, val(wb, 0, 'B8'));
  ok('verein: Kontrolle 0', near(val(wb, 0, 'D24'), 0), val(wb, 0, 'D24'));
}
{
  const wb = build('mitgliederliste');
  ok('mitglieder: fee lookup', val(wb, 0, 'I5') === 60 && val(wb, 0, 'I6') === 30 && val(wb, 0, 'I10') === 0, `${val(wb, 0, 'I5')} ${val(wb, 0, 'I6')}`);
  ok('mitglieder: soll', near(val(wb, 0, 'P7'), 60 + 30 + 60 + 100 + 60 + 0 + 24), val(wb, 0, 'P7'));
  ok('mitglieder: offen', near(val(wb, 0, 'P9'), 120), val(wb, 0, 'P9'));
  ok('mitglieder: Jubiläum Carla', String(val(wb, 0, 'M7')).startsWith('25'), val(wb, 0, 'M7'));
}
{
  const wb = build('angebotsvergleich');
  ok('angebot: price points C = 10', near(val(wb, 0, 'E11'), 10), val(wb, 0, 'E11'));
  ok('angebot: weights 100 %', near(val(wb, 0, 'B16'), 1), val(wb, 0, 'B16'));
  const ranks = ['C18', 'D18', 'E18'].map(a => val(wb, 0, a)).sort().join(',');
  ok('angebot: ranks 1,2,3', ranks === '1,2,3', ranks);
}
{
  const wb = build('lagerbestand');
  ok('lager: toner at min → Nachbestellen', val(wb, 0, 'J6') === 'Nachbestellen', val(wb, 0, 'J6'));
  ok('lager: screws empty', val(wb, 0, 'J9') === 'Leer – bestellen' && val(wb, 0, 'K9') === 1200, `${val(wb, 0, 'J9')} ${val(wb, 0, 'K9')}`);
  ok('lager: OK no proposal', val(wb, 0, 'J5') === 'OK' && val(wb, 0, 'K5') === '');
  ok('lager: count', val(wb, 0, 'P6') === 3, val(wb, 0, 'P6'));
}
{
  const wb = build('preiskalkulation');
  ok('kalk: netto', near(val(wb, 0, 'C13'), (120 + 165) * 1.15 * 1.2), val(wb, 0, 'C13'));
  ok('kalk: brutto', near(val(wb, 0, 'C15'), (120 + 165) * 1.15 * 1.2 * 1.19), val(wb, 0, 'C15'));
  ok('kalk: rounded to 5', val(wb, 0, 'C16') === 470, val(wb, 0, 'C16'));
}
{
  const wb = build('break-even');
  ok('be: DB', val(wb, 0, 'B10') === 14);
  ok('be: menge', val(wb, 0, 'B12') === 286, val(wb, 0, 'B12'));
  ok('be: gewinn plan', val(wb, 0, 'B14') === 400 * 14 - 4000, val(wb, 0, 'B14'));
  ok('be: table', val(wb, 0, 'D25') === 1000 && val(wb, 0, 'G25') === 1000 * 14 - 4000, `${val(wb, 0, 'D25')} ${val(wb, 0, 'G25')}`);
}
{
  const wb = build('tankbuch');
  ok('tank: km', val(wb, 0, 'F6') === 632, val(wb, 0, 'F6'));
  ok('tank: l/100', near(val(wb, 0, 'G6'), 38.9 / 632 * 100, 1e-6), val(wb, 0, 'G6'));
  ok('tank: avg', near(val(wb, 0, 'L7'), (38.9 + 37.6 + 40.3 + 37.1) / (50710 - 48210) * 100, 1e-6), val(wb, 0, 'L7'));
}
{
  const wb = build('stromzaehler');
  ok('strom: verbrauch', val(wb, 0, 'C9') === 238, val(wb, 0, 'C9'));
  ok('strom: gesamt', val(wb, 0, 'K8') === 19590 - 18240, val(wb, 0, 'K8'));
  ok('strom: abschlag', val(wb, 0, 'K13') === 1020);
}
{
  const wb = build('projektzeiten');
  ok('zeit: hours with pause', near(val(wb, 0, 'G7'), 3.25), val(wb, 0, 'G7'));   // 8:30–12:00 − 15 min
  ok('zeit: amount', near(val(wb, 0, 'I5'), 3.5 * 65), val(wb, 0, 'I5'));
  ok('zeit: not billable', val(wb, 0, 'I6') === '');
  ok('zeit: project sum', near(val(wb, 'Projekte', 'E5'), 3.5 + 1 + 1.25), val(wb, 'Projekte', 'E5'));
}
{
  const wb = build('gewichtstagebuch');
  ok('gewicht: delta', near(val(wb, 0, 'C6'), -0.3, 1e-9), val(wb, 0, 'C6'));
  ok('gewicht: last', near(val(wb, 0, 'I7'), 71.8, 1e-9), val(wb, 0, 'I7'));
  ok('gewicht: avg7', near(val(wb, 0, 'E11'), (72.4 + 72.1 + 72.6 + 71.9 + 72 + 71.6 + 71.8) / 7, 1e-9), val(wb, 0, 'E11'));
}
{
  const wb = build('lesetagebuch');
  ok('lesen: days', val(wb, 0, 'G5') === 19, val(wb, 0, 'G5'));
  ok('lesen: reading now', val(wb, 0, 'M8') === 1, val(wb, 0, 'M8'));
}
{
  const wb = build('teamurlaub');
  ok('team: gesamt', val(wb, 0, 'E6') === 32);
  ok('team: holidays listed', typeof val(wb, 'Einträge', 'I5') === 'number');
}
{
  const wb = build('geburtstagskalender');
  const months = Array.from({ length: 12 }, (_, i) => val(wb, 0, `K${10 + i}`));
  ok('geb: month counts sum 8', months.reduce((a, b) => a + b, 0) === 8, months.join(','));
}
{
  const wb = build('mahnliste');
  ok('mahn: paid → blank', val(wb, 0, 'H6') === '' && val(wb, 0, 'I6') === '');
}

if (process.argv.includes('--dump')) for (const id of ids.slice(18)) console.log(id, build(id).sheets.map(s => s.name).join(', '));
console.log(`${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log(fails.map(f => '  FAIL ' + f).join('\n')); process.exit(1); }
console.log('[PASS] arc2 sheet units');
