import json, re
T = {
"Abbildung":"Figure","Gleichung":"Equation","Endnoten":"Endnotes","Beschriftung":"Caption","Formatvorlage {0}":"Style {0}",
"Seitenzahl":"Page number","Seitenanzahl":"Number of pages","Als .docx-Datei herunterladen":"Download as .docx file","{0} als .docx-Datei herunterladen":"Download {0} as .docx file",
"Vorlage suchen, z. B. Lebenslauf, Rechnung, Hausarbeit …":"Search templates, e.g. CV, invoice, term paper …",
"Alle Vorlagen sind eigene Entwürfe zum Überschreiben – mit Formatvorlagen, Kopf- und Fußzeilen und rechnenden Tabellen, wo es passt.":"All templates are original designs to overwrite – with styles, headers and footers and calculating tables where it makes sense.",
"Unbekannte Funktion „{0}“":"Unknown function “{0}”","Ungültiger Bereich":"Invalid range","Unbekannter Name „{0}“":"Unknown name “{0}”","Formel ungültig":"Invalid formula","Division durch null":"Division by zero","Unbekannte Funktion":"Unknown function",
"Fehler! Verweisquelle nicht gefunden.":"Error! Reference source not found.","Text der Endnote":"Endnote text","Endnoten gibt es nur in .docx-Dokumenten.":"Endnotes are only available in .docx documents.",
"Endnote einfügen":"Insert endnote","Endnote bearbeiten":"Edit endnote","In Fußnote umwandeln":"Convert to footnote","Endnote löschen":"Delete endnote","Endnote":"Endnote",
"Dieses Ziel gibt es im Dokument nicht mehr.":"This target no longer exists in the document.","Textmarken gibt es nur in .docx-Dokumenten.":"Bookmarks are only available in .docx documents.",
"Textmarke":"Bookmark","Noch keine Textmarken.":"No bookmarks yet.","Name der Textmarke":"Bookmark name","z. B. Anhang_A":"e.g. Appendix_A",
"Erlaubt sind Buchstaben, Ziffern und „_“. Textmarken sind Ziele für Links und Querverweise.":"Letters, digits and “_” are allowed. Bookmarks are targets for links and cross-references.",
"Textmarke „{0}“ gesetzt":"Bookmark “{0}” set","Angezeigter Text":"Text to display","Überschriften":"Headings","Textmarken":"Bookmarks",
"Keine Überschriften oder Textmarken im Dokument.":"No headings or bookmarks in the document.","Webadresse oder E-Mail":"Web address or email","Stelle im Dokument":"Place in this document","Ziele":"Targets",
"Wähle ein Ziel im Dokument.":"Choose a target in the document.","Querverweise gibt es nur in .docx-Dokumenten.":"Cross-references are only available in .docx documents.",
"Keine Überschriften im Dokument.":"No headings in the document.","Keine Textmarken im Dokument.":"No bookmarks in the document.","Keine Beschriftungen „{0}“ im Dokument.":"No “{0}” captions in the document.",
"Querverweis":"Cross-reference","Verweistyp":"Reference type","Verweisen auf":"Insert reference to","Text (z. B. „Abbildung 2“ oder Überschrift)":"Text (e.g. “Figure 2” or heading)",
"Querverweise aktualisieren sich automatisch, wenn sich Nummern oder Seiten ändern.":"Cross-references update automatically when numbers or pages change.",
"Seitenzahlen von Querverweisen werden in der Seitenansicht aktualisiert.":"Page numbers of cross-references are updated in page layout view.",
"Beschriftungen gibt es nur in .docx-Dokumenten.":"Captions are only available in .docx documents.","Beschriftung einfügen":"Insert caption",
"Die Beschriftung gehört zur Tabelle, in der der Cursor steht.":"The caption belongs to the table the cursor is in.","Die Beschriftung gehört zum ausgewählten Bild.":"The caption belongs to the selected picture.",
"Die Beschriftung wird als neuer Absatz an der Cursorposition eingefügt.":"The caption is inserted as a new paragraph at the cursor.","Bezeichnung":"Label","Unter dem Element":"Below the item","Über dem Element":"Above the item",
"Beschriftungstext":"Caption text","z. B. Umsatz im Jahresvergleich":"e.g. Revenue year over year","{0} Die Nummer zählt automatisch weiter.":"{0} The number counts up automatically.",
"Tabellen mit verbundenen Zellen lassen sich nicht sortieren.":"Tables with merged cells cannot be sorted.","Tabelle sortieren":"Sort table","Reihenfolge":"Order","Aufsteigend":"Ascending","Absteigend":"Descending",
"Erste Zeile ist Überschrift (nicht sortieren)":"First row is a header (don't sort)","Tabelle sortiert":"Table sorted","Formel bearbeiten":"Edit formula","Formel einfügen":"Insert formula","Diese Zelle ist":"This cell is",
". Beispiele: =SUM(ABOVE) (Summe darüber), =SUM(LEFT), =AVERAGE(B2:B6), =C2*D2, =E5*19/100. Deutsche Namen wie SUMME(OBEN) gehen auch; Argumente mit „;“ trennen.":". Examples: =SUM(ABOVE) (sum above), =SUM(LEFT), =AVERAGE(B2:B6), =C2*D2, =E5*19/100. German names such as SUMME(OBEN) work too; separate arguments with “;”.",
"Ergebnis: {0}":"Result: {0}","Markiere die Absätze, die zur Tabelle werden sollen (Spalten mit Tab oder ; trennen).":"Select the paragraphs that should become a table (separate columns with Tab or ;).",
"Tabelle mit {0} Zeilen und {1} Spalten erstellt":"Table with {0} rows and {1} columns created","Bild nicht lesbar":"Picture not readable","Das Bild kann nicht bearbeitet werden.":"The picture cannot be edited.",
"Bild zuschneiden":"Crop picture","Seitenverhältnis:":"Aspect ratio:","Bild zugeschnitten":"Picture cropped","Dezimal":"Decimal","Punkte ……":"Dots ……","Striche – – –":"Dashes – – –","Linie ____":"Line ____",
"Keine eigenen Tabstopps – es gelten Standard-Tabstopps alle 1,25 cm.":"No custom tab stops – default tab stops every 1.25 cm apply.","Tabstopps":"Tab stops","Position (cm)":"Position (cm)","z. B. 15,5":"e.g. 15.5","Füllzeichen":"Leader","Tabstopp hinzufügen":"Add tab stop",
"Mit der Tab-Taste springt der Text zum nächsten Tabstopp – z. B. rechtsbündige Preise mit Punkten in Speisekarten. Exakt dargestellt in PDF und .docx-Datei, im Editor angenähert.":"The Tab key moves text to the next tab stop – e.g. right-aligned prices with dot leaders in menus. Exact in PDF and .docx files, approximated in the editor.",
"Alle löschen":"Clear all","Setze den Cursor in einen normalen Absatz.":"Place the cursor in a normal paragraph.","Einfügeoptionen":"Paste options","Ursprüngliche Formatierung beibehalten":"Keep source formatting",
"Formatierung zusammenführen":"Merge formatting","Nur den Text übernehmen":"Keep text only","Schnellformat":"Quick format","Gelb hervorheben":"Highlight yellow","Formatierung löschen":"Clear formatting",
"Nur Überschriften auf oberster Ebene lassen sich verschieben.":"Only top-level headings can be moved.","Neue Formatvorlage":"New style","z. B. Hinweis, Adresse, Merksatz":"e.g. Note, Address, Key point","Eigene Formatvorlage":"Custom style",
"Erste Seite":"First page","Gerade Seiten":"Even pages","Seitenzahl unten mittig":"Page number bottom centre","„Seite X von Y“ unten rechts":"“Page X of Y” bottom right","Titel oben links, Datum oben rechts":"Title top left, date top right",
"Alles leeren":"Clear everything","Feld einfügen:":"Insert field:","Schnellwahl:":"Quick pick:","Erste Seite anders":"Different first page","Gerade und ungerade Seiten anders":"Different odd and even pages",
"Felder wie „Seitenzahl“ werden auf jeder Seite automatisch ausgefüllt – auch in der .docx- und PDF-Datei.":"Fields such as “Page number” are filled in automatically on every page – also in the .docx and PDF file.",
"Gilt nur für Seite 1 (z. B. Deckblatt). Leer lassen = keine Kopf-/Fußzeile auf Seite 1.":"Applies to page 1 only (e.g. cover page). Leave empty = no header/footer on page 1.",
"Gilt für Seite 2, 4, 6 … – die Standardzeilen dann für ungerade Seiten.":"Applies to pages 2, 4, 6 … – the standard lines then apply to odd pages.","Gilt für ungerade Seiten.":"Applies to odd pages.","Gilt für alle Seiten.":"Applies to all pages.",
"Deckkraft":"Opacity","Das Wasserzeichen erscheint schräg hinter dem Text auf jeder Seite – in der Seitenansicht, im PDF und in der .docx-Datei.":"The watermark appears diagonally behind the text on every page – in page layout view, in the PDF and in the .docx file.",
"Neues Dokument aus Vorlage …":"New document from template …","Als reinen Text einfügen (Strg+Umschalt+Alt+V)":"Paste as plain text (Ctrl+Shift+Alt+V)","Initiale":"Drop cap","Fokusmodus":"Focus mode","In Text umwandeln":"Convert to text",
"Fokusmodus beenden":"Exit focus mode","Neue Formatvorlage …":"New style …","Überschriften nummerieren (1 · 1.1 · 1.1.1)":"Number headings (1 · 1.1 · 1.1.1)","Formatvorlage „{0}“ erstellt":"Style “{0}” created","Formatvorlage „{0}“ gelöscht":"Style “{0}” deleted",
"Überschriften werden nummeriert.":"Headings are numbered.","Nummerierung der Überschriften aus.":"Heading numbering off.","Setze den Cursor in eine Tabellenzelle.":"Place the cursor in a table cell.",
"Die folgenden Seiten werden im Querformat gedruckt (PDF und .docx-Datei).":"The following pages are printed in landscape (PDF and .docx file).","Die folgenden Seiten werden im Hochformat gedruckt (PDF und .docx-Datei).":"The following pages are printed in portrait (PDF and .docx file).",
"Oben und unten":"Top and bottom","Zuschneiden …":"Crop …","Um 90° drehen":"Rotate by 90°","Beschriftung einfügen …":"Insert caption …","Abschnittsumbruch: folgende Seiten im Querformat":"Section break: following pages in landscape","Abschnittsumbruch: folgende Seiten im Hochformat":"Section break: following pages in portrait",
"Füge jetzt mit Strg+V bzw. „Einfügen“ ein – es wird nur der Text übernommen.":"Now paste with Ctrl+V or “Paste” – only the text is kept.","Abschnitt nach oben":"Move section up","Abschnitt nach unten":"Move section down","Höher stufen":"Promote","Tiefer stufen":"Demote","Hier geht es nicht weiter.":"Can't move further.",
"Noch keine Beschriftungen „{0}“ – das Verzeichnis füllt sich automatisch.":"No “{0}” captions yet – the table fills itself automatically.","Abbildungsverzeichnis":"Table of figures","Tabellenverzeichnis":"List of tables","Gleichungsverzeichnis":"List of equations",
"Verzeichnis einfügen":"Insert table","Verzeichnis":"Table","{0} eingefügt – es aktualisiert sich automatisch.":"{0} inserted – it updates automatically.","Kopf- und Fußzeilen gibt es nur in .docx-Dokumenten.":"Headers and footers are only available in .docx documents.",
"Wasserzeichen gibt es nur in .docx-Dokumenten.":"Watermarks are only available in .docx documents.","Wasserzeichen eingefügt – sichtbar in der Seitenansicht.":"Watermark inserted – visible in page layout view.","Wasserzeichen entfernt":"Watermark removed",
"„Seite X von Y“ unten mittig":"“Page X of Y” bottom centre","Format und Startwert …":"Format and start value …","Seitenzahlen entfernen":"Remove page numbers","Erweitert eingerichtet (drei Bereiche, Felder oder andere erste/gerade Seiten).":"Advanced setup (three areas, fields or different first/even pages).",
"Kopf- und Fußzeile bearbeiten …":"Edit header and footer …","Mehr Optionen: drei Bereiche, Felder, gerade Seiten …":"More options: three areas, fields, even pages …","Strg+Alt+F / Strg+Alt+D":"Ctrl+Alt+F / Ctrl+Alt+D","Fußnote / Endnote":"Footnote / endnote",
"Strg+Umschalt+F5":"Ctrl+Shift+F5","Strg+Umschalt+Alt+V":"Ctrl+Shift+Alt+V","Als reinen Text einfügen":"Paste as plain text","Fokus- oder Lesemodus beenden":"Exit focus or reading mode","Lesemodus beenden":"Exit reading mode",
"Lesemodus – Esc oder „Lesemodus beenden“ zum Bearbeiten.":"Reading mode – Esc or “Exit reading mode” to edit.","Fokusmodus – Esc beendet ihn.":"Focus mode – Esc exits it.","Deutsch (Deutschland)":"German (Germany)","Deutsch (Österreich)":"German (Austria)","Deutsch (Schweiz)":"German (Switzerland)",
"Englisch (USA)":"English (US)","Englisch (Großbritannien)":"English (UK)","Sprache der Markierung: {0}":"Language of the selection: {0}","Dokumentsprache: {0} – die Rechtschreibprüfung deines Geräts prüft in dieser Sprache.":"Document language: {0} – your device's spell checker uses this language.",
"Sprache der Markierung":"Language of the selection","Sprache des Dokuments":"Document language","Leer oder mit Vorlage: Brief, Lebenslauf, Rechnung, Hausarbeit … – als .docx oder PDF.":"Blank or from a template: letter, CV, invoice, term paper … – as .docx or PDF.",
# template gallery
"Weißes Blatt im A4-Format":"Blank A4 page","Tabellarisch, schlicht, gut lesbar für Bewerbungsportale":"Tabular, plain, easy to read for application portals","Lebenslauf – Modern":"CV – Modern","Farbige Überschriften, klare Abschnitte":"Coloured headings, clear sections",
"Bewerbungsanschreiben":"Cover letter","Klassischer Aufbau mit Betreff und Anlagen":"Classic layout with subject line and enclosures","Bewerbung – Deckblatt":"Application – cover page","Titelseite mit Foto, Kontaktdaten und Anlagenverzeichnis":"Title page with photo, contact details and list of enclosures",
"Brief (DIN 5008)":"Letter (DIN 5008)","Geschäftsbrief mit Anschriftfeld und Infoblock":"Business letter with address field and info block","Privatbrief":"Personal letter","Persönlicher Brief nach DIN 5008 – ohne Infoblock":"Personal letter following DIN 5008 – without info block",
"Kündigung":"Cancellation letter","Kündigungsschreiben für Verträge mit Bitte um Bestätigung":"Contract cancellation with request for confirmation","Positionen, Netto, MwSt. und Gesamtbetrag – rechnet selbst":"Items, net, VAT and total – calculates itself","Angebot":"Quote",
"Kostenvoranschlag mit Positionen, Gültigkeit und Bedingungen":"Quotation with items, validity and terms","Besprechungsprotokoll":"Meeting minutes","Teilnehmende, Tagesordnung, Beschlüsse und Aufgaben":"Participants, agenda, decisions and tasks","Projektbericht":"Project report",
"Mit Inhaltsverzeichnis, Kapiteln, Tabelle und Beschriftung":"With table of contents, chapters, table and caption","Pressemitteilung":"Press release","Überschrift, Vorspann, Zitat, Infokasten und Pressekontakt":"Headline, lead, quote, info box and press contact","Hausarbeit":"Term paper",
"Titelblatt, Inhaltsverzeichnis, Fußnoten, Literaturverzeichnis":"Title page, table of contents, footnotes, bibliography","Referat-Handout":"Presentation handout","Eine Seite mit Gliederung, Kernaussagen, Begriffen und Quellen":"One page with outline, key points, terms and sources",
"Stundenplan":"Timetable","Wochenplan Montag bis Freitag mit Zeiten":"Weekly plan Monday to Friday with times","Einladung":"Invitation","Feier, Geburtstag oder Vereinsfest – mit Rückmeldung":"Party, birthday or club event – with RSVP","Speisekarte":"Menu",
"Vorspeisen, Hauptgerichte, Desserts und Getränke mit Preisen":"Starters, mains, desserts and drinks with prices","Flyer / Aushang":"Flyer / notice","Große Überschrift, Infokasten und Abreißzettel":"Big headline, info box and tear-off strips","Urkunde":"Certificate",
"Querformat für Sieger, Ehrungen oder Teilnahme":"Landscape for winners, honours or participation","Vereinsnachrichten":"Club newsletter","Newsletter mit Titelzeile und zwei Spalten":"Newsletter with masthead and two columns","Umzugscheckliste":"Moving checklist",
"Alle Aufgaben vor, während und nach dem Umzug":"All tasks before, during and after the move","Wohnungsübergabeprotokoll":"Apartment handover report","Zählerstände, Schlüssel, Zustand der Räume, Unterschriften":"Meter readings, keys, room condition, signatures","Reiseplan":"Travel plan",
"Tagesplan, Unterkünfte und Packliste für die nächste Reise":"Day plan, accommodation and packing list for your next trip","Besprechung, Aufgaben, nächste Schritte":"Meeting, tasks, next steps",
"Geschäftlich":"Business","Schule & Studium":"School & university","Privat & Freizeit":"Personal & leisure","Alle":"All","Neues Dokument":"New document","Leer beginnen oder eine Vorlage wählen":"Start blank or choose a template",
}
IGN = ["{SEITE}","{SEITEN}","Seite {SEITE} von {SEITEN}","Caption","FaleStyle{0}","Marke","Keine Beschriftungen gefunden.","(Noch keine Beschriftungen)","!Fehler","MUSTER","NICHT KOPIEREN",'data-x="paste-text"','data-x="ins-bookmark"','data-x="ins-xref"','data-x="ins-endnote"','data-x="ins-caption"','data-x="ins-dropcap"']
p='/home/claude/FalePDF/js/i18n/en.js'
s=open(p,encoding='utf8').read()
end=s.index('\n};')
first=s[:end]
existing=set(re.findall(r'^\s*("(?:[^"\\]|\\.)*")\s*:', first, re.M))
existing={json.loads(k) for k in existing}
add=[f'  {json.dumps(k,ensure_ascii=False)}: {json.dumps(v,ensure_ascii=False)},' for k,v in T.items() if k not in existing]
if not first.rstrip().endswith(','): first=first.rstrip()+','
s=first+'\n  // Office 4 – Textverarbeitung\n'+'\n'.join(add)+s[end:]
open(p,'w',encoding='utf8').write(s)
ig='/home/claude/FalePDF/scripts/i18n-ignore.txt'
cur=open(ig,encoding='utf8').read().split('\n')
with open(ig,'a',encoding='utf8') as f:
    for k in IGN:
        if k not in cur: f.write(k+'\n')
print(len(add),'added')
