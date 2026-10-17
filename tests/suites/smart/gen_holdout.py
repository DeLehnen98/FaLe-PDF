"""Held-out documents (written after the extractor was tuned on corpus/): different wording and layouts.
Writes holdout/<id>.pdf + holdout/truth.json. Run the unit test with: node test_extract.mjs --dir=holdout"""
import os, json, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_corpus as G
from gen_corpus import Letter, Receipt, T, iban_de, fmt_iban, rl, rb_frist

OUT = os.path.join(G.HERE, 'holdout')
os.makedirs(OUT, exist_ok=True)
DOCS = []
add = lambda d, t: DOCS.append((d, t))

# h01 Rechnung: labels above values (table-like info), "Fälligkeitsdatum", amount with "EUR" prefix
ib = iban_de(76050101, 4433221100)
L = Letter('h01')
L.head = [('Ofenbau Frankenland GmbH', 15, True), ('Kaminöfen · Schornsteintechnik', 8, False)]
L.ret = 'Ofenbau Frankenland GmbH, Pegnitzweg 4, 90403 Nürnberg'
L.rcpt = ['Frau', 'Hanna Vogel', 'Kirchgasse 11', '91054 Erlangen']
L.info = [('Rechnungs-Nr.', 'OF/2026/0815'), ('Kunden-ID', 'K-20931'), ('Rechnungsdatum', '7. Oktober 2026')]
L.subject = 'Ihre Rechnung zur Wartung des Kaminofens'
L.body = ['Sehr geehrte Frau Vogel,', 'wir danken für den Auftrag und berechnen Ihnen die jährliche Wartung Ihres Kaminofens:',
          ('table', [['Leistung', 'Anzahl', 'Summe'], ['Wartung inkl. Dichtungstausch (Arbeitslohn)', '1', '145,00'], ['Ersatzteile', '1', '38,60'], ['Netto', '', '183,60'], ['MwSt. 19%', '', '34,88'], ['Endbetrag', '', 'EUR 218,48']], [110, 20, 30]),
          'Fälligkeitsdatum: 21.10.2026', f'Bankverbindung: Sparkasse Nürnberg, IBAN: {fmt_iban(ib)}, BIC: SSKNDE77XXX', 'Mit besten Grüßen', 'Ofenbau Frankenland GmbH']
L.footer = ['Ofenbau Frankenland GmbH · Telefon 0911 556677 · buero@ofenbau-frankenland.de']
add(L, T(type='rechnung', sender='Ofenbau Frankenland GmbH', recipient='Hanna Vogel', date='2026-10-07', kundennummer='K-20931', rechnungsnummer='OF/2026/0815', betrag=218.48,
         iban=iban_de(76050101, 4433221100), bic='SSKNDE77XXX', due='2026-10-21', phone='0911 556677', email='buero@ofenbau-frankenland.de'))

# h02 Mahnung, "2. Mahnung", deadline as "Zahlungsfrist"
ib = iban_de(25050180, 9081726354)
L = Letter('h02')
L.head = [('Leinetal Versand KG', 14, True)]
L.ret = 'Leinetal Versand KG · Am Hafen 2 · 30159 Hannover'
L.rcpt = ['Herrn', 'Paul Neumann', 'Wiesenweg 8', '31134 Hildesheim']
L.info = [('Kundennummer', 'LV 778 812'), ('Datum', '12.10.2026')]
L.title = '2. Mahnung'
L.body = ['Sehr geehrter Herr Neumann,', 'unsere Rechnung Nr. 2026-55120 vom 18.08.2026 ist trotz Zahlungserinnerung noch nicht ausgeglichen.',
          ('table', [['', '', 'EUR'], ['Rechnungsbetrag', '', '64,95'], ['Mahngebühren', '', '5,00'], ['Gesamtforderung', '', '69,95']], [120, 0, 40]),
          'Zahlungsfrist: 26.10.2026', f'Sparkasse Hannover · IBAN {fmt_iban(ib)}', 'Freundliche Grüße', 'Leinetal Versand KG – Forderungsmanagement']
L.footer = ['Leinetal Versand KG · Kundenservice 0511 998800 · mahnwesen@leinetal-versand.de']
add(L, T(type='mahnung', sender='Leinetal Versand KG', recipient='Paul Neumann', date='2026-10-12', kundennummer='LV 778 812', rechnungsnummer='2026-55120', betrag=69.95, iban=ib,
         due='2026-10-26', phone='0511 998800', email='mahnwesen@leinetal-versand.de'))

# h03 Bescheid Grundsteuer (Stadt), Widerspruch via "binnen eines Monats nach Bekanntgabe"
ib = iban_de(55050120, 200300)
L = Letter('h03')
L.head = [('Stadt Mainz', 15, True), ('Amt für Finanzen · Steueramt', 9, False)]
L.ret = 'Stadt Mainz · Steueramt · Postfach 3820 · 55028 Mainz'
L.rcpt = ['Herrn', 'Ali Demir', 'Rheinallee 50', '55118 Mainz']
L.info = [('Kassenzeichen:', '1.234.567.8'), ('Datum:', '21.01.2026')]
L.subject = 'Grundsteuerbescheid 2026'
L.body = ['Sehr geehrter Herr Demir,', 'für Ihr Grundstück Rheinallee 50 wird die Grundsteuer für das Kalenderjahr 2026 wie folgt festgesetzt:',
          ('table', [['', '', 'Euro'], ['Grundsteuer B (Jahresbetrag)', '', '412,00'], ['davon fällig zum 15.02.2026', '', '103,00']], [120, 0, 40]),
          f'Zahlungen bitte unter Angabe des Kassenzeichens auf IBAN {fmt_iban(ib)} (Sparkasse Mainz).',
          ('bold', 'Rechtsbehelfsbelehrung'), 'Gegen diesen Bescheid kann binnen eines Monats nach Bekanntgabe Widerspruch erhoben werden.']
L.footer = ['Stadt Mainz · Steueramt · Tel. 06131 12-0']
add(L, T(type='bescheid', sender='Stadt Mainz', recipient='Ali Demir', date='2026-01-21', aktenzeichen='1.234.567.8', betrag=412.00, iban=ib, due=rb_frist('2026-01-21'), phone='06131 12-0'))

# h04 Kündigungsbestätigung Streaming, end date written out
L = Letter('h04')
L.head = [('FilmFlut Media GmbH', 14, True)]
L.rcpt = ['Frau', 'Clara Lange', 'Moltkestraße 3', '04109 Leipzig']
L.info = [('Kundenkonto', 'FF-9928814'), ('Leipzig, den', '11.10.2026')]
L.subject = 'Wir haben Ihre Kündigung erhalten'
L.body = ['Hallo Clara,', 'schade, dass du gehst! Deine Kündigung ist bei uns eingegangen. Dein Abo läuft noch bis zum 9. November 2026 und endet dann automatisch.',
          'Bis dahin kannst du alle Filme und Serien weiter schauen.', 'Dein FilmFlut-Team']
L.footer = ['FilmFlut Media GmbH · Karl-Liebknecht-Straße 9 · 04107 Leipzig · hilfe@filmflut.de']
add(L, T(type='vertrag', sender='FilmFlut Media GmbH', recipient='Clara Lange', date='2026-10-11', kundennummer='FF-9928814', due='2026-11-09', email='hilfe@filmflut.de'))

# h05 Vertrag DSL with "Mindestvertragslaufzeit von 24 Monaten", start in text
L = Letter('h05')
L.head = [('Glasnetz Süd AG', 15, True)]
L.ret = 'Glasnetz Süd AG · Lichtweg 1 · 79098 Freiburg'
L.rcpt = ['Herrn', 'Felix Braun', 'Talstraße 21', '79102 Freiburg']
L.info = [('Kundennummer:', 'GS-500712'), ('Auftragsdatum:', '03.02.2025'), ('Datum:', '05.02.2025')]
L.subject = 'Auftragsbestätigung Glasfaser 1000'
L.body = ['Sehr geehrter Herr Braun,', 'vielen Dank für Ihre Bestellung. Ihr Anschluss wird am 01.03.2025 freigeschaltet. Der Vertrag hat eine Mindestvertragslaufzeit von 24 Monaten ab Freischaltung.',
          'Die Kündigungsfrist beträgt einen Monat zum Ende der Mindestvertragslaufzeit. Monatlicher Preis: 49,99 €.', 'Mit freundlichen Grüßen', 'Glasnetz Süd AG']
L.footer = ['Glasnetz Süd AG · Hotline 0761 123123 · kontakt@glasnetz-sued.de']
add(L, T(type='vertrag', sender='Glasnetz Süd AG', recipient='Felix Braun', date='2025-02-05', kundennummer='GS-500712', betrag=49.99, due='2027-01-28', phone='0761 123123', email='kontakt@glasnetz-sued.de'))

# h06 Krankenkasse Beitragserhöhung letter (arzt), no deadline
L = Letter('h06')
L.head = [('Nordkasse – Ihre Krankenkasse', 13, True)]
L.ret = 'Nordkasse · Postfach 1700 · 24103 Kiel'
L.rcpt = ['Herrn', 'Ole Hansen', 'Strandweg 5', '24937 Flensburg']
L.info = [('Versichertennummer', 'H112233445'), ('Datum', '30.09.2026')]
L.subject = 'Ihr Beitrag ab 1. Januar 2027'
L.body = ['Sehr geehrter Herr Hansen,', 'der Zusatzbeitrag Ihrer Krankenkasse steigt zum 01.01.2027 von 2,5 auf 2,9 Prozent. Sie haben ein Sonderkündigungsrecht.',
          'Ihre Gesundheit ist uns wichtig – nutzen Sie unsere Vorsorgeangebote.', 'Ihre Nordkasse']
L.footer = ['Nordkasse · Service 0431 7788990 · post@nordkasse.de']
add(L, T(type='arzt', sender='Nordkasse', recipient='Ole Hansen', date='2026-09-30', phone='0431 7788990', email='post@nordkasse.de'))

# h07 Lohnabrechnung minimal
L = Letter('h07')
L.head = [('Bäckerei Goldkorn GmbH', 14, True)]
L.rcpt = ['Frau', 'Mila Schulz', 'Mühlenweg 2', '01067 Dresden']
L.info = [('Personal-Nr.', '0042'), ('Monat', 'Oktober 2026'), ('Erstellt am', '27.10.2026')]
L.title = 'Verdienstabrechnung'
L.body = [('table', [['Bezeichnung', '', 'Betrag'], ['Stundenlohn 120 Std.', '', '1.680,00'], ['Gesamtbrutto', '', '1.680,00'], ['Steuer/SV-Abzüge', '', '-332,15'], ['Auszahlungsbetrag', '', '1.347,85']], [120, 0, 40])]
L.footer = ['Bäckerei Goldkorn GmbH · Lohnbuchhaltung']
add(L, T(type='lohnabrechnung', sender='Bäckerei Goldkorn GmbH', recipient='Mila Schulz', date='2026-10-27', betrag=1347.85))

# h08 Versicherung Rechtsschutz – renewal notice
ib = iban_de(37040044, 532013001)
L = Letter('h08')
L.head = [('Rheinische Rechtsschutz AG', 14, True)]
L.ret = 'Rheinische Rechtsschutz AG · Postfach 101010 · 50450 Köln'
L.rcpt = ['Frau', 'Nina Koch', 'Lindenallee 7', '53111 Bonn']
L.info = [('Vertragsnummer', 'RS-4471-9902'), ('Datum', '01.09.2026')]
L.subject = 'Beitragsrechnung Rechtsschutzversicherung'
L.body = ['Sehr geehrte Frau Koch,', 'für den Zeitraum 01.10.2026 bis 30.09.2027 wird Ihr Beitrag fällig.', 'Zu zahlender Beitrag: 289,20 EUR', 'Bitte überweisen Sie den Beitrag bis zum 01.10.2026.',
          f'Commerzbank · IBAN {fmt_iban(ib)} · BIC COBADEFFXXX', 'Ihre Rheinische Rechtsschutz AG']
L.footer = ['Kundenservice: 0221 400 400 · service@rheinische-rechtsschutz.de']
add(L, T(type='versicherung', sender='Rheinische Rechtsschutz AG', recipient='Nina Koch', date='2026-09-01', vertragsnummer='RS-4471-9902', betrag=289.20, iban=ib, bic='COBADEFFXXX',
         due='2026-10-01', phone='0221 400 400', email='service@rheinische-rechtsschutz.de'))

# h09 Werbung Reisebüro
L = Letter('h09')
L.head = [('Sonnenreisen Direkt GmbH', 14, True)]
L.rcpt = ['Herrn', 'Lukas Wolf', 'Seestraße 4', '88045 Friedrichshafen']
L.info = [('Datum', '20.09.2026')]
L.subject = 'Ihr Urlaubsgutschein über 100 € wartet!'
L.body = ['Lieber Herr Wolf,', 'buchen Sie jetzt Ihre Winterreise und sichern Sie sich 100 € Rabatt mit dem Code SONNE100. Nur solange der Vorrat reicht!', 'Ihr Team von Sonnenreisen Direkt']
L.footer = ['Keine Post mehr? Einfach abmelden unter sonnenreisen-direkt.de/abmelden']
add(L, T(type='werbung', sender='Sonnenreisen Direkt GmbH', recipient='Lukas Wolf', date='2026-09-20'))

# h10 Kontoauszug other wording
L = Letter('h10')
L.head = [('Volksbank Mittelhessen eG', 13, True)]
L.rcpt = ['Herrn', 'Jan Peters', 'Marktstraße 1', '35390 Gießen']
L.info = [('Auszug', '41'), ('Datum', '13.10.2026')]
L.title = 'Kontoauszug Girokonto'
L.body = [('table', [['Datum', 'Text', 'Umsatz'], ['06.10.2026', 'Lastschrift Telekom', '-39,95'], ['08.10.2026', 'Gutschrift Kindergeld', '255,00']], [40, 80, 40]),
          'Kontostand am 06.10.2026: 1.020,40 EUR', 'Neuer Kontostand am 13.10.2026: 1.235,45 EUR']
L.footer = ['Volksbank Mittelhessen eG · Schiffenberger Weg 110 · 35394 Gießen']
add(L, T(type='kontoauszug', sender='Volksbank Mittelhessen eG', recipient='Jan Peters', date='2026-10-13', betrag=1235.45))

# h11 Arztrechnung Physiotherapie (rechnung)
ib = iban_de(66050101, 1112223)
L = Letter('h11')
L.head = [('Physiotherapie Bewegt', 14, True), ('Inh. Sarah Fuchs · Kaiserstraße 12 · 76133 Karlsruhe', 8, False)]
L.rcpt = ['Herrn', 'Tim Becker', 'Sophienstraße 40', '76135 Karlsruhe']
L.info = [('Rechnungsnummer', 'PB-26-311'), ('Rechnungsdatum', '05.10.2026')]
L.title = 'Rechnung'
L.body = ['Sehr geehrter Herr Becker,', 'für die ärztlich verordnete Krankengymnastik (6 Behandlungen) berechnen wir 6 x 32,50 € = 195,00 €.',
          'Gesamtbetrag: 195,00 €', 'Bitte überweisen Sie den Betrag innerhalb von 21 Tagen.', f'IBAN: {fmt_iban(ib)}', 'Viele Grüße', 'Sarah Fuchs']
L.footer = ['Physiotherapie Bewegt · 0721 9900110 · praxis@physio-bewegt.de']
add(L, T(type='rechnung', sender='Physiotherapie Bewegt', recipient='Tim Becker', date='2026-10-05', rechnungsnummer='PB-26-311', betrag=195.00, iban=ib, due='2026-10-26',
         phone='0721 9900110', email='praxis@physio-bewegt.de', tax=dict(total=195.00, vat19=None, vat7=None, net=None, payment='ueberweisung', category='krankheit', labor=None, merchant='Physiotherapie Bewegt', date='2026-10-05')))

# h12 Kassenbon Baumarkt
add(Receipt('h12', ['**^BAUMARKT HAMMER', '^Hammer Baumärkte GmbH & Co. KG', '^Filiale Kassel', '', rl('Schrauben 4x40 200St', '6,99'), rl('Holzleim 250g', '4,49'),
                    rl('**SUMME EUR', '11,48'), rl('EC-Cash', '11,48'), '', rl('MwSt.   Netto   Steuer', ''), rl('19%     9,65    1,83', ''), '', '10.10.2026 14:31 Kasse 07']),
    T(type='rechnung', sender='Hammer Baumärkte GmbH & Co. KG', date='2026-10-10', betrag=11.48,
      tax=dict(total=11.48, vat19=1.83, vat7=None, net=9.65, payment='ec', category='privat', labor=None, merchant='Hammer Baumärkte GmbH & Co. KG', date='2026-10-10')))

# h13 Kassenbon Café (7 % + 19 %)
add(Receipt('h13', ['**^Café Bohne', '^Bohne Gastro UG', '^Neustadt 5, 28195 Bremen', '', rl('2 x Cappuccino', '7,80'), rl('1 x Croissant', '2,90'),
                    rl('**Gesamt EUR', '10,70'), rl('Bar', '20,00'), rl('Rückgeld', '9,30'), '', rl('Netto 19%', '8,99'), rl('MwSt 19%', '1,71'), '', 'Datum: 03.10.2026 Zeit: 09:45']),
    T(type='rechnung', sender='Bohne Gastro UG', date='2026-10-03', betrag=10.70,
      tax=dict(total=10.70, vat19=1.71, vat7=None, net=8.99, payment='bar', category='privat', labor=None, merchant='Bohne Gastro UG', date='2026-10-03')))

# h14 Handwerker Elektro with "Lohnanteil"
ib = iban_de(51050015, 600700800)
L = Letter('h14')
L.head = [('Elektro Funke GmbH', 14, True)]
L.ret = 'Elektro Funke GmbH · Wilhelmstraße 7 · 65183 Wiesbaden'
L.rcpt = ['Frau', 'Eva Zimmermann', 'Taunusstraße 30', '65183 Wiesbaden']
L.info = [('Rechnung', 'EF-2026-0731'), ('Datum', '15.09.2026')]
L.subject = 'Austausch Sicherungskasten'
L.body = ['Sehr geehrte Frau Zimmermann,', ('table', [['', '', 'EUR'], ['Montage 4 Std.', '', '260,00'], ['Material', '', '410,00'], ['Netto', '', '670,00'], ['USt 19 %', '', '127,30'], ['Bruttobetrag', '', '797,30']], [120, 0, 40]),
          'Lohnanteil inkl. USt: 309,40 EUR', 'Zahlbar bis 29.09.2026 per Überweisung.', f'Nassauische Sparkasse · IBAN {fmt_iban(ib)}', 'Elektro Funke GmbH']
L.footer = ['Elektro Funke GmbH · 0611 445566 · info@elektro-funke.de']
add(L, T(type='rechnung', sender='Elektro Funke GmbH', recipient='Eva Zimmermann', date='2026-09-15', rechnungsnummer='EF-2026-0731', betrag=797.30, iban=ib, due='2026-09-29', phone='0611 445566',
         email='info@elektro-funke.de', tax=dict(total=797.30, vat19=127.30, vat7=None, net=670.00, payment='ueberweisung', category='handwerker', labor=309.40, merchant='Elektro Funke GmbH', date='2026-09-15')))

# h15 Behörde – Aufforderung (Jobcenter) with "spätestens am"
L = Letter('h15')
L.head = [('Jobcenter Dortmund', 14, True)]
L.ret = 'Jobcenter Dortmund · Steinstraße 39 · 44147 Dortmund'
L.rcpt = ['Herrn', 'Kevin Lorenz', 'Hafenstraße 9', '44145 Dortmund']
L.info = [('BG-Nummer:', '35501BG0012345'), ('Datum:', '06.10.2026')]
L.subject = 'Aufforderung zur Mitwirkung'
L.body = ['Sehr geehrter Herr Lorenz,', 'zur Prüfung Ihres Weiterbewilligungsantrags benötigen wir noch Ihre Kontoauszüge der letzten drei Monate.',
          'Bitte reichen Sie die Unterlagen spätestens am 20.10.2026 ein. Ohne die Unterlagen kann über Ihren Antrag nicht entschieden werden.', 'Mit freundlichen Grüßen', 'Ihr Jobcenter Dortmund']
L.footer = ['Jobcenter Dortmund · Servicetelefon 0231 842-0']
add(L, T(type='bescheid', sender='Jobcenter Dortmund', recipient='Kevin Lorenz', date='2026-10-06', aktenzeichen='35501BG0012345', due='2026-10-20', phone='0231 842-0'))

# h16 Spendenbescheinigung short form
L = Letter('h16')
L.head = [('Tierheim Sonnenhof e.V.', 14, True)]
L.rcpt = ['Frau', 'Petra Engel', 'Hofweg 6', '49074 Osnabrück']
L.info = [('Datum', '15.02.2026')]
L.subject = 'Zuwendungsbestätigung für Ihre Spende'
L.body = ['Liebe Frau Engel, herzlichen Dank für Ihre Unterstützung!', 'Betrag der Zuwendung: 80,00 Euro', 'Tag der Zuwendung: 24.12.2025',
          'Der Tierheim Sonnenhof e.V. ist wegen Förderung des Tierschutzes als gemeinnützig anerkannt.', 'Tierheim Sonnenhof e.V.']
L.footer = ['Tierheim Sonnenhof e.V. · info@tierheim-sonnenhof.de']
add(L, T(type='sonstiges', sender='Tierheim Sonnenhof e.V.', recipient='Petra Engel', date='2026-02-15', betrag=80.00, email='info@tierheim-sonnenhof.de',
         tax=dict(total=80.00, vat19=None, vat7=None, net=None, payment=None, category='spenden', labor=None, merchant='Tierheim Sonnenhof e.V.', date='2025-12-24')))

truth = {}
for d, t in DOCS:
    d.render(os.path.join(OUT, d.id + '.pdf'))
    truth[d.id] = t
json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
print(len(DOCS), 'holdout documents')
