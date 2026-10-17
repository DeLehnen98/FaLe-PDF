import json
from _w import DATA

def G(**d):
    p = DATA / 'ratgeber' / f"{d['id']}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('wrote', p.name)

G(id='bewerbung-per-e-mail', order=1, card='Bewerbung per E-Mail', short='Mustertext für die E-Mail und die Bewerbungsmappe als eine PDF.',
  title='Bewerbung per E-Mail: Mustertext und PDF-Mappe | FaleNetwork',
  h1='Bewerbung per E-Mail – Mustertext und Bewerbungsmappe als PDF',
  desc='So schickst du deine Bewerbung per E-Mail: Mustertext für die Mail, Betreff, Dateiname und die ganze Mappe als eine kleine PDF – direkt im Browser erstellt.',
  lede='Die meisten Bewerbungen laufen heute per E-Mail oder über ein Portal. Mit diesen Schritten kommt deine Mappe vollständig, ordentlich und in einer Datei an.',
  sections=[
    dict(h='Die E-Mail selbst: kurz, mit klarem Betreff', text=['Die E-Mail ist nicht das Anschreiben. Sie begleitet die Anlage, nennt die Stelle und sagt, was im Anhang ist. Drei bis fünf Sätze reichen. Schreib sie von einer seriösen Adresse aus, am besten mit Vor- und Nachnamen.'],
         example=dict(subject='Betreff: Bewerbung als Medizinische Fachangestellte – Ihre Anzeige vom 2. Oktober', lines=[
           'Sehr geehrte Frau Dr. Gruber,',
           'anbei sende ich Ihnen meine Bewerbung für die Stelle als Medizinische Fachangestellte in Ihrer Praxis. Im Anhang finden Sie mein Anschreiben, meinen Lebenslauf und meine Zeugnisse in einer PDF-Datei.',
           'Ab dem 1. August könnte ich bei Ihnen anfangen. Für Rückfragen erreichen Sie mich unter der Telefonnummer in der Signatur.',
           'Mit freundlichen Grüßen',
           'Sophie Wagner',
           'Talstraße 23 · 66424 Homburg · 030 23125 412'])),
    dict(h='Alles in eine PDF: die Bewerbungsmappe', steps=[
           'Anschreiben und Lebenslauf als PDF erstellen – zum Beispiel mit den Vorlagen aus dem Archiv.',
           'Zeugnisse einscannen oder abfotografieren und in PDF umwandeln.',
           'Alles in der richtigen Reihenfolge zu einer Datei zusammenfügen: Anschreiben, Lebenslauf, Zeugnisse (das neueste zuerst), Bescheinigungen.',
           'Die fertige Datei verkleinern, damit sie unter der Grenze des Portals oder Postfachs bleibt – oft 3 bis 5 MB.',
           'Datei sinnvoll benennen, z. B. „Bewerbung_Sophie_Wagner_MFA.pdf“.'],
         tools=['cover-letter', 'cv-builder', 'scan-to-pdf', 'merge-pdf', 'compress-pdf']),
    dict(h='Häufige Fehler', list=['Mehrere einzelne Anhänge mit Namen wie „Scan_0012.jpg“.', 'Eine 25-MB-Datei, die im Postfach hängen bleibt.', 'Das Anschreiben in den E-Mail-Text kopieren und zusätzlich anhängen.', 'Eine Spaßadresse als Absender.', 'Falscher Firmenname aus einer früheren Bewerbung.'])],
  faq=[dict(q='Soll das Anschreiben in die E-Mail oder in den Anhang?', a='In den Anhang, als Teil der PDF-Mappe. Die E-Mail selbst bleibt kurz. Manche Unternehmen wünschen es ausdrücklich anders – dann hältst du dich an die Anzeige.'),
       dict(q='Wie groß darf die Datei sein?', a='So klein wie möglich, meist reichen 2 bis 5 MB. Steht eine Grenze in der Anzeige oder im Portal, halte sie ein. „PDF komprimieren“ verkleinert die Mappe direkt im Browser, ohne dass deine Dokumente hochgeladen werden.'),
       dict(q='Darf ich die Bewerbung an mehrere Firmen gleichzeitig schicken?', a='Ja, aber immer einzeln, mit persönlicher Anrede. Eine E-Mail mit vielen Empfängern im Verteiler wirkt wie eine Massenbewerbung.')])

G(id='initiativbewerbung', order=2, card='Initiativbewerbung', short='Bewerben, ohne dass eine Stelle ausgeschrieben ist.',
  title='Initiativbewerbung schreiben: Aufbau und Beispiele | FaleNetwork',
  h1='Initiativbewerbung – so bewirbst du dich ohne Stellenanzeige',
  desc='Initiativbewerbung schreiben: wann sie sich lohnt, wie du den richtigen Ansprechpartner findest und wie Anschreiben und Lebenslauf aufgebaut sein sollten – mit Beispielen.',
  lede='Viele Stellen werden nie ausgeschrieben, vor allem in kleinen Betrieben. Eine gute Initiativbewerbung zeigt, dass du genau weißt, was du dort tun willst.',
  sections=[
    dict(h='Wann sich eine Initiativbewerbung lohnt', text=['Besonders bei Handwerksbetrieben, Arztpraxen, kleinen Agenturen, Kitas und Hotels. Dort wird oft eingestellt, wenn die passende Person auftaucht. Auch große Unternehmen haben manchmal eigene Formulare für Initiativbewerbungen.']),
    dict(h='Vorher anrufen', text=['Ein kurzer Anruf klärt, wer zuständig ist und ob gerade Bedarf besteht. Danach kannst du das Anschreiben mit „wie mit Ihnen am Telefon besprochen“ beginnen – das hebt dich sofort ab.']),
    dict(h='Aufbau des Anschreibens', steps=['Einstieg: Warum genau dieses Unternehmen? Ein konkreter Anlass wirkt stärker als Lob.', 'Was du anbietest: eine klare Rolle (z. B. „Kundendienst“, „Prophylaxe“) statt „irgendeine Stelle“.', 'Belege: zwei Erfahrungen oder Ergebnisse, die zu dieser Rolle passen.', 'Schluss: Verfügbarkeit und ein konkretes Angebot, etwa ein Probetag.']),
    dict(h='Beispiele aus dem Archiv', text=['Diese Berufe haben je ein ausformuliertes Beispiel für eine Initiativbewerbung:'], jobs=['elektriker', 'pflegefachkraft'])],
  faq=[dict(q='Was schreibe ich in den Betreff?', a='„Initiativbewerbung als …“ mit der konkreten Rolle. In den Vorlagen-Werkzeugen kannst du die Stelle als „Elektroniker (Initiativbewerbung)“ eintragen.'),
       dict(q='Wie lange sollte ich auf eine Antwort warten?', a='Nach etwa zwei Wochen kannst du freundlich nachfragen, am besten telefonisch.')])

G(id='lebenslauf-ohne-luecken', order=3, card='Lebenslauf ohne Lücken', short='Arbeitslosigkeit, Krankheit, Pflege oder Elternzeit ehrlich und souverän darstellen.',
  title='Lücken im Lebenslauf richtig erklären | FaleNetwork',
  h1='Lücken im Lebenslauf – ehrlich und souverän erklären',
  desc='Lücken im Lebenslauf richtig darstellen: Elternzeit, Pflege, Krankheit, Arbeitslosigkeit oder Neuorientierung – mit Formulierungen, die ehrlich sind und nichts zu viel verraten.',
  lede='Fast jeder Lebenslauf hat Lücken. Problematisch wird es erst, wenn sie unerklärt bleiben. Ein kurzer, sachlicher Eintrag reicht meistens.',
  sections=[
    dict(h='Welche Lücken auffallen', text=['Ein, zwei Monate zwischen zwei Stellen fallen niemandem auf. Ab etwa drei Monaten fragen sich Personaler, was passiert ist. Schreib den Zeitraum lieber selbst in den Lebenslauf, als ihn zu verstecken – etwa durch Jahresangaben statt Monaten, das wirkt schnell unehrlich.']),
    dict(h='Formulierungen, die funktionieren', list=['„Elternzeit“ oder „Familienzeit“ – ohne weitere Details.', '„Pflege eines Angehörigen“ – zeigt Verantwortung, mehr musst du nicht sagen.', '„Berufliche Neuorientierung, Weiterbildung in …“ – wenn du die Zeit genutzt hast.', '„Arbeitssuchend“ – ehrlich und neutral, gern mit Kursen, die du in der Zeit gemacht hast.', '„Auszeit nach längerer Erkrankung, heute voll belastbar“ – Krankheiten musst du nicht nennen.', '„Reise / Sabbatical“ – mit einem Satz, was du mitgenommen hast.']),
    dict(h='Was du nicht schreiben musst', text=['Gesundheitliche Details, private Krisen oder Gründe für eine Kündigung gehören nicht in den Lebenslauf. Im Gespräch reicht ein Satz, der zeigt, dass das Thema abgeschlossen ist. Ein Foto, dein Geburtsdatum, Familienstand oder Religion sind in Deutschland ebenfalls freiwillig.']),
    dict(h='Im Editor umsetzen', text=['Im Lebenslauf-Editor kannst du eine Station ohne Arbeitgeber anlegen – nur mit Zeitraum und Bezeichnung wie „Familienzeit“.'], tools=['cv-builder'])],
  faq=[dict(q='Muss ich jede Lücke erklären?', a='Nein. Kurze Pausen von wenigen Wochen bleiben unerwähnt. Längere Zeiträume ab etwa drei Monaten solltest du mit einem neutralen Stichwort füllen.'),
       dict(q='Darf ich Lücken mit falschen Angaben füllen?', a='Nein. Falsche Angaben im Lebenslauf können später sogar eine Kündigung rechtfertigen. Ehrlich und knapp ist immer die bessere Wahl.')])

G(id='bewerbung-nach-der-ausbildung', order=4, card='Bewerbung nach der Ausbildung', short='Der erste Job als Fachkraft – im Betrieb bleiben oder wechseln.',
  title='Bewerbung nach der Ausbildung: Tipps und Muster | FaleNetwork',
  h1='Bewerbung nach der Ausbildung – der erste Job als Fachkraft',
  desc='Bewerbung nach der Ausbildung: wann du dich bewirbst, wie du ohne viel Berufserfahrung überzeugst und welche Vorlagen aus dem Archiv dafür passen.',
  lede='Nach der Ausbildung hast du mehr zu bieten, als du denkst: drei Jahre Praxis, eine Prüfung, konkrete Aufgaben. So machst du daraus eine starke Bewerbung.',
  sections=[
    dict(h='Der richtige Zeitpunkt', text=['Bewirb dich drei bis sechs Monate vor der Abschlussprüfung. Leg das letzte Berufsschul- oder Zwischenzeugnis bei und reich das Prüfungszeugnis nach. Wenn dein Ausbildungsbetrieb dich übernehmen möchte, sprich offen darüber, bevor du anderswo zusagst.']),
    dict(h='Was ins Anschreiben gehört', list=['Abschluss mit Datum und, wenn gut, Note.', 'Zwei, drei Aufgaben, die du in der Ausbildung selbstständig übernommen hast.', 'Ein Projekt, Gesellenstück oder Abschlussprojekt mit Ergebnis.', 'Warum du wechseln willst – positiv formuliert (neuer Schwerpunkt, Region, Größe des Betriebs).', 'Ab wann du anfangen kannst.']),
    dict(h='Beispiele aus dem Archiv', text=['Diese Berufsseiten enthalten ein Anschreiben für den Berufsstart nach der Ausbildung:'], jobs=['kauffrau-bueromanagement', 'elektriker', 'medizinische-fachangestellte', 'it-systemadministrator', 'koch', 'erzieherin']),
    dict(h='Mappe fertig machen', text=['Anschreiben und Lebenslauf aus den Vorlagen erstellen, Zeugnisse dazu, alles in eine PDF und verkleinern.'], tools=['cover-letter', 'cv-builder', 'merge-pdf', 'compress-pdf'])],
  faq=[dict(q='Ich wurde nicht übernommen. Wie schreibe ich das?', a='Gar nicht im Anschreiben. Im Gespräch reicht ein sachlicher Satz, z. B. dass der Betrieb in diesem Jahr niemanden übernimmt. Konzentrier dich auf das, was du gelernt hast.'),
       dict(q='Gehört mein Ausbildungszeugnis in die Bewerbung?', a='Ja, das Ausbildungszeugnis des Betriebs und das Prüfungszeugnis. Wenn sie noch fehlen, das letzte Berufsschulzeugnis und ein Zwischenzeugnis.')])
