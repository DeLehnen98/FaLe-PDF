// GENERATED – synced copy of js/office/sheet-templates.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Spreadsheet templates (own designs, German): pure data + a builder that turns a definition into a workbook.
// The definitions contain no code, so other pages (e.g. the web site) can list or build them as well.
//
// Definition format
//   { id, title, desc, cat, keywords, accent, sheets: [sheet], names: [{name, ref}] }
//   sheet: { name, cols: [px…], freeze, freezeC, rows: [row…], merges: ['A1:F1'], cf: [rule], dv: [rule], notes: {A1: text},
//            charts: [{type, range, title, at: 'H3', w, h, legend}], autoFilter: 'A4:H40', page: {…}, tabColor, rowH: {row: px}, start: 'B4' }
//   row:   [cell…] | { cells: [cell…], h: px } | { repeat: n, cells: [cell…] }  ({r} = 1-based row number, {r-1}, {r+1} …)
//   cell:  null | number | boolean | 'Text' | '=FORMEL' (German syntax) |
//          { v, f: '=…', s: 'style' | ['style', …] | {…}, fmt: 'eur' | code, date: 'today|month|nextmonth|week|year|YYYY-MM-DD', add: days, months, link: url }
import { newWorkbook, newSheet, setCell, KEY, ROW_H, DEFAULT_COL_W } from './workbook.js';
import { toCanonical, toDisplay, parseAddr, parseRangeAddr, dateToSerial, colName } from './formula.js';

export const FMT = {
  eur: '#,##0.00 "€"', eurRed: '#,##0.00 "€";[Red]-#,##0.00 "€"', eur0: '#,##0 "€"', pct: '0.0%', pct0: '0%', pct2: '0.00%',
  date: 'dd.mm.yyyy', dm: 'dd.mm.', wd: 'ddd', wday: 'dddd', time: 'hh:mm', hours: '0.00', hoursSigned: '+0.00;-0.00;0.00', int: '0', dec1: '0.0', dec2: '0.00',
  num: '#,##0', km: '#,##0 "km"', zip: '00000', text: '@', month: 'mmmm yyyy', qm: '#,##0.00 "m²"', kg: '#,##0.0 "kg"',
};

const ACCENTS = {
  indigo: { head: '#E9E8FB', headText: '#1F1B5E', title: '#26227A', band: '#F6F6FD' },
  teal: { head: '#D9F2EE', headText: '#0B4F47', title: '#0B6B60', band: '#F2FAF8' },
  amber: { head: '#FCEFD2', headText: '#5A3D00', title: '#8A5A00', band: '#FFF9EC' },
  rose: { head: '#FBE3E8', headText: '#6B1630', title: '#9C2246', band: '#FFF5F7' },
  blue: { head: '#DCEAFB', headText: '#123B6D', title: '#1D4F91', band: '#F3F8FE' },
  green: { head: '#DFF3E4', headText: '#174D2A', title: '#1E6B3A', band: '#F3FAF5' },
  slate: { head: '#E6E8EF', headText: '#262A3B', title: '#33384F', band: '#F6F7FA' },
};
function styles(accent) {
  const a = ACCENTS[accent] || ACCENTS.indigo;
  return {
    title: { b: true, size: 16, color: a.title },
    sub: { i: true, color: '#6B7194' },
    head: { b: true, fill: a.head, color: a.headText, bd: { b: 'thin', color: '#B9BCD0' }, valign: 'center' },
    headR: { b: true, fill: a.head, color: a.headText, bd: { b: 'thin', color: '#B9BCD0' }, align: 'right', valign: 'center' },
    headC: { b: true, fill: a.head, color: a.headText, bd: { b: 'thin', color: '#B9BCD0' }, align: 'center', valign: 'center' },
    total: { b: true, bd: { t: true, b: 'double' } },
    label: { b: true },
    input: { fill: '#FFF8DC', bd: { b: 'thin', t: 'thin', l: 'thin', r: 'thin', color: '#E3D49A' }, unlocked: true },
    muted: { color: '#6B7194' },
    small: { size: 9, color: '#6B7194' },
    center: { align: 'center' },
    right: { align: 'right' },
    wrap: { wrap: true, valign: 'top' },
    big: { b: true, size: 14, color: a.title },
    band: { fill: a.band },
  };
}

// ---------------------------------------------------------------- definitions
export const SHEET_TEMPLATE_DEFS = [
  // 1 ------------------------------------------------------------- Haushaltsbuch
  {
    id: 'haushaltsbuch', title: 'Haushaltsbuch', desc: 'Buchungen erfassen, Übersicht nach Kategorien mit Plan/Ist-Vergleich', cat: 'Finanzen', accent: 'indigo',
    keywords: 'budget ausgaben einnahmen geld monat haushalt',
    sheets: [
      {
        name: 'Übersicht', cols: [170, 120, 120, 120, 100], start: 'B4',
        rows: [
          [{ v: 'Haushaltsbuch', s: 'title' }],
          [{ v: 'Buchungen im Blatt „Buchungen“ erfassen – die Übersicht rechnet automatisch. Gelbe Felder sind Eingaben.', s: 'sub' }],
          [{ v: 'Kategorie', s: 'head' }, { v: 'Geplant', s: 'headR' }, { v: 'Tatsächlich', s: 'headR' }, { v: 'Differenz', s: 'headR' }, { v: 'Anteil Ausgaben', s: 'headR' }],
          ['Gehalt', { v: 2800, s: 'input', fmt: 'eur' }, { f: '=SUMMEWENN(Buchungen!$C$4:$C$500;A4;Buchungen!$D$4:$D$500)', fmt: 'eur' }, { f: '=C4-B4', fmt: 'eur' }, { f: '=WENN(C4<0;C4/SUMMEWENN($C$4:$C$9;"<0");"")', fmt: 'pct' }],
          ['Miete', { v: -950, s: 'input', fmt: 'eur' }, { f: '=SUMMEWENN(Buchungen!$C$4:$C$500;A5;Buchungen!$D$4:$D$500)', fmt: 'eur' }, { f: '=C5-B5', fmt: 'eur' }, { f: '=WENN(C5<0;C5/SUMMEWENN($C$4:$C$9;"<0");"")', fmt: 'pct' }],
          ['Lebensmittel', { v: -400, s: 'input', fmt: 'eur' }, { f: '=SUMMEWENN(Buchungen!$C$4:$C$500;A6;Buchungen!$D$4:$D$500)', fmt: 'eur' }, { f: '=C6-B6', fmt: 'eur' }, { f: '=WENN(C6<0;C6/SUMMEWENN($C$4:$C$9;"<0");"")', fmt: 'pct' }],
          ['Mobilität', { v: -150, s: 'input', fmt: 'eur' }, { f: '=SUMMEWENN(Buchungen!$C$4:$C$500;A7;Buchungen!$D$4:$D$500)', fmt: 'eur' }, { f: '=C7-B7', fmt: 'eur' }, { f: '=WENN(C7<0;C7/SUMMEWENN($C$4:$C$9;"<0");"")', fmt: 'pct' }],
          ['Freizeit', { v: -200, s: 'input', fmt: 'eur' }, { f: '=SUMMEWENN(Buchungen!$C$4:$C$500;A8;Buchungen!$D$4:$D$500)', fmt: 'eur' }, { f: '=C8-B8', fmt: 'eur' }, { f: '=WENN(C8<0;C8/SUMMEWENN($C$4:$C$9;"<0");"")', fmt: 'pct' }],
          ['Sparen', { v: -300, s: 'input', fmt: 'eur' }, { f: '=SUMMEWENN(Buchungen!$C$4:$C$500;A9;Buchungen!$D$4:$D$500)', fmt: 'eur' }, { f: '=C9-B9', fmt: 'eur' }, { f: '=WENN(C9<0;C9/SUMMEWENN($C$4:$C$9;"<0");"")', fmt: 'pct' }],
          [{ v: 'Saldo', s: 'total' }, { f: '=SUMME(B4:B9)', s: 'total', fmt: 'eur' }, { f: '=SUMME(C4:C9)', s: 'total', fmt: 'eur' }, { f: '=C10-B10', s: 'total', fmt: 'eur' }, { v: null, s: 'total' }],
          [],
          [{ v: 'Einnahmen', s: 'label' }, null, { f: '=SUMMEWENN(C4:C9;">0")', fmt: 'eur' }],
          [{ v: 'Ausgaben', s: 'label' }, null, { f: '=SUMMEWENN(C4:C9;"<0")', fmt: 'eur' }],
          [{ v: 'Sparquote', s: 'label' }, null, { f: '=WENN(C12>0;-C9/C12;"")', fmt: 'pct' }],
        ],
        cf: [
          { range: 'D4:D9', type: 'lt', v1: '0', style: 'red' }, { range: 'D4:D9', type: 'gt', v1: '0', style: 'green' },
          { range: 'E4:E9', type: 'bar', bar: 'violet' },
        ],
        notes: { B3: 'Geplante Beträge: Einnahmen positiv, Ausgaben negativ.', E3: 'Anteil der Kategorie an allen Ausgaben des Monats.' },
        charts: [{ type: 'bar', range: 'A3:C9', title: 'Geplant und tatsächlich', at: 'G3', w: 440, h: 300, legend: 'b' }],
        page: { orient: 'portrait', fit: 'width', grid: false, head: false },
      },
      {
        name: 'Buchungen', cols: [100, 220, 140, 110, 220], freeze: 3, autoFilter: 'A3:E500', start: 'A12',
        rows: [
          [{ v: 'Buchungen', s: 'title' }],
          [{ v: 'Einnahmen positiv, Ausgaben negativ. Die Kategorie kommt aus der Übersicht (Dropdown).', s: 'sub' }],
          [{ v: 'Datum', s: 'head' }, { v: 'Beschreibung', s: 'head' }, { v: 'Kategorie', s: 'head' }, { v: 'Betrag', s: 'headR' }, { v: 'Notiz', s: 'head' }],
          [{ date: 'month', fmt: 'date' }, 'Gehalt', 'Gehalt', { v: 2800, fmt: 'eurRed' }, ''],
          [{ date: 'month', add: 1, fmt: 'date' }, 'Miete', 'Miete', { v: -950, fmt: 'eurRed' }, 'Dauerauftrag'],
          [{ date: 'month', add: 2, fmt: 'date' }, 'Supermarkt', 'Lebensmittel', { v: -86.4, fmt: 'eurRed' }, ''],
          [{ date: 'month', add: 4, fmt: 'date' }, 'Tankstelle', 'Mobilität', { v: -64.2, fmt: 'eurRed' }, ''],
          [{ date: 'month', add: 6, fmt: 'date' }, 'Kino mit Freunden', 'Freizeit', { v: -24, fmt: 'eurRed' }, ''],
          [{ date: 'month', add: 7, fmt: 'date' }, 'Wochenmarkt', 'Lebensmittel', { v: -31.8, fmt: 'eurRed' }, ''],
          [{ date: 'month', add: 9, fmt: 'date' }, 'Sparplan', 'Sparen', { v: -300, fmt: 'eurRed' }, 'monatlich'],
          [{ date: 'month', add: 10, fmt: 'date' }, 'Drogerie', 'Lebensmittel', { v: -18.7, fmt: 'eurRed' }, ''],
          { repeat: 60, cells: [{ v: null, fmt: 'date' }, null, null, { v: null, fmt: 'eurRed' }] },
        ],
        dv: [{ range: 'C4:C500', src: 'Übersicht!$A$4:$A$9', prompt: 'Kategorie aus der Übersicht wählen' }],
        page: { orient: 'portrait', fit: 'width', titleRows: { r1: 2, r2: 2 } },
      },
    ],
  },
  // 2 ------------------------------------------------------------- Monatsbudget
  {
    id: 'monatsbudget', title: 'Monatsbudget (50/30/20)', desc: 'Einkommen auf Bedürfnisse, Wünsche und Sparen verteilen – mit Ampel', cat: 'Finanzen', accent: 'teal',
    keywords: 'budget 50 30 20 regel sparen einkommen fixkosten',
    sheets: [{
      name: 'Monatsbudget', cols: [190, 110, 110, 110, 90, 140], start: 'B4',
      rows: [
        [{ v: 'Monatsbudget nach der 50/30/20-Regel', s: 'title' }],
        [{ v: 'Nettoeinkommen eintragen und jede Ausgabe einem Bereich zuordnen. Grün = im Rahmen, Rot = darüber.', s: 'sub' }],
        [],
        [{ v: 'Nettoeinkommen', s: 'label' }, { v: 2600, s: 'input', fmt: 'eur' }],
        [],
        [{ v: 'Bereich', s: 'head' }, { v: 'Ziel', s: 'headR' }, { v: 'Geplant', s: 'headR' }, { v: 'Abweichung', s: 'headR' }, { v: 'Ziel %', s: 'headR' }],
        ['Bedürfnisse', { f: '=$B$4*E7', fmt: 'eur' }, { f: '=SUMMEWENN($B$14:$B$40;A7;$C$14:$C$40)', fmt: 'eur' }, { f: '=C7-B7', fmt: 'eur' }, { v: 0.5, s: 'input', fmt: 'pct0' }],
        ['Wünsche', { f: '=$B$4*E8', fmt: 'eur' }, { f: '=SUMMEWENN($B$14:$B$40;A8;$C$14:$C$40)', fmt: 'eur' }, { f: '=C8-B8', fmt: 'eur' }, { v: 0.3, s: 'input', fmt: 'pct0' }],
        ['Sparen & Schulden', { f: '=$B$4*E9', fmt: 'eur' }, { f: '=SUMMEWENN($B$14:$B$40;A9;$C$14:$C$40)', fmt: 'eur' }, { f: '=C9-B9', fmt: 'eur' }, { v: 0.2, s: 'input', fmt: 'pct0' }],
        [{ v: 'Summe', s: 'total' }, { f: '=SUMME(B7:B9)', s: 'total', fmt: 'eur' }, { f: '=SUMME(C7:C9)', s: 'total', fmt: 'eur' }, { f: '=C10-B10', s: 'total', fmt: 'eur' }, { f: '=SUMME(E7:E9)', s: 'total', fmt: 'pct0' }],
        [{ v: 'Noch verfügbar', s: 'big' }, { f: '=B4-C10', s: 'big', fmt: 'eur' }],
        [],
        [{ v: 'Ausgabe', s: 'head' }, { v: 'Bereich', s: 'head' }, { v: 'Betrag/Monat', s: 'headR' }, { v: 'Fällig am', s: 'headR' }, { v: '', s: 'head' }, { v: 'Bemerkung', s: 'head' }],
        ['Miete (warm)', 'Bedürfnisse', { v: 820, fmt: 'eur' }, { v: 1, fmt: 'int' }],
        ['Strom', 'Bedürfnisse', { v: 62, fmt: 'eur' }, { v: 15, fmt: 'int' }],
        ['Lebensmittel', 'Bedürfnisse', { v: 340, fmt: 'eur' }],
        ['Versicherungen', 'Bedürfnisse', { v: 58, fmt: 'eur' }, { v: 1, fmt: 'int' }],
        ['Handy & Internet', 'Bedürfnisse', { v: 45, fmt: 'eur' }, { v: 5, fmt: 'int' }],
        ['Nahverkehrsticket', 'Bedürfnisse', { v: 58, fmt: 'eur' }, { v: 1, fmt: 'int' }],
        ['Streaming & Abos', 'Wünsche', { v: 25, fmt: 'eur' }],
        ['Restaurant & Ausgehen', 'Wünsche', { v: 120, fmt: 'eur' }],
        ['Hobby & Sport', 'Wünsche', { v: 45, fmt: 'eur' }],
        ['Kleidung', 'Wünsche', { v: 60, fmt: 'eur' }],
        ['Urlaubsrücklage', 'Sparen & Schulden', { v: 100, fmt: 'eur' }],
        ['ETF-Sparplan', 'Sparen & Schulden', { v: 250, fmt: 'eur' }, { v: 2, fmt: 'int' }],
        ['Notgroschen', 'Sparen & Schulden', { v: 100, fmt: 'eur' }],
        { repeat: 13, cells: [null, null, { v: null, fmt: 'eur' }] },
      ],
      dv: [{ range: 'B14:B40', list: ['Bedürfnisse', 'Wünsche', 'Sparen & Schulden'] }],
      cf: [
        { range: 'D7:D8', type: 'gt', v1: '0', style: 'red' }, { range: 'D7:D8', type: 'le', v1: '0', style: 'green' },
        { range: 'D9', type: 'lt', v1: '0', style: 'red' }, { range: 'D9', type: 'ge', v1: '0', style: 'green' },
        { range: 'B11', type: 'lt', v1: '0', style: 'red' }, { range: 'C14:C40', type: 'bar', bar: 'green' },
      ],
      notes: { D13: 'Tag im Monat, an dem der Betrag abgebucht wird.' },
      charts: [{ type: 'col', range: 'A6:C9', title: 'Ziel und Planung', at: 'H3', w: 420, h: 280, legend: 'b' }],
      page: { orient: 'portrait', fit: 'width', grid: false, head: false },
    }],
  },
  // 3 ------------------------------------------------------------- Urlaubsplaner
  {
    id: 'urlaubsplaner', title: 'Urlaubsplaner', desc: 'Urlaubstage je Person mit Resturlaub – Arbeitstage ohne Wochenenden und Feiertage', cat: 'Arbeit', accent: 'teal',
    keywords: 'urlaub feiertage team resturlaub abwesenheit arbeitstage',
    sheets: [
      {
        name: 'Urlaub', cols: [150, 110, 110, 110, 120, 220], freeze: 0, start: 'B13',
        rows: [
          [{ v: 'Urlaubsplaner', s: 'title' }],
          [{ v: 'Anträge unten eintragen. Arbeitstage zählen ohne Wochenenden und die Feiertage im Blatt „Feiertage“.', s: 'sub' }],
          [{ v: 'Jahr', s: 'label' }, { f: '=JAHR(HEUTE())', s: 'input', fmt: 'int' }],
          [],
          [{ v: 'Mitarbeiter/in', s: 'head' }, { v: 'Anspruch', s: 'headR' }, { v: 'Genommen', s: 'headR' }, { v: 'Resturlaub', s: 'headR' }, { v: 'Krankheitstage', s: 'headR' }],
          ['Anna', { v: 30, s: 'input' }, '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A6;$E$13:$E$80;"Urlaub")', '=B6-C6', '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A6;$E$13:$E$80;"Krank")'],
          ['Ben', { v: 28, s: 'input' }, '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A7;$E$13:$E$80;"Urlaub")', '=B7-C7', '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A7;$E$13:$E$80;"Krank")'],
          ['Carla', { v: 30, s: 'input' }, '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A8;$E$13:$E$80;"Urlaub")', '=B8-C8', '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A8;$E$13:$E$80;"Krank")'],
          ['Deniz', { v: 25, s: 'input' }, '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A9;$E$13:$E$80;"Urlaub")', '=B9-C9', '=SUMMEWENNS($D$13:$D$80;$A$13:$A$80;A9;$E$13:$E$80;"Krank")'],
          [{ v: 'Summe', s: 'total' }, { f: '=SUMME(B6:B9)', s: 'total' }, { f: '=SUMME(C6:C9)', s: 'total' }, { f: '=SUMME(D6:D9)', s: 'total' }, { f: '=SUMME(E6:E9)', s: 'total' }],
          [],
          [{ v: 'Mitarbeiter/in', s: 'head' }, { v: 'Von', s: 'headR' }, { v: 'Bis', s: 'headR' }, { v: 'Arbeitstage', s: 'headR' }, { v: 'Art', s: 'head' }, { v: 'Bemerkung', s: 'head' }],
          ['Anna', { f: '=DATUM($B$3;7;13)', fmt: 'date' }, { f: '=DATUM($B$3;7;31)', fmt: 'date' }, '=WENN(ODER(B13="";C13="");"";NETTOARBEITSTAGE(B13;C13;Feiertage!$B$5:$B$17))', 'Urlaub', 'Sommerurlaub'],
          ['Ben', { f: '=DATUM($B$3;12;22)', fmt: 'date' }, { f: '=DATUM($B$3;12;31)', fmt: 'date' }, '=WENN(ODER(B14="";C14="");"";NETTOARBEITSTAGE(B14;C14;Feiertage!$B$5:$B$17))', 'Urlaub', 'Weihnachten'],
          ['Carla', { f: '=Feiertage!B6-3', fmt: 'date' }, { f: '=Feiertage!B7+4', fmt: 'date' }, '=WENN(ODER(B15="";C15="");"";NETTOARBEITSTAGE(B15;C15;Feiertage!$B$5:$B$17))', 'Urlaub', 'Osterferien'],
          ['Deniz', { f: '=DATUM($B$3;3;3)', fmt: 'date' }, { f: '=DATUM($B$3;3;5)', fmt: 'date' }, '=WENN(ODER(B16="";C16="");"";NETTOARBEITSTAGE(B16;C16;Feiertage!$B$5:$B$17))', 'Krank', ''],
          { repeat: 64, cells: [null, { v: null, fmt: 'date' }, { v: null, fmt: 'date' }, '=WENN(ODER(B{r}="";C{r}="");"";NETTOARBEITSTAGE(B{r};C{r};Feiertage!$B$5:$B$17))'] },
        ],
        dv: [{ range: 'A13:A80', src: '$A$6:$A$9' }, { range: 'E13:E80', list: ['Urlaub', 'Sonderurlaub', 'Krank', 'Gleitzeit', 'Fortbildung'] }],
        cf: [
          { range: 'D6:D9', type: 'lt', v1: '0', style: 'red' }, { range: 'D6:D9', type: 'bar', bar: 'green' },
          { range: 'C13:C80', type: 'formula', f: '=UND(C13<>"";C13<B13)', style: 'red' },
          { range: 'A13:F80', type: 'formula', f: '=$E13="Krank"', style: 'gray' },
        ],
        notes: { B3: 'Das Jahr steuert die Feiertage. Für ein anderes Jahr einfach die Zahl überschreiben.', D12: 'Ohne Wochenenden und ohne die Feiertage im Blatt „Feiertage“.' },
        page: { orient: 'portrait', fit: 'width', titleRows: { r1: 11, r2: 11 } },
      },
      {
        name: 'Feiertage', cols: [230, 110, 120], start: 'A15',
        rows: [
          [{ v: 'Gesetzliche Feiertage', s: 'title' }],
          [{ v: 'Bundesweite Feiertage, aus dem Osterdatum berechnet. Regionale Feiertage in die freien Zeilen eintragen (z. B. Fronleichnam = Ostersonntag + 60).', s: 'sub' }],
          [{ v: 'Jahr', s: 'label' }, { f: '=Urlaub!B3', fmt: 'int' }],
          [{ v: 'Feiertag', s: 'head' }, { v: 'Datum', s: 'headR' }, { v: 'Wochentag', s: 'head' }],
          ['Neujahr', { f: '=DATUM($B$3;1;1)', fmt: 'date' }, { f: '=B5', fmt: 'wday' }],
          ['Karfreitag', { f: '=$B$20-2', fmt: 'date' }, { f: '=B6', fmt: 'wday' }],
          ['Ostermontag', { f: '=$B$20+1', fmt: 'date' }, { f: '=B7', fmt: 'wday' }],
          ['Tag der Arbeit', { f: '=DATUM($B$3;5;1)', fmt: 'date' }, { f: '=B8', fmt: 'wday' }],
          ['Christi Himmelfahrt', { f: '=$B$20+39', fmt: 'date' }, { f: '=B9', fmt: 'wday' }],
          ['Pfingstmontag', { f: '=$B$20+50', fmt: 'date' }, { f: '=B10', fmt: 'wday' }],
          ['Tag der Deutschen Einheit', { f: '=DATUM($B$3;10;3)', fmt: 'date' }, { f: '=B11', fmt: 'wday' }],
          ['1. Weihnachtstag', { f: '=DATUM($B$3;12;25)', fmt: 'date' }, { f: '=B12', fmt: 'wday' }],
          ['2. Weihnachtstag', { f: '=DATUM($B$3;12;26)', fmt: 'date' }, { f: '=B13', fmt: 'wday' }],
          { repeat: 4, cells: [null, { v: null, s: 'input', fmt: 'date' }, { f: '=WENN(B{r}="";"";B{r})', fmt: 'wday' }] },
          [],
          [],
          [{ v: 'Ostersonntag (Hilfswert)', s: 'muted' }, { f: '=RUNDEN(DATUM($B$3;4;1)/7+REST(19*REST($B$3;19)-7;30)*14%;0)*7-6', fmt: 'date' }],
        ],
        cf: [{ range: 'A5:C17', type: 'formula', f: '=UND($B5<>"";WOCHENTAG($B5;2)>5)', style: 'gray' }],
        notes: { B20: 'Osterformel nach Gauß (gültig für die Jahre 1900 bis 2199).' },
      },
    ],
  },
  // 4 ------------------------------------------------------------- Arbeitszeiterfassung
  {
    id: 'stundenzettel', title: 'Arbeitszeiterfassung', desc: 'Stundenzettel für einen Monat: Beginn, Ende, Pause, Soll/Ist und Überstunden', cat: 'Arbeit', accent: 'blue',
    keywords: 'stundenzettel arbeitszeit überstunden zeiterfassung monat pause',
    sheets: [{
      name: 'Arbeitszeit', cols: [96, 46, 74, 74, 108, 96, 70, 90, 230], freeze: 5, start: 'C6',
      rows: [
        [{ v: 'Arbeitszeiterfassung', s: 'title' }],
        [{ v: 'Monat wählen, dann Beginn, Ende und Pause eintragen. Stunden als Dezimalzahl (7,50 = 7 Std. 30 Min.).', s: 'sub' }],
        [{ v: 'Name', s: 'label' }, { v: '', s: 'input' }, null, { v: 'Monat', s: 'label' }, { date: 'month', s: 'input', fmt: 'month' }, null, { v: 'Soll/Tag', s: 'label' }, { v: 8, s: 'input', fmt: 'hours' }],
        [],
        [{ v: 'Datum', s: 'head' }, { v: 'Tag', s: 'head' }, { v: 'Beginn', s: 'headR' }, { v: 'Ende', s: 'headR' }, { v: 'Pause (Min.)', s: 'headR' }, { v: 'Ist (Std.)', s: 'headR' }, { v: 'Soll', s: 'headR' }, { v: 'Differenz', s: 'headR' }, { v: 'Tätigkeit / Notiz', s: 'head' }],
        [{ f: '=$E$3', fmt: 'date' }, { f: '=WENN(A6="";"";A6)', fmt: 'wd' }, { v: 0.333333333333, fmt: 'time' }, { v: 0.6875, fmt: 'time' }, 30, { f: '=WENN(ODER(C6="";D6="");"";REST(D6-C6;1)*24-E6/60)', fmt: 'hours' }, { f: '=WENN(A6="";"";WENN(WOCHENTAG(A6;2)>5;0;$H$3))', fmt: 'hours' }, { f: '=WENN(F6="";"";F6-G6)', fmt: 'hoursSigned' }, 'Projektarbeit'],
        { repeat: 30, cells: [{ f: '=WENN(A{r-1}="";"";WENN(MONAT(A{r-1}+1)=MONAT($E$3);A{r-1}+1;""))', fmt: 'date' }, { f: '=WENN(A{r}="";"";A{r})', fmt: 'wd' }, { v: null, fmt: 'time' }, { v: null, fmt: 'time' }, null, { f: '=WENN(ODER(C{r}="";D{r}="");"";REST(D{r}-C{r};1)*24-E{r}/60)', fmt: 'hours' }, { f: '=WENN(A{r}="";"";WENN(WOCHENTAG(A{r};2)>5;0;$H$3))', fmt: 'hours' }, { f: '=WENN(F{r}="";"";F{r}-G{r})', fmt: 'hoursSigned' }] },
        [],
        [{ v: 'Summe', s: 'total' }, { v: null, s: 'total' }, { v: null, s: 'total' }, { v: null, s: 'total' }, { f: '=SUMME(E6:E36)', s: 'total' }, { f: '=SUMME(F6:F36)', s: 'total', fmt: 'hours' }, { f: '=SUMME(G6:G36)', s: 'total', fmt: 'hours' }, { f: '=F38-G38', s: 'total', fmt: 'hoursSigned' }],
        [{ v: 'Arbeitstage', s: 'label' }, null, null, null, null, { f: '=ANZAHL(F6:F36)', fmt: 'int' }, { f: '=ZÄHLENWENN(G6:G36;">0")', fmt: 'int' }],
      ],
      cf: [
        { range: 'A6:I36', type: 'formula', f: '=UND($A6<>"";WOCHENTAG($A6;2)>5)', style: 'gray' },
        { range: 'H6:H36', type: 'lt', v1: '0', style: 'red' }, { range: 'H6:H36', type: 'gt', v1: '0', style: 'green' },
        { range: 'H38', type: 'lt', v1: '0', style: 'red' }, { range: 'H38', type: 'gt', v1: '0', style: 'green' },
      ],
      dv: [{ range: 'E6:E36', type: 'whole', op: 'between', v1: '0', v2: '600', error: 'Pause in Minuten (0 bis 600).' }],
      notes: { E3: 'Ersten Tag des Monats eintragen, z. B. 01.03.2026. Die Daten darunter passen sich an.', H3: 'Sollstunden pro Arbeitstag (Mo–Fr). Feiertage bei Bedarf in der Spalte Soll mit 0 überschreiben.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 5 ------------------------------------------------------------- Fahrtenbuch
  {
    id: 'fahrtenbuch', title: 'Fahrtenbuch', desc: 'Fahrten mit Kilometerstand und Zweck – Anteil dienstlich und Erstattung', cat: 'Arbeit', accent: 'slate',
    keywords: 'auto kilometer dienstwagen pauschale fahrten steuer',
    sheets: [{
      name: 'Fahrtenbuch', cols: [96, 96, 96, 92, 110, 200, 180, 110, 24, 190, 110], freeze: 5, autoFilter: 'A5:H205', start: 'A10',
      rows: [
        [{ v: 'Fahrtenbuch', s: 'title' }],
        [{ v: 'Jede Fahrt mit Datum, Kilometerstand und Zweck eintragen. Der Start-km wird aus der Vorzeile übernommen.', s: 'sub' }],
        [{ v: 'Kennzeichen', s: 'label' }, { v: 'SB-AB 123', s: 'input' }, null, { v: 'Fahrzeug', s: 'label' }, { v: 'Kombi', s: 'input' }, null, { v: 'Pauschale je km', s: 'label' }, { v: 0.3, s: 'input', fmt: 'eur' }],
        [],
        [{ v: 'Datum', s: 'head' }, { v: 'Start-km', s: 'headR' }, { v: 'Ende-km', s: 'headR' }, { v: 'Gefahren', s: 'headR' }, { v: 'Zweck', s: 'head' }, { v: 'Ziel / Route', s: 'head' }, { v: 'Anlass / Kunde', s: 'head' }, { v: 'Fahrer/in', s: 'head' }, null, { v: 'Auswertung', s: 'head' }, { v: 'km', s: 'headR' }],
        [{ date: 'today', add: -6, fmt: 'date' }, { v: 45210, fmt: 'num' }, { v: 45268, fmt: 'num' }, { f: '=WENN(ODER(B6="";C6="");"";C6-B6)', fmt: 'km' }, 'Dienstlich', 'Saarbrücken – Homburg', 'Kundentermin', 'F. L.', null, 'Dienstlich', { f: '=SUMMEWENN($E$6:$E$205;J6;$D$6:$D$205)', fmt: 'km' }],
        [{ date: 'today', add: -5, fmt: 'date' }, { f: '=WENN(C6="";"";C6)', fmt: 'num' }, { v: 45292, fmt: 'num' }, { f: '=WENN(ODER(B7="";C7="");"";C7-B7)', fmt: 'km' }, 'Arbeitsweg', 'Wohnung – Büro', '', 'F. L.', null, 'Privat', { f: '=SUMMEWENN($E$6:$E$205;J7;$D$6:$D$205)', fmt: 'km' }],
        [{ date: 'today', add: -3, fmt: 'date' }, { f: '=WENN(C7="";"";C7)', fmt: 'num' }, { v: 45341, fmt: 'num' }, { f: '=WENN(ODER(B8="";C8="");"";C8-B8)', fmt: 'km' }, 'Privat', 'Einkauf', '', 'F. L.', null, 'Arbeitsweg', { f: '=SUMMEWENN($E$6:$E$205;J8;$D$6:$D$205)', fmt: 'km' }],
        [{ date: 'today', add: -1, fmt: 'date' }, { f: '=WENN(C8="";"";C8)', fmt: 'num' }, { v: 45473, fmt: 'num' }, { f: '=WENN(ODER(B9="";C9="");"";C9-B9)', fmt: 'km' }, 'Dienstlich', 'Saarbrücken – Kaiserslautern', 'Messe', 'F. L.', null, { v: 'Gesamt', s: 'total' }, { f: '=SUMME(K6:K8)', s: 'total', fmt: 'km' }],
        [{ v: null, fmt: 'date' }, { f: '=WENN(C9="";"";C9)', fmt: 'num' }, { v: null, fmt: 'num' }, { f: '=WENN(ODER(B10="";C10="");"";C10-B10)', fmt: 'km' }, null, null, null, null, null, 'Anteil dienstlich', { f: '=WENN(K9>0;K6/K9;0)', fmt: 'pct' }],
        { repeat: 195, cells: [{ v: null, fmt: 'date' }, { f: '=WENN(C{r-1}="";"";C{r-1})', fmt: 'num' }, { v: null, fmt: 'num' }, { f: '=WENN(ODER(B{r}="";C{r}="");"";C{r}-B{r})', fmt: 'km' }] },
      ],
      patch: { J11: 'Erstattung dienstlich', K11: { f: '=K6*H3', fmt: 'eur' } },
      dv: [{ range: 'E6:E205', list: ['Dienstlich', 'Privat', 'Arbeitsweg'] }],
      cf: [{ range: 'C6:C205', type: 'formula', f: '=UND(C6<>"";B6<>"";C6<B6)', style: 'red' }, { range: 'D6:D205', type: 'bar', bar: 'blue' }],
      notes: { B6: 'Kilometerstand bei Fahrtbeginn. Ab der zweiten Zeile wird der Ende-km der Vorzeile übernommen (überschreibbar).', H3: 'Kilometerpauschale für Dienstfahrten mit dem Privatwagen.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 6 ------------------------------------------------------------- Rechnungsausgangsbuch
  {
    id: 'rechnungsausgangsbuch', title: 'Rechnungsausgangsbuch', desc: 'Rechnungen mit USt, Fälligkeit und Status – offene und überfällige Beträge', cat: 'Business', accent: 'indigo',
    keywords: 'rechnung umsatz offene posten mahnung umsatzsteuer kunden',
    sheets: [{
      name: 'Rechnungen', cols: [118, 96, 170, 190, 100, 76, 92, 104, 96, 96, 96, 24, 170, 120], freeze: 5, freezeC: 1, autoFilter: 'A5:K205', start: 'B10',
      rows: [
        [{ v: 'Rechnungsausgangsbuch', s: 'title' }],
        [{ v: 'Rechnungsnummer, Fälligkeit und Status werden berechnet. Mit „Bezahlt am“ wird eine Rechnung erledigt.', s: 'sub' }],
        [{ v: 'Zahlungsziel (Tage)', s: 'label' }, { v: 14, s: 'input', fmt: 'int' }],
        [],
        [{ v: 'Rechnungsnr.', s: 'head' }, { v: 'Datum', s: 'headR' }, { v: 'Kunde', s: 'head' }, { v: 'Leistung', s: 'head' }, { v: 'Netto', s: 'headR' }, { v: 'USt-Satz', s: 'headR' }, { v: 'USt', s: 'headR' }, { v: 'Brutto', s: 'headR' }, { v: 'Fällig am', s: 'headR' }, { v: 'Bezahlt am', s: 'headR' }, { v: 'Status', s: 'head' }, null, { v: 'Auswertung', s: 'head' }, { v: '', s: 'headR' }],
        ...[[-45, 'Muster GmbH', 'Webseite – Startpaket', 1200, -30], [-28, 'Bäckerei Sonnenschein', 'Flyer-Gestaltung', 340, -20], [-21, 'Praxis am Markt', 'Wartungsvertrag Q3', 480, null], [-6, 'Verein Blau-Weiß', 'Mitgliederverwaltung', 250, null]].map(([d, k, l, n, p], i) => {
          const r = 6 + i;
          return [`=WENN(B${r}="";"";"RE-"&JAHR(B${r})&"-"&TEXT(ZEILE()-5;"000"))`, { date: 'today', add: d, fmt: 'date' }, k, l, { v: n, fmt: 'eur' }, { v: i === 3 ? 0.07 : 0.19, fmt: 'pct0' },
            { f: `=WENN(E${r}="";"";RUNDEN(E${r}*F${r};2))`, fmt: 'eur' }, { f: `=WENN(E${r}="";"";E${r}+G${r})`, fmt: 'eur' }, { f: `=WENN(B${r}="";"";B${r}+$B$3)`, fmt: 'date' },
            p === null ? { v: null, fmt: 'date' } : { date: 'today', add: p, fmt: 'date' }, `=WENN(E${r}="";"";WENN(J${r}<>"";"bezahlt";WENN(HEUTE()>I${r};"überfällig";"offen")))`];
        }),
        { repeat: 196, cells: ['=WENN(B{r}="";"";"RE-"&JAHR(B{r})&"-"&TEXT(ZEILE()-5;"000"))', { v: null, fmt: 'date' }, null, null, { v: null, fmt: 'eur' }, { v: null, fmt: 'pct0' }, { f: '=WENN(E{r}="";"";RUNDEN(E{r}*F{r};2))', fmt: 'eur' }, { f: '=WENN(E{r}="";"";E{r}+G{r})', fmt: 'eur' }, { f: '=WENN(B{r}="";"";B{r}+$B$3)', fmt: 'date' }, { v: null, fmt: 'date' }, '=WENN(E{r}="";"";WENN(J{r}<>"";"bezahlt";WENN(HEUTE()>I{r};"überfällig";"offen")))'] },
      ],
      patch: {
        M6: 'Umsatz netto', N6: { f: '=SUMME(E6:E205)', fmt: 'eur' }, M7: 'Umsatzsteuer', N7: { f: '=SUMME(G6:G205)', fmt: 'eur' }, M8: 'Umsatz brutto', N8: { f: '=SUMME(H6:H205)', fmt: 'eur' },
        M9: 'Davon offen', N9: { f: '=SUMMEWENN(K6:K205;"offen";H6:H205)+SUMMEWENN(K6:K205;"überfällig";H6:H205)', fmt: 'eur' }, M10: { v: 'Davon überfällig', s: 'label' }, N10: { f: '=SUMMEWENN(K6:K205;"überfällig";H6:H205)', fmt: 'eur', s: 'label' },
      },
      cf: [
        { range: 'K6:K205', type: 'eq', v1: 'überfällig', style: 'red' }, { range: 'K6:K205', type: 'eq', v1: 'bezahlt', style: 'green' }, { range: 'K6:K205', type: 'eq', v1: 'offen', style: 'yellow' },
        { range: 'N10', type: 'gt', v1: '0', style: 'red' },
      ],
      dv: [{ range: 'F6:F205', type: 'decimal', op: 'between', v1: '0', v2: '1', error: 'USt-Satz als Prozent, z. B. 19 %.' }],
      notes: { A5: 'Die Nummer entsteht aus Jahr und Zeile (RE-Jahr-001). Bei Bedarf einfach überschreiben.', F5: 'Regelsatz 19 %, ermäßigt 7 %, Kleinunternehmer 0 %.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 7 ------------------------------------------------------------- EÜR light
  {
    id: 'euer', title: 'Einnahmen-Überschuss-Rechnung (light)', desc: 'Einnahmen und Ausgaben nach Kategorien, Gewinn und Umsatzsteuer-Zahllast', cat: 'Business', accent: 'green',
    keywords: 'eür steuer selbstständig gewinn ausgaben einnahmen vorsteuer buchhaltung',
    sheets: [
      {
        name: 'Übersicht', cols: [210, 100, 120, 110, 120], start: 'B3',
        rows: [
          [{ v: 'Einnahmen-Überschuss-Rechnung (vereinfacht)', s: 'title' }],
          [{ v: 'Übersicht für ein Jahr aus dem Blatt „Buchungen“. Hilfe zur Orientierung – ersetzt keine Steuerberatung und nicht das amtliche Formular.', s: 'sub' }],
          [{ v: 'Jahr', s: 'label' }, { f: '=JAHR(HEUTE())', s: 'input', fmt: 'int' }],
          [],
          [{ v: 'Kategorie', s: 'head' }, { v: 'Art', s: 'head' }, { v: 'Netto', s: 'headR' }, { v: 'USt', s: 'headR' }, { v: 'Brutto', s: 'headR' }],
          ...['Umsatzerlöse:Einnahme', 'Sonstige Einnahmen:Einnahme', 'Wareneinkauf:Ausgabe', 'Büro & Material:Ausgabe', 'Software & Abos:Ausgabe', 'Telefon & Internet:Ausgabe', 'Fahrtkosten:Ausgabe', 'Werbung:Ausgabe', 'Fortbildung:Ausgabe', 'Raumkosten:Ausgabe', 'Versicherungen & Beiträge:Ausgabe', 'Sonstige Ausgaben:Ausgabe'].map((x, i) => {
            const [k, a] = x.split(':'); const r = 6 + i;
            const crit = `Buchungen!$D$5:$D$500;A${r};Buchungen!$A$5:$A$500;">="&DATUM($B$3;1;1);Buchungen!$A$5:$A$500;"<="&DATUM($B$3;12;31)`;
            return [k, a, { f: `=SUMMEWENNS(Buchungen!$H$5:$H$500;${crit})`, fmt: 'eur' }, { f: `=SUMMEWENNS(Buchungen!$I$5:$I$500;${crit})`, fmt: 'eur' }, { f: `=C${r}+D${r}`, fmt: 'eur' }];
          }),
          [],
          [{ v: 'Summe Einnahmen (netto)', s: 'label' }, null, { f: '=SUMMEWENN(B6:B17;"Einnahme";C6:C17)', fmt: 'eur' }],
          [{ v: 'Summe Ausgaben (netto)', s: 'label' }, null, { f: '=SUMMEWENN(B6:B17;"Ausgabe";C6:C17)', fmt: 'eur' }],
          [{ v: 'Gewinn / Verlust', s: 'total' }, { v: null, s: 'total' }, { f: '=C19-C20', s: 'total', fmt: 'eurRed' }],
          [],
          [{ v: 'Umsatzsteuer (eingenommen)', s: 'label' }, null, null, { f: '=SUMMEWENN(B6:B17;"Einnahme";D6:D17)', fmt: 'eur' }],
          [{ v: 'Vorsteuer (gezahlt)', s: 'label' }, null, null, { f: '=SUMMEWENN(B6:B17;"Ausgabe";D6:D17)', fmt: 'eur' }],
          [{ v: 'Zahllast (+) / Erstattung (−)', s: 'total' }, { v: null, s: 'total' }, { v: null, s: 'total' }, { f: '=D23-D24', s: 'total', fmt: 'eurRed' }],
        ],
        cf: [{ range: 'C21', type: 'lt', v1: '0', style: 'red' }, { range: 'C21', type: 'gt', v1: '0', style: 'green' }, { range: 'C6:C17', type: 'bar', bar: 'green' }],
        charts: [{ type: 'bar', range: 'A5:A17', valuesCol: 'C', title: 'Netto nach Kategorie', at: 'G3', w: 440, h: 320, legend: 'n' }],
        page: { orient: 'portrait', fit: 'width', grid: false, head: false },
      },
      {
        name: 'Buchungen', cols: [96, 80, 230, 190, 96, 104, 76, 104, 96], freeze: 4, autoFilter: 'A4:I500', start: 'A11',
        rows: [
          [{ v: 'Buchungen', s: 'title' }],
          [{ v: 'Bruttobeträge eintragen; Netto und Umsatzsteuer werden herausgerechnet. Kleinunternehmer tragen 0 % ein.', s: 'sub' }],
          [],
          [{ v: 'Datum', s: 'head' }, { v: 'Beleg', s: 'head' }, { v: 'Beschreibung', s: 'head' }, { v: 'Kategorie', s: 'head' }, { v: 'Art', s: 'head' }, { v: 'Brutto', s: 'headR' }, { v: 'USt-Satz', s: 'headR' }, { v: 'Netto', s: 'headR' }, { v: 'USt', s: 'headR' }],
          ...[[-60, 'A-001', 'Rechnung Muster GmbH', 'Umsatzerlöse', 'Einnahme', 1428, 0.19], [-52, 'B-014', 'Druckerpapier & Toner', 'Büro & Material', 'Ausgabe', 89.9, 0.19], [-40, 'B-015', 'Bürosoftware Jahreslizenz', 'Software & Abos', 'Ausgabe', 119, 0.19],
            [-33, 'A-002', 'Rechnung Bäckerei Sonnenschein', 'Umsatzerlöse', 'Einnahme', 404.6, 0.19], [-20, 'B-016', 'Fachbuch', 'Fortbildung', 'Ausgabe', 42.8, 0.07], [-9, 'B-017', 'Mobilfunk', 'Telefon & Internet', 'Ausgabe', 29.99, 0.19]]
            .map(([d, b, t, k, a, br, u], i) => { const r = 5 + i; return [{ date: 'today', add: d, fmt: 'date' }, b, t, k, a, { v: br, fmt: 'eur' }, { v: u, fmt: 'pct0' }, { f: `=WENN(F${r}="";"";RUNDEN(F${r}/(1+G${r});2))`, fmt: 'eur' }, { f: `=WENN(F${r}="";"";F${r}-H${r})`, fmt: 'eur' }]; }),
          { repeat: 150, cells: [{ v: null, fmt: 'date' }, null, null, null, null, { v: null, fmt: 'eur' }, { v: null, fmt: 'pct0' }, { f: '=WENN(F{r}="";"";RUNDEN(F{r}/(1+G{r});2))', fmt: 'eur' }, { f: '=WENN(F{r}="";"";F{r}-H{r})', fmt: 'eur' }] },
        ],
        dv: [{ range: 'D5:D500', src: 'Übersicht!$A$6:$A$17' }, { range: 'E5:E500', list: ['Einnahme', 'Ausgabe'] }],
        cf: [{ range: 'A5:I500', type: 'formula', f: '=$E5="Einnahme"', custom: { color: '#1E6B3A' } }],
        page: { orient: 'landscape', fit: 'width', titleRows: { r1: 3, r2: 3 } },
      },
    ],
  },
  // 8 ------------------------------------------------------------- Kreditrechner
  {
    id: 'kreditrechner', title: 'Kreditrechner mit Tilgungsplan', desc: 'Monatsrate, Gesamtzinsen und Restschuld für jeden Monat', cat: 'Finanzen', accent: 'rose',
    keywords: 'kredit darlehen tilgung zins rate annuität finanzierung',
    sheets: [{
      name: 'Kredit', cols: [180, 110, 110, 110, 110, 120], freeze: 13, start: 'B4',
      rows: [
        [{ v: 'Kreditrechner mit Tilgungsplan', s: 'title' }],
        [{ v: 'Kreditbetrag, Sollzins und Laufzeit eintragen. Annuitätendarlehen mit gleichbleibender Monatsrate.', s: 'sub' }],
        [],
        [{ v: 'Kreditbetrag', s: 'label' }, { v: 20000, s: 'input', fmt: 'eur' }],
        [{ v: 'Sollzins p. a.', s: 'label' }, { v: 0.049, s: 'input', fmt: 'pct2' }],
        [{ v: 'Laufzeit (Jahre)', s: 'label' }, { v: 5, s: 'input', fmt: 'int' }],
        [{ v: 'Erste Rate am', s: 'label' }, { date: 'nextmonth', s: 'input', fmt: 'date' }],
        [],
        [{ v: 'Monatliche Rate', s: 'big' }, { f: '=RMZ(B5/12;B6*12;-B4)', s: 'big', fmt: 'eur' }],
        [{ v: 'Gesamtzinsen', s: 'label' }, { f: '=B9*B6*12-B4', fmt: 'eur' }],
        [{ v: 'Gesamtbetrag', s: 'label' }, { f: '=B9*B6*12', fmt: 'eur' }],
        [],
        [{ v: 'Nr.', s: 'headR' }, { v: 'Datum', s: 'headR' }, { v: 'Rate', s: 'headR' }, { v: 'Zinsen', s: 'headR' }, { v: 'Tilgung', s: 'headR' }, { v: 'Restschuld', s: 'headR' }],
        { repeat: 360, cells: [
          { f: '=WENN(ZEILE()-13>$B$6*12;"";ZEILE()-13)', fmt: 'int' }, { f: '=WENN(A{r}="";"";EDATUM($B$7;A{r}-1))', fmt: 'date' }, { f: '=WENN(A{r}="";"";$B$9)', fmt: 'eur' },
          { f: '=WENN(A{r}="";"";-ZINSZ($B$5/12;A{r};$B$6*12;$B$4))', fmt: 'eur' }, { f: '=WENN(A{r}="";"";C{r}-D{r})', fmt: 'eur' }, { f: '=WENN(A{r}="";"";WENN(A{r}=$B$6*12;0;RUNDEN(WENN(A{r}=1;$B$4;F{r-1})-E{r};2)))', fmt: 'eur' }] },
      ],
      cf: [{ range: 'F14:F373', type: 'bar', bar: 'red' }],
      dv: [{ range: 'B6', type: 'whole', op: 'between', v1: '1', v2: '30', error: 'Laufzeit zwischen 1 und 30 Jahren.' }],
      notes: { B5: 'Gebundener Sollzins pro Jahr (nicht der effektive Jahreszins).', F13: 'Restschuld nach der jeweiligen Rate.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 12, r2: 12 } },
    }],
  },
  // 9 ------------------------------------------------------------- Sparplan
  {
    id: 'sparplan', title: 'Sparplan', desc: 'Vermögensaufbau mit Sparrate, Zins und jährlicher Erhöhung – mit Diagramm', cat: 'Finanzen', accent: 'green',
    keywords: 'sparen zinseszins etf vermögen rente sparrate',
    sheets: [{
      name: 'Sparplan', cols: [190, 120, 130, 120, 120], freeze: 13, start: 'B5',
      rows: [
        [{ v: 'Sparplan', s: 'title' }],
        [{ v: 'Wie wächst dein Geld? Monatliche Einzahlung am Monatsende, Zinsen monatlich verrechnet. Werte ohne Gewähr.', s: 'sub' }],
        [],
        [{ v: 'Startkapital', s: 'label' }, { v: 1000, s: 'input', fmt: 'eur' }],
        [{ v: 'Monatliche Sparrate', s: 'label' }, { v: 150, s: 'input', fmt: 'eur' }],
        [{ v: 'Zins / Rendite p. a.', s: 'label' }, { v: 0.05, s: 'input', fmt: 'pct' }],
        [{ v: 'Laufzeit (Jahre)', s: 'label' }, { v: 20, s: 'input', fmt: 'int' }],
        [{ v: 'Jährliche Erhöhung der Rate', s: 'label' }, { v: 0.02, s: 'input', fmt: 'pct' }],
        [],
        [{ v: 'Endkapital', s: 'big' }, { f: '=WENN(B7>40;"max. 40 Jahre";SVERWEIS(B7;A14:C53;3;FALSCH))', s: 'big', fmt: 'eur' }],
        [{ v: 'Davon eingezahlt', s: 'label' }, { f: '=WENN(B7>40;"";SVERWEIS(B7;A14:C53;2;FALSCH))', fmt: 'eur' }],
        [{ v: 'Davon Zinsen', s: 'label' }, { f: '=WENN(B7>40;"";B10-B11)', fmt: 'eur' }],
        [{ v: 'Jahr', s: 'headR' }, { v: 'Eingezahlt', s: 'headR' }, { v: 'Kontostand', s: 'headR' }, { v: 'Rate/Monat', s: 'headR' }, { v: 'Zinsen im Jahr', s: 'headR' }],
        { repeat: 40, cells: [
          { f: '=WENN(ZEILE()-13>$B$7;"";ZEILE()-13)', fmt: 'int' }, { f: '=WENN(A{r}="";"";WENN(A{r}=1;$B$4;B{r-1})+D{r}*12)', fmt: 'eur' },
          { f: '=WENN(A{r}="";"";ZW($B$6/12;12;-D{r};-WENN(A{r}=1;$B$4;C{r-1})))', fmt: 'eur' }, { f: '=WENN(A{r}="";"";$B$5*(1+$B$8)^(A{r}-1))', fmt: 'eur' },
          { f: '=WENN(A{r}="";"";C{r}-WENN(A{r}=1;$B$4;C{r-1})-D{r}*12)', fmt: 'eur' }] },
      ],
      cf: [{ range: 'E14:E53', type: 'bar', bar: 'green' }],
      charts: [{ type: 'area', range: 'A13:C33', title: 'Eingezahlt und Kontostand (20 Jahre)', at: 'G3', w: 480, h: 300, legend: 'b' }],
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 12, r2: 12 } },
    }],
  },
  // 10 ------------------------------------------------------------ Projektplan
  {
    id: 'projektplan', title: 'Projektplan mit Zeitleiste', desc: 'Aufgaben, Verantwortliche, Fortschritt und ein Gantt-Raster in Wochen', cat: 'Arbeit', accent: 'indigo',
    keywords: 'projekt gantt zeitplan meilenstein aufgaben termine team',
    sheets: [{
      name: 'Projektplan', cols: [200, 110, 92, 70, 92, 90, 96, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], freeze: 5, freezeC: 1, start: 'A6',
      rows: [
        [{ v: 'Projektplan', s: 'title' }],
        [{ v: 'Start und Dauer (Arbeitstage) je Aufgabe eintragen – das Wochenraster färbt sich automatisch, heute ist gelb markiert.', s: 'sub' }],
        [{ v: 'Projektstart', s: 'label' }, { date: 'week', s: 'input', fmt: 'date' }],
        [null, null, null, null, null, null, null, ...Array.from({ length: 12 }, (_, i) => ({ f: `="KW "&ISOKALENDERWOCHE(${String.fromCharCode(72 + i)}5)`, s: ['small', 'center'] }))],
        [{ v: 'Aufgabe', s: 'head' }, { v: 'Verantwortlich', s: 'head' }, { v: 'Start', s: 'headR' }, { v: 'Dauer', s: 'headR' }, { v: 'Ende', s: 'headR' }, { v: 'Fortschritt', s: 'headR' }, { v: 'Status', s: 'head' },
          { f: '=$B$3', fmt: 'dm', s: ['headC', { size: 9 }] }, ...Array.from({ length: 11 }, (_, i) => ({ f: `=${String.fromCharCode(72 + i)}5+7`, fmt: 'dm', s: ['headC', { size: 9 }] }))],
        ...[['Kick-off', 'Team', 1, 1, 'Erledigt'], ['Anforderungen sammeln', 'Anna', 5, 1, 'Erledigt'], ['Konzept & Entwurf', 'Ben', 8, 0.6, 'In Arbeit'], ['Umsetzung Teil 1', 'Carla', 10, 0.2, 'In Arbeit'],
          ['Umsetzung Teil 2', 'Deniz', 10, 0, 'Offen'], ['Test & Abnahme', 'Anna', 6, 0, 'Offen'], ['Go-live', 'Team', 1, 0, 'Offen']].map(([t, w, d, p, st], i) => {
          const r = 6 + i;
          return [t, w, i === 0 ? { f: '=$B$3', fmt: 'date' } : { f: `=WENN(E${r - 1}="";"";ARBEITSTAG(E${r - 1};1))`, fmt: 'date' }, d, { f: `=WENN(ODER(C${r}="";D${r}="");"";ARBEITSTAG(C${r};D${r}-1))`, fmt: 'date' }, { v: p, fmt: 'pct0' }, st];
        }),
        { repeat: 13, cells: [null, null, { v: null, fmt: 'date' }, null, { f: '=WENN(ODER(C{r}="";D{r}="");"";ARBEITSTAG(C{r};D{r}-1))', fmt: 'date' }, { v: null, fmt: 'pct0' }] },
      ],
      rowH: { 5: 34 },
      dv: [{ range: 'G6:G25', list: ['Offen', 'In Arbeit', 'Wartet', 'Erledigt', 'Blockiert'] }, { range: 'F6:F25', type: 'decimal', op: 'between', v1: '0', v2: '1', error: 'Fortschritt zwischen 0 % und 100 %.' }],
      cf: [
        { range: 'H6:S25', type: 'formula', f: '=UND(HEUTE()>=H$5;HEUTE()<H$5+7)', custom: { fill: '#FFF3C4' } },
        { range: 'H6:S25', type: 'formula', f: '=UND($C6<>"";$E6<>"";H$5<=$E6;H$5+6>=$C6)', custom: { fill: '#8E96F0' } },
        { range: 'H6:S25', type: 'formula', f: '=UND($C6<>"";$E6<>"";H$5<=$E6;H$5+6>=$C6;$F6>=1)', custom: { fill: '#4CB782' } },
        { range: 'F6:F25', type: 'bar', bar: 'violet' },
        { range: 'G6:G25', type: 'eq', v1: 'Erledigt', style: 'green' }, { range: 'G6:G25', type: 'eq', v1: 'Blockiert', style: 'red' }, { range: 'G6:G25', type: 'eq', v1: 'In Arbeit', style: 'yellow' },
      ],
      notes: { D5: 'Dauer in Arbeitstagen (ohne Wochenenden).', C7: 'Startet automatisch am Arbeitstag nach dem Ende der Vorgängeraufgabe – zum Ändern einfach ein Datum eintragen.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 3, r2: 4 } },
    }],
  },
  // 11 ------------------------------------------------------------ Inventarliste
  {
    id: 'inventarliste', title: 'Inventarliste', desc: 'Gegenstände mit Wert, Kaufdatum und Garantie – z. B. für die Hausratversicherung', cat: 'Zuhause', accent: 'amber',
    keywords: 'inventar hausrat versicherung garantie wertgegenstände liste',
    sheets: [{
      name: 'Inventar', cols: [50, 190, 140, 120, 70, 100, 110, 100, 84, 100, 190, 24, 210, 110], freeze: 4, freezeC: 2, autoFilter: 'A4:K204', start: 'B11',
      rows: [
        [{ v: 'Inventarliste', s: 'title' }],
        [{ v: 'Gegenstände mit Kaufdatum und Preis erfassen. Ablaufende Garantien werden markiert; Fotos der Belege separat aufbewahren.', s: 'sub' }],
        [],
        [{ v: 'Nr.', s: 'headR' }, { v: 'Gegenstand', s: 'head' }, { v: 'Kategorie', s: 'head' }, { v: 'Raum', s: 'head' }, { v: 'Anzahl', s: 'headR' }, { v: 'Einzelpreis', s: 'headR' }, { v: 'Gesamtwert', s: 'headR' }, { v: 'Kaufdatum', s: 'headR' }, { v: 'Garantie (Mon.)', s: 'headR' }, { v: 'Garantie bis', s: 'headR' }, { v: 'Seriennummer / Notiz', s: 'head' }, null, { v: 'Auswertung', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Laptop', 'Elektronik', 'Arbeitszimmer', 1, 899, -420, 24, 'SN 4711-AB'], ['Waschmaschine', 'Haushaltsgeräte', 'Bad', 1, 549, -700, 24, ''], ['Sofa', 'Möbel', 'Wohnzimmer', 1, 1199, -1500, 0, ''],
          ['Fahrrad', 'Freizeit', 'Keller', 2, 650, -200, 24, 'Rahmennr. notieren'], ['Fernseher', 'Elektronik', 'Wohnzimmer', 1, 749, -90, 24, ''], ['Kaffeevollautomat', 'Haushaltsgeräte', 'Küche', 1, 399, -800, 24, 'Garantie abgelaufen'], ['Akkuschrauber', 'Werkzeug', 'Keller', 1, 129, -690, 24, '']]
          .map(([g, k, raum, n, p, d, m, note], i) => { const r = 5 + i; return [{ f: `=WENN(B${r}="";"";ZEILE()-4)`, fmt: 'int' }, g, k, raum, n, { v: p, fmt: 'eur' }, { f: `=WENN(ODER(E${r}="";F${r}="");"";E${r}*F${r})`, fmt: 'eur' }, { date: 'today', add: d, fmt: 'date' }, m, { f: `=WENN(ODER(H${r}="";I${r}="";I${r}=0);"";EDATUM(H${r};I${r}))`, fmt: 'date' }, note]; }),
        { repeat: 193, cells: [{ f: '=WENN(B{r}="";"";ZEILE()-4)', fmt: 'int' }, null, null, null, null, { v: null, fmt: 'eur' }, { f: '=WENN(ODER(E{r}="";F{r}="");"";E{r}*F{r})', fmt: 'eur' }, { v: null, fmt: 'date' }, null, { f: '=WENN(ODER(H{r}="";I{r}="";I{r}=0);"";EDATUM(H{r};I{r}))', fmt: 'date' }] },
      ],
      patch: {
        M5: 'Gesamtwert', N5: { f: '=SUMME(G5:G204)', fmt: 'eur', s: 'label' }, M6: 'Gegenstände', N6: { f: '=ANZAHL2(B5:B204)', fmt: 'int' },
        M7: 'Garantie endet in ≤ 60 Tagen', N7: { f: '=ZÄHLENWENNS(J5:J204;">="&HEUTE();J5:J204;"<="&(HEUTE()+60))', fmt: 'int' }, M8: 'Garantie abgelaufen', N8: { f: '=ZÄHLENWENN(J5:J204;"<"&HEUTE())', fmt: 'int' },
      },
      dv: [{ range: 'C5:C204', list: ['Elektronik', 'Möbel', 'Haushaltsgeräte', 'Küche', 'Kleidung', 'Schmuck', 'Freizeit', 'Werkzeug', 'Sonstiges'] },
        { range: 'D5:D204', list: ['Wohnzimmer', 'Küche', 'Schlafzimmer', 'Bad', 'Arbeitszimmer', 'Kinderzimmer', 'Flur', 'Keller', 'Garage', 'Garten'] }],
      cf: [
        { range: 'J5:J204', type: 'formula', f: '=UND(J5<>"";J5<HEUTE())', style: 'gray' },
        { range: 'J5:J204', type: 'formula', f: '=UND(J5<>"";J5>=HEUTE();J5-HEUTE()<=60)', style: 'yellow' },
        { range: 'G5:G204', type: 'bar', bar: 'orange' },
      ],
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 3, r2: 3 } },
    }],
  },
  // 12 ------------------------------------------------------------ Kontaktliste
  {
    id: 'kontaktliste', title: 'Kontaktliste', desc: 'Adressen, Telefon, E-Mail und Geburtstage mit Filter und Erinnerung', cat: 'Zuhause', accent: 'blue',
    keywords: 'adressen kontakte telefonliste geburtstage verein familie',
    sheets: [{
      name: 'Kontakte', cols: [110, 120, 120, 130, 200, 170, 64, 130, 100, 54, 120, 200], freeze: 3, freezeC: 2, autoFilter: 'A3:L203', start: 'A9',
      rows: [
        [{ v: 'Kontaktliste', s: 'title' }],
        [{ v: 'Mit ▾ in der Kopfzeile filtern und sortieren. Geburtstage in den nächsten 14 Tagen werden grün markiert.', s: 'sub' }],
        [{ v: 'Vorname', s: 'head' }, { v: 'Nachname', s: 'head' }, { v: 'Gruppe', s: 'head' }, { v: 'Telefon', s: 'head' }, { v: 'E-Mail', s: 'head' }, { v: 'Straße', s: 'head' }, { v: 'PLZ', s: 'head' }, { v: 'Ort', s: 'head' }, { v: 'Geburtstag', s: 'headR' }, { v: 'Alter', s: 'headR' }, { v: 'Nächster Geb.', s: 'headR' }, { v: 'Notiz', s: 'head' }],
        ...[['Maria', 'Muster', 'Familie', '0170 1234567', 'maria@example.de', 'Hauptstraße 1', '66111', 'Saarbrücken', '1985-03-12', ''], ['Jonas', 'Beispiel', 'Freunde', '0151 2345678', 'jonas@example.org', 'Lindenweg 7', '66123', 'Saarbrücken', 'soon', 'Fußball dienstags'],
          ['Lena', 'Probe', 'Arbeit', '0681 9876543', 'lena.probe@example.com', 'Am Markt 3', '66424', 'Homburg', '1990-11-02', ''], ['Tim', 'Test', 'Verein', '06841 12345', 'tim@example.net', 'Bergstraße 12', '66386', 'St. Ingbert', '1978-06-30', 'Kassenwart'],
          ['Praxis am Markt', '', 'Ärzte & Dienste', '0681 55555', 'praxis@example.de', 'Marktplatz 5', '66111', 'Saarbrücken', null, 'Termin online']]
          .map(([v, n, g, t, m, s, plz, o, gb, note], i) => { const r = 4 + i; return [v, n, g, { v: t, fmt: 'text' }, { v: m, link: 'mailto:' + m }, s, { v: +plz, fmt: 'zip' }, o, gb === 'soon' ? { date: 'today', add: 5, years: -34, fmt: 'date' } : gb ? { date: gb, fmt: 'date' } : { v: null, fmt: 'date' }, { f: `=WENN(I${r}="";"";DATEDIF(I${r};HEUTE();"Y"))`, fmt: 'int' }, { f: `=WENN(I${r}="";"";DATUM(JAHR(HEUTE())+(DATUM(JAHR(HEUTE());MONAT(I${r});TAG(I${r}))<HEUTE());MONAT(I${r});TAG(I${r})))`, fmt: 'date' }, note]; }),
        { repeat: 195, cells: [null, null, null, { v: null, fmt: 'text' }, null, null, { v: null, fmt: 'zip' }, null, { v: null, fmt: 'date' }, { f: '=WENN(I{r}="";"";DATEDIF(I{r};HEUTE();"Y"))', fmt: 'int' }, { f: '=WENN(I{r}="";"";DATUM(JAHR(HEUTE())+(DATUM(JAHR(HEUTE());MONAT(I{r});TAG(I{r}))<HEUTE());MONAT(I{r});TAG(I{r})))', fmt: 'date' }] },
      ],
      dv: [{ range: 'C4:C203', list: ['Familie', 'Freunde', 'Arbeit', 'Verein', 'Nachbarn', 'Ärzte & Dienste', 'Sonstiges'] }],
      cf: [{ range: 'K4:K203', type: 'formula', f: '=UND(K4<>"";K4-HEUTE()<=14)', style: 'green' }],
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 2, r2: 2 } },
    }],
  },
  // 13 ------------------------------------------------------------ Notenrechner
  {
    id: 'notenrechner', title: 'Notenrechner', desc: 'Schulnoten je Fach mit Gewichtung, Zeugnisnote und Notenspiegel', cat: 'Schule & Freizeit', accent: 'teal',
    keywords: 'schule noten zeugnis durchschnitt klassenarbeit mündlich',
    sheets: [{
      name: 'Noten', cols: [150, 70, 70, 70, 70, 70, 70, 84, 84, 76, 84, 24, 70, 70], freeze: 5, start: 'B6',
      rows: [
        [{ v: 'Notenrechner', s: 'title' }],
        [{ v: 'Noten von 1 bis 6 eintragen (auch 2,5 usw.). Schriftliche und mündliche Noten werden nach der Gewichtung verrechnet.', s: 'sub' }],
        [{ v: 'Gewichtung schriftlich', s: 'label' }, { v: 0.5, s: 'input', fmt: 'pct0' }, null, { f: '="mündlich: "&TEXT(1-B3;"0 %")', s: 'muted' }],
        [],
        [{ v: 'Fach', s: 'head' }, { v: 'Schr. 1', s: 'headC' }, { v: 'Schr. 2', s: 'headC' }, { v: 'Schr. 3', s: 'headC' }, { v: 'Mündl. 1', s: 'headC' }, { v: 'Mündl. 2', s: 'headC' }, { v: 'Mündl. 3', s: 'headC' }, { v: 'Ø schriftl.', s: 'headR' }, { v: 'Ø mündl.', s: 'headR' }, { v: 'Gesamt', s: 'headR' }, { v: 'Zeugnis', s: 'headC' }, null, { v: 'Note', s: 'headC' }, { v: 'Anzahl', s: 'headR' }],
        ...[['Deutsch', 2, 3, null, 2, 2], ['Mathematik', 3, 2.5, 2, 3], ['Englisch', 2, 2, null, 1, 2], ['Biologie', 1, null, null, 2], ['Physik', 4, 3, null, 3], ['Chemie', 3, null, null, 2], ['Geschichte', 2, null, null, 2],
          ['Erdkunde', 2, null, null, 3], ['Kunst', null, null, null, 1], ['Musik', null, null, null, 2], ['Sport', null, null, null, 1], ['Religion / Ethik', 2, null, null, 2]]
          .map((g, i) => { const r = 6 + i; const v = k => (g[k] == null ? null : { v: g[k], fmt: 'dec1', s: 'center' }); return [g[0], v(1), v(2), v(3), v(4), v(5), { v: null, fmt: 'dec1', s: 'center' },
            { f: `=WENN(ANZAHL(B${r}:D${r})=0;"";MITTELWERT(B${r}:D${r}))`, fmt: 'dec2' }, { f: `=WENN(ANZAHL(E${r}:G${r})=0;"";MITTELWERT(E${r}:G${r}))`, fmt: 'dec2' },
            { f: `=WENN(UND(H${r}="";I${r}="");"";WENN(H${r}="";I${r};WENN(I${r}="";H${r};H${r}*$B$3+I${r}*(1-$B$3))))`, fmt: 'dec2' }, { f: `=WENN(J${r}="";"";RUNDEN(J${r};0))`, fmt: 'int', s: ['label', 'center'] }]; }),
        [],
        [{ v: 'Gesamtdurchschnitt', s: 'total' }, ...Array.from({ length: 8 }, () => ({ v: null, s: 'total' })), { f: '=WENN(ANZAHL(J6:J17)=0;"";MITTELWERT(J6:J17))', s: 'total', fmt: 'dec2' }, { f: '=WENN(J19="";"";RUNDEN(J19;1))', s: 'total', fmt: 'dec1' }],
      ],
      patch: Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap(n => [[`M${5 + n}`, { v: `Note ${n}`, s: 'center' }], [`N${5 + n}`, { f: `=ZÄHLENWENN($K$6:$K$17;${n})`, fmt: 'int' }]])),
      dv: [{ range: 'B6:G17', type: 'decimal', op: 'between', v1: '1', v2: '6', error: 'Noten von 1 bis 6.' }, { range: 'B3', type: 'decimal', op: 'between', v1: '0', v2: '1', error: 'Gewichtung zwischen 0 % und 100 %.' }],
      cf: [{ range: 'J6:J17', type: 'scale', scale: 'gr' }, { range: 'K6:K17', type: 'ge', v1: '5', style: 'red' }, { range: 'N6:N11', type: 'bar', bar: 'blue' }],
      charts: [{ type: 'col', range: 'M5:N11', title: 'Notenspiegel', at: 'M13', w: 360, h: 230, legend: 'n' }],
      page: { orient: 'landscape', fit: 'width', grid: true, head: false },
    }],
  },
  // 14 ------------------------------------------------------------ Trainingsplan
  {
    id: 'trainingsplan', title: 'Trainingsplan', desc: 'Wochenplan mit Sätzen, Wiederholungen und Gewicht plus Fortschritts-Log', cat: 'Schule & Freizeit', accent: 'rose',
    keywords: 'fitness sport training workout kraft gym übungen fortschritt',
    sheets: [
      {
        name: 'Plan', cols: [100, 170, 110, 64, 64, 96, 110, 90, 200, 24, 110, 110], freeze: 4, start: 'B5',
        rows: [
          [{ v: 'Trainingsplan', s: 'title' }],
          [{ v: 'Übungen je Trainingstag. Volumen = Sätze × Wiederholungen × Gewicht. Fortschritte im Blatt „Fortschritt“ festhalten.', s: 'sub' }],
          [],
          [{ v: 'Tag', s: 'head' }, { v: 'Übung', s: 'head' }, { v: 'Muskelgruppe', s: 'head' }, { v: 'Sätze', s: 'headR' }, { v: 'Wdh.', s: 'headR' }, { v: 'Gewicht', s: 'headR' }, { v: 'Volumen', s: 'headR' }, { v: 'Pause (Sek.)', s: 'headR' }, { v: 'Notiz', s: 'head' }, null, { v: 'Tag', s: 'head' }, { v: 'Volumen', s: 'headR' }],
          ...[['Montag', 'Kniebeuge', 'Beine', 4, 8, 60, 120], ['Montag', 'Bankdrücken', 'Brust', 4, 8, 50, 120], ['Montag', 'Rudern am Kabel', 'Rücken', 3, 10, 45, 90], ['Montag', 'Unterarmstütz (Sek.)', 'Rumpf', 3, 45, null, 60],
            ['Mittwoch', 'Kreuzheben', 'Rücken', 3, 6, 80, 150], ['Mittwoch', 'Schulterdrücken', 'Schultern', 3, 10, 25, 90], ['Mittwoch', 'Klimmzüge', 'Rücken', 3, 6, null, 120], ['Mittwoch', 'Ausfallschritte', 'Beine', 3, 12, 16, 60],
            ['Freitag', 'Laufen (Minuten)', 'Ausdauer', 1, 30, null, null], ['Freitag', 'Bizepscurls', 'Arme', 3, 12, 12, 60], ['Freitag', 'Dips', 'Arme', 3, 10, null, 90]]
            .map(([t, u, m, s, w, g, p], i) => { const r = 5 + i; return [t, u, m, s, w, g == null ? { v: null, fmt: 'kg' } : { v: g, fmt: 'kg' }, { f: `=WENN(ODER(D${r}="";E${r}="";F${r}="");"";D${r}*E${r}*F${r})`, fmt: 'num' }, p]; }),
          { repeat: 24, cells: [null, null, null, null, null, { v: null, fmt: 'kg' }, { f: '=WENN(ODER(D{r}="";E{r}="";F{r}="");"";D{r}*E{r}*F{r})', fmt: 'num' }] },
        ],
        patch: Object.fromEntries(['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].flatMap((d, i) => [[`K${5 + i}`, d], [`L${5 + i}`, { f: `=SUMMEWENN($A$5:$A$39;K${5 + i};$G$5:$G$39)`, fmt: 'num' }]])),
        dv: [{ range: 'A5:A39', list: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'] }, { range: 'C5:C39', list: ['Beine', 'Brust', 'Rücken', 'Schultern', 'Arme', 'Rumpf', 'Ausdauer', 'Beweglichkeit'] }],
        cf: [{ range: 'A5:I39', type: 'formula', f: '=REST(VERGLEICH($A5;{"Montag"."Dienstag"."Mittwoch"."Donnerstag"."Freitag"."Samstag"."Sonntag"};0);2)=0', style: 'gray' }, { range: 'L5:L11', type: 'bar', bar: 'red' }],
        charts: [{ type: 'col', range: 'K4:L11', title: 'Volumen pro Tag', at: 'N3', w: 380, h: 260, legend: 'n' }],
      },
      {
        name: 'Fortschritt', cols: [100, 170, 96, 64, 64, 110, 120], freeze: 3, autoFilter: 'A3:G300', start: 'A9',
        rows: [
          [{ v: 'Fortschritt', s: 'title' }],
          [{ v: 'Nach jedem Training die Hauptübungen eintragen. Neue Bestwerte werden grün markiert.', s: 'sub' }],
          [{ v: 'Datum', s: 'head' }, { v: 'Übung', s: 'head' }, { v: 'Gewicht', s: 'headR' }, { v: 'Wdh.', s: 'headR' }, { v: 'Sätze', s: 'headR' }, { v: 'Volumen', s: 'headR' }, { v: 'Bestwert bisher', s: 'headR' }],
          ...[[-21, 'Kniebeuge', 55, 8, 4], [-21, 'Bankdrücken', 45, 8, 4], [-14, 'Kniebeuge', 57.5, 8, 4], [-14, 'Bankdrücken', 47.5, 8, 4], [-7, 'Kniebeuge', 60, 8, 4], [-7, 'Bankdrücken', 47.5, 9, 4]]
            .map(([d, u, g, w, s], i) => { const r = 4 + i; return [{ date: 'today', add: d, fmt: 'date' }, u, { v: g, fmt: 'kg' }, w, s, { f: `=WENN(ODER(C${r}="";D${r}="";E${r}="");"";C${r}*D${r}*E${r})`, fmt: 'num' }, { f: `=WENN(B${r}="";"";MAXWENNS($C$4:C${r};$B$4:B${r};B${r}))`, fmt: 'kg' }]; }),
          { repeat: 120, cells: [{ v: null, fmt: 'date' }, null, { v: null, fmt: 'kg' }, null, null, { f: '=WENN(ODER(C{r}="";D{r}="";E{r}="");"";C{r}*D{r}*E{r})', fmt: 'num' }, { f: '=WENN(B{r}="";"";MAXWENNS($C$4:C{r};$B$4:B{r};B{r}))', fmt: 'kg' }] },
        ],
        dv: [{ range: 'B4:B300', src: 'Plan!$B$5:$B$39' }],
        cf: [{ range: 'C4:C300', type: 'formula', f: '=UND(C4<>"";C4=G4;ZÄHLENWENNS($B$4:B4;B4;$C$4:C4;C4)=1)', style: 'green' }],
      },
    ],
  },
  // 15 ------------------------------------------------------------ Essensplan & Einkaufsliste
  {
    id: 'essensplan', title: 'Essensplan & Einkaufsliste', desc: 'Wochenplan für alle Mahlzeiten und eine Einkaufsliste mit Abhaken und Kosten', cat: 'Zuhause', accent: 'green',
    keywords: 'essen kochen wochenplan einkauf einkaufsliste mahlzeiten familie',
    sheets: [
      {
        name: 'Wochenplan', cols: [110, 130, 130, 130, 130, 130, 130, 130], freeze: 3, freezeC: 1, start: 'B4',
        rows: [
          [{ v: 'Essensplan', s: 'title' }],
          [{ v: 'Gerichte für die Woche planen. Zutaten danach ins Blatt „Einkaufsliste“ übernehmen.', s: 'sub' }],
          [{ v: '', s: 'head' }, ...['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'].map(d => ({ v: d, s: 'headC' }))],
          { cells: [{ v: 'Frühstück', s: 'label' }, ...['Haferflocken mit Obst', 'Vollkornbrot mit Käse', 'Joghurt mit Müsli', 'Rührei auf Toast', 'Haferflocken mit Obst', 'Pfannkuchen', 'Brötchen & Ei'].map(t => ({ v: t, s: 'wrap' }))], h: 52 },
          { cells: [{ v: 'Mittagessen', s: 'label' }, ...['Linsensuppe', 'Reste vom Vortag', 'Ofengemüse mit Feta', 'Nudelsalat', 'Gemüsecurry mit Reis', 'Kartoffelsuppe', 'Sonntagsbraten'].map(t => ({ v: t, s: 'wrap' }))], h: 52 },
          { cells: [{ v: 'Abendessen', s: 'label' }, ...['Gemüsepfanne', 'Flammkuchen', 'Brotzeit', 'Lachs mit Brokkoli', 'Pizza selbst gemacht', 'Salat mit Hähnchen', 'Suppe & Brot'].map(t => ({ v: t, s: 'wrap' }))], h: 52 },
          { cells: [{ v: 'Snacks', s: 'label' }, ...['Apfel', 'Nüsse', 'Karottensticks', 'Banane', 'Joghurt', 'Obstsalat', 'Kuchen'].map(t => ({ v: t, s: 'wrap' }))], h: 40 },
          [],
          [{ v: 'Notizen', s: 'label' }, { v: 'Mittwoch: Kindergeburtstag – mehr Snacks einplanen.', s: 'muted' }],
        ],
        cf: [{ range: 'B4:H7', type: 'blank', style: 'yellow' }],
        page: { orient: 'landscape', fit: 'page', grid: true, head: false },
      },
      {
        name: 'Einkaufsliste', cols: [190, 70, 80, 150, 96, 80, 24, 170, 110], freeze: 3, autoFilter: 'A3:F80', start: 'A14',
        rows: [
          [{ v: 'Einkaufsliste', s: 'title' }],
          [{ v: 'In der Spalte „Erledigt“ ✓ wählen – erledigte Artikel werden grau und durchgestrichen. Mit dem Filter nach Kategorie sortieren.', s: 'sub' }],
          [{ v: 'Artikel', s: 'head' }, { v: 'Menge', s: 'headR' }, { v: 'Einheit', s: 'head' }, { v: 'Kategorie', s: 'head' }, { v: 'Preis (ca.)', s: 'headR' }, { v: 'Erledigt', s: 'headC' }, null, { v: 'Übersicht', s: 'head' }, { v: '', s: 'headR' }],
          ...[['Haferflocken', 1, 'Packung', 'Vorrat', 1.29, '✓'], ['Äpfel', 1, 'kg', 'Obst & Gemüse', 2.49, ''], ['Bananen', 6, 'Stück', 'Obst & Gemüse', 1.79, ''], ['Rote Linsen', 500, 'g', 'Vorrat', 1.99, '✓'],
            ['Feta', 2, 'Packung', 'Milchprodukte', 3.38, ''], ['Joghurt', 1, 'kg', 'Milchprodukte', 1.69, ''], ['Lachsfilet', 2, 'Stück', 'Fleisch & Fisch', 7.98, ''], ['Vollkornbrot', 1, 'Laib', 'Brot & Backwaren', 3.2, ''],
            ['Brokkoli', 1, 'Stück', 'Obst & Gemüse', 1.49, ''], ['Mineralwasser', 1, 'Kiste', 'Getränke', 5.99, '']]
            .map(([a, m, e, k, p, d]) => [a, m, e, k, { v: p, fmt: 'eur' }, { v: d, s: 'center' }]),
          { repeat: 67, cells: [null, null, null, null, { v: null, fmt: 'eur' }, { v: null, s: 'center' }] },
        ],
        patch: { H4: 'Artikel offen', I4: { f: '=ZÄHLENWENNS(A4:A80;"<>";F4:F80;"<>✓")', fmt: 'int' }, H5: 'Kosten offen', I5: { f: '=SUMMEWENN(F4:F80;"<>✓";E4:E80)', fmt: 'eur' }, H6: 'Kosten gesamt', I6: { f: '=SUMME(E4:E80)', fmt: 'eur' } },
        dv: [{ range: 'F4:F80', list: ['✓'] }, { range: 'D4:D80', list: ['Obst & Gemüse', 'Brot & Backwaren', 'Milchprodukte', 'Fleisch & Fisch', 'Vorrat', 'Tiefkühl', 'Getränke', 'Drogerie', 'Haushalt'] },
          { range: 'C4:C80', list: ['Stück', 'g', 'kg', 'ml', 'l', 'Packung', 'Dose', 'Glas', 'Bund', 'Kiste', 'Laib'] }],
        cf: [{ range: 'A4:E80', type: 'formula', f: '=$F4="✓"', style: 'done' }],
      },
    ],
  },
  // 16 ------------------------------------------------------------ Nebenkosten
  {
    id: 'nebenkosten', title: 'Nebenkosten-Rechner', desc: 'Anteil einer Wohnung an den Betriebskosten – Nachzahlung oder Guthaben prüfen', cat: 'Zuhause', accent: 'amber',
    keywords: 'nebenkosten betriebskosten miete abrechnung umlage wohnfläche vermieter mieter',
    sheets: [{
      name: 'Nebenkosten', cols: [240, 130, 130, 96, 120, 200], start: 'B4',
      rows: [
        [{ v: 'Nebenkosten-Rechner', s: 'title' }],
        [{ v: 'Kosten des Hauses und Umlageschlüssel eintragen. Hilfe zum Nachrechnen einer Abrechnung – keine Rechtsberatung.', s: 'sub' }],
        [],
        [{ v: 'Gesamtwohnfläche Haus', s: 'label' }, { v: 420, s: 'input', fmt: 'qm' }],
        [{ v: 'Wohnfläche der Wohnung', s: 'label' }, { v: 68, s: 'input', fmt: 'qm' }],
        [{ v: 'Personen im Haus', s: 'label' }, { v: 11, s: 'input', fmt: 'int' }],
        [{ v: 'Personen in der Wohnung', s: 'label' }, { v: 2, s: 'input', fmt: 'int' }],
        [{ v: 'Wohneinheiten im Haus', s: 'label' }, { v: 6, s: 'input', fmt: 'int' }],
        [{ v: 'Monatliche Vorauszahlung', s: 'label' }, { v: 260, s: 'input', fmt: 'eur' }],
        [{ v: 'Abrechnungsmonate', s: 'label' }, { v: 12, s: 'input', fmt: 'int' }],
        [],
        [{ v: 'Kostenart', s: 'head' }, { v: 'Kosten Haus', s: 'headR' }, { v: 'Umlageschlüssel', s: 'head' }, { v: 'Anteil', s: 'headR' }, { v: 'Anteil Wohnung', s: 'headR' }, { v: 'Bemerkung', s: 'head' }],
        ...[['Grundsteuer', 1450, 'Wohnfläche'], ['Wasser & Abwasser', 2860, 'Personen'], ['Müllabfuhr', 1320, 'Personen'], ['Straßenreinigung', 260, 'Wohnfläche'], ['Gebäudereinigung', 1680, 'Wohnfläche'],
          ['Gartenpflege', 720, 'Wohnfläche'], ['Allgemeinstrom', 410, 'Einheiten'], ['Gebäudeversicherung', 1190, 'Wohnfläche'], ['Hauswart', 1800, 'Wohnfläche'], ['Schornsteinfeger', 240, 'Einheiten'], ['Heizung & Warmwasser', 8400, 'Wohnfläche']]
          .map(([k, b, u], i) => { const r = 13 + i; return [k, { v: b, fmt: 'eur' }, u, { f: `=WENN(B${r}="";"";WENN(C${r}="Wohnfläche";$B$5/$B$4;WENN(C${r}="Personen";$B$7/$B$6;WENN(C${r}="Einheiten";1/$B$8;WENN(C${r}="Direkt";1;0)))))`, fmt: 'pct2' }, { f: `=WENN(B${r}="";"";B${r}*D${r})`, fmt: 'eur' }]; }),
        { repeat: 4, cells: [null, { v: null, fmt: 'eur' }, null, { f: '=WENN(B{r}="";"";WENN(C{r}="Wohnfläche";$B$5/$B$4;WENN(C{r}="Personen";$B$7/$B$6;WENN(C{r}="Einheiten";1/$B$8;WENN(C{r}="Direkt";1;0)))))', fmt: 'pct2' }, { f: '=WENN(B{r}="";"";B{r}*D{r})', fmt: 'eur' }] },
        [{ v: 'Summe', s: 'total' }, { f: '=SUMME(B13:B27)', s: 'total', fmt: 'eur' }, { v: null, s: 'total' }, { v: null, s: 'total' }, { f: '=SUMME(E13:E27)', s: 'total', fmt: 'eur' }],
        [{ v: 'Geleistete Vorauszahlungen', s: 'label' }, null, null, null, { f: '=B9*B10', fmt: 'eur' }],
        [{ v: 'Nachzahlung (+) / Guthaben (−)', s: 'big' }, null, null, null, { f: '=E28-E29', s: 'big', fmt: 'eurRed' }],
        [{ v: 'Vorschlag neue Vorauszahlung/Monat', s: 'label' }, null, null, null, { f: '=AUFRUNDEN(E28/B10;0)', fmt: 'eur' }],
      ],
      dv: [{ range: 'C13:C27', list: ['Wohnfläche', 'Personen', 'Einheiten', 'Direkt'] }],
      cf: [{ range: 'E30', type: 'gt', v1: '0', style: 'red' }, { range: 'E30', type: 'le', v1: '0', style: 'green' }, { range: 'E13:E27', type: 'bar', bar: 'orange' }],
      notes: { C12: 'Wohnfläche = nach m², Personen = nach Köpfen, Einheiten = gleich je Wohnung, Direkt = Kosten nur dieser Wohnung (z. B. Zähler).' },
      page: { orient: 'portrait', fit: 'width', grid: false, head: false },
    }],
  },
  // 17 ------------------------------------------------------------ Kassenbuch
  {
    id: 'kassenbuch', title: 'Kassenbuch', desc: 'Bareinnahmen und -ausgaben mit laufendem Bestand und Warnung bei Minus', cat: 'Business', accent: 'slate',
    keywords: 'kasse bargeld beleg verein laden kassenbestand barkasse',
    sheets: [{
      name: 'Kassenbuch', cols: [96, 76, 240, 104, 104, 76, 110, 24, 180, 110], freeze: 5, autoFilter: 'A5:G205', start: 'A11',
      rows: [
        [{ v: 'Kassenbuch', s: 'title' }],
        [{ v: 'Jede Bareinnahme und -ausgabe am selben Tag eintragen. Der Kassenbestand darf nie negativ werden.', s: 'sub' }],
        [{ v: 'Anfangsbestand', s: 'label' }, { v: 150, s: 'input', fmt: 'eur' }, null, { v: 'Zeitraum', s: 'label' }, { date: 'month', s: 'input', fmt: 'month' }],
        [],
        [{ v: 'Datum', s: 'head' }, { v: 'Beleg', s: 'headR' }, { v: 'Buchungstext', s: 'head' }, { v: 'Einnahme', s: 'headR' }, { v: 'Ausgabe', s: 'headR' }, { v: 'USt-Satz', s: 'headR' }, { v: 'Bestand', s: 'headR' }, null, { v: 'Auswertung', s: 'head' }, { v: '', s: 'headR' }],
        ...[[1, 'Barverkauf', 84.5, null, 0.19], [2, 'Briefmarken', null, 17, 0], [3, 'Reinigungsmittel', null, 12.49, 0.19], [5, 'Barverkauf', 126, null, 0.19], [8, 'Bewirtung Kunde', null, 38.6, 0.19]]
          .map(([d, t, ein, aus, u], i) => { const r = 6 + i; return [{ date: 'month', add: d, fmt: 'date' }, { f: `=WENN(C${r}="";"";ZEILE()-5)`, fmt: 'int' }, t, { v: ein, fmt: 'eur' }, { v: aus, fmt: 'eur' }, { v: u, fmt: 'pct0' }, { f: `=WENN(UND(D${r}="";E${r}="");"";$B$3+SUMME($D$6:D${r})-SUMME($E$6:E${r}))`, fmt: 'eur' }]; }),
        { repeat: 195, cells: [{ v: null, fmt: 'date' }, { f: '=WENN(C{r}="";"";ZEILE()-5)', fmt: 'int' }, null, { v: null, fmt: 'eur' }, { v: null, fmt: 'eur' }, { v: null, fmt: 'pct0' }, { f: '=WENN(UND(D{r}="";E{r}="");"";$B$3+SUMME($D$6:D{r})-SUMME($E$6:E{r}))', fmt: 'eur' }] },
      ],
      patch: { I6: 'Einnahmen', J6: { f: '=SUMME(D6:D205)', fmt: 'eur' }, I7: 'Ausgaben', J7: { f: '=SUMME(E6:E205)', fmt: 'eur' }, I8: { v: 'Endbestand', s: 'label' }, J8: { f: '=B3+J6-J7', fmt: 'eur', s: 'label' }, I9: 'Buchungen', J9: { f: '=ANZAHL2(C6:C205)', fmt: 'int' } },
      cf: [{ range: 'G6:G205', type: 'lt', v1: '0', style: 'red' }, { range: 'J8', type: 'lt', v1: '0', style: 'red' }],
      dv: [{ range: 'D6:E205', type: 'decimal', op: 'greaterThanOrEqual', v1: '0', error: 'Beträge positiv eintragen – Ausgaben in die Spalte „Ausgabe“.' }],
      notes: { G5: 'Laufender Kassenbestand: Anfangsbestand + Einnahmen − Ausgaben.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 18 ------------------------------------------------------------ Aufgabenliste
  {
    id: 'aufgabenliste', title: 'Aufgabenliste', desc: 'Aufgaben mit Priorität, Fälligkeit und Status – Überfälliges wird rot', cat: 'Arbeit', accent: 'indigo',
    keywords: 'todo aufgaben liste prioritäten fristen erledigt kanban',
    sheets: [{
      name: 'Aufgaben', cols: [260, 90, 100, 100, 130, 100, 220, 24, 140, 80], freeze: 3, autoFilter: 'A3:G103', start: 'A10',
      rows: [
        [{ v: 'Aufgabenliste', s: 'title' }],
        [{ v: 'Status „Erledigt“ streicht die Aufgabe durch. Überfällige offene Aufgaben werden rot, hohe Priorität gelb.', s: 'sub' }],
        [{ v: 'Aufgabe', s: 'head' }, { v: 'Priorität', s: 'head' }, { v: 'Fällig am', s: 'headR' }, { v: 'Status', s: 'head' }, { v: 'Verantwortlich', s: 'head' }, { v: 'Erledigt am', s: 'headR' }, { v: 'Notiz', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Angebot an Muster GmbH schicken', 'Hoch', -2, 'Offen', 'Anna'], ['Steuerunterlagen sortieren', 'Mittel', 10, 'In Arbeit', 'Ben'], ['Website-Texte prüfen', 'Niedrig', 21, 'Offen', 'Carla'],
          ['Team-Meeting vorbereiten', 'Hoch', 1, 'Wartet', 'Deniz'], ['Rechnungen ablegen', 'Mittel', -5, 'Erledigt', 'Anna']]
          .map(([a, p, d, s, w]) => [a, p, { date: 'today', add: d, fmt: 'date' }, s, w, s === 'Erledigt' ? { date: 'today', add: -4, fmt: 'date' } : { v: null, fmt: 'date' }]),
        { repeat: 95, cells: [null, null, { v: null, fmt: 'date' }, null, null, { v: null, fmt: 'date' }] },
      ],
      patch: {
        I4: 'Offen', J4: { f: '=ZÄHLENWENNS(A4:A103;"<>";D4:D103;"<>Erledigt")', fmt: 'int' }, I5: 'Davon überfällig', J5: { f: '=ZÄHLENWENNS(A4:A103;"<>";D4:D103;"<>Erledigt";C4:C103;"<"&HEUTE())', fmt: 'int' },
        I6: 'Erledigt', J6: { f: '=ZÄHLENWENN(D4:D103;"Erledigt")', fmt: 'int' }, I7: { v: 'Fortschritt', s: 'label' }, J7: { f: '=WENN(J4+J6=0;0;J6/(J4+J6))', fmt: 'pct0', s: 'label' },
      },
      dv: [{ range: 'B4:B103', list: ['Hoch', 'Mittel', 'Niedrig'] }, { range: 'D4:D103', list: ['Offen', 'In Arbeit', 'Wartet', 'Erledigt'] }],
      cf: [
        { range: 'B4:B103', type: 'eq', v1: 'Hoch', style: 'yellow' },
        { range: 'A4:G103', type: 'formula', f: '=UND($A4<>"";$D4<>"Erledigt";$C4<>"";$C4<HEUTE())', style: 'red' },
        { range: 'A4:G103', type: 'formula', f: '=$D4="Erledigt"', style: 'done' },
        { range: 'J5', type: 'gt', v1: '0', style: 'red' }, { range: 'J7', type: 'bar', bar: 'green' },
      ],
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 2, r2: 2 } },
    }],
  },
  // 19 ------------------------------------------------------------ Schichtplan
  {
    id: 'schichtplan', title: 'Schichtplan', desc: 'Wochenplan mit Früh-, Spät- und Nachtschicht, Stunden pro Person und Mindestbesetzung', cat: 'Arbeit', accent: 'blue',
    keywords: 'schicht dienstplan früh spät nacht besetzung woche personal',
    sheets: [{
      name: 'Schichtplan', cols: [150, 62, 62, 62, 62, 62, 62, 62, 76, 80, 24, 64, 110, 70, 70, 84, 76, 110], freeze: 5, freezeC: 1, start: 'B6',
      rows: [
        [{ v: 'Schichtplan', s: 'title' }],
        [{ v: 'Je Tag ein Kürzel eintragen (F, S, N, U, K oder X). Stunden pro Person und die Besetzung jeder Schicht rechnen sich selbst.', s: 'sub' }],
        [{ v: 'Woche ab (Montag)', s: 'label' }, { date: 'week', s: 'input', fmt: 'date' }],
        [{ v: 'Mitarbeiter/in', s: 'head' }, ...['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => ({ v: d, s: 'headC' })), { v: 'Stunden', s: 'headR' }, { v: 'Schichten', s: 'headR' }, null,
          { v: 'Kürzel', s: 'headC' }, { v: 'Schicht', s: 'head' }, { v: 'Beginn', s: 'headR' }, { v: 'Ende', s: 'headR' }, { v: 'Pause (Min.)', s: 'headR' }, { v: 'Stunden', s: 'headR' }, { v: 'Mindestbesetzung', s: 'headR' }],
        [null, { f: '=$B$3', fmt: 'dm', s: ['small', 'center'] }, ...Array.from({ length: 6 }, (_, i) => ({ f: `=${String.fromCharCode(66 + i)}5+1`, fmt: 'dm', s: ['small', 'center'] }))],
        ...[['Anna Beispiel', 'F F F F F X X'], ['Ben Muster', 'S S S X X F F'], ['Carla Probe', 'N N X X S S S'], ['Deniz Test', 'X F F F F F X'], ['Emil Schmidt', 'S S S S X X N'],
          ['Fatma Yilmaz', 'F X N N N X X'], ['Greta Klein', 'U U U U U X X'], ['Hannes Wolf', 'X N S S N N F']].map(([n, plan], i) => {
          const r = 6 + i;
          return [n, ...plan.split(' ').map(x => ({ v: x, s: 'center' })), { f: `=ZÄHLENWENN(B${r}:H${r};$L$6)*$Q$6+ZÄHLENWENN(B${r}:H${r};$L$7)*$Q$7+ZÄHLENWENN(B${r}:H${r};$L$8)*$Q$8`, fmt: 'hours' },
            { f: `=ZÄHLENWENN(B${r}:H${r};$L$6)+ZÄHLENWENN(B${r}:H${r};$L$7)+ZÄHLENWENN(B${r}:H${r};$L$8)`, fmt: 'int' }];
        }),
        ...[14, 15].map(r => [null, ...Array.from({ length: 7 }, () => ({ v: null, s: 'center' })), { f: `=WENN(A${r}="";"";ZÄHLENWENN(B${r}:H${r};$L$6)*$Q$6+ZÄHLENWENN(B${r}:H${r};$L$7)*$Q$7+ZÄHLENWENN(B${r}:H${r};$L$8)*$Q$8)`, fmt: 'hours' },
          { f: `=WENN(A${r}="";"";ZÄHLENWENN(B${r}:H${r};$L$6)+ZÄHLENWENN(B${r}:H${r};$L$7)+ZÄHLENWENN(B${r}:H${r};$L$8))`, fmt: 'int' }]),
        [],
        ...[['Besetzung Früh (F)', 6], ['Besetzung Spät (S)', 7], ['Besetzung Nacht (N)', 8]].map(([t, lr]) => [{ v: t, s: 'label' }, ...Array.from({ length: 7 }, (_, i) => {
          const c = String.fromCharCode(66 + i);
          return { f: `=ZÄHLENWENN(${c}$6:${c}$15;$L$${lr})`, fmt: 'int', s: 'center' };
        })]),
      ],
      patch: {
        L6: { v: 'F', s: 'center' }, M6: 'Frühschicht', N6: { v: 0.25, s: 'input', fmt: 'time' }, O6: { v: 14 / 24, s: 'input', fmt: 'time' }, P6: { v: 30, s: 'input', fmt: 'int' }, Q6: { f: '=(WENN(O6<N6;O6+1;O6)-N6)*24-P6/60', fmt: 'hours' }, R6: { v: 2, s: 'input', fmt: 'int' },
        L7: { v: 'S', s: 'center' }, M7: 'Spätschicht', N7: { v: 14 / 24, s: 'input', fmt: 'time' }, O7: { v: 22 / 24, s: 'input', fmt: 'time' }, P7: { v: 30, s: 'input', fmt: 'int' }, Q7: { f: '=(WENN(O7<N7;O7+1;O7)-N7)*24-P7/60', fmt: 'hours' }, R7: { v: 2, s: 'input', fmt: 'int' },
        L8: { v: 'N', s: 'center' }, M8: 'Nachtschicht', N8: { v: 22 / 24, s: 'input', fmt: 'time' }, O8: { v: 0.25, s: 'input', fmt: 'time' }, P8: { v: 30, s: 'input', fmt: 'int' }, Q8: { f: '=(WENN(O8<N8;O8+1;O8)-N8)*24-P8/60', fmt: 'hours' }, R8: { v: 1, s: 'input', fmt: 'int' },
        L9: { v: 'U', s: 'center' }, M9: 'Urlaub', L10: { v: 'K', s: 'center' }, M10: 'Krank', L11: { v: 'X', s: 'center' }, M11: 'Frei',
      },
      dv: [{ range: 'B6:H15', list: ['F', 'S', 'N', 'U', 'K', 'X'], prompt: 'Kürzel aus der Legende rechts' }],
      cf: [
        { range: 'B6:H15', type: 'eq', v1: 'F', style: 'blue' }, { range: 'B6:H15', type: 'eq', v1: 'S', style: 'yellow' }, { range: 'B6:H15', type: 'eq', v1: 'N', style: 'strong' },
        { range: 'B6:H15', type: 'eq', v1: 'U', style: 'green' }, { range: 'B6:H15', type: 'eq', v1: 'K', style: 'red' },
        { range: 'B17:H17', type: 'formula', f: '=B17<$R$6', style: 'red' }, { range: 'B18:H18', type: 'formula', f: '=B18<$R$7', style: 'red' }, { range: 'B19:H19', type: 'formula', f: '=B19<$R$8', style: 'red' },
      ],
      notes: { Q5: 'Netto-Stunden einer Schicht: Ende minus Beginn (über Mitternacht gerechnet) minus Pause.', R5: 'Wie viele Personen mindestens in dieser Schicht sein sollen – zu wenig wird unten rot.' },
      page: { orient: 'landscape', fit: 'width' },
    }],
  },
  // 20 ------------------------------------------------------------ Geburtstagskalender
  {
    id: 'geburtstagskalender', title: 'Geburtstagskalender', desc: 'Geburtstage mit Alter, Countdown und Monatsübersicht – die nächsten werden markiert', cat: 'Zuhause', accent: 'rose',
    keywords: 'geburtstag geburtstage kalender erinnerung familie freunde alter',
    sheets: [{
      name: 'Geburtstage', cols: [170, 110, 100, 70, 110, 80, 76, 200, 24, 190, 100], freeze: 4, autoFilter: 'A4:H204', start: 'A13',
      rows: [
        [{ v: 'Geburtstagskalender', s: 'title' }],
        [{ v: 'Name und Geburtsdatum eintragen. Wer in den nächsten 14 Tagen Geburtstag hat, wird grün – heute ist kräftig markiert.', s: 'sub' }],
        [],
        [{ v: 'Name', s: 'head' }, { v: 'Gruppe', s: 'head' }, { v: 'Geburtsdatum', s: 'headR' }, { v: 'Wird', s: 'headR' }, { v: 'Nächster Geburtstag', s: 'headR' }, { v: 'In Tagen', s: 'headR' }, { v: 'Wochentag', s: 'headC' }, { v: 'Geschenkidee / Notiz', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Oma Hilde', 'Familie', 9, -84, 'Fotobuch vom Sommer'], ['Jonas Beispiel', 'Freunde', 3, -31, ''], ['Lena Probe', 'Arbeit', 40, -29, 'Kuchen fürs Team'], ['Mia Muster', 'Familie', 120, -7, 'Puzzle ab 6 Jahren'],
          ['Tim Test', 'Verein', 200, -45, ''], ['Papa', 'Familie', 0, -62, 'Anrufen!'], ['Sara Klein', 'Freunde', 75, -36, ''], ['Herr Wolf (Nachbar)', 'Nachbarn', 300, -71, 'Karte einwerfen']]
          .map(([n, g, add, yrs, note], i) => {
            const r = 5 + i;
            return [n, g, { date: 'today', add, years: yrs, fmt: 'date' }, { f: `=WENN(C${r}="";"";JAHR(E${r})-JAHR(C${r}))`, fmt: 'int' },
              { f: `=WENN(C${r}="";"";DATUM(JAHR(HEUTE())+(DATUM(JAHR(HEUTE());MONAT(C${r});TAG(C${r}))<HEUTE());MONAT(C${r});TAG(C${r})))`, fmt: 'date' },
              { f: `=WENN(E${r}="";"";E${r}-HEUTE())`, fmt: 'int' }, { f: `=WENN(E${r}="";"";WAHL(WOCHENTAG(E${r};2);"Mo";"Di";"Mi";"Do";"Fr";"Sa";"So"))`, s: 'center' }, note];
          }),
        { repeat: 192, cells: [null, null, { v: null, fmt: 'date' }, { f: '=WENN(C{r}="";"";JAHR(E{r})-JAHR(C{r}))', fmt: 'int' },
          { f: '=WENN(C{r}="";"";DATUM(JAHR(HEUTE())+(DATUM(JAHR(HEUTE());MONAT(C{r});TAG(C{r}))<HEUTE());MONAT(C{r});TAG(C{r})))', fmt: 'date' },
          { f: '=WENN(E{r}="";"";E{r}-HEUTE())', fmt: 'int' }, { f: '=WENN(E{r}="";"";WAHL(WOCHENTAG(E{r};2);"Mo";"Di";"Mi";"Do";"Fr";"Sa";"So"))', s: 'center' }] },
      ],
      patch: {
        J5: 'Als Nächstes', K5: { f: '=WENN(ANZAHL(F5:F204)=0;"";INDEX(A5:A204;VERGLEICH(MIN(F5:F204);F5:F204;0)))', s: 'label' },
        J6: 'In den nächsten 30 Tagen', K6: { f: '=ZÄHLENWENNS(F5:F204;">=0";F5:F204;"<=30")', fmt: 'int' }, J7: 'Einträge', K7: { f: '=ANZAHL2(A5:A204)', fmt: 'int' },
        J9: { v: 'Monat', s: 'head' }, K9: { v: 'Geburtstage', s: 'headR' },
        ...Object.fromEntries(['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
          .flatMap((m, i) => [[`J${10 + i}`, m], [`K${10 + i}`, { f: `=SUMMENPRODUKT((C$5:C$204<>"")*(MONAT(C$5:C$204)=${i + 1}))`, fmt: 'int' }]])),
      },
      dv: [{ range: 'B5:B204', list: ['Familie', 'Freunde', 'Arbeit', 'Verein', 'Nachbarn', 'Sonstige'] }],
      cf: [
        { range: 'A5:H204', type: 'formula', f: '=UND($F5<>"";$F5=0)', style: 'strong' },
        { range: 'A5:H204', type: 'formula', f: '=UND($F5<>"";$F5>0;$F5<=14)', style: 'green' },
        { range: 'K10:K21', type: 'bar', bar: 'red' },
      ],
      charts: [{ type: 'col', range: 'J9:K21', title: 'Geburtstage pro Monat', at: 'M4', w: 420, h: 260, legend: 'n' }],
      notes: { D4: 'Alter, das die Person am nächsten Geburtstag erreicht.', F4: '0 = heute.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 21 ------------------------------------------------------------ Hochzeitsbudget
  {
    id: 'hochzeitsbudget', title: 'Hochzeitsplaner – Budget', desc: 'Kosten der Hochzeit planen: Angebote, Anzahlungen, offene Beträge und Kosten pro Gast', cat: 'Finanzen', accent: 'rose',
    keywords: 'hochzeit heirat budget planung kosten gäste feier anzahlung',
    sheets: [{
      name: 'Budget', cols: [210, 150, 104, 104, 104, 104, 100, 96, 190, 104, 24, 160, 104, 76], freeze: 7, start: 'B3',
      rows: [
        [{ v: 'Hochzeitsplaner – Budget', s: 'title' }],
        [{ v: 'Plan eintragen, später das Angebot ergänzen. „Ansatz“ nimmt das Angebot, solange keins da ist den Plan.', s: 'sub' }],
        [{ v: 'Gesamtbudget', s: 'label' }, { v: 15000, s: 'input', fmt: 'eur' }, null, { v: 'Ansatz gesamt', s: 'label' }, { f: '=SUMME(J8:J80)', fmt: 'eur' }, null, { v: 'Bezahlt', s: 'label' }, { f: '=SUMME(E8:E80)', fmt: 'eur' }],
        [{ v: 'Gäste', s: 'label' }, { v: 60, s: 'input', fmt: 'int' }, null, { v: 'Pro Gast', s: 'label' }, { f: '=WENN(B4>0;E3/B4;"")', fmt: 'eur' }, null, { v: 'Noch zu zahlen', s: 'label' }, { f: '=E3-H3', fmt: 'eur' }],
        [{ v: 'Übrig vom Budget', s: 'big' }, { f: '=B3-E3', s: 'big', fmt: 'eurRed' }],
        [],
        [{ v: 'Posten', s: 'head' }, { v: 'Kategorie', s: 'head' }, { v: 'Geplant', s: 'headR' }, { v: 'Angebot / Ist', s: 'headR' }, { v: 'Bezahlt', s: 'headR' }, { v: 'Rest offen', s: 'headR' }, { v: 'Fällig am', s: 'headR' }, { v: 'Status', s: 'head' }, { v: 'Notiz', s: 'head' }, { v: 'Ansatz', s: 'headR' }, null, { v: 'Kategorie', s: 'head' }, { v: 'Ansatz', s: 'headR' }, { v: 'Anteil', s: 'headR' }],
        ...[['Location & Miete', 'Location', 3500, 3800, 1000, 40, 'Gebucht'], ['Essen & Getränke', 'Essen & Getränke', 5400, null, 0, 60, 'Angefragt'], ['Brautkleid & Anzug', 'Kleidung', 1800, 1650, 1650, null, 'Bezahlt'],
          ['Fotografin', 'Fotografie', 1600, 1750, 500, 20, 'Gebucht'], ['DJ', 'Musik', 900, null, 0, 30, 'Offen'], ['Blumen & Deko', 'Deko & Blumen', 800, null, 0, 14, 'Offen'], ['Eheringe', 'Ringe', 1200, 1090, 1090, null, 'Bezahlt'],
          ['Einladungen & Karten', 'Papeterie', 250, 210, 210, null, 'Bezahlt'], ['Standesamt-Gebühren', 'Sonstiges', 120, null, 0, 10, 'Offen'], ['Hochzeitstorte', 'Essen & Getränke', 450, null, 0, 50, 'Angefragt']]
          .map(([p, k, plan, ist, paid, due, st], i) => {
            const r = 8 + i;
            return [p, k, { v: plan, fmt: 'eur' }, { v: ist, fmt: 'eur' }, { v: paid, fmt: 'eur' }, { f: `=WENN(J${r}="";"";J${r}-E${r})`, fmt: 'eurRed' }, due == null ? { v: null, fmt: 'date' } : { date: 'today', add: due, fmt: 'date' }, st, '',
              { f: `=WENN(UND(C${r}="";D${r}="");"";WENN(D${r}<>"";D${r};C${r}))`, fmt: 'eur' }];
          }),
        { repeat: 63, cells: [null, null, { v: null, fmt: 'eur' }, { v: null, fmt: 'eur' }, { v: null, fmt: 'eur' }, { f: '=WENN(J{r}="";"";J{r}-E{r})', fmt: 'eurRed' }, { v: null, fmt: 'date' }, null, null, { f: '=WENN(UND(C{r}="";D{r}="");"";WENN(D{r}<>"";D{r};C{r}))', fmt: 'eur' }] },
      ],
      patch: Object.fromEntries(['Location', 'Essen & Getränke', 'Kleidung', 'Fotografie', 'Musik', 'Deko & Blumen', 'Ringe', 'Papeterie', 'Sonstiges']
        .flatMap((k, i) => [[`L${8 + i}`, k], [`M${8 + i}`, { f: `=SUMMEWENN($B$8:$B$80;L${8 + i};$J$8:$J$80)`, fmt: 'eur' }], [`N${8 + i}`, { f: `=WENN($E$3=0;"";M${8 + i}/$E$3)`, fmt: 'pct' }]])),
      dv: [{ range: 'B8:B80', src: '$L$8:$L$16' }, { range: 'H8:H80', list: ['Offen', 'Angefragt', 'Gebucht', 'Bezahlt'] }],
      cf: [
        { range: 'B5', type: 'lt', v1: '0', style: 'red' }, { range: 'B5', type: 'ge', v1: '0', style: 'green' },
        { range: 'A8:J80', type: 'formula', f: '=UND($G8<>"";$G8<HEUTE();$F8>0)', style: 'red' },
        { range: 'H8:H80', type: 'eq', v1: 'Bezahlt', style: 'done' }, { range: 'N8:N16', type: 'bar', bar: 'red' },
      ],
      charts: [{ type: 'bar', range: 'L7:L16', valuesCol: 'M', title: 'Ansatz nach Kategorie', at: 'L19', w: 420, h: 300, legend: 'n' }],
      notes: { J7: 'Nimmt das Angebot (Spalte D); solange keins eingetragen ist, den geplanten Betrag.', G7: 'Fällige Posten mit offenem Rest werden rot.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 7, r2: 7 } },
    }],
  },
  // 22 ------------------------------------------------------------ Umzugscheckliste
  {
    id: 'umzugscheckliste', title: 'Umzugscheckliste', desc: 'Alle Aufgaben rund um den Umzug mit Termin ab Umzugstag, Fortschritt und Überfälligem in Rot', cat: 'Zuhause', accent: 'amber',
    keywords: 'umzug checkliste wohnung ummelden nachsendeauftrag kartons aufgaben',
    sheets: [{
      name: 'Umzug', cols: [300, 90, 100, 76, 110, 200, 24, 200, 90], freeze: 5, autoFilter: 'A5:F80', start: 'D6',
      rows: [
        [{ v: 'Umzugscheckliste', s: 'title' }],
        [{ v: 'Umzugstag eintragen – jede Aufgabe bekommt ihr Datum. Negative Wochen bedeuten: nach dem Umzug.', s: 'sub' }],
        [{ v: 'Umzugstag', s: 'label' }, { date: 'today', add: 60, s: 'input', fmt: 'date' }],
        [],
        [{ v: 'Aufgabe', s: 'head' }, { v: 'Wochen vorher', s: 'headR' }, { v: 'Fällig am', s: 'headR' }, { v: 'Erledigt', s: 'headC' }, { v: 'Wer', s: 'head' }, { v: 'Notiz', s: 'head' }, null, { v: 'Fortschritt', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Mietvertrag der alten Wohnung kündigen (Frist prüfen)', 13, 'Ja'], ['Angebote von Umzugsfirmen einholen oder Transporter reservieren', 10, 'Ja'], ['Urlaub für die Umzugstage beantragen', 8, 'Ja'],
          ['Halteverbotszone bei der Stadt beantragen', 4, ''], ['Kartons, Klebeband und Polstermaterial besorgen', 6, ''], ['Sperrmüll anmelden und Ausmisten', 6, ''], ['Nachsendeauftrag einrichten', 3, ''],
          ['Strom und Gas: Umzug melden oder Vertrag kündigen', 4, ''], ['Internetanschluss umziehen (Vorlaufzeit beachten)', 6, ''], ['Helferinnen und Helfer organisieren', 3, ''],
          ['Kita, Schule, Ärzte über den Umzug informieren', 3, ''], ['Termin für die Wohnungsübergabe vereinbaren', 2, ''], ['Kühlschrank abtauen, Lebensmittel aufbrauchen', 0.3, ''],
          ['Zählerstände in alter und neuer Wohnung ablesen (Fotos)', 0, ''], ['Übergabeprotokoll unterschreiben, Schlüssel übergeben', 0, ''], ['Wohnsitz beim Bürgeramt ummelden (innerhalb von zwei Wochen)', -1, ''],
          ['Neue Adresse an Bank, Versicherungen, Arbeitgeber, Krankenkasse', -1, ''], ['Adresse im Fahrzeugschein ändern lassen', -2, ''], ['Rundfunkbeitrag: Adresse ändern', -2, ''], ['Kaution der alten Wohnung im Blick behalten', -8, '']]
          .map(([a, w, done], i) => { const r = 6 + i; return [a, { v: w, fmt: 'dec1' }, { f: `=WENN(B${r}="";"";$B$3-B${r}*7)`, fmt: 'date' }, { v: done, s: 'center' }]; }),
        { repeat: 55, cells: [null, { v: null, fmt: 'dec1' }, { f: '=WENN(B{r}="";"";$B$3-B{r}*7)', fmt: 'date' }, { v: null, s: 'center' }] },
      ],
      patch: {
        H6: 'Aufgaben', I6: { f: '=ANZAHL2(A6:A80)', fmt: 'int' }, H7: 'Erledigt', I7: { f: '=ZÄHLENWENN(D6:D80;"Ja")', fmt: 'int' },
        H8: 'Offen und überfällig', I8: { f: '=ZÄHLENWENNS(A6:A80;"<>";D6:D80;"<>Ja";C6:C80;"<"&HEUTE())', fmt: 'int' }, H9: { v: 'Fortschritt', s: 'label' }, I9: { f: '=WENN(I6=0;0;I7/I6)', fmt: 'pct0', s: 'label' },
        H10: 'Tage bis zum Umzug', I10: { f: '=B3-HEUTE()', fmt: 'int' },
      },
      dv: [{ range: 'D6:D80', list: ['Ja', 'Nein'] }],
      cf: [
        { range: 'A6:F80', type: 'formula', f: '=$D6="Ja"', style: 'done' },
        { range: 'A6:F80', type: 'formula', f: '=UND($A6<>"";$D6<>"Ja";$C6<>"";$C6<HEUTE())', style: 'red' },
        { range: 'I8', type: 'gt', v1: '0', style: 'red' }, { range: 'I9', type: 'bar', bar: 'green' },
      ],
      notes: { B5: 'Wie viele Wochen vor dem Umzugstag. 0 = am Umzugstag, −1 = eine Woche danach.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 5, r2: 5 } },
    }],
  },
  // 23 ------------------------------------------------------------ Putzplan
  {
    id: 'putzplan', title: 'Putzplan', desc: 'Aufgaben mit Rhythmus in Tagen – das nächste Mal rechnet sich selbst, Überfälliges wird rot', cat: 'Zuhause', accent: 'teal',
    keywords: 'putzen haushalt wg familie aufgaben rhythmus sauber plan',
    sheets: [{
      name: 'Putzplan', cols: [230, 120, 84, 110, 110, 90, 100, 180, 24, 180, 80], freeze: 4, autoFilter: 'A4:H64', start: 'D5',
      rows: [
        [{ v: 'Putzplan', s: 'title' }],
        [{ v: 'Nach dem Putzen nur „Zuletzt erledigt“ aktualisieren (Strg+. setzt das heutige Datum). Fällige Aufgaben werden gelb, überfällige rot.', s: 'sub' }],
        [],
        [{ v: 'Aufgabe', s: 'head' }, { v: 'Raum', s: 'head' }, { v: 'Alle … Tage', s: 'headR' }, { v: 'Zuletzt erledigt', s: 'headR' }, { v: 'Nächstes Mal', s: 'headR' }, { v: 'Fällig in', s: 'headR' }, { v: 'Wer', s: 'head' }, { v: 'Notiz', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Staubsaugen', 'Wohnung', 7, -3, 'Anna'], ['Bad putzen', 'Bad', 7, -8, 'Ben'], ['Küche wischen', 'Küche', 3, -1, 'Anna'], ['Bettwäsche wechseln', 'Schlafzimmer', 14, -10, 'Ben'],
          ['Müll rausbringen', 'Küche', 2, -2, 'Kinder'], ['Fenster putzen', 'Wohnung', 60, -40, 'Alle'], ['Kühlschrank auswischen', 'Küche', 30, -35, 'Anna'], ['Handtücher waschen', 'Bad', 7, -4, 'Ben'],
          ['Pflanzen gießen', 'Wohnung', 4, 0, 'Kinder'], ['Backofen reinigen', 'Küche', 45, -20, 'Ben'], ['Flur wischen', 'Flur', 7, -6, 'Kinder'], ['Entkalken (Kaffeemaschine)', 'Küche', 30, -12, 'Anna']]
          .map(([a, raum, n, last, wer], i) => { const r = 5 + i; return [a, raum, n, { date: 'today', add: last, fmt: 'date' }, { f: `=WENN(ODER(C${r}="";D${r}="");"";D${r}+C${r})`, fmt: 'date' }, { f: `=WENN(E${r}="";"";E${r}-HEUTE())`, fmt: 'int' }, wer]; }),
        { repeat: 48, cells: [null, null, null, { v: null, fmt: 'date' }, { f: '=WENN(ODER(C{r}="";D{r}="");"";D{r}+C{r})', fmt: 'date' }, { f: '=WENN(E{r}="";"";E{r}-HEUTE())', fmt: 'int' }] },
      ],
      patch: {
        J5: 'Überfällig', K5: { f: '=ZÄHLENWENN(F5:F64;"<0")', fmt: 'int' }, J6: 'Heute oder morgen fällig', K6: { f: '=ZÄHLENWENNS(F5:F64;">=0";F5:F64;"<=1")', fmt: 'int' },
        J8: { v: 'Wer', s: 'head' }, K8: { v: 'Aufgaben', s: 'headR' },
        ...Object.fromEntries(['Anna', 'Ben', 'Kinder', 'Alle'].flatMap((n, i) => [[`J${9 + i}`, { v: n, s: 'input' }], [`K${9 + i}`, { f: `=ZÄHLENWENN($G$5:$G$64;J${9 + i})`, fmt: 'int' }]])),
      },
      dv: [{ range: 'G5:G64', src: '$J$9:$J$12' }, { range: 'C5:C64', type: 'whole', op: 'greaterThan', v1: '0', error: 'Rhythmus in ganzen Tagen, z. B. 7 für wöchentlich.' }],
      cf: [
        { range: 'A5:H64', type: 'formula', f: '=UND($F5<>"";$F5<0)', style: 'red' },
        { range: 'A5:H64', type: 'formula', f: '=UND($F5<>"";$F5>=0;$F5<=1)', style: 'yellow' },
        { range: 'K5', type: 'gt', v1: '0', style: 'red' },
      ],
      notes: { C4: 'Rhythmus in Tagen: 1 = täglich, 7 = wöchentlich, 14 = alle zwei Wochen.', J9: 'Namen hier ändern – die Auswahlliste in Spalte „Wer“ passt sich an.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 24 ------------------------------------------------------------ Stromzähler-Verbrauch
  {
    id: 'stromzaehler', title: 'Stromzähler-Verbrauch', desc: 'Zählerstände erfassen: Verbrauch pro Tag, Hochrechnung aufs Jahr und Vergleich mit dem Abschlag', cat: 'Zuhause', accent: 'amber',
    keywords: 'strom zähler zählerstand verbrauch kwh abschlag nachzahlung energie',
    sheets: [{
      name: 'Zählerstände', cols: [100, 120, 100, 70, 90, 120, 110, 190, 24, 270, 110], freeze: 7, start: 'A15',
      rows: [
        [{ v: 'Stromzähler-Verbrauch', s: 'title' }],
        [{ v: 'Zählerstand ablesen und mit Datum eintragen. Preise aus der letzten Abrechnung übernehmen (gelbe Felder).', s: 'sub' }],
        [{ v: 'Arbeitspreis pro kWh', s: 'label' }, { v: 0.32, s: 'input', fmt: '#,##0.0000 "€"' }],
        [{ v: 'Grundpreis pro Monat', s: 'label' }, { v: 12.5, s: 'input', fmt: 'eur' }],
        [{ v: 'Abschlag pro Monat', s: 'label' }, { v: 85, s: 'input', fmt: 'eur' }],
        [],
        [{ v: 'Ablesedatum', s: 'head' }, { v: 'Zählerstand (kWh)', s: 'headR' }, { v: 'Verbrauch (kWh)', s: 'headR' }, { v: 'Tage', s: 'headR' }, { v: 'kWh pro Tag', s: 'headR' }, { v: 'Hochrechnung Jahr', s: 'headR' }, { v: 'Kosten Zeitraum', s: 'headR' }, { v: 'Notiz', s: 'head' }, null, { v: 'Auswertung', s: 'head' }, { v: '', s: 'headR' }],
        [{ date: 'month', months: -6, fmt: 'date' }, { v: 18240, fmt: 'num' }, null, null, null, null, null, 'Startwert'],
        ...[[-5, 18478], [-4, 18689], [-3, 18901], [-2, 19140], [-1, 19355], [0, 19590]].map(([m, kwh], i) => {
          const r = 9 + i;
          return [{ date: 'month', months: m, fmt: 'date' }, { v: kwh, fmt: 'num' }, { f: `=WENN(ODER(B${r}="";B${r - 1}="");"";B${r}-B${r - 1})`, fmt: 'num' }, { f: `=WENN(ODER(A${r}="";A${r - 1}="");"";A${r}-A${r - 1})`, fmt: 'int' },
            { f: `=WENN(ODER(C${r}="";D${r}="";D${r}=0);"";C${r}/D${r})`, fmt: 'dec2' }, { f: `=WENN(E${r}="";"";E${r}*365)`, fmt: 'num' }, { f: `=WENN(C${r}="";"";C${r}*$B$3+D${r}/365*12*$B$4)`, fmt: 'eur' }];
        }),
        { repeat: 100, cells: [{ v: null, fmt: 'date' }, { v: null, fmt: 'num' }, { f: '=WENN(ODER(B{r}="";B{r-1}="");"";B{r}-B{r-1})', fmt: 'num' }, { f: '=WENN(ODER(A{r}="";A{r-1}="");"";A{r}-A{r-1})', fmt: 'int' },
          { f: '=WENN(ODER(C{r}="";D{r}="";D{r}=0);"";C{r}/D{r})', fmt: 'dec2' }, { f: '=WENN(E{r}="";"";E{r}*365)', fmt: 'num' }, { f: '=WENN(C{r}="";"";C{r}*$B$3+D{r}/365*12*$B$4)', fmt: 'eur' }] },
      ],
      patch: {
        J8: 'Verbrauch gesamt (kWh)', K8: { f: '=WENN(ANZAHL(B8:B114)<2;"";MAX(B8:B114)-MIN(B8:B114))', fmt: 'num' },
        J9: 'Zeitraum (Tage)', K9: { f: '=WENN(ANZAHL(A8:A114)<2;"";MAX(A8:A114)-MIN(A8:A114))', fmt: 'int' },
        J10: 'Ø kWh pro Tag', K10: { f: '=WENN(ODER(K8="";K9="";K9=0);"";K8/K9)', fmt: 'dec2' },
        J11: 'Hochrechnung Jahr (kWh)', K11: { f: '=WENN(K10="";"";K10*365)', fmt: 'num' },
        J12: 'Hochrechnung Kosten pro Jahr', K12: { f: '=WENN(K11="";"";K11*B3+12*B4)', fmt: 'eur' },
        J13: 'Abschläge pro Jahr', K13: { f: '=12*B5', fmt: 'eur' },
        J14: { v: 'Nachzahlung (+) / Guthaben (−)', s: 'label' }, K14: { f: '=WENN(K12="";"";K12-K13)', fmt: 'eurRed', s: 'label' },
      },
      dv: [{ range: 'B8:B114', type: 'decimal', op: 'greaterThanOrEqual', v1: '0', error: 'Zählerstand in kWh, ohne Nachkommastellen reicht.' }],
      cf: [{ range: 'K14', type: 'gt', v1: '0', style: 'red' }, { range: 'K14', type: 'le', v1: '0', style: 'green' }, { range: 'E9:E114', type: 'bar', bar: 'orange' }],
      charts: [{ type: 'line', range: 'A7:A20', valuesCol: 'E', title: 'kWh pro Tag', at: 'J17', w: 420, h: 260, legend: 'n' }],
      notes: { F7: 'Verbrauch pro Tag × 365 – grobe Schätzung, im Winter ist der Verbrauch meist höher.', G7: 'Verbrauch × Arbeitspreis plus anteiliger Grundpreis für die Tage des Zeitraums.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 7, r2: 7 } },
    }],
  },
  // 25 ------------------------------------------------------------ Tankbuch
  {
    id: 'tankbuch', title: 'Tankbuch', desc: 'Tankstopps mit Liter, Preis und Kilometerstand – Verbrauch auf 100 km und Kosten pro 100 km', cat: 'Zuhause', accent: 'blue',
    keywords: 'tanken auto verbrauch liter benzin diesel spritkosten kilometer',
    sheets: [{
      name: 'Tankbuch', cols: [100, 110, 76, 96, 96, 96, 100, 110, 200, 24, 260, 110], freeze: 4, autoFilter: 'A4:I300', start: 'A12',
      rows: [
        [{ v: 'Tankbuch', s: 'title' }],
        [{ v: 'Immer volltanken und den Kilometerstand notieren – dann stimmt der Verbrauch. Der erste Eintrag ist der Startwert.', s: 'sub' }],
        [],
        [{ v: 'Datum', s: 'head' }, { v: 'Kilometerstand', s: 'headR' }, { v: 'Liter', s: 'headR' }, { v: 'Preis pro Liter', s: 'headR' }, { v: 'Betrag', s: 'headR' }, { v: 'Gefahrene km', s: 'headR' }, { v: 'l/100 km', s: 'headR' }, { v: 'Kosten/100 km', s: 'headR' }, { v: 'Tankstelle / Notiz', s: 'head' }, null, { v: 'Auswertung', s: 'head' }, { v: '', s: 'headR' }],
        [{ date: 'today', add: -60, fmt: 'date' }, { v: 48210, fmt: 'num' }, { v: 41.2, fmt: 'dec2' }, { v: 1.749, fmt: '#,##0.000 "€"' }, { f: '=WENN(ODER(C5="";D5="");"";RUNDEN(C5*D5;2))', fmt: 'eur' }, null, null, null, 'Startwert (vollgetankt)'],
        ...[[-46, 48842, 38.9, 1.729], [-31, 49455, 37.6, 1.789], [-17, 50101, 40.3, 1.699], [-4, 50710, 37.1, 1.759]].map(([d, km, l, p], i) => {
          const r = 6 + i;
          return [{ date: 'today', add: d, fmt: 'date' }, { v: km, fmt: 'num' }, { v: l, fmt: 'dec2' }, { v: p, fmt: '#,##0.000 "€"' }, { f: `=WENN(ODER(C${r}="";D${r}="");"";RUNDEN(C${r}*D${r};2))`, fmt: 'eur' },
            { f: `=WENN(ODER(B${r}="";B${r - 1}="");"";B${r}-B${r - 1})`, fmt: 'num' }, { f: `=WENN(ODER(F${r}="";C${r}="";F${r}=0);"";C${r}/F${r}*100)`, fmt: 'dec2' }, { f: `=WENN(ODER(F${r}="";E${r}="";F${r}=0);"";E${r}/F${r}*100)`, fmt: 'eur' }];
        }),
        { repeat: 290, cells: [{ v: null, fmt: 'date' }, { v: null, fmt: 'num' }, { v: null, fmt: 'dec2' }, { v: null, fmt: '#,##0.000 "€"' }, { f: '=WENN(ODER(C{r}="";D{r}="");"";RUNDEN(C{r}*D{r};2))', fmt: 'eur' },
          { f: '=WENN(ODER(B{r}="";B{r-1}="");"";B{r}-B{r-1})', fmt: 'num' }, { f: '=WENN(ODER(F{r}="";C{r}="";F{r}=0);"";C{r}/F{r}*100)', fmt: 'dec2' }, { f: '=WENN(ODER(F{r}="";E{r}="";F{r}=0);"";E{r}/F{r}*100)', fmt: 'eur' }] },
      ],
      patch: {
        K5: 'Gefahrene km gesamt', L5: { f: '=WENN(ANZAHL(B5:B300)<2;"";MAX(B5:B300)-MIN(B5:B300))', fmt: 'num' },
        K6: 'Liter (ohne Startwert)', L6: { f: '=SUMME(C6:C300)', fmt: 'dec2' },
        K7: { v: 'Ø Verbrauch l/100 km', s: 'label' }, L7: { f: '=WENN(ODER(L5="";L5=0);"";L6/L5*100)', fmt: 'dec2', s: 'label' },
        K8: 'Kosten (ohne Startwert)', L8: { f: '=SUMME(E6:E300)', fmt: 'eur' },
        K9: 'Ø Kosten pro 100 km', L9: { f: '=WENN(ODER(L5="";L5=0);"";L8/L5*100)', fmt: 'eur' },
        K10: 'Ø Preis pro Liter', L10: { f: '=WENN(SUMME(C5:C300)=0;"";SUMME(E5:E300)/SUMME(C5:C300))', fmt: '#,##0.000 "€"' },
      },
      dv: [{ range: 'C5:C300', type: 'decimal', op: 'greaterThan', v1: '0', error: 'Liter größer als 0.' }],
      cf: [{ range: 'G6:G300', type: 'scale', scale: 'gr' }],
      charts: [{ type: 'line', range: 'A4:A20', valuesCol: 'G', title: 'Verbrauch l/100 km', at: 'K13', w: 400, h: 250, legend: 'n' }],
      notes: { G4: 'Getankte Liter ÷ gefahrene km × 100. Stimmt nur, wenn jedes Mal vollgetankt wird.', F4: 'Kilometerstand minus Kilometerstand beim vorigen Tanken.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 26 ------------------------------------------------------------ Gewichtstagebuch
  {
    id: 'gewichtstagebuch', title: 'Gewichtstagebuch', desc: 'Gewicht mit Datum notieren: Veränderung, gleitender Durchschnitt und Verlauf – ohne Zielvorgaben', cat: 'Schule & Freizeit', accent: 'slate',
    keywords: 'gewicht tagebuch verlauf waage gesundheit protokoll durchschnitt',
    sheets: [{
      name: 'Gewicht', cols: [100, 104, 130, 130, 140, 220, 24, 200, 100], freeze: 4, start: 'A12',
      rows: [
        [{ v: 'Gewichtstagebuch', s: 'title' }],
        [{ v: 'Datum und Gewicht eintragen. Die Tabelle zeigt nur den Verlauf – ohne Zielwerte und ohne Bewertung.', s: 'sub' }],
        [],
        [{ v: 'Datum', s: 'head' }, { v: 'Gewicht', s: 'headR' }, { v: 'Seit letztem Eintrag', s: 'headR' }, { v: 'Seit Beginn', s: 'headR' }, { v: 'Ø letzte 7 Einträge', s: 'headR' }, { v: 'Notiz', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
        ...[[-20, 72.4], [-17, 72.1], [-14, 72.6], [-10, 71.9], [-7, 72.0], [-3, 71.6], [0, 71.8]].map(([d, kg], i) => {
          const r = 5 + i;
          return [{ date: 'today', add: d, fmt: 'date' }, { v: kg, fmt: 'kg' }, i === 0 ? null : { f: `=WENN(ODER(B${r}="";B${r - 1}="");"";B${r}-B${r - 1})`, fmt: '+0.0 "kg";-0.0 "kg";0.0 "kg"' },
            { f: `=WENN(B${r}="";"";B${r}-$B$5)`, fmt: '+0.0 "kg";-0.0 "kg";0.0 "kg"' }, { f: `=WENN(B${r}="";"";MITTELWERT(B${Math.max(5, r - 6)}:B${r}))`, fmt: 'kg' }];
        }),
        { repeat: 360, cells: [{ v: null, fmt: 'date' }, { v: null, fmt: 'kg' }, { f: '=WENN(ODER(B{r}="";B{r-1}="");"";B{r}-B{r-1})', fmt: '+0.0 "kg";-0.0 "kg";0.0 "kg"' },
          { f: '=WENN(B{r}="";"";B{r}-$B$5)', fmt: '+0.0 "kg";-0.0 "kg";0.0 "kg"' }, { f: '=WENN(B{r}="";"";MITTELWERT(B{r-6}:B{r}))', fmt: 'kg' }] },
      ],
      patch: {
        H5: 'Einträge', I5: { f: '=ANZAHL(B5:B371)', fmt: 'int' }, H6: 'Erster Wert', I6: { f: '=WENN(B5="";"";B5)', fmt: 'kg' },
        H7: 'Letzter Wert', I7: { f: '=WENN(ANZAHL(B5:B371)=0;"";INDEX(B5:B371;ANZAHL(B5:B371)))', fmt: 'kg' },
        H8: 'Veränderung gesamt', I8: { f: '=WENN(ODER(I6="";I7="");"";I7-I6)', fmt: '+0.0 "kg";-0.0 "kg";0.0 "kg"' },
        H9: 'Niedrigster Wert', I9: { f: '=WENN(I5=0;"";MIN(B5:B371))', fmt: 'kg' }, H10: 'Höchster Wert', I10: { f: '=WENN(I5=0;"";MAX(B5:B371))', fmt: 'kg' },
      },
      dv: [{ range: 'B5:B371', type: 'decimal', op: 'between', v1: '1', v2: '500', error: 'Gewicht in kg, z. B. 71,8.' }],
      charts: [{ type: 'line', range: 'A4:B11', title: 'Verlauf', at: 'H13', w: 420, h: 260, legend: 'n' }],
      notes: { E4: 'Durchschnitt der letzten sieben Einträge – glättet Tagesschwankungen.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 27 ------------------------------------------------------------ Lesetagebuch
  {
    id: 'lesetagebuch', title: 'Lesetagebuch', desc: 'Gelesene Bücher mit Seiten, Lesedauer, Seiten pro Tag und Bewertung – plus Jahresbilanz', cat: 'Schule & Freizeit', accent: 'teal',
    keywords: 'lesen bücher buch leseliste lesetagebuch schule bewertung',
    sheets: [{
      name: 'Bücher', cols: [230, 150, 100, 64, 96, 96, 80, 84, 84, 220, 24, 200, 80], freeze: 4, autoFilter: 'A4:J204', start: 'A11',
      rows: [
        [{ v: 'Lesetagebuch', s: 'title' }],
        [{ v: 'Buch eintragen, wenn du anfängst – „Beendet“ ergänzen, wenn du durch bist. Bewertung von 1 (naja) bis 5 (großartig).', s: 'sub' }],
        [],
        [{ v: 'Titel', s: 'head' }, { v: 'Autor/in', s: 'head' }, { v: 'Genre', s: 'head' }, { v: 'Seiten', s: 'headR' }, { v: 'Begonnen', s: 'headR' }, { v: 'Beendet', s: 'headR' }, { v: 'Tage', s: 'headR' }, { v: 'Seiten/Tag', s: 'headR' }, { v: 'Bewertung', s: 'headC' }, { v: 'Notiz / Lieblingszitat', s: 'head' }, null, { v: 'Bilanz', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Der Leuchtturm am Ende der Bucht', 'Mara Beispiel', 'Roman', 412, -70, -52, 4], ['Kalte Spur im Hafenviertel', 'Jan Probe', 'Krimi', 288, -50, -41, 3], ['Wie Bäume miteinander reden', 'Dr. Lea Muster', 'Sachbuch', 236, -40, -22, 5],
          ['Die Karte der verlorenen Städte', 'K. Test', 'Fantasy', 530, -21, null, null]].map(([t, a, g, p, b, e, rate], i) => {
          const r = 5 + i;
          return [t, a, g, p, { date: 'today', add: b, fmt: 'date' }, e == null ? { v: null, fmt: 'date' } : { date: 'today', add: e, fmt: 'date' }, { f: `=WENN(ODER(E${r}="";F${r}="");"";F${r}-E${r}+1)`, fmt: 'int' },
            { f: `=WENN(ODER(D${r}="";G${r}="");"";D${r}/G${r})`, fmt: 'dec1' }, rate == null ? { v: null, s: 'center' } : { v: rate, s: 'center' }];
        }),
        { repeat: 196, cells: [null, null, null, null, { v: null, fmt: 'date' }, { v: null, fmt: 'date' }, { f: '=WENN(ODER(E{r}="";F{r}="");"";F{r}-E{r}+1)', fmt: 'int' }, { f: '=WENN(ODER(D{r}="";G{r}="");"";D{r}/G{r})', fmt: 'dec1' }, { v: null, s: 'center' }] },
      ],
      patch: {
        L5: 'Bücher dieses Jahr', M5: { f: '=ZÄHLENWENNS(F5:F204;">="&DATUM(JAHR(HEUTE());1;1))', fmt: 'int' },
        L6: 'Seiten dieses Jahr', M6: { f: '=SUMMEWENNS(D5:D204;F5:F204;">="&DATUM(JAHR(HEUTE());1;1))', fmt: 'num' },
        L7: 'Bücher insgesamt', M7: { f: '=ANZAHL(F5:F204)', fmt: 'int' }, L8: 'Gerade am Lesen', M8: { f: '=ANZAHL(E5:E204)-ANZAHL(F5:F204)', fmt: 'int' },
        L9: 'Ø Bewertung', M9: { f: '=WENN(ANZAHL(I5:I204)=0;"";MITTELWERT(I5:I204))', fmt: 'dec1' },
        L11: { v: 'Genre', s: 'head' }, M11: { v: 'Bücher', s: 'headR' },
        ...Object.fromEntries(['Roman', 'Krimi', 'Sachbuch', 'Fantasy', 'Biografie', 'Kinder- & Jugendbuch', 'Comic', 'Sonstiges'].flatMap((g, i) => [[`L${12 + i}`, g], [`M${12 + i}`, { f: `=ZÄHLENWENN($C$5:$C$204;L${12 + i})`, fmt: 'int' }]])),
      },
      dv: [{ range: 'C5:C204', src: '$L$12:$L$19' }, { range: 'I5:I204', type: 'whole', op: 'between', v1: '1', v2: '5', error: 'Bewertung von 1 bis 5.' }],
      cf: [{ range: 'I5:I204', type: 'icons', icons: 'flags' }, { range: 'A5:J204', type: 'formula', f: '=UND($E5<>"";$F5="")', style: 'yellow' }, { range: 'M12:M19', type: 'bar', bar: 'green' }],
      notes: { G4: 'Lesedauer in Tagen, Start- und Endtag mitgezählt.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 28 ------------------------------------------------------------ Haushaltsübersicht Familie
  {
    id: 'familienbudget', title: 'Haushaltsübersicht Familie', desc: 'Einnahmen und Kosten mit Rhythmus (monatlich bis jährlich) auf den Monat umgerechnet – inkl. Kosten pro Kind', cat: 'Finanzen', accent: 'green',
    keywords: 'familie haushalt fixkosten kinder budget monat jahr übersicht',
    sheets: [{
      name: 'Familie', cols: [210, 130, 100, 120, 100, 104, 120, 180, 24, 200, 104], freeze: 4, autoFilter: 'A4:H80', start: 'C5',
      rows: [
        [{ v: 'Haushaltsübersicht Familie', s: 'title' }],
        [{ v: 'Jeden Posten mit Betrag und Rhythmus eintragen – die Tabelle rechnet alles auf einen Monat und ein Jahr um. Beispielwerte überschreiben.', s: 'sub' }],
        [],
        [{ v: 'Posten', s: 'head' }, { v: 'Bereich', s: 'head' }, { v: 'Betrag', s: 'headR' }, { v: 'Rhythmus', s: 'head' }, { v: 'Pro Monat', s: 'headR' }, { v: 'Pro Jahr', s: 'headR' }, { v: 'Konto / Wer', s: 'head' }, { v: 'Notiz', s: 'head' }, null, { v: 'Rhythmus', s: 'head' }, { v: 'Zahlungen pro Jahr', s: 'headR' }],
        ...[['Gehalt Partner/in 1', 'Einnahmen', 2900, 'monatlich'], ['Gehalt Partner/in 2', 'Einnahmen', 1400, 'monatlich'], ['Kindergeld', 'Einnahmen', 510, 'monatlich'],
          ['Miete warm', 'Fixkosten', 1150, 'monatlich'], ['Strom', 'Fixkosten', 95, 'monatlich'], ['Handy & Internet', 'Fixkosten', 70, 'monatlich'], ['Kfz-Versicherung', 'Fixkosten', 480, 'jährlich'],
          ['Haftpflicht & Hausrat', 'Fixkosten', 140, 'jährlich'], ['Rundfunkbeitrag', 'Fixkosten', 55.08, 'vierteljährlich'], ['Lebensmittel & Drogerie', 'Variable Kosten', 780, 'monatlich'],
          ['Tanken & Bus', 'Variable Kosten', 160, 'monatlich'], ['Kita-Beitrag', 'Kinder', 180, 'monatlich'], ['Sportverein Kinder', 'Kinder', 120, 'halbjährlich'], ['Kleidung Kinder', 'Kinder', 600, 'jährlich'],
          ['Taschengeld', 'Kinder', 40, 'monatlich'], ['Notgroschen', 'Sparen', 150, 'monatlich'], ['Urlaubskasse', 'Sparen', 1800, 'jährlich']]
          .map(([p, b, v, rh], i) => { const r = 5 + i; return [p, b, { v, fmt: 'eur' }, rh, { f: `=WENN(F${r}="";"";F${r}/12)`, fmt: 'eur' }, { f: `=WENN(ODER(C${r}="";D${r}="");"";C${r}*SVERWEIS(D${r};$J$5:$K$8;2;FALSCH))`, fmt: 'eur' }]; }),
        { repeat: 59, cells: [null, null, { v: null, fmt: 'eur' }, null, { f: '=WENN(F{r}="";"";F{r}/12)', fmt: 'eur' }, { f: '=WENN(ODER(C{r}="";D{r}="");"";C{r}*SVERWEIS(D{r};$J$5:$K$8;2;FALSCH))', fmt: 'eur' }] },
      ],
      patch: {
        J5: 'monatlich', K5: { v: 12, fmt: 'int' }, J6: 'vierteljährlich', K6: { v: 4, fmt: 'int' }, J7: 'halbjährlich', K7: { v: 2, fmt: 'int' }, J8: 'jährlich', K8: { v: 1, fmt: 'int' },
        J10: { v: 'Pro Monat', s: 'head' }, K10: { v: '', s: 'headR' },
        ...Object.fromEntries(['Einnahmen', 'Fixkosten', 'Variable Kosten', 'Kinder', 'Sparen'].flatMap((b, i) => [[`J${11 + i}`, b], [`K${11 + i}`, { f: `=SUMMEWENN($B$5:$B$80;J${11 + i};$E$5:$E$80)`, fmt: 'eur' }]])),
        J16: { v: 'Bleibt übrig', s: 'total' }, K16: { f: '=K11-SUMME(K12:K15)', fmt: 'eurRed', s: 'total' },
        J18: 'Anzahl Kinder', K18: { v: 2, s: 'input', fmt: 'int' }, J19: 'Kinderkosten pro Kind und Monat', K19: { f: '=WENN(K18>0;K14/K18;"")', fmt: 'eur' },
        J20: 'Sparquote', K20: { f: '=WENN(K11>0;K15/K11;"")', fmt: 'pct' },
      },
      dv: [{ range: 'B5:B80', src: '$J$11:$J$15' }, { range: 'D5:D80', src: '$J$5:$J$8' }],
      cf: [{ range: 'K16', type: 'lt', v1: '0', style: 'red' }, { range: 'K16', type: 'ge', v1: '0', style: 'green' }, { range: 'A5:H80', type: 'formula', f: '=$B5="Einnahmen"', custom: { color: '#1E6B3A' } }],
      charts: [{ type: 'bar', range: 'J10:J15', valuesCol: 'K', title: 'Pro Monat nach Bereich', at: 'J23', w: 400, h: 260, legend: 'n' }],
      notes: { E4: 'Jahresbetrag geteilt durch 12 – so siehst du auch Jahreszahlungen als Monatsanteil.', D4: 'Wie oft der Betrag fällig ist.' },
      page: { orient: 'portrait', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 29 ------------------------------------------------------------ Kassenbericht Verein
  {
    id: 'vereinskasse', title: 'Kassenbericht Verein', desc: 'Buchungen für Kasse und Bank, Jahresbericht nach Bereichen mit Anfangs- und Endbestand', cat: 'Verein', accent: 'green',
    keywords: 'verein kasse kassenbericht kassenwart jahresabschluss mitgliederversammlung kassenprüfung',
    sheets: [
      {
        name: 'Kassenbericht', cols: [230, 110, 110, 110, 24, 200], start: 'B3',
        rows: [
          [{ v: 'Kassenbericht', s: 'title' }],
          [{ v: 'Geschäftsjahr und Anfangsbestände eintragen; alles Weitere kommt aus dem Blatt „Buchungen“.', s: 'sub' }],
          [{ v: 'Geschäftsjahr', s: 'label' }, { f: '=JAHR(HEUTE())', s: 'input', fmt: 'int' }],
          [{ v: 'Anfangsbestand Kasse', s: 'label' }, { v: 312.4, s: 'input', fmt: 'eur' }],
          [{ v: 'Anfangsbestand Bank', s: 'label' }, { v: 4870.15, s: 'input', fmt: 'eur' }],
          [],
          [{ v: 'Bereich', s: 'head' }, { v: 'Einnahmen', s: 'headR' }, { v: 'Ausgaben', s: 'headR' }, { v: 'Saldo', s: 'headR' }],
          ...['Mitgliedsbeiträge', 'Spenden', 'Veranstaltungen', 'Zuschüsse', 'Verkauf & Bewirtung', 'Miete & Räume', 'Material & Ausstattung', 'Versicherungen & Gebühren', 'Porto, Büro & Bank', 'Sonstiges'].map((b, i) => {
            const r = 8 + i;
            const yr = 'Buchungen!$A$5:$A$400;">="&DATUM($B$3;1;1);Buchungen!$A$5:$A$400;"<="&DATUM($B$3;12;31)';
            return [b, { f: `=SUMMEWENNS(Buchungen!$F$5:$F$400;Buchungen!$D$5:$D$400;A${r};${yr})`, fmt: 'eur' }, { f: `=SUMMEWENNS(Buchungen!$G$5:$G$400;Buchungen!$D$5:$D$400;A${r};${yr})`, fmt: 'eur' }, { f: `=B${r}-C${r}`, fmt: 'eurRed' }];
          }),
          [{ v: 'Summe', s: 'total' }, { f: '=SUMME(B8:B17)', s: 'total', fmt: 'eur' }, { f: '=SUMME(C8:C17)', s: 'total', fmt: 'eur' }, { f: '=B18-C18', s: 'total', fmt: 'eurRed' }],
          [],
          [{ v: 'Bestände', s: 'head' }, { v: 'Anfang', s: 'headR' }, { v: 'Bewegung', s: 'headR' }, { v: 'Ende', s: 'headR' }],
          ...[['Kasse', 4], ['Bank', 5]].map(([k, ar], i) => {
            const r = 21 + i;
            const yr = 'Buchungen!$A$5:$A$400;">="&DATUM($B$3;1;1);Buchungen!$A$5:$A$400;"<="&DATUM($B$3;12;31)';
            return [k, { f: `=B${ar}`, fmt: 'eur' }, { f: `=SUMMEWENNS(Buchungen!$F$5:$F$400;Buchungen!$E$5:$E$400;"${k}";${yr})-SUMMEWENNS(Buchungen!$G$5:$G$400;Buchungen!$E$5:$E$400;"${k}";${yr})`, fmt: 'eurRed' }, { f: `=B${r}+C${r}`, fmt: 'eur' }];
          }),
          [{ v: 'Gesamt', s: 'total' }, { f: '=B21+B22', s: 'total', fmt: 'eur' }, { f: '=C21+C22', s: 'total', fmt: 'eurRed' }, { f: '=D21+D22', s: 'total', fmt: 'eur' }],
          [{ v: 'Kontrolle (muss 0 sein)', s: 'muted' }, null, null, { f: '=RUNDEN(D23-(B23+D18);2)', fmt: 'eur', s: 'muted' }],
          [],
          [{ v: 'Kassenprüfung am:', s: 'label' }],
          [{ v: 'Unterschriften Kassenwart/in und Kassenprüfer/innen:', s: 'label' }],
        ],
        cf: [{ range: 'D24', type: 'ne', v1: '0', style: 'red' }, { range: 'D18', type: 'lt', v1: '0', style: 'red' }],
        charts: [{ type: 'bar', range: 'A7:C17', title: 'Einnahmen und Ausgaben nach Bereich', at: 'F3', w: 440, h: 320, legend: 'b' }],
        notes: { D24: 'Endbestand minus (Anfangsbestand + Jahressaldo). Weicht das ab, fehlt eine Buchung oder das Jahr stimmt nicht.' },
        page: { orient: 'portrait', fit: 'width', grid: false, head: false },
      },
      {
        name: 'Buchungen', cols: [96, 80, 240, 170, 76, 100, 100], freeze: 4, autoFilter: 'A4:G400', start: 'A12',
        rows: [
          [{ v: 'Buchungen', s: 'title' }],
          [{ v: 'Jede Ein- und Auszahlung mit Beleg-Nr. Bereich und Konto (Kasse/Bank) aus der Liste wählen.', s: 'sub' }],
          [],
          [{ v: 'Datum', s: 'head' }, { v: 'Beleg-Nr.', s: 'head' }, { v: 'Buchungstext', s: 'head' }, { v: 'Bereich', s: 'head' }, { v: 'Konto', s: 'head' }, { v: 'Einnahme', s: 'headR' }, { v: 'Ausgabe', s: 'headR' }],
          ...[[-200, 'B-01', 'Mitgliedsbeiträge Januar (Lastschrift)', 'Mitgliedsbeiträge', 'Bank', 1840, null], [-180, 'B-02', 'Hallenmiete Quartal', 'Miete & Räume', 'Bank', null, 450],
            [-150, 'K-01', 'Kuchenverkauf Sommerfest', 'Verkauf & Bewirtung', 'Kasse', 286.5, null], [-150, 'K-02', 'Einkauf Getränke Sommerfest', 'Verkauf & Bewirtung', 'Kasse', null, 118.9],
            [-120, 'B-03', 'Spende Bäckerei am Markt', 'Spenden', 'Bank', 250, null], [-90, 'B-04', 'Vereinshaftpflicht', 'Versicherungen & Gebühren', 'Bank', null, 189], [-30, 'K-03', 'Briefmarken Einladungen', 'Porto, Büro & Bank', 'Kasse', null, 27.5]]
            .map(([d, b, t, ber, k, ein, aus]) => [{ date: 'today', add: d, fmt: 'date' }, b, t, ber, k, { v: ein, fmt: 'eur' }, { v: aus, fmt: 'eur' }]),
          { repeat: 389, cells: [{ v: null, fmt: 'date' }, null, null, null, null, { v: null, fmt: 'eur' }, { v: null, fmt: 'eur' }] },
        ],
        dv: [{ range: 'D5:D400', src: 'Kassenbericht!$A$8:$A$17' }, { range: 'E5:E400', list: ['Kasse', 'Bank'] }, { range: 'F5:G400', type: 'decimal', op: 'greaterThanOrEqual', v1: '0', error: 'Beträge positiv eintragen – Ausgaben in die Spalte „Ausgabe“.' }],
        page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
      },
    ],
  },
  // 30 ------------------------------------------------------------ Mitgliederliste Verein
  {
    id: 'mitgliederliste', title: 'Mitgliederliste Verein', desc: 'Mitglieder mit Beitragsgruppe, Jahresbeitrag aus der Beitragstabelle, Zahlungsstand und Jubiläen', cat: 'Verein', accent: 'blue',
    keywords: 'verein mitglieder mitgliederverwaltung beitrag jubiläum liste',
    sheets: [
      {
        name: 'Mitglieder', cols: [50, 110, 120, 100, 56, 100, 70, 130, 96, 70, 190, 96, 110, 24, 210, 100], freeze: 4, freezeC: 3, autoFilter: 'A4:M304', start: 'B10',
        rows: [
          [{ v: 'Mitgliederliste', s: 'title' }],
          [{ v: 'Beitrag kommt aus dem Blatt „Beiträge“. Wer ausgetreten ist, bekommt ein Austrittsdatum und zählt nicht mehr mit.', s: 'sub' }],
          [],
          [{ v: 'Nr.', s: 'headR' }, { v: 'Vorname', s: 'head' }, { v: 'Nachname', s: 'head' }, { v: 'Geburtsdatum', s: 'headR' }, { v: 'Alter', s: 'headR' }, { v: 'Eintritt', s: 'headR' }, { v: 'Jahre', s: 'headR' }, { v: 'Beitragsgruppe', s: 'head' }, { v: 'Jahresbeitrag', s: 'headR' }, { v: 'Bezahlt', s: 'headC' }, { v: 'E-Mail', s: 'head' }, { v: 'Austritt', s: 'headR' }, { v: 'Jubiläum', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
          ...[['Anna', 'Beispiel', -38, -12, 'Erwachsene', 'Ja'], ['Ben', 'Muster', -15, -5, 'Jugendliche', 'Ja'], ['Carla', 'Probe', -52, -25, 'Erwachsene', 'Nein'], ['Familie', 'Test', -44, -3, 'Familie', 'Ja'],
            ['Deniz', 'Yilmaz', -29, -1, 'Erwachsene', 'Nein'], ['Emil', 'Wolf', -71, -40, 'Ehrenmitglied', ''], ['Greta', 'Klein', -33, -10, 'Fördermitglied', 'Ja']].map(([v, n, born, joined, g, paid], i) => {
            const r = 5 + i;
            return [{ f: `=WENN(B${r}="";"";ZEILE()-4)`, fmt: 'int' }, v, n, { date: 'today', years: born, add: -40 * i, fmt: 'date' }, { f: `=WENN(D${r}="";"";DATEDIF(D${r};HEUTE();"Y"))`, fmt: 'int' },
              { date: 'year', years: joined, add: 30 * i, fmt: 'date' }, { f: `=WENN(F${r}="";"";DATEDIF(F${r};HEUTE();"Y"))`, fmt: 'int' }, g,
              { f: `=WENN(ODER(H${r}="";L${r}<>"");"";SVERWEIS(H${r};Beiträge!$A$5:$B$14;2;FALSCH))`, fmt: 'eur' }, { v: paid, s: 'center' }, `${v.toLowerCase()}@example.org`, { v: null, fmt: 'date' },
              { f: `=WENN(ODER(F${r}="";L${r}<>"");"";WENN(ODER(JAHR(HEUTE())-JAHR(F${r})=10;JAHR(HEUTE())-JAHR(F${r})=25;JAHR(HEUTE())-JAHR(F${r})=40;JAHR(HEUTE())-JAHR(F${r})=50);JAHR(HEUTE())-JAHR(F${r})&" Jahre";""))` }];
          }),
          { repeat: 293, cells: [{ f: '=WENN(B{r}="";"";ZEILE()-4)', fmt: 'int' }, null, null, { v: null, fmt: 'date' }, { f: '=WENN(D{r}="";"";DATEDIF(D{r};HEUTE();"Y"))', fmt: 'int' }, { v: null, fmt: 'date' }, { f: '=WENN(F{r}="";"";DATEDIF(F{r};HEUTE();"Y"))', fmt: 'int' }, null,
            { f: '=WENN(ODER(H{r}="";L{r}<>"");"";SVERWEIS(H{r};Beiträge!$A$5:$B$14;2;FALSCH))', fmt: 'eur' }, { v: null, s: 'center' }, null, { v: null, fmt: 'date' },
            { f: '=WENN(ODER(F{r}="";L{r}<>"");"";WENN(ODER(JAHR(HEUTE())-JAHR(F{r})=10;JAHR(HEUTE())-JAHR(F{r})=25;JAHR(HEUTE())-JAHR(F{r})=40;JAHR(HEUTE())-JAHR(F{r})=50);JAHR(HEUTE())-JAHR(F{r})&" Jahre";""))' }] },
        ],
        patch: {
          O5: 'Einträge', P5: { f: '=ANZAHL2(B5:B304)', fmt: 'int' }, O6: { v: 'Aktive Mitglieder', s: 'label' }, P6: { f: '=ANZAHL2(B5:B304)-ANZAHL(L5:L304)', fmt: 'int', s: 'label' },
          O7: 'Beiträge (Soll)', P7: { f: '=SUMME(I5:I304)', fmt: 'eur' }, O8: 'Davon bezahlt', P8: { f: '=SUMMEWENN(J5:J304;"Ja";I5:I304)', fmt: 'eur' },
          O9: { v: 'Noch offen', s: 'label' }, P9: { f: '=P7-P8', fmt: 'eurRed', s: 'label' }, O10: 'Ø Alter', P10: { f: '=WENN(ANZAHL(E5:E304)=0;"";MITTELWERT(E5:E304))', fmt: 'dec1' },
        },
        dv: [{ range: 'H5:H304', src: 'Beiträge!$A$5:$A$14' }, { range: 'J5:J304', list: ['Ja', 'Nein'] }],
        cf: [
          { range: 'A5:M304', type: 'formula', f: '=$L5<>""', style: 'done' },
          { range: 'J5:J304', type: 'formula', f: '=UND($I5<>"";$I5>0;$J5<>"Ja")', style: 'red' },
          { range: 'M5:M304', type: 'notblank', style: 'yellow' },
        ],
        notes: { G4: 'Volle Jahre seit dem Eintritt.', M4: 'Runde Mitgliedsjahre (10, 25, 40, 50) im laufenden Kalenderjahr.' },
        page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
      },
      {
        name: 'Beiträge', cols: [180, 110, 280], start: 'B5',
        rows: [
          [{ v: 'Beitragstabelle', s: 'title' }],
          [{ v: 'Gruppen und Jahresbeiträge laut Beitragsordnung. Neue Gruppen einfach unten anfügen.', s: 'sub' }],
          [],
          [{ v: 'Beitragsgruppe', s: 'head' }, { v: 'Jahresbeitrag', s: 'headR' }, { v: 'Hinweis', s: 'head' }],
          ['Erwachsene', { v: 60, s: 'input', fmt: 'eur' }, 'ab 18 Jahren'], ['Jugendliche', { v: 30, s: 'input', fmt: 'eur' }, 'bis 17 Jahre, Schüler/innen und Azubis'], ['Familie', { v: 100, s: 'input', fmt: 'eur' }, 'alle im selben Haushalt'],
          ['Fördermitglied', { v: 24, s: 'input', fmt: 'eur' }, 'ohne Stimmrecht'], ['Ehrenmitglied', { v: 0, s: 'input', fmt: 'eur' }, 'beitragsfrei'],
          ...Array.from({ length: 5 }, () => [null, { v: null, s: 'input', fmt: 'eur' }]),
        ],
      },
    ],
  },
  // 31 ------------------------------------------------------------ Angebotsvergleich
  {
    id: 'angebotsvergleich', title: 'Angebotsvergleich', desc: 'Drei Angebote nach Preis, Lieferzeit, Garantie und eigenen Kriterien gewichtet bewerten', cat: 'Business', accent: 'indigo',
    keywords: 'angebot vergleich anbieter bewertung nutzwertanalyse auswahl einkauf',
    sheets: [{
      name: 'Vergleich', cols: [240, 104, 120, 120, 120], start: 'C5',
      rows: [
        [{ v: 'Angebotsvergleich', s: 'title' }],
        [{ v: 'Eckdaten der Angebote eintragen und Qualität/Service mit 0–10 Punkten bewerten. Preis, Lieferzeit und Garantie werden automatisch bepunktet.', s: 'sub' }],
        [],
        [{ v: 'Eckdaten', s: 'head' }, { v: 'Einheit', s: 'head' }, { v: 'Anbieter A', s: 'headR' }, { v: 'Anbieter B', s: 'headR' }, { v: 'Anbieter C', s: 'headR' }],
        ['Preis (netto)', '€', { v: 4800, s: 'input', fmt: 'eur' }, { v: 5200, s: 'input', fmt: 'eur' }, { v: 4450, s: 'input', fmt: 'eur' }],
        ['Lieferzeit', 'Tage', { v: 14, s: 'input', fmt: 'int' }, { v: 7, s: 'input', fmt: 'int' }, { v: 21, s: 'input', fmt: 'int' }],
        ['Garantie', 'Monate', { v: 24, s: 'input', fmt: 'int' }, { v: 36, s: 'input', fmt: 'int' }, { v: 12, s: 'input', fmt: 'int' }],
        ['Zahlungsziel', 'Tage', { v: 30, s: 'input', fmt: 'int' }, { v: 14, s: 'input', fmt: 'int' }, { v: 30, s: 'input', fmt: 'int' }],
        [],
        [{ v: 'Bewertung (0–10 Punkte)', s: 'head' }, { v: 'Gewichtung', s: 'headR' }, { v: 'Anbieter A', s: 'headR' }, { v: 'Anbieter B', s: 'headR' }, { v: 'Anbieter C', s: 'headR' }],
        ['Preis (günstigster = 10)', { v: 0.3, s: 'input', fmt: 'pct0' }, ...['C', 'D', 'E'].map(c => ({ f: `=WENN(${c}5>0;RUNDEN(MIN($C$5:$E$5)/${c}5*10;1);0)`, fmt: 'dec1' }))],
        ['Lieferzeit (schnellster = 10)', { v: 0.15, s: 'input', fmt: 'pct0' }, ...['C', 'D', 'E'].map(c => ({ f: `=WENN(${c}6>0;RUNDEN(MIN($C$6:$E$6)/${c}6*10;1);10)`, fmt: 'dec1' }))],
        ['Garantie (längste = 10)', { v: 0.15, s: 'input', fmt: 'pct0' }, ...['C', 'D', 'E'].map(c => ({ f: `=WENN(MAX($C$7:$E$7)>0;RUNDEN(${c}7/MAX($C$7:$E$7)*10;1);0)`, fmt: 'dec1' }))],
        ['Qualität / Eindruck', { v: 0.25, s: 'input', fmt: 'pct0' }, { v: 8, s: 'input', fmt: 'dec1' }, { v: 9, s: 'input', fmt: 'dec1' }, { v: 6, s: 'input', fmt: 'dec1' }],
        ['Service & Erreichbarkeit', { v: 0.15, s: 'input', fmt: 'pct0' }, { v: 7, s: 'input', fmt: 'dec1' }, { v: 8, s: 'input', fmt: 'dec1' }, { v: 6, s: 'input', fmt: 'dec1' }],
        [{ v: 'Summe Gewichtung', s: 'muted' }, { f: '=SUMME(B11:B15)', fmt: 'pct0', s: 'muted' }],
        [{ v: 'Gewichtete Punkte', s: 'total' }, { v: null, s: 'total' }, ...['C', 'D', 'E'].map(c => ({ f: `=WENN($B$16=0;0;SUMMENPRODUKT($B$11:$B$15;${c}11:${c}15)/$B$16)`, fmt: 'dec2', s: 'total' }))],
        [{ v: 'Rang', s: 'big' }, null, ...['C', 'D', 'E'].map(c => ({ f: `=RANG(${c}17;$C$17:$E$17)`, fmt: 'int', s: ['big', 'right'] }))],
        [{ v: 'Punkte je 1.000 € (Preis-Leistung)', s: 'label' }, null, ...['C', 'D', 'E'].map(c => ({ f: `=WENN(${c}5>0;${c}17/${c}5*1000;"")`, fmt: 'dec2' }))],
      ],
      dv: [{ range: 'C14:E15', type: 'decimal', op: 'between', v1: '0', v2: '10', error: 'Punkte von 0 bis 10.' }, { range: 'B11:B15', type: 'decimal', op: 'between', v1: '0', v2: '1', error: 'Gewichtung zwischen 0 % und 100 %.' }],
      cf: [{ range: 'C18:E18', type: 'eq', v1: '1', style: 'green' }, { range: 'B16', type: 'ne', v1: '1', style: 'red' }, { range: 'C17:E17', type: 'bar', bar: 'violet' }],
      charts: [{ type: 'col', range: 'A10:E15', title: 'Punkte je Kriterium', at: 'G4', w: 440, h: 300, legend: 'b' }],
      notes: { B16: 'Sollte 100 % ergeben – sonst wird rot markiert (gerechnet wird trotzdem anteilig).', A19: 'Gewichtete Punkte geteilt durch den Preis in Tausend Euro.' },
      page: { orient: 'landscape', fit: 'width', grid: false, head: false },
    }],
  },
  // 32 ------------------------------------------------------------ Lagerbestand mit Mindestbestand
  {
    id: 'lagerbestand', title: 'Lagerbestand mit Mindestbestand', desc: 'Artikel mit Bestand, Mindestbestand und Bestellvorschlag – was nachbestellt werden muss, wird rot', cat: 'Business', accent: 'amber',
    keywords: 'lager bestand mindestbestand nachbestellen material artikel inventur',
    sheets: [{
      name: 'Lager', cols: [80, 210, 110, 76, 90, 90, 64, 90, 104, 130, 96, 150, 160, 24, 200, 104], freeze: 4, freezeC: 2, autoFilter: 'A4:M304', start: 'D5',
      rows: [
        [{ v: 'Lagerbestand', s: 'title' }],
        [{ v: 'Bestand nach jeder Entnahme oder Lieferung anpassen. Sobald er den Mindestbestand erreicht, erscheint ein Bestellvorschlag.', s: 'sub' }],
        [],
        [{ v: 'Art.-Nr.', s: 'head' }, { v: 'Artikel', s: 'head' }, { v: 'Lagerort', s: 'head' }, { v: 'Bestand', s: 'headR' }, { v: 'Mindestbestand', s: 'headR' }, { v: 'Bestellmenge', s: 'headR' }, { v: 'Einheit', s: 'head' }, { v: 'EK-Preis', s: 'headR' }, { v: 'Lagerwert', s: 'headR' }, { v: 'Status', s: 'head' }, { v: 'Vorschlag', s: 'headR' }, { v: 'Lieferant', s: 'head' }, { v: 'Notiz', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
        ...[['A-100', 'Kopierpapier A4', 'Regal 1', 18, 10, 40, 'Pack', 4.2, 'Bürobedarf Nord'], ['A-101', 'Toner schwarz', 'Regal 1', 2, 2, 4, 'Stück', 58, 'Bürobedarf Nord'], ['B-200', 'Versandkarton M', 'Lager hinten', 140, 50, 200, 'Stück', 0.62, 'Packwelt'],
          ['B-201', 'Klebeband', 'Lager hinten', 9, 12, 36, 'Rolle', 1.35, 'Packwelt'], ['C-300', 'Schrauben 4×30', 'Werkbank', 0, 200, 1000, 'Stück', 0.03, 'Eisenwaren Süd'], ['C-301', 'Handschuhe Gr. L', 'Werkbank', 30, 20, 50, 'Paar', 1.9, 'Arbeitsschutz Mitte']]
          .map(([nr, a, ort, b, min, menge, eh, ek, lief], i) => {
            const r = 5 + i;
            return [nr, a, ort, { v: b, fmt: 'num' }, { v: min, fmt: 'num' }, { v: menge, fmt: 'num' }, eh, { v: ek, fmt: 'eur' }, { f: `=WENN(ODER(D${r}="";H${r}="");"";D${r}*H${r})`, fmt: 'eur' },
              { f: `=WENN(ODER(B${r}="";D${r}="";E${r}="");"";WENN(D${r}<=0;"Leer – bestellen";WENN(D${r}<=E${r};"Nachbestellen";"OK")))` }, { f: `=WENN(ODER(J${r}="";J${r}="OK");"";MAX(F${r};E${r}-D${r}+F${r}))`, fmt: 'num' }, lief];
          }),
        { repeat: 294, cells: [null, null, null, { v: null, fmt: 'num' }, { v: null, fmt: 'num' }, { v: null, fmt: 'num' }, null, { v: null, fmt: 'eur' }, { f: '=WENN(ODER(D{r}="";H{r}="");"";D{r}*H{r})', fmt: 'eur' },
          { f: '=WENN(ODER(B{r}="";D{r}="";E{r}="");"";WENN(D{r}<=0;"Leer – bestellen";WENN(D{r}<=E{r};"Nachbestellen";"OK")))' }, { f: '=WENN(ODER(J{r}="";J{r}="OK");"";MAX(F{r};E{r}-D{r}+F{r}))', fmt: 'num' }] },
      ],
      patch: {
        O5: 'Artikel', P5: { f: '=ANZAHL2(B5:B304)', fmt: 'int' }, O6: { v: 'Nachbestellen', s: 'label' }, P6: { f: '=ZÄHLENWENN(J5:J304;"Nachbestellen")+ZÄHLENWENN(J5:J304;"Leer – bestellen")', fmt: 'int', s: 'label' },
        O7: 'Davon leer', P7: { f: '=ZÄHLENWENN(J5:J304;"Leer – bestellen")', fmt: 'int' }, O8: 'Lagerwert gesamt', P8: { f: '=SUMME(I5:I304)', fmt: 'eur' },
      },
      cf: [
        { range: 'J5:J304', type: 'eq', v1: 'Leer – bestellen', style: 'red' }, { range: 'J5:J304', type: 'eq', v1: 'Nachbestellen', style: 'yellow' }, { range: 'J5:J304', type: 'eq', v1: 'OK', style: 'green' },
        { range: 'P6', type: 'gt', v1: '0', style: 'red' },
      ],
      notes: { E4: 'Ab diesem Bestand (oder darunter) wird nachbestellt.', K4: 'Bestellmenge – bei leerem oder stark unterschrittenem Lager so viel mehr, dass danach Mindestbestand plus Bestellmenge erreicht ist.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 33 ------------------------------------------------------------ Urlaubsübersicht Team
  {
    id: 'teamurlaub', title: 'Urlaubsübersicht Team', desc: 'Urlaubsanspruch, Resturlaub und Arbeitstage je Mitarbeiter/in – Einträge mit Feiertagsliste', cat: 'Arbeit', accent: 'teal',
    keywords: 'team mitarbeiter urlaubsanspruch resturlaub urlaubsplanung abwesenheit personal',
    sheets: [
      {
        name: 'Übersicht', cols: [170, 120, 90, 90, 80, 90, 80, 100, 100], freeze: 5, start: 'C6',
        rows: [
          [{ v: 'Urlaubsübersicht Team', s: 'title' }],
          [{ v: 'Anspruch und Resturlaub eintragen, die Urlaube im Blatt „Einträge“. Verbleibend = Anspruch + Rest − genommen − geplant.', s: 'sub' }],
          [{ v: 'Jahr', s: 'label' }, { f: '=JAHR(HEUTE())', s: 'input', fmt: 'int' }],
          [],
          [{ v: 'Mitarbeiter/in', s: 'head' }, { v: 'Abteilung', s: 'head' }, { v: 'Anspruch', s: 'headR' }, { v: 'Rest Vorjahr', s: 'headR' }, { v: 'Gesamt', s: 'headR' }, { v: 'Genommen', s: 'headR' }, { v: 'Geplant', s: 'headR' }, { v: 'Verbleibend', s: 'headR' }, { v: 'Genommen in %', s: 'headR' }],
          ...[['Anna Beispiel', 'Vertrieb', 30, 2], ['Ben Muster', 'Lager', 28, 0], ['Carla Probe', 'Büro', 30, 5], ['Deniz Test', 'Lager', 26, 1], ['Emil Schmidt', 'Vertrieb', 30, 0]].map(([n, ab, an, rest], i) => {
            const r = 6 + i;
            const yr = `Einträge!$B$5:$B$300;">="&DATUM($B$3;1;1);Einträge!$B$5:$B$300;"<="&DATUM($B$3;12;31)`;
            return [n, ab, { v: an, s: 'input', fmt: 'dec1' }, { v: rest, s: 'input', fmt: 'dec1' }, { f: `=WENN(A${r}="";"";C${r}+D${r})`, fmt: 'dec1' },
              { f: `=WENN(A${r}="";"";SUMMEWENNS(Einträge!$D$5:$D$300;Einträge!$A$5:$A$300;A${r};Einträge!$E$5:$E$300;"Urlaub";Einträge!$F$5:$F$300;"genommen";${yr}))`, fmt: 'dec1' },
              { f: `=WENN(A${r}="";"";SUMMEWENNS(Einträge!$D$5:$D$300;Einträge!$A$5:$A$300;A${r};Einträge!$E$5:$E$300;"Urlaub";Einträge!$F$5:$F$300;"<>genommen";${yr}))`, fmt: 'dec1' },
              { f: `=WENN(A${r}="";"";E${r}-F${r}-G${r})`, fmt: 'dec1' }, { f: `=WENN(ODER(A${r}="";E${r}=0);"";F${r}/E${r})`, fmt: 'pct0' }];
          }),
          ...Array.from({ length: 15 }, (_, i) => {
            const r = 11 + i;
            const yr = `Einträge!$B$5:$B$300;">="&DATUM($B$3;1;1);Einträge!$B$5:$B$300;"<="&DATUM($B$3;12;31)`;
            return [null, null, { v: null, s: 'input', fmt: 'dec1' }, { v: null, s: 'input', fmt: 'dec1' }, { f: `=WENN(A${r}="";"";C${r}+D${r})`, fmt: 'dec1' },
              { f: `=WENN(A${r}="";"";SUMMEWENNS(Einträge!$D$5:$D$300;Einträge!$A$5:$A$300;A${r};Einträge!$E$5:$E$300;"Urlaub";Einträge!$F$5:$F$300;"genommen";${yr}))`, fmt: 'dec1' },
              { f: `=WENN(A${r}="";"";SUMMEWENNS(Einträge!$D$5:$D$300;Einträge!$A$5:$A$300;A${r};Einträge!$E$5:$E$300;"Urlaub";Einträge!$F$5:$F$300;"<>genommen";${yr}))`, fmt: 'dec1' },
              { f: `=WENN(A${r}="";"";E${r}-F${r}-G${r})`, fmt: 'dec1' }, { f: `=WENN(ODER(A${r}="";E${r}=0);"";F${r}/E${r})`, fmt: 'pct0' }];
          }),
        ],
        cf: [{ range: 'H6:H25', type: 'lt', v1: '0', style: 'red' }, { range: 'I6:I25', type: 'bar', bar: 'green' }],
        charts: [{ type: 'bar', range: 'A5:A10', valuesCol: 'H', title: 'Verbleibende Urlaubstage', at: 'K3', w: 400, h: 260, legend: 'n' }],
        notes: { G5: 'Einträge mit Status „geplant“ oder „genehmigt“.', H5: 'Wird rot, wenn mehr verplant ist als vorhanden.' },
        page: { orient: 'landscape', fit: 'width' },
      },
      {
        name: 'Einträge', cols: [170, 100, 100, 90, 120, 110, 190, 24, 150], freeze: 4, autoFilter: 'A4:G300', start: 'A10',
        rows: [
          [{ v: 'Urlaubseinträge', s: 'title' }],
          [{ v: 'Arbeitstage zählen Montag bis Freitag ohne die Feiertage in Spalte I. Bewegliche und regionale Feiertage selbst ergänzen.', s: 'sub' }],
          [],
          [{ v: 'Mitarbeiter/in', s: 'head' }, { v: 'Von', s: 'headR' }, { v: 'Bis', s: 'headR' }, { v: 'Arbeitstage', s: 'headR' }, { v: 'Art', s: 'head' }, { v: 'Status', s: 'head' }, { v: 'Notiz', s: 'head' }, null, { v: 'Feiertage', s: 'headR' }],
          ...[['Anna Beispiel', 'month', -2, 4, 'Urlaub', 'genommen'], ['Ben Muster', 'month', -1, 9, 'Urlaub', 'genommen'], ['Carla Probe', 'nextmonth', 0, 11, 'Urlaub', 'genehmigt'],
            ['Deniz Test', 'nextmonth', 14, 4, 'Urlaub', 'geplant'], ['Anna Beispiel', 'nextmonth', 2, 0, 'Sonderurlaub', 'genehmigt']].map(([n, base, m, len, art, st], i) => {
            const r = 5 + i;
            return [n, { date: base, months: m < 0 ? m : 0, add: m >= 0 ? m : 3, fmt: 'date' }, { date: base, months: m < 0 ? m : 0, add: (m >= 0 ? m : 3) + len, fmt: 'date' }, { f: `=WENN(ODER(B${r}="";C${r}="");"";NETTOARBEITSTAGE(B${r};C${r};$I$5:$I$40))`, fmt: 'dec1' }, art, st];
          }),
          { repeat: 291, cells: [null, { v: null, fmt: 'date' }, { v: null, fmt: 'date' }, { f: '=WENN(ODER(B{r}="";C{r}="");"";NETTOARBEITSTAGE(B{r};C{r};$I$5:$I$40))', fmt: 'dec1' }] },
        ],
        patch: {
          I5: { f: '=DATUM(Übersicht!$B$3;1;1)', fmt: 'date' }, I6: { f: '=DATUM(Übersicht!$B$3;5;1)', fmt: 'date' }, I7: { f: '=DATUM(Übersicht!$B$3;10;3)', fmt: 'date' },
          I8: { f: '=DATUM(Übersicht!$B$3;12;25)', fmt: 'date' }, I9: { f: '=DATUM(Übersicht!$B$3;12;26)', fmt: 'date' }, ...Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`I${10 + i}`, { v: null, s: 'input', fmt: 'date' }])),
        },
        dv: [{ range: 'A5:A300', src: 'Übersicht!$A$6:$A$25' }, { range: 'E5:E300', list: ['Urlaub', 'Sonderurlaub', 'Unbezahlt', 'Überstundenausgleich'] }, { range: 'F5:F300', list: ['geplant', 'genehmigt', 'genommen'] }],
        cf: [{ range: 'F5:F300', type: 'eq', v1: 'geplant', style: 'yellow' }, { range: 'F5:F300', type: 'eq', v1: 'genommen', style: 'gray' }],
        notes: { D4: 'Montag bis Freitag zwischen Von und Bis, ohne die Feiertage aus Spalte I. Halbe Tage bitte von Hand korrigieren.', I4: 'Bundesweite Feiertage mit festem Datum sind vorgegeben. Ostern, Pfingsten und regionale Feiertage unten ergänzen.' },
        page: { orient: 'portrait', fit: 'width', titleRows: { r1: 4, r2: 4 } },
      },
    ],
  },
  // 34 ------------------------------------------------------------ Kundenliste (CRM light)
  {
    id: 'kundenliste', title: 'Kundenliste (CRM light)', desc: 'Kontakte mit Status, letztem Kontakt, nächstem Schritt und Wiedervorlage – Fälliges wird markiert', cat: 'Business', accent: 'blue',
    keywords: 'kunden crm vertrieb kontakte wiedervorlage leads akquise liste',
    sheets: [{
      name: 'Kunden', cols: [180, 150, 120, 190, 104, 104, 100, 100, 220, 104, 104, 200, 24, 210, 100], freeze: 4, freezeC: 1, autoFilter: 'A4:L304', start: 'A11',
      rows: [
        [{ v: 'Kundenliste', s: 'title' }],
        [{ v: 'Nach jedem Kontakt „Letzter Kontakt“, „Nächster Schritt“ und die Wiedervorlage aktualisieren. Fällige Wiedervorlagen werden gelb, überfällige rot.', s: 'sub' }],
        [],
        [{ v: 'Firma / Name', s: 'head' }, { v: 'Ansprechpartner/in', s: 'head' }, { v: 'Telefon', s: 'head' }, { v: 'E-Mail', s: 'head' }, { v: 'Status', s: 'head' }, { v: 'Quelle', s: 'head' }, { v: 'Erster Kontakt', s: 'headR' }, { v: 'Letzter Kontakt', s: 'headR' }, { v: 'Nächster Schritt', s: 'head' }, { v: 'Wiedervorlage', s: 'headR' }, { v: 'Umsatz bisher', s: 'headR' }, { v: 'Notiz', s: 'head' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
        ...[['Bäckerei Sonnenschein', 'Frau Weber', '0681 1111 00', 'info@example.com', 'Stammkunde', 'Empfehlung', -400, -12, 'Angebot Herbstaktion schicken', 2, 8400],
          ['Muster Handwerk GmbH', 'Herr Kaya', '06841 2222 0', 'kontakt@example.de', 'Angebot', 'Messe', -40, -9, 'Nachfassen zum Angebot', -1, 0],
          ['Praxis am Park', 'Dr. Brandt', '0681 3333 4', 'praxis@example.org', 'Kunde', 'Website', -150, -60, 'Zufriedenheit abfragen', 0, 1250],
          ['Café Lindenblatt', 'Frau Arslan', '0176 444 555', 'cafe@example.net', 'Interessent', 'Social Media', -10, -10, 'Termin vor Ort vereinbaren', 5, 0],
          ['Autohaus Beispiel', 'Herr Novak', '06898 5555', 'service@example.com', 'Inaktiv', 'Kaltakquise', -700, -300, '', null, 3100]]
          .map(([f, ap, tel, mail, st, q, first, last, next, wv, ums]) => [f, ap, { v: tel, fmt: 'text' }, { v: mail, link: 'mailto:' + mail }, st, q, { date: 'today', add: first, fmt: 'date' }, { date: 'today', add: last, fmt: 'date' }, next,
            wv == null ? { v: null, fmt: 'date' } : { date: 'today', add: wv, fmt: 'date' }, { v: ums, fmt: 'eur' }]),
        { repeat: 295, cells: [null, null, { v: null, fmt: 'text' }, null, null, null, { v: null, fmt: 'date' }, { v: null, fmt: 'date' }, null, { v: null, fmt: 'date' }, { v: null, fmt: 'eur' }] },
      ],
      patch: {
        ...Object.fromEntries(['Interessent', 'Angebot', 'Kunde', 'Stammkunde', 'Inaktiv'].flatMap((st, i) => [[`N${5 + i}`, st], [`O${5 + i}`, { f: `=ZÄHLENWENN($E$5:$E$304;N${5 + i})`, fmt: 'int' }]])),
        N11: { v: 'Wiedervorlage überfällig', s: 'label' }, O11: { f: '=ZÄHLENWENNS(J5:J304;"<"&HEUTE();E5:E304;"<>Inaktiv")', fmt: 'int', s: 'label' },
        N12: 'Wiedervorlage heute', O12: { f: '=ZÄHLENWENN(J5:J304;HEUTE())', fmt: 'int' }, N13: 'Umsatz gesamt', O13: { f: '=SUMME(K5:K304)', fmt: 'eur' },
      },
      dv: [{ range: 'E5:E304', src: '$N$5:$N$9' }, { range: 'F5:F304', list: ['Empfehlung', 'Website', 'Messe', 'Social Media', 'Kaltakquise', 'Bestandskunde', 'Sonstiges'] }],
      cf: [
        { range: 'A5:L304', type: 'formula', f: '=$E5="Inaktiv"', style: 'gray' },
        { range: 'J5:J304', type: 'formula', f: '=UND($J5<>"";$J5<HEUTE();$E5<>"Inaktiv")', style: 'red' },
        { range: 'J5:J304', type: 'formula', f: '=UND($J5<>"";$J5=HEUTE())', style: 'yellow' },
        { range: 'O11', type: 'gt', v1: '0', style: 'red' }, { range: 'O5:O9', type: 'bar', bar: 'blue' },
      ],
      notes: { J4: 'Datum, an dem du dich wieder melden willst.', E4: 'Status aus der Liste rechts – dort lassen sich die Stufen umbenennen.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
    }],
  },
  // 35 ------------------------------------------------------------ Zeiterfassung Projekte
  {
    id: 'projektzeiten', title: 'Zeiterfassung Projekte', desc: 'Arbeitszeiten je Projekt mit Pause, abrechenbaren Stunden, Stundensatz und Budget-Rest', cat: 'Arbeit', accent: 'indigo',
    keywords: 'zeiterfassung projekt stunden stundensatz abrechnung freelancer budget',
    sheets: [
      {
        name: 'Zeiten', cols: [96, 150, 230, 70, 70, 84, 76, 96, 104, 24, 230, 104], freeze: 4, autoFilter: 'A4:I400', start: 'A11',
        rows: [
          [{ v: 'Zeiterfassung Projekte', s: 'title' }],
          [{ v: 'Projekt aus der Liste wählen, Beginn und Ende als Uhrzeit (z. B. 09:15). Stundensätze stehen im Blatt „Projekte“.', s: 'sub' }],
          [],
          [{ v: 'Datum', s: 'head' }, { v: 'Projekt', s: 'head' }, { v: 'Tätigkeit', s: 'head' }, { v: 'Beginn', s: 'headR' }, { v: 'Ende', s: 'headR' }, { v: 'Pause (Min.)', s: 'headR' }, { v: 'Stunden', s: 'headR' }, { v: 'Abrechenbar', s: 'headC' }, { v: 'Betrag', s: 'headR' }, null, { v: 'Überblick', s: 'head' }, { v: '', s: 'headR' }],
          ...[[-6, 'Website Bäckerei', 'Texte und Bilder einpflegen', 9, 12.5, 0, 'Ja'], [-6, 'Interne Organisation', 'Buchhaltung', 13.5, 15, 0, 'Nein'], [-5, 'Logo Café', 'Entwürfe skizzieren', 8.5, 12, 15, 'Ja'],
            [-3, 'Website Bäckerei', 'Abstimmung per Video', 10, 11, 0, 'Ja'], [-2, 'Logo Café', 'Reinzeichnung', 14, 17.75, 15, 'Ja'], [-1, 'Website Bäckerei', 'Fehler korrigiert', 9, 10.25, 0, 'Ja']]
            .map(([d, p, t, a, e, pause, abr], i) => {
              const r = 5 + i;
              return [{ date: 'today', add: d, fmt: 'date' }, p, t, { v: a / 24, fmt: 'time' }, { v: e / 24, fmt: 'time' }, pause, { f: `=WENN(ODER(D${r}="";E${r}="");"";RUNDEN((WENN(E${r}<D${r};E${r}+1;E${r})-D${r})*24-F${r}/60;2))`, fmt: 'hours' }, { v: abr, s: 'center' },
                { f: `=WENN(ODER(G${r}="";H${r}<>"Ja";B${r}="");"";G${r}*SVERWEIS(B${r};Projekte!$A$5:$C$40;3;FALSCH))`, fmt: 'eur' }];
            }),
          { repeat: 390, cells: [{ v: null, fmt: 'date' }, null, null, { v: null, fmt: 'time' }, { v: null, fmt: 'time' }, null, { f: '=WENN(ODER(D{r}="";E{r}="");"";RUNDEN((WENN(E{r}<D{r};E{r}+1;E{r})-D{r})*24-F{r}/60;2))', fmt: 'hours' }, { v: null, s: 'center' },
            { f: '=WENN(ODER(G{r}="";H{r}<>"Ja";B{r}="");"";G{r}*SVERWEIS(B{r};Projekte!$A$5:$C$40;3;FALSCH))', fmt: 'eur' }] },
        ],
        patch: {
          K5: 'Stunden diese Woche', L5: { f: '=SUMMEWENNS(G5:G400;A5:A400;">="&(HEUTE()-WOCHENTAG(HEUTE();2)+1);A5:A400;"<="&HEUTE())', fmt: 'hours' },
          K6: 'Stunden diesen Monat', L6: { f: '=SUMMEWENNS(G5:G400;A5:A400;">="&DATUM(JAHR(HEUTE());MONAT(HEUTE());1))', fmt: 'hours' },
          K7: { v: 'Abrechenbar diesen Monat', s: 'label' }, L7: { f: '=SUMMEWENNS(I5:I400;A5:A400;">="&DATUM(JAHR(HEUTE());MONAT(HEUTE());1))', fmt: 'eur', s: 'label' },
          K8: 'Anteil abrechenbar (gesamt)', L8: { f: '=WENN(SUMME(G5:G400)=0;"";SUMMEWENN(H5:H400;"Ja";G5:G400)/SUMME(G5:G400))', fmt: 'pct0' },
        },
        dv: [{ range: 'B5:B400', src: 'Projekte!$A$5:$A$40' }, { range: 'H5:H400', list: ['Ja', 'Nein'] }],
        cf: [{ range: 'A5:I400', type: 'formula', f: '=$H5="Nein"', style: 'gray' }],
        notes: { G4: '(Ende − Beginn) in Stunden minus Pause. Über Mitternacht wird richtig gerechnet.', I4: 'Stunden × Stundensatz des Projekts – nur wenn „Abrechenbar“ auf Ja steht.' },
        page: { orient: 'landscape', fit: 'width', titleRows: { r1: 4, r2: 4 } },
      },
      {
        name: 'Projekte', cols: [180, 160, 100, 96, 96, 96, 110], freeze: 4, start: 'A8',
        rows: [
          [{ v: 'Projekte', s: 'title' }],
          [{ v: 'Neue Projekte unten anfügen – sie erscheinen dann in der Auswahlliste im Blatt „Zeiten“.', s: 'sub' }],
          [],
          [{ v: 'Projekt', s: 'head' }, { v: 'Kunde', s: 'head' }, { v: 'Stundensatz', s: 'headR' }, { v: 'Budget (Std.)', s: 'headR' }, { v: 'Erfasst', s: 'headR' }, { v: 'Rest (Std.)', s: 'headR' }, { v: 'Abrechenbar', s: 'headR' }],
          ...[['Website Bäckerei', 'Bäckerei Sonnenschein', 65, 40], ['Logo Café', 'Café Lindenblatt', 70, 12], ['Interne Organisation', '–', 0, null]].map(([p, k, rate, budget], i) => {
            const r = 5 + i;
            return [p, k, { v: rate, s: 'input', fmt: 'eur' }, { v: budget, s: 'input', fmt: 'hours' }, { f: `=WENN(A${r}="";"";SUMMEWENN(Zeiten!$B$5:$B$400;A${r};Zeiten!$G$5:$G$400))`, fmt: 'hours' },
              { f: `=WENN(ODER(A${r}="";D${r}="");"";D${r}-E${r})`, fmt: 'hoursSigned' }, { f: `=WENN(A${r}="";"";SUMMEWENN(Zeiten!$B$5:$B$400;A${r};Zeiten!$I$5:$I$400))`, fmt: 'eur' }];
          }),
          { repeat: 33, cells: [null, null, { v: null, s: 'input', fmt: 'eur' }, { v: null, s: 'input', fmt: 'hours' }, { f: '=WENN(A{r}="";"";SUMMEWENN(Zeiten!$B$5:$B$400;A{r};Zeiten!$G$5:$G$400))', fmt: 'hours' },
            { f: '=WENN(ODER(A{r}="";D{r}="");"";D{r}-E{r})', fmt: 'hoursSigned' }, { f: '=WENN(A{r}="";"";SUMMEWENN(Zeiten!$B$5:$B$400;A{r};Zeiten!$I$5:$I$400))', fmt: 'eur' }] },
        ],
        cf: [{ range: 'F5:F40', type: 'lt', v1: '0', style: 'red' }],
        notes: { F4: 'Budget minus erfasste Stunden. Negativ = Budget überschritten.' },
      },
    ],
  },
  // 36 ------------------------------------------------------------ Rechnungs-Mahnliste
  {
    id: 'mahnliste', title: 'Rechnungs-Mahnliste', desc: 'Offene Rechnungen mit Fälligkeit, Tagen im Verzug und Mahnstufe – Überfälliges auf einen Blick', cat: 'Business', accent: 'rose',
    keywords: 'mahnung offene posten rechnung zahlungserinnerung forderungen verzug',
    sheets: [{
      name: 'Offene Posten', cols: [104, 190, 100, 84, 100, 104, 100, 90, 90, 110, 200, 24, 230, 104], freeze: 5, autoFilter: 'A5:K300', start: 'G6',
      rows: [
        [{ v: 'Rechnungs-Mahnliste', s: 'title' }],
        [{ v: 'Rechnungen eintragen und das Zahlungsdatum ergänzen, sobald Geld eingeht. Ab wie vielen Tagen welche Mahnstufe gilt, legst du rechts fest.', s: 'sub' }],
        [],
        [],
        [{ v: 'Rechnungsnr.', s: 'head' }, { v: 'Kunde', s: 'head' }, { v: 'Rechnungsdatum', s: 'headR' }, { v: 'Ziel (Tage)', s: 'headR' }, { v: 'Fällig am', s: 'headR' }, { v: 'Betrag', s: 'headR' }, { v: 'Bezahlt am', s: 'headR' }, { v: 'Tage über', s: 'headR' }, { v: 'Mahnstufe', s: 'headC' }, { v: 'Letzte Mahnung', s: 'headR' }, { v: 'Notiz', s: 'head' }, null, { v: 'Mahnstufen', s: 'head' }, { v: 'ab Tag', s: 'headR' }],
        ...[['2026-041', 'Bäckerei Sonnenschein', -70, 14, 1428, -50], ['2026-042', 'Muster Handwerk GmbH', -45, 14, 2380, null], ['2026-043', 'Praxis am Park', -30, 30, 595, null], ['2026-044', 'Café Lindenblatt', -20, 7, 214.2, null], ['2026-045', 'Autohaus Beispiel', -5, 14, 980, null]]
          .map(([nr, k, d, ziel, betrag, paid], i) => {
            const r = 6 + i;
            return [nr, k, { date: 'today', add: d, fmt: 'date' }, ziel, { f: `=WENN(ODER(C${r}="";D${r}="");"";C${r}+D${r})`, fmt: 'date' }, { v: betrag, fmt: 'eur' }, paid == null ? { v: null, fmt: 'date' } : { date: 'today', add: paid, fmt: 'date' },
              { f: `=WENN(ODER(E${r}="";G${r}<>"");"";MAX(0;HEUTE()-E${r}))`, fmt: 'int' }, { f: `=WENN(H${r}="";"";WENN(H${r}>=$N$8;3;WENN(H${r}>=$N$7;2;WENN(H${r}>=$N$6;1;0))))`, fmt: 'int', s: 'center' }, { v: null, fmt: 'date' }];
          }),
        { repeat: 290, cells: [null, null, { v: null, fmt: 'date' }, null, { f: '=WENN(ODER(C{r}="";D{r}="");"";C{r}+D{r})', fmt: 'date' }, { v: null, fmt: 'eur' }, { v: null, fmt: 'date' }, { f: '=WENN(ODER(E{r}="";G{r}<>"");"";MAX(0;HEUTE()-E{r}))', fmt: 'int' },
          { f: '=WENN(H{r}="";"";WENN(H{r}>=$N$8;3;WENN(H{r}>=$N$7;2;WENN(H{r}>=$N$6;1;0))))', fmt: 'int', s: 'center' }, { v: null, fmt: 'date' }] },
      ],
      patch: {
        M6: '1 – Zahlungserinnerung', N6: { v: 1, s: 'input', fmt: 'int' }, M7: '2 – Mahnung', N7: { v: 14, s: 'input', fmt: 'int' }, M8: '3 – letzte Mahnung', N8: { v: 28, s: 'input', fmt: 'int' },
        M10: { v: 'Überblick', s: 'head' }, N10: { v: '', s: 'headR' },
        M11: 'Offen gesamt', N11: { f: '=SUMMEWENN(H6:H300;">=0";F6:F300)', fmt: 'eur' }, M12: { v: 'Davon überfällig', s: 'label' }, N12: { f: '=SUMMEWENN(H6:H300;">0";F6:F300)', fmt: 'eur', s: 'label' },
        M13: 'Rechnungen überfällig', N13: { f: '=ZÄHLENWENN(H6:H300;">0")', fmt: 'int' }, M14: 'In Stufe 3', N14: { f: '=ZÄHLENWENN(I6:I300;3)', fmt: 'int' },
      },
      cf: [
        { range: 'A6:K300', type: 'formula', f: '=$G6<>""', style: 'done' },
        { range: 'I6:I300', type: 'eq', v1: '1', style: 'yellow' }, { range: 'I6:I300', type: 'eq', v1: '2', custom: { fill: '#FFD8A8', color: '#8A3B00' } }, { range: 'I6:I300', type: 'eq', v1: '3', style: 'red' },
        { range: 'N12', type: 'gt', v1: '0', style: 'red' },
      ],
      notes: { H5: 'Tage seit der Fälligkeit, solange kein Zahlungsdatum eingetragen ist. 0 = noch nicht fällig.', I5: '0 = nicht fällig. Die Grenzen stehen in Spalte N.' },
      page: { orient: 'landscape', fit: 'width', titleRows: { r1: 5, r2: 5 } },
    }],
  },
  // 37 ------------------------------------------------------------ Preisrechner (Kalkulation)
  {
    id: 'preiskalkulation', title: 'Preisrechner (Kalkulation)', desc: 'Vom Material und der Arbeitszeit über Zuschläge zum Netto- und Bruttopreis – und rückwärts', cat: 'Business', accent: 'green',
    keywords: 'kalkulation preis zuschlag gewinn stundensatz verkaufspreis handwerk',
    sheets: [{
      name: 'Kalkulation', cols: [300, 110, 120, 24, 300], start: 'B5',
      rows: [
        [{ v: 'Preisrechner (Zuschlagskalkulation)', s: 'title' }],
        [{ v: 'Gelbe Felder ausfüllen. Kleinunternehmer ohne Umsatzsteuer tragen 0 % ein.', s: 'sub' }],
        [],
        [{ v: 'Position', s: 'head' }, { v: 'Eingabe', s: 'headR' }, { v: 'Betrag', s: 'headR' }],
        ['Materialkosten', { v: 120, s: 'input', fmt: 'eur' }, { f: '=B5', fmt: 'eur' }],
        ['Arbeitszeit (Stunden)', { v: 3, s: 'input', fmt: 'dec2' }, null],
        ['Stundensatz → Lohnkosten', { v: 55, s: 'input', fmt: 'eur' }, { f: '=B6*B7', fmt: 'eur' }],
        ['Fremdleistungen / Sonstiges', { v: 0, s: 'input', fmt: 'eur' }, { f: '=B8', fmt: 'eur' }],
        [{ v: 'Einzelkosten', s: 'total' }, { v: null, s: 'total' }, { f: '=C5+C7+C8', s: 'total', fmt: 'eur' }],
        ['Gemeinkostenzuschlag', { v: 0.15, s: 'input', fmt: 'pct0' }, { f: '=C9*B10', fmt: 'eur' }],
        [{ v: 'Selbstkosten', s: 'label' }, null, { f: '=C9+C10', fmt: 'eur', s: 'label' }],
        ['Gewinnzuschlag', { v: 0.2, s: 'input', fmt: 'pct0' }, { f: '=C11*B12', fmt: 'eur' }],
        [{ v: 'Nettopreis', s: 'big' }, null, { f: '=C11+C12', fmt: 'eur', s: 'big' }],
        ['Umsatzsteuer', { v: 0.19, s: 'input', fmt: 'pct0' }, { f: '=C13*B14', fmt: 'eur' }],
        [{ v: 'Bruttopreis', s: 'big' }, null, { f: '=C13+C14', fmt: 'eur', s: 'big' }],
        ['Gerundet auf volle … Euro (brutto)', { v: 5, s: 'input', fmt: 'int' }, { f: '=WENN(B16>0;OBERGRENZE(C15;B16);C15)', fmt: 'eur' }],
        ['Marge netto beim gerundeten Preis', null, { f: '=C16/(1+B14)-C11', fmt: 'eurRed' }],
        ['Marge in % vom Nettopreis', null, { f: '=WENN(C16=0;"";C17/(C16/(1+B14)))', fmt: 'pct' }],
        [],
        [{ v: 'Rückwärts: Was darf es kosten?', s: 'head' }, { v: 'Eingabe', s: 'headR' }, { v: 'Betrag', s: 'headR' }],
        ['Zielpreis brutto (z. B. Marktpreis)', { v: 450, s: 'input', fmt: 'eur' }, { f: '=B21/(1+B14)', fmt: 'eur' }],
        ['Höchstens erlaubte Selbstkosten', null, { f: '=C21/(1+B12)', fmt: 'eur' }],
        ['Höchstens erlaubte Einzelkosten', null, { f: '=C22/(1+B10)', fmt: 'eur' }],
        [{ v: 'Spielraum für die Arbeitszeit (Stunden)', s: 'label' }, null, { f: '=WENN(B7>0;(C23-C5-C8)/B7;"")', fmt: 'dec2', s: 'label' }],
      ],
      cf: [{ range: 'C17', type: 'lt', v1: '0', style: 'red' }, { range: 'C24', type: 'lt', v1: '0', style: 'red' }],
      notes: { B10: 'Anteil für Miete, Fahrzeug, Versicherung, Verwaltung usw. auf die Einzelkosten.', C21: 'Zielpreis ohne Umsatzsteuer.', C24: 'So viele Stunden passen in den Zielpreis, wenn Material und Fremdleistungen gleich bleiben.' },
      page: { orient: 'portrait', fit: 'width', grid: false, head: false },
    }],
  },
  // 38 ------------------------------------------------------------ Break-even
  {
    id: 'break-even', title: 'Break-even-Rechner', desc: 'Ab welcher Menge sich ein Produkt trägt: Deckungsbeitrag, Gewinnschwelle und Gewinn-Verlust-Tabelle mit Diagramm', cat: 'Business', accent: 'indigo',
    keywords: 'break even gewinnschwelle deckungsbeitrag fixkosten variable kosten menge',
    sheets: [{
      name: 'Break-even', cols: [280, 120, 24, 100, 120, 130, 130], freeze: 0, start: 'B4',
      rows: [
        [{ v: 'Break-even-Rechner', s: 'title' }],
        [{ v: 'Fixkosten, Preis und variable Kosten eintragen (alles netto, pro Monat). Rechts siehst du Gewinn und Verlust je Menge.', s: 'sub' }],
        [],
        [{ v: 'Fixkosten pro Monat', s: 'label' }, { v: 4000, s: 'input', fmt: 'eur' }, null, { v: 'Menge', s: 'headR' }, { v: 'Umsatz', s: 'headR' }, { v: 'Gesamtkosten', s: 'headR' }, { v: 'Gewinn / Verlust', s: 'headR' }],
        [{ v: 'Verkaufspreis pro Stück', s: 'label' }, { v: 25, s: 'input', fmt: 'eur' }],
        [{ v: 'Variable Kosten pro Stück', s: 'label' }, { v: 11, s: 'input', fmt: 'eur' }],
        [{ v: 'Geplante Menge pro Monat', s: 'label' }, { v: 400, s: 'input', fmt: 'num' }],
        [{ v: 'Schrittweite der Tabelle', s: 'label' }, { v: 50, s: 'input', fmt: 'num' }],
        [],
        [{ v: 'Deckungsbeitrag pro Stück', s: 'label' }, { f: '=B5-B6', fmt: 'eurRed' }],
        [{ v: 'Deckungsbeitragsquote', s: 'label' }, { f: '=WENN(B5>0;B10/B5;"")', fmt: 'pct' }],
        [{ v: 'Break-even-Menge', s: 'big' }, { f: '=WENN(B10<=0;"nicht erreichbar";AUFRUNDEN(B4/B10;0))', fmt: 'num', s: 'big' }],
        [{ v: 'Break-even-Umsatz', s: 'label' }, { f: '=WENN(ISTZAHL(B12);B12*B5;"")', fmt: 'eur' }],
        [{ v: 'Gewinn bei geplanter Menge', s: 'label' }, { f: '=B7*B10-B4', fmt: 'eurRed' }],
        [{ v: 'Sicherheitsabstand', s: 'label' }, { f: '=WENN(UND(ISTZAHL(B12);B7>0);(B7-B12)/B7;"")', fmt: 'pct' }],
      ],
      patch: Object.fromEntries(Array.from({ length: 21 }, (_, i) => {
        const r = 5 + i;
        return [[`D${r}`, i === 0 ? { v: 0, fmt: 'num' } : { f: `=D${r - 1}+$B$8`, fmt: 'num' }], [`E${r}`, { f: `=D${r}*$B$5`, fmt: 'eur' }], [`F${r}`, { f: `=$B$4+D${r}*$B$6`, fmt: 'eur' }], [`G${r}`, { f: `=E${r}-F${r}`, fmt: 'eurRed' }]];
      }).flat()),
      cf: [{ range: 'G5:G25', type: 'lt', v1: '0', style: 'red' }, { range: 'G5:G25', type: 'ge', v1: '0', style: 'green' }, { range: 'B14', type: 'lt', v1: '0', style: 'red' }],
      charts: [{ type: 'line', range: 'D4:F25', title: 'Umsatz und Kosten', at: 'I3', w: 460, h: 300, legend: 'b' }],
      notes: { B10: 'Preis minus variable Kosten: So viel trägt jedes Stück zu den Fixkosten bei.', B12: 'Fixkosten ÷ Deckungsbeitrag, aufgerundet auf ganze Stück.', B15: 'Um wie viel Prozent die geplante Menge sinken darf, bevor Verlust entsteht.' },
      page: { orient: 'landscape', fit: 'width', grid: false, head: false },
    }],
  },
];

/** Gallery metadata (no sheet data): id, title, desc, cat, keywords, accent. "leer" first. */
export const SHEET_TEMPLATE_LIST = [
  { id: 'leer', title: 'Leere Tabelle', desc: 'Raster mit 26 Spalten', cat: 'Allgemein', keywords: 'neu leer', accent: 'slate' },
  ...SHEET_TEMPLATE_DEFS.map(({ id, title, desc, cat, keywords, accent }) => ({ id, title, desc, cat, keywords, accent })),
];
export const SHEET_TEMPLATE_CATS = ['Alle', 'Finanzen', 'Arbeit', 'Business', 'Zuhause', 'Schule & Freizeit', 'Verein'];

// ---------------------------------------------------------------- builder
const pad = n => String(n).padStart(2, '0');
function dateValue(spec, today) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let d;
  switch (spec.date) {
    case 'today': d = t; break;
    case 'month': d = new Date(t.getFullYear(), t.getMonth(), 1); break;
    case 'nextmonth': d = new Date(t.getFullYear(), t.getMonth() + 1, 1); break;
    case 'week': d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)); break;
    case 'year': d = new Date(t.getFullYear(), 0, 1); break;
    default: { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(spec.date || ''); d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : t; }
  }
  if (spec.years) d = new Date(d.getFullYear() + spec.years, d.getMonth(), d.getDate());
  if (spec.months) d = new Date(d.getFullYear(), d.getMonth() + spec.months, d.getDate());
  if (spec.add) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + spec.add);
  return dateToSerial(d);
}
const subst = (text, r) => String(text).replace(/\{r([+-]\d+)?\}/g, (m, off) => String(r + (off ? +off : 0)));
function styleOf(s, S) {
  if (!s) return null;
  if (typeof s === 'string') return { ...(S[s] || {}) };
  if (Array.isArray(s)) return s.reduce((a, x) => ({ ...a, ...(typeof x === 'string' ? S[x] || {} : x) }), {});
  return { ...s };
}
function putCell(sh, r, c, spec, S, today, rowNo) {
  if (spec === null || spec === undefined || spec === '') return;
  const cell = {};
  let o = spec;
  if (typeof spec !== 'object') o = typeof spec === 'string' && spec.startsWith('=') ? { f: spec } : { v: spec };
  const st = styleOf(o.s, S);
  if (st) cell.s = st;
  if (o.fmt) cell.s = { ...(cell.s || {}), fmt: FMT[o.fmt] || o.fmt };
  if (o.f) { cell.f = toCanonical(subst(o.f, rowNo).replace(/^=/, '')); cell.da = true; }
  else if (o.date) cell.v = dateValue(o, today);
  else if (o.v !== undefined && o.v !== null) cell.v = typeof o.v === 'string' ? subst(o.v, rowNo) : o.v;
  if (cell.v === undefined && !cell.f && !cell.s) return;
  setCell(sh, r, c, cell);
  if (o.link) sh.links.set(KEY(r, c), { url: o.link });
}

/**
 * Build a workbook from a template id (or definition). Returns null for unknown ids; "leer" gives an empty workbook.
 * options.today: Date used for relative dates (default: now).
 */
export function buildSheetTemplate(idOrDef, { today = new Date() } = {}) {
  const def = typeof idOrDef === 'object' ? idOrDef : SHEET_TEMPLATE_DEFS.find(t => t.id === idOrDef);
  const wb = newWorkbook();
  if (!def) return idOrDef === 'leer' ? wb : null;
  const S = styles(def.accent);
  wb.sheets = def.sheets.map(sd => {
    const sh = newSheet(sd.name.slice(0, 31));
    let r = 0;
    for (const row of sd.rows) {
      const list = Array.isArray(row) ? [{ cells: row }] : row.repeat ? Array.from({ length: row.repeat }, () => ({ cells: row.cells, h: row.h })) : [row];
      for (const one of list) {
        (one.cells || []).forEach((spec, c) => putCell(sh, r, c, spec, S, today, r + 1));
        if (one.h) sh.rowH.set(r, one.h);
        r++;
      }
    }
    for (const [a, spec] of Object.entries(sd.patch || {})) { const p = parseAddr(a); if (p) putCell(sh, p.r, p.c, spec, S, today, p.r + 1); }
    for (const [row, px] of Object.entries(sd.rowH || {})) sh.rowH.set(+row - 1, px);
    (sd.cols || []).forEach((w, i) => { if (w) sh.colW[i] = w; });
    sh.freeze = sd.freeze || 0; sh.freezeC = sd.freezeC || 0;
    if (sd.tabColor) sh.tabColor = sd.tabColor;
    for (const m of sd.merges || []) { const g = parseRangeAddr(m); if (g) sh.merges.push(g); }
    let id = 0;
    sh.cf = (sd.cf || []).map(rule => {
      const x = { id: `${def.id}-cf${++id}`, ...rule };
      if (rule.type === 'formula') { x.f = toCanonical(rule.f.replace(/^=/, '')); x.fd = toDisplay(x.f); }
      if (!x.style && !x.custom && !['scale', 'bar', 'icons'].includes(x.type)) x.style = 'red';
      return x;
    });
    sh.dv = (sd.dv || []).map(d => ({ list: [], ...d, ...(d.list ? { type: 'list' } : {}) }));
    for (const [a, text] of Object.entries(sd.notes || {})) { const p = parseAddr(a); if (p) sh.notes.set(KEY(p.r, p.c), { text }); }
    if (sd.autoFilter) sh.autoFilter = { range: sd.autoFilter, filters: {} };
    if (sd.page) sh.page = { ...sd.page };
    sh.charts = (sd.charts || []).map((ch, i) => {
      const p = parseAddr(ch.at || 'H2');
      let x = 0; for (let c = 0; c < p.c; c++) x += sh.colW[c] == null ? DEFAULT_COL_W : sh.colW[c];
      const out = { id: `${def.id}-ch${i + 1}`, type: ch.type, range: ch.range, title: ch.title || '', xTitle: '', yTitle: '', legend: ch.legend || 'b', palette: 'standard', byRows: null, series: null, colors: null, x: x + 12, y: p.r * ROW_H, w: ch.w || 440, h: ch.h || 280 };
      if (ch.valuesCol) {
        // categories in the first column of the range (below its header row), values in another column of the same rows
        const g = parseRangeAddr(ch.range);
        const q = `'${sd.name.replace(/'/g, "''")}'!`;
        const cc = colName(g.c1);
        out.series = [{ name: ch.seriesName || ch.title || '', cat: `${q}$${cc}$${g.r1 + 2}:$${cc}$${g.r2 + 1}`, val: `${q}$${ch.valuesCol}$${g.r1 + 2}:$${ch.valuesCol}$${g.r2 + 1}` }];
      }
      return out;
    });
    sh.start = sd.start || null;
    return sh;
  });
  wb.names = (def.names || []).map(n => ({ ...n, si: null }));
  return wb;
}
