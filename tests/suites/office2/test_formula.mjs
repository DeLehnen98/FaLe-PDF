// Unit tests for the FaLe formula engine (js/office/formula.js), number formats (numfmt.js) and workbook recalculation.
// Run: node test_formula.mjs   (prints PASS/FAIL per assertion and a summary; exit code 1 on failures)
const ROOT = '/home/claude/FalePDF/js/office/';
const F = await import(ROOT + 'formula.js');
const W = await import(ROOT + 'workbook.js');
const NF = await import(ROOT + 'numfmt.js');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, info = '') {
  if (cond) pass++; else { fail++; fails.push(`${name}  ${info}`); }
}
const isE = (v, code) => v && v.code === code;
function same(a, b) {
  if (typeof b === 'number' && typeof a === 'number') return Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9);
  if (b && typeof b === 'object' && b.err) return isE(a, b.err);
  if (b && typeof b === 'object' && b.approx !== undefined) return typeof a === 'number' && Math.abs(a - b.approx) <= (b.tol ?? 1e-6);
  return a === b;
}
const show = v => (v && v.code ? v.code : JSON.stringify(v));

// ---------------------------------------------------------------- fixture workbook
const wb = W.newWorkbook();
const sh = wb.sheets[0];
sh.name = 'Daten';
const preise = W.newSheet('Preise');
wb.sheets.push(preise);
function put(s, a, text) { const p = F.parseAddr(a); const x = W.parseInput(text); const cell = {}; if (x.fmt) cell.s = { fmt: x.fmt }; if (x.f) { cell.f = x.f; cell.da = true; } else cell.v = x.v; W.setCell(s, p.r, p.c, cell); }
[['A1', '10'], ['A2', '20'], ['A3', '30'], ['A4', '40'], ['A5', '50'],
 ['B1', 'Nord'], ['B2', 'Süd'], ['B3', 'Nord'], ['B4', 'Ost'], ['B5', 'Nord'],
 ['C1', '5'], ['C2', '15'], ['C3', '25'], ['C4', '35'], ['C5', '45'],
 ['D1', 'WAHR'], ['D2', 'FALSCH'], ['D3', 'WAHR'], ['D5', 'text'],
 ['E1', '01.01.2026'], ['E2', '15.02.2026'], ['E3', '31.03.2026'], ['E4', '29.02.2024'], ['E5', '31.12.2025'],
 ['F1', '  Hallo   Welt  '], ['F2', 'Äpfel und Birnen'], ['F3', 'abc'], ['F4', 'a*c'], ['F5', 'MÜLLER'],
 ['G1', 'Äpfel'], ['H1', '1,2'], ['G2', 'Birnen'], ['H2', '2,49'], ['G3', 'Datteln'], ['H3', '7'], ['G4', 'Kirschen'], ['H4', '4,2'],
 ['I1', '1'], ['I2', '2'], ['I3', '2'], ['I4', '3'], ['I5', '3'], ['I6', '3'],
 ['J1', '-10000'], ['J2', '3000'], ['J3', '4200'], ['J4', '6800'],
 ['K1', '01.01.2026'], ['K2', '01.03.2026'], ['K3', '30.10.2026'], ['K4', '15.02.2027'],
 ['L1', '-10000'], ['L2', '2750'], ['L3', '4250'], ['L4', '3250'],
 ['M1', 'x'], ['M2', ''], ['M3', '5'],
].forEach(([a, t]) => put(sh, a, t));
put(preise, 'A1', '100'); put(preise, 'B2', '200');
wb.names = [{ name: 'Umsatz', ref: 'Daten!$A$1:$A$5', si: null }, { name: 'Steuersatz', ref: '0.19', si: null }];
W.recalc(wb);

let slot = 0;
function calc(formula, { dynamic = true } = {}) {
  const r = 100 + (slot++ % 300) * 12, c = 30;
  const x = W.parseInput(formula.startsWith('=') ? formula : '=' + formula);
  W.setCell(sh, r, c, { f: x.f, da: dynamic });
  W.recalc(wb);
  const cell = W.getCell(sh, r, c);
  const v = cell.cv;
  let arr = null;
  if (cell.spill) { arr = []; for (let i = 0; i < cell.spill.h; i++) { const row = []; for (let j = 0; j < cell.spill.w; j++) row.push(W.valueAt(sh, r + i, c + j)); arr.push(row); } }
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
const S = (d, m, y) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const NA = { err: '#N/A' }, VAL = { err: '#VALUE!' }, DIV = { err: '#DIV/0!' }, NUM = { err: '#NUM!' }, REF = { err: '#REF!' }, NAME = { err: '#NAME?' }, CALC = { err: '#CALC!' };

// ---------------------------------------------------------------- operators & basics
t('1+2*3', 7); t('(1+2)*3', 9); t('2^10', 1024); t('-2^2', 4); t('10/4', 2.5); t('1/0', DIV); t('"a"&"b"&1', 'ab1');
t('5%', 0.05); t('50%*200', 100); t('0,1+0,2', 0.3); t('0.1+0.2', 0.3); t('"3"+4', 7); t('"x"+1', VAL); t('WAHR+1', 2);
t('1=1', true); t('"abc"="ABC"', true); t('"Äpfel"="Apfel"', false); t('2<>3', true); t('"b">"a"', true); t('A1<=A2', true); t('3>=4', false);
t('A1+A2', 30); t('$A$1+A$2', 30); t('Preise!A1+Preise!B2', 300); t("'Preise'!A1*2", 200); t('Fehlend!A1', REF);
t('SUMME(A1:A5)', 150); t('SUM(A1:A5)', 150); t('SUMME(A:A)', 150); t('SUMME(1:1)', 10 + 5 + S(1, 1, 2026) + 1.2 + 1 - 10000 + S(1, 1, 2026) - 10000);
t('Umsatz', 10); t('SUMME(Umsatz)', 150); t('A1*Steuersatz', 1.9); t('Unbekannt+1', NAME); t('FOO(1)', NAME); t('#NV', NA); t('#BEZUG!', REF);
t('{1;2;3}', 1); ta('{1.2.3;4.5.6}', [[1, 2, 3], [4, 5, 6]]); t('SUMME({1.2;3.4})', 10);
t('@A1:A5', 10);

// ---------------------------------------------------------------- math
t('PRODUKT(1;2;3;4)', 24); t('PRODUCT(A1:A2)', 200); t('QUADRATESUMME(3;4)', 25); t('SUMSQ(3,4)', 25);
t('SUMMENPRODUKT(A1:A5;C1:C5)', 10 * 5 + 20 * 15 + 30 * 25 + 40 * 35 + 50 * 45); t('SUMPRODUCT((B1:B5="Nord")*A1:A5)', 90); t('SUMMENPRODUKT(A1:A2;A1:A3)', VAL);
t('ABS(-7,5)', 7.5); t('RUNDEN(2,345;2)', 2.35); t('RUNDEN(-2,5;0)', -3); t('ROUND(1234.5678,-2)', 1200); t('RUNDEN(2,675;2)', 2.68);
t('AUFRUNDEN(3,21;1)', 3.3); t('AUFRUNDEN(-3,21;0)', -4); t('ROUNDUP(0.1,0)', 1); t('ABRUNDEN(3,99;0)', 3); t('ABRUNDEN(-3,99;1)', -3.9); t('ROUNDDOWN(1234,-2)', 1200);
t('VRUNDEN(10;3)', 9); t('VRUNDEN(11;3)', 12); t('MROUND(-10,-3)', -9); t('VRUNDEN(10;-3)', NUM);
t('OBERGRENZE(2,5;1)', 3); t('OBERGRENZE(-2,5;-2)', -4); t('OBERGRENZE(-2,5;2)', -2); t('CEILING(2.5,-1)', NUM); t('OBERGRENZE(4,42;0,05)', 4.45);
t('UNTERGRENZE(2,5;1)', 2); t('UNTERGRENZE(-2,5;-2)', -2); t('FLOOR(-2.5,2)', -4); t('UNTERGRENZE(3;0)', DIV);
t('OBERGRENZE.MATHEMATIK(-5,5)', -5); t('OBERGRENZE.MATHEMATIK(-5,5;1;1)', -6); t('CEILING.MATH(24.3,5)', 25); t('UNTERGRENZE.MATHEMATIK(-5,5)', -6); t('FLOOR.MATH(-5.5,1,1)', -5);
t('GANZZAHL(8,9)', 8); t('INT(-8.9)', -9); t('KÜRZEN(8,97;1)', 8.9); t('TRUNC(-8.9)', -8);
t('REST(10;3)', 1); t('REST(-3;2)', 1); t('MOD(3,-2)', -1); t('REST(5;0)', DIV);
t('POTENZ(2;0,5)', Math.SQRT2); t('POWER(5,2)', 25); t('POTENZ(0;-1)', DIV); t('WURZEL(16)', 4); t('SQRT(-1)', NUM);
t('EXP(1)', Math.E); t('LN(EXP(2))', 2); t('LN(0)', NUM); t('LOG(100)', 2); t('LOG(8;2)', 3); t('LOG10(1000)', 3); t('PI()', Math.PI);
t('VORZEICHEN(-3)', -1); t('SIGN(0)', 0); t('GERADE(1,5)', 2); t('GERADE(-1)', -2); t('UNGERADE(2)', 3); t('ODD(-2.5)', -3);
t('FAKULTÄT(5)', 120); t('FACT(0)', 1); t('FAKULTÄT(-1)', NUM); t('KOMBINATIONEN(5;2)', 10); t('COMBIN(4,5)', NUM);
t('GGT(12;18)', 6); t('GCD(24,36,48)', 12); t('KGV(4;6)', 12); t('LCM(3,5,7)', 105); t('GGT(-1;2)', NUM);
t('QUOTIENT(7;2)', 3); t('QUOTIENT(-7;2)', -3); t('QUOTIENT(1;0)', DIV);
t('SIN(PI()/2)', 1); t('COS(0)', 1); t('TAN(0)', 0); t('ARCSIN(1)', Math.PI / 2); t('ARCCOS(2)', NUM); t('ARCTAN(1)', Math.PI / 4); t('ARCTAN2(1;1)', Math.PI / 4); t('ATAN2(0,0)', DIV);
t('GRAD(PI())', 180); t('BOGENMASS(180)', Math.PI); t('RADIANS(90)', Math.PI / 2);
{ const r = calc('ZUFALLSZAHL()').v; ok('ZUFALLSZAHL range', r >= 0 && r < 1, r); }
{ const r = calc('ZUFALLSBEREICH(1;6)').v; ok('ZUFALLSBEREICH int 1..6', Number.isInteger(r) && r >= 1 && r <= 6, r); }
t('RANDBETWEEN(5,1)', NUM);
{ const r = calc('ZUFALLSMATRIX(2;3)'); ok('ZUFALLSMATRIX 2x3', r.arr && r.arr.length === 2 && r.arr[0].length === 3, JSON.stringify(r)); }
t('TEILERGEBNIS(9;A1:A5)', 150); t('SUBTOTAL(1,A1:A5)', 30); t('TEILERGEBNIS(4;A1:A5)', 50); t('TEILERGEBNIS(99;A1:A5)', VAL);
t('SUMMEWENN(B1:B5;"Nord";A1:A5)', 90); t('SUMIF(A1:A5,">25")', 120); t('SUMMEWENN(B1:B5;"N*";C1:C5)', 75); t('SUMMEWENN(A1:A5;"<>30")', 120);
t('SUMMEWENNS(A1:A5;B1:B5;"Nord";C1:C5;">10")', 80); t('SUMIFS(A1:A5,B1:B5,"Ost")', 40); t('SUMMEWENNS(A1:A5;B1:B4;"Nord")', VAL);

// ---------------------------------------------------------------- statistics
t('MITTELWERT(A1:A5)', 30); t('AVERAGE(A1:A5,100)', 250 / 6); t('MITTELWERT(M1:M2)', DIV); t('MITTELWERTA(D1:D5)', 0.5);
t('MITTELWERTWENN(B1:B5;"Nord";C1:C5)', 25); t('AVERAGEIF(A1:A5,">100")', DIV); t('MITTELWERTWENNS(C1:C5;B1:B5;"Nord";A1:A5;"<50")', 15);
t('ANZAHL(A1:F5)', 15); t('COUNT(1,"2","x",WAHR)', 3); t('ANZAHL2(D1:D5)', 4); t('COUNTA(M1:M3)', 2); t('ANZAHLLEEREZELLEN(D1:D5)', 1); t('ZÄHLENLEERE(M1:M3)', 1); t('COUNTBLANK(M1:M3)', 1);
t('ZÄHLENWENN(B1:B5;"Nord")', 3); t('ZAEHLENWENN(B1:B5;"nord")', 3); t('COUNTIF(A1:A5,">=30")', 3); t('ZÄHLENWENN(B1:B5;"?üd")', 1); t('ZÄHLENWENN(F1:F5;"a~*c")', 1); t('ZÄHLENWENN(E1:E5;">01.01.2026")', 2);
t('ZÄHLENWENNS(B1:B5;"Nord";A1:A5;">10")', 2); t('COUNTIFS(A1:A5,">10",A1:A5,"<50")', 3);
t('MAX(A1:A5)', 50); t('MIN(A1:A5;5)', 5); t('MAX(M1:M2)', 0); t('MAXA(D1:D5)', 1); t('MINA(D1:D5)', 0);
t('MAXWENNS(A1:A5;B1:B5;"Nord")', 50); t('MINIFS(A1:A5,B1:B5,"Nord")', 10); t('MAXWENNS(A1:A5;B1:B5;"West")', 0);
t('MEDIAN(A1:A5)', 30); t('MEDIAN(1;2;3;4)', 2.5); t('MEDIAN(M1)', NUM);
t('MODALWERT(I1:I6)', 3); t('MODUS.EINF(1;2;2;3)', 2); t('MODUS(1;2;3)', NA); t('MODE.SNGL(I1:I6)', 3);
t('STABW(A1:A5)', Math.sqrt(250)); t('STABW.S(A1:A5)', Math.sqrt(250)); t('STABWN(A1:A5)', Math.sqrt(200)); t('STDEV.P(A1:A5)', Math.sqrt(200)); t('STABW(5)', DIV);
t('VARIANZ(A1:A5)', 250); t('VAR.S(A1:A5)', 250); t('VARIANZEN(A1:A5)', 200); t('VAR.P(A1:A5)', 200);
t('KGRÖSSTE(A1:A5;2)', 40); t('LARGE(A1:A5,1)', 50); t('KGROESSTE(A1:A5;6)', NUM); t('KKLEINSTE(A1:A5;2)', 20); t('SMALL(A1:A5,0)', NUM);
t('RANG(30;A1:A5)', 3); t('RANG(30;A1:A5;1)', 3); t('RANG.GLEICH(50;A1:A5)', 1); t('RANK.EQ(10,A1:A5,1)', 1); t('RANG(31;A1:A5)', NA); t('RANG.MITTELW(3;I1:I6)', 2); t('RANK.AVG(2,I1:I6,1)', 2.5);
t('QUANTIL(A1:A5;0,25)', 20); t('QUANTIL.INKL(A1:A5;0,9)', 46); t('PERCENTILE.INC(A1:A5,1.5)', NUM);
t('QUARTILE(A1:A5;1)', 20); t('QUARTILE.INKL(A1:A5;2)', 30); t('QUARTILE(A1:A5;5)', NUM);
t('KORREL(A1:A5;C1:C5)', 1); t('CORREL(A1:A5,{5;4;3;2;1})', -1); t('GEOMITTEL(2;8)', 4); t('GEOMEAN(-1,2)', NUM); t('MITTELABW(2;4;6)', 4 / 3);

// ---------------------------------------------------------------- logical
t('WENN(A1>5;"groß";"klein")', 'groß'); t('IF(A1>50,"x")', false); t('WENN(1;;)', 0); t('WENN("abc";1;2)', VAL); t('WENN(FALSCH;1/0;2)', 2);
ta('WENN(A1:A3>15;"ja";"nein")', [['nein'], ['ja'], ['ja']]);
t('WENNS(A3>40;"a";A3>20;"b";WAHR;"c")', 'b'); t('IFS(A1>100,1)', NA);
t('WENNFEHLER(1/0;"Fehler")', 'Fehler'); t('IFERROR(5,0)', 5); t('WENNFEHLER(SVERWEIS("x";G1:H4;2;0);"-")', '-');
t('WENNNV(SVERWEIS("x";G1:H4;2;0);"nv")', 'nv'); t('IFNA(1/0,"x")', DIV);
t('UND(WAHR;A1>5)', true); t('AND(TRUE,FALSE)', false); t('UND(D1:D3)', false); t('UND(M1:M2)', VAL); t('UND("x")', VAL);
t('ODER(FALSCH;A1>5)', true); t('OR(FALSE,FALSE)', false); t('ODER(D1:D2)', true);
t('XODER(WAHR;WAHR)', false); t('XOR(TRUE,FALSE,TRUE,TRUE)', true); t('NICHT(WAHR)', false); t('NOT(0)', true);
t('WAHR()', true); t('FALSCH()', false);
t('ERSTERWERT(2;1;"eins";2;"zwei";"sonst")', 'zwei'); t('SWITCH(9,1,"a","def")', 'def'); t('ERSTERWERT(9;1;"a")', NA);

// ---------------------------------------------------------------- lookup
t('SVERWEIS("Birnen";G1:H4;2;FALSCH)', 2.49); t('VLOOKUP("kirschen",G1:H4,2,0)', 4.2); t('SVERWEIS("Bir*";G1:H4;2;0)', 2.49); t('SVERWEIS("Zitrone";G1:H4;2;0)', NA); t('SVERWEIS("Birnen";G1:H4;3;0)', REF);
t('SVERWEIS(35;A1:C5;3)', 25); t('SVERWEIS(5;A1:C5;2;WAHR)', NA); t('SVERWEIS(100;A1:C5;2)', 'Nord');
t('WVERWEIS(30;A1:A5;1)', 10); t('WVERWEIS("Nord";B1:C3;2;0)', 'Süd'); t('HLOOKUP(20,{10,20,30;1,2,3},2,FALSE)', 2);
t('XVERWEIS("Datteln";G1:G4;H1:H4)', 7); t('XLOOKUP("x",G1:G4,H1:H4,"nichts")', 'nichts'); t('XVERWEIS("x";G1:G4;H1:H4)', NA);
t('XVERWEIS(33;A1:A5;C1:C5;;-1)', 25); t('XVERWEIS(33;A1:A5;C1:C5;;1)', 35); t('XVERWEIS("D*";G1:G4;H1:H4;;2)', 7); t('XVERWEIS(30;A1:A5;C1:C5;;0;-1)', 25);
ta('XVERWEIS(20;A1:A5;B1:C5)', [['Süd', 15]]); t('XVERWEIS(20;A1:A5;B1:B4)', VAL);
t('VERGLEICH(30;A1:A5;0)', 3); t('MATCH(35,A1:A5)', 3); t('VERGLEICH(5;A1:A5;1)', NA); t('VERGLEICH("Ost";B1:B5;0)', 4); t('VERGLEICH(25;{50;40;30;20};-1)', 3);
t('XVERGLEICH("Ost";B1:B5)', 4); t('XMATCH(45,A1:A5,1)', 5); t('XVERGLEICH(99;A1:A5)', NA);
t('INDEX(A1:C5;2;3)', 15); t('INDEX(A1:A5;4)', 40); t('INDEX(B1:C1;2)', 5); t('INDEX(A1:C5;6;1)', REF); t('SUMME(INDEX(A1:C5;0;3))', 125); t('SUMME(INDEX(A1:C5;2;0))', 20 + 15);
t('INDEX(A1:C5;VERGLEICH("Ost";B1:B5;0);1)', 40);
t('WAHL(2;"a";"b";"c")', 'b'); t('CHOOSE(4,"a","b")', VAL);
t('ZEILE(C7)', 7); t('SPALTE(D1)', 4); t('ZEILE()>100', true); t('ZEILEN(A1:C5)', 5); t('SPALTEN(A1:C5)', 3); t('ROWS({1;2;3})', 3); t('ZEILEN(A:A)', 1048576);
t('SUMME(BEREICH.VERSCHIEBEN(A1;1;0;3;1))', 90); t('OFFSET(A1,2,2)', 25); t('BEREICH.VERSCHIEBEN(A1;-1;0)', REF);
t('INDIREKT("A2")', 20); t('INDIRECT("Preise!B2")', 200); t('SUMME(INDIREKT("A1:A3"))', 60); t('INDIREKT("Z1S1";FALSCH)', 10); t('INDIREKT("Umsatz")', 10); t('INDIREKT("xyz")', REF);
t('ADRESSE(2;3)', '$C$2'); t('ADDRESS(2,3,4)', 'C2'); t('ADRESSE(2;3;2)', 'C$2'); t('ADRESSE(1;1;1;WAHR;"Preise")', 'Preise!$A$1'); t('ADRESSE(0;1)', VAL);
t('VERWEIS(35;A1:A5;C1:C5)', 25); t('LOOKUP(5,A1:A5,C1:C5)', NA);
ta('MTRANS(A1:C2)', [[10, 20], ['Nord', 'Süd'], [5, 15]]);
ta('FILTER(A1:A5;B1:B5="Nord")', [[10], [30], [50]]); t('FILTER(A1:A5;A1:A5>100;"keine")', 'keine'); t('FILTER(A1:A5;A1:A5>100)', CALC); ta('FILTER(A1:C1;{1.0.1})', [[10, 5]]);
ta('SORTIEREN(C1:C5;1;-1)', [[45], [35], [25], [15], [5]]); ta('SORT(B1:B5)', [['Nord'], ['Nord'], ['Nord'], ['Ost'], ['Süd']]); ta('SORTIEREN({3;1;2})', [[1], [2], [3]]);
ta('SORTIERENNACH(B1:B4;A1:A4;-1)', [['Ost'], ['Nord'], ['Süd'], ['Nord']]);
ta('EINDEUTIG(B1:B5)', [['Nord'], ['Süd'], ['Ost']]); ta('UNIQUE(I1:I6,FALSE,TRUE)', [[1]]); ta('EINDEUTIG({1.1.2};WAHR)', [[1, 2]]);
ta('SEQUENZ(3)', [[1], [2], [3]]); ta('SEQUENCE(2,3,10,5)', [[10, 15, 20], [25, 30, 35]]); t('SEQUENZ(0)', CALC);
ta('A1:A3*2', [[20], [40], [60]]); ta('A1:A2&"-"&B1:B2', [['10-Nord'], ['20-Süd']]);

// ---------------------------------------------------------------- text
t('VERKETTEN("a";"b";1)', 'ab1'); t('CONCATENATE(A1,"-",B1)', '10-Nord'); t('TEXTKETTE(B1:B3)', 'NordSüdNord'); t('CONCAT("x",A1:A2)', 'x1020');
t('TEXTVERKETTEN(", ";WAHR;B1:B3)', 'Nord, Süd, Nord'); t('TEXTJOIN("-",TRUE,M1:M3)', 'x-5'); t('TEXTVERKETTEN("-";FALSCH;M1:M3)', 'x--5');
t('LINKS("Hallo";2)', 'Ha'); t('LEFT("Hallo")', 'H'); t('LINKS("Hallo";-1)', VAL); t('RECHTS("Hallo";3)', 'llo'); t('RIGHT("Hi",5)', 'Hi');
t('TEIL("Hallo Welt";7;4)', 'Welt'); t('MID("abc",0,1)', VAL); t('LÄNGE("Größe")', 5); t('LEN(A1)', 2); t('LAENGE("")', 0);
t('FINDEN("l";"Hallo")', 3); t('FIND("L","Hallo")', VAL); t('FINDEN("l";"Hallo";4)', 4); t('SUCHEN("L";"Hallo")', 3); t('SEARCH("W?lt","Hallo Welt")', 7); t('SUCHEN("x";"abc")', VAL);
t('ERSETZEN("Hallo";1;1;"B")', 'Ballo'); t('REPLACE("abcdef",3,2,"XY")', 'abXYef');
t('WECHSELN("a-b-c";"-";"+")', 'a+b+c'); t('SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'); t('WECHSELN("aaa";"a";"b";5)', 'aaa');
t('GLÄTTEN(F1)', 'Hallo Welt'); t('TRIM("  a  b ")', 'a b'); t('SÄUBERN("a"&ZEICHEN(9)&"b")', 'ab');
t('GROSS("straße")', 'STRASSE'); t('KLEIN(F5)', 'müller'); t('GROSS2("hans-peter müller")', 'Hans-Peter Müller'); t('PROPER("ÄPFEL und birnen")', 'Äpfel Und Birnen');
t('TEXT(1234,5;"#.##0,00")', '1.234,50'); t('TEXT(0,256;"0,0 %")', '25,6 %'); t('TEXT(E1;"TT.MM.JJJJ")', '01.01.2026'); t('TEXT(E3;"TTTT")', 'Dienstag');
t('TEXT(E2;"MMMM JJJJ")', 'Februar 2026'); t('TEXT(1234.5,"#,##0.00")', '1.234,50'); t('TEXT(0,5;"hh:mm")', '12:00'); t('TEXT(-5;"0;(0)")', '(5)'); t('TEXT("abc";"0")', 'abc');
t('WERT("1.234,5")', 1234.5); t('VALUE("12%")', 0.12); t('WERT("31.12.2026")', S(31, 12, 2026)); t('WERT("abc")', VAL); t('VALUE("14:30")', 14.5 / 24);
t('ZAHLENWERT("1.234,5")', 1234.5); t('NUMBERVALUE("1,234.5",".",",")', 1234.5); t('ZAHLENWERT("50%")', 0.5);
t('WIEDERHOLEN("ab";3)', 'ababab'); t('REPT("x",-1)', VAL); t('IDENTISCH("a";"A")', false); t('EXACT("a","a")', true);
t('ZEICHEN(65)', 'A'); t('CHAR(128)', '€'); t('ZEICHEN(0)', VAL); t('CODE("A")', 65); t('CODE("€")', 128); t('CODE("")', VAL); t('UNIZEICHEN(8364)', '€'); t('UNICODE("€")', 8364);
t('FEST(1234,567;2)', '1.234,57'); t('FIXED(1234.567,1,TRUE)', '1234,6'); t('FEST(-0,5;0)', '-1');
t('T("abc")', 'abc'); t('T(5)', ''); t('N(WAHR)', 1); t('N("x")', 0); t('N(7)', 7);
t('TEXTVOR("max@beispiel.de";"@")', 'max'); t('TEXTNACH("a,b,c";",";2)', 'c'); t('TEXTAFTER("a,b,c",",",-1)', 'c'); t('TEXTVOR("abc";"x")', NA);

// ---------------------------------------------------------------- dates
t('DATUM(2026;3;15)', S(15, 3, 2026)); t('DATE(2026,14,1)', S(1, 2, 2027)); t('DATUM(2026;1;0)', S(31, 12, 2025)); t('DATUM(126;1;1)', S(1, 1, 2026)); t('DATUM(-1;1;1)', NUM);
t('ZEIT(14;30;0)', 14.5 / 24); t('TIME(25,0,0)', 1 / 24); t('ZEIT(-1;0;0)', NUM);
t('JAHR(E4)', 2024); t('MONAT(E4)', 2); t('TAG(E4)', 29); t('YEAR("15.03.2026")', 2026); t('JAHR(-1)', NUM);
t('STUNDE(0,75)', 18); t('MINUTE(ZEIT(9;45;30))', 45); t('SEKUNDE(ZEIT(9;45;30))', 30); t('HOUR("14:20")', 14);
t('WOCHENTAG(E1)', 5); t('WOCHENTAG(E1;2)', 4); t('WEEKDAY(E1,3)', 3); t('WOCHENTAG(E1;11)', 4); t('WOCHENTAG(E1;16)', 6); t('WOCHENTAG(E1;9)', NUM);
t('KALENDERWOCHE(E1)', 1); t('KALENDERWOCHE(DATUM(2026;1;4))', 2); t('KALENDERWOCHE(DATUM(2026;1;4);2)', 1); t('WEEKNUM(DATE(2026,12,31),21)', 53);
t('ISOKALENDERWOCHE(E1)', 1); t('ISOKALENDERWOCHE(DATUM(2027;1;1))', 53); t('ISOWEEKNUM(DATE(2026,6,15))', 25);
t('EDATUM(E3;1)', S(30, 4, 2026)); t('EDATE(E4,12)', S(28, 2, 2025)); t('EDATUM(E1;-1)', S(1, 12, 2025));
t('MONATSENDE(E2;0)', S(28, 2, 2026)); t('EOMONTH(E4,0)', S(29, 2, 2024)); t('MONATSENDE(E1;-2)', S(30, 11, 2025));
t('NETTOARBEITSTAGE(DATUM(2026;3;2);DATUM(2026;3;13))', 10); t('NETWORKDAYS(DATE(2026,3,13),DATE(2026,3,2))', -10); t('NETTOARBEITSTAGE(DATUM(2026;12;21);DATUM(2026;12;31);{46381.46382})', 8);
t('NETTOARBEITSTAGE.INTL(DATUM(2026;3;2);DATUM(2026;3;8);11)', 6); t('NETWORKDAYS.INTL(DATE(2026,3,2),DATE(2026,3,8),"0000011")', 5);
t('ARBEITSTAG(DATUM(2026;3;6);1)', S(9, 3, 2026)); t('WORKDAY(DATE(2026,3,9),-1)', S(6, 3, 2026)); t('ARBEITSTAG.INTL(DATUM(2026;3;6);1;11)', S(7, 3, 2026));
t('DATEDIF(DATUM(2000;5;15);DATUM(2026;3;10);"Y")', 25); t('DATEDIF(DATUM(2026;1;31);DATUM(2026;3;1);"M")', 1); t('DATEDIF(E1;E3;"D")', 89);
t('DATEDIF(DATUM(2026;1;15);DATUM(2026;3;10);"MD")', 23); t('DATEDIF(DATUM(2020;5;15);DATUM(2026;3;10);"YM")', 9); t('DATEDIF(DATUM(2020;5;15);DATUM(2026;3;10);"YD")', 299); t('DATEDIF(E3;E1;"D")', NUM);
t('TAGE(E3;E1)', 89); t('DAYS("10.03.2026","01.03.2026")', 9); t('TAGE360(DATUM(2026;1;31);DATUM(2026;3;31))', 60);
t('DATWERT("24.12.2026")', S(24, 12, 2026)); t('DATEVALUE("2026-02-01")', S(1, 2, 2026)); t('DATWERT("5. März 2026")', S(5, 3, 2026)); t('DATWERT("abc")', VAL);
t('ZEITWERT("18:00")', 0.75); t('TIMEVALUE("24.12.2026 06:00")', 0.25); t('ZEITWERT("x")', VAL);
t('BRTEILJAHRE(DATUM(2026;1;1);DATUM(2026;7;1);0)', 0.5); t('YEARFRAC(DATE(2026,1,1),DATE(2026,12,31),3)', 364 / 365); t('BRTEILJAHRE(DATUM(2026;1;1);DATUM(2026;7;1);2)', 181 / 360); t('BRTEILJAHRE(1;2;7)', NUM);
{ const d = calc('HEUTE()').v; const now = new Date(); ok('HEUTE = today', d === (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86400000, d); }
{ const d = calc('JETZT()').v; ok('JETZT has time fraction', d > 40000 && d < 80000, d); }

// ---------------------------------------------------------------- information
t('ISTLEER(D4)', true); t('ISBLANK(A1)', false); t('ISTZAHL(A1)', true); t('ISNUMBER("1")', false); t('ISTTEXT(B1)', true); t('ISTKTEXT(A1)', true);
t('ISTFEHLER(1/0)', true); t('ISERROR(1)', false); t('ISTFEHL(NV())', false); t('ISERR(1/0)', true); t('ISTNV(NV())', true); t('ISNA(1/0)', false);
t('ISTLOG(D1)', true); t('ISTGERADE(4)', true); t('ISODD(4)', false); t('ISTUNGERADE(-3)', true); t('ISTFORMEL(A1)', false); t('ISTBEZUG(A1)', true); t('ISREF(1)', false);
t('NV()', NA); t('FEHLER.TYP(1/0)', 2); t('ERROR.TYPE(NA())', 7); t('FEHLER.TYP(1)', NA);
t('TYP(1)', 1); t('TYPE("a")', 2); t('TYP(WAHR)', 4); t('TYP(1/0)', 16); t('TYP({1.2;3.4})', 64);

// ---------------------------------------------------------------- financial
t('RMZ(5%/12;60;-20000)', { approx: 377.4246, tol: 1e-3 }); t('PMT(0,10,1000)', -100); t('RMZ(5%;10;1000;0;1)', { approx: -123.338, tol: 1e-3 });
t('ZW(3%/12;120;-100)', { approx: 13974.14, tol: 0.01 }); t('FV(0,10,-100)', 1000); t('ZW(5%;10;-100;-1000;1)', { approx: 2949.57, tol: 0.01 });
t('BW(5%/12;60;-400)', { approx: 21196.28, tol: 0.01 }); t('PV(0,10,-100)', 1000);
t('ZINS(60;-400;20000)', { approx: 0.0061834, tol: 1e-6 }); t('RATE(10,-100,1000)', { approx: 0, tol: 1e-9 });
t('ZZR(5%/12;-400;20000)', { approx: 56.18, tol: 0.01 }); t('NPER(0,-100,1000)', 10); t('ZZR(5%;100;1000)', { approx: -8.3104, tol: 1e-3 }); t('ZZR(5%;-10;1000)', NUM);
t('NBW(8%;J2:J4)', { approx: 3000 / 1.08 + 4200 / 1.08 ** 2 + 6800 / 1.08 ** 3, tol: 1e-6 }); t('NPV(-1,1,2)', DIV);
t('IKV(J1:J4)', { approx: 0.1634, tol: 1e-3 }); t('IRR({1,2,3})', NUM);
t('ZINSZ(5%/12;1;60;20000)', { approx: -83.333, tol: 1e-3 }); t('KAPZ(5%/12;1;60;20000)', { approx: -294.09, tol: 0.01 }); t('IPMT(0.1,0,5,100)', NUM);
t('KUMZINSZ(5%/12;60;20000;1;12;0)', { approx: -917.99, tol: 0.01 }); t('CUMPRINC(0.05/12,60,20000,1,12,0)', { approx: -3611.11, tol: 0.01 });
t('EFFEKTIV(5%;12)', { approx: 0.05116, tol: 1e-5 }); t('NOMINAL(EFFEKTIV(5%;12);12)', 0.05); t('EFFECT(-1,2)', NUM);
t('LIA(10000;1000;5)', 1800); t('SLN(1,0,0)', DIV);
t('XKAPITALWERT(9%;L1:L4;K1:K4)', { approx: -380.39, tol: 0.01 }); t('XINTZINSFUSS(L1:L4;K1:K4)', { approx: 0.03392, tol: 1e-4 });

// ---------------------------------------------------------------- syntax, canonical form, display
ok('toCanonical de', F.toCanonical('SUMME(A1:A3;2,5)') === 'SUM(A1:A3,2.5)', F.toCanonical('SUMME(A1:A3;2,5)'));
ok('toCanonical en', F.toCanonical('IF(A1>0,"ja","nein")') === 'IF(A1>0,"ja","nein")');
ok('toDisplay de', F.toDisplay('XLOOKUP(A1,B:B,C:C,"x")') === 'XVERWEIS(A1;B:B;C:C;"x")', F.toDisplay('XLOOKUP(A1,B:B,C:C,"x")'));
ok('toDisplay umlaut name', F.toDisplay('COUNTIF(A1:A3,"x")') === 'ZÄHLENWENN(A1:A3;"x")');
ok('toDisplay numbers', F.toDisplay('ROUND(2.5,0)') === 'RUNDEN(2,5;0)');
ok('toDisplay errors', F.toDisplay('IFERROR(#N/A,#VALUE!)') === 'WENNFEHLER(#NV;#WERT!)');
ok('toXlsx _xlfn', F.toXlsx('XLOOKUP(A1,B1:B3,C1:C3)') === '_xlfn.XLOOKUP(A1,B1:B3,C1:C3)' && F.toXlsx('FILTER(A1:A3,B1:B3)') === '_xlfn._xlws.FILTER(A1:A3,B1:B3)');
ok('canonicalFn strips _xlfn', F.canonicalFn('_xlfn._xlws.SORT') === 'SORT' && F.canonicalFn('KGRÖSSTE') === 'LARGE' && F.canonicalFn('zählenwenn') === 'COUNTIF');
ok('syntax error: open paren', (() => { try { F.toCanonical('SUMME(A1'); return false; } catch (e) { return e instanceof SyntaxError; } })());
ok('syntax error: quote', (() => { try { F.toCanonical('"abc'); return false; } catch (e) { return e instanceof SyntaxError; } })());
ok('absolute refs kept', F.toCanonical('$A$1+A$2+$B3') === '$A$1+A$2+$B3');
ok('sheet with space quoted', F.toDisplay("'Mein Blatt'!A1") === "'Mein Blatt'!A1");
ok('shiftRefs relative/absolute', F.shiftRefs('A1+$A$1+A$1+$A1', r => ({ ...r, r: r.absR ? r.r : r.r + 1, c: r.absC ? r.c : r.c + 1 })) === 'B2+$A$1+B$1+$A2');
ok('shiftRefs → #REF!', F.shiftRefs('SUM(A1:A3)+B5', r => (r.r === 4 ? null : r)) === 'SUM(A1:A3)+#REF!');
ok('renameSheetRefs', F.renameSheetRefs("Preise!A1+'Preise'!B2+A1", 'Preise', 'Neue Preise') === "'Neue Preise'!A1+'Neue Preise'!B2+A1");
ok('row range token', F.toDisplay('SUM(2:3)') === 'SUMME(2:3)');
ok('spill ref token', F.toDisplay('SUM(A1#)') === 'SUMME(A1#)');
ok('isValidName', F.isValidName('Steuersatz') && !F.isValidName('A1') && !F.isValidName('1abc') && F.isValidName('_Netto.2026'));
ok('ERR_DE complete', F.ERR_DE['#N/A'] === '#NV' && F.ERR_DE['#SPILL!'] === '#ÜBERLAUF!' && F.ERR_DE['#VALUE!'] === '#WERT!' && F.ERR_DE['#REF!'] === '#BEZUG!');
ok('errFromCode de', F.errFromCode('#NV').code === '#N/A' && F.errFromCode('#WERT!').code === '#VALUE!');
ok('KNOWN_FUNCTIONS ≥ 190', F.KNOWN_FUNCTIONS.size >= 190, F.KNOWN_FUNCTIONS.size);
ok('FUNCTION_LIST has categories', F.FUNCTION_LIST.every(x => F.FN_CATEGORIES.includes(x[1])));
ok('FUNCTION_LIST examples parse', F.FUNCTION_LIST.every(x => { try { F.toCanonical(x[3]); return true; } catch { return false; } }), F.FUNCTION_LIST.filter(x => { try { F.toCanonical(x[3]); return false; } catch { return true; } }).map(x => x[0]).join());

// ---------------------------------------------------------------- workbook: spill, legacy, incremental recalc, circular
{
  const w = W.newWorkbook(); const s = w.sheets[0];
  put(s, 'A1', '3'); put(s, 'A2', '1'); put(s, 'A3', '2');
  put(s, 'C1', '=SORTIEREN(A1:A3)');
  W.recalc(w);
  ok('spill values', W.valueAt(s, 0, 2) === 1 && W.valueAt(s, 1, 2) === 2 && W.valueAt(s, 2, 2) === 3, [W.valueAt(s, 0, 2), W.valueAt(s, 1, 2), W.valueAt(s, 2, 2)]);
  put(s, 'D1', '=SUMME(C1#)'); put(s, 'D2', '=C3*10');
  W.recalc(w);
  ok('spill ref C1#', W.getCell(s, 0, 3).cv === 6, show(W.getCell(s, 0, 3).cv));
  ok('reading spilled cell', W.getCell(s, 1, 3).cv === 30);
  put(s, 'C2', 'blocker'); W.recalc(w);
  ok('#SPILL! when blocked', isE(W.getCell(s, 0, 2).cv, '#SPILL!') && W.formatValue(W.getCell(s, 0, 2).cv) === '#ÜBERLAUF!', show(W.getCell(s, 0, 2).cv));
  W.setCell(s, 1, 2, null); W.recalc(w);
  ok('spill restored after unblock', W.valueAt(s, 1, 2) === 2);
  // incremental
  put(s, 'A2', '10');
  W.recalcCells(w, [{ si: 0, r: 1, c: 0 }]);
  ok('incremental recalc updates spill + dependents', W.valueAt(s, 2, 2) === 10 && W.getCell(s, 0, 3).cv === 15 && W.getCell(s, 1, 3).cv === 100, [W.valueAt(s, 2, 2), show(W.getCell(s, 0, 3).cv), show(W.getCell(s, 1, 3).cv)]);
  // legacy implicit intersection
  W.setCell(s, 4, 1, { f: 'A1:A3*2', da: false });
  W.setCell(s, 1, 4, { f: 'A1:A3*2', da: false });
  W.recalc(w);
  ok('legacy formula: no spill (implicit intersection)', W.getCell(s, 4, 1).cv === 6 && !W.getCell(s, 4, 1).spill, show(W.getCell(s, 4, 1).cv));
  ok('legacy implicit intersection same row', W.getCell(s, 1, 4).cv === 20, show(W.getCell(s, 1, 4).cv));
  // circular
  put(s, 'F1', '=F2+1'); put(s, 'F2', '=F1+1');
  W.recalc(w);
  ok('circular reference detected', isE(W.getCell(s, 0, 5).cv, '#CIRC!') && w._circ.length > 0);
  put(s, 'G1', '=G1');
  W.recalcCells(w, [{ si: 0, r: 0, c: 6 }]);
  ok('self reference circular (incremental)', isE(W.getCell(s, 0, 6).cv, '#CIRC!'));
  // chain dependency incremental
  const w2 = W.newWorkbook(); const s2 = w2.sheets[0];
  put(s2, 'A1', '1');
  for (let i = 2; i <= 200; i++) put(s2, 'A' + i, `=A${i - 1}+1`);
  put(s2, 'B1', '=SUMME(A1:A200)');
  W.recalc(w2);
  ok('chain full recalc', W.getCell(s2, 199, 0).cv === 200 && W.getCell(s2, 0, 1).cv === 20100);
  put(s2, 'A1', '101');
  const n = W.recalcCells(w2, [{ si: 0, r: 0, c: 0 }]);
  ok('chain incremental recalc', W.getCell(s2, 199, 0).cv === 300 && W.getCell(s2, 0, 1).cv === 40100, `${W.getCell(s2, 199, 0).cv} ${W.getCell(s2, 0, 1).cv}`);
  ok('incremental touches only dependents', n === 200, n);
  put(s2, 'C5', '7');
  ok('unrelated change recalcs nothing', W.recalcCells(w2, [{ si: 0, r: 4, c: 2 }]) === 0);
  // cross sheet incremental
  const w3 = W.newWorkbook(); w3.sheets.push(W.newSheet('Zwei'));
  put(w3.sheets[1], 'A1', '5'); put(w3.sheets[0], 'A1', '=Zwei!A1*2');
  W.recalc(w3);
  put(w3.sheets[1], 'A1', '6');
  W.recalcCells(w3, [{ si: 1, r: 0, c: 0 }]);
  ok('cross-sheet incremental', W.getCell(w3.sheets[0], 0, 0).cv === 12);
  // named range incremental (names are treated as volatile)
  w3.names = [{ name: 'Basis', ref: 'Zwei!$A$1', si: null }];
  put(w3.sheets[0], 'B1', '=Basis+1'); W.recalc(w3);
  put(w3.sheets[1], 'A1', '9'); W.recalcCells(w3, [{ si: 1, r: 0, c: 0 }]);
  ok('named range incremental', W.getCell(w3.sheets[0], 0, 1).cv === 10);
  // insert row shifts names + formulas
  W.insertRows(w3, 1, 0, 1); W.recalc(w3);
  ok('insert row shifts names and formulas', w3.names[0].ref === 'Zwei!$A$2' && W.getCell(w3.sheets[0], 0, 0).f === 'Zwei!A2*2' && W.getCell(w3.sheets[0], 0, 1).cv === 10, `${w3.names[0].ref} ${W.getCell(w3.sheets[0], 0, 0).f}`);
  // sort keeps own-row references
  const w4 = W.newWorkbook(); const s4 = w4.sheets[0];
  [['A1', 'b'], ['B1', '2'], ['C1', '=B1*10'], ['A2', 'a'], ['B2', '1'], ['C2', '=B2*10'], ['A3', 'c'], ['B3', '3'], ['C3', '=B3*10']].forEach(([a, x]) => put(s4, a, x));
  W.recalc(w4);
  W.sortRowsMulti(w4, 0, 0, 2, 0, 2, [{ c: 0, asc: true }]); W.recalc(w4);
  ok('multi-sort moves rows, adjusts own-row refs', W.getCell(s4, 0, 0).v === 'a' && W.getCell(s4, 0, 2).f === 'B1*10' && W.getCell(s4, 0, 2).cv === 10 && W.getCell(s4, 2, 2).cv === 30);
  W.sortRowsMulti(w4, 0, 0, 2, 0, 2, [{ c: 1, asc: false }]); W.recalc(w4);
  ok('sort descending', W.getCell(s4, 0, 1).v === 3 && W.getCell(s4, 2, 1).v === 1);
}

// ---------------------------------------------------------------- input parsing & number formats
const pi = (x, f) => W.parseInput(x, f);
ok('parseInput number de', pi('1.234,5').v === 1234.5);
ok('parseInput percent', pi('12 %').v === 0.12 && pi('12 %').fmt === '0%');
ok('parseInput currency', pi('9,99 €').v === 9.99 && /€/.test(pi('9,99 €').fmt));
ok('parseInput date', pi('24.12.2026').v === S(24, 12, 2026) && pi('24.12.2026').fmt === 'dd.mm.yyyy');
ok('parseInput time', Math.abs(pi('14:30').v - 14.5 / 24) < 1e-12 && pi('14:30').fmt === 'hh:mm');
ok('parseInput datetime', pi('01.02.2026 08:15').fmt === 'dd.mm.yyyy hh:mm');
ok('parseInput bool', pi('wahr').v === true && pi('FALSE').v === false);
ok('parseInput apostrophe text', pi("'0123").v === '0123');
ok('parseInput text format keeps text', pi('0123', '@').v === '0123');
ok('parseInput formula → canonical + dynamic', pi('=SUMME(A1;2)').f === 'SUM(A1,2)' && pi('=1').da === true);
const fv = (v, c) => W.formatValue(v, c);
ok('fmt currency', fv(1200, '#,##0.00 "€"') === '1.200,00 €');
ok('fmt percent', fv(0.256, '0.0%') === '25,6 %');
ok('fmt date', fv(S(15, 3, 2026), 'dd.mm.yyyy') === '15.03.2026');
ok('fmt long date', fv(S(15, 3, 2026), 'dddd, d. mmmm yyyy') === 'Sonntag, 15. März 2026', fv(S(15, 3, 2026), 'dddd, d. mmmm yyyy'));
ok('fmt time', fv(0.5625, 'hh:mm') === '13:30');
ok('fmt elapsed hours', fv(1.25, '[h]:mm') === '30:00');
ok('fmt negative red', W.formatCell(-5, '#,##0.00;[Red]-#,##0.00').color === '#FF0000' && fv(-5, '#,##0.00;[Red]-#,##0.00') === '-5,00');
ok('fmt zero section', fv(0, '0;-0;"–"') === '–');
ok('fmt text section', fv('abc', '0;0;0;"» "@') === '» abc');
ok('fmt scientific', fv(12345, '0.00E+00') === '1,23E+04');
ok('fmt fraction', fv(1.5, '# ?/?') === '1 1/2');
ok('fmt zip', fv(1234, '00000') === '01234');
ok('fmt thousands scale', fv(1234567, '#,##0,') === '1.235');
ok('fmt general long', fv(1 / 3, 'General') === '0,333333333');
ok('fmt conditional', fv(150, '[>100]"hoch";"niedrig"') === 'hoch' && fv(50, '[>100]"hoch";"niedrig"') === 'niedrig');
ok('fmt error german', fv(F.ERR.NA, null) === '#NV' && fv(F.ERR.DIV0) === '#DIV/0!');
ok('fmt boolean', fv(true, '0.00') === 'WAHR');
ok('fromGermanCode', NF.fromGermanCode('#.##0,00 €') === '#,##0.00 €' && NF.fromGermanCode('TT.MM.JJJJ') === 'dd.mm.yyyy' && NF.fromGermanCode('0,00') === '0.00' && NF.fromGermanCode('#,##0') === '#,##0');
ok('toGermanCode', NF.toGermanCode('#,##0.00 "€"') === '#.##0,00 "€"' && NF.toGermanCode('dd.mm.yyyy hh:mm') === 'TT.MM.JJJJ hh:mm');
ok('formatKind', W.formatKind('dd.mm.yyyy') === 'date' && W.formatKind('hh:mm') === 'time' && W.formatKind('#,##0.00 "€"') === 'currency' && W.formatKind('0%') === 'percent' && W.formatKind('@') === 'text');
ok('editText date', W.editTextOf({ v: S(1, 2, 2026), s: { fmt: 'dd.mm.yyyy' } }, F.toDisplay) === '01.02.2026');
ok('editText formula de', W.editTextOf({ f: 'SUM(A1,2.5)' }, F.toDisplay) === '=SUMME(A1;2,5)');

console.log(fails.map(f => 'FAIL ' + f).join('\n'));
// LET + xlsx parameter prefix
t('LET(x,3,y,x+1,x*y)', 12);
t('LET(a,Daten!A1:A3,SUM(a)*2)', 120);
ok('LET xlsx _xlpm', F.toXlsx('LET(x,3,x*x)') === '_xlfn.LET(_xlpm.x,3,_xlpm.x*_xlpm.x)', F.toXlsx('LET(x,3,x*x)'));
ok('LET German', F.toCanonical('LET(x;2;x*3)') === 'LET(x,2,x*3)' || /LET\(x,2,x\*3\)/.test(F.toCanonical('LET(x;2;x*3)')), F.toCanonical('LET(x;2;x*3)'));
console.log(`\nformula tests: ${pass} passed, ${fail} failed (${pass + fail} assertions)`);
process.exit(fail ? 1 : 0);
