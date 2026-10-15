// Dokumentvorlagen für die Textverarbeitung – eigene Entwürfe, reine Daten (keine DOM-/App-Abhängigkeiten),
// damit sie auch außerhalb des Editors (z. B. im Web-Archiv oder in Node) wiederverwendet werden können.
//
//   DOC_TEMPLATE_CATS            Kategorien für die Vorlagen-Galerie ('Alle' zuerst)
//   DOC_TEMPLATE_LIST            [{ id, title, desc, cat, keywords, accent, page?, hf?, styles?, html(ctx) }]
//   buildDocTemplate(id, opts)   → { id, title, name, html, page, hf, styles } (Datum = heute oder opts.date)
//
// html ist Editor-HTML (dieselben Markierungen wie im Editor: <p class="title">, <div class="toc" data-toc>,
// <sup class="fn" data-fn>, <span class="tf" data-f> für Tabellenformeln, <div class="sect" data-cols> …).
// page: Seitenformat in pt { w, h, mt, mr, mb, ml }. hf: Kopf-/Fußzeile (siehe hfnorm.js). styles: Formatvorlagen-Änderungen.
// Alle Namen, Adressen und Zahlen sind Platzhalter zum Überschreiben.

export const DOC_TEMPLATE_CATS = ['Alle', 'Bewerbung', 'Briefe', 'Geschäftlich', 'Schule & Studium', 'Privat & Freizeit'];

const A4 = { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
const A4_DIN = { w: 595.3, h: 841.9, mt: 48, mr: 56.7, mb: 56.7, ml: 70.9 };
const A4_NARROW = { w: 595.3, h: 841.9, mt: 42.5, mr: 42.5, mb: 42.5, ml: 42.5 };
const A4_LAND = { w: 841.9, h: 595.3, mt: 56.7, mr: 56.7, mb: 42.5, ml: 56.7 };

const ACC = '#3B37A0';
const TEAL = '#0B8F80';
const CORAL = '#C2410C';
const GREY = '#6B7194';
const SERIF = "'Times New Roman', 'Liberation Serif', Times, serif";

const clean = html => html.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
const fmtDate = (d, long = false) => d.toLocaleDateString('de-DE', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
const plusDays = (d, n) => new Date(d.getTime() + n * 86400000);
const muted = (t, size = 9) => `<span style="font-size:${size}pt;color:${GREY}">${t}</span>`;
const colgroup = widths => `<colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>`;
/** Table helper: rows = arrays of cell HTML (already wrapped in <p>); opts.cls / opts.hdr (first row repeats) / opts.shade (header fill). */
function table(widths, rows, { cls = '', hdr = false, shade = null } = {}) {
  return `<table${cls ? ` class="${cls}"` : ''}>${colgroup(widths)}<tbody>${rows.map((r, i) => `<tr${hdr && i === 0 ? ' data-hdr=""' : ''}>${r.map(c => `<td${shade && i === 0 ? ` style="background-color:${shade}"` : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const p = (t, style = '') => `<p${style ? ` style="${style}"` : ''}>${t}</p>`;
const pr = t => p(t, 'text-align:right');
const pc = t => p(t, 'text-align:center');
const b = t => `<strong>${t}</strong>`;
const fn = t => `<sup class="fn" data-fn="${t}" contenteditable="false"></sup>`;
const tf = (f, shown, fmt = '0,00 €') => `<span class="tf" data-f="${f}" data-fmt="${fmt}" contenteditable="false">${shown}</span>`;
const empty = '<p><br></p>';
const TOC = '<div class="toc" data-toc data-toc-title="Inhaltsverzeichnis" contenteditable="false"></div>';
const PAGEBREAK = '<hr data-page-break>';
const PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><rect width="300" height="400" fill="#EEF0F6"/><circle cx="150" cy="150" r="70" fill="#C9CCDA"/><path d="M40 360c10-80 60-120 110-120s100 40 110 120z" fill="#C9CCDA"/><text x="150" y="388" font-family="Arial,sans-serif" font-size="22" text-anchor="middle" fill="#6B7194">Foto einfügen</text></svg>');

export const DOC_TEMPLATE_LIST = [
  {
    id: 'leer', title: 'Leeres Dokument', desc: 'Weißes Blatt im A4-Format', cat: 'Alle', keywords: 'neu blank leer', accent: 'indigo',
    html: () => '<p><br></p>',
  },
  // ---------------------------------------------------------------- Bewerbung
  {
    id: 'lebenslauf-klassisch', title: 'Lebenslauf – Klassisch', desc: 'Tabellarisch, schlicht, gut lesbar für Bewerbungsportale', cat: 'Bewerbung', keywords: 'cv vita lebenslauf tabellarisch bewerbung', accent: 'slate',
    html: ({ today }) => clean(`
      <h1>Vorname Nachname</h1>
      <p>Musterstraße 12 · 66111 Saarbrücken · 0170 1234567 · name@example.de</p>
      <hr>
      <h2>Berufserfahrung</h2>
      ${table([26, 74], [
        [p('03/2022 – heute'), `${p(`${b('Projektmanagerin')} · Beispiel GmbH, Saarbrücken`)}<ul><li>Leitung von Projekten mit bis zu 12 Beteiligten</li><li>Einführung eines digitalen Ablagesystems</li></ul>`],
        [p('08/2018 – 02/2022'), `${p(`${b('Sachbearbeiterin')} · Muster AG, Homburg`)}<ul><li>Kundenbetreuung und Angebotserstellung</li></ul>`],
      ], { cls: 'borderless' })}
      <h2>Ausbildung</h2>
      ${table([26, 74], [
        [p('2015 – 2018'), p(`${b('Bachelor of Arts, Betriebswirtschaft')} · Hochschule Musterstadt`)],
        [p('2015'), p(`${b('Abitur')} · Gymnasium am Beispiel`)],
      ], { cls: 'borderless' })}
      <h2>Kenntnisse</h2>
      ${table([26, 74], [
        [p('Software'), p('Office-Programme, Projektplanung, Grundlagen Buchhaltung')],
        [p('Sprachen'), p('Deutsch (Muttersprache), Englisch (fließend), Französisch (Grundkenntnisse)')],
        [p('Führerschein'), p('Klasse B')],
      ], { cls: 'borderless' })}
      ${empty}
      <p>Saarbrücken, ${today}</p>`),
  },
  {
    id: 'lebenslauf-modern', title: 'Lebenslauf – Modern', desc: 'Farbige Überschriften, klare Abschnitte', cat: 'Bewerbung', keywords: 'cv vita lebenslauf design kreativ', accent: 'indigo',
    html: () => clean(`
      <h1><span style="color:${ACC}">Vorname</span> Nachname</h1>
      <p class="subtitle">Grafikdesignerin mit Schwerpunkt Markenauftritt</p>
      ${table([34, 33, 33], [[p(`${b('Telefon')}<br>0170 1234567`), p(`${b('E-Mail')}<br>name@example.de`), p(`${b('Ort')}<br>66111 Saarbrücken`)]], { cls: 'borderless' })}
      <h2><span style="color:${ACC}">Profil</span></h2>
      <p>Kreativ, strukturiert und lösungsorientiert. Seit über fünf Jahren entwickle ich Erscheinungsbilder für kleine und mittlere Unternehmen – von der ersten Skizze bis zur fertigen Druckdatei.</p>
      <h2><span style="color:${ACC}">Stationen</span></h2>
      <h3>Senior Designerin · Studio Beispiel</h3>
      <p><span style="color:${GREY}">seit 2021 · Saarbrücken</span></p>
      <ul><li>Verantwortung für 20+ Kundenprojekte pro Jahr</li><li>Aufbau einer gemeinsamen Gestaltungsbibliothek</li></ul>
      <h3>Designerin · Agentur Muster</h3>
      <p><span style="color:${GREY}">2018 – 2021 · Mannheim</span></p>
      <ul><li>Gestaltung von Kampagnen, Broschüren und Webseiten</li></ul>
      <h2><span style="color:${ACC}">Ausbildung</span></h2>
      <p>${b('B.A. Kommunikationsdesign')} · Hochschule Musterstadt, 2014 – 2018</p>
      <h2><span style="color:${ACC}">Fähigkeiten</span></h2>
      <p>Typografie · Layout · Bildbearbeitung · Illustration · Präsentation · Englisch (C1)</p>`),
  },
  {
    id: 'anschreiben', title: 'Bewerbungsanschreiben', desc: 'Klassischer Aufbau mit Betreff und Anlagen', cat: 'Bewerbung', keywords: 'anschreiben bewerbung motivationsschreiben brief', accent: 'indigo', page: A4_DIN,
    html: ({ today, longDate }) => clean(`
      <p>Vorname Nachname<br>Musterstraße 12<br>66111 Saarbrücken<br>0170 1234567 · name@example.de</p>
      ${empty}
      <p>Beispiel GmbH<br>Personalabteilung<br>Frau Erika Muster<br>Hauptstraße 1<br>66111 Saarbrücken</p>
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      <p>${b(`Bewerbung als Projektmanagerin – Ihre Stellenanzeige vom ${today}`)}</p>
      <p>Sehr geehrte Frau Muster,</p>
      <p>mit großem Interesse habe ich Ihre Stellenanzeige gelesen. Die beschriebenen Aufgaben passen sehr gut zu meinen Erfahrungen und Zielen – deshalb bewerbe ich mich bei Ihnen.</p>
      <p>In meiner aktuellen Position bei der Muster AG verantworte ich … (Beschreibe hier deine wichtigsten Erfolge und was du mitbringst.)</p>
      <p>Besonders reizt mich an Ihrem Unternehmen … (Warum genau diese Firma?)</p>
      <p>Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr. Mein frühestmöglicher Eintrittstermin ist der 1. des Folgemonats.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}
      <p>Vorname Nachname</p>
      <p>${muted('Anlagen: Lebenslauf, Zeugnisse', 10)}</p>`),
  },
  {
    id: 'bewerbung-deckblatt', title: 'Bewerbung – Deckblatt', desc: 'Titelseite mit Foto, Kontaktdaten und Anlagenverzeichnis', cat: 'Bewerbung', keywords: 'deckblatt bewerbungsmappe titelblatt foto', accent: 'teal',
    html: () => clean(`
      ${empty}
      <p class="title" style="text-align:center"><span style="color:${TEAL}">Bewerbung</span></p>
      <p class="subtitle" style="text-align:center">als Projektmanagerin bei der Beispiel GmbH</p>
      ${empty}
      <p style="text-align:center"><img src="${PHOTO}" alt="Bewerbungsfoto (Platzhalter)" width="170"></p>
      ${empty}
      <p style="text-align:center"><span style="font-size:18pt"><strong>Vorname Nachname</strong></span></p>
      <p style="text-align:center">Musterstraße 12 · 66111 Saarbrücken</p>
      <p style="text-align:center">0170 1234567 · name@example.de</p>
      ${empty}
      <h2 style="text-align:center"><span style="color:${TEAL}">Anlagen</span></h2>
      ${table([20, 60, 20], [
        [p(''), p('1. Anschreiben'), p('')],
        [p(''), p('2. Lebenslauf'), p('')],
        [p(''), p('3. Arbeitszeugnisse'), p('')],
        [p(''), p('4. Abschlusszeugnis und Zertifikate'), p('')],
      ], { cls: 'borderless' })}`),
  },
  // ---------------------------------------------------------------- Briefe
  {
    id: 'brief', title: 'Brief (DIN 5008)', desc: 'Geschäftsbrief mit Anschriftfeld und Infoblock', cat: 'Briefe', keywords: 'geschäftsbrief din 5008 form b briefvorlage firma', accent: 'slate', page: A4_DIN,
    html: ({ today }) => clean(`
      <p><span style="font-size:8pt;color:${GREY}"><u>Firma Beispiel · Musterstraße 12 · 66111 Saarbrücken</u></span></p>
      ${table([58, 42], [[p('Herrn<br>Max Mustermann<br>Beispielweg 5<br>66123 Saarbrücken'), p(`<span style="font-size:9pt">Ihr Zeichen: ab-12<br>Unser Zeichen: fl-34<br>Telefon: 0681 123456<br>E-Mail: info@example.de<br>Datum: ${today}</span>`)]], { cls: 'borderless' })}
      ${empty}
      <p>${b(`Betreff: Ihre Anfrage vom ${today}`)}</p>
      ${empty}
      <p>Sehr geehrter Herr Mustermann,</p>
      <p>vielen Dank für Ihre Anfrage. Gerne senden wir Ihnen folgende Informationen …</p>
      <p>Für Rückfragen stehen wir Ihnen jederzeit zur Verfügung.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}
      <p>Vorname Nachname<br>Firma Beispiel</p>
      ${empty}
      <p>${muted('Bankverbindung: Beispielbank · IBAN DE00 0000 0000 0000 0000 00 · Geschäftsführung: Vorname Nachname · Amtsgericht Saarbrücken HRB 00000', 8)}</p>`),
  },
  {
    id: 'brief-privat', title: 'Privatbrief', desc: 'Persönlicher Brief nach DIN 5008 – ohne Infoblock', cat: 'Briefe', keywords: 'brief privat anschreiben behörde vermieter', accent: 'indigo', page: A4_DIN,
    html: ({ longDate }) => clean(`
      <p>Vorname Nachname · Musterstraße 12 · 66111 Saarbrücken</p>
      ${empty}
      <p>Frau<br>Erika Beispiel<br>Am Markt 3<br>66123 Saarbrücken</p>
      ${empty}
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      ${empty}
      <p>${b('Betreff in einer Zeile')}</p>
      ${empty}
      <p>Sehr geehrte Frau Beispiel,</p>
      <p>schreibe hier dein Anliegen in kurzen Absätzen. Ein Gedanke pro Absatz macht den Brief leicht lesbar.</p>
      <p>Nenne zum Schluss, was du dir wünschst – etwa eine Antwort bis zu einem bestimmten Datum.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}${empty}
      <p>Vorname Nachname</p>`),
  },
  {
    id: 'kuendigung', title: 'Kündigung', desc: 'Kündigungsschreiben für Verträge mit Bitte um Bestätigung', cat: 'Briefe', keywords: 'kündigung vertrag abo mitgliedschaft fitness handy versicherung', accent: 'coral', page: A4_DIN,
    html: ({ longDate }) => clean(`
      <p>Vorname Nachname<br>Musterstraße 12<br>66111 Saarbrücken</p>
      ${empty}
      <p>Beispiel Anbieter GmbH<br>Kundenservice<br>Postfach 12 34<br>12345 Musterstadt</p>
      ${empty}
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      ${empty}
      <p>${b('Kündigung meines Vertrags')}<br>Vertrags-/Kundennummer: 000000</p>
      ${empty}
      <p>Sehr geehrte Damen und Herren,</p>
      <p>hiermit kündige ich den oben genannten Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.</p>
      <p>Bitte bestätigen Sie mir den Eingang dieser Kündigung sowie das genaue Vertragsende schriftlich. Einer Verlängerung oder einem Wechsel in einen anderen Tarif stimme ich nicht zu.</p>
      <p>Eine erteilte Einzugsermächtigung (SEPA-Lastschriftmandat) widerrufe ich zum Vertragsende.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}${empty}
      <p>Vorname Nachname</p>
      ${empty}
      <p>${muted('Tipp: Kündigungen sicher zustellen, z. B. per Einschreiben, und eine Kopie aufbewahren.', 9)}</p>`),
  },
  // ---------------------------------------------------------------- Geschäftlich
  {
    id: 'rechnung', title: 'Rechnung', desc: 'Positionen, Netto, MwSt. und Gesamtbetrag – rechnet selbst', cat: 'Geschäftlich', keywords: 'rechnung invoice mwst umsatzsteuer freiberufler', accent: 'indigo',
    html: ({ today, date }) => clean(`
      ${table([60, 40], [[`<h1><span style="color:${ACC}">Rechnung</span></h1>`, pr(`${b('Firma Beispiel')}<br>Musterstraße 12<br>66111 Saarbrücken<br>info@example.de`)]], { cls: 'borderless' })}
      ${table([60, 40], [[p(`${b('Rechnung an')}<br>Kunde GmbH<br>Frau Erika Muster<br>Hauptstraße 1<br>66123 Saarbrücken`), p(`Rechnungsnummer: ${b('2026-001')}<br>Rechnungsdatum: ${today}<br>Leistungszeitraum: ${today}<br>Kundennummer: K-1001<br>Fällig bis: ${fmtDate(plusDays(date, 14))}`)]], { cls: 'borderless' })}
      ${empty}
      ${table([7, 41, 12, 20, 20], [
        [p(b('Pos.')), p(b('Beschreibung')), pr(b('Menge')), pr(b('Einzelpreis')), pr(b('Gesamt'))],
        [p('1'), p('Beratung (Stunden)'), pr('4'), pr('85,00 €'), pr(tf('=C2*D2', '340,00 €'))],
        [p('2'), p('Gestaltung Flyer'), pr('1'), pr('250,00 €'), pr(tf('=C3*D3', '250,00 €'))],
        [p('3'), p('Druckdaten-Prüfung'), pr('1'), pr('40,00 €'), pr(tf('=C4*D4', '40,00 €'))],
        [p(''), p(''), p(''), pr('Nettobetrag'), pr(tf('=SUM(E2:E4)', '630,00 €'))],
        [p(''), p(''), p(''), pr('zzgl. 19 % USt.'), pr(tf('=E5*19/100', '119,70 €'))],
        [p(''), p(''), p(''), pr(b('Gesamtbetrag')), pr(b(tf('=E5+E6', '749,70 €')))],
      ], { cls: 'ts-minimal', hdr: true })}
      <p>Bitte überweise den Gesamtbetrag bis zum Fälligkeitsdatum ohne Abzug auf das unten genannte Konto. Vielen Dank für deinen Auftrag!</p>
      <p>${muted('Beispielbank · IBAN DE00 0000 0000 0000 0000 00 · BIC BEISPXXX · Steuernummer 000/000/00000')}</p>`),
  },
  {
    id: 'angebot', title: 'Angebot', desc: 'Kostenvoranschlag mit Positionen, Gültigkeit und Bedingungen', cat: 'Geschäftlich', keywords: 'angebot kostenvoranschlag offerte handwerk dienstleistung', accent: 'teal',
    html: ({ today, date }) => clean(`
      ${table([60, 40], [[`<h1><span style="color:${TEAL}">Angebot</span></h1>`, pr(`${b('Firma Beispiel')}<br>Musterstraße 12<br>66111 Saarbrücken<br>0681 123456`)]], { cls: 'borderless' })}
      ${table([60, 40], [[p(`Kunde GmbH<br>Herr Max Mustermann<br>Hauptstraße 1<br>66123 Saarbrücken`), p(`Angebotsnummer: ${b('A-2026-014')}<br>Datum: ${today}<br>Gültig bis: ${fmtDate(plusDays(date, 30))}`)]], { cls: 'borderless' })}
      ${empty}
      <p>Sehr geehrter Herr Mustermann,</p>
      <p>vielen Dank für Ihr Interesse. Gerne bieten wir Ihnen folgende Leistungen an:</p>
      ${table([7, 41, 12, 20, 20], [
        [p(b('Pos.')), p(b('Leistung')), pr(b('Menge')), pr(b('Preis')), pr(b('Summe'))],
        [p('1'), p('Bestandsaufnahme vor Ort'), pr('1'), pr('120,00 €'), pr(tf('=C2*D2', '120,00 €'))],
        [p('2'), p('Umsetzung (Stunden)'), pr('12'), pr('68,00 €'), pr(tf('=C3*D3', '816,00 €'))],
        [p('3'), p('Material laut Aufstellung'), pr('1'), pr('245,50 €'), pr(tf('=C4*D4', '245,50 €'))],
        [p(''), p(''), p(''), pr('Netto'), pr(tf('=SUM(E2:E4)', '1.181,50 €'))],
        [p(''), p(''), p(''), pr('19 % USt.'), pr(tf('=E5*19/100', '224,49 €'))],
        [p(''), p(''), p(''), pr(b('Angebotssumme')), pr(b(tf('=E5+E6', '1.405,99 €')))],
      ], { cls: 'ts-striped', hdr: true })}
      <h3>Bedingungen</h3>
      <ul><li>Ausführung nach Absprache innerhalb von drei Wochen nach Auftragserteilung</li><li>Zahlung: 14 Tage nach Rechnungsstellung ohne Abzug</li><li>Mehraufwand wird nur nach vorheriger Rücksprache berechnet</li></ul>
      <p>Wir freuen uns auf Ihren Auftrag. Bei Fragen erreichen Sie uns jederzeit.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}
      <p>Vorname Nachname</p>`),
  },
  {
    id: 'protokoll', title: 'Besprechungsprotokoll', desc: 'Teilnehmende, Tagesordnung, Beschlüsse und Aufgaben', cat: 'Geschäftlich', keywords: 'protokoll meeting sitzung besprechung verein beschluss aufgaben', accent: 'blue',
    hf: { footer: 'Protokoll · vertraulich', footerAlign: 'left', pageNumbers: 'footer-right', pageFormat: 'n-of-m' },
    html: ({ today }) => clean(`
      <p class="title">Protokoll</p>
      <p class="subtitle">Teambesprechung Projekt „Beispiel“</p>
      ${table([28, 72], [
        [p(b('Datum')), p(today)], [p(b('Zeit')), p('10:00 – 11:15 Uhr')], [p(b('Ort')), p('Besprechungsraum 2 / Videokonferenz')],
        [p(b('Leitung')), p('Vorname Nachname')], [p(b('Protokoll')), p('Vorname Nachname')],
        [p(b('Teilnehmende')), p('A. Beispiel, B. Muster, C. Probe, D. Test')], [p(b('Entschuldigt')), p('E. Beispiel')],
      ], { cls: 'ts-minimal' })}
      <h2>Tagesordnung</h2>
      <ol><li>Begrüßung und Genehmigung des letzten Protokolls</li><li>Stand der Arbeitspakete</li><li>Budget und Zeitplan</li><li>Verschiedenes</li></ol>
      <h2>TOP 1 – Begrüßung</h2>
      <p>Das Protokoll der letzten Sitzung wird ohne Änderungen genehmigt.</p>
      <h2>TOP 2 – Stand der Arbeitspakete</h2>
      <p>Kurze Zusammenfassung der Diskussion …</p>
      <p><strong>Beschluss:</strong> Das Arbeitspaket „Konzept“ wird bis Monatsende abgeschlossen.</p>
      <h2>TOP 3 – Budget und Zeitplan</h2>
      <p>Kurze Zusammenfassung der Diskussion …</p>
      <h2>Aufgaben</h2>
      ${table([46, 20, 18, 16], [
        [p(b('Aufgabe')), p(b('Verantwortlich')), p(b('Bis')), p(b('Status'))],
        [p('Entwurf des Konzepts verschicken'), p('B. Muster'), p(today), p('offen')],
        [p('Angebote einholen'), p('C. Probe'), p(today), p('offen')],
      ], { cls: 'ts-header', hdr: true })}
      <h2>Nächster Termin</h2>
      <p>Datum, Uhrzeit, Ort</p>`),
  },
  {
    id: 'bericht', title: 'Projektbericht', desc: 'Mit Inhaltsverzeichnis, Kapiteln, Tabelle und Beschriftung', cat: 'Geschäftlich', keywords: 'bericht report projekt dokumentation inhaltsverzeichnis', accent: 'indigo',
    hf: { header: 'Projektbericht', headerAlign: 'right', pageNumbers: 'footer-center', pageFormat: 'n-of-m', firstPage: false },
    html: ({ longDate }) => clean(`
      ${empty}${empty}
      <p class="title"><span style="color:${ACC}">Projektbericht</span></p>
      <p class="subtitle">Titel des Projekts · Stand ${longDate}</p>
      ${table([30, 70], [[p(b('Projektleitung')), p('Vorname Nachname')], [p(b('Auftraggeber')), p('Beispiel GmbH')], [p(b('Zeitraum')), p('Januar – Juni')], [p(b('Version')), p('1.0')]], { cls: 'ts-minimal' })}
      ${PAGEBREAK}
      ${TOC}
      <h1>Zusammenfassung</h1>
      <p>Fasse hier in fünf bis sieben Sätzen zusammen, was erreicht wurde, wo das Projekt steht und welche Entscheidungen anstehen.</p>
      <h1>Ausgangslage und Ziele</h1>
      <p>Beschreibe den Anlass des Projekts und die vereinbarten Ziele.</p>
      <ul><li>Ziel 1: messbar formuliert</li><li>Ziel 2: messbar formuliert</li></ul>
      <h1>Vorgehen</h1>
      <h2>Phase 1 – Analyse</h2>
      <p>Was wurde untersucht, mit welchen Methoden?</p>
      <h2>Phase 2 – Umsetzung</h2>
      <p>Welche Maßnahmen wurden umgesetzt?</p>
      <h1>Ergebnisse</h1>
      ${table([40, 20, 20, 20], [
        [p(b('Kennzahl')), pr(b('Ziel')), pr(b('Ist')), pr(b('Abweichung'))],
        [p('Bearbeitungszeit (Tage)'), pr('10'), pr('8'), pr(tf('=C2-B2', '-2', '0'))],
        [p('Kundenzufriedenheit (%)'), pr('85'), pr('91'), pr(tf('=C3-B3', '6', '0'))],
      ], { cls: 'ts-header', hdr: true })}
      <p class="caption">Tabelle <span class="seq" data-seq="Tabelle" contenteditable="false">1</span>: Kennzahlen im Vergleich</p>
      <h1>Risiken und offene Punkte</h1>
      <p>Welche Risiken bestehen, und wie wird damit umgegangen?</p>
      <h1>Nächste Schritte</h1>
      <ol><li>Schritt mit Verantwortlichem und Termin</li><li>Schritt mit Verantwortlichem und Termin</li></ol>`),
  },
  {
    id: 'pressemitteilung', title: 'Pressemitteilung', desc: 'Überschrift, Vorspann, Zitat, Infokasten und Pressekontakt', cat: 'Geschäftlich', keywords: 'presse pressemitteilung medien news verein unternehmen', accent: 'coral',
    html: ({ longDate }) => clean(`
      <p>${muted('PRESSEMITTEILUNG', 10)}</p>
      <h1>Aussagekräftige Überschrift in einer Zeile</h1>
      <p class="subtitle">Unterzeile mit der wichtigsten Zusatzinformation</p>
      <p><strong>Saarbrücken, ${longDate}.</strong> Der erste Absatz beantwortet die W-Fragen: Wer hat was, wann, wo, wie und warum getan? Er steht für sich allein und wird oft unverändert übernommen.</p>
      <p>Im zweiten Absatz folgen Hintergründe und Einzelheiten – vom Wichtigen zum weniger Wichtigen.</p>
      <p class="quote">„Ein Zitat einer verantwortlichen Person macht die Meldung lebendig“, sagt Vorname Nachname, Geschäftsführerin der Beispiel GmbH.</p>
      <p>Ein abschließender Absatz nennt Termine, Verfügbarkeit oder weiterführende Informationen.</p>
      <div class="textbox" style="width:auto;border-color:#C9CCDA;background-color:#F7F7FB"><p><strong>Über die Beispiel GmbH</strong></p><p>Zwei bis drei Sätze zum Unternehmen oder Verein: Gründung, Sitz, Tätigkeit, Größe.</p></div>
      ${empty}
      <p><strong>Pressekontakt</strong><br>Vorname Nachname · 0681 123456 · presse@example.de</p>
      <p>${muted('Zeichen (mit Leerzeichen): ca. 1.500 · Abdruck honorarfrei, Beleg erbeten')}</p>`),
  },
  // ---------------------------------------------------------------- Schule & Studium
  {
    id: 'hausarbeit', title: 'Hausarbeit', desc: 'Titelblatt, Inhaltsverzeichnis, Fußnoten, Literaturverzeichnis', cat: 'Schule & Studium', keywords: 'hausarbeit seminararbeit facharbeit uni studium zitieren literatur bachelorarbeit', accent: 'slate',
    page: { w: 595.3, h: 841.9, mt: 70.9, mr: 85, mb: 70.9, ml: 70.9 },
    hf: { pageNumbers: 'footer-center', pageFormat: 'n', firstPage: false },
    styles: {
      normal: { font: 'Times New Roman', size: 12, line: 1.5, align: 'justify', after: 6 },
      title: { font: 'Times New Roman', size: 22, color: '#1A1A1A', align: 'center' },
      subtitle: { font: 'Times New Roman', size: 14, color: '#3A3F58', align: 'center' },
      h1: { font: 'Times New Roman', size: 16, color: '#1A1A1A', numbered: true },
      h2: { font: 'Times New Roman', size: 14, color: '#1A1A1A', numbered: true },
      h3: { font: 'Times New Roman', size: 12, color: '#1A1A1A', numbered: true },
      quote: { font: 'Times New Roman', size: 11, line: 1, indent: 28 },
    },
    html: ({ longDate }) => clean(`
      <p style="text-align:center">Universität Musterstadt<br>Philosophische Fakultät · Institut für Beispielwissenschaft</p>
      <p style="text-align:center">Seminar: Titel des Seminars<br>Dozentin: Prof. Dr. Vorname Nachname<br>Wintersemester 2026/27</p>
      ${empty}${empty}${empty}
      <p class="title">Titel der Hausarbeit</p>
      <p class="subtitle">Ein präziser Untertitel, der die Fragestellung eingrenzt</p>
      ${empty}${empty}${empty}${empty}
      <p style="text-align:left;line-height:1.3">Vorgelegt von:<br>Vorname Nachname<br>Matrikelnummer: 1234567<br>Studiengang: B.A. Beispielwissenschaft, 3. Fachsemester<br>E-Mail: name@uni-example.de<br>Abgabedatum: ${longDate}</p>
      ${PAGEBREAK}
      ${TOC}
      ${PAGEBREAK}
      <h1>Einleitung</h1>
      <p>Die Einleitung führt zum Thema hin, stellt die Forschungsfrage vor und erläutert den Aufbau der Arbeit. Belege werden in Fußnoten angegeben.${fn('Vgl. Nachname, Vorname: Titel des Buches. Ort: Verlag 2024, S. 12.')}</p>
      <p>Forschungsfrage: Welche … ?</p>
      <h1>Theoretischer Rahmen</h1>
      <h2>Zentrale Begriffe</h2>
      <p>Definiere die wichtigsten Begriffe und grenze sie voneinander ab.${fn('Ebd., S. 15–17.')}</p>
      <p class="quote">Längere wörtliche Zitate (mehr als drei Zeilen) werden eingerückt, einzeilig und ohne Anführungszeichen gesetzt.${fn('Nachname, Vorname: Titel des Aufsatzes. In: Zeitschrift 12 (2023), S. 45–67, hier S. 50.')}</p>
      <h2>Forschungsstand</h2>
      <p>Welche Positionen gibt es bereits, und wo setzt deine Arbeit an?</p>
      <h1>Analyse</h1>
      <p>Hauptteil der Arbeit: Untersuchung, Argumentation und Belege.</p>
      <h1>Fazit</h1>
      <p>Beantworte die Forschungsfrage, fasse die Ergebnisse zusammen und gib einen Ausblick.</p>
      ${PAGEBREAK}
      <h1>Literaturverzeichnis</h1>
      <p style="margin-left:35.4pt;text-indent:-35.4pt">Nachname, Vorname: Titel des Buches. Untertitel. Ort: Verlag 2024.</p>
      <p style="margin-left:35.4pt;text-indent:-35.4pt">Nachname, Vorname: Titel des Aufsatzes. In: Zeitschrift 12 (2023), S. 45–67.</p>
      <p style="margin-left:35.4pt;text-indent:-35.4pt">Nachname, Vorname: Titel der Webseite. URL: https://www.example.de (abgerufen am ${longDate}).</p>
      ${PAGEBREAK}
      <h1>Eigenständigkeitserklärung</h1>
      <p>Hiermit versichere ich, dass ich die vorliegende Arbeit selbstständig verfasst und keine anderen als die angegebenen Quellen und Hilfsmittel benutzt habe. Alle Stellen, die wörtlich oder sinngemäß aus Quellen übernommen wurden, sind als solche kenntlich gemacht.</p>
      ${empty}
      <p>Ort, Datum ______________________ Unterschrift ______________________</p>`),
  },
  {
    id: 'handout', title: 'Referat-Handout', desc: 'Eine Seite mit Gliederung, Kernaussagen, Begriffen und Quellen', cat: 'Schule & Studium', keywords: 'referat handout thesenpapier schule präsentation', accent: 'teal', page: A4_NARROW,
    html: ({ today }) => clean(`
      ${table([50, 50], [[p(`${b('Schule / Hochschule')}<br>Fach: Beispielfach · Klasse/Kurs: 10b`), pr(`${b('Vorname Nachname')}<br>${today}`)]], { cls: 'ts-minimal' })}
      <h1><span style="color:${TEAL}">Thema des Referats</span></h1>
      <div class="sect" data-cols="2" data-gap="18">
        <h3>Gliederung</h3>
        <ol><li>Einführung</li><li>Hintergrund</li><li>Hauptteil</li><li>Fazit</li></ol>
        <h3>Kernaussagen</h3>
        <ul><li>Erste wichtige Aussage in einem Satz</li><li>Zweite wichtige Aussage in einem Satz</li><li>Dritte wichtige Aussage in einem Satz</li></ul>
        <h3>Wichtige Begriffe</h3>
        ${table([38, 62], [[p(b('Begriff')), p('Kurze Erklärung')], [p(b('Begriff')), p('Kurze Erklärung')], [p(b('Begriff')), p('Kurze Erklärung')]], { cls: 'ts-minimal' })}
        <h3>Zum Nachdenken</h3>
        <p>Eine offene Frage für die Diskussion im Anschluss.</p>
        <h3>Quellen</h3>
        <p><span style="font-size:9pt">Nachname, Vorname: Titel. Ort: Verlag Jahr.<br>Titel der Webseite, URL (abgerufen am ${today}).</span></p>
      </div>`),
  },
  {
    id: 'stundenplan', title: 'Stundenplan', desc: 'Wochenplan Montag bis Freitag mit Zeiten', cat: 'Schule & Studium', keywords: 'stundenplan schule woche unterricht vorlesung', accent: 'blue', page: A4_LAND,
    html: () => clean(`
      <h1><span style="color:#1D4F91">Stundenplan</span></h1>
      <p>Name: ______________________ Klasse: ________ Schuljahr: ________</p>
      ${table([10, 18, 18, 18, 18, 18], [
        [p(b('Zeit')), p(b('Montag')), p(b('Dienstag')), p(b('Mittwoch')), p(b('Donnerstag')), p(b('Freitag'))],
        [p('08:00'), p('Deutsch'), p('Mathe'), p('Englisch'), p('Biologie'), p('Sport')],
        [p('08:45'), p('Deutsch'), p('Mathe'), p('Englisch'), p('Biologie'), p('Sport')],
        [p('09:45'), p('Geschichte'), p('Musik'), p('Mathe'), p('Chemie'), p('Deutsch')],
        [p('10:30'), p('Erdkunde'), p('Kunst'), p('Physik'), p('Englisch'), p('Mathe')],
        [p('11:30'), p('Religion/Ethik'), p('Kunst'), p('Informatik'), p('Politik'), p('Französisch')],
        [p('12:15'), p(''), p('Französisch'), p(''), p('AG'), p('')],
        [p('13:30'), p(''), p(''), p('AG'), p(''), p('')],
      ], { cls: 'ts-header', hdr: true })}
      <p>${muted('Tipp: Fächer mit Farben markieren (Start → Hervorheben).', 9)}</p>`),
  },
  // ---------------------------------------------------------------- Privat & Freizeit
  {
    id: 'einladung', title: 'Einladung', desc: 'Feier, Geburtstag oder Vereinsfest – mit Rückmeldung', cat: 'Privat & Freizeit', keywords: 'einladung geburtstag party feier fest hochzeit jubiläum', accent: 'rose',
    html: ({ date }) => clean(`
      ${empty}
      <p style="text-align:center"><span style="font-size:14pt;color:#9C2246">Herzliche</span></p>
      <p class="title" style="text-align:center"><span style="color:#9C2246">Einladung</span></p>
      <p class="subtitle" style="text-align:center">zu meinem 40. Geburtstag</p>
      ${empty}
      <p style="text-align:center">Ich freue mich, mit euch zu feiern – mit gutem Essen, Musik und hoffentlich viel Sonne!</p>
      ${empty}
      ${table([30, 70], [
        [pr(b('Wann')), p(`${fmtDate(plusDays(date, 30), true)}, ab 18 Uhr`)],
        [pr(b('Wo')), p('Gartenhaus am See, Uferweg 3, 66111 Saarbrücken')],
        [pr(b('Was')), p('Buffet, Getränke und Musik')],
        [pr(b('Mitbringen')), p('Gute Laune – und gern ein Lieblingslied für die Playlist')],
      ], { cls: 'borderless' })}
      ${empty}
      <p style="text-align:center"><strong>Bitte gebt mir bis ${fmtDate(plusDays(date, 16))} Bescheid, ob ihr kommt.</strong></p>
      <p style="text-align:center">0170 1234567 · name@example.de</p>`),
  },
  {
    id: 'speisekarte', title: 'Speisekarte', desc: 'Vorspeisen, Hauptgerichte, Desserts und Getränke mit Preisen', cat: 'Privat & Freizeit', keywords: 'speisekarte menü restaurant café imbiss getränkekarte kiosk', accent: 'amber',
    styles: { h2: { font: 'Georgia', color: '#8A5A00', align: 'center' }, title: { font: 'Georgia', color: '#5A3D00', align: 'center' } },
    html: () => {
      const dish = (n, d, price) => [p(`${b(n)}<br><span style="font-size:9.5pt;color:${GREY}">${d}</span>`), pr(b(price))];
      return clean(`
      <p class="title">Café am Beispielsee</p>
      <p style="text-align:center"><em>Hausgemacht · regional · mit Liebe gekocht</em></p>
      <h2>Vorspeisen</h2>
      ${table([80, 20], [dish('Tomatensuppe', 'mit Basilikum und geröstetem Brot', '5,50 €'), dish('Gemischter Salat', 'Blattsalate, Gurke, Radieschen, Hausdressing', '6,90 €')], { cls: 'borderless' })}
      <h2>Hauptgerichte</h2>
      ${table([80, 20], [dish('Saarländische Dibbelabbes', 'mit Apfelmus und grünem Salat', '12,90 €'), dish('Gemüse-Lasagne', 'mit Spinat, Ricotta und Tomatensoße', '11,50 €'), dish('Schwenkbraten', 'vom Grill, mit Kartoffelsalat', '14,90 €')], { cls: 'borderless' })}
      <h2>Desserts</h2>
      ${table([80, 20], [dish('Apfelstrudel', 'mit Vanillesoße', '5,20 €'), dish('Eisbecher', 'drei Kugeln nach Wahl, Sahne', '4,80 €')], { cls: 'borderless' })}
      <h2>Getränke</h2>
      ${table([80, 20], [dish('Kaffee / Cappuccino', 'aus fair gehandelten Bohnen', '2,80 € / 3,40 €'), dish('Hausgemachte Limonade', '0,4 l, wechselnde Sorten', '3,90 €'), dish('Apfelschorle', '0,4 l', '3,20 €')], { cls: 'borderless' })}
      ${empty}
      <p style="text-align:center">${muted('Informationen zu Allergenen und Zusatzstoffen erhalten Sie gern beim Personal. Alle Preise inkl. MwSt.', 8.5)}</p>`);
    },
  },
  {
    id: 'flyer', title: 'Flyer / Aushang', desc: 'Große Überschrift, Infokasten und Abreißzettel', cat: 'Privat & Freizeit', keywords: 'flyer aushang plakat nachhilfe verkauf suche abreißzettel schwarzes brett', accent: 'coral', page: A4_NARROW,
    html: () => {
      const tear = `<p style="text-align:center"><span style="font-size:8.5pt">Nachhilfe Mathe<br>0170 1234567</span></p>`;
      return clean(`
      <p class="title" style="text-align:center"><span style="color:${CORAL};font-size:40pt">Nachhilfe</span></p>
      <p class="subtitle" style="text-align:center"><span style="font-size:18pt">Mathe &amp; Physik · Klasse 5 bis 10</span></p>
      ${empty}
      <div class="textbox" style="width:auto;border-color:${CORAL};background-color:#FFF4EC"><p style="text-align:center"><span style="font-size:14pt"><strong>Geduldig, verständlich und mit Spaß an der Sache.</strong></span></p></div>
      ${empty}
      <ul><li><span style="font-size:14pt">Lehramtsstudentin, 4. Semester</span></li><li><span style="font-size:14pt">Einzelunterricht bei dir zu Hause oder online</span></li><li><span style="font-size:14pt">Vorbereitung auf Klassenarbeiten und Prüfungen</span></li><li><span style="font-size:14pt">Kostenlose Probestunde</span></li></ul>
      ${empty}
      <p style="text-align:center"><span style="font-size:22pt;color:${CORAL}"><strong>15 € / 60 Minuten</strong></span></p>
      <p style="text-align:center"><span style="font-size:14pt">Melde dich: 0170 1234567 · name@example.de</span></p>
      ${empty}${empty}
      <p style="text-align:center">${muted('– – – – – – – – – – – hier abtrennen – – – – – – – – – – –', 9)}</p>
      ${table([12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5], [[tear, tear, tear, tear, tear, tear, tear, tear]])}`);
    },
  },
  {
    id: 'urkunde', title: 'Urkunde', desc: 'Querformat für Sieger, Ehrungen oder Teilnahme', cat: 'Privat & Freizeit', keywords: 'urkunde zertifikat ehrung sieger teilnahme sportfest verein', accent: 'amber', page: A4_LAND,
    html: ({ longDate }) => clean(`
      ${empty}
      <p class="title" style="text-align:center"><span style="color:#8A5A00;font-size:44pt;font-family:Georgia, serif">Urkunde</span></p>
      ${empty}
      <p style="text-align:center"><span style="font-size:14pt">Diese Urkunde erhält</span></p>
      <p style="text-align:center"><span style="font-size:30pt;font-family:Georgia, serif"><strong>Vorname Nachname</strong></span></p>
      <p style="text-align:center"><span style="font-size:14pt">für den 1. Platz beim Sommerlauf des Sportvereins Beispiel e. V.</span></p>
      ${empty}${empty}
      ${table([10, 35, 10, 35, 10], [[p(''), pc(`______________________<br>Ort, ${longDate}`), p(''), pc('______________________<br>Vorsitzende/r'), p('')]], { cls: 'borderless' })}`),
  },
  {
    id: 'newsletter', title: 'Vereinsnachrichten', desc: 'Newsletter mit Titelzeile und zwei Spalten', cat: 'Privat & Freizeit', keywords: 'newsletter vereinszeitung rundbrief mitglieder nachrichten zweispaltig', accent: 'green',
    html: ({ longDate }) => clean(`
      ${table([70, 30], [[`<p class="title"><span style="color:#1E6B3A">Vereinsnachrichten</span></p>`, pr(`${b('Ausgabe 3')}<br>${longDate}`)]], { cls: 'borderless' })}
      <hr>
      <div class="sect" data-cols="2" data-gap="18">
        <h2>Liebe Mitglieder,</h2>
        <p>ein ereignisreiches Quartal liegt hinter uns. In dieser Ausgabe findet ihr die wichtigsten Neuigkeiten, Termine und einen Rückblick auf unser Sommerfest.</p>
        <h3>Rückblick Sommerfest</h3>
        <p>Über 120 Gäste, strahlender Sonnenschein und ein Kuchenbuffet, das keine Wünsche offenließ – vielen Dank an alle Helferinnen und Helfer!</p>
        <h3>Neu im Vorstand</h3>
        <p>Auf der Mitgliederversammlung wurde Vorname Nachname zur neuen Kassenwartin gewählt.</p>
        <h3>Termine</h3>
        <ul><li>Monatstreffen: jeden ersten Dienstag, 19 Uhr</li><li>Arbeitseinsatz: Samstag, 10 Uhr</li><li>Weihnachtsfeier: Freitag, 18 Uhr</li></ul>
        <h3>Gesucht</h3>
        <p>Für die Jugendgruppe suchen wir Unterstützung bei Ausflügen. Meldet euch gern beim Vorstand.</p>
        <p><strong>Kontakt:</strong> vorstand@example.de</p>
      </div>`),
  },
  {
    id: 'checkliste', title: 'Umzugscheckliste', desc: 'Alle Aufgaben vor, während und nach dem Umzug', cat: 'Privat & Freizeit', keywords: 'checkliste umzug todo aufgaben ummelden liste', accent: 'teal',
    html: () => {
      const box = rows => table([8, 62, 30], [[p(b('Erl.')), p(b('Aufgabe')), p(b('Erledigt am / Notiz'))], ...rows.map(t => [pc('☐'), p(t), p('')])], { cls: 'ts-minimal', hdr: true });
      return clean(`
      <h1><span style="color:${TEAL}">Umzugscheckliste</span></h1>
      <p>Hake ab, was erledigt ist – die Tabellenzeilen kannst du beliebig ergänzen.</p>
      <h2>Zwei bis drei Monate vorher</h2>
      ${box(['Mietvertrag fristgerecht kündigen', 'Umzugstermin festlegen und Urlaub beantragen', 'Angebote von Umzugsfirmen oder Transporter-Vermietung einholen'])}
      <h2>Vier Wochen vorher</h2>
      ${box(['Nachsendeauftrag bei der Post einrichten', 'Strom, Internet und Versicherungen ummelden', 'Halteverbotszone beantragen', 'Umzugskartons besorgen'])}
      <h2>Am Umzugstag</h2>
      ${box(['Zählerstände (Strom, Wasser, Gas) fotografieren', 'Übergabeprotokoll mit Vermieter/in erstellen', 'Schlüssel übergeben bzw. übernehmen'])}
      <h2>Danach</h2>
      ${box(['Wohnsitz beim Bürgeramt ummelden (innerhalb von zwei Wochen)', 'Fahrzeugpapiere ändern lassen', 'Neue Adresse an Bank, Arbeitgeber und Krankenkasse melden'])}`);
    },
  },
  {
    id: 'uebergabeprotokoll', title: 'Wohnungsübergabeprotokoll', desc: 'Zählerstände, Schlüssel, Zustand der Räume, Unterschriften', cat: 'Privat & Freizeit', keywords: 'übergabeprotokoll wohnung miete auszug einzug vermieter mieter', accent: 'slate',
    html: ({ today }) => clean(`
      <h1>Wohnungsübergabeprotokoll</h1>
      ${table([30, 70], [[p(b('Anlass')), p('☐ Einzug   ☐ Auszug')], [p(b('Datum')), p(today)], [p(b('Wohnung')), p('Musterstraße 12, 2. OG links, 66111 Saarbrücken')], [p(b('Vermieter/in')), p('Vorname Nachname')], [p(b('Mieter/in')), p('Vorname Nachname')]], { cls: 'ts-minimal' })}
      <h2>Zählerstände</h2>
      ${table([34, 33, 33], [[p(b('Zähler')), p(b('Nummer')), p(b('Stand'))], [p('Strom'), p(''), p('')], [p('Wasser kalt'), p(''), p('')], [p('Wasser warm'), p(''), p('')], [p('Gas / Heizung'), p(''), p('')]], { cls: 'ts-header', hdr: true })}
      <h2>Schlüssel</h2>
      ${table([50, 25, 25], [[p(b('Art')), p(b('Anzahl')), p(b('Nummer'))], [p('Haustür / Wohnung'), p(''), p('')], [p('Briefkasten'), p(''), p('')], [p('Keller'), p(''), p('')]], { cls: 'ts-header', hdr: true })}
      <h2>Zustand der Räume</h2>
      ${table([22, 18, 60], [[p(b('Raum')), p(b('Zustand')), p(b('Mängel / Bemerkungen'))], [p('Flur'), p('gut'), p('')], [p('Küche'), p('gut'), p('')], [p('Bad'), p('gut'), p('')], [p('Wohnzimmer'), p('gut'), p('')], [p('Schlafzimmer'), p('gut'), p('')], [p('Balkon / Keller'), p('gut'), p('')]], { cls: 'ts-header', hdr: true })}
      <h2>Vereinbarungen</h2>
      <p>z. B. Beseitigung von Mängeln bis …, Übernahme von Einbauten …</p>
      ${empty}
      ${table([50, 50], [[p('______________________<br>Vermieter/in'), p('______________________<br>Mieter/in')]], { cls: 'borderless' })}`),
  },
  {
    id: 'reiseplan', title: 'Reiseplan', desc: 'Tagesplan, Unterkünfte und Packliste für die nächste Reise', cat: 'Privat & Freizeit', keywords: 'reise urlaub reiseplan packliste itinerary ferien', accent: 'blue',
    html: ({ date }) => clean(`
      <h1><span style="color:#1D4F91">Reiseplan: Ostsee</span></h1>
      <p class="subtitle">${fmtDate(plusDays(date, 60), true)} – ${fmtDate(plusDays(date, 66), true)}</p>
      <h2>Ablauf</h2>
      ${table([18, 42, 40], [[p(b('Tag')), p(b('Programm')), p(b('Unterkunft / Notizen'))], [p('Tag 1'), p('Anreise, Strandspaziergang'), p('Pension Beispiel, Check-in ab 15 Uhr')], [p('Tag 2'), p('Radtour entlang der Küste'), p('Räder vorab reservieren')], [p('Tag 3'), p('Ausflug zur Insel'), p('Fähre 9:30 Uhr')], [p('Tag 4'), p('Ruhetag, Museum bei Regen'), p('')], [p('Tag 5'), p('Abreise'), p('Check-out bis 10 Uhr')]], { cls: 'ts-striped', hdr: true })}
      <h2>Packliste</h2>
      <div class="sect" data-cols="2" data-gap="18">
        <ul data-bullet="square"><li>Ausweis, Führerschein, Versichertenkarte</li><li>Bahn- oder Fährtickets</li><li>Ladegeräte und Powerbank</li><li>Regenjacke und feste Schuhe</li><li>Badesachen und Sonnencreme</li><li>Reiseapotheke</li><li>Bücher oder Spiele</li><li>Snacks für die Fahrt</li></ul>
      </div>
      <h2>Wichtige Nummern</h2>
      <p>Unterkunft: 0000 123456 · Notruf: 112 · Sperr-Notruf für Karten: 116 116</p>`),
  },
  {
    id: 'notizen', title: 'Notizen', desc: 'Besprechung, Aufgaben, nächste Schritte', cat: 'Privat & Freizeit', keywords: 'notizen mitschrift ideen aufgaben', accent: 'indigo',
    html: ({ longDate }) => clean(`
      <h1>Notizen</h1>
      <p class="subtitle">${longDate}</p>
      <h2>Themen</h2>
      <ul><li>Erster Punkt</li><li>Zweiter Punkt</li></ul>
      <h2>Aufgaben</h2>
      <ol><li>Aufgabe – wer? bis wann?</li><li>Aufgabe – wer? bis wann?</li></ol>
      <h2>Ideen</h2>
      <p>Hier ist Platz für Gedanken, Skizzen und Links.</p>`),
  },
];

/** Build a template: HTML (with today's date) plus page format, header/footer and style overrides. */
export function buildDocTemplate(id, { date = new Date() } = {}) {
  const t = DOC_TEMPLATE_LIST.find(x => x.id === id) || DOC_TEMPLATE_LIST[0];
  const ctx = { date, today: fmtDate(date), longDate: fmtDate(date, true) };
  return {
    id: t.id, title: t.title,
    name: t.id === 'leer' ? 'Neues Dokument' : t.title.replace(/ – /g, ' ').replace(/\s*\/\s*/g, ' '),
    html: t.html(ctx),
    page: t.page ? { ...t.page } : { ...A4 },
    hf: t.hf ? JSON.parse(JSON.stringify(t.hf)) : null,
    styles: t.styles ? JSON.parse(JSON.stringify(t.styles)) : null,
  };
}

/** Plain-text excerpt of a template (search / previews without a DOM). */
export function docTemplateText(id) {
  return buildDocTemplate(id).html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
