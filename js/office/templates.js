// Document, spreadsheet and presentation templates (own designs). All texts are placeholders to overwrite.

const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDate = () => new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const clean = html => html.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
const ACC = '#3B37A0';
const TEAL = '#0B8F80';

export const DOC_TEMPLATES = [
  {
    id: 'leer', title: 'Leeres Dokument', desc: 'Weißes Blatt im A4-Format', icon: 'kdoc', kind: 'docx',
    html: () => '<p><br></p>',
  },
  {
    id: 'lebenslauf-klassisch', title: 'Lebenslauf – Klassisch', desc: 'Tabellarisch, schlicht, ATS-freundlich', icon: 'user', kind: 'docx',
    html: () => clean(`
      <h1>Vorname Nachname</h1>
      <p>Musterstraße 12 · 66111 Saarbrücken · 0170 1234567 · name@example.de</p>
      <hr>
      <h2>Berufserfahrung</h2>
      <table class="borderless"><colgroup><col style="width:26%"><col style="width:74%"></colgroup><tbody>
        <tr><td><p>03/2022 – heute</p></td><td><p><strong>Projektmanagerin</strong> · Beispiel GmbH, Saarbrücken</p><ul><li>Leitung von Projekten mit bis zu 12 Beteiligten</li><li>Einführung eines digitalen Ablagesystems</li></ul></td></tr>
        <tr><td><p>08/2018 – 02/2022</p></td><td><p><strong>Sachbearbeiterin</strong> · Muster AG, Homburg</p><ul><li>Kundenbetreuung und Angebotserstellung</li></ul></td></tr>
      </tbody></table>
      <h2>Ausbildung</h2>
      <table class="borderless"><colgroup><col style="width:26%"><col style="width:74%"></colgroup><tbody>
        <tr><td><p>2015 – 2018</p></td><td><p><strong>Bachelor of Arts, Betriebswirtschaft</strong> · Hochschule Musterstadt</p></td></tr>
        <tr><td><p>2015</p></td><td><p><strong>Abitur</strong> · Gymnasium am Beispiel</p></td></tr>
      </tbody></table>
      <h2>Kenntnisse</h2>
      <table class="borderless"><colgroup><col style="width:26%"><col style="width:74%"></colgroup><tbody>
        <tr><td><p>Software</p></td><td><p>Office-Programme, Projektplanung, Grundlagen Buchhaltung</p></td></tr>
        <tr><td><p>Sprachen</p></td><td><p>Deutsch (Muttersprache), Englisch (fließend), Französisch (Grundkenntnisse)</p></td></tr>
        <tr><td><p>Führerschein</p></td><td><p>Klasse B</p></td></tr>
      </tbody></table>
      <p><br></p>
      <p>Saarbrücken, ${today()}</p>`),
  },
  {
    id: 'lebenslauf-modern', title: 'Lebenslauf – Modern', desc: 'Farbige Überschriften, klare Abschnitte', icon: 'user', kind: 'docx',
    html: () => clean(`
      <h1><span style="color:${ACC}">Vorname</span> Nachname</h1>
      <p class="subtitle">Grafikdesignerin mit Schwerpunkt Markenauftritt</p>
      <table class="borderless"><colgroup><col style="width:34%"><col style="width:33%"><col style="width:33%"></colgroup><tbody>
        <tr><td><p><strong>Telefon</strong><br>0170 1234567</p></td><td><p><strong>E-Mail</strong><br>name@example.de</p></td><td><p><strong>Ort</strong><br>66111 Saarbrücken</p></td></tr>
      </tbody></table>
      <h2><span style="color:${ACC}">Profil</span></h2>
      <p>Kreativ, strukturiert und lösungsorientiert. Seit über fünf Jahren entwickle ich Erscheinungsbilder für kleine und mittlere Unternehmen – von der ersten Skizze bis zur fertigen Druckdatei.</p>
      <h2><span style="color:${ACC}">Stationen</span></h2>
      <h3>Senior Designerin · Studio Beispiel</h3>
      <p><span style="color:#6B7194">seit 2021 · Saarbrücken</span></p>
      <ul><li>Verantwortung für 20+ Kundenprojekte pro Jahr</li><li>Aufbau einer gemeinsamen Gestaltungsbibliothek</li></ul>
      <h3>Designerin · Agentur Muster</h3>
      <p><span style="color:#6B7194">2018 – 2021 · Mannheim</span></p>
      <ul><li>Gestaltung von Kampagnen, Broschüren und Webseiten</li></ul>
      <h2><span style="color:${ACC}">Ausbildung</span></h2>
      <p><strong>B.A. Kommunikationsdesign</strong> · Hochschule Musterstadt, 2014 – 2018</p>
      <h2><span style="color:${ACC}">Fähigkeiten</span></h2>
      <p>Typografie · Layout · Bildbearbeitung · Illustration · Präsentation · Englisch (C1)</p>`),
  },
  {
    id: 'anschreiben', title: 'Bewerbungsanschreiben', desc: 'Klassischer Aufbau mit Betreff', icon: 'kdoc', kind: 'docx',
    html: () => clean(`
      <p>Vorname Nachname<br>Musterstraße 12<br>66111 Saarbrücken<br>0170 1234567 · name@example.de</p>
      <p><br></p>
      <p>Beispiel GmbH<br>Personalabteilung<br>Frau Erika Muster<br>Hauptstraße 1<br>66111 Saarbrücken</p>
      <p style="text-align:right">Saarbrücken, ${longDate()}</p>
      <p><strong>Bewerbung als Projektmanagerin – Ihre Stellenanzeige vom ${today()}</strong></p>
      <p>Sehr geehrte Frau Muster,</p>
      <p>mit großem Interesse habe ich Ihre Stellenanzeige gelesen. Die beschriebenen Aufgaben passen sehr gut zu meinen Erfahrungen und Zielen – deshalb bewerbe ich mich bei Ihnen.</p>
      <p>In meiner aktuellen Position bei der Muster AG verantworte ich … (Beschreibe hier deine wichtigsten Erfolge und was du mitbringst.)</p>
      <p>Besonders reizt mich an Ihrem Unternehmen … (Warum genau diese Firma?)</p>
      <p>Über die Einladung zu einem persönlichen Gespräch freue ich mich sehr. Mein frühestmöglicher Eintrittstermin ist der 1. des Folgemonats.</p>
      <p>Mit freundlichen Grüßen</p>
      <p><br></p>
      <p>Vorname Nachname</p>
      <p><span style="color:#6B7194">Anlagen: Lebenslauf, Zeugnisse</span></p>`),
  },
  {
    id: 'brief', title: 'Brief (DIN 5008)', desc: 'Geschäftsbrief mit Anschriftfeld und Infoblock', icon: 'kdoc', kind: 'docx',
    html: () => clean(`
      <p><span style="font-size:8pt;color:#6B7194"><u>Firma Beispiel · Musterstraße 12 · 66111 Saarbrücken</u></span></p>
      <table class="borderless"><colgroup><col style="width:58%"><col style="width:42%"></colgroup><tbody>
        <tr><td><p>Herrn<br>Max Mustermann<br>Beispielweg 5<br>66123 Saarbrücken</p></td>
        <td><p><span style="font-size:9pt">Ihr Zeichen: ab-12<br>Unser Zeichen: fl-34<br>Telefon: 0681 123456<br>E-Mail: info@example.de<br>Datum: ${today()}</span></p></td></tr>
      </tbody></table>
      <p><br></p>
      <p><strong>Betreff: Ihre Anfrage vom ${today()}</strong></p>
      <p><br></p>
      <p>Sehr geehrter Herr Mustermann,</p>
      <p>vielen Dank für Ihre Anfrage. Gerne senden wir Ihnen folgende Informationen …</p>
      <p>Für Rückfragen stehen wir Ihnen jederzeit zur Verfügung.</p>
      <p>Mit freundlichen Grüßen</p>
      <p><br></p>
      <p>Vorname Nachname<br>Firma Beispiel</p>
      <p><br></p>
      <p><span style="font-size:8pt;color:#6B7194">Bankverbindung: Beispielbank · IBAN DE00 0000 0000 0000 0000 00 · Geschäftsführung: Vorname Nachname · Amtsgericht Saarbrücken HRB 00000</span></p>`),
  },
  {
    id: 'rechnung', title: 'Rechnung', desc: 'Positionen, Netto, MwSt. und Gesamtbetrag', icon: 'kdoc', kind: 'docx',
    html: () => clean(`
      <table class="borderless"><colgroup><col style="width:60%"><col style="width:40%"></colgroup><tbody>
        <tr><td><h1><span style="color:${ACC}">Rechnung</span></h1></td><td><p style="text-align:right"><strong>Firma Beispiel</strong><br>Musterstraße 12<br>66111 Saarbrücken<br>info@example.de</p></td></tr>
      </tbody></table>
      <table class="borderless"><colgroup><col style="width:60%"><col style="width:40%"></colgroup><tbody>
        <tr><td><p><strong>Rechnung an</strong><br>Kunde GmbH<br>Frau Erika Muster<br>Hauptstraße 1<br>66123 Saarbrücken</p></td>
        <td><p>Rechnungsnummer: <strong>2026-001</strong><br>Rechnungsdatum: ${today()}<br>Leistungszeitraum: ${today()}<br>Kundennummer: K-1001</p></td></tr>
      </tbody></table>
      <p><br></p>
      <table><colgroup><col style="width:8%"><col style="width:48%"><col style="width:12%"><col style="width:16%"><col style="width:16%"></colgroup><tbody>
        <tr><td style="background-color:#E9E8FB"><p><strong>Pos.</strong></p></td><td style="background-color:#E9E8FB"><p><strong>Beschreibung</strong></p></td><td style="background-color:#E9E8FB"><p style="text-align:right"><strong>Menge</strong></p></td><td style="background-color:#E9E8FB"><p style="text-align:right"><strong>Einzelpreis</strong></p></td><td style="background-color:#E9E8FB"><p style="text-align:right"><strong>Gesamt</strong></p></td></tr>
        <tr><td><p>1</p></td><td><p>Beratung (Stunden)</p></td><td><p style="text-align:right">4</p></td><td><p style="text-align:right">85,00 €</p></td><td><p style="text-align:right">340,00 €</p></td></tr>
        <tr><td><p>2</p></td><td><p>Gestaltung Flyer</p></td><td><p style="text-align:right">1</p></td><td><p style="text-align:right">250,00 €</p></td><td><p style="text-align:right">250,00 €</p></td></tr>
        <tr><td><p>3</p></td><td><p>Druckdaten-Prüfung</p></td><td><p style="text-align:right">1</p></td><td><p style="text-align:right">40,00 €</p></td><td><p style="text-align:right">40,00 €</p></td></tr>
      </tbody></table>
      <table class="borderless"><colgroup><col style="width:60%"><col style="width:24%"><col style="width:16%"></colgroup><tbody>
        <tr><td><p><br></p></td><td><p>Nettobetrag</p></td><td><p style="text-align:right">630,00 €</p></td></tr>
        <tr><td><p><br></p></td><td><p>zzgl. 19 % MwSt.</p></td><td><p style="text-align:right">119,70 €</p></td></tr>
        <tr><td><p><br></p></td><td><p><strong>Gesamtbetrag</strong></p></td><td><p style="text-align:right"><strong>749,70 €</strong></p></td></tr>
      </tbody></table>
      <p>Bitte überweise den Gesamtbetrag innerhalb von 14 Tagen ohne Abzug auf das unten genannte Konto. Vielen Dank für deinen Auftrag!</p>
      <p><span style="font-size:9pt;color:#6B7194">Beispielbank · IBAN DE00 0000 0000 0000 0000 00 · BIC BEISPXXX · Steuernummer 000/000/00000</span></p>`),
  },
  {
    id: 'notizen', title: 'Notizen', desc: 'Besprechung, Aufgaben, nächste Schritte', icon: 'edit', kind: 'docx',
    html: () => clean(`
      <h1>Notizen</h1>
      <p class="subtitle">${longDate()}</p>
      <h2>Themen</h2>
      <ul><li>Erster Punkt</li><li>Zweiter Punkt</li></ul>
      <h2>Aufgaben</h2>
      <ol><li>Aufgabe – wer? bis wann?</li><li>Aufgabe – wer? bis wann?</li></ol>
      <h2>Ideen</h2>
      <p>Hier ist Platz für Gedanken, Skizzen und Links.</p>`),
  },
];

// ---------------- spreadsheet templates ----------------
export const SHEET_TEMPLATES = [
  { id: 'leer', title: 'Leere Tabelle', desc: 'Raster mit 26 Spalten', icon: 'ksheet', kind: 'xlsx', cells: null },
  {
    id: 'haushaltsbuch', title: 'Haushaltsbuch', desc: 'Einnahmen, Ausgaben und Saldo mit Formeln', icon: 'ksheet', kind: 'xlsx',
    cells: () => {
      const rows = [
        [['Haushaltsbuch', { b: true, size: 14 }]],
        [],
        [['Kategorie', { b: true, fill: '#E9E8FB' }], ['Geplant', { b: true, fill: '#E9E8FB', align: 'right' }], ['Tatsächlich', { b: true, fill: '#E9E8FB', align: 'right' }], ['Differenz', { b: true, fill: '#E9E8FB', align: 'right' }]],
        ['Gehalt', 2800, 2800, '=C4-B4'],
        ['Miete', -950, -950, '=C5-B5'],
        ['Lebensmittel', -400, -436.5, '=C6-B6'],
        ['Mobilität', -150, -128.9, '=C7-B7'],
        ['Freizeit', -200, -245, '=C8-B8'],
        ['Sparen', -300, -300, '=C9-B9'],
        [['Saldo', { b: true }], ['=SUMME(B4:B9)', { b: true }], ['=SUMME(C4:C9)', { b: true }], ['=C10-B10', { b: true }]],
      ];
      return { rows, fmt: { cols: [1, 2, 3], code: '#,##0.00 "€"', from: 3 }, widths: [150, 110, 110, 110], freeze: 0 };
    },
  },
  {
    id: 'stundenzettel', title: 'Stundenzettel', desc: 'Arbeitszeit pro Tag mit Summe', icon: 'ksheet', kind: 'xlsx',
    cells: () => {
      const rows = [[['Datum', { b: true, fill: '#D9F5F0' }], ['Tätigkeit', { b: true, fill: '#D9F5F0' }], ['Stunden', { b: true, fill: '#D9F5F0', align: 'right' }]]];
      const d0 = new Date();
      for (let i = 0; i < 5; i++) {
        const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - (4 - i));
        rows.push([{ date: d }, 'Projektarbeit', 8]);
      }
      rows.push([['Summe', { b: true }], '', ['=SUMME(C2:C6)', { b: true }]]);
      return { rows, widths: [110, 220, 90], freeze: 1 };
    },
  },
];

// ---------------- presentation themes (own designs) ----------------
export const SLIDE_THEMES = [
  { id: 'indigo', name: 'Indigo', bg: '#1E1B5E', title: '#FFFFFF', text: '#D9DAF7', accent: '#2DD4BF', font: 'Arial' },
  { id: 'papier', name: 'Papier', bg: '#FFFFFF', title: '#15172F', text: '#4F5475', accent: '#3B37A0', font: 'Arial' },
  { id: 'koralle', name: 'Koralle', bg: '#FFF6F0', title: '#3A1F17', text: '#5C4038', accent: '#E8613C', font: 'Georgia' },
  { id: 'wald', name: 'Wald', bg: '#0F3D3A', title: '#F1FBF8', text: '#BFE6DC', accent: '#F5C04A', font: 'Arial' },
];

export const SLIDE_LAYOUTS = [
  { id: 'title', name: 'Titel' },
  { id: 'title-text', name: 'Titel + Text' },
  { id: 'title-image', name: 'Titel + Bild' },
  { id: 'two-col', name: 'Zwei Spalten' },
  { id: 'blank', name: 'Leer' },
];
