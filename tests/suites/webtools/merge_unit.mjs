// Unit tests for the mail merge logic (lib/merge.js).  node tests/suites/webtools/merge_unit.mjs
const m = await import('../../../network/assets/wt/lib/merge.js');
let ok = 0, fail = 0;
const expect = (c, msg) => { if (c) ok++; else { fail++; console.log('FAIL', msg); } };

const raw = [['Anrede', 'Titel', 'Vorname', 'Nachname', 'Firma', 'Straße', 'PLZ', 'Ort', 'Land', ''],
  ['Frau', 'Dr.', 'Erika', 'Mustermann', '', 'Hauptstr. 1', '1067', 'Dresden', '', ''],
  ['Herr', '', 'Max', 'Muster', 'Muster GmbH', 'Weg 2', '66111', 'Saarbrücken', 'Deutschland', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['', '', 'Kim', 'Lee', '', 'Ring 3', '1010', 'Wien', 'Österreich', ''],
  ['Familie', '', '', 'Schmidt', '', '', '', '', '', '']];
const t = m.tableOf(raw);
expect(t.cols.length === 9 && t.rows.length === 4, `table ${t.cols} ${t.rows.length}`);
const fixed = m.fixPostcodes(t);
expect(fixed === 1 && t.rows[0][6] === '01067' && t.rows[2][6] === '1010', `postcodes: DE fixed, AT kept (${fixed})`);
const roles = m.detectColumns(t.cols);
expect(roles.anrede === 'Anrede' && roles.plz === 'PLZ' && roles.firma === 'Firma' && roles.land === 'Land' && roles.strasse === 'Straße', `roles ${JSON.stringify(roles)}`);
const r = i => m.recordOf(t, t.rows[i]);
expect(m.salutationOf(r(0), roles) === 'Sehr geehrte Frau Dr. Mustermann,', m.salutationOf(r(0), roles));
expect(m.salutationOf(r(1), roles) === 'Sehr geehrter Herr Muster,', 'Herr');
expect(m.salutationOf(r(2), roles) === 'Guten Tag Kim Lee,', 'no gender');
expect(m.salutationOf(r(3), roles) === 'Sehr geehrte Familie Schmidt,', 'Familie');
expect(m.salutationOf({}, {}) === 'Sehr geehrte Damen und Herren,', 'nobody');
expect(m.salutationOf(r(0), roles, 'en') === 'Dear Ms Dr. Mustermann,' && m.salutationOf(r(2), roles, 'en') === 'Dear Kim Lee,', 'english');
expect(m.salutationOf({ G: 'w', N: 'Kurz' }, { anrede: 'G', nachname: 'N' }) === 'Sehr geehrte Frau Kurz,', 'w → Frau');
const addr = m.defaultAddress(roles);
expect(addr === '{Firma}\n{Anrede Anschrift} {Titel} {Vorname} {Nachname}\n{Straße}\n{PLZ} {Ort}\n{Land}', `address template ${JSON.stringify(addr)}`);
expect(m.fill(addr, r(0), roles) === 'Frau Dr. Erika Mustermann\nHauptstr. 1\n01067 Dresden', JSON.stringify(m.fill(addr, r(0), roles)));
expect(m.fill(addr, r(1), roles) === 'Muster GmbH\nHerrn Max Muster\nWeg 2\n66111 Saarbrücken\nDeutschland', 'Herrn in the address');
expect(m.fill('{Briefanrede}\n\nIhre Rechnung vom {Datum}, {Vorname}.\n\n{Unbekannt}', r(1), roles, { date: '18.10.2026' }) === 'Sehr geehrter Herr Muster,\n\nIhre Rechnung vom 18.10.2026, Max.\n', 'body fill, blank lines kept, unknown line dropped');
expect(m.fill('Hallo {Vorname} {Nachname} !', r(3), roles) === 'Hallo Schmidt!', 'spaces collapsed');
expect(JSON.stringify(m.unknownPlaceholders(['{Vorname} {Vornme} {briefanrede} {Datum}'], t.cols)) === '["Vornme"]', 'unknown placeholders (case-insensitive)');
expect(JSON.stringify(m.incompleteRows(t, addr, roles)) === '[4]', `incomplete ${m.incompleteRows(t, addr, roles)}`);
expect(m.fileNameOf('{Nachname}, {Vorname}', r(3), roles, 3) === 'Schmidt' && m.fileNameOf('{Nachname}, {Vorname}', r(0), roles, 0) === 'Mustermann, Erika' && m.fileNameOf('{X}', r(0), roles, 4) === 'Brief 5', 'file names');
// header off, duplicate names, no braces in names
const t2 = m.tableOf([['a', 'b'], ['c', 'd']], { header: false });
expect(t2.cols.join() === 'Spalte A,Spalte B' && t2.rows.length === 2, 'no header');
const t3 = m.tableOf([['Name', 'name', '{x}'], ['1', '2', '3']]);
expect(t3.cols.join() === 'Name,name 2,x', `dedupe ${t3.cols}`);
console.log(`merge: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
