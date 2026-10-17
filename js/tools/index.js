// Tool registry. Modules are loaded lazily when a tool is opened.
// group: 'bearbeiten' | 'konvertieren' | 'organisieren' | 'sicherheit' | 'scannen' | 'lesen'
// pro: true marks features other PDF apps only offer in paid plans (shown as "Gratis statt Pro").
export const TOOLS = [
  { id: 'unterschreiben', group: 'bearbeiten', title: 'Ausfüllen & unterschreiben', tile: 'Ausfüllen & unterschreiben', desc: 'Formulare ausfüllen, Text, Datum und Unterschrift einfügen.', icon: 'sign', needsDoc: true, load: () => import('./sign.js') },
  { id: 'kommentieren', group: 'bearbeiten', pro: true, title: 'Kommentieren', tile: 'Kommentieren', desc: 'Markieren, unterstreichen, zeichnen, Notizen, Textfelder und Formen.', icon: 'highlight', needsDoc: true, load: () => import('./annotate.js') },
  { id: 'scannen', group: 'scannen', pro: true, title: 'Scanner', tile: 'Dokument scannen', desc: 'Dokumente mit der Kamera scannen – Kanten erkennen, entzerren, verbessern.', icon: 'scan', load: () => import('./scan.js') },
  { id: 'seiten', group: 'organisieren', title: 'Seiten verwalten', tile: 'Seiten verwalten', desc: 'Seiten drehen, löschen, sortieren, extrahieren oder aufteilen.', icon: 'pages', needsDoc: true, load: () => import('./organize.js') },
  { id: 'zusammenfuegen', group: 'organisieren', title: 'Zusammenfügen', tile: 'Dateien zusammenfügen', desc: 'Mehrere PDFs in der gewünschten Reihenfolge kombinieren.', icon: 'merge', load: () => import('./merge.js') },
  { id: 'bilder', group: 'konvertieren', title: 'Bilder → PDF', tile: 'PDF erstellen', desc: 'Fotos und Scans (JPG, PNG) in eine PDF umwandeln – auch mit der Kamera.', icon: 'image', load: () => import('./images.js') },
  { id: 'komprimieren', group: 'organisieren', title: 'Komprimieren', tile: 'PDF verkleinern', desc: 'Dateigröße verringern – verlustfrei oder stark.', icon: 'compress', needsDoc: true, load: () => import('./compress.js') },
  { id: 'exportieren', group: 'konvertieren', title: 'Exportieren', tile: 'PDF zu Bild', desc: 'Seiten als PNG/JPG (ZIP) oder den Text als .txt speichern.', icon: 'export', needsDoc: true, load: () => import('./export.js') },
  { id: 'vorlesen', group: 'lesen', title: 'Vorlesen', tile: 'Vorlesen', desc: 'Dokumente mit der Sprachausgabe deines Geräts vorlesen lassen.', icon: 'speaker', needsDoc: true, viewer: true },
  { id: 'passwort', group: 'sicherheit', pro: true, title: 'Passwort festlegen', tile: 'Passwort festlegen', desc: 'PDFs mit AES-256 verschlüsseln und Rechte (Drucken, Kopieren, Bearbeiten) festlegen.', icon: 'lock', needsDoc: true, load: () => import('./protect.js') },
  { id: 'passwort-entfernen', group: 'sicherheit', pro: true, title: 'Passwort entfernen', tile: 'Passwort entfernen', desc: 'Geschützte PDF mit Passwort öffnen und als ungeschützte Kopie speichern.', icon: 'unlock', needsDoc: true, load: () => import('./protect.js').then(m => ({ mount: m.mountRemove })) },
  { id: 'schwaerzen', group: 'sicherheit', pro: true, title: 'Schwärzen', tile: 'Schwärzen', desc: 'Vertrauliche Stellen und Suchbegriffe dauerhaft und sicher entfernen.', icon: 'redact', needsDoc: true, load: () => import('./redact.js') },
  { id: 'bearbeiten', group: 'bearbeiten', pro: true, title: 'PDF bearbeiten', tile: 'PDF bearbeiten', desc: 'Text und Bilder hinzufügen, vorhandenen Text überdecken und ersetzen.', icon: 'edit', needsDoc: true, load: () => import('./edit.js') },
  { id: 'wasserzeichen', group: 'bearbeiten', pro: true, title: 'Wasserzeichen', tile: 'Wasserzeichen', desc: 'Text- oder Bild-Wasserzeichen mit Deckkraft, Drehung und Position.', icon: 'watermark', needsDoc: true, load: () => import('./stamp.js').then(m => ({ mount: m.mountWatermark })) },
  { id: 'seitenzahlen', group: 'bearbeiten', pro: true, title: 'Seitenzahlen', tile: 'Seitenzahlen', desc: 'Seitenzahlen wie „Seite 1 von N“ an der gewünschten Position einfügen.', icon: 'hash', needsDoc: true, load: () => import('./stamp.js').then(m => ({ mount: m.mountPageNumbers })) },
  { id: 'kopfzeile', group: 'bearbeiten', pro: true, title: 'Kopf- & Fußzeile', tile: 'Kopf- & Fußzeile', desc: 'Kopf- und Fußzeilen mit Datum, Dateiname und Seitenzahl.', icon: 'header', needsDoc: true, load: () => import('./stamp.js').then(m => ({ mount: m.mountHeaderFooter })) },
  { id: 'extrahieren', group: 'organisieren', title: 'Seiten extrahieren', tile: 'Seiten extrahieren', desc: 'Ausgewählte Seiten als neue PDF oder als Einzeldateien speichern.', icon: 'extract', needsDoc: true, load: () => import('./extract.js') },
  { id: 'pdf-word', group: 'konvertieren', pro: true, title: 'PDF zu Word', tile: 'PDF zu Word', desc: 'Bearbeitbares Word-Dokument (.docx) mit Absätzen und Überschriften erstellen.', icon: 'word', needsDoc: true, load: () => import('./toword.js') },
  { id: 'pdf-powerpoint', group: 'konvertieren', pro: true, title: 'PDF zu PowerPoint', tile: 'PDF zu PowerPoint', desc: 'Jede Seite als Folie in einer Präsentation (.pptx).', icon: 'slides', needsDoc: true, load: () => import('./toppt.js') },
  { id: 'ausweis', group: 'scannen', pro: true, title: 'Ausweis scannen', tile: 'Ausweis scannen', desc: 'Vorder- und Rückseite in Originalgröße auf eine A4-Seite.', icon: 'idcard', load: () => import('./scan.js').then(m => ({ mount: (s, o) => m.mount(s, { ...o, idMode: true }) })) },
  // Reading, review, forms, batch, photos, QR (FaLe PDF Plus)
  { id: 'lesemodus', group: 'lesen', pro: true, title: 'Lesemodus', tile: 'Lesemodus', desc: 'Text für das Handy umbrechen – mit Schriftgröße, Zeilenabstand und Sepia/Dunkel.', icon: 'book', needsDoc: true, load: () => import('./reader.js') },
  { id: 'vergleichen', group: 'lesen', pro: true, title: 'PDF vergleichen', tile: 'PDF vergleichen', desc: 'Zwei Versionen vergleichen – Einfügungen grün, Löschungen rot, mit Prüfbericht.', icon: 'compare', load: () => import('./compare.js') },
  { id: 'formular-erstellen', group: 'bearbeiten', pro: true, title: 'Formular erstellen', tile: 'Formular erstellen', desc: 'Ausfüllbare Felder hinzufügen: Text, Kontrollkästchen, Auswahl, Datum, Unterschrift.', icon: 'formAdd', needsDoc: true, load: () => import('./formcreate.js') },
  { id: 'signaturen', group: 'bearbeiten', title: 'Unterschriften & Stempel', tile: 'Unterschriften & Stempel', desc: 'Unterschriften, Initialen und eigene Stempel speichern und mit einem Tipp einsetzen.', icon: 'stamp', load: () => import('./sigstore.js') },
  { id: 'zuschneiden', group: 'organisieren', pro: true, title: 'Seiten zuschneiden', tile: 'Seiten zuschneiden', desc: 'Ränder abschneiden – von Hand oder automatisch, für eine oder alle Seiten.', icon: 'crop', needsDoc: true, load: () => import('./crop.js') },
  { id: 'lesezeichen', group: 'organisieren', pro: true, title: 'Lesezeichen bearbeiten', tile: 'Lesezeichen bearbeiten', desc: 'Inhaltsverzeichnis (Gliederung) anlegen, umbenennen, sortieren – auch aus Überschriften.', icon: 'outline', needsDoc: true, load: () => import('./bookmarks.js') },
  { id: 'stapel', group: 'organisieren', pro: true, title: 'Stapelverarbeitung', tile: 'Stapelverarbeitung', desc: 'Viele PDFs auf einmal bearbeiten – Schritte kombinierbar: komprimieren, schützen, nummerieren, Daten entfernen, drehen und mehr.', icon: 'layers', load: () => import('./batch.js') },
  { id: 'bildwerkzeuge', group: 'scannen', pro: true, title: 'Bild-Werkzeuge', tile: 'Fotos verbessern', desc: 'Schärfen, Schatten entfernen, Qualität verbessern, Filter, zuschneiden, Größe und Format ändern.', icon: 'wand', load: () => import('./imagetools.js') },
  { id: 'bilder-komprimieren', group: 'konvertieren', title: 'Bilder komprimieren', tile: 'Bilder komprimieren', desc: 'Fotos verkleinern – Zielgröße in KB, Format JPG, PNG oder WebP.', icon: 'compress', load: () => import('./imagetools.js').then(m => ({ mount: m.mountCompress })) },
  { id: 'passfoto', group: 'scannen', pro: true, title: 'Passfoto', tile: 'Passfoto & Bewerbungsfoto', desc: 'Biometrisches Passbild (35 × 45 mm) mit Schablone – als Foto und Drucklayout 10 × 15 cm.', icon: 'portrait', load: () => import('./passphoto.js') },
  { id: 'qr-scannen', group: 'scannen', title: 'QR-Code scannen', tile: 'QR-Code scannen', desc: 'QR- und Barcodes mit der Kamera lesen – Links, WLAN, Kontakte, Text.', icon: 'qr', load: () => import('./scan.js').then(m => ({ mount: (s, o) => m.mount(s, { ...o, qrMode: true }) })) },
  { id: 'qr-erstellen', group: 'konvertieren', title: 'QR-Code erstellen', tile: 'QR-Code erstellen', desc: 'QR-Codes für Links, WLAN, Kontakte, E-Mail und Text – als Bild, SVG, PDF oder auf eine PDF-Seite.', icon: 'qr', load: () => import('./qrtool.js') },
  // Texterkennung (OCR, offline – modules in js/ocr/)
  { id: 'text-erkennen', group: 'scannen', pro: true, title: 'Text erkennen (OCR)', tile: 'Text erkennen (OCR)', desc: 'Text aus Fotos, Scans und Bild-PDFs erkennen – kopieren, teilen, als Text, Word oder durchsuchbare PDF.', icon: 'text', load: () => import('./ocr.js') },
  { id: 'durchsuchbar', group: 'konvertieren', pro: true, title: 'Durchsuchbares PDF', tile: 'Durchsuchbares PDF', desc: 'Gescannte PDFs per Texterkennung durchsuchbar machen – das Aussehen bleibt unverändert.', icon: 'search', needsDoc: true, load: () => import('./ocr.js').then(m => ({ mount: m.mountSearchable })) },
  { id: 'bild-word', group: 'konvertieren', pro: true, title: 'Bild zu Word', tile: 'Bild zu Word', desc: 'Fotos und Scans per Texterkennung in ein bearbeitbares Word-Dokument (.docx) umwandeln.', icon: 'word', load: () => import('./ocr.js').then(m => ({ mount: m.mountWord })) },
  { id: 'bild-excel', group: 'konvertieren', pro: true, title: 'Bild zu Excel', tile: 'Bild zu Excel', desc: 'Tabellen auf Fotos und Screenshots erkennen und als Excel-Tabelle (.xlsx) speichern.', icon: 'grid', load: () => import('./ocr.js').then(m => ({ mount: m.mountExcel })) },
  { id: 'visitenkarte', group: 'scannen', pro: true, title: 'Visitenkarte scannen', tile: 'Visitenkarte scannen', desc: 'Visitenkarte fotografieren – Name, Firma, Telefon, E-Mail und Adresse als Kontakt (.vcf) speichern.', icon: 'contact', load: () => import('./bizcard.js') },
  // Office conversions (modules in js/office/)
  { id: 'pdf-excel', group: 'konvertieren', pro: true, title: 'PDF zu Excel', tile: 'PDF zu Excel', desc: 'Tabellen aus PDF-Seiten erkennen und als Excel-Tabelle (.xlsx) speichern.', icon: 'ksheet', needsDoc: true, load: () => import('../office/pdf2xlsx.js') },
  { id: 'word-pdf', group: 'konvertieren', title: 'Word zu PDF', tile: 'Word zu PDF', desc: 'Word-Dokumente (.docx), Text und Markdown als PDF speichern.', icon: 'kdoc', load: () => import('../office/convert.js') },
  { id: 'excel-pdf', group: 'konvertieren', title: 'Excel zu PDF', tile: 'Excel zu PDF', desc: 'Tabellen (.xlsx, .csv) als druckfertige PDF speichern.', icon: 'ksheet', load: () => import('../office/convert.js') },
  { id: 'ppt-pdf', group: 'konvertieren', title: 'PowerPoint zu PDF', tile: 'PowerPoint zu PDF', desc: 'Präsentationen (.pptx) als PDF speichern – eine Seite pro Folie.', icon: 'kslides', load: () => import('../office/convert.js') },
  { id: 'text-pdf', group: 'konvertieren', title: 'Text zu PDF', tile: 'Text zu PDF', desc: 'Textdateien (.txt, .md) als PDF speichern.', icon: 'kdoc', load: () => import('../office/convert.js') },
];

export const GROUPS = [
  { id: 'bearbeiten', title: 'Bearbeiten & Unterschreiben' },
  { id: 'konvertieren', title: 'Konvertieren' },
  { id: 'organisieren', title: 'Seiten & Dateien' },
  { id: 'scannen', title: 'Scannen' },
  { id: 'sicherheit', title: 'Schutz & Sicherheit' },
  { id: 'lesen', title: 'Lesen' },
];

export function toolById(id) {
  return TOOLS.find(t => t.id === id) || null;
}

// Files handed over to a tool (e.g. images dropped on the app or shared from Android).
export const handoff = { images: [] };
