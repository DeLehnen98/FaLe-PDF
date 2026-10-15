"""Vorlagen-Archiv – three more sections, generated next to the job pages by build.py (see EXTENSIONS there):

    /vorlagen/tabellen/[<slug>/]          Excel-/Tabellen-Vorlagen (data: tabellen/<template-id>.json)  ↔ /en/templates/spreadsheets/
    /vorlagen/briefe/[<slug>/]            Brief- und Schreiben-Vorlagen (data: briefe/<slug>.json)      ↔ /en/templates/letters/ (only where EN makes sense)
    /vorlagen/lebenslauf-designs/         Design-Galerie of the CV builder (data: designs/<design>.json) ↔ /en/templates/cv-designs/
    /vorlagen/data/brief-<slug>.json      prefill of the letter tools (?vorlage=brief-<slug>, lib/arc2-brief.js)
    /vorlagen/data/design-<design>.json   example CV + cover letter per design (?vorlage=design-<design>&design=<design>)

The spreadsheet templates themselves are pure data in js/office/sheet-templates.js (synced to
assets/wt/lib/shared/office/); the pages build the workbook in the browser (assets/wt/arc2-sheet.js): live preview,
in-page editing, XLSX and CSV download. Previews of the CV designs come from arc2_make_assets.py (by hand, real engine).
build(wb, bp, vb, jobs, wb_specs) → {'written', 'entries', 'data', 'hub'}; data errors raise vb.DataError.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
TAB_DIR, BRIEF_DIR, DESIGN_DIR = HERE / 'tabellen', HERE / 'briefe', HERE / 'designs'
MARK = 'data-arc2-page'
SEC = {
    'tab': {'de': '/vorlagen/tabellen/', 'en': '/en/templates/spreadsheets/'},
    'brief': {'de': '/vorlagen/briefe/', 'en': '/en/templates/letters/'},
    'design': {'de': '/vorlagen/lebenslauf-designs/', 'en': '/en/templates/cv-designs/'},
}
PREVIEW = '/assets/vorlagen/designs/'
SLUG_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')

# spreadsheet categories = SHEET_TEMPLATE_CATS in js/office/sheet-templates.js (without "Alle")
CATS = [
    ('Finanzen', 'finanzen', 'Finanzen & Haushalt', 'Money & budgets', 'secure', '<path d="M4 7h16v12H4z"/><path d="M4 11h16M8 15h3"/>'),
    ('Arbeit', 'arbeit', 'Arbeit & Zeit', 'Work & time', 'organize', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'),
    ('Business', 'business', 'Selbstständig & Firma', 'Small business', 'convert', '<path d="M4 20V9l8-5 8 5v11z"/><path d="M9 20v-6h6v6"/>'),
    ('Zuhause', 'zuhause', 'Zuhause & Alltag', 'Home & everyday', 'edit', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    ('Schule & Freizeit', 'freizeit', 'Schule & Freizeit', 'School & leisure', 'share', '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
    ('Verein', 'verein', 'Verein', 'Clubs & associations', 'read', '<circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3 20c.6-3.4 2.6-5.5 5-5.5s4.4 2.1 5 5.5M13.5 20c.4-2.6 1.8-4.2 3.5-4.2s3.1 1.6 3.5 4.2"/>'),
]
CAT = {c[0]: c for c in CATS}

# letter groups
GROUPS = [
    ('kuendigung', 'Kündigungen', 'Cancellations', 'convert', '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12l6 6M15 12l-6 6"/>'),
    ('arbeit', 'Arbeit & Beruf', 'Work', 'organize', '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/>'),
    ('wohnen', 'Wohnen', 'Housing', 'edit', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    ('behoerde', 'Widerspruch & Beschwerde', 'Objections & complaints', 'secure', '<path d="M12 3l8 4v5c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V7z"/>'),
    ('datenschutz', 'Datenschutz', 'Data protection', 'scan', '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
    ('familie', 'Schule & Familie', 'School & family', 'share', '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.6-3.4 2.6-5.5 5-5.5s4.4 2.1 5 5.5M13.5 20c.4-2.6 1.8-4.2 3.5-4.2s3.1 1.6 3.5 4.2"/>'),
    ('vollmacht', 'Vollmachten', 'Authorisations', 'read', '<path d="M5 4h10l4 4v12H5z"/><path d="M8 16c2-2 3 1 5-1"/>'),
    ('kauf', 'Kauf & Geld', 'Shopping & money', 'ai', '<path d="M5 8h14l-1.2 11H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
]
GROUP = {g[0]: g for g in GROUPS}
TOOLS = ['cancellation-letter', 'din-letter', 'withdrawal-letter', 'payment-reminder', 'power-of-attorney', 'receipt', 'leave-request']
TOOL_KEY = {'cancellation-letter': 'letter', 'din-letter': 'letter', 'withdrawal-letter': 'wd', 'payment-reminder': 'pr', 'power-of-attorney': 'poa', 'receipt': 'rc', 'leave-request': 'lv'}
SENDER_DEFAULT = ['Jana Beispiel', 'Lindenstraße 12', '66111 Saarbrücken']

TX = {
    'de': {
        'home': 'Start', 'hub': 'Vorlagen',
        'tab': 'Tabellen', 'tab_h1': 'Excel-Vorlagen kostenlos: Tabellen für Haushalt, Arbeit und Verein',
        'tab_title': 'Excel-Vorlagen kostenlos (XLSX) – {n} Tabellen | FaleNetwork',
        'tab_desc': '{n} kostenlose Tabellen-Vorlagen mit fertigen Formeln: Haushaltsbuch, Schichtplan, Fahrtenbuch, Kassenbericht und mehr – als Excel (XLSX) oder CSV, direkt im Browser.',
        'tab_lede': '{n} Tabellen mit fertigen Formeln, Auswahllisten und Farbmarkierungen. Jede Vorlage kannst du hier ansehen, im Browser ausfüllen und als Excel-Datei (XLSX) oder CSV speichern.',
        'tab_search': 'Vorlage suchen, z. B. Budget, Schicht, Verein …', 'tab_search_l': 'Tabellen-Vorlagen durchsuchen', 'tab_filter': 'Bereich',
        'tab_hits': '{n} Vorlagen', 'tab_hit1': '1 Vorlage', 'tab_nohits': 'Keine Vorlage gefunden. Probier einen anderen Begriff.',
        'tab_how_h': 'So funktionieren die Vorlagen',
        'tab_how': [('Vorlage öffnen', 'Jede Seite zeigt die Tabelle mit Beispielwerten, so wie sie in der Datei steht – Formeln schon ausgerechnet.'),
                    ('Ausfüllen oder herunterladen', 'Gelbe Felder direkt im Browser überschreiben oder die Datei als Excel (XLSX) bzw. CSV speichern.'),
                    ('Weiterrechnen', 'Die Formeln stecken in der Datei und rechnen in jedem Tabellenprogramm weiter, das XLSX öffnet.')],
        'tab_page_title': '{name}: Excel-Vorlage kostenlos (XLSX) | FaleNetwork', 'tab_page_title_short': '{name} – Excel-Vorlage | FaleNetwork',
        'tab_page_h1': '{name} – Vorlage für Excel (XLSX)',
        'xlsx': 'Als Excel (XLSX) herunterladen', 'csv': 'Als CSV', 'fill': 'Im Browser ausfüllen', 'app': 'In der FaLe-PDF-App öffnen',
        'pv_h': 'Vorschau und ausfüllen', 'pv_p': 'Das ist die Vorlage mit Beispielwerten. Tippe auf ein Feld, um es zu ändern – die Formeln rechnen sofort neu. Danach lädst du deine Version herunter.',
        'pv_nojs': 'Die Vorschau braucht JavaScript. Die Spalten und Formeln sind unten erklärt; die Datei bekommst du auch in der FaLe-PDF-App.',
        'cols_h': 'Spalten und Formeln erklärt', 'cols_p': 'Was in jeder Spalte steht und was die Formeln rechnen – in normalen Worten.',
        'uses_h': 'Wofür sich die Vorlage eignet', 'tips_h': 'Tipps', 'faq_h': 'Häufige Fragen', 'rel_h': 'Passende Vorlagen', 'more_h': 'Mehr Vorlagen',
        'sheets_n': '{n} Tabellenblätter', 'sheet1': '1 Tabellenblatt',
        'faq_tab': [('Funktionieren die Formeln auch in anderen Programmen?', 'Ja. Die Datei ist eine normale Excel-Datei (XLSX) mit echten Formeln. Wir prüfen jede Vorlage in einem freien Tabellenprogramm, das die Formeln neu berechnet. Auswahllisten und Farbmarkierungen sind ebenfalls in der Datei gespeichert.'),
                    ('Werden meine Eingaben irgendwo gespeichert?', 'Nein. Vorschau, Bearbeiten und Download laufen komplett in deinem Browser. Es gibt kein Konto, und nichts wird hochgeladen. Wenn du die Seite schließt, sind deine Änderungen weg – lade die Datei vorher herunter.'),
                    ('Was bringt die CSV-Datei?', 'CSV ist reiner Text ohne Formeln und Formatierung, mit Semikolon getrennt und deutschem Dezimalkomma. Das passt, wenn du die Werte in ein anderes Programm oder eine Datenbank übernehmen willst. Zum Weiterrechnen ist die XLSX-Datei besser.')],
        'tm': 'Excel ist eine Marke ihres Inhabers. „Excel (XLSX)“ bezeichnet hier nur das Dateiformat; FaleNetwork steht mit dem Hersteller in keiner Verbindung.',
        'brief': 'Briefe', 'brief_h1': 'Briefvorlagen und Musterschreiben',
        'brief_title': 'Briefvorlagen kostenlos: Kündigung, Widerspruch & mehr | FaleNetwork',
        'brief_desc': 'Kostenlose Musterbriefe für Kündigung, Widerspruch, Mängelanzeige, Elternzeit, DSGVO-Auskunft und mehr – mit Erklärung und direkt als PDF ausfüllbar.',
        'brief_lede': '{n} Musterschreiben für Alltag, Arbeit und Behörden. Zu jedem erfährst du, wann du es brauchst und was hineingehört – „Vorlage verwenden“ öffnet das Schreiben fertig vorausgefüllt.',
        'brief_search': 'Schreiben suchen, z. B. Handy, Widerspruch, Kita …', 'brief_search_l': 'Briefvorlagen durchsuchen', 'brief_filter': 'Thema',
        'brief_hits': '{n} Vorlagen', 'brief_hit1': '1 Vorlage', 'brief_nohits': 'Keine Vorlage gefunden. Probier einen anderen Begriff – oder nimm den freien Brief nach DIN 5008.',
        'brief_page_title': '{name}: Vorlage & Muster kostenlos | FaleNetwork', 'brief_page_title_short': '{name} – Muster | FaleNetwork',
        'brief_lede_page': 'Wann du das Schreiben brauchst, was hineingehört und ein ausformuliertes Muster – mit einem Tipp öffnest du es vorausgefüllt und speicherst es als PDF.',
        'use': 'Vorlage verwenden', 'copy': 'Text kopieren', 'copied': 'Kopiert',
        'when_h': 'Wann brauchst du dieses Schreiben?', 'must_h': 'Das gehört hinein', 'example_h': 'Musterschreiben', 'mail_h': 'Muster-E-Mail',
        'example_p': 'Absender, Empfänger und Nummern sind erfunden. Ersetze sie durch deine Angaben – im Werkzeug ist alles schon eingetragen.',
        'doc_h': 'Das steht im fertigen Dokument', 'notes_h': 'Wichtig zu wissen',
        'legal': 'Keine Rechtsberatung: Die Vorlage zeigt einen üblichen Aufbau. Fristen und Formvorschriften hängen von deinem Vertrag und deinem Fall ab. Wenn viel auf dem Spiel steht, lass dich beraten – etwa von einer Verbraucherzentrale, deiner Gewerkschaft, einem Mieterverein oder einer Anwältin bzw. einem Anwalt.',
        'paper': 'Achtung Schriftform: Dieses Schreiben musst du ausdrucken und eigenhändig mit Kugelschreiber unterschreiben. Eine E-Mail, ein Fax oder eine eingefügte Unterschrift reichen nicht.',
        'send_h': 'So verschickst du es', 'send': 'Verschick wichtige Schreiben so, dass du den Zugang beweisen kannst – zum Beispiel per Einwurf-Einschreiben oder persönlich gegen Empfangsbestätigung. Heb eine Kopie und den Beleg auf.',
        'date_ph': 'TT.MM.JJJJ', 'rel_brief_h': 'Ähnliche Vorlagen', 'tool_h': 'Werkzeug',
        'design': 'Lebenslauf-Designs', 'design_h1': 'Lebenslauf-Designs: {n} Vorlagen zur Auswahl',
        'design_title': 'Lebenslauf-Vorlagen: {n} Designs kostenlos als PDF | FaleNetwork',
        'design_desc': '{n} kostenlose Lebenslauf-Designs – klassisch, modern, ATS-freundlich, akademisch oder für Schüler. Mit Beispiel öffnen, Daten ersetzen, PDF speichern.',
        'design_lede': 'Alle Designs gehören zum selben Lebenslauf-Editor: Du kannst jederzeit wechseln, ohne etwas neu einzutippen. Die Vorschaubilder sind echte Ausgaben des Editors.',
        'design_open': 'Mit diesem Design öffnen', 'design_letter': 'Passendes Anschreiben', 'design_alt': 'Vorschau des Lebenslauf-Designs „{name}“ mit Beispieldaten',
        'design_good': 'Passt gut für', 'design_how_h': 'Welches Design passt zu dir?',
        'design_faq': [('Kann ich das Design später noch ändern?', 'Ja. Im Editor wechselst du das Design unter „1. Design“ – alle Angaben bleiben erhalten. Probier ruhig mehrere aus, die Vorschau aktualisiert sich sofort.'),
                       ('Was heißt ATS-freundlich?', 'Viele Firmen lassen Bewerbungen zuerst von einer Software auslesen (Applicant Tracking System). Die liest einspaltige Lebensläufe mit klaren Überschriften und echtem Text am zuverlässigsten. Das Design „ATS-freundlich“ verzichtet deshalb auf Spalten, Grafiken, Balken und Foto.'),
                       ('Wie lang darf ein Lebenslauf sein?', 'Üblich sind ein bis zwei Seiten. Der Editor verteilt den Inhalt automatisch auf weitere Seiten und nummeriert sie. Wird es mehr, hilft meist das Design „Kompakt“ oder „Minimal“ – oder ein paar ältere Stationen kürzer zu fassen.'),
                       ('Werden meine Daten gespeichert?', 'Nein. Der Lebenslauf entsteht in deinem Browser. Gespeichert wird nur, wenn du im Editor „Entwurf speichern“ einschaltest – und dann nur auf deinem Gerät.')],
        'example_note': 'Alle Personen, Firmen und Kontaktdaten in den Beispielen sind erfunden.',
        'hub_extra_h': 'Weitere Vorlagen-Sammlungen',
        'hub_tab': ('Excel-Vorlagen', '{n} Tabellen mit Formeln – ansehen, im Browser ausfüllen, als XLSX oder CSV speichern.'),
        'hub_brief': ('Briefvorlagen', '{n} Musterschreiben: Kündigung, Widerspruch, Mängelanzeige, Elternzeit, DSGVO und mehr.'),
        'hub_design': ('Lebenslauf-Designs', '{n} Designs für den Lebenslauf – von klassisch bis ATS-freundlich, mit Beispiel.'),
    },
    'en': {
        'home': 'Home', 'hub': 'Templates',
        'tab': 'Spreadsheets', 'tab_h1': 'Free spreadsheet templates for Excel (XLSX)',
        'tab_title': 'Free spreadsheet templates (XLSX) – {n} templates | FaleNetwork',
        'tab_desc': '{n} free spreadsheet templates with working formulas – budgets, shift plans, mileage logs, club accounts and more. Download as Excel (XLSX) or CSV.',
        'tab_lede': '{n} spreadsheets with working formulas, drop-down lists and colour rules. Look at each one, fill it in right here and save it as an Excel file (XLSX) or CSV. The sheets are labelled in German.',
        'tab_search': 'Search templates, e.g. budget, shift …', 'tab_search_l': 'Search spreadsheet templates', 'tab_filter': 'Area',
        'tab_hits': '{n} templates', 'tab_hit1': '1 template', 'tab_nohits': 'No template found. Try another word.',
        'tab_how_h': 'How the templates work',
        'tab_how': [('Open a template', 'Each page shows the sheet with sample values exactly as it is in the file – formulas already calculated.'),
                    ('Fill in or download', 'Overwrite the yellow cells right in the browser, or save the file as Excel (XLSX) or CSV.'),
                    ('Keep calculating', 'The formulas are in the file and keep working in any spreadsheet program that opens XLSX.')],
        'tab_page_title': '{name} spreadsheet template (XLSX), free | FaleNetwork', 'tab_page_title_short': '{name} – XLSX template | FaleNetwork',
        'tab_page_h1': '{name} – spreadsheet template (XLSX)',
        'xlsx': 'Download as Excel (XLSX)', 'csv': 'Download CSV', 'fill': 'Fill in here', 'app': 'Open in the FaLe PDF app',
        'pv_h': 'Preview and fill in', 'pv_p': 'This is the template with sample values. Tap a cell to change it – the formulas recalculate at once. Then download your version.',
        'pv_nojs': 'The preview needs JavaScript. You can also open the template in the FaLe PDF app.',
        'cols_h': 'What is inside', 'cols_p': 'The sheet labels are in German; here is what the template does.',
        'uses_h': 'Good for', 'tips_h': 'Tips', 'faq_h': 'Frequently asked questions', 'rel_h': 'Related templates', 'more_h': 'More templates',
        'sheets_n': '{n} sheets', 'sheet1': '1 sheet',
        'faq_tab': [('Do the formulas work in other programs?', 'Yes. The file is a normal Excel file (XLSX) with real formulas. Every template is checked in a free spreadsheet program that recalculates the formulas. Drop-down lists and colour rules are stored in the file as well.'),
                    ('Is anything I type stored?', 'No. Preview, editing and download all happen in your browser. There is no account and nothing is uploaded. Download the file before you close the page.'),
                    ('Why are the labels in German?', 'The templates were made for everyday use in Germany – things like the mileage log, the club cash report or the profit-and-loss sheet follow German practice. Formulas and numbers work the same in any language version of your spreadsheet program.')],
        'tm': 'Excel is a trademark of its owner. “Excel (XLSX)” only names the file format here; FaleNetwork is not affiliated with the manufacturer.',
        'brief': 'Letters', 'brief_h1': 'Letter templates',
        'brief_title': 'Free letter templates – data access & erasure requests | FaleNetwork',
        'brief_desc': 'Free letter templates with explanations: request access to your personal data or ask for it to be erased under the GDPR – filled in and saved as PDF in your browser.',
        'brief_lede': 'Letters that work across the EU. Each page explains when you need the letter and what goes in it – “Use this template” opens it filled in.',
        'brief_search': 'Search letters …', 'brief_search_l': 'Search letter templates', 'brief_filter': 'Topic',
        'brief_hits': '{n} templates', 'brief_hit1': '1 template', 'brief_nohits': 'No template found.',
        'brief_page_title': '{name}: free template | FaleNetwork', 'brief_page_title_short': '{name} | FaleNetwork',
        'brief_lede_page': 'When you need the letter, what must be in it and a fully written example – one tap opens it filled in, ready to save as a PDF.',
        'use': 'Use this template', 'copy': 'Copy text', 'copied': 'Copied',
        'when_h': 'When do you need this letter?', 'must_h': 'What goes in it', 'example_h': 'Example letter', 'mail_h': 'Example e-mail',
        'example_p': 'Sender, recipient and numbers are fictional. Replace them with your details – in the tool everything is already filled in.',
        'doc_h': 'What the finished document says', 'notes_h': 'Good to know',
        'legal': 'Not legal advice: the template shows a common structure. Deadlines and formal requirements depend on your case. If a lot is at stake, get advice – for example from a consumer advice centre or a lawyer.',
        'paper': '', 'send_h': 'How to send it', 'send': 'Send important letters in a way you can prove, for example by recorded delivery or by e-mail to the address the organisation names for data protection requests. Keep a copy.',
        'date_ph': 'DD Month YYYY', 'rel_brief_h': 'Similar templates', 'tool_h': 'Tool',
        'design': 'CV designs', 'design_h1': 'CV templates: {n} designs to choose from',
        'design_title': 'CV templates: {n} free designs as PDF | FaleNetwork',
        'design_desc': '{n} free CV designs – classic, modern, ATS-friendly, academic or for school leavers. Open one with an example, replace the details and save the PDF.',
        'design_lede': 'All designs belong to the same CV editor, so you can switch at any time without retyping anything. The previews are real output of the editor.',
        'design_open': 'Open with this design', 'design_letter': 'Matching cover letter', 'design_alt': 'Preview of the “{name}” CV design with sample details',
        'design_good': 'Good for', 'design_how_h': 'Which design suits you?',
        'design_faq': [('Can I change the design later?', 'Yes. In the editor you switch the design under “1. Design” and all your details stay. Try a few – the preview updates at once.'),
                       ('What does ATS-friendly mean?', 'Many employers let software read applications first (an applicant tracking system). Such systems read one-column CVs with clear headings and real text most reliably, so the “ATS-friendly” design leaves out columns, graphics, bars and the photo.'),
                       ('How long should a CV be?', 'One or two pages is usual. The editor flows longer content onto more pages and numbers them. If it gets longer, the “Compact” or “Minimal” design helps – or shorten older positions.'),
                       ('Is my data stored?', 'No. The CV is created in your browser. Nothing is stored unless you switch on “Save the draft” in the editor – and then only on your device.')],
        'example_note': 'All people, companies and contact details in the examples are fictional.',
        'hub_extra_h': 'More template collections',
        'hub_tab': ('Spreadsheet templates', '{n} spreadsheets with formulas – view, fill in here, save as XLSX or CSV.'),
        'hub_brief': ('Letter templates', 'GDPR data access and erasure requests, explained and ready to fill in.'),
        'hub_design': ('CV designs', '{n} CV designs – from classic to ATS-friendly, each with an example.'),
    },
}

# CV designs: id, DE name, EN name, DE text, EN text, DE good-for, EN good-for (ids = lib/tpl-cv.js DESIGNS)
DESIGNS = [
    ('classic', 'Klassisch', 'Classic', 'Serifenschrift, eine Spalte, Überschriften in Großbuchstaben. Ruhig und seriös – wirkt in jeder Branche.', 'Serif type, one column, headings in capitals. Calm and serious – works in any field.', 'Verwaltung, Recht, Banken, Öffentlicher Dienst', 'Administration, law, banking, public sector'),
    ('modern', 'Modern', 'Modern', 'Farbige Seitenleiste mit Foto, Kontakt, Kenntnissen und Sprachen; rechts die Stationen. Übersichtlich auf einen Blick.', 'Coloured sidebar with photo, contact, skills and languages; experience on the right. Easy to scan.', 'Büro, Handel, Pflege, IT – fast alles', 'Office, retail, healthcare, IT – almost anything'),
    ('compact', 'Kompakt', 'Compact', 'Dicht gesetzt, Überschriften links neben dem Inhalt. Bringt viel Erfahrung auf wenig Platz.', 'Dense layout with headings to the left of the content. Fits a lot of experience into little space.', 'Viele Stationen, Handwerk, Technik', 'Long careers, skilled trades, engineering'),
    ('elegant', 'Elegant', 'Elegant', 'Zentrierter Kopf mit Foto über dem Namen, Serifenschrift, Zierlinien an den Überschriften. Für einen gepflegten ersten Eindruck.', 'Centred header with the photo above the name, serif type and fine rules beside the headings. Makes a polished first impression.', 'Assistenz, Hotel, Beratung, Kultur', 'Executive assistants, hotels, consulting, culture'),
    ('timeline', 'Zeitstrahl', 'Timeline', 'Die Stationen hängen an einer senkrechten Linie mit Punkten – der Werdegang liest sich wie eine Zeitleiste.', 'Each position hangs on a vertical line with dots – your career reads like a timeline.', 'Klare Laufbahn, Pflege, Logistik, Vertrieb', 'Clear career paths, healthcare, logistics, sales'),
    ('minimal', 'Minimal', 'Minimal', 'Schwarz-weiß, viel Weißraum, kleine graue Abschnittsnamen am Rand. Lässt den Inhalt sprechen.', 'Black and white, lots of white space, small grey section labels in the margin. Lets the content speak.', 'Finanzen, Architektur, Design, Führungskräfte', 'Finance, architecture, design, senior roles'),
    ('creative', 'Kreativ', 'Creative', 'Kräftige Farbleiste mit weißer Schrift für Foto, Kontakt und Kenntnisse. Fällt auf, ohne unruhig zu sein.', 'Bold colour sidebar with white text for photo, contact and skills. Stands out without being busy.', 'Marketing, Medien, Gastronomie, Social Media', 'Marketing, media, hospitality, social media'),
    ('ats', 'ATS-freundlich', 'ATS-friendly', 'Eine Spalte, keine Grafiken, kein Foto, Standard-Überschriften – so lesen Bewerbungsportale den Text sicher aus.', 'One column, no graphics, no photo, standard headings – job portals read the text reliably.', 'Online-Portale, Konzerne, Personalvermittlungen', 'Online portals, large companies, recruiters'),
    ('academic', 'Akademisch', 'Academic', 'Serifenschrift, Jahreszahlen rechtsbündig, eigener Abschnitt für Publikationen und Vorträge.', 'Serif type, dates aligned right, a section for publications and talks.', 'Wissenschaft, Promotion, Lehre, Forschung', 'Research, PhD, teaching'),
    ('school', 'Schule & Ausbildung', 'School leaver', 'Farbiges Kopfband, die Schulbildung steht vorn, Praktika und Nebenjobs danach. Ideal, wenn noch wenig Berufserfahrung da ist.', 'Colour header band, education first, placements and part-time jobs after it. Ideal when you have little work experience yet.', 'Ausbildung, Praktikum, Schülerjob, Studium', 'Apprenticeships, placements, first jobs'),
]
DESIGN_IDS = [d[0] for d in DESIGNS]
ACCENTS = ['#2b59c3', '#0f766e', '#7c3aed', '#b91c1c', '#c2410c', '#334155']


def fmt(s, **kw):
    return s.format(**kw)


# --------------------------------------------------------------------------------------------- load + validate
def _load_dir(d, vb, errors):
    out = []
    for f in sorted(d.glob('*.json')):
        try:
            x = json.loads(f.read_text(encoding='utf-8'))
        except Exception as ex:  # noqa: BLE001
            errors.append(f'{f.name}: {ex}')
            continue
        x['_file'] = f.name
        out.append(x)
    return out


def load(vb, wb, jobs):
    errors = []
    tabs = _load_dir(TAB_DIR, vb, errors)
    for t in tabs:
        w = f'tabellen/{t["_file"]}'
        for k in ('id', 'name', 'cat', 'short', 'desc', 'intro', 'uses', 'cols', 'faq', 'en'):
            if k not in t:
                errors.append(f'{w}: "{k}" missing')
        if errors and errors[-1].startswith(w):
            continue
        t.setdefault('slug', t['id'])
        if t['id'] + '.json' != t['_file'] or not SLUG_RE.match(t['slug']):
            errors.append(f'{w}: id must equal the file name, slug a–z0–9-')
        if t['cat'] not in CAT:
            errors.append(f'{w}: unknown cat {t["cat"]!r}')
        if not 110 <= len(t['desc']) <= 180:
            errors.append(f'{w}: desc length {len(t["desc"])} (110–180)')
        if not all(isinstance(c, list) and len(c) == 2 for c in t['cols']):
            errors.append(f'{w}: cols = [[header, explanation]]')
        for k in ('slug', 'name', 'short', 'desc', 'intro', 'inside', 'uses'):
            if k not in t['en']:
                errors.append(f'{w}: en.{k} missing')
        if 'en' in t and 'desc' in t['en'] and not 110 <= len(t['en']['desc']) <= 180:
            errors.append(f'{w}: en.desc length {len(t["en"]["desc"])} (110–180)')
    briefs = _load_dir(BRIEF_DIR, vb, errors)
    for b in briefs:
        w = f'briefe/{b["_file"]}'
        for k in ('id', 'group', 'tool', 'name', 'short', 'desc', 'when', 'must', 'notes', 'faq', 'fields'):
            if k not in b:
                errors.append(f'{w}: "{k}" missing')
        if errors and errors[-1].startswith(w):
            continue
        b.setdefault('slug', b['id'])
        if b['id'] + '.json' != b['_file'] or not SLUG_RE.match(b['slug']):
            errors.append(f'{w}: id must equal the file name')
        if b['group'] not in GROUP or b['tool'] not in TOOLS:
            errors.append(f'{w}: unknown group/tool')
        if not 110 <= len(b['desc']) <= 180:
            errors.append(f'{w}: desc length {len(b["desc"])} (110–180)')
        if b['tool'] in ('din-letter',) and 'letter' not in b:
            errors.append(f'{w}: din-letter needs "letter"')
        if 'en' in b and 'letter' not in b['en']:
            errors.append(f'{w}: en needs "letter"')
    designs = _load_dir(DESIGN_DIR, vb, errors)
    for d in designs:
        w = f'designs/{d["_file"]}'
        if d.get('id') not in DESIGN_IDS or d['id'] + '.json' != d['_file']:
            errors.append(f'{w}: id must be a design id and equal the file name')
        for lg in ('de', 'en'):
            src = d.get(lg)
            if not src or 'cv' not in src or 'letter' not in src:
                errors.append(f'{w}: {lg}.cv / {lg}.letter missing')
                continue
            vb.check_cv(f'{w} {lg}', {**src['cv'], 'design': 'modern'}, errors)
            vb.check_letter(f'{w} {lg}', {**src['letter'], 'level': 'erfahren', 'label': src['letter'].get('label', 'x')}, errors)
    if {d['id'] for d in designs} != set(DESIGN_IDS):
        errors.append(f'designs/: one file per design needed ({", ".join(DESIGN_IDS)})')
    blob = json.dumps([tabs, briefs, designs], ensure_ascii=False)
    m = wb.BANNED.search(blob)
    if m:
        errors.append(f'arc2 data: brand name "{m.group(0)}"')
    en_job_slugs = {j['en']['slug'] for j in jobs if 'en' in j}
    for s in ('spreadsheets', 'letters', 'cv-designs'):
        if s in en_job_slugs:
            errors.append(f'EN job slug "{s}" collides with an arc2 section')
    for kind, items in (('tab', tabs), ('brief', briefs)):
        slugs = [x['slug'] for x in items]
        if len(set(slugs)) != len(slugs):
            errors.append(f'{kind}: duplicate slugs')
        ids = {x['id'] for x in items}
        for x in items:
            x['related'] = [r for r in x.get('related', []) if r in ids and r != x['id']]
    if errors:
        raise vb.DataError('\n'.join(errors))
    cat_order = {c[0]: i for i, c in enumerate(CATS)}
    tabs.sort(key=lambda t: (cat_order[t['cat']], vb.fold(t['name'])))
    g_order = {g[0]: i for i, g in enumerate(GROUPS)}
    briefs.sort(key=lambda b: (g_order[b['group']], b.get('order', 50), vb.fold(b['name'])))
    designs.sort(key=lambda d: DESIGN_IDS.index(d['id']))
    return tabs, briefs, designs


# --------------------------------------------------------------------------------------------- cancellation letter text (= buildLetter in tools/cancellation-letter.js, German)
C_TYPES = {
    'handy': ('meinen Mobilfunkvertrag', 'Kündigung meines Mobilfunkvertrags', [('customer', 'Kundennummer'), ('phone', 'Rufnummer'), ('contract', 'Vertragsnummer')]),
    'internet': ('meinen Internetvertrag', 'Kündigung meines Internetvertrags', [('customer', 'Kundennummer'), ('contract', 'Vertragsnummer'), ('line', 'Anschluss')]),
    'fitness': ('meine Mitgliedschaft', 'Kündigung meiner Mitgliedschaft', [('member', 'Mitgliedsnummer'), ('site', 'Standort')]),
    'energy': ('meinen Energieliefervertrag', 'Kündigung meines Energieliefervertrags', [('customer', 'Kundennummer'), ('meter', 'Zählernummer')]),
    'insurance': ('meinen Versicherungsvertrag', 'Kündigung meines Versicherungsvertrags', [('policy', 'Versicherungsnummer')]),
    'magazine': ('mein Abonnement', 'Kündigung meines Abonnements', [('subno', 'Abonummer')]),
    'streaming': ('mein Abonnement', 'Kündigung meines Abonnements', [('account', 'Konto'), ('customer', 'Kundennummer')]),
    'rent': ('das Mietverhältnis', 'Kündigung des Mietverhältnisses', []),
    'club': ('meine Mitgliedschaft', 'Kündigung meiner Mitgliedschaft', [('member', 'Mitgliedsnummer')]),
    'other': ('meinen Vertrag', 'Kündigung meines Vertrags', [('number', 'Vertrags-/Kundennummer')]),
}


def cancel_letter(v, date_ph):
    typ = v.get('type', 'other')
    what, subj, refs_def = C_TYPES[typ]
    g = lambda k: str(v.get(k) or '').strip()  # noqa: E731
    if typ == 'insurance' and g('kind'):
        what = f'meine {g("kind")}'
    if typ == 'magazine' and g('title'):
        what = f'mein Abonnement „{g("title")}“'
    if typ == 'streaming' and g('service'):
        what = f'mein Abonnement bei {g("service")}'
    if typ == 'rent' and g('object'):
        what = f'das Mietverhältnis über die Wohnung {g("object")}' + (f' ({g("floor")})' if g('floor') else '')
    if typ == 'other' and g('thing'):
        what = g('thing')
    refs = [(lab, g(k)) for k, lab in refs_def if g(k)]
    ref_text = f' ({", ".join(f"{a}: {b}" for a, b in refs)})' if refs and typ != 'rent' else ''
    if typ == 'rent' and v.get('when') != 'date':
        when = f'fristgerecht zum nächstmöglichen Termin, nach meiner Berechnung zum {date_ph}'
    elif v.get('when') == 'date':
        when = f'zum {date_ph}'
    else:
        when = 'fristgerecht zum nächstmöglichen Zeitpunkt'
    body = [f'hiermit kündige ich {what}{ref_text} {when}.']
    if v.get('when') == 'date' and typ != 'rent':
        body.append('Sollte eine Kündigung zu diesem Datum nicht möglich sein, gilt sie zum nächstmöglichen Zeitpunkt.')
    if typ == 'handy' and v.get('port'):
        body.append('Ich möchte meine Rufnummer zu einem anderen Anbieter mitnehmen. Bitte geben Sie die Rufnummer für die Übertragung frei und bestätigen Sie mir dies.')
    if typ == 'internet':
        body.append('Bitte teilen Sie mir mit, ob und wohin ich überlassene Geräte (z. B. den Router) zurücksenden soll.')
    if typ == 'energy':
        if g('reading'):
            body.append(f'Der Zählerstand betrug am {date_ph if g("readingDate") else "Tag der Ablesung"}: {g("reading")}.')
        body.append('Bitte senden Sie mir die Schlussrechnung an die oben genannte Anschrift.')
    if typ == 'rent':
        co = [x.strip() for x in g('cotenants').split(',') if x.strip()]
        if co:
            body.append(f'Die Kündigung erfolgt zugleich im Namen der weiteren Mieter ({", ".join(co)}).')
        if v.get('handover') is not False:
            body.append('Für die Übergabe der Wohnung und der Schlüssel bitte ich Sie, mir rechtzeitig mögliche Termine zu nennen.')
        if v.get('deposit') is not False:
            body.append('Bitte rechnen Sie die Mietkaution nach Ende des Mietverhältnisses ab und überweisen Sie das Guthaben' + (f' auf das Konto IBAN {g("iban")}' if g('iban') else '') + '.')
    if v.get('confirm') is not False:
        body.append(f'Bitte bestätigen Sie mir den Eingang dieser Kündigung und das genaue Ende {"des Mietverhältnisses" if typ == "rent" else "des Vertrags"} schriftlich.')
    if v.get('sepa') is not False and typ != 'rent':
        body.append('Ein erteiltes SEPA-Lastschriftmandat widerrufe ich mit Wirkung zum Vertragsende.')
    if v.get('gdpr'):
        body.append('Zudem bitte ich Sie, meine personenbezogenen Daten gemäß Art. 17 DSGVO zu löschen, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen, und mir die Löschung zu bestätigen.')
    if v.get('noAds'):
        body.append('Von Anrufen oder Nachrichten mit dem Ziel, mich als Kunden zurückzugewinnen, bitte ich abzusehen.')
    subject = subj + (f' – {refs[0][0]} {refs[0][1]}' if refs and typ != 'rent' else '')
    return {'subject': subject, 'salutation': 'Sehr geehrte Damen und Herren,', 'body': body, 'closing': 'Mit freundlichen Grüßen', 'refs': refs if typ != 'rent' else []}


# --------------------------------------------------------------------------------------------- letter model per brief
def brief_model(b, lang, vb):
    """→ {sender[5], recipient[], dateLine, subject, salutation, body[], closing, name, att[], notice, mail} (page + tool fields)."""
    src = b if lang == 'de' else b['en']
    s = TX[lang]
    sender = list(src.get('from') or b.get('from') or SENDER_DEFAULT)
    to = src.get('to') or b.get('to') or {}
    rec = [x for x in (to.get('org'), to.get('attn'), to.get('street'), to.get('city')) if x]
    place = re.sub(r'^\d{4,5}\s+', '', sender[2]) if lang == 'de' else ''
    name = sender[0]
    if b['tool'] == 'cancellation-letter':
        m = cancel_letter(b['fields'], s['date_ph'])
        body = m['body']
        subject, salutation, closing, att = m['subject'], m['salutation'], m['closing'], []
    else:
        L = src.get('letter') or {}
        subject, salutation, body, closing, att = L.get('subject', ''), L.get('salutation', ''), list(L.get('body', [])), L.get('closing', ''), L.get('att', [])
    return {'sender': [sender[0], sender[1], sender[2], vb.phone_for(sender[0]), vb.email_for(sender[0])], 'recipient': rec,
            'dateLine': (f'{place}, ' if place else '') + s['date_ph'], 'subject': subject, 'salutation': salutation, 'body': body,
            'closing': closing, 'name': name, 'att': att, 'notice': (src.get('letter') or {}).get('notice', ''), 'mail': bool(b.get('mail'))}


def brief_fields(b, lang, vb):
    """Values for the tool form (state.values[key]) – the tool's own field names."""
    m = brief_model(b, lang, vb)
    src = b if lang == 'de' else b['en']
    f = dict(src.get('fields') or b['fields'])
    tool = b['tool']
    sender = {'sName': m['sender'][0], 'sStreet': m['sender'][1], 'sCity': m['sender'][2], 'sPhone': m['sender'][3], 'sMail': m['sender'][4],
              'place': re.sub(r'^\d{4,5}\s+', '', m['sender'][2]) if lang == 'de' else ''}
    to = src.get('to') or b.get('to') or {}
    rec = {'rName': to.get('org', ''), 'rAttn': to.get('attn', ''), 'rStreet': to.get('street', ''), 'rCity': to.get('city', '')}
    if tool in ('cancellation-letter', 'din-letter', 'withdrawal-letter', 'payment-reminder'):
        f = {**sender, **rec, **f}
    if tool == 'din-letter':
        notice = m['notice']
        f.update({'subject': m['subject'], 'salutation': m['salutation'], 'body': '\n\n'.join(m['body']), 'closing': m['closing'],
                  'enclosures': '\n'.join(m['att']), 'notice': notice or f.get('notice', 'none')})
    return f


# --------------------------------------------------------------------------------------------- html helpers
def esc(t):
    import html
    return html.escape(str(t), quote=True)


def icon_chip(colour, paths, cls='vl-fic'):
    return (f'<span class="wt-chip-ic tic-{colour} {cls}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths}</svg></span>')


def config(obj, extra_module=None):
    data = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), sort_keys=True).replace('</', '<\\/')
    out = f'<script type="application/json" id="vl-config">{data}</script>\n<script type="module" src="/assets/wt/vl.js"></script>'
    if extra_module:
        out += f'\n<script type="module" src="{extra_module}"></script>'
    return out


def head(vb, wb, bp, lang, title, desc, ld, path, pair):
    h = vb.head_for(wb, bp, lang, title, desc, ld, path, pair)
    return h.replace('<link rel="stylesheet" href="/assets/wt/vl.css">', '<link rel="stylesheet" href="/assets/wt/vl.css">\n  <link rel="stylesheet" href="/assets/wt/arc2.css">', 1)


def faq_ld(items, lang):
    return {'@context': 'https://schema.org', '@type': 'FAQPage', 'inLanguage': lang, 'mainEntity': [
        {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in items]}


def faq_html(items):
    return ''.join(f'<details><summary>{esc(q)}</summary><div><p>{esc(a)}</p></div></details>' for q, a in items)


def section(sid, title, inner, sub=''):
    sub_html = f'<p class="vl-sub">{esc(sub)}</p>' if sub else ''
    return f'''
  <section class="section wt-sec" aria-labelledby="{sid}">
    <div class="wrap">
      <h2 id="{sid}">{esc(title)}</h2>{sub_html}
      {inner}
    </div>
  </section>'''


def page(vb, wb, bp, lang, kind, path, pair, title, desc, ld, crumbs_items, main_html, cfg, extra_module=None, other_url=None):
    h = head(vb, wb, bp, lang, title, desc, ld, path, pair)
    other = 'en' if lang == 'de' else 'de'
    hdr = bp.header(lang, 'home', current=vb.HUB[lang], other_url=other_url or (pair[1] if pair and lang == 'de' else pair[0] if pair else vb.HUB[other]))
    body = f'''
<main id="main" class="wt-page vl-page arc2-page" {MARK}="{kind}">
  <div class="wrap wt-top">
    {vb.crumbs(wb, lang, crumbs_items)}
{main_html}
</main>
{config(cfg, extra_module)}
'''
    return h + '\n' + hdr + body + bp.footer(lang)


def chips(name, options, label, s_all):
    btns = f'<li><button type="button" class="wt-cat" data-vl-{name}="" aria-pressed="true">{esc(s_all)}</button></li>' + ''.join(
        f'<li><button type="button" class="wt-cat" data-vl-{name}="{oid}" aria-pressed="false">{esc(lab)}</button></li>' for oid, lab in options)
    return f'<div class="vl-filter" data-vl-filter hidden><p class="vl-filter-l" id="vl-{name}-l">{esc(label)}</p><ul class="wt-cats" aria-labelledby="vl-{name}-l">{btns}</ul></div>'


def search_box(wb, label, ph):
    return (f'<div class="wt-search" data-vl-search hidden><label for="vl-q">{wb.svg(wb.UI_ICONS["search"])}<span class="sr-only">{esc(label)}</span></label>'
            f'<input id="vl-q" type="search" placeholder="{esc(ph)}" autocomplete="off" enterkeyhint="search" data-vl-q></div>')


def card(href, name, short, field, search, chip='', pills=(), heading='h3'):
    p = ''.join(f'<span class="vl-pill">{esc(x)}</span>' for x in pills)
    return (f'<li class="wt-card vl-card" data-field="{field}" data-levels="" data-search="{esc(search)}"><a href="{href}">{chip}<{heading} class="wt-card-name">{esc(name)}</{heading}>'
            f'<span class="wt-card-desc">{esc(short)}</span>{f"<span class=vl-pills>{p}</span>" if p else ""}</a></li>')


def tool_url(wb_specs, tid, lang):
    sp = wb_specs.get(tid)
    return ('/werkzeuge/' if lang == 'de' else '/en/tools/') + sp[lang]['slug'] + '/' if sp else None


# --------------------------------------------------------------------------------------------- spreadsheet pages
def tab_path(t, lang):
    return SEC['tab'][lang] + (t['slug'] if lang == 'de' else t['en']['slug']) + '/'


def tab_card(t, lang, vb):
    src = t if lang == 'de' else t['en']
    c = CAT[t['cat']]
    kw = ' '.join([src['name'], src['short'], src.get('search', ''), c[2] if lang == 'de' else c[3], t['name']])
    return card(tab_path(t, lang), src['name'], src['short'], c[1], vb.fold(kw), icon_chip(c[4], c[5]), [c[2] if lang == 'de' else c[3]])


def page_tab_index(vb, wb, bp, tabs, lang):
    s = TX[lang]
    n = len(tabs)
    path = SEC['tab'][lang]
    items = [(s['home'], '/' if lang == 'de' else '/en/'), (s['hub'], vb.HUB[lang]), (s['tab'], path)]
    groups = ''
    for c in CATS:
        cards = ''.join(tab_card(t, lang, vb) for t in tabs if t['cat'] == c[0])
        if cards:
            groups += (f'<section class="wt-catsec" id="bereich-{c[1]}" data-vl-group="{c[1]}" aria-labelledby="g-{c[1]}"><div class="wt-catsec-head"><h2 id="g-{c[1]}">{esc(c[2] if lang == "de" else c[3])}</h2></div>'
                       f'<ul class="wt-grid">{cards}</ul></section>')
    how = ''.join(f'<li class="wt-step"><h3>{esc(a)}</h3><p>{esc(b)}</p></li>' for a, b in s['tab_how'])
    faq = s['faq_tab']
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': s['tab_h1'], 'url': bp.BASE + path, 'inLanguage': lang, 'description': fmt(s['tab_desc'], n=n),
           'mainEntity': {'@type': 'ItemList', 'numberOfItems': n, 'itemListElement': [
               {'@type': 'ListItem', 'position': i + 1, 'name': (t if lang == 'de' else t['en'])['name'], 'url': bp.BASE + tab_path(t, lang)} for i, t in enumerate(tabs)]}},
          wb.ld_breadcrumb(items), faq_ld(faq, lang)]
    used = [(c[1], c[2] if lang == 'de' else c[3]) for c in CATS if any(t['cat'] == c[0] for t in tabs)]
    main = f'''    <h1>{esc(s['tab_h1'])}</h1>
    <p class="wt-lede">{esc(fmt(s['tab_lede'], n=n))}</p>
    {search_box(wb, s['tab_search_l'], s['tab_search'])}
    {chips('field', used, s['tab_filter'], 'Alle' if lang == 'de' else 'All')}
    <p class="vl-count" data-vl-count aria-live="polite"></p>
    <p class="wt-nohits" data-vl-nohits hidden>{esc(s['tab_nohits'])}</p>
    {groups}
  </div>''' + section('how-h', s['tab_how_h'], f'<ol class="wt-steps">{how}</ol>') + section('faq-h', s['faq_h'], f'<div class="faq">{faq_html(faq)}</div><p class="wt-tm">{esc(s["tm"])}</p>')
    cfg = {'v': 1, 'lang': lang, 'page': 'section', 'hits': s['tab_hits'], 'hit1': s['tab_hit1']}
    return page(vb, wb, bp, lang, 'tab-index', path, (SEC['tab']['de'], SEC['tab']['en']), fmt(s['tab_title'], n=n), fmt(s['tab_desc'], n=n), ld, items, main, cfg)


def page_tab(vb, wb, bp, t, tabs, lang, app_url):
    s = TX[lang]
    src = t if lang == 'de' else t['en']
    path = tab_path(t, lang)
    pair = (tab_path(t, 'de'), tab_path(t, 'en'))
    name = src['name']
    title = fmt(s['tab_page_title'], name=name)
    if len(title) > 66:
        title = fmt(s['tab_page_title_short'], name=name)
    items = [(s['home'], '/' if lang == 'de' else '/en/'), (s['hub'], vb.HUB[lang]), (s['tab'], SEC['tab'][lang]), (name, path)]
    c = CAT[t['cat']]
    app = f'{app_url}#/neu/tabelle?vorlage={t["id"]}'
    if lang == 'de':
        cols = ''.join(f'<div class="arc2-col"><dt>{esc(h)}</dt><dd>{esc(x)}</dd></div>' for h, x in t['cols'])
        cols_html = f'<dl class="arc2-cols">{cols}</dl>'
    else:
        cols_html = '<ul class="vl-list">' + ''.join(f'<li>{esc(x)}</li>' for x in src['inside']) + '</ul>'
    uses = ''.join(f'<li>{esc(x)}</li>' for x in src['uses'])
    tips = ''.join(f'<li>{esc(x)}</li>' for x in (src.get('tips') or []))
    faq = [(f['q'], f['a']) for f in (src.get('faq') or [])] + s['faq_tab']
    rel = [x for x in tabs if x['id'] in t['related']] + [x for x in tabs if x['cat'] == t['cat'] and x is not t and x['id'] not in t['related']]
    rel = rel[:4]
    related = ''.join(tab_card(x, lang, vb) for x in rel)
    ld = [wb.ld_breadcrumb(items),
          {'@context': 'https://schema.org', '@type': 'CreativeWork', 'name': fmt(s['tab_page_h1'], name=name), 'url': bp.BASE + path, 'description': src['desc'], 'inLanguage': lang,
           'isAccessibleForFree': True, 'encodingFormat': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'genre': 'Tabellenvorlage' if lang == 'de' else 'Spreadsheet template',
           'publisher': {'@type': 'Organization', 'name': 'FaleNetwork', 'url': bp.BASE + '/'}},
          faq_ld(faq, lang)]
    file_name = t['name'] if lang == 'de' else t['name']
    btns = (f'<div class="btn-row arc2-dl" data-arc2-actions hidden><button class="btn btn-primary" type="button" data-arc2-xlsx>{esc(s["xlsx"])}</button>'
            f'<button class="btn btn-quiet" type="button" data-arc2-csv>{esc(s["csv"])}</button><a class="btn btn-quiet" href="#vorschau">{esc(s["fill"])}</a></div>'
            f'<p class="arc2-app"><a href="{app}" rel="noopener">{esc(s["app"])}</a></p>')
    main = f'''    <div class="wt-head">{icon_chip(c[4], c[5], 'wt-chip-lg')}<div><h1>{esc(fmt(s['tab_page_h1'], name=name))}</h1><p class="wt-lede">{esc(src['intro'])}</p></div></div>
    <p class="vl-pills vl-head-pills"><span class="vl-pill">{esc(c[2] if lang == 'de' else c[3])}</span><span class="vl-pill">XLSX · CSV</span></p>
    {btns}
  </div>''' + section('vorschau', s['pv_h'], f'<div class="arc2-sheet" data-arc2-sheet="{t["id"]}"><p class="arc2-nojs" data-arc2-nojs>{esc(s["pv_nojs"])}</p></div>', s['pv_p']) \
        + section('cols-h', s['cols_h'], cols_html, s['cols_p']) \
        + section('uses-h', s['uses_h'], f'<ul class="vl-list">{uses}</ul>' + (f'<h3 class="vl-h3">{esc(s["tips_h"])}</h3><ul class="vl-list">{tips}</ul>' if tips else '')) \
        + section('faq-h', s['faq_h'], f'<div class="faq">{faq_html(faq)}</div><p class="wt-tm">{esc(s["tm"])}</p>') \
        + section('rel-h', s['rel_h'], f'<ul class="wt-grid">{related}</ul><p class="arc2-more"><a class="btn btn-quiet" href="{SEC["tab"][lang]}">{esc(s["more_h"])}</a></p>')
    cfg = {'v': 1, 'lang': lang, 'page': 'arc2-sheet', 'copied': s['copied']}
    arc2 = {'id': t['id'], 'lang': lang, 'file': file_name, 'app': app}
    extra = f'<script type="application/json" id="arc2-config">{json.dumps(arc2, ensure_ascii=False, sort_keys=True).replace("</", "<\\/")}</script>'
    html = page(vb, wb, bp, lang, 'tab', path, pair, title, src['desc'], ld, items, main, cfg, '/assets/wt/arc2-sheet.js')
    return html.replace('<script type="application/json" id="vl-config">', extra + '\n<script type="application/json" id="vl-config">', 1)


# --------------------------------------------------------------------------------------------- letter pages
def brief_path(b, lang):
    return SEC['brief'][lang] + (b['slug'] if lang == 'de' else b['en']['slug']) + '/'


def brief_card(b, lang, vb):
    src = b if lang == 'de' else b['en']
    g = GROUP[b['group']]
    kw = ' '.join([src['name'], src['short'], src.get('search', ''), g[1] if lang == 'de' else g[2]])
    return card(brief_path(b, lang), src['name'], src['short'], g[0], vb.fold(kw), icon_chip(g[3], g[4]), [g[1] if lang == 'de' else g[2]])


def paper(m, lang, pid):
    s = TX[lang]
    if m['mail']:
        body = ''.join(f'<p>{esc(p)}</p>' for p in m['body'])
        return (f'<div class="vl-paper vl-mail arc2-mail" id="{pid}"><p class="vl-p-subj"><strong>{esc(m["subject"])}</strong></p><p>{esc(m["salutation"])}</p>{body}'
                f'<p class="vl-p-close">{esc(m["closing"])}</p><p>{esc(m["name"])}</p></div>')
    sender = '<br>'.join(esc(x) for x in m['sender'][:3]) + '<br>' + esc(m['sender'][3]) + ' · ' + esc(m['sender'][4])
    labels = {'einschreiben': 'Einschreiben', 'rueckschein': 'Einschreiben Rückschein', 'persoenlich': 'Persönlich/Vertraulich', 'eilt': 'Eilt'}
    notice = f'<span class="arc2-notice">{esc(labels.get(m["notice"], m["notice"]))}</span><br>' if m['notice'] and m['notice'] != 'none' else ''
    rec = notice + '<br>'.join(esc(x) for x in m['recipient'])
    body = ''.join(f'<p>{esc(p)}</p>' for p in m['body'])
    att = f'<p class="vl-p-att"><strong>{"Anlagen" if lang == "de" else "Enclosures"}</strong><br>{"<br>".join(esc(a) for a in m["att"])}</p>' if m['att'] else ''
    return (f'<div class="vl-paper" id="{pid}"><p class="vl-p-sender">{sender}</p><p class="vl-p-rec">{rec}</p><p class="vl-p-date">{esc(m["dateLine"])}</p>'
            f'<p class="vl-p-subj"><strong>{esc(m["subject"])}</strong></p><p>{esc(m["salutation"])}</p>{body}'
            f'<p class="vl-p-close">{esc(m["closing"])}</p><p class="vl-p-sig">{esc(m["name"])}</p>{att}</div>')


def page_brief_index(vb, wb, bp, briefs, lang):
    s = TX[lang]
    items_b = briefs if lang == 'de' else [b for b in briefs if 'en' in b]
    n = len(items_b)
    path = SEC['brief'][lang]
    crumbs_items = [(s['home'], '/' if lang == 'de' else '/en/'), (s['hub'], vb.HUB[lang]), (s['brief'], path)]
    groups = ''
    for g in GROUPS:
        cards = ''.join(brief_card(b, lang, vb) for b in items_b if b['group'] == g[0])
        if cards:
            groups += (f'<section class="wt-catsec" id="thema-{g[0]}" data-vl-group="{g[0]}" aria-labelledby="g-{g[0]}"><div class="wt-catsec-head"><h2 id="g-{g[0]}">{esc(g[1] if lang == "de" else g[2])}</h2></div>'
                       f'<ul class="wt-grid">{cards}</ul></section>')
    used = [(g[0], g[1] if lang == 'de' else g[2]) for g in GROUPS if any(b['group'] == g[0] for b in items_b)]
    faq = [(TX[lang]['send_h'], s['send']), (('Ist das eine Rechtsberatung?' if lang == 'de' else 'Is this legal advice?'), s['legal'])]
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': s['brief_h1'], 'url': bp.BASE + path, 'inLanguage': lang, 'description': s['brief_desc'],
           'mainEntity': {'@type': 'ItemList', 'numberOfItems': n, 'itemListElement': [
               {'@type': 'ListItem', 'position': i + 1, 'name': (b if lang == 'de' else b['en'])['name'], 'url': bp.BASE + brief_path(b, lang)} for i, b in enumerate(items_b)]}},
          wb.ld_breadcrumb(crumbs_items), faq_ld(faq, lang)]
    main = f'''    <h1>{esc(s['brief_h1'])}</h1>
    <p class="wt-lede">{esc(fmt(s['brief_lede'], n=n))}</p>
    {search_box(wb, s['brief_search_l'], s['brief_search']) if n > 6 else ''}
    {chips('field', used, s['brief_filter'], 'Alle' if lang == 'de' else 'All') if len(used) > 1 else ''}
    <p class="vl-count" data-vl-count aria-live="polite"></p>
    <p class="wt-nohits" data-vl-nohits hidden>{esc(s['brief_nohits'])}</p>
    {groups}
  </div>''' + section('faq-h', s['faq_h'], f'<div class="faq">{faq_html(faq)}</div>')
    cfg = {'v': 1, 'lang': lang, 'page': 'section', 'hits': s['brief_hits'], 'hit1': s['brief_hit1']}
    pair = (SEC['brief']['de'], SEC['brief']['en'])
    return page(vb, wb, bp, lang, 'brief-index', path, pair, s['brief_title'], s['brief_desc'], ld, crumbs_items, main, cfg)


def page_brief(vb, wb, bp, b, briefs, lang, wb_specs):
    s = TX[lang]
    src = b if lang == 'de' else b['en']
    path = brief_path(b, lang)
    pair = (brief_path(b, 'de'), brief_path(b, 'en')) if 'en' in b else None
    name = src['name']
    title = fmt(s['brief_page_title'], name=name)
    if len(title) > 66:
        title = fmt(s['brief_page_title_short'], name=name)
    crumbs_items = [(s['home'], '/' if lang == 'de' else '/en/'), (s['hub'], vb.HUB[lang]), (s['brief'], SEC['brief'][lang]), (name, path)]
    vid = ('brief-' if lang == 'de' else 'en-brief-') + b['id']
    use_url = tool_url(wb_specs, b['tool'], lang) + f'?vorlage={vid}'
    g = GROUP[b['group']]
    m = brief_model(b, lang, vb)
    when = ''.join(f'<p>{esc(x)}</p>' for x in src['when'])
    must = ''.join(f'<li>{wb.svg(wb.UI_ICONS["check"])}<div><p>{esc(x)}</p></div></li>' for x in src['must'])
    notes = ''.join(f'<li>{esc(x)}</li>' for x in src['notes'])
    warn = ''
    if b.get('paper') and lang == 'de':
        warn += f'<p class="arc2-warn arc2-warn-strong">{esc(s["paper"])}</p>'
    warn += f'<p class="arc2-warn">{esc(s["legal"])}</p>'
    if b['tool'] in ('leave-request', 'power-of-attorney', 'receipt'):
        doc = ''.join(f'<div class="arc2-col"><dt>{esc(k)}</dt><dd>{esc(x)}</dd></div>' for k, x in src['doc'])
        example = section('beispiel', s['doc_h'], f'<dl class="arc2-cols arc2-doc">{doc}</dl><p class="vl-fine">{esc(TX[lang]["example_note"])}</p>', src.get('doc_intro', ''))
    else:
        example = section('beispiel', s['mail_h'] if m['mail'] else s['example_h'],
                          paper(m, lang, 'muster-text') + f'<div class="btn-row vl-actions"><a class="btn btn-primary" href="{esc(use_url)}">{esc(s["use"])}</a>'
                          f'<button class="btn btn-quiet" type="button" data-vl-copy="muster-text" hidden>{esc(s["copy"])}</button></div><p class="vl-fine">{esc(s["example_p"])}</p>')
    faq = [(f['q'], f['a']) for f in src['faq']] + [(s['send_h'], s['send'])]
    pool = [x for x in briefs if lang == 'de' or 'en' in x]
    rel = [x for x in pool if x['id'] in b.get('related', [])] + [x for x in pool if x['group'] == b['group'] and x is not b and x['id'] not in b.get('related', [])]
    rel = [x for x in rel if x is not b][:4]
    related = ''.join(brief_card(x, lang, vb) for x in rel)
    ld = [wb.ld_breadcrumb(crumbs_items),
          {'@context': 'https://schema.org', '@type': 'CreativeWork', 'name': name, 'url': bp.BASE + path, 'description': src['desc'], 'inLanguage': lang, 'isAccessibleForFree': True,
           'genre': 'Musterbrief' if lang == 'de' else 'Letter template', 'publisher': {'@type': 'Organization', 'name': 'FaleNetwork', 'url': bp.BASE + '/'}},
          faq_ld(faq, lang)]
    tool_name = wb_specs[b['tool']][lang]['name']
    main = f'''    <div class="wt-head">{icon_chip(g[3], g[4], 'wt-chip-lg')}<div><h1>{esc(src.get('h1') or name)}</h1><p class="wt-lede">{esc(src.get('lede') or s['brief_lede_page'])}</p></div></div>
    <div class="vl-hero"><div class="btn-row"><a class="btn btn-primary" href="{esc(use_url)}">{esc(s['use'])}</a><a class="btn btn-quiet" href="#beispiel">{esc(s['mail_h'] if m['mail'] else s['example_h'])}</a></div>
    <p class="arc2-toolnote">{esc(s['tool_h'])}: {esc(tool_name)}</p></div>
  </div>''' + section('wann-h', s['when_h'], f'<div class="arc2-prose">{when}</div>') \
        + section('rein-h', s['must_h'], f'<ul class="wt-why vl-look">{must}</ul>') \
        + example \
        + section('wichtig-h', s['notes_h'], f'<ul class="vl-list">{notes}</ul>{warn}') \
        + section('faq-h', s['faq_h'], f'<div class="faq">{faq_html(faq)}</div>') \
        + (section('rel-h', s['rel_brief_h'], f'<ul class="wt-grid">{related}</ul><p class="arc2-more"><a class="btn btn-quiet" href="{SEC["brief"][lang]}">{esc(s["more_h"])}</a></p>') if related else '')
    cfg = {'v': 1, 'lang': lang, 'page': 'arc2-brief', 'copied': s['copied']}
    return page(vb, wb, bp, lang, 'brief', path, pair, title, src['desc'], ld, crumbs_items, main, cfg,
                other_url=None if pair else (SEC['brief']['en'] if lang == 'de' else SEC['brief']['de']))


def brief_data(b, lang, vb):
    vid = ('brief-' if lang == 'de' else 'en-brief-') + b['id']
    src = b if lang == 'de' else b['en']
    return {'v': 1, 'id': vid, 'lang': lang, 'tool': b['tool'], 'name': src['name'], 'page': brief_path(b, lang), 'fields': brief_fields(b, lang, vb)}


# --------------------------------------------------------------------------------------------- CV design gallery
def design_data(d, lang, vb):
    """Prefill data in the shape of build.py prefill_data (cv + one letter) – loaded by cv-builder / cover-letter."""
    src = d[lang]
    cv = dict(src['cv'])
    cv['design'] = 'modern'  # build.py validates the base designs only; the real design is set below
    job = {'cv': cv}
    L = {**src['letter'], 'level': 'erfahren', 'label': src['letter'].get('label', '')}
    sender = vb.sender_of(job, L)
    data_cv = vb.cv_tool(cv, lang, sender[3], sender[4])
    data_cv['design'] = d['id']
    data_cv['accent'] = ACCENTS[src['cv'].get('accent', 0)]
    if src['cv'].get('pubs'):
        data_cv['pubs'] = [{'from': r[0], 'to': r[1], 'role': r[2], 'org': r[3], 'place': r[4], 'desc': r[5]} for r in (vb.norm_row('courses', x) for x in src['cv']['pubs'])]
    if d['id'] == 'school' and src['cv'].get('order'):
        data_cv['order'] = src['cv']['order']
    cl = vb.letter_tool(job, L, lang)
    cl['design'] = d['id']
    cl['accent'] = data_cv['accent']
    vid = ('design-' if lang == 'de' else 'en-design-') + d['id']
    return {'v': 1, 'id': vid, 'lang': lang, 'name': src['name'], 'cv': data_cv, 'letters': [{'label': L['label'] or src['name'], 'cl': cl}], 'cvName': cv['name']}


def page_designs(vb, wb, bp, designs, lang, wb_specs):
    s = TX[lang]
    n = len(DESIGNS)
    path = SEC['design'][lang]
    crumbs_items = [(s['home'], '/' if lang == 'de' else '/en/'), (s['hub'], vb.HUB[lang]), (s['design'], path)]
    cv_url = tool_url(wb_specs, 'cv-builder', lang)
    cl_url = tool_url(wb_specs, 'cover-letter', lang)
    cards = ''
    for (did, nde, nen, tde, ten, gde, gen) in DESIGNS:
        nm, txt, good = (nde, tde, gde) if lang == 'de' else (nen, ten, gen)
        vid = ('design-' if lang == 'de' else 'en-design-') + did
        img_file = bp.ROOT / PREVIEW.strip('/') / f'{did}-{lang}.webp'
        img = (f'<img src="{PREVIEW}{did}-{lang}.webp" width="480" height="679" loading="lazy" decoding="async" alt="{esc(fmt(s["design_alt"], name=nm))}">'
               if img_file.exists() else '')
        cards += (f'<li class="arc2-design" id="design-{did}"><a class="arc2-design-img" href="{cv_url}?vorlage={vid}&amp;design={did}" tabindex="-1" aria-hidden="true">{img}</a>'
                  f'<div class="arc2-design-t"><h2>{esc(nm)}</h2><p>{esc(txt)}</p><p class="arc2-good"><strong>{esc(s["design_good"])}:</strong> {esc(good)}</p>'
                  f'<div class="btn-row"><a class="btn btn-primary" href="{cv_url}?vorlage={vid}&amp;design={did}">{esc(s["design_open"])}</a>'
                  f'<a class="btn btn-quiet" href="{cl_url}?vorlage={vid}&amp;brief=1&amp;design={did}">{esc(s["design_letter"])}</a></div></div></li>')
    faq = s['design_faq']
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': fmt(s['design_h1'], n=n), 'url': bp.BASE + path, 'inLanguage': lang, 'description': fmt(s['design_desc'], n=n),
           'mainEntity': {'@type': 'ItemList', 'numberOfItems': n, 'itemListElement': [
               {'@type': 'ListItem', 'position': i + 1, 'name': d[1] if lang == 'de' else d[2], 'url': bp.BASE + path + '#design-' + d[0]} for i, d in enumerate(DESIGNS)]}},
          wb.ld_breadcrumb(crumbs_items), faq_ld(faq, lang)]
    main = f'''    <h1>{esc(fmt(s['design_h1'], n=n))}</h1>
    <p class="wt-lede">{esc(s['design_lede'])}</p>
    <ul class="arc2-designs">{cards}</ul>
    <p class="vl-fine">{esc(s['example_note'])}</p>
  </div>''' + section('faq-h', s['faq_h'], f'<div class="faq">{faq_html(faq)}</div>')
    cfg = {'v': 1, 'lang': lang, 'page': 'arc2-designs'}
    return page(vb, wb, bp, lang, 'designs', path, (SEC['design']['de'], SEC['design']['en']), fmt(s['design_title'], n=n), fmt(s['design_desc'], n=n), ld, crumbs_items, main, cfg)


# --------------------------------------------------------------------------------------------- hub block
def hub_block(lang, n_tab, n_brief, n_brief_en):
    s = TX[lang]
    rows = [(SEC['tab'][lang], s['hub_tab'], n_tab, CAT['Finanzen']), (SEC['brief'][lang], s['hub_brief'], n_brief if lang == 'de' else n_brief_en, None),
            (SEC['design'][lang], s['hub_design'], len(DESIGNS), None)]
    icons = [('secure', CATS[0][5]), ('convert', GROUPS[0][4]), ('share', '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>')]
    cards = ''.join(f'<li class="wt-card"><a href="{u}">{icon_chip(ic[0], ic[1])}<h3 class="wt-card-name">{esc(t[0])}</h3><span class="wt-card-desc">{esc(fmt(t[1], n=n))}</span></a></li>'
                    for (u, t, n, _), ic in zip(rows, icons))
    return f'<section class="wt-catsec arc2-hub" aria-labelledby="arc2-hub-h"><div class="wt-catsec-head"><h2 id="arc2-hub-h">{esc(s["hub_extra_h"])}</h2></div><ul class="wt-grid">{cards}</ul></section>'


# --------------------------------------------------------------------------------------------- cleanup + main
def cleanup(bp, keep):
    for lang in ('de', 'en'):
        for kind in SEC:
            d = bp.ROOT / SEC[kind][lang].strip('/')
            if not d.is_dir():
                continue
            for sub in d.iterdir():
                idx = sub / 'index.html'
                if sub.is_dir() and idx.exists() and MARK in idx.read_text(encoding='utf-8') and f'/{sub.relative_to(bp.ROOT).as_posix()}/' not in keep:
                    import shutil
                    shutil.rmtree(sub)


def build(wb, bp, vb, jobs, wb_specs):
    tabs, briefs, designs = load(vb, wb, jobs)
    app_url = bp.PDF_APP
    written, entries, data = [], [], {}
    # spreadsheets
    for lang in ('de', 'en'):
        written.append(wb.write(SEC['tab'][lang], page_tab_index(vb, wb, bp, tabs, lang)))
    entries.append((SEC['tab']['de'], {'de': SEC['tab']['de'], 'en': SEC['tab']['en']}))
    entries.append((SEC['tab']['en'], {'de': SEC['tab']['de'], 'en': SEC['tab']['en']}))
    for t in tabs:
        alts = {'de': tab_path(t, 'de'), 'en': tab_path(t, 'en')}
        for lang in ('de', 'en'):
            written.append(wb.write(tab_path(t, lang), page_tab(vb, wb, bp, t, tabs, lang, app_url)))
            entries.append((tab_path(t, lang), alts))
    # letters
    en_briefs = [b for b in briefs if 'en' in b]
    for lang in ('de', 'en') if en_briefs else ('de',):
        written.append(wb.write(SEC['brief'][lang], page_brief_index(vb, wb, bp, briefs, lang)))
    alts_idx = {'de': SEC['brief']['de'], 'en': SEC['brief']['en']} if en_briefs else {'de': SEC['brief']['de']}
    entries += [(SEC['brief'][lg], alts_idx) for lg in alts_idx]
    for b in briefs:
        langs = ('de', 'en') if 'en' in b else ('de',)
        alts = {lg: brief_path(b, lg) for lg in langs}
        for lang in langs:
            written.append(wb.write(brief_path(b, lang), page_brief(vb, wb, bp, b, briefs, lang, wb_specs)))
            entries.append((brief_path(b, lang), alts))
            dd = brief_data(b, lang, vb)
            data[dd['id'] + '.json'] = json.dumps(dd, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n'
    # CV designs
    for lang in ('de', 'en'):
        written.append(wb.write(SEC['design'][lang], page_designs(vb, wb, bp, designs, lang, wb_specs)))
        entries.append((SEC['design'][lang], {'de': SEC['design']['de'], 'en': SEC['design']['en']}))
    for d in designs:
        for lang in ('de', 'en'):
            dd = design_data(d, lang, vb)
            data[dd['id'] + '.json'] = json.dumps(dd, ensure_ascii=False, separators=(',', ':'), sort_keys=True) + '\n'
    cleanup(bp, {p for p, _ in entries})
    n_tab, n_brief, n_brief_en = len(tabs), len(briefs), len(en_briefs)
    return {'written': written, 'entries': entries, 'data': data, 'hub': lambda lang: hub_block(lang, n_tab, n_brief, n_brief_en),
            'summary': f'arc2: {n_tab} spreadsheets, {n_brief} letters ({n_brief_en} EN), {len(designs)} CV designs'}
