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

export const DOC_TEMPLATE_CATS = ['Alle', 'Bewerbung', 'Briefe', 'Geschäftlich', 'Schule & Studium', 'Verträge & Formulare', 'Privat & Freizeit'];

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
  {
    id: 'lebenslauf-kreativ', title: 'Lebenslauf – Kreativ', desc: 'Zweispaltig mit farbiger Seitenleiste für Foto, Kontakt und Fähigkeiten', cat: 'Bewerbung', keywords: 'cv vita lebenslauf kreativ zweispaltig seitenleiste foto design', accent: 'teal', page: A4_NARROW,
    html: ({ today }) => {
      const SIDE = '#1F3B57', LIGHT = '#DCE6F0', HEAD = '#0B6B60';
      const s = (t, size = 9.5) => `<span style="font-size:${size}pt;color:${LIGHT}">${t}</span>`;
      const sh = t => `<p><span style="font-size:10.5pt;color:#FFFFFF"><strong>${t}</strong></span></p>`;
      const h = t => `<h2><span style="color:${HEAD}">${t}</span></h2>`;
      const when = t => p(`<span style="color:${GREY}">${t}</span>`);
      const left = `
        <p style="text-align:center"><img src="${PHOTO}" alt="Bewerbungsfoto (Platzhalter)" width="128"></p>
        ${sh('KONTAKT')}${p(s('Musterstraße 12<br>66111 Saarbrücken'))}${p(s('0170 1234567'))}${p(s('name@example.de'))}${p(s('linkedin.example/vorname'))}
        ${sh('FÄHIGKEITEN')}${p(s('Kampagnenplanung · sehr gut<br>Texten &amp; Redaktion · sehr gut<br>Social Media · gut<br>Datenanalyse · gut<br>Bildbearbeitung · Grundkenntnisse'))}
        ${sh('SPRACHEN')}${p(s('Deutsch – Muttersprache<br>Englisch – verhandlungssicher (C1)<br>Spanisch – gut (B1)'))}
        ${sh('INTERESSEN')}${p(s('Fotografie · Laufen · Ehrenamt in der Jugendarbeit'))}`;
      const right = `
        <p><span style="font-size:26pt;color:${SIDE}"><strong>Vorname Nachname</strong></span></p>
        <p><span style="font-size:13pt;color:${HEAD}">Marketing-Managerin</span></p>
        ${h('Profil')}
        <p>Kreative Marketing-Managerin mit sechs Jahren Erfahrung in Kampagnen, Content und Markenführung. Ich verbinde gute Ideen mit Zahlen – und bringe Projekte zuverlässig ins Ziel.</p>
        ${h('Berufserfahrung')}
        ${p(`${b('Marketing-Managerin')} · Beispiel GmbH, Saarbrücken`)}${when('seit 04/2022')}
        <ul><li>Planung und Steuerung von Kampagnen mit einem Budget von 250.000 € pro Jahr</li><li>Aufbau eines Redaktionsplans für Website, Newsletter und Social Media</li></ul>
        ${p(`${b('Junior Marketing Managerin')} · Muster AG, Trier`)}${when('09/2019 – 03/2022')}
        <ul><li>Betreuung von Messeauftritten und Produkteinführungen</li><li>Auswertung von Kampagnen und monatliches Reporting</li></ul>
        ${h('Ausbildung')}
        ${p(`${b('B.A. Medien und Kommunikation')} · Hochschule Musterstadt`)}${when('2015 – 2019 · Abschlussnote 1,7')}
        ${h('Weiterbildung')}
        ${p('Zertifikat Online-Marketing · Akademie Beispiel, 2023')}
        ${empty}
        ${p(`<span style="color:${GREY}">Saarbrücken, ${today}</span>`)}`;
      return clean(`<table class="borderless">${colgroup([32, 68])}<tbody><tr><td style="background-color:${SIDE};vertical-align:top">${left}</td><td style="vertical-align:top">${right}</td></tr></tbody></table>`);
    },
  },
  {
    id: 'motivationsschreiben', title: 'Motivationsschreiben', desc: 'Für Studienplatz, Stipendium oder Auslandssemester – mit Leitfragen', cat: 'Bewerbung', keywords: 'motivationsschreiben studium stipendium studienplatz auslandssemester stiftung bewerbung', accent: 'indigo', page: A4_DIN,
    html: ({ longDate }) => clean(`
      <p>Vorname Nachname<br>Musterstraße 12<br>66111 Saarbrücken<br>0170 1234567 · name@example.de</p>
      ${empty}
      <p>Stiftung Beispiel<br>Auswahlkommission Stipendienprogramm<br>Am Campus 5<br>12345 Musterstadt</p>
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      <p>${b('Motivationsschreiben für das Stipendienprogramm der Stiftung Beispiel')}</p>
      <p>Sehr geehrte Damen und Herren,</p>
      <p>seit meiner Schulzeit begeistert mich … (Einstieg: Was hat dein Interesse am Fach oder am Programm geweckt? Ein konkretes Erlebnis wirkt stärker als allgemeine Aussagen.)</p>
      <p>Im Studium der Beispielwissenschaft an der Universität Musterstadt habe ich … (Werdegang: Welche Schwerpunkte, Projekte oder Leistungen passen zum Programm?)</p>
      <p>Neben dem Studium engagiere ich mich … (Engagement: Ehrenamt, Nebenjob, Verantwortung in Vereinen oder in der Familie.)</p>
      <p>Ihr Programm spricht mich besonders an, weil … (Passung: Was genau bietet das Programm, und was bringst du umgekehrt ein?)</p>
      <p>Langfristig möchte ich … (Ziele: Wo siehst du dich nach dem Abschluss, und wie hilft dir das Stipendium dabei?)</p>
      <p>Über die Gelegenheit, mich in einem persönlichen Gespräch vorzustellen, freue ich mich sehr.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}
      <p>Vorname Nachname</p>
      <p>${muted('Anlagen: Lebenslauf, Notenübersicht, Empfehlungsschreiben', 10)}</p>
      <p>${muted('Tipp: Eine Seite genügt. Lies die Ausschreibung genau und greife ihre Stichworte auf.', 9)}</p>`),
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
  {
    id: 'reklamation', title: 'Reklamation / Mängelanzeige', desc: 'Mangel melden, Nacherfüllung mit Frist verlangen – mit Kaufdaten-Tabelle', cat: 'Briefe', keywords: 'reklamation mängelanzeige beschwerde defekt garantie gewährleistung umtausch reparatur händler', accent: 'coral', page: A4_DIN,
    html: ({ today, longDate, date }) => clean(`
      <p>Vorname Nachname<br>Musterstraße 12<br>66111 Saarbrücken<br>0170 1234567 · name@example.de</p>
      ${empty}
      <p>Beispiel Handel GmbH<br>Kundenservice<br>Hauptstraße 1<br>12345 Musterstadt</p>
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      <p>${b('Reklamation / Mängelanzeige – Bestellung Nr. 000000')}</p>
      <p>Sehr geehrte Damen und Herren,</p>
      <p>bei Ihnen habe ich den folgenden Artikel gekauft:</p>
      ${table([36, 64], [[p('Artikel'), p('Kaffeevollautomat „Beispiel 3000“')], [p('Artikelnummer'), p('123-456')], [p('Kaufdatum'), p(today)], [p('Rechnungs-/Bestellnummer'), p('000000')], [p('Kaufpreis'), p('349,00 €')]], { cls: 'ts-minimal' })}
      <p>Leider weist der Artikel folgenden Mangel auf: … (Beschreibe genau, was nicht funktioniert, seit wann der Fehler auftritt und wie er sich zeigt.)</p>
      <p>Ich bitte Sie deshalb um Nacherfüllung – nach meiner Wahl durch ${b('Reparatur')} / ${b('Lieferung eines mangelfreien Ersatzes')} (Nichtzutreffendes streichen) – bis spätestens zum ${b(fmtDate(plusDays(date, 14)))}.</p>
      <p>Bitte teilen Sie mir mit, wie ich Ihnen den Artikel zur Verfügung stellen soll. Die Kosten für Versand und Rücksendung bitte ich Sie zu übernehmen.</p>
      <p>Sollte die Nacherfüllung bis zum genannten Datum nicht erfolgen, behalte ich mir weitere Schritte vor, etwa den Rücktritt vom Kaufvertrag oder eine Minderung des Kaufpreises.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}
      <p>Vorname Nachname</p>
      <p>${muted('Anlagen: Kopie des Kaufbelegs, Fotos des Mangels', 10)}</p>
      ${empty}
      <p>${muted('Muster ohne Gewähr – keine Rechtsberatung. Tipp: Reklamationen schriftlich mit Frist stellen und eine Kopie aufbewahren.', 8.5)}</p>`),
  },
  {
    id: 'einladung-mitgliederversammlung', title: 'Einladung zur Mitgliederversammlung', desc: 'Vereinsbrief mit Termin, Tagesordnung, Antragsfrist und Rückmeldung', cat: 'Briefe', keywords: 'verein mitgliederversammlung einladung tagesordnung jahreshauptversammlung vorstand wahlen satzung', accent: 'green', page: A4_DIN,
    html: ({ longDate, date }) => {
      const G = '#1E6B3A';
      return clean(`
      ${table([62, 38], [[p(`<span style="font-size:15pt;color:${G}"><strong>Sportverein Beispiel e. V.</strong></span><br>${muted('gegründet 1976 · Vereinsregister VR 0000', 8.5)}`), pr(muted('Vorstand · Am Sportplatz 1<br>66111 Saarbrücken<br>vorstand@example.de', 9))]], { cls: 'borderless' })}
      <hr>
      <p>An alle Mitglieder</p>
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      <p>${b('Einladung zur ordentlichen Mitgliederversammlung')}</p>
      <p>Liebe Mitglieder,</p>
      <p>hiermit laden wir euch satzungsgemäß herzlich zur ordentlichen Mitgliederversammlung ein:</p>
      ${table([24, 76], [[p(b('Datum')), p(fmtDate(plusDays(date, 28), true))], [p(b('Beginn')), p('19:00 Uhr (Einlass ab 18:30 Uhr)')], [p(b('Ort')), p('Vereinsheim, Am Sportplatz 1, 66111 Saarbrücken')]], { cls: 'ts-minimal' })}
      <h3><span style="color:${G}">Tagesordnung</span></h3>
      <ol><li>Begrüßung und Feststellung der ordnungsgemäßen Einladung und Beschlussfähigkeit</li><li>Genehmigung des Protokolls der letzten Mitgliederversammlung</li><li>Bericht des Vorstands</li><li>Kassenbericht</li><li>Bericht der Kassenprüfer/innen</li><li>Entlastung des Vorstands</li><li>Wahlen (Vorstand und Kassenprüfung)</li><li>Festsetzung der Mitgliedsbeiträge</li><li>Anträge</li><li>Verschiedenes</li></ol>
      <p>Anträge zur Tagesordnung reicht bitte bis spätestens ${b(fmtDate(plusDays(date, 14)))} schriftlich beim Vorstand ein. Die Unterlagen (Kassenbericht, Satzung) können vorab beim Vorstand eingesehen werden.</p>
      <p>Wir freuen uns auf eine rege Teilnahme und einen guten Austausch.</p>
      <p>Mit sportlichen Grüßen<br>für den Vorstand</p>
      ${empty}
      <p>Vorname Nachname, 1. Vorsitzende/r</p>
      <p style="text-align:center">${muted('- - - - - - - - - - - - - - - - hier abtrennen - - - - - - - - - - - - - - - -', 9)}</p>
      <p>${b('Rückmeldung')} (bitte bis ${fmtDate(plusDays(date, 21))} an den Vorstand)</p>
      <p>Name: ______________________________ &nbsp; Ich nehme teil: ☐ ja &nbsp; ☐ nein</p>`);
    },
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
  {
    id: 'lieferschein', title: 'Lieferschein', desc: 'Lieferanschrift, Positionen ohne Preise und Empfangsbestätigung', cat: 'Geschäftlich', keywords: 'lieferschein lieferung versand ware empfangsbestätigung packliste spedition', accent: 'slate',
    html: ({ today, date }) => {
      const S = '#33384F';
      return clean(`
      ${table([60, 40], [[`<h1><span style="color:${S}">Lieferschein</span></h1>`, pr(`${b('Firma Beispiel')}<br>Musterstraße 12<br>66111 Saarbrücken<br>0681 123456 · info@example.de`)]], { cls: 'borderless' })}
      ${table([60, 40], [[p(`${b('Lieferanschrift')}<br>Kunde GmbH<br>Wareneingang, Tor 3<br>Hauptstraße 1<br>66123 Saarbrücken`), p(`Lieferschein-Nr.: ${b('LS-2026-031')}<br>Lieferdatum: ${today}<br>Ihre Bestellung: B-4711 vom ${fmtDate(plusDays(date, -3))}<br>Kundennummer: K-1001<br>Ansprechpartner/in: Vorname Nachname`)]], { cls: 'borderless' })}
      ${empty}
      ${table([8, 18, 50, 12, 12], [
        [p(b('Pos.')), p(b('Art.-Nr.')), p(b('Bezeichnung')), pr(b('Menge')), p(b('Einheit'))],
        [p('1'), p('10-2040'), p('Bürostuhl „Ergo“, schwarz'), pr('4'), p('Stück')],
        [p('2'), p('10-3310'), p('Schreibtisch 160 × 80 cm, Eiche hell'), pr('2'), p('Stück')],
        [p('3'), p('20-0102'), p('Kabelkanal, 1 m'), pr('6'), p('Stück')],
        [p('4'), p('30-5000'), p('Montagematerial (Set)'), pr('1'), p('Set')],
      ], { cls: 'ts-header', hdr: true })}
      <p>Versandart: Spedition · Anzahl Packstücke: 3 · Gesamtgewicht: ca. 96 kg</p>
      <p>Teillieferung: ☐ ja &nbsp; ☐ nein – offene Positionen folgen bis: ______________</p>
      <p>Bitte prüfen Sie die Ware bei Anlieferung auf Vollständigkeit und sichtbare Transportschäden und vermerken Sie Schäden auf diesem Lieferschein.</p>
      ${empty}
      <p>${b('Ware vollständig und in einwandfreiem Zustand erhalten:')}</p>
      ${empty}
      ${table([45, 10, 45], [[p('______________________________<br>Ort, Datum'), p(''), p('______________________________<br>Unterschrift Empfänger/in (Name in Druckbuchstaben)')]], { cls: 'borderless' })}
      ${empty}
      <p>${muted('Firma Beispiel · Inhaberin Vorname Nachname · Steuernummer 000/000/00000 · Beispielbank · IBAN DE00 0000 0000 0000 0000 00', 8)}</p>`);
    },
  },
  {
    id: 'auftragsbestaetigung', title: 'Auftragsbestätigung', desc: 'Bestätigt Leistungen, Preise und Liefertermin – rechnet selbst', cat: 'Geschäftlich', keywords: 'auftragsbestätigung auftrag bestellung bestätigung liefertermin handwerk dienstleistung', accent: 'teal',
    html: ({ today, date }) => clean(`
      ${table([60, 40], [[`<h1><span style="color:${TEAL}">Auftragsbestätigung</span></h1>`, pr(`${b('Firma Beispiel')}<br>Musterstraße 12<br>66111 Saarbrücken<br>0681 123456`)]], { cls: 'borderless' })}
      ${table([60, 40], [[p('Kunde GmbH<br>Frau Erika Muster<br>Hauptstraße 1<br>66123 Saarbrücken'), p(`Auftragsnummer: ${b('AB-2026-022')}<br>Datum: ${today}<br>Ihre Bestellung vom: ${fmtDate(plusDays(date, -2))}<br>Liefer-/Ausführungstermin: ${b(fmtDate(plusDays(date, 21)))}`)]], { cls: 'borderless' })}
      ${empty}
      <p>Sehr geehrte Frau Muster,</p>
      <p>vielen Dank für Ihren Auftrag. Wir bestätigen Ihnen gern die folgenden Leistungen zu den genannten Preisen:</p>
      ${table([7, 41, 12, 20, 20], [
        [p(b('Pos.')), p(b('Leistung')), pr(b('Menge')), pr(b('Einzelpreis')), pr(b('Gesamt'))],
        [p('1'), p('Küchenarbeitsplatte inkl. Zuschnitt'), pr('1'), pr('480,00 €'), pr(tf('=C2*D2', '480,00 €'))],
        [p('2'), p('Montage (Stunden)'), pr('6'), pr('62,00 €'), pr(tf('=C3*D3', '372,00 €'))],
        [p('3'), p('Anfahrt pauschal'), pr('1'), pr('35,00 €'), pr(tf('=C4*D4', '35,00 €'))],
        [p(''), p(''), p(''), pr('Netto'), pr(tf('=SUM(E2:E4)', '887,00 €'))],
        [p(''), p(''), p(''), pr('19 % USt.'), pr(tf('=E5*19/100', '168,53 €'))],
        [p(''), p(''), p(''), pr(b('Auftragssumme')), pr(b(tf('=E5+E6', '1.055,53 €')))],
      ], { cls: 'ts-striped', hdr: true })}
      <h3>Vereinbarungen</h3>
      <ul><li>Ausführung am ${fmtDate(plusDays(date, 21))} ab 8:00 Uhr; bitte sorgen Sie für freien Zugang zur Küche</li><li>Zahlung: 14 Tage nach Rechnungsstellung ohne Abzug</li><li>Grundlage ist unser Angebot vom ${fmtDate(plusDays(date, -10))}; Änderungen nur nach Absprache</li></ul>
      <p>Bitte prüfen Sie die Angaben. Sollte etwas nicht stimmen, melden Sie sich bitte innerhalb von drei Werktagen.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}
      <p>Vorname Nachname<br>Firma Beispiel</p>`),
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
  {
    id: 'deckblatt-abschlussarbeit', title: 'Deckblatt Abschlussarbeit', desc: 'Titelblatt für Bachelor-, Master- oder Facharbeit mit Gutachter/innen', cat: 'Schule & Studium', keywords: 'deckblatt titelblatt bachelorarbeit masterarbeit abschlussarbeit facharbeit thesis uni hochschule', accent: 'slate',
    page: { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 70.9, ml: 85 },
    styles: {
      normal: { font: 'Times New Roman', size: 12, line: 1.15 },
      title: { font: 'Times New Roman', size: 24, color: '#1A1A1A', align: 'center' },
      subtitle: { font: 'Times New Roman', size: 15, color: '#3A3F58', align: 'center' },
    },
    html: ({ longDate }) => clean(`
      <p style="text-align:center"><span style="font-size:14pt"><strong>Hochschule Musterstadt</strong></span><br>Fakultät für Beispielwissenschaften<br>Lehrstuhl für Angewandte Beispielforschung</p>
      ${empty}${empty}${empty}
      <p class="title">Titel der Abschlussarbeit</p>
      <p class="subtitle">Ein Untertitel, der die Fragestellung genau eingrenzt</p>
      ${empty}${empty}
      <p style="text-align:center"><span style="font-size:16pt"><strong>Bachelorarbeit</strong></span></p>
      <p style="text-align:center">zur Erlangung des akademischen Grades<br>Bachelor of Science (B.Sc.)<br>im Studiengang Beispielwissenschaft</p>
      ${empty}${empty}${empty}${empty}
      ${table([40, 60], [
        [p('vorgelegt von:'), p(b('Vorname Nachname'))],
        [p('Matrikelnummer:'), p('1234567')],
        [p('Anschrift:'), p('Musterstraße 12, 66111 Saarbrücken')],
        [p('E-Mail:'), p('name@hs-example.de')],
        [p('Erstgutachter/in:'), p('Prof. Dr. Vorname Nachname')],
        [p('Zweitgutachter/in:'), p('Dr. Vorname Nachname')],
        [p('Abgabedatum:'), p(longDate)],
      ], { cls: 'borderless' })}`),
  },
  {
    id: 'praktikumsbericht', title: 'Praktikumsbericht', desc: 'Deckblatt, Inhaltsverzeichnis, Betrieb, Tätigkeiten, Reflexion und Fazit', cat: 'Schule & Studium', keywords: 'praktikumsbericht praktikum bericht schule betriebspraktikum pflichtpraktikum hochschule inhaltsverzeichnis', accent: 'teal',
    hf: { header: 'Praktikumsbericht · Vorname Nachname', headerAlign: 'right', pageNumbers: 'footer-center', pageFormat: 'n-of-m', firstPage: false },
    html: ({ longDate, date }) => clean(`
      ${empty}${empty}
      <p class="title"><span style="color:${TEAL}">Praktikumsbericht</span></p>
      <p class="subtitle">Betriebspraktikum bei der Beispiel GmbH</p>
      ${empty}
      ${table([34, 66], [
        [p(b('Name')), p('Vorname Nachname')],
        [p(b('Schule / Hochschule')), p('Beispiel-Gymnasium, Klasse 10b')],
        [p(b('Betreuende Lehrkraft')), p('Frau Vorname Nachname')],
        [p(b('Praktikumsbetrieb')), p('Beispiel GmbH, Hauptstraße 1, 66111 Saarbrücken')],
        [p(b('Betreuer/in im Betrieb')), p('Herr Vorname Nachname, Abteilung Marketing')],
        [p(b('Zeitraum')), p(`${fmtDate(plusDays(date, -21))} – ${fmtDate(plusDays(date, -3))}`)],
        [p(b('Abgabe')), p(longDate)],
      ], { cls: 'ts-minimal' })}
      ${PAGEBREAK}
      ${TOC}
      <h1>Einleitung</h1>
      <p>Warum hast du dich für dieses Praktikum entschieden, und was hast du dir davon erhofft? Beschreibe kurz, wie du den Platz gefunden hast.</p>
      <h1>Vorstellung des Betriebs</h1>
      <h2>Unternehmen und Branche</h2>
      <p>Was stellt der Betrieb her oder welche Dienstleistungen bietet er an? Wie viele Mitarbeitende gibt es, wer sind die Kundinnen und Kunden?</p>
      <h2>Meine Abteilung</h2>
      <p>In welcher Abteilung warst du eingesetzt, und welche Aufgaben hat sie im Betrieb?</p>
      <h1>Meine Tätigkeiten</h1>
      <h2>Überblick nach Wochen</h2>
      ${table([20, 80], [
        [p(b('Woche')), p(b('Tätigkeiten'))],
        [p('Woche 1'), p('Einführung, Rundgang durch den Betrieb, erste Aufgaben im Team')],
        [p('Woche 2'), p('Mitarbeit an einem Projekt, Vorbereitung einer Präsentation')],
        [p('Woche 3'), p('Eigenständige Aufgabe, Abschlussgespräch mit der Betreuerin')],
      ], { cls: 'ts-header', hdr: true })}
      <h2>Ein Arbeitstag im Detail</h2>
      <p>Beschreibe einen typischen Tag von Arbeitsbeginn bis Feierabend: Welche Aufgaben, welche Werkzeuge, mit wem hast du zusammengearbeitet?</p>
      <h1>Reflexion</h1>
      <h2>Was ich gelernt habe</h2>
      <ul><li>Fachlich: …</li><li>Im Umgang mit anderen: …</li><li>Über mich selbst: …</li></ul>
      <h2>Erwartungen und Erfahrungen</h2>
      <p>Haben sich deine Erwartungen erfüllt? Was hat dich überrascht, was war schwierig?</p>
      <h1>Fazit</h1>
      <p>Kannst du dir vorstellen, später in diesem Beruf zu arbeiten? Würdest du den Betrieb weiterempfehlen?</p>
      <h1>Anhang</h1>
      <p>Praktikumsbescheinigung, Fotos (mit Erlaubnis), Arbeitsproben</p>`),
  },
  {
    id: 'entschuldigung-schule', title: 'Entschuldigung für die Schule', desc: 'Fehlzeiten der Klassenleitung melden – mit Ankreuzfeldern für Zeitraum und Grund', cat: 'Schule & Studium', keywords: 'entschuldigung schule krank fehlen eltern klassenlehrer attest unterricht entschuldigungsschreiben', accent: 'blue', page: A4_DIN,
    html: ({ longDate }) => clean(`
      <p>Vorname Nachname<br>Musterstraße 12<br>66111 Saarbrücken<br>0170 1234567</p>
      ${empty}
      <p>Beispiel-Gymnasium<br>Klassenleitung der Klasse 7b<br>Frau Erika Muster<br>Schulstraße 1<br>66111 Saarbrücken</p>
      <p style="text-align:right">Saarbrücken, ${longDate}</p>
      ${empty}
      <p>${b('Entschuldigung für das Fehlen im Unterricht')}</p>
      ${empty}
      <p>Sehr geehrte Frau Muster,</p>
      <p>meine Tochter / mein Sohn ${b('Vorname Nachname')}, Klasse 7b, konnte</p>
      <p>☐ am ______________<br>☐ vom ______________ bis ______________<br>☐ in den Unterrichtsstunden ________ am ______________</p>
      <p>nicht am Unterricht teilnehmen. Grund:</p>
      <p>☐ Krankheit<br>☐ Arzttermin, der nicht außerhalb der Unterrichtszeit möglich war<br>☐ wichtiger familiärer Anlass: ________________________________</p>
      <p>Versäumte Inhalte holt sie / er selbstständig nach. Für Rückfragen erreichen Sie mich unter der oben genannten Telefonnummer.</p>
      <p>Mit freundlichen Grüßen</p>
      ${empty}${empty}
      <p>______________________________<br>Unterschrift einer / eines Erziehungsberechtigten</p>
      ${empty}
      <p>${muted('Hinweis: Fristen für die Entschuldigung und ab wann ein ärztliches Attest nötig ist, regeln die Schule und das Schulgesetz des Landes. Volljährige Schülerinnen und Schüler entschuldigen sich selbst.', 8.5)}</p>`),
  },
  // ---------------------------------------------------------------- Verträge & Formulare
  {
    id: 'kaufvertrag-gebrauchtwagen', title: 'Kaufvertrag Gebrauchtwagen (privat)', desc: 'Verkauf zwischen Privatleuten: Fahrzeugdaten, Kaufpreis, Angaben zu Unfällen und Mängeln', cat: 'Verträge & Formulare', keywords: 'kaufvertrag auto gebrauchtwagen pkw fahrzeug privatverkauf motorrad verkauf vertrag', accent: 'slate',
    hf: { footer: 'Kaufvertrag Gebrauchtwagen · Muster', footerAlign: 'left', pageNumbers: 'footer-right', pageFormat: 'n-of-m' },
    html: () => {
      const form = rows => table([38, 62], rows.map(([l, v = '']) => [p(l), p(v)]), { cls: 'ts-minimal' });
      return clean(`
      <h1>Kaufvertrag über ein gebrauchtes Kraftfahrzeug</h1>
      <p>${muted('Verkauf von privat an privat · zweifach ausgefertigt, jede Partei erhält ein Exemplar', 10)}</p>
      <h3>1. Verkäufer/in</h3>
      ${form([['Name, Vorname'], ['Anschrift'], ['Telefon / E-Mail'], ['Ausweisnummer']])}
      <h3>2. Käufer/in</h3>
      ${form([['Name, Vorname'], ['Anschrift'], ['Telefon / E-Mail'], ['Ausweisnummer']])}
      <h3>3. Fahrzeug</h3>
      ${form([['Hersteller, Modell, Typ'], ['Fahrzeug-Identifizierungsnummer (FIN)'], ['Amtliches Kennzeichen'], ['Erstzulassung'], ['Kilometerstand laut Tacho', '__________ km'], ['Nächste Hauptuntersuchung (HU)'], ['Nr. der Zulassungsbescheinigung Teil II'], ['Anzahl übergebener Schlüssel'], ['Mitverkauftes Zubehör', 'z. B. Winterräder, Dachträger']])}
      <h3>4. Kaufpreis und Zahlung</h3>
      <p>Der Kaufpreis beträgt __________ € (in Worten: ______________________________ Euro).</p>
      <p>☐ Der Kaufpreis wurde bei Übergabe in bar gezahlt. Die Verkäuferin / der Verkäufer bestätigt den Empfang mit der Unterschrift unter diesem Vertrag.<br>☐ Der Kaufpreis wird bis zum ______________ auf folgendes Konto überwiesen: ______________________________</p>
      <p>Das Fahrzeug bleibt bis zur vollständigen Zahlung Eigentum der Verkäuferin / des Verkäufers. Fahrzeug, Schlüssel und die Zulassungsbescheinigungen Teil I und II werden bei vollständiger Zahlung übergeben.</p>
      <h3>5. Angaben der Verkäuferin / des Verkäufers</h3>
      ${table([68, 32], [
        [p('Das Fahrzeug hat nach Kenntnis der Verkäuferin / des Verkäufers keine Unfallschäden.'), p('☐ zutreffend<br>☐ nicht zutreffend')],
        [p('Der Kilometerstand entspricht nach Kenntnis der Verkäuferin / des Verkäufers der tatsächlichen Laufleistung.'), p('☐ zutreffend<br>☐ nicht zutreffend')],
        [p('Bekannte Unfallschäden, Vorschäden oder Mängel:'), p('')],
      ], { cls: 'ts-minimal' })}
      <h3>6. Sachmängelhaftung</h3>
      <p>Das Fahrzeug wird so verkauft, wie es besichtigt und Probe gefahren wurde. Die Haftung der Verkäuferin / des Verkäufers für Sachmängel ist ausgeschlossen. Davon ausgenommen sind die Angaben unter Nr. 5, Schäden aus der Verletzung von Leben, Körper oder Gesundheit sowie Schäden, die vorsätzlich oder grob fahrlässig verursacht wurden.</p>
      <h3>7. Übergabe und Ummeldung</h3>
      <p>Übergabe am ______________ um ________ Uhr. Die Käuferin / der Käufer meldet das Fahrzeug innerhalb von sieben Tagen nach der Übergabe um oder ab. Die Verkäuferin / der Verkäufer teilt den Verkauf der Kfz-Versicherung mit.</p>
      <h3>8. Weitere Vereinbarungen</h3>
      <p>____________________________________________________________<br>____________________________________________________________</p>
      ${empty}
      ${table([45, 10, 45], [[p('______________________________<br>Ort, Datum, Unterschrift Verkäufer/in'), p(''), p('______________________________<br>Ort, Datum, Unterschrift Käufer/in')]], { cls: 'borderless' })}
      ${empty}
      <p>${muted('Muster ohne Gewähr – keine Rechtsberatung. Bitte an den Einzelfall anpassen; bei Unsicherheiten fachkundigen Rat einholen.', 8.5)}</p>`);
    },
  },
  {
    id: 'wohnungsgeberbestaetigung', title: 'Wohnungsgeberbestätigung', desc: 'Bestätigung für die Anmeldung beim Bürgeramt mit allen Angaben nach § 19 BMG', cat: 'Verträge & Formulare', keywords: 'wohnungsgeberbestätigung vermieterbescheinigung anmeldung ummelden bürgeramt einzug auszug meldegesetz vermieter', accent: 'blue', page: { w: 595.3, h: 841.9, mt: 36, mr: 42.5, mb: 36, ml: 42.5 },
    html: () => {
      const B = '#1D4F91';
      const form = rows => table([46, 54], rows.map(([l, v = '']) => [p(l), p(v)]), { cls: 'ts-minimal' });
      return clean(`
      <h1><span style="color:${B}">Wohnungsgeberbestätigung</span></h1>
      <p>nach § 19 des Bundesmeldegesetzes (BMG)</p>
      <h3>1. Wohnungsgeber/in</h3>
      ${form([['Name, Vorname bzw. Firma'], ['Anschrift (Straße, Hausnummer, PLZ, Ort)']])}
      <p>☐ Die Wohnungsgeberin / der Wohnungsgeber ist zugleich Eigentümer/in der Wohnung.<br>☐ Die Wohnungsgeberin / der Wohnungsgeber ist nicht Eigentümer/in. Eigentümer/in ist:</p>
      ${form([['Name, Vorname bzw. Firma der Eigentümerin / des Eigentümers'], ['Anschrift der Eigentümerin / des Eigentümers']])}
      <h3>2. Art der Meldung</h3>
      <p>☐ Einzug &nbsp;&nbsp; ☐ Auszug</p>
      ${form([['Datum des Einzugs bzw. Auszugs']])}
      <h3>3. Anschrift der Wohnung</h3>
      ${form([['Straße, Hausnummer'], ['Zusatz (z. B. Stockwerk, Wohnungsnummer)'], ['Postleitzahl, Ort']])}
      <h3>4. Meldepflichtige Personen, die ein- bzw. ausgezogen sind</h3>
      ${table([8, 46, 46], [[p(b('Nr.')), p(b('Familienname')), p(b('Vorname(n)'))], [p('1'), p(''), p('')], [p('2'), p(''), p('')], [p('3'), p(''), p('')]], { cls: 'ts-header', hdr: true })}
      <h3>5. Bestätigung</h3>
      <p>Ich bestätige mit meiner Unterschrift den Einzug bzw. Auszug der oben genannten Person(en) in die bzw. aus der oben genannten Wohnung.</p>
      ${empty}
      ${table([40, 8, 52], [[p('__________________________<br>Ort, Datum'), p(''), p('______________________________<br>Unterschrift der Wohnungsgeberin / des Wohnungsgebers bzw. der beauftragten Person')]], { cls: 'borderless' })}
      <p>${muted('Hinweis: Es ist verboten, eine Wohnungsanschrift für eine Anmeldung anzubieten oder zur Verfügung zu stellen, wenn ein tatsächlicher Bezug der Wohnung weder stattfindet noch beabsichtigt ist (§ 19 Abs. 6 BMG); Verstöße können mit einem Bußgeld geahndet werden. Viele Städte und Gemeinden haben ein eigenes Formular – bitte vorab bei deinem Bürgeramt prüfen, ob dieses Muster akzeptiert wird. Die Bestätigung wird für die Anmeldung innerhalb von zwei Wochen nach dem Einzug benötigt.', 8)}</p>`);
    },
  },
  {
    id: 'quittung', title: 'Quittung', desc: 'Zwei Quittungen pro Seite zum Ausschneiden – mit Betrag, Steuer und Unterschrift', cat: 'Verträge & Formulare', keywords: 'quittung beleg zahlungsbestätigung barzahlung empfangsbestätigung kassenbeleg', accent: 'green', page: A4_NARROW,
    html: () => {
      const G = '#1E6B3A';
      const one = n => `
        ${table([60, 40], [[p(`<span style="font-size:20pt;color:${G}"><strong>Quittung</strong></span>`), pr(`Nr. ${b(`2026-0${n}`)}<br>${muted('Beleg für eine Zahlung', 9)}`)]], { cls: 'borderless' })}
        ${table([34, 66], [
          [p('Betrag netto'), pr('______________ €')],
          [p('zzgl. ____ % Umsatzsteuer'), pr('______________ €')],
          [p(b('Gesamtbetrag')), pr(b('______________ €'))],
          [p('in Worten'), p('______________________________________ Euro')],
          [p('erhalten von'), p('')],
          [p('für'), p('')],
        ], { cls: 'ts-minimal' })}
        <p>Den oben genannten Betrag dankend erhalten.</p>
        ${table([45, 10, 45], [[p('______________________________<br>Ort, Datum'), p(''), p('______________________________<br>Stempel / Unterschrift Empfänger/in')]], { cls: 'borderless' })}`;
      return clean(`
      ${one(1)}
      ${empty}
      <p style="text-align:center">${muted('- - - - - - - - - - - - - - - - - - - - - hier abschneiden - - - - - - - - - - - - - - - - - - - - -', 9)}</p>
      ${empty}
      ${one(2)}
      ${empty}
      <p>${muted('Hinweis: Bei Beträgen bis 250 € brutto genügt statt Netto und Steuer der Gesamtbetrag mit Angabe des Steuersatzes. Kleinunternehmer/innen weisen keine Umsatzsteuer aus.', 8)}</p>`);
    },
  },
  {
    id: 'vollmacht', title: 'Vollmacht', desc: 'Eine Person für Post, Behördengänge oder Verträge bevollmächtigen – mit Gültigkeit', cat: 'Verträge & Formulare', keywords: 'vollmacht bevollmächtigung abholung post paket behörde zulassungsstelle vertretung', accent: 'indigo',
    html: () => {
      const form = rows => table([38, 62], rows.map(([l, v = '']) => [p(l), p(v)]), { cls: 'ts-minimal' });
      return clean(`
      <h1><span style="color:${ACC}">Vollmacht</span></h1>
      <p>Hiermit bevollmächtige ich</p>
      ${form([['Name, Vorname'], ['Geburtsdatum'], ['Anschrift']])}
      <p>die folgende Person</p>
      ${form([['Name, Vorname'], ['Geburtsdatum'], ['Anschrift']])}
      <p>mich in folgenden Angelegenheiten zu vertreten:</p>
      <p>☐ Abholung von Briefen, Einschreiben und Paketen<br>☐ Behördengänge, z. B. beim Bürgeramt oder bei der Zulassungsstelle<br>☐ Abschluss, Änderung und Kündigung von Verträgen in meinem Namen<br>☐ Sonstiges: ________________________________________________</p>
      <p>Die Vollmacht gilt &nbsp; ☐ einmalig am ______________ &nbsp; ☐ bis zum ______________ &nbsp; ☐ bis auf Widerruf.</p>
      <p>Die bevollmächtigte Person weist sich mit ihrem Personalausweis oder Reisepass aus. Eine Kopie meines Ausweises liegt bei.</p>
      ${empty}${empty}
      ${table([45, 10, 45], [[p('______________________________<br>Ort, Datum, Unterschrift Vollmachtgeber/in'), p(''), p('______________________________<br>Unterschrift der bevollmächtigten Person')]], { cls: 'borderless' })}
      ${empty}
      <p>${muted('Muster ohne Gewähr – keine Rechtsberatung. Banken, Behörden und Paketdienste verlangen teils eigene Formulare; für eine Vorsorgevollmacht gelten besondere Anforderungen.', 8.5)}</p>`);
    },
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
  {
    id: 'gutschein', title: 'Gutschein', desc: 'Drei Gutscheine pro A4-Seite zum Ausschneiden – Wert, Erlebnis oder Zeit schenken', cat: 'Privat & Freizeit', keywords: 'gutschein geschenk geburtstag weihnachten muttertag geschenkgutschein voucher ausschneiden', accent: 'rose', page: A4_NARROW,
    html: ({ date }) => {
      const C = '#9C2246';
      const bd = `border-top:1.5pt solid ${C};border-bottom:1.5pt solid ${C}`;
      const one = (big, what, nr) => `<table class="borderless">${colgroup([33, 67])}<tbody><tr>
        <td style="background-color:${C};vertical-align:middle;${bd};border-left:1.5pt solid ${C}">${empty}${empty}<p style="text-align:center"><span style="font-size:13pt;color:#FFFFFF"><strong>GUTSCHEIN</strong></span></p><p style="text-align:center"><span style="font-size:30pt;color:#FFFFFF"><strong>${big}</strong></span></p>${empty}${empty}</td>
        <td style="vertical-align:middle;${bd};border-right:1.5pt solid ${C}"><p><span style="font-size:12pt"><strong>Für:</strong> ______________________________</span></p>${empty}<p><span style="font-size:12pt"><strong>Von:</strong> ______________________________</span></p>${empty}<p><span style="font-size:12pt">${what}</span></p><p>${muted(`Gültig bis ${fmtDate(plusDays(date, 365))} · Nr. ${nr}`, 9)}</p></td></tr></tbody></table>`;
      const cut = `<p style="text-align:center">${muted('- - - - - - - - - - - - - - - - - - - - - hier abschneiden - - - - - - - - - - - - - - - - - - - - -', 9)}</p>`;
      return clean(`
      ${one('50 €', 'Einzulösen für einen Einkauf deiner Wahl im Buchladen am Markt.', 'G-001')}
      ${empty}${cut}${empty}
      ${one('Kino', 'Ein Kinoabend zu zweit – mit Popcorn und Getränk. Termin suchst du aus!', 'G-002')}
      ${empty}${cut}${empty}
      ${one('3 Std.', 'Drei Stunden Zeit nur für dich: Babysitten, Helfen im Garten oder ein gemeinsamer Ausflug.', 'G-003')}`);
    },
  },
  {
    id: 'glueckwunschkarte', title: 'Glückwunschkarte (Faltkarte)', desc: 'A4 quer zum Falten: Vorder- und Rückseite außen, Wünsche innen', cat: 'Privat & Freizeit', keywords: 'glückwunschkarte karte geburtstag faltkarte grußkarte hochzeit danke klappkarte', accent: 'amber',
    page: { w: 841.9, h: 595.3, mt: 36, mr: 36, mb: 36, ml: 36 },
    html: () => {
      const A = '#8A5A00';
      const fold = 'border-right:0.75pt dashed #A9ADC4';
      const half = (left, right) => `<table class="borderless">${colgroup([50, 50])}<tbody><tr><td style="vertical-align:top;${fold}">${left}</td><td style="vertical-align:top">${right}</td></tr></tbody></table>`;
      const sp = n => empty.repeat(n);
      const outside = half(
        `${sp(18)}<p style="text-align:center">${muted('Mit lieben Grüßen gestaltet', 9)}</p><p style="text-align:center">${muted('Druck-Tipp: Querformat, Seite 2 auf die Rückseite drucken (an der kurzen Kante wenden) und an der gestrichelten Linie falten.', 8)}</p>`,
        `${sp(7)}<p style="text-align:center"><span style="font-size:14pt;color:${A}">· · · · ·</span></p><p style="text-align:center"><span style="font-family:Georgia, serif;font-size:40pt;color:${A}"><strong>Alles Gute</strong></span></p><p style="text-align:center"><span style="font-family:Georgia, serif;font-size:20pt;color:#5A3D00">zum Geburtstag!</span></p><p style="text-align:center"><span style="font-size:14pt;color:${A}">· · · · ·</span></p>`);
      const inside = half(
        `${sp(7)}<p style="text-align:center"><span style="font-family:Georgia, serif;font-size:15pt;color:#5A3D00"><em>Ein Jahr voller Sonnentage,<br>guter Gespräche<br>und kleiner Abenteuer –<br>das wünschen wir dir.</em></span></p>${sp(9)}`,
        `${sp(3)}<p><span style="font-family:Georgia, serif;font-size:15pt">Liebe / Lieber …,</span></p><p><span style="font-size:12pt">schreibe hier deine persönlichen Wünsche – oder lass Platz und schreibe sie von Hand.</span></p>${sp(5)}<p><span style="font-family:Georgia, serif;font-size:14pt">Alles Liebe</span></p><p><span style="font-family:Georgia, serif;font-size:14pt">Deine / Dein …</span></p>`);
      return clean(`${outside}${PAGEBREAK}${inside}`);
    },
  },
  {
    id: 'packliste', title: 'Packliste', desc: 'Zum Abhaken: Dokumente, Kleidung, Hygiene, Technik und was vor der Abreise zu tun ist', cat: 'Privat & Freizeit', keywords: 'packliste urlaub reise koffer checkliste abhaken camping ferien', accent: 'teal',
    html: ({ date }) => {
      const group = (head, items) => `<h3><span style="color:${TEAL}">${head}</span></h3><p>${items.map(t => `☐ ${t}`).join('<br>')}</p>`;
      return clean(`
      <h1><span style="color:${TEAL}">Packliste</span></h1>
      <p>Reiseziel: ______________________ · Dauer: ____ Tage · Abfahrt: ${fmtDate(plusDays(date, 30))}</p>
      <div class="sect" data-cols="2" data-gap="18">
        ${group('Dokumente &amp; Geld', ['Personalausweis / Reisepass', 'Führerschein', 'Versichertenkarte, Auslandskrankenschein', 'Tickets und Buchungsbestätigungen', 'Bargeld und Bankkarte', 'Kopien wichtiger Dokumente'])}
        ${group('Kleidung', ['Unterwäsche und Socken', 'T-Shirts und Pullover', 'Hosen / Röcke', 'Regenjacke', 'Bequeme Schuhe', 'Badesachen', 'Schlafsachen', 'Sonnenhut oder Mütze'])}
        ${group('Hygiene &amp; Pflege', ['Zahnbürste und Zahnpasta', 'Duschgel und Shampoo', 'Deo', 'Sonnencreme', 'Haarbürste', 'Rasierer', 'Brille / Kontaktlinsen'])}
        ${group('Reiseapotheke', ['Persönliche Medikamente', 'Pflaster und Verbandszeug', 'Mittel gegen Schmerzen und Fieber', 'Mittel gegen Übelkeit', 'Insektenschutz', 'Fieberthermometer'])}
        ${group('Technik', ['Handy und Ladegerät', 'Powerbank', 'Kopfhörer', 'Reiseadapter', 'Kamera', 'E-Book-Reader'])}
        ${group('Vor der Abreise', ['Fenster schließen, Herd und Geräte aus', 'Pflanzen gießen lassen', 'Briefkasten leeren lassen', 'Müll rausbringen', 'Kühlschrank leeren', 'Schlüssel an Nachbarn'])}
      </div>
      <p>${muted('Tipp: Liste ausdrucken und beim Packen abhaken – nicht Benötigtes einfach streichen.', 9)}</p>`);
    },
  },
  {
    id: 'aushang-hausmitteilung', title: 'Aushang Hausmitteilung', desc: 'Gut lesbarer Aushang fürs Treppenhaus – mit Termin, Infos und Kontakt', cat: 'Privat & Freizeit', keywords: 'aushang hausmitteilung treppenhaus nachbarn hausverwaltung info wasser abstellen mitteilung schwarzes brett', accent: 'blue', page: A4_NARROW,
    html: ({ today, date }) => {
      const B = '#1D4F91';
      const big = t => `<span style="font-size:14pt">${t}</span>`;
      return clean(`
      <div class="textbox" style="width:auto;border-color:${B};background-color:#EAF2FC"><p style="text-align:center"><span style="font-size:30pt;color:${B}"><strong>Hausmitteilung</strong></span></p><p style="text-align:center">${big('für alle Bewohnerinnen und Bewohner der Musterstraße 12')}</p></div>
      ${empty}
      <p style="text-align:center"><span style="font-size:24pt"><strong>Das Wasser wird abgestellt</strong></span></p>
      ${empty}
      <p>${big('Liebe Nachbarinnen und Nachbarn,')}</p>
      <p>${big('wegen Wartungsarbeiten an der Hauptwasserleitung wird das Wasser im ganzen Haus abgestellt:')}</p>
      ${table([24, 76], [
        [pr(big(b('Wann'))), p(big(`${fmtDate(plusDays(date, 7), true)}, 8:00 bis ca. 12:00 Uhr`))],
        [pr(big(b('Was'))), p(big('Kein Kalt- und kein Warmwasser in allen Wohnungen'))],
        [pr(big(b('Wer'))), p(big('Sanitär Beispiel GmbH im Auftrag der Hausverwaltung'))],
      ], { cls: 'borderless' })}
      ${empty}
      <p>${big('Bitte füllen Sie sich vorher etwas Wasser ab und lassen Sie die Wasserhähne während der Arbeiten geschlossen.')}</p>
      <p>${big('Vielen Dank für Ihr Verständnis!')}</p>
      ${empty}
      <p>${big(`${b('Fragen?')} Hausverwaltung Beispiel · 0681 123456 · hausverwaltung@example.de`)}</p>
      ${empty}
      <p style="text-align:right">${muted(`Aushang vom ${today} · bitte bis ${fmtDate(plusDays(date, 8))} hängen lassen`, 9)}</p>`);
    },
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

// ---------------------------------------------------------------- Präsentations-Vorlagen (Inhalte)
// Texte der fertigen Foliensätze (Galerie: SLIDE_DECKS in templates.js). Jede Folie: { layout, …Platzhaltertexte, notes }.
// Die Felder entsprechen makeSlide() in slides.js: title, sub, items, left/right, num, quote, author, kpis, steps.
export const SLIDE_DECK_CONTENT = {
  projekt: [
    { layout: 'title', title: 'Projekt „Beispiel“', sub: 'Projektvorstellung · Vorname Nachname · Abteilung', notes: 'Kurz vorstellen: Wer spricht, worum geht es, wie lange dauert die Präsentation.' },
    { layout: 'agenda', items: ['Ausgangslage', 'Ziele', 'Zeitplan', 'Kennzahlen', 'Nächste Schritte'] },
    { layout: 'title-text', title: 'Ausgangslage', items: ['Was ist heute das Problem?', 'Wen betrifft es und wie oft?', 'Was kostet es uns, nichts zu tun?'], notes: 'Ein konkretes Beispiel aus dem Alltag macht die Ausgangslage greifbar.' },
    { layout: 'two-col', title: 'Ziele', left: ['Bis Jahresende: Bearbeitungszeit halbieren', 'Weniger Rückfragen von Kundinnen und Kunden'], right: ['Nicht Teil des Projekts: Umbau der Buchhaltung', 'Budget: 25.000 €'] },
    { layout: 'timeline', title: 'Zeitplan', steps: [['Januar', 'Bestandsaufnahme'], ['März', 'Konzept fertig'], ['Juni', 'Pilot mit einem Team'], ['September', 'Einführung für alle'], ['Dezember', 'Auswertung']] },
    { layout: 'kpi', title: 'Woran wir den Erfolg messen', kpis: [['−50 %', 'Bearbeitungszeit pro Vorgang'], ['90 %', 'Vorgänge ohne Rückfrage'], ['4,5 / 5', 'Zufriedenheit im Team']] },
    { layout: 'title-text', title: 'Nächste Schritte', items: ['Projektteam benennen (bis Ende des Monats)', 'Auftakttermin mit allen Beteiligten', 'Freigabe des Budgets durch die Geschäftsführung'] },
    { layout: 'title', title: 'Vielen Dank!', sub: 'Fragen und Anregungen gern an name@example.de' },
  ],
  referat: [
    { layout: 'title', title: 'Thema des Referats', sub: 'Fach · Klasse/Kurs · Vorname Nachname · Datum', notes: 'Begrüßung, Thema nennen und kurz sagen, warum es spannend ist.' },
    { layout: 'agenda', title: 'Gliederung', items: ['Einführung', 'Hintergrund', 'Hauptteil', 'Fazit', 'Quellen'] },
    { layout: 'section', num: '01', title: 'Einführung', sub: 'Worum geht es – und warum ist das wichtig?' },
    { layout: 'title-text', title: 'Hintergrund', items: ['Wann und wo hat alles angefangen?', 'Welche Personen oder Ereignisse sind wichtig?', 'Ein Begriff, der erklärt werden muss'], notes: 'Höchstens drei Punkte pro Folie – den Rest erzählst du frei.' },
    { layout: 'section', num: '02', title: 'Hauptteil', sub: 'Die wichtigsten Erkenntnisse' },
    { layout: 'compare', title: 'Zwei Sichtweisen', left: { head: 'Pro', items: ['Erstes Argument', 'Zweites Argument', 'Beispiel'] }, right: { head: 'Contra', items: ['Erstes Gegenargument', 'Zweites Gegenargument', 'Beispiel'] } },
    { layout: 'quote', quote: 'Ein kurzes, passendes Zitat aus deiner Quelle bringt das Thema auf den Punkt.', author: '— Name der Autorin oder des Autors, Jahr' },
    { layout: 'title-text', title: 'Fazit', items: ['Die wichtigste Erkenntnis in einem Satz', 'Was bedeutet das für uns heute?', 'Eine offene Frage für die Diskussion'] },
    { layout: 'title-text', title: 'Quellen', items: ['Nachname, Vorname: Titel. Ort: Verlag Jahr.', 'Titel der Webseite, URL (abgerufen am …)'] },
  ],
  pitch: [
    { layout: 'title', title: 'Name der Geschäftsidee', sub: 'Ein Satz, der erklärt, was ihr macht und für wen', notes: 'In 30 Sekunden: Problem, Lösung, warum jetzt.' },
    { layout: 'title-text', title: 'Das Problem', items: ['Wer hat das Problem?', 'Wie lösen die Leute es heute – und warum ist das mühsam?', 'Wie groß ist der Schmerz (Zeit, Geld, Nerven)?'] },
    { layout: 'title-text', title: 'Unsere Lösung', items: ['Was genau bieten wir an?', 'Der eine Vorteil, der uns unterscheidet', 'So sieht es für Kundinnen und Kunden aus'] },
    { layout: 'kpi', title: 'Der Markt', kpis: [['2,4 Mio.', 'mögliche Kundinnen und Kunden in Deutschland'], ['18 €', 'Umsatz pro Kunde und Monat'], ['3 %', 'Marktanteil als Ziel nach drei Jahren']], notes: 'Zahlen mit Quelle belegen – grobe Schätzungen als solche kennzeichnen.' },
    { layout: 'compare', title: 'Wir im Vergleich', left: { head: 'Bisherige Lösungen', items: ['Teuer und kompliziert', 'Lange Wartezeiten', 'Kein persönlicher Kontakt'] }, right: { head: 'Unser Angebot', items: ['Fester Preis, monatlich kündbar', 'In zehn Minuten startklar', 'Beratung inklusive'] } },
    { layout: 'title-text', title: 'Geschäftsmodell', items: ['Wie verdienen wir Geld (Abo, Verkauf, Provision)?', 'Wie gewinnen wir die ersten 100 Kundinnen und Kunden?', 'Was kostet uns eine Neukundin oder ein Neukunde?'] },
    { layout: 'timeline', title: 'Fahrplan', steps: [['Heute', 'Prototyp und erste Testkunden'], ['+ 6 Monate', 'Markteinführung in einer Region'], ['+ 12 Monate', 'Bundesweit verfügbar'], ['+ 24 Monate', 'Gewinnschwelle erreicht']] },
    { layout: 'title-text', title: 'Team und Bedarf', items: ['Wer wir sind und was wir mitbringen', 'Was wir suchen: Kapital, Partner oder Kontakte', 'Wofür das Geld eingesetzt wird'] },
    { layout: 'title', title: 'Lasst uns sprechen!', sub: 'Vorname Nachname · 0170 1234567 · name@example.de' },
  ],
  verein: [
    { layout: 'title', title: 'Jahresbericht 2026', sub: 'Mitgliederversammlung · Sportverein Beispiel e. V.', notes: 'Begrüßung der Mitglieder und Gäste.' },
    { layout: 'agenda', title: 'Tagesordnung', items: ['Rückblick auf das Vereinsjahr', 'Zahlen und Mitglieder', 'Kassenbericht', 'Ausblick und Termine'] },
    { layout: 'section', num: '01', title: 'Rückblick', sub: 'Das war unser Vereinsjahr' },
    { layout: 'timeline', title: 'Höhepunkte des Jahres', steps: [['März', 'Frühjahrsputz am Vereinsheim'], ['Juni', 'Sommerfest mit 120 Gästen'], ['September', 'Neue Jugendgruppe gestartet'], ['Dezember', 'Weihnachtsfeier']] },
    { layout: 'kpi', title: 'Der Verein in Zahlen', kpis: [['312', 'Mitglieder (+ 24)'], ['48', 'Trainingsabende'], ['1.800', 'ehrenamtliche Stunden']] },
    { layout: 'two-col', title: 'Kassenbericht', left: ['Einnahmen: 18.450 €', 'davon Beiträge: 14.200 €', 'Spenden und Feste: 4.250 €'], right: ['Ausgaben: 16.930 €', 'Kassenstand am Jahresende: 7.520 €', 'Kassenprüfung ohne Beanstandungen'], notes: 'Die Zahlen stammen aus dem Kassenbericht – Detailfragen beantwortet die Kassenwartin.' },
    { layout: 'quote', quote: 'Ohne die vielen Helferinnen und Helfer wäre dieses Jahr nicht möglich gewesen – danke!', author: '— Der Vorstand' },
    { layout: 'title-text', title: 'Ausblick und Termine', items: ['Neue Trainingszeiten ab Januar', 'Vereinsausflug im Mai', 'Jubiläumsfeier „50 Jahre“ im Herbst'] },
    { layout: 'title', title: 'Vielen Dank!', sub: 'Fragen, Ideen und Anträge an vorstand@example.de' },
  ],
};
