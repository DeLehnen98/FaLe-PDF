// Unit tests for the functions added in the spreadsheet expansion (office3): LAMBDA family, array shaping,
// statistics/distributions, math/engineering, text/regex, information, financial, database functions,
// German input conventions, reference shifting and circular references.
// Run: node test_formula3.mjs   (exit code 1 on failures)
const ROOT = '/home/claude/FalePDF/js/office/';
const F = await import(ROOT + 'formula.js');
const W = await import(ROOT + 'workbook.js');

let pass = 0, fail = 0;
const fails = [];
const ok = (name, cond, info = '') => { if (cond) pass++; else { fail++; fails.push(`${name}  ${info}`); } };
const isE = (v, code) => v && v.code === code;
function same(a, b) {
  if (typeof b === 'number' && typeof a === 'number') return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-8);
  if (b && typeof b === 'object' && b.err) return isE(a, b.err);
  if (b && typeof b === 'object' && b.approx !== undefined) return typeof a === 'number' && Math.abs(a - b.approx) <= (b.tol ?? 1e-6);
  return a === b;
}
const show = v => (v && v.code ? v.code : JSON.stringify(v));
const NA = { err: '#N/A' }, VAL = { err: '#VALUE!' }, DIV = { err: '#DIV/0!' }, NUM = { err: '#NUM!' }, NAME = { err: '#NAME?' }, CALC = { err: '#CALC!' }, CIRC = { err: '#CIRC!' };
const ap = (x, tol = 1e-6) => ({ approx: x, tol });

const wb = W.newWorkbook();
const sh = wb.sheets[0]; sh.name = 'Daten';
const preise = W.newSheet('Preise'); wb.sheets.push(preise);
const dbs = W.newSheet('DB'); wb.sheets.push(dbs);
function put(s, a, text) { const p = F.parseAddr(a); const x = W.parseInput(text); const cell = {}; if (x.fmt) cell.s = { fmt: x.fmt }; if (x.f) { cell.f = x.f; cell.da = true; } else cell.v = x.v; W.setCell(s, p.r, p.c, cell); }
[['A1', '10'], ['A2', '20'], ['A3', '30'], ['A4', '40'], ['A5', '50'], ['B1', 'x'], ['B2', '#DIV/0!'], ['B3', '7'], ['N1', '=A1*2'], ['N2', 'Text']].forEach(([a, t]) => put(sh, a, t));
// error constant in B2 as a formula
W.setCell(sh, 1, 1, { f: '1/0', da: true });
put(preise, 'A1', '100');
// database example
const DBROWS = [['Baum', 'Höhe', 'Alter', 'Ertrag', 'Gewinn'], ['Apfel', 18, 20, 14, 105], ['Birne', 12, 12, 10, 96], ['Kirsche', 13, 14, 9, 105], ['Apfel', 14, 15, 10, 75], ['Birne', 9, 8, 8, 76.8], ['Apfel', 8, 9, 6, 45]];
DBROWS.forEach((row, r) => row.forEach((v, c) => W.setCell(dbs, r, c, { v })));
W.setCell(dbs, 0, 7, { v: 'Baum' }); W.setCell(dbs, 0, 8, { v: 'Höhe' }); W.setCell(dbs, 1, 7, { v: '=Apfel' }); W.setCell(dbs, 1, 8, { v: '>10' });
wb.names = [
  { name: 'Netto', ref: 'LAMBDA(b,b/1.19)', si: null },
  { name: 'Fak', ref: 'LAMBDA(n,IF(n<=1,1,n*Fak(n-1)))', si: null },
  { name: 'Werte', ref: 'Daten!$A$1:$A$5', si: null },
];
W.recalc(wb);

let slot = 0;
function calc(formula) {
  const r = 200 + (slot++ % 300) * 12, c = 30;
  const x = W.parseInput(formula.startsWith('=') ? formula : '=' + formula);
  W.setCell(sh, r, c, { f: x.f, da: true });
  W.recalc(wb);
  const cell = W.getCell(sh, r, c);
  let arr = null;
  if (cell.spill) { arr = []; for (let i = 0; i < cell.spill.h; i++) { const row = []; for (let j = 0; j < cell.spill.w; j++) row.push(W.valueAt(sh, r + i, c + j)); arr.push(row); } }
  const v = cell.cv;
  W.setCell(sh, r, c, null);
  return arr ? { v, arr } : { v };
}
function t(formula, expected) {
  let got;
  try { got = calc(formula).v; } catch (e) { ok(formula, false, 'EXC ' + e.message); return; }
  ok(formula, same(got, expected), `got ${show(got)} expected ${show(expected)}`);
}
function ta(formula, expected) {
  let got;
  try { got = calc(formula); } catch (e) { ok(formula, false, 'EXC ' + e.message); return; }
  const arr = got.arr || [[got.v]];
  const good = arr.length === expected.length && arr.every((row, i) => row.length === expected[i].length && row.every((v, j) => same(v, expected[i][j])));
  ok(formula, good, `got ${JSON.stringify(arr.map(r => r.map(show)))} expected ${JSON.stringify(expected)}`);
}

// ---------------------------------------------------------------- LAMBDA family
t('LAMBDA(x;x+1)(5)', 6);
t('LAMBDA(x,y,x*y)(6,7)', 42);
t('LET(f;LAMBDA(x;x*2);f(21))', 42);
t('LET(k;10;f;LAMBDA(x;x+k);f(5))', 15); // closure
t('LAMBDA(x;x+1)', CALC); // a function as result
t('LAMBDA(x;x)(1;2)', VAL); // too many arguments
t('LAMBDA(x;x;1)', VAL); // duplicate parameter
t('LAMBDA(1;2)', VAL);
t('Netto(119)', 100);
t('Fak(5)', 120);
t('Fak(1)', 1);
t('LAMBDA(a;b;WENN(ISTAUSGELASSEN(b);a;a+b))(1;)', 1);
t('LAMBDA(a;b;WENN(ISTAUSGELASSEN(b);a;a+b))(1;2)', 3);
t('LAMBDA(a;b;a+b)(4)', 4); // omitted parameter counts as empty
ta('MAP({1.2.3};LAMBDA(x;x*10))', [[10, 20, 30]]);
ta('MAP({1;2};{10;20};LAMBDA(a;b;a+b))', [[11], [22]]);
ta('MAP(A1:A3;LAMBDA(v;WENN(v>15;"groß";"klein")))', [['klein'], ['groß'], ['groß']]);
t('MAP({1.2};5)', VAL);
t('REDUCE(0;A1:A5;LAMBDA(a;b;a+b))', 150);
t('REDUCE(1;{1.2.3.4};LAMBDA(a;b;a*b))', 24);
t('REDUCE(;{1.2.3};LAMBDA(a;b;a+b))', 6);
ta('SCAN(0;{1.2.3.4};LAMBDA(a;b;a+b))', [[1, 3, 6, 10]]);
ta('SCAN("";{"a"."b"."c"};LAMBDA(a;b;a&b))', [['a', 'ab', 'abc']]);
ta('NACHZEILE({1.2;3.4};LAMBDA(r;SUMME(r)))', [[3], [7]]);
ta('BYCOL({1.2;3.4};LAMBDA(c;MAX(c)))', [[3, 4]]);
ta('NACHZEILE({1.2;3.4};LAMBDA(r;r))', [[CALC], [CALC]]);
ta('MATRIXERSTELLEN(2;3;LAMBDA(r;c;r*c))', [[1, 2, 3], [2, 4, 6]]);
t('MATRIXERSTELLEN(0;3;LAMBDA(r;c;1))', VAL);
ok('LAMBDA xlsx prefix', F.toXlsx('LAMBDA(x,x+1)(5)') === '_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1)(5)', F.toXlsx('LAMBDA(x,x+1)(5)'));
ok('BYROW xlsx', F.toXlsx('BYROW(A1:B2,LAMBDA(r,SUM(r)))') === '_xlfn.BYROW(A1:B2,_xlfn.LAMBDA(_xlpm.r,SUM(_xlpm.r)))', F.toXlsx('BYROW(A1:B2,LAMBDA(r,SUM(r)))'));
ok('German display NACHZEILE', F.toDisplay('BYROW(A1:B2,LAMBDA(r,SUM(r)))') === 'NACHZEILE(A1:B2;LAMBDA(r;SUMME(r)))', F.toDisplay('BYROW(A1:B2,LAMBDA(r,SUM(r)))'));

// ---------------------------------------------------------------- array shaping
ta('VSTAPELN({1.2};{3.4})', [[1, 2], [3, 4]]);
ta('VSTAPELN({1.2};{3})', [[1, 2], [3, NA]]);
ta('HSTAPELN({1;2};{3;4})', [[1, 3], [2, 4]]);
ta('HSTAPELN({1;2};5)', [[1, 5], [2, NA]]);
ta('VSTACK(A1:A2,Preise!A1)', [[10], [20], [100]]);
ta('ÜBERNEHMEN({1.2.3;4.5.6};1)', [[1, 2, 3]]);
ta('ÜBERNEHMEN({1.2.3;4.5.6};-1;2)', [[4, 5]]);
ta('TAKE({1,2,3;4,5,6},,-1)', [[3], [6]]);
ta('WEGLASSEN({1.2.3;4.5.6};1)', [[4, 5, 6]]);
ta('WEGLASSEN({1.2.3;4.5.6};;-1)', [[1, 2], [4, 5]]);
t('WEGLASSEN({1.2.3;4.5.6};5)', CALC);
ta('ZEILENWAHL({1.2;3.4;5.6};-1;1)', [[5, 6], [1, 2]]);
t('ZEILENWAHL({1.2;3.4};3)', VAL);
ta('SPALTENWAHL({1.2.3;4.5.6};{3.1})', [[3, 1], [6, 4]]);
ta('ZUSPALTE({1.2;3.4})', [[1], [2], [3], [4]]);
ta('ZUSPALTE({1.2;3.4};0;WAHR)', [[1], [3], [2], [4]]);
ta('ZUZEILE(A1:A3)', [[10, 20, 30]]);
ta('ZUSPALTE(B1:B3;2)', [['x'], [7]]);
ta('ZEILENUMBRUCH({1.2.3.4.5};2)', [[1, 2], [3, 4], [5, NA]]);
ta('ZEILENUMBRUCH({1.2.3.4.5};2;0)', [[1, 2], [3, 4], [5, 0]]);
ta('SPALTENUMBRUCH({1.2.3.4.5};2)', [[1, 3, 5], [2, 4, NA]]);
t('ZEILENUMBRUCH({1.2};0)', NUM);
ta('ERWEITERN({1.2};2;3;"-")', [[1, 2, '-'], ['-', '-', '-']]);
t('ERWEITERN({1.2};1;1)', VAL);
ta('TEXTTEILEN("a,b,c";",")', [['a', 'b', 'c']]);
ta('TEXTTEILEN("a=1;b=2";"=";";")', [['a', '1'], ['b', '2']]);
ta('TEXTTEILEN("a,,b";",";;WAHR)', [['a', 'b']]);
ta('TEXTTEILEN("a,,b";",")', [['a', '', 'b']]);
ta('TEXTTEILEN("1-2/3";{"-"."/"})', [['1', '2', '3']]);
ta('TEXTTEILEN("aXbxc";"x";;;1)', [['a', 'b', 'c']]);
ta('TEXTTEILEN("a;b,c";",";";")', [['a', NA], ['b', 'c']]);
t('TEXTTEILEN("abc";"")', VAL);

// ---------------------------------------------------------------- statistics
ta('HÄUFIGKEIT({79.85.78.85.50.81.95.88.97};{70.79.89})', [[1], [2], [4], [2]]);
t('STEIGUNG({2.3.9.1.8.7.5};{6.5.11.7.5.4.4})', ap(0.305555556));
t('ACHSENABSCHNITT({2.3.9.1.8};{6.5.11.7.5})', ap(0.048387097));
t('BESTIMMTHEITSMASS({2.3.9.1.8.7.5};{6.5.11.7.5.4.4})', ap(0.057950192));
t('PEARSON({9.7.5.3.1};{10.6.1.5.3})', ap(0.699379));
t('SCHÄTZER(30;{6.7.9.15.21};{20.28.31.38.40})', ap(10.60725308));
t('PROGNOSE.LINEAR(30;{6.7.9.15.21};{20.28.31.38.40})', ap(10.60725308));
t('STEIGUNG({1.2};{3.3})', DIV);
t('STEIGUNG({1.2.3};{1.2})', NA);
ta('TREND({2.4.6};{1.2.3};{4.5})', [[8, 10]]);
t('TREND({2.4.6};;4)', 8);
t('QUANTILSRANG.INKL({13.12.11.8.4.3.2.1.1.1};2)', 0.333);
t('QUANTILSRANG.INKL({13.12.11.8.4.3.2.1.1.1};4)', 0.555);
t('QUANTILSRANG.INKL({13.12.11.8.4.3.2.1.1.1};8)', 0.666);
t('QUANTILSRANG.INKL({13.12.11.8.4.3.2.1.1.1};5)', 0.583);
t('QUANTILSRANG({1.2.3};4)', NA);
t('QUANTIL.EXKL({1.2.3.6.6.6.7.8.9};0,25)', 2.5);
t('QUANTIL.EXKL({1.2.3.6.6.6.7.8.9};0)', NUM);
t('QUARTILE.EXKL({6.7.15.36.39.40.41.42.43.47.49};1)', 15);
t('QUARTILE.EXKL({6.7.15.36.39.40.41.42.43.47.49};3)', 43);
t('GESTUTZTMITTEL({4.5.6.7.2.3.4.5.1.2.3};0,2)', ap(3.777777778));
t('HARMITTEL(4;5;8;7;11;4;3)', ap(5.028375962));
t('HARMITTEL(1;0)', NUM);
t('SUMQUADABW(4;5;8;7;11;4;3)', 48);
t('KURT(3;4;5;2;3;4;5;6;4;7)', ap(-0.151799637));
t('SCHIEFE(3;4;5;2;3;4;5;6;4;7)', ap(0.359543071));
t('KURT(1;2;3)', DIV);
t('STANDARDISIERUNG(42;40;1,5)', ap(1.333333333));
t('STANDARDISIERUNG(42;40;0)', NUM);
t('KOVARIANZ.P({3.2.4.5.6};{9.7.12.15.17})', 5.2);
t('KOVARIANZ.S({3.2.4.5.6};{9.7.12.15.17})', 6.5);
t('NORM.S.VERT(1;WAHR)', ap(0.841344746, 1e-9));
t('NORM.S.VERT(1;FALSCH)', ap(0.241970725, 1e-9));
t('NORM.S.VERT(-4)', ap(3.16712e-5, 1e-9));
t('NORM.S.INV(0,975)', ap(1.959963985, 1e-8));
t('NORM.S.INV(0,001)', ap(-3.090232306, 1e-8));
t('NORM.VERT(42;40;1,5;WAHR)', ap(0.90878878, 1e-8));
t('NORM.VERT(42;40;1,5;FALSCH)', ap(0.10934005, 1e-8));
t('NORM.INV(0,908789;40;1,5)', ap(42.000002, 1e-5));
t('NORM.INV(1;40;1,5)', NUM);
t('BINOM.VERT(6;10;0,5;FALSCH)', ap(0.205078125, 1e-12));
t('BINOM.VERT(6;10;0,5;WAHR)', ap(0.828125, 1e-12));
t('BINOM.VERT(11;10;0,5;WAHR)', NUM);
t('POISSON.VERT(2;5;FALSCH)', ap(0.084224337, 1e-9));
t('POISSON.VERT(2;5;WAHR)', ap(0.124652019, 1e-9));
t('EXPON.VERT(0,2;10;WAHR)', ap(0.864664717, 1e-9));
t('EXPON.VERT(0,2;10;FALSCH)', ap(1.353352832, 1e-9));
t('KONFIDENZ.NORM(0,05;2,5;50)', ap(0.692951912, 1e-8));
t('VARIATIONEN(100;3)', 970200);
t('VARIATIONEN(3;4)', NUM);
t('ANZAHLEINDEUTIG({1.1.2."a"."A"})', 3);

// ---------------------------------------------------------------- math & engineering
t('SINHYP(1)', ap(1.175201194)); t('COSHYP(0)', 1); t('TANHYP(0,5)', ap(0.462117157)); t('ARCSINHYP(1)', ap(0.881373587));
t('ARCCOSHYP(0,5)', NUM); t('ARCTANHYP(1)', NUM); t('COT(30)', ap(-0.156119952)); t('COT(0)', DIV); t('WURZELPI(1)', ap(1.772453851));
t('ZWEIFAKULTÄT(7)', 105); t('ZWEIFAKULTÄT(6)', 48); t('POLYNOMIAL(2;3;4)', 1260);
t('RÖMISCH(499)', 'CDXCIX'); t('RÖMISCH(2026)', 'MMXXVI'); t('RÖMISCH(4000)', VAL); t('ARABISCH("MCMXII")', 1912); t('ARABISCH("abc")', VAL); t('ARABISCH("mmxxvi")', 2026);
t('BASIS(7;2)', '111'); t('BASIS(100;16;4)', '0064'); t('BASIS(7;1)', NUM); t('DEZIMAL("FF";16)', 255); t('DEZIMAL("111";2)', 7); t('DEZIMAL("G";16)', NUM);
t('DEZINBIN(9;4)', '1001'); t('DEZINBIN(-100)', '1110011100'); t('DEZINBIN(512)', NUM); t('DEZINBIN(9;2)', NUM); t('BININDEZ("1111111111")', -1); t('BININDEZ(1100100)', 100);
t('HEXINDEZ("FFFFFFFF5B")', -165); t('HEXINDEZ("a5")', 165); t('DEZINHEX(100;4)', '0064'); t('DEZINHEX(-54)', 'FFFFFFFFCA');
t('OKTINDEZ("7777777533")', -165); t('DEZINOKT(58;3)', '072');
ta('MMULT({1.3;7.2};{2.0;0.2})', [[2, 6], [14, 4]]);
t('MMULT({1.2};{1.2})', VAL);
t('MDET({3.6.1;1.1.0;3.10.2})', 1);
t('MDET({1.2;2.4})', 0);
ta('MINV({4.-1;2.0})', [[0, 0.5], [-1, 2]]);
t('MINV({1.2;2.4})', NUM);
ta('MEINHEIT(2)', [[1, 0], [0, 1]]);
t('SUMMEX2MY2({2.3.9.1.8.7.5};{6.5.11.7.5.4.4})', -55);
t('SUMMEX2PY2({2.3.9.1.8.7.5};{6.5.11.7.5.4.4})', 521);
t('SUMMEXMY2({2.3.9.1.8.7.5};{6.5.11.7.5.4.4})', 79);
t('AGGREGAT(9;6;A1:B3)', 10 + 20 + 30 + 7);
t('AGGREGAT(9;0;A1:B3)', DIV);
t('AGGREGAT(4;6;{1.2.#DIV/0!})', 2);
t('AGGREGAT(14;6;{1.5.3};2)', 3);
t('AGGREGAT(15;6;A1:A5;1)', 10);
t('AGGREGAT(99;0;A1)', VAL);

// ---------------------------------------------------------------- text, regex, information
t('WERTZUTEXT("a";1)', '"a"'); t('WERTZUTEXT(1,5)', '1,5'); t('WERTZUTEXT(WAHR)', 'WAHR');
t('MATRIXZUTEXT({1.2;3.4})', '1; 2; 3; 4'); t('MATRIXZUTEXT({1."b"};1)', '{1."b"}');
t('REGEXTEST("abc123";"\\d+")', true); t('REGEXTEST("abc";"\\d")', false); t('REGEXTEST("ABC";"abc";1)', true); t('REGEXTEST("a";"(")', VAL);
t('REGEXEXTRAKT("Tel: 0681-123";"\\d+")', '0681');
{ const t0 = Date.now(); t('REGEXTEST(WIEDERHOLEN("a";40)&"!";"^(a+)+$")', VAL); ok('nested quantifier refused quickly', Date.now() - t0 < 200, String(Date.now() - t0)); }
t('REGEXTEST("ab12";"^(ab)+\\d{2}$")', true);
ta('REGEXEXTRAKT("Tel: 0681-123";"\\d+";1)', [['0681'], ['123']]);
ta('REGEXEXTRAKT("Max Muster";"(\\w+) (\\w+)";2)', [['Max', 'Muster']]);
t('REGEXEXTRAKT("abc";"\\d")', NA);
t('REGEXERSETZEN("a1b22";"\\d+";"#")', 'a#b#');
t('REGEXERSETZEN("a1b22";"\\d+";"#";2)', 'a1b#');
t('REGEXERSETZEN("2026-10-15";"(\\d+)-(\\d+)-(\\d+)";"$3.$2.$1")', '15.10.2026');
t('HYPERLINK("https://fale.dev";"FaLe")', 'FaLe'); t('HYPERLINK("https://fale.dev")', 'https://fale.dev');
t('FORMELTEXT(N1)', '=A1*2'); t('FORMELTEXT(N2)', NA); t('FORMELTEXT(5)', VAL);
t('BLATT()', 1); t('BLATT(Preise!A1)', 2); t('BLATT("DB")', 3); t('BLÄTTER()', 3);
t('ZELLE("adresse";B3)', '$B$3'); t('ZELLE("zeile";B3)', 3); t('CELL("contents",A2)', 20); t('ZELLE("typ";N2)', 'l'); t('ZELLE("x";A1)', VAL);

// ---------------------------------------------------------------- financial
t('GDA2(1000000;100000;6;1;7)', ap(186083.333333, 1e-4));
t('GDA2(1000000;100000;6;2;7)', ap(259639.416667, 1e-4));
t('GDA2(1000000;100000;6;7;7)', ap(15845.098473, 1e-4));
t('GDA(2400;300;10;1;2)', 480); t('GDA(2400;300;120;1;2)', 40); t('GDA(2400;300;10;10)', ap(22.1225472, 1e-6)); t('GDA(2400;300;10;11)', NUM);
t('DIA(30000;7500;10;1)', ap(4090.909091)); t('DIA(30000;7500;10;10)', ap(409.0909091));
t('QIKV({-120000.39000.30000.21000.37000.46000};0,1;0,12)', ap(0.126094, 1e-6));
t('QIKV({1.2};0,1;0,1)', DIV);
t('ZW2(1;{0,09.0,11.0,1})', ap(1.33089));
t('PDURATION(2,5%;2000;2200)', ap(3.859866163));
t('ZSATZINVEST(96;10000;11000)', ap(0.000993307, 1e-9));
t('ISPMT(0,1/12;1;36;8000000)', ap(-64814.8148, 1e-3));

// ---------------------------------------------------------------- database
t('DBSUMME(DB!A1:E7;"Gewinn";DB!H1:I2)', 180);
t('DBANZAHL(DB!A1:E7;"Alter";DB!H1:I2)', 2);
t('DBANZAHL2(DB!A1:E7;"Baum";DB!H1:I2)', 2);
t('DBMAX(DB!A1:E7;5;DB!H1:I2)', 105);
t('DBMIN(DB!A1:E7;"Gewinn";DB!H1:I2)', 75);
t('DBMITTELWERT(DB!A1:E7;"Ertrag";DB!H1:I2)', 12);
t('DBPRODUKT(DB!A1:E7;"Ertrag";DB!H1:I2)', 140);
t('DBAUSZUG(DB!A1:E7;"Ertrag";DB!H1:I2)', NUM);
t('DBSUMME(DB!A1:E7;"Unbekannt";DB!H1:I2)', VAL);
t('DBSUMME(DB!A1:E7;"Gewinn";DB!H1:H1)', 502.8);

// ---------------------------------------------------------------- German input conventions & number formats
const pi = s => W.parseInput(s);
ok('parse 1.234,56', pi('1.234,56').v === 1234.56);
ok('parse 1.234 (thousands)', pi('1.234').v === 1234);
ok('parse -0,5', pi('-0,5').v === -0.5);
ok('parse 12,5 %', Math.abs(pi('12,5 %').v - 0.125) < 1e-12 && pi('12,5 %').fmt === '0.00%');
ok('parse 1.000,50 €', pi('1.000,50 €').v === 1000.5 && /€/.test(pi('1.000,50 €').fmt));
ok('parse date 15.10.2026', pi('15.10.2026').v === (Date.UTC(2026, 9, 15) - Date.UTC(1899, 11, 30)) / 86400000 && pi('15.10.2026').fmt === 'dd.mm.yyyy');
ok('parse time 7:30', Math.abs(pi('7:30').v - 7.5 / 24) < 1e-12);
ok('parse text keeps apostrophe', pi("'0049").v === '0049');
ok('format currency', W.formatValue(-1234.5, '#,##0.00 "€"') === '-1.234,50 €', W.formatValue(-1234.5, '#,##0.00 "€"'));
ok('formula German decimal', F.toCanonical('RUNDEN(2,345;2)') === 'ROUND(2.345,2)');
ok('formula German array', F.toCanonical('SUMME({1.2;3.4})') === 'SUM({1,2;3,4})', F.toCanonical('SUMME({1.2;3.4})'));
ok('display English → German', F.toDisplay('TEXTSPLIT(A1,",")') === 'TEXTTEILEN(A1;",")');
ok('new names known', ['LAMBDA', 'TEXTSPLIT', 'VSTACK', 'NORM.DIST', 'DSUM', 'REGEXREPLACE', 'AGGREGATE'].every(n => F.KNOWN_FUNCTIONS.has(n)));
ok('xlsx prefixes', F.toXlsx('TEXTSPLIT(A1,",")') === '_xlfn.TEXTSPLIT(A1,",")' && F.toXlsx('NORM.S.DIST(1,TRUE)') === '_xlfn.NORM.S.DIST(1,TRUE)' && F.toXlsx('DSUM(A1:B2,1,C1:C2)') === 'DSUM(A1:B2,1,C1:C2)');

// ---------------------------------------------------------------- relative/absolute references when copying
const shift = (f, dr, dc) => F.shiftRefs(f, ref => ({ ...ref, r: ref.absR || ref.colOnly ? ref.r : ref.r + dr, c: ref.absC || ref.rowOnly ? ref.c : ref.c + dc }));
ok('copy relative', shift('A1+B2', 1, 1) === 'B2+C3');
ok('copy absolute', shift('$A$1+A$1+$A1', 2, 3) === '$A$1+D$1+$A3', shift('$A$1+A$1+$A1', 2, 3));
ok('copy cross-sheet', shift('Preise!A1*2', 1, 0) === 'Preise!A2*2');
ok('copy whole column', shift('SUM(B:B)', 5, 1) === 'SUM(C:C)', shift('SUM(B:B)', 5, 1));
ok('copy lambda param untouched', shift('MAP(A1:A3,LAMBDA(x,x*2))', 1, 0) === 'MAP(A2:A4,LAMBDA(x,x*2))', shift('MAP(A1:A3,LAMBDA(x,x*2))', 1, 0));

// ---------------------------------------------------------------- circular references
{
  const w2 = W.newWorkbook(); const s2 = w2.sheets[0];
  W.setCell(s2, 0, 0, { f: 'B1+1', da: true }); W.setCell(s2, 0, 1, { f: 'A1*2', da: true }); W.setCell(s2, 0, 2, { f: 'A1+5', da: true });
  W.recalc(w2);
  ok('circular A1↔B1', isE(W.getCell(s2, 0, 0).cv, '#CIRC!') || isE(W.getCell(s2, 0, 1).cv, '#CIRC!'), show(W.getCell(s2, 0, 0).cv));
  ok('circular reported', w2._circ && w2._circ.length > 0);
  W.setCell(s2, 0, 1, { v: 3 }); W.recalcCells(w2, [{ si: 0, r: 0, c: 1 }]);
  ok('circular resolved after edit', W.getCell(s2, 0, 0).cv === 4 && W.getCell(s2, 0, 2).cv === 9, show(W.getCell(s2, 0, 2).cv));
  const w3 = W.newWorkbook(); const s3 = w3.sheets[0];
  w3.names = [{ name: 'Endlos', ref: 'LAMBDA(n,Endlos(n+1))', si: null }];
  W.setCell(s3, 0, 0, { f: 'Endlos(1)', da: true }); W.recalc(w3);
  ok('endless recursion is caught', isE(W.getCell(s3, 0, 0).cv, '#CALC!') || isE(W.getCell(s3, 0, 0).cv, '#CIRC!'), show(W.getCell(s3, 0, 0).cv));
}

// ---------------------------------------------------------------- AutoFill series (German lists, dates, numbers)
{
  const O = await import(ROOT + 'sheet-ops.js');
  const vals = (src, n, opts) => O.planFill(src, n, opts).map(p => (p.v !== undefined ? p.v : src[p.src] && src[p.src].v));
  const S = (d, m, y) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  ok('fill weekdays', JSON.stringify(vals([{ v: 'Mo' }], 3)) === '["Di","Mi","Do"]');
  ok('fill long weekdays wrap', JSON.stringify(vals([{ v: 'Samstag' }], 2)) === '["Sonntag","Montag"]');
  ok('fill months with step', JSON.stringify(vals([{ v: 'Januar' }, { v: 'März' }], 2)) === '["Mai","Juli"]');
  ok('fill quarters', JSON.stringify(vals([{ v: 'Q3' }], 3)) === '["Q4","Q1","Q2"]');
  ok('fill numbers linear', JSON.stringify(vals([{ v: 2 }, { v: 4 }], 2)) === '[6,8]');
  ok('fill text with number', JSON.stringify(vals([{ v: 'Raum 9' }], 2)) === '["Raum 10","Raum 11"]');
  ok('fill dates daily', JSON.stringify(vals([{ v: S(30, 12, 2026), s: { fmt: 'dd.mm.yyyy' } }], 2)) === JSON.stringify([S(31, 12, 2026), S(1, 1, 2027)]));
  ok('fill backwards', JSON.stringify(vals([{ v: 'Mi' }], 2, { forward: false })) === '["Di","Mo"]');
  ok('paste TSV with quotes', JSON.stringify(O.parseTsv('a\t"b\tc"\n1\t2')) === JSON.stringify([['a', 'b\tc'], ['1', '2']]));
}

// ---------------------------------------------------------------- catalogue
ok('every catalogue entry is a known function', F.FUNCTION_LIST.every(([n]) => F.KNOWN_FUNCTIONS.has(F.canonicalFn(n))), F.FUNCTION_LIST.filter(([n]) => !F.KNOWN_FUNCTIONS.has(F.canonicalFn(n))).map(x => x[0]).join(','));
if (F.FN_ARGS) {
  const missing = [...F.KNOWN_FUNCTIONS].filter(n => !F.FUNCTION_LIST.some(([g]) => F.canonicalFn(g) === n));
  ok('every function is in the catalogue', !missing.length, missing.join(','));
  const noArgs = F.FUNCTION_LIST.filter(([g]) => !(F.canonicalFn(g) in F.FN_ARGS)).map(x => x[0]);
  ok('every catalogue entry has argument help', !noArgs.length, noArgs.join(','));
}

for (const f of fails) console.log('FAIL ' + f);
console.log(`\nformula3 tests: ${pass} passed, ${fail} failed (${pass + fail} assertions)`);
process.exit(fail ? 1 : 0);
