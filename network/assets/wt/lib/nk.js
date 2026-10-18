// Operating cost statement (Nebenkostenabrechnung / Betriebskostenabrechnung) maths, pure and unit-tested
// (nk_unit.mjs). Every tenancy is weighted by its days in the period, so tenant changes and vacancy work out:
// what no tenancy covers (empty flats, the owner's own flat) stays with the landlord and is shown as such.
// Keys: living area, persons (person-days), units, metered consumption, or amounts per tenancy (e.g. from
// the heating cost statement of the metering company). Amounts in cents, rounded per line.

export const COST_TYPES = [
  // § 2 BetrKV (numbers as in the ordinance)
  { id: 'grundsteuer', no: 1, de: 'Grundsteuer', en: 'Property tax' },
  { id: 'wasser', no: 2, de: 'Wasserversorgung', en: 'Water supply' },
  { id: 'abwasser', no: 3, de: 'Entwässerung (Abwasser)', en: 'Drainage (sewage)' },
  { id: 'heizung', no: 4, de: 'Heizung', en: 'Heating' },
  { id: 'warmwasser', no: 5, de: 'Warmwasser', en: 'Hot water' },
  { id: 'aufzug', no: 7, de: 'Aufzug', en: 'Lift' },
  { id: 'strassenreinigung', no: 8, de: 'Straßenreinigung', en: 'Street cleaning' },
  { id: 'muell', no: 8, de: 'Müllbeseitigung', en: 'Waste disposal' },
  { id: 'gebaeudereinigung', no: 9, de: 'Gebäudereinigung', en: 'Building cleaning' },
  { id: 'ungeziefer', no: 9, de: 'Ungezieferbekämpfung', en: 'Pest control' },
  { id: 'garten', no: 10, de: 'Gartenpflege', en: 'Garden maintenance' },
  { id: 'beleuchtung', no: 11, de: 'Allgemeinstrom / Beleuchtung', en: 'Common electricity / lighting' },
  { id: 'schornstein', no: 12, de: 'Schornsteinreinigung', en: 'Chimney sweeping' },
  { id: 'versicherung', no: 13, de: 'Sach- und Haftpflichtversicherung', en: 'Building and liability insurance' },
  { id: 'hauswart', no: 14, de: 'Hauswart', en: 'Caretaker' },
  { id: 'antenne', no: 15, de: 'Antenne / Glasfaser (soweit umlagefähig)', en: 'Aerial / fibre (where allowed)' },
  { id: 'waesche', no: 16, de: 'Einrichtungen für die Wäschepflege', en: 'Laundry facilities' },
  { id: 'sonstige', no: 17, de: 'Sonstige Betriebskosten (vereinbart)', en: 'Other operating costs (agreed)' },
];
export const KEYS = ['area', 'persons', 'units', 'consumption', 'direct'];

const DAY = 86400000;
const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
/** Days from a to b inclusive (ISO dates), 0 if empty. */
export const daysIncl = (a, b) => { const x = parse(a), y = parse(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / DAY) + 1 : 0; };
/** Overlap of a tenancy with the period (ISO from/to; empty tenancy dates = whole period). */
export function overlap(period, from, to) {
  const a = from && parse(from) > parse(period.from) ? from : period.from;
  const b = to && parse(to) < parse(period.to) ? to : period.to;
  return { from: a, to: b, days: daysIncl(a, b) };
}
const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const cents = x => Math.round(num(x) * 100);
const r2 = x => Math.round(x);

/**
 * input: { period: {from, to}, house: {area, units, persons?, consumption?},
 *   tenancies: [{ id, name, unit, area, persons, from, to, prepaid, consumption, direct: {itemId: amount} }],
 *   items: [{ id, type, label, amount, key, hhd }] }
 * → { periodDays, tenancies: [{ …, days, lines: [{ item, label, total, share, basis }], sum, prepaid, balance, hhd }],
 *     landlord: cents not allocated, errors: [] }
 */
export function compute(input) {
  const P = input.period || {};
  const periodDays = daysIncl(P.from, P.to);
  const errors = [];
  if (!periodDays) errors.push('period');
  if (periodDays > 366) errors.push('period-long');
  const house = input.house || {};
  const T = (input.tenancies || []).map(t => {
    const o = periodDays ? overlap(P, t.from, t.to) : { days: 0 };
    return { ...t, use: o, days: o.days, areaN: num(t.area), personsN: num(t.persons), consN: num(t.consumption) };
  });
  const totalArea = num(house.area) || 0;
  const sumArea = T.reduce((a, t) => a + t.areaN, 0);
  if (!totalArea) errors.push('area');
  const totalUnits = num(house.units) || 0;
  // persons: person-days of the tenancies, unless the whole house is given (e.g. owner lives there too)
  const personDays = T.reduce((a, t) => a + t.personsN * t.days, 0);
  const housePersonDays = num(house.persons) ? num(house.persons) * periodDays : personDays;
  const totalCons = num(house.consumption) || T.reduce((a, t) => a + t.consN, 0);
  const items = (input.items || []).map(it => ({ ...it, totalC: cents(it.amount), key: KEYS.includes(it.key) ? it.key : 'area' }));
  let allocated = 0, allocatable = 0;
  const out = T.map(t => {
    const lines = [];
    for (const it of items) {
      let share = 0, basis = null;
      if (it.key === 'direct') {
        share = cents(t.direct?.[it.id]);
        basis = { key: 'direct' };
      } else if (it.key === 'area') {
        const f = totalArea && periodDays ? (t.areaN * t.days) / (totalArea * periodDays) : 0;
        share = r2(it.totalC * f); basis = { key: 'area', mine: t.areaN, total: totalArea, days: t.days, periodDays };
      } else if (it.key === 'persons') {
        const f = housePersonDays ? (t.personsN * t.days) / housePersonDays : 0;
        share = r2(it.totalC * f); basis = { key: 'persons', mine: t.personsN, total: housePersonDays, days: t.days, periodDays };
      } else if (it.key === 'units') {
        const f = totalUnits && periodDays ? t.days / (totalUnits * periodDays) : 0;
        share = r2(it.totalC * f); basis = { key: 'units', mine: 1, total: totalUnits, days: t.days, periodDays };
      } else if (it.key === 'consumption') {
        const f = totalCons ? t.consN / totalCons : 0;
        share = r2(it.totalC * f); basis = { key: 'consumption', mine: t.consN, total: totalCons };
      }
      lines.push({ item: it.id, type: it.type, label: it.label, total: it.key === 'direct' ? null : it.totalC, share, basis, hhd: !!it.hhd });
    }
    const sum = lines.reduce((a, l) => a + l.share, 0);
    const prepaid = cents(t.prepaid);
    allocated += lines.filter(l => l.basis.key !== 'direct').reduce((a, l) => a + l.share, 0);
    return { ...t, lines, sum, prepaid, balance: sum - prepaid, hhd: lines.filter(l => l.hhd).reduce((a, l) => a + l.share, 0) };
  });
  allocatable = items.filter(i => i.key !== 'direct').reduce((a, i) => a + i.totalC, 0);
  if (totalArea && sumArea > totalArea + 0.01 && T.every(t => t.unit)) {
    // the same flat may appear twice (tenant change) – only complain when distinct flats exceed the total
    const byUnit = new Map();
    for (const t of T) byUnit.set(String(t.unit).trim().toLowerCase(), Math.max(byUnit.get(String(t.unit).trim().toLowerCase()) || 0, t.areaN));
    if ([...byUnit.values()].reduce((a, b) => a + b, 0) > totalArea + 0.01) errors.push('area-sum');
  }
  if (items.some(i => i.key === 'units') && !totalUnits) errors.push('units');
  return { periodDays, tenancies: out, landlord: allocatable - allocated, allocatable, errors };
}

/** Human explanation of a line's key ("72,5 m² von 480 m² · 365 von 365 Tagen"). */
export function basisText(b, lang = 'de') {
  const de = lang === 'de';
  const n = (x, d = 2) => Number(x).toLocaleString(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: d });
  const days = b.days != null && b.days !== b.periodDays ? (de ? ` · ${b.days} von ${b.periodDays} Tagen` : ` · ${b.days} of ${b.periodDays} days`) : '';
  switch (b.key) {
    case 'area': return de ? `Wohnfläche ${n(b.mine)} m² von ${n(b.total)} m²${days}` : `Living area ${n(b.mine)} m² of ${n(b.total)} m²${days}`;
    case 'persons': {   // person-days: persons × days of use, out of all person-days in the house
      const pd = n(b.mine * b.days, 0), all = n(b.total, 0);
      return de ? `${n(b.mine)} ${b.mine === 1 ? 'Person' : 'Personen'} × ${b.days} Tage = ${pd} von ${all} Personentagen` : `${n(b.mine)} ${b.mine === 1 ? 'person' : 'persons'} × ${b.days} days = ${pd} of ${all} person-days`;
    }
    case 'units': return de ? `1 von ${n(b.total, 0)} Wohnungen${days}` : `1 of ${n(b.total, 0)} units${days}`;
    case 'consumption': return de ? `Verbrauch ${n(b.mine, 3)} von ${n(b.total, 3)}` : `Consumption ${n(b.mine, 3)} of ${n(b.total, 3)}`;
    default: return de ? 'Laut Einzelabrechnung' : 'Per individual statement';
  }
}

/** Deadline: the statement must reach the tenant by the end of the 12th month after the period (§ 556 III BGB). */
export function deadline(periodTo) {
  const t = parse(periodTo);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const end = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}
