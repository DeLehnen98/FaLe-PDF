// Unit tests for the operating cost statement (lib/nk.js).  node tests/suites/webtools/nk_unit.mjs
const nk = await import('../../../network/assets/wt/lib/nk.js');
let ok = 0, fail = 0;
const expect = (c, m) => { if (c) ok++; else { fail++; console.log('FAIL', m); } };
expect(nk.daysIncl('2025-01-01', '2025-12-31') === 365 && nk.daysIncl('2024-01-01', '2024-12-31') === 366 && nk.daysIncl('2025-03-01', '2025-02-01') === 0, 'days');
expect(nk.deadline('2025-12-31') === '2026-12-31' && nk.deadline('2025-06-30') === '2026-06-30' && nk.deadline('2024-02-29') === '2025-02-28', 'deadline');
const period = { from: '2025-01-01', to: '2025-12-31' };
const input = {
  period, house: { area: 300, units: 4 },
  tenancies: [
    { id: 'a', name: 'Mustermann', unit: 'EG links', area: 100, persons: 2, prepaid: '1.200,00', consumption: 60, direct: { h: '612,40' } },
    { id: 'b', name: 'Alt', unit: 'OG', area: 80, persons: 1, to: '2025-06-30', prepaid: 400, consumption: 20, direct: { h: 210 } },
    { id: 'c', name: 'Neu', unit: 'OG', area: 80, persons: 3, from: '2025-07-01', prepaid: 450, consumption: 40, direct: { h: 255.5 } },
    // 120 m² of the house are not let (empty flat, owner's flat)
  ],
  items: [
    { id: 'g', type: 'grundsteuer', amount: '600', key: 'area' },
    { id: 'w', type: 'wasser', amount: 1200, key: 'consumption' },
    { id: 'm', type: 'muell', amount: 730, key: 'persons' },
    { id: 'u', type: 'versicherung', amount: 400, key: 'units', hhd: false },
    { id: 'gr', type: 'garten', amount: 365, key: 'area', hhd: true },
    { id: 'h', type: 'heizung', key: 'direct' },
  ],
};
const r = nk.compute(input);
expect(r.errors.length === 0 && r.periodDays === 365, `errors ${r.errors}`);
const [A, B, C] = r.tenancies;
expect(A.lines[0].share === 20000, `area 100/300 of 600 € = 200 € (${A.lines[0].share})`);
expect(B.days === 181 && C.days === 184, `tenant change days ${B.days}/${C.days}`);
expect(B.lines[0].share === Math.round(60000 * 80 * 181 / (300 * 365)), 'area time-weighted');
expect(A.lines[1].share === 60000 && B.lines[1].share === 20000, 'water by consumption 60/120');
// persons: person-days 2*365 + 1*181 + 3*184 = 1463
expect(A.lines[2].share === Math.round(73000 * 730 / 1463), `persons ${A.lines[2].share}`);
expect(A.lines[3].share === 10000 && B.lines[3].share === Math.round(40000 * 181 / (4 * 365)), 'units');
expect(A.lines[5].share === 61240 && A.lines[5].total === null, 'direct heating');
expect(A.prepaid === 120000 && A.sum === A.lines.reduce((a, l) => a + l.share, 0) && A.balance === A.sum - 120000, 'balance');
expect(A.hhd === A.lines[4].share && A.hhd > 0, 'household services share');
// landlord keeps the empty DG (40 m² of 300) share of area costs + one unit of 4 etc.
expect(r.landlord > 0 && r.landlord === r.allocatable - r.tenancies.reduce((a, t) => a + t.lines.filter(l => l.basis.key !== 'direct').reduce((x, l) => x + l.share, 0), 0), `landlord share ${r.landlord}`);
const gAll = r.tenancies.reduce((a, t) => a + t.lines[0].share, 0);
expect(Math.abs((60000 - gAll) - 60000 * 120 / 300) <= 2, `120 of 300 m² not let → landlord keeps 240 € of the property tax (${60000 - gAll})`);
expect(nk.basisText(B.lines[0].basis) === 'Wohnfläche 80 m² von 300 m² · 181 von 365 Tagen', nk.basisText(B.lines[0].basis));
expect(nk.basisText(A.lines[1].basis) === 'Verbrauch 60 von 120', nk.basisText(A.lines[1].basis));
expect(nk.basisText(B.lines[2].basis) === '1 Person × 181 Tage = 181 von 1.463 Personentagen', nk.basisText(B.lines[2].basis));
// errors
expect(nk.compute({ period: { from: '', to: '' }, house: {}, tenancies: [], items: [] }).errors.includes('period'), 'no period');
const big = nk.compute({ period, house: { area: 100 }, tenancies: [{ unit: 'A', area: 80 }, { unit: 'B', area: 50 }], items: [] });
expect(big.errors.includes('area-sum'), 'flats larger than the house');
const same = nk.compute({ period, house: { area: 100 }, tenancies: [{ unit: 'A', area: 80, to: '2025-05-31' }, { unit: 'A', area: 80, from: '2025-06-01' }], items: [] });
expect(!same.errors.includes('area-sum'), 'same flat twice is fine');
console.log(`nk: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
