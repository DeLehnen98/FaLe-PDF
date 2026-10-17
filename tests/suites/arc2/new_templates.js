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
