"""Synthetic German letters / receipts with ground truth for the Briefkasten extractor.
Writes corpus/<id>.pdf (+ corpus/<id>.jpg photo-like scans for a subset) and corpus/truth.json.
All names, companies, numbers and IBANs are invented (IBANs have valid check digits).
"""
import os, json, random, datetime, subprocess
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from PIL import Image, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'corpus')
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(4711)


def iban_de(blz, acct):
    bban = f'{blz:08d}{acct:010d}'
    num = int(''.join(str(int(c, 36)) for c in bban + 'DE00'))
    chk = 98 - num % 97
    return f'DE{chk:02d}{bban}'


def fmt_iban(i):
    return ' '.join(i[k:k + 4] for k in range(0, len(i), 4))


def eur(v):
    s = f'{abs(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return ('-' if v < 0 else '') + s


def de(iso):
    y, m, d = iso.split('-')
    return f'{d}.{m}.{y}'


def add_days(iso, n):
    return (datetime.date.fromisoformat(iso) + datetime.timedelta(days=n)).isoformat()


def add_months(iso, n):
    d = datetime.date.fromisoformat(iso)
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    import calendar
    last = calendar.monthrange(y, m)[1]
    return datetime.date(y, m, min(d.day, last)).isoformat()


def easter(y):
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4; f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30; i = c // 4; k = c % 4; l = (32 + 2 * e + 2 * i - h - k) % 7; m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31; day = ((h + l - 7 * m + 114) % 31) + 1
    return datetime.date(y, month, day)


def workday(iso):
    d = datetime.date.fromisoformat(iso)
    while True:
        e = easter(d.year)
        hol = {datetime.date(d.year, 1, 1), e - datetime.timedelta(2), e + datetime.timedelta(1), datetime.date(d.year, 5, 1), e + datetime.timedelta(39),
               e + datetime.timedelta(50), datetime.date(d.year, 10, 3), datetime.date(d.year, 12, 25), datetime.date(d.year, 12, 26)}
        if d.weekday() < 5 and d not in hol:
            return d.isoformat()
        d += datetime.timedelta(1)


def rb_frist(letter, months=1, weeks=0):
    fic = 4 if letter >= '2025-01-01' else 3
    bk = workday(add_days(letter, fic))
    end = add_days(bk, weeks * 7) if weeks else add_months(bk, months)
    return workday(end)


# ------------------------------------------------------------------ rendering
class Letter:
    def __init__(self, id):
        self.id = id
        self.head = []        # [(text, size, bold)]
        self.head_right = False
        self.ret = ''
        self.rcpt = []
        self.info = []        # [(label, value)]
        self.subject = ''
        self.body = []        # paragraphs (str) or ('table', rows, widths) or ('bold', text)
        self.footer = []      # lines
        self.title = None     # big title above subject (e.g. "Rechnung")

    def render(self, path):
        c = canvas.Canvas(path, pagesize=A4)
        W, H = A4
        y = H - 18 * mm
        for text, size, bold in self.head:
            c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
            if self.head_right:
                c.drawRightString(W - 20 * mm, y, text)
            else:
                c.drawString(25 * mm, y, text)
            y -= size * 0.45 * mm + 2 * mm
        top = H - 50 * mm
        if self.ret:
            c.setFont('Helvetica', 7)
            c.drawString(25 * mm, top, self.ret)
        c.setFont('Helvetica', 10)
        yy = top - 6 * mm
        for l in self.rcpt:
            c.drawString(25 * mm, yy, l)
            yy -= 5 * mm
        yi = top
        for lab, val in self.info:
            c.setFont('Helvetica', 8.5)
            c.drawString(125 * mm, yi, lab)
            c.drawString(160 * mm, yi, val)
            yi -= 4.6 * mm
        y = min(yy, yi) - 12 * mm
        if self.title:
            c.setFont('Helvetica-Bold', 16)
            c.drawString(25 * mm, y, self.title)
            y -= 9 * mm
        if self.subject:
            c.setFont('Helvetica-Bold', 11)
            c.drawString(25 * mm, y, self.subject)
            y -= 9 * mm
        c.setFont('Helvetica', 10)
        maxw = W - 45 * mm
        for p in self.body:
            if isinstance(p, tuple) and p[0] == 'table':
                rows, widths = p[1], p[2]
                for ri, row in enumerate(rows):
                    x = 25 * mm
                    c.setFont('Helvetica-Bold' if ri == 0 or (len(p) > 3 and ri in p[3]) else 'Helvetica', 9)
                    for ci, cell in enumerate(row):
                        if ci == 0:
                            c.drawString(x, y, cell)
                        else:
                            c.drawRightString(x + widths[ci] * mm, y, cell)
                        x += widths[ci] * mm
                    y -= 5 * mm
                y -= 2 * mm
                c.setFont('Helvetica', 10)
                continue
            bold = isinstance(p, tuple) and p[0] == 'bold'
            text = p[1] if bold else p
            c.setFont('Helvetica-Bold' if bold else 'Helvetica', 10)
            for raw in text.split('\n'):
                words = raw.split(' ')
                line = ''
                for w in words:
                    t = (line + ' ' + w).strip()
                    if c.stringWidth(t, 'Helvetica-Bold' if bold else 'Helvetica', 10) > maxw:
                        c.drawString(25 * mm, y, line)
                        y -= 5 * mm
                        line = w
                    else:
                        line = t
                if line:
                    c.drawString(25 * mm, y, line)
                    y -= 5 * mm
            y -= 3 * mm
            if y < 40 * mm:
                self._footer(c)
                c.showPage()
                y = H - 25 * mm
        self._footer(c)
        c.save()

    def _footer(self, c):
        c.setFont('Helvetica', 7)
        fy = 22 * mm
        for l in self.footer:
            c.drawString(25 * mm, fy, l)
            fy -= 3.6 * mm


class Receipt:
    def __init__(self, id, lines, width=80):
        self.id, self.lines, self.width = id, lines, width

    def render(self, path):
        h = (len(self.lines) * 4.2 + 20) * mm
        c = canvas.Canvas(path, pagesize=(self.width * mm, h))
        y = h - 10 * mm
        for l in self.lines:
            bold = l.startswith('**')
            t = l[2:] if bold else l
            center = t.startswith('^')
            t = t[1:] if center else t
            c.setFont('Courier-Bold' if bold else 'Courier', 8.5)
            if center:
                c.drawCentredString(self.width * mm / 2, y, t)
            else:
                c.drawString(5 * mm, y, t)
            y -= 4.2 * mm
        c.save()


def rl(left, right, w=40):
    return left + ' ' * max(1, w - len(left) - len(right)) + right


DOCS = []


def doc(d, truth, image=False):
    DOCS.append((d, truth, image))


def T(**kw):
    base = dict(type=None, sender=None, recipient=None, date=None, kundennummer=None, rechnungsnummer=None, vertragsnummer=None,
                aktenzeichen=None, steuernummer=None, betrag=None, iban=None, bic=None, due=None, phone=None, email=None)
    base.update(kw)
    return base


PEOPLE = [('Herrn', 'Max Mustermann', 'Lindenweg 3', '66111 Saarbrücken'), ('Frau', 'Erika Beispiel', 'Rosenstraße 12a', '10115 Berlin'),
          ('Herrn', 'Jonas Weber', 'Am Sportplatz 7', '50667 Köln'), ('Frau', 'Leonie Schmitt', 'Gartenstraße 44', '80331 München'),
          ('Herrn', 'Mehmet Yilmaz', 'Bahnhofstraße 9', '20095 Hamburg'), ('Frau', 'Sophie Krämer', 'Schillerplatz 2', '70173 Stuttgart')]


def person(i):
    return PEOPLE[i % len(PEOPLE)]


# ================================================================== RECHNUNGEN
# r01 Stadtwerke Strom Jahresabrechnung – Nachzahlung, Überweisung bis Datum
p = person(0); ib = iban_de(59050101, 12345678)
L = Letter('r01')
L.head = [('Stadtwerke Saarbrücken GmbH', 15, True), ('Energie für die Region', 9, False)]
L.ret = 'Stadtwerke Saarbrücken GmbH · Hohenzollernstraße 104 · 66117 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kundennummer:', '400 128 776'), ('Vertragskonto:', '2200 4711 03'), ('Rechnungsnummer:', 'SR-2026-0098812'), ('Datum:', '06.10.2026'), ('Telefon:', '0681 587-2000')]
L.title = 'Jahresabrechnung Strom 2025'
L.body = ['Sehr geehrter Herr Mustermann,', 'für den Abrechnungszeitraum 01.01.2025 bis 31.12.2025 erhalten Sie Ihre Jahresabrechnung. Ihr Verbrauch betrug 2.874 kWh.',
          ('table', [['Position', 'Menge', 'Betrag'], ['Arbeitspreis 2.874 kWh à 0,3412 €', '', '980,61 €'], ['Grundpreis 12 Monate', '', '167,40 €'],
                     ['Summe netto', '', '964,72 €'], ['Umsatzsteuer 19 %', '', '183,29 €'], ['Rechnungsbetrag brutto', '', '1.148,01 €'],
                     ['abzüglich geleistete Abschläge', '', '-1.020,00 €'], ['Nachzahlung', '', '128,01 €']], [120, 0, 40]),
          'Bitte überweisen Sie den Nachzahlungsbetrag von 128,01 € bis zum 27.10.2026 auf unser Konto. Ihr neuer monatlicher Abschlag beträgt ab November 96,00 €.',
          f'Bankverbindung: Sparkasse Saarbrücken · IBAN: {fmt_iban(ib)} · BIC: SAKSDE55XXX · Verwendungszweck: SR-2026-0098812',
          'Mit freundlichen Grüßen', 'Ihre Stadtwerke Saarbrücken']
L.footer = ['Stadtwerke Saarbrücken GmbH · Sitz Saarbrücken · Amtsgericht Saarbrücken HRB 1234 · Geschäftsführer: Dr. Hans Muster',
            'Kundenservice: 0681 587-2000 · kundenservice@stadtwerke-sb.de · www.stadtwerke-sb.de']
doc(L, T(type='rechnung', sender='Stadtwerke Saarbrücken GmbH', recipient=p[1], date='2026-10-06', kundennummer='400 128 776', rechnungsnummer='SR-2026-0098812',
         vertragsnummer='2200 4711 03', betrag=128.01, iban=ib, bic='SAKSDE55XXX', due='2026-10-27', phone='0681 587-2000', email='kundenservice@stadtwerke-sb.de'), image=True)

# r02 Gas – Guthaben
p = person(1)
L = Letter('r02')
L.head = [('Berliner Gaswerke AG', 14, True), ('Netz und Vertrieb', 8, False)]
L.head_right = True
L.ret = 'Berliner Gaswerke AG, Postfach 11 22 33, 10101 Berlin'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Ihre Kundennummer', '7781 2290'), ('Rechnungsdatum', '18.09.2026'), ('Rechnungs-Nr.', 'GA 55120933')]
L.subject = 'Ihre Gas-Jahresrechnung 2025/2026'
L.body = ['Sehr geehrte Frau Beispiel,', 'Ihre Verbrauchsabrechnung für den Zeitraum 15.08.2025 - 14.08.2026 schließt mit einem Guthaben ab.',
          ('table', [['', '', 'EUR'], ['Gesamtbetrag brutto', '', '1.311,24'], ['Ihre Abschlagszahlungen', '', '1.440,00'], ['Guthaben', '', '128,76']], [120, 0, 40]),
          'Das Guthaben in Höhe von 128,76 € erstatten wir Ihnen in den nächsten Tagen auf Ihr Konto DE12 **** **** **** 4401.',
          'Freundliche Grüße', 'Berliner Gaswerke AG']
L.footer = ['Berliner Gaswerke AG · Vorstand: Petra Licht · Sitz Berlin · HRB 99887 B · Service-Hotline 030 4455 6677 · service@berliner-gaswerke.de']
doc(L, T(type='rechnung', sender='Berliner Gaswerke AG', recipient=p[1], date='2026-09-18', kundennummer='7781 2290', rechnungsnummer='GA 55120933',
         betrag=128.76, phone='030 4455 6677', email='service@berliner-gaswerke.de'))

# r03 Wasser – zahlbar innerhalb von 14 Tagen
p = person(2); ib = iban_de(37050198, 98765432)
L = Letter('r03')
L.head = [('Wasserverband Rheinland', 15, True), ('Körperschaft des öffentlichen Rechts', 8, False)]
L.ret = 'Wasserverband Rheinland · Uferstraße 20 · 50668 Köln'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kunden-Nr.:', 'WV-338812'), ('Rechnung Nr.:', '2026/41177'), ('Datum:', '01.10.2026')]
L.subject = 'Rechnung Trinkwasser und Abwasser 3. Quartal 2026'
L.body = ['Sehr geehrter Herr Weber,', 'wir berechnen Ihnen für das 3. Quartal 2026 folgende Leistungen:',
          ('table', [['Leistung', 'Netto', 'Brutto'], ['Trinkwasser 31 m³', '68,20', '72,97'], ['Abwasser 31 m³', '79,05', '79,05'], ['Gesamtbetrag', '', '152,02 €']], [110, 25, 25]),
          'Der Rechnungsbetrag ist zahlbar innerhalb von 14 Tagen nach Rechnungsdatum ohne Abzug.',
          f'Bitte überweisen Sie auf: Sparkasse KölnBonn, IBAN {fmt_iban(ib)}, BIC COLSDE33XXX.', 'Mit freundlichen Grüßen', 'Wasserverband Rheinland']
L.footer = ['Wasserverband Rheinland · Tel. 0221 2345 678 · info@wasserverband-rheinland.de · Steuernummer 214/5734/0011']
doc(L, T(type='rechnung', sender='Wasserverband Rheinland', recipient=p[1], date='2026-10-01', kundennummer='WV-338812', rechnungsnummer='2026/41177',
         betrag=152.02, iban=ib, bic='COLSDE33XXX', due='2026-10-15', phone='0221 2345 678', email='info@wasserverband-rheinland.de', steuernummer='214/5734/0011'), image=True)

# r04 Mobilfunk – Lastschrift
p = person(3)
L = Letter('r04')
L.head = [('FunkNetz Mobil GmbH', 16, True)]
L.ret = 'FunkNetz Mobil GmbH | Postfach 40 10 20 | 80001 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kundennummer', '1029384756'), ('Rechnungsnummer', '8800 1234 5678'), ('Rechnungsdatum', '05.10.2026'), ('Ihre Rufnummer', '0170 1234567')]
L.title = 'Rechnung Oktober 2026'
L.body = ['Guten Tag Frau Schmitt,', 'hier ist Ihre Rechnung für den Zeitraum 01.10.2026 - 31.10.2026.',
          ('table', [['Leistung', '', 'Betrag'], ['Tarif FunkNetz Allnet M (Grundgebühr)', '', '24,99 €'], ['Roaming EU', '', '0,00 €'], ['Rechnungsbetrag', '', '24,99 €']], [120, 0, 40]),
          'Der Rechnungsbetrag von 24,99 € wird am 20.10.2026 per SEPA-Lastschrift von Ihrem Konto DE44 **** **** **** 7788 abgebucht.',
          'Gläubiger-ID: DE98ZZZ09999999999 · Mandatsreferenz: FNM-1029384756', 'Fragen? Rufen Sie uns an unter 089 998877-0.', 'Ihr FunkNetz-Team']
L.footer = ['FunkNetz Mobil GmbH · Sitz München · Registergericht München HRB 778899 · Geschäftsführung: Kai Netz · www.funknetz-mobil.de · hilfe@funknetz-mobil.de']
doc(L, T(type='rechnung', sender='FunkNetz Mobil GmbH', recipient=p[1], date='2026-10-05', kundennummer='1029384756', rechnungsnummer='8800 1234 5678',
         betrag=24.99, phone='089 998877-0', email='hilfe@funknetz-mobil.de'))

# r05 DSL – tabular info block
p = person(4); ib = iban_de(20050550, 1234567890)
L = Letter('r05')
L.head = [('HanseNet Kabel GmbH', 14, True), ('Glasfaser · Internet · TV', 8, False)]
L.ret = 'HanseNet Kabel GmbH · Speicherstadt 1 · 20457 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Datum:', '02.10.2026'), ('Kd.-Nr.:', 'HN-77120'), ('Re.-Nr.:', 'HN26-100233')]
L.subject = 'Rechnung für Internet-Anschluss'
L.body = ['Sehr geehrter Herr Yilmaz,', 'vielen Dank für Ihr Vertrauen. Wir berechnen:',
          ('table', [['Pos.', 'Zeitraum', 'Betrag'], ['Internet 500 Flat', '10/2026', '39,95'], ['Router-Miete', '10/2026', '4,99'], ['Zwischensumme netto', '', '37,76'], ['zzgl. 19 % USt.', '', '7,18'], ['Gesamtbetrag', '', '44,94 EUR']], [100, 30, 30]),
          'Bitte überweisen Sie den Gesamtbetrag bis spätestens 16.10.2026.', f'Hamburger Sparkasse · IBAN: {fmt_iban(ib)} · BIC: HASPDEHHXXX',
          'Mit freundlichen Grüßen', 'HanseNet Kabel GmbH']
L.footer = ['HanseNet Kabel GmbH · Service: 040 30 30 30 · service@hansenet-kabel.de · USt-IdNr. DE123456789']
doc(L, T(type='rechnung', sender='HanseNet Kabel GmbH', recipient=p[1], date='2026-10-02', kundennummer='HN-77120', rechnungsnummer='HN26-100233',
         betrag=44.94, iban=ib, bic='HASPDEHHXXX', due='2026-10-16', phone='040 30 30 30', email='service@hansenet-kabel.de'))

# r06 Online-Shop Laptop (Arbeitsmittel)
p = person(5); ib = iban_de(60050101, 7766554433)
L = Letter('r06')
L.head = [('Technikhaus Online GmbH', 14, True)]
L.head_right = True
L.ret = 'Technikhaus Online GmbH · Königstraße 1 · 70173 Stuttgart'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnungsnummer:', 'TH-2026-55871'), ('Kundennummer:', '993311'), ('Bestellnummer:', 'B-88231'), ('Rechnungsdatum:', '30.09.2026')]
L.title = 'Rechnung'
L.body = ['Sehr geehrte Frau Krämer,', 'vielen Dank für Ihre Bestellung. Wir berechnen Ihnen:',
          ('table', [['Artikel', 'Menge', 'Preis'], ['Notebook ProBook 14 Zoll, 16 GB RAM', '1', '899,00 €'], ['Versand', '1', '0,00 €'], ['Nettobetrag', '', '755,46 €'], ['19 % MwSt.', '', '143,54 €'], ['Gesamtbetrag', '', '899,00 €']], [110, 20, 30]),
          'Zahlungsziel: 14.10.2026. Zahlungsart: Kauf auf Rechnung (Überweisung).', f'Bankverbindung: BW-Bank, IBAN {fmt_iban(ib)}, BIC SOLADEST600',
          'Bitte geben Sie als Verwendungszweck die Rechnungsnummer TH-2026-55871 an.', 'Ihr Technikhaus-Team']
L.footer = ['Technikhaus Online GmbH · HRB 776655 Stuttgart · Tel. 0711 9988776 · rechnung@technikhaus-online.de']
doc(L, T(type='rechnung', sender='Technikhaus Online GmbH', recipient=p[1], date='2026-09-30', kundennummer='993311', rechnungsnummer='TH-2026-55871', betrag=899.00,
         iban=ib, bic='SOLADEST600', due='2026-10-14', phone='0711 9988776', email='rechnung@technikhaus-online.de',
         tax=dict(total=899.00, vat19=143.54, net=755.46, payment='ueberweisung', category='arbeitsmittel', labor=None, merchant='Technikhaus Online GmbH', date='2026-09-30')), image=True)

# r07 Arztrechnung GOÄ
p = person(0); ib = iban_de(59050101, 55443322)
L = Letter('r07')
L.head = [('Praxis Dr. med. Anna Sommer', 13, True), ('Fachärztin für Innere Medizin', 9, False), ('Marktplatz 4 · 66111 Saarbrücken · Tel. 0681 334455', 8, False)]
L.ret = 'Praxis Dr. med. Anna Sommer · Marktplatz 4 · 66111 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnungs-Nr.:', '2026-0712'), ('Datum:', '08.10.2026'), ('Patient:', p[1])]
L.subject = 'Privatliquidation nach GOÄ'
L.body = ['Sehr geehrter Herr Mustermann,', 'für meine ärztlichen Leistungen erlaube ich mir zu berechnen:',
          ('table', [['GOÄ-Ziffer', 'Faktor', 'Betrag'], ['1 Beratung', '2,3', '10,72 €'], ['5 Untersuchung', '2,3', '10,72 €'], ['250 Blutentnahme', '1,8', '4,20 €'], ['Rechnungsbetrag', '', '25,64 €']], [100, 30, 30]),
          'Bitte begleichen Sie den Betrag innerhalb von 30 Tagen nach Rechnungsdatum.', f'Konto: IBAN {fmt_iban(ib)} · BIC SAKSDE55XXX', 'Mit freundlichen Grüßen', 'Dr. med. Anna Sommer']
L.footer = ['Steuernummer 040/123/45678 · praxis@dr-sommer-sb.de']
doc(L, T(type='rechnung', sender='Praxis Dr. med. Anna Sommer', recipient=p[1], date='2026-10-08', rechnungsnummer='2026-0712', betrag=25.64, iban=ib, bic='SAKSDE55XXX',
         due='2026-11-07', phone='0681 334455', email='praxis@dr-sommer-sb.de', steuernummer='040/123/45678',
         tax=dict(total=25.64, vat19=None, net=None, payment='ueberweisung', category='krankheit', labor=None, merchant='Praxis Dr. med. Anna Sommer', date='2026-10-08')))

# r08 Handwerker Sanitär mit Arbeitskosten
p = person(1); ib = iban_de(10050000, 6603308766)
L = Letter('r08')
L.head = [('Klempnerei Wasserfall GmbH', 14, True), ('Meisterbetrieb für Sanitär und Heizung', 8, False)]
L.ret = 'Klempnerei Wasserfall GmbH · Torstraße 77 · 10119 Berlin'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnung Nr.', 'RE-2026-341'), ('Kunden-Nr.', 'K-1188'), ('Datum', '22.09.2026'), ('Leistungsdatum', '18.09.2026')]
L.subject = 'Rechnung Reparatur Badarmatur und Spülkasten'
L.body = ['Sehr geehrte Frau Beispiel,', 'für die ausgeführten Arbeiten in Ihrer Wohnung berechnen wir:',
          ('table', [['Position', 'Menge', 'Netto'], ['Arbeitszeit Monteur', '3 Std.', '195,00 €'], ['Anfahrt', '1', '35,00 €'], ['Material Armatur', '1', '142,00 €'],
                     ['Summe netto', '', '372,00 €'], ['19 % MwSt.', '', '70,68 €'], ['Gesamtbetrag', '', '442,68 €']], [110, 20, 30]),
          'Davon Arbeits- und Fahrtkosten (brutto, für § 35a EStG): 273,70 €',
          'Zahlbar innerhalb von 14 Tagen ohne Abzug.', f'Berliner Sparkasse · IBAN {fmt_iban(ib)} · BIC BELADEBEXXX', 'Mit freundlichen Grüßen', 'Klempnerei Wasserfall GmbH']
L.footer = ['Klempnerei Wasserfall GmbH · Tel. 030 1122334 · info@klempnerei-wasserfall.de · Amtsgericht Charlottenburg HRB 12345']
doc(L, T(type='rechnung', sender='Klempnerei Wasserfall GmbH', recipient=p[1], date='2026-09-22', kundennummer='K-1188', rechnungsnummer='RE-2026-341', betrag=442.68, iban=ib, bic='BELADEBEXXX',
         due='2026-10-06', phone='030 1122334', email='info@klempnerei-wasserfall.de',
         tax=dict(total=442.68, vat19=70.68, net=372.00, payment='ueberweisung', category='handwerker', labor=273.70, merchant='Klempnerei Wasserfall GmbH', date='2026-09-22')), image=True)

# r09 Maler mit Lohnkosten
p = person(3); ib = iban_de(70150000, 1002003004)
L = Letter('r09')
L.head = [('Malerbetrieb Farbenfroh', 15, True), ('Inh. Thomas Pinsel · Isarweg 5 · 80469 München', 8, False)]
L.ret = 'Malerbetrieb Farbenfroh · Isarweg 5 · 80469 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnungsnummer', '2026-118'), ('Rechnungsdatum', '12.08.2026')]
L.subject = 'Rechnung Malerarbeiten Wohnzimmer und Flur'
L.body = ['Sehr geehrte Frau Schmitt,', 'wir bedanken uns für Ihren Auftrag.',
          ('table', [['Leistung', '', 'Betrag'], ['Lohnkosten 16 Std. à 52,00 €', '', '832,00 €'], ['Material (Farbe, Abdeckung)', '', '187,50 €'], ['Nettobetrag', '', '1.019,50 €'], ['Umsatzsteuer 19 %', '', '193,71 €'], ['Rechnungsbetrag', '', '1.213,21 €']], [120, 0, 40]),
          'Im Rechnungsbetrag sind Lohnkosten in Höhe von 990,08 € (inkl. USt.) enthalten.',
          'Bitte überweisen Sie den Betrag bis zum 26.08.2026.', f'Stadtsparkasse München · IBAN {fmt_iban(ib)} · BIC SSKMDEMMXXX', 'Mit freundlichen Grüßen', 'Thomas Pinsel']
L.footer = ['Malerbetrieb Farbenfroh · Tel. 089 445566 · St.-Nr. 143/222/33344']
doc(L, T(type='rechnung', sender='Malerbetrieb Farbenfroh', recipient=p[1], date='2026-08-12', rechnungsnummer='2026-118', betrag=1213.21, iban=ib, bic='SSKMDEMMXXX', due='2026-08-26',
         phone='089 445566', steuernummer='143/222/33344',
         tax=dict(total=1213.21, vat19=193.71, net=1019.50, payment='ueberweisung', category='handwerker', labor=990.08, merchant='Malerbetrieb Farbenfroh', date='2026-08-12')))

# r10 Nebenkostenabrechnung Hausverwaltung
p = person(4); ib = iban_de(20050550, 9988776655)
L = Letter('r10')
L.head = [('Hausverwaltung Nordlicht GmbH', 14, True)]
L.ret = 'Hausverwaltung Nordlicht GmbH · Alsterufer 8 · 20354 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Objekt:', 'Bahnhofstraße 9'), ('Mieternummer:', '009-14'), ('Datum:', '15.09.2026')]
L.subject = 'Betriebskostenabrechnung für das Jahr 2025'
L.body = ['Sehr geehrter Herr Yilmaz,', 'anbei erhalten Sie die Nebenkostenabrechnung für den Zeitraum 01.01.2025 bis 31.12.2025.',
          ('table', [['Kostenart', '', 'Ihr Anteil'], ['Heizung und Warmwasser', '', '812,40 €'], ['Treppenhausreinigung', '', '96,00 €'], ['Gartenpflege', '', '54,30 €'], ['Müllabfuhr', '', '120,15 €'],
                     ['Summe', '', '1.082,85 €'], ['geleistete Vorauszahlungen', '', '960,00 €'], ['Nachzahlung', '', '122,85 €']], [120, 0, 40]),
          'Bitte zahlen Sie die Nachzahlung in Höhe von 122,85 € innerhalb von 30 Tagen nach Zugang dieser Abrechnung.', f'Konto: Haspa · IBAN {fmt_iban(ib)}',
          'Mit freundlichen Grüßen', 'Hausverwaltung Nordlicht GmbH']
L.footer = ['Hausverwaltung Nordlicht GmbH · Tel. 040 777888 · verwaltung@nordlicht-hv.de']
doc(L, T(type='rechnung', sender='Hausverwaltung Nordlicht GmbH', recipient=p[1], date='2026-09-15', betrag=122.85, iban=ib, due='2026-10-18', phone='040 777888', email='verwaltung@nordlicht-hv.de'))

# r11 Kita
p = person(5); ib = iban_de(60050101, 2223334445)
L = Letter('r11')
L.head = [('Kita Sonnenschein e.V.', 14, True), ('Kindertagesstätte · Parkstraße 3 · 70174 Stuttgart', 8, False)]
L.ret = 'Kita Sonnenschein e.V. · Parkstraße 3 · 70174 Stuttgart'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnungs-Nr.:', 'KS-2026-10-17'), ('Datum:', '01.10.2026'), ('Kind:', 'Mia Krämer')]
L.subject = 'Rechnung Betreuungsbeitrag Oktober 2026'
L.body = ['Liebe Frau Krämer,', 'für die Betreuung Ihres Kindes im Oktober 2026 berechnen wir:',
          ('table', [['Leistung', '', 'Betrag'], ['Betreuungsbeitrag (Ganztag)', '', '285,00 €'], ['Verpflegungspauschale', '', '65,00 €'], ['Gesamtbetrag', '', '350,00 €']], [120, 0, 40]),
          'Der Betrag ist zahlbar bis zum 10.10.2026.', f'Volksbank Stuttgart · IBAN {fmt_iban(ib)}', 'Herzliche Grüße', 'Ihr Kita-Team Sonnenschein']
L.footer = ['Kita Sonnenschein e.V. · Vereinsregister Stuttgart VR 4455 · Tel. 0711 223344 · leitung@kita-sonnenschein.de']
doc(L, T(type='rechnung', sender='Kita Sonnenschein e.V.', recipient=p[1], date='2026-10-01', rechnungsnummer='KS-2026-10-17', betrag=350.00, iban=ib, due='2026-10-10', phone='0711 223344',
         email='leitung@kita-sonnenschein.de', tax=dict(total=350.00, vat19=None, net=None, payment='ueberweisung', category='kinderbetreuung', labor=None, merchant='Kita Sonnenschein e.V.', date='2026-10-01')))

# r12 Fortbildung
p = person(2); ib = iban_de(37050198, 4455667788)
L = Letter('r12')
L.head = [('Rheinische Akademie für Weiterbildung GmbH', 13, True)]
L.ret = 'Rheinische Akademie für Weiterbildung GmbH · Domplatz 2 · 50667 Köln'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnungsnummer:', 'RAW-26-0451'), ('Teilnehmer-Nr.:', 'T-2231'), ('Datum:', '20.07.2026')]
L.subject = 'Rechnung Seminar „Projektmanagement kompakt“'
L.body = ['Sehr geehrter Herr Weber,', 'für Ihre Teilnahme an unserem Seminar am 14. und 15. Juli 2026 berechnen wir:',
          ('table', [['Leistung', '', 'Betrag'], ['Seminargebühr', '', '590,00 €'], ['Seminarunterlagen', '', '0,00 €'], ['Netto', '', '590,00 €'], ['zzgl. 19 % MwSt.', '', '112,10 €'], ['Gesamtbetrag', '', '702,10 €']], [120, 0, 40]),
          'Zahlbar innerhalb von 14 Tagen.', f'Kreissparkasse Köln · IBAN {fmt_iban(ib)}', 'Mit freundlichen Grüßen', 'Rheinische Akademie für Weiterbildung GmbH']
L.footer = ['Tel. 0221 998877 · seminare@rheinische-akademie.de']
doc(L, T(type='rechnung', sender='Rheinische Akademie für Weiterbildung GmbH', recipient=p[1], date='2026-07-20', rechnungsnummer='RAW-26-0451', betrag=702.10, iban=ib, due='2026-08-03',
         phone='0221 998877', email='seminare@rheinische-akademie.de',
         tax=dict(total=702.10, vat19=112.10, net=590.00, payment='ueberweisung', category='fortbildung', labor=None, merchant='Rheinische Akademie für Weiterbildung GmbH', date='2026-07-20')))

# r13 Gartenpflege (haushaltsnah)
p = person(0); ib = iban_de(59050101, 3344556677)
L = Letter('r13')
L.head = [('GrünService Saar GmbH', 14, True), ('Garten- und Landschaftsbau', 8, False)]
L.ret = 'GrünService Saar GmbH · Am Staden 15 · 66121 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnung Nr.:', 'GS-2026-1902'), ('Datum:', '30.06.2026')]
L.subject = 'Rechnung Gartenpflege Juni 2026'
L.body = ['Sehr geehrter Herr Mustermann,', 'für die Gartenpflege (Rasen mähen, Hecke schneiden) berechnen wir:',
          ('table', [['Leistung', '', 'Betrag'], ['Arbeitskosten 6 Std.', '', '240,00 €'], ['Entsorgung Grünschnitt', '', '30,00 €'], ['Summe netto', '', '270,00 €'], ['19 % USt.', '', '51,30 €'], ['Gesamtbetrag', '', '321,30 €']], [120, 0, 40]),
          'Anteil Arbeitskosten inkl. USt.: 285,60 €', 'Bitte überweisen Sie den Betrag bis zum 14.07.2026.', f'IBAN {fmt_iban(ib)} · Sparkasse Saarbrücken',
          'Mit freundlichen Grüßen', 'GrünService Saar GmbH']
L.footer = ['GrünService Saar GmbH · Tel. 0681 5566778 · auftrag@gruenservice-saar.de']
doc(L, T(type='rechnung', sender='GrünService Saar GmbH', recipient=p[1], date='2026-06-30', rechnungsnummer='GS-2026-1902', betrag=321.30, iban=ib, due='2026-07-14', phone='0681 5566778',
         email='auftrag@gruenservice-saar.de', tax=dict(total=321.30, vat19=51.30, net=270.00, payment='ueberweisung', category='haushaltsnah', labor=285.60, merchant='GrünService Saar GmbH', date='2026-06-30')))

# ================================================================== MAHNUNGEN
# m01 Versandhändler 1. Mahnung
p = person(1); ib = iban_de(10070000, 1239876)
L = Letter('m01')
L.head = [('ModeVersand24 GmbH', 15, True)]
L.ret = 'ModeVersand24 GmbH · Friedrichstraße 100 · 10117 Berlin'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kundennummer:', 'MV-552210'), ('Rechnungsnummer:', 'MV-R-778812'), ('Datum:', '09.10.2026')]
L.title = '1. Mahnung'
L.body = ['Sehr geehrte Frau Beispiel,', 'leider konnten wir für unsere Rechnung MV-R-778812 vom 01.09.2026 über 89,90 € bisher keinen Zahlungseingang feststellen.',
          ('table', [['', '', 'Betrag'], ['Rechnungsbetrag', '', '89,90 €'], ['Mahngebühr', '', '2,50 €'], ['Offener Betrag', '', '92,40 €']], [120, 0, 40]),
          'Bitte überweisen Sie den offenen Betrag bis zum 23.10.2026.', f'Deutsche Bank · IBAN {fmt_iban(ib)} · BIC DEUTDEBBXXX',
          'Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.', 'Mit freundlichen Grüßen', 'Ihr ModeVersand24-Kundenservice']
L.footer = ['ModeVersand24 GmbH · Tel. 030 55667788 · buchhaltung@modeversand24.de · HRB 12121 B']
doc(L, T(type='mahnung', sender='ModeVersand24 GmbH', recipient=p[1], date='2026-10-09', kundennummer='MV-552210', rechnungsnummer='MV-R-778812', betrag=92.40, iban=ib, bic='DEUTDEBBXXX',
         due='2026-10-23', phone='030 55667788', email='buchhaltung@modeversand24.de'), image=True)

# m02 Inkasso
p = person(2); ib = iban_de(30050110, 5550001112)
L = Letter('m02')
L.head = [('Westdeutsche Forderungsmanagement GmbH', 13, True), ('Inkassodienstleister', 8, False)]
L.ret = 'Westdeutsche Forderungsmanagement GmbH · Königsallee 50 · 40212 Düsseldorf'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Aktenzeichen:', 'WFM 26/88123'), ('Auftraggeber:', 'Sportwelt Online'), ('Datum:', '07.10.2026')]
L.subject = 'Zahlungsaufforderung – Forderung der Sportwelt Online GmbH'
L.body = ['Sehr geehrter Herr Weber,', 'unsere Mandantin hat uns mit dem Einzug der folgenden Forderung beauftragt:',
          ('table', [['', '', 'EUR'], ['Hauptforderung (Rechnung 44120)', '', '149,99'], ['Mahnkosten Auftraggeber', '', '5,00'], ['Inkassokosten', '', '58,50'], ['Gesamtforderung', '', '213,49']], [120, 0, 40]),
          'Bitte zahlen Sie die Gesamtforderung innerhalb von 7 Tagen auf das unten genannte Konto. Geben Sie bei der Zahlung unbedingt das Aktenzeichen WFM 26/88123 an.',
          f'Stadtsparkasse Düsseldorf · IBAN: {fmt_iban(ib)} · BIC: DUSSDEDDXXX', 'Mit freundlichen Grüßen', 'Westdeutsche Forderungsmanagement GmbH']
L.footer = ['Registriert nach § 10 RDG · Tel. 0211 3344550 · service@wfm-inkasso.de']
doc(L, T(type='mahnung', sender='Westdeutsche Forderungsmanagement GmbH', recipient=p[1], date='2026-10-07', aktenzeichen='WFM 26/88123', rechnungsnummer='44120', betrag=213.49, iban=ib, bic='DUSSDEDDXXX', due='2026-10-14',
         phone='0211 3344550', email='service@wfm-inkasso.de'))

# m03 Zahlungserinnerung Zahnarzt
p = person(3); ib = iban_de(70150000, 7788990011)
L = Letter('m03')
L.head = [('Zahnarztpraxis Dr. Lächeln', 14, True), ('Leopoldstraße 20 · 80802 München', 8, False)]
L.ret = 'Zahnarztpraxis Dr. Lächeln · Leopoldstraße 20 · 80802 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Rechnungsnummer:', 'Z-2026-0388'), ('Datum:', '28.09.2026')]
L.title = 'Zahlungserinnerung'
L.body = ['Sehr geehrte Frau Schmitt,', 'sicher ist es Ihrer Aufmerksamkeit entgangen: Unsere Rechnung Z-2026-0388 vom 10.08.2026 ist noch offen.',
          'Offener Betrag: 312,40 €', 'Wir bitten Sie, den Betrag bis zum 12.10.2026 zu überweisen.', f'IBAN {fmt_iban(ib)} · BIC SSKMDEMMXXX',
          'Mit freundlichen Grüßen', 'Ihr Praxisteam']
L.footer = ['Zahnarztpraxis Dr. Lächeln · Tel. 089 3344556 · abrechnung@dr-laecheln.de']
doc(L, T(type='mahnung', sender='Zahnarztpraxis Dr. Lächeln', recipient=p[1], date='2026-09-28', rechnungsnummer='Z-2026-0388', betrag=312.40, iban=ib, bic='SSKMDEMMXXX', due='2026-10-12',
         phone='089 3344556', email='abrechnung@dr-laecheln.de'))

# m04 Stadtwerke letzte Mahnung
p = person(0); ib = iban_de(59050101, 12345678)
L = Letter('m04')
L.head = [('Stadtwerke Saarbrücken GmbH', 15, True)]
L.ret = 'Stadtwerke Saarbrücken GmbH · Hohenzollernstraße 104 · 66117 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kundennummer:', '400 128 776'), ('Datum:', '13.10.2026')]
L.title = 'Letzte Mahnung'
L.body = ['Sehr geehrter Herr Mustermann,', 'trotz unserer Zahlungserinnerung ist der Abschlag für September 2026 weiterhin offen.',
          ('table', [['', '', 'Betrag'], ['Abschlag September 2026', '', '85,00 €'], ['Mahnkosten', '', '3,00 €'], ['Noch offen', '', '88,00 €']], [120, 0, 40]),
          'Bitte zahlen Sie den offenen Betrag innerhalb von 10 Tagen. Andernfalls müssen wir die Unterbrechung der Versorgung einleiten.',
          f'IBAN {fmt_iban(ib)} · BIC SAKSDE55XXX', 'Mit freundlichen Grüßen', 'Stadtwerke Saarbrücken GmbH']
L.footer = ['Kundenservice: 0681 587-2000 · kundenservice@stadtwerke-sb.de']
doc(L, T(type='mahnung', sender='Stadtwerke Saarbrücken GmbH', recipient=p[1], date='2026-10-13', kundennummer='400 128 776', betrag=88.00, iban=ib, bic='SAKSDE55XXX', due='2026-10-23',
         phone='0681 587-2000', email='kundenservice@stadtwerke-sb.de'))

# ================================================================== BESCHEIDE
# b01 Finanzamt ESt Nachzahlung
p = person(0); ib = iban_de(59000000, 59001500)
L = Letter('b01')
L.head = [('Finanzamt Saarbrücken Am Stadtgraben', 13, True)]
L.ret = 'Finanzamt Saarbrücken Am Stadtgraben · Am Stadtgraben 2-4 · 66111 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Steuernummer:', '040/123/45678'), ('Datum:', '06.10.2026'), ('Telefon:', '0681 3000-0')]
L.subject = 'Bescheid für 2025 über Einkommensteuer'
L.body = ['Festsetzung', ('table', [['', '', 'Euro'], ['Einkommensteuer', '', '6.412,00'], ['Solidaritätszuschlag', '', '0,00'], ['abzüglich Steuerabzug vom Lohn', '', '5.980,00'], ['Abrechnung: noch zu zahlen', '', '432,00']], [120, 0, 40]),
          'Bitte zahlen Sie den Betrag von 432,00 € spätestens bis zum 09.11.2026.',
          f'Bankverbindung des Finanzamts: Deutsche Bundesbank Filiale Saarbrücken, IBAN {fmt_iban(ib)}, BIC MARKDEF1590. Bitte geben Sie als Verwendungszweck Ihre Steuernummer an.',
          ('bold', 'Rechtsbehelfsbelehrung'),
          'Der Bescheid kann mit dem Einspruch angefochten werden. Der Einspruch ist beim Finanzamt Saarbrücken Am Stadtgraben schriftlich einzureichen. Die Frist für die Einlegung des Einspruchs beträgt einen Monat. Sie beginnt mit Ablauf des Tages, an dem Ihnen dieser Bescheid bekannt gegeben worden ist. Bei Zusendung durch einfachen Brief gilt die Bekanntgabe mit dem vierten Tag nach Aufgabe zur Post als bewirkt.']
L.footer = ['Finanzamt Saarbrücken Am Stadtgraben · Öffnungszeiten: Mo-Fr 8-12 Uhr']
doc(L, T(type='bescheid', sender='Finanzamt Saarbrücken Am Stadtgraben', recipient=p[1], date='2026-10-06', steuernummer='040/123/45678', betrag=432.00, iban=ib, bic='MARKDEF1590',
         due=rb_frist('2026-10-06'), phone='0681 3000-0'), image=True)

# b02 Finanzamt Erstattung
p = person(1)
L = Letter('b02')
L.head = [('Finanzamt Berlin Mitte/Tiergarten', 13, True)]
L.ret = 'Finanzamt Berlin Mitte/Tiergarten · Neue Jakobstraße 6-7 · 10179 Berlin'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Steuernummer', '34/567/89012'), ('Datum', '15.07.2026')]
L.subject = 'Bescheid für 2025 über Einkommensteuer und Solidaritätszuschlag'
L.body = ['Die Steuer wird festgesetzt auf 4.118,00 €.', ('table', [['', '', 'Euro'], ['festgesetzt', '', '4.118,00'], ['Steuerabzug vom Lohn', '', '4.889,00'], ['Erstattung', '', '771,00']], [120, 0, 40]),
          'Der Erstattungsbetrag von 771,00 € wird auf Ihr Konto DE21 **** **** **** 0099 überwiesen.',
          ('bold', 'Rechtsbehelfsbelehrung'), 'Gegen diesen Bescheid ist der Einspruch zulässig. Er ist innerhalb eines Monats nach Bekanntgabe dieses Bescheids beim Finanzamt einzulegen.']
L.footer = ['Finanzamt Berlin Mitte/Tiergarten · Telefon 030 9024-0']
doc(L, T(type='bescheid', sender='Finanzamt Berlin Mitte/Tiergarten', recipient=p[1], date='2026-07-15', steuernummer='34/567/89012', betrag=771.00, due=rb_frist('2026-07-15'), phone='030 9024-0'))

# b03 Rundfunkbeitrag Festsetzungsbescheid
p = person(2); ib = iban_de(37050299, 63100)
L = Letter('b03')
L.head = [('ARD ZDF Deutschlandradio Beitragsservice', 12, True)]
L.ret = 'ARD ZDF Deutschlandradio Beitragsservice · 50656 Köln'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Beitragsnummer:', '412 345 678'), ('Datum:', '01.09.2026')]
L.subject = 'Festsetzungsbescheid'
L.body = ['Sehr geehrter Herr Weber,', 'für den Zeitraum 01.04.2026 bis 30.06.2026 wurden Rundfunkbeiträge nicht gezahlt. Wir setzen daher fest:',
          ('table', [['', '', 'Betrag'], ['Rundfunkbeiträge', '', '55,08 €'], ['Säumniszuschlag', '', '8,00 €'], ['Gesamt festgesetzt', '', '63,08 €']], [120, 0, 40]),
          'Bitte überweisen Sie den Betrag von 63,08 € unter Angabe Ihrer Beitragsnummer.', f'IBAN {fmt_iban(ib)} · BIC COKSDE33XXX',
          ('bold', 'Rechtsbehelfsbelehrung'), 'Gegen diesen Bescheid kann innerhalb eines Monats nach Bekanntgabe Widerspruch erhoben werden.']
L.footer = ['Beitragsservice · www.rundfunkbeitrag.de · Telefon 01806 999 555 10']
doc(L, T(type='bescheid', sender='ARD ZDF Deutschlandradio Beitragsservice', recipient=p[1], date='2026-09-01', aktenzeichen='412 345 678', betrag=63.08, iban=ib, bic='COKSDE33XXX', due=rb_frist('2026-09-01'),
         phone='01806 999 555 10'))

# b04 Wohngeld Bewilligung
p = person(3)
L = Letter('b04')
L.head = [('Landeshauptstadt München', 13, True), ('Sozialreferat · Wohngeldstelle', 9, False)]
L.ret = 'Landeshauptstadt München · Sozialreferat · Werinherstraße 89 · 81541 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Aktenzeichen:', 'WG-2026-33415'), ('Sachbearbeitung:', 'Frau Huber'), ('Telefon:', '089 233-12345'), ('Datum:', '23.09.2026')]
L.subject = 'Bescheid über die Bewilligung von Wohngeld'
L.body = ['Sehr geehrte Frau Schmitt,', 'auf Ihren Antrag vom 02.07.2026 wird Ihnen für den Bewilligungszeitraum 01.07.2026 bis 30.06.2027 Wohngeld in Höhe von monatlich 248,00 € bewilligt.',
          'Die Zahlung erfolgt monatlich im Voraus auf Ihr Konto.', 'Bitte reichen Sie den fehlenden Einkommensnachweis bis zum 15.11.2026 nach.',
          ('bold', 'Rechtsbehelfsbelehrung'), 'Gegen diesen Bescheid kann innerhalb eines Monats nach Bekanntgabe Widerspruch erhoben werden. Der Widerspruch ist schriftlich oder zur Niederschrift bei der Landeshauptstadt München, Sozialreferat, einzulegen.',
          'Mit freundlichen Grüßen', 'Landeshauptstadt München']
L.footer = ['wohngeld.soz@muenchen.de · Sprechzeiten Mo, Di, Do 8:30-12:00']
doc(L, T(type='bescheid', sender='Landeshauptstadt München', recipient=p[1], date='2026-09-23', aktenzeichen='WG-2026-33415', betrag=248.00, due=rb_frist('2026-09-23'), phone='089 233-12345', email='wohngeld.soz@muenchen.de'))

# b05 Bußgeldbescheid (2 Wochen nach Zustellung)
p = person(4); ib = iban_de(20050000, 1010101)
L = Letter('b05')
L.head = [('Freie und Hansestadt Hamburg', 13, True), ('Bußgeldstelle', 9, False)]
L.ret = 'Freie und Hansestadt Hamburg · Bußgeldstelle · Postfach 10 50 50 · 20034 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Aktenzeichen:', '701.26.123456.7'), ('Kassenzeichen:', '3001 2345 6789'), ('Datum:', '02.10.2026')]
L.subject = 'Bußgeldbescheid'
L.body = ['Sehr geehrter Herr Yilmaz,', 'Ihnen wird vorgeworfen, am 14.08.2026 die zulässige Höchstgeschwindigkeit innerorts um 16 km/h überschritten zu haben.',
          ('table', [['', '', 'Betrag'], ['Geldbuße', '', '70,00 €'], ['Gebühren und Auslagen', '', '28,50 €'], ['Gesamtbetrag', '', '98,50 €']], [120, 0, 40]),
          'Der Gesamtbetrag ist spätestens zwei Wochen nach Rechtskraft zu zahlen.', f'IBAN {fmt_iban(ib)} · BIC HASPDEHHXXX · Kassenzeichen angeben',
          ('bold', 'Rechtsbehelfsbelehrung'), 'Gegen diesen Bescheid kann innerhalb von zwei Wochen nach Zustellung Einspruch eingelegt werden.']
L.footer = ['Bußgeldstelle Hamburg · Tel. 040 42841-0']
doc(L, T(type='bescheid', sender='Freie und Hansestadt Hamburg', recipient=p[1], date='2026-10-02', aktenzeichen='701.26.123456.7', betrag=98.50, iban=ib, bic='HASPDEHHXXX',
         due=rb_frist('2026-10-02', weeks=2), phone='040 42841-0'))

# b06 Familienkasse Kindergeld
p = person(5)
L = Letter('b06')
L.head = [('Bundesagentur für Arbeit', 12, True), ('Familienkasse Baden-Württemberg West', 9, False)]
L.ret = 'Familienkasse Baden-Württemberg West · 76124 Karlsruhe'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kindergeld-Nr.:', '215FK123456'), ('Datum:', '04.08.2026')]
L.subject = 'Bescheid über Kindergeld'
L.body = ['Sehr geehrte Frau Krämer,', 'Ihnen wird Kindergeld für Ihr Kind Mia ab August 2026 in Höhe von monatlich 255,00 € festgesetzt.',
          ('bold', 'Rechtsbehelfsbelehrung'), 'Gegen diese Entscheidung kann innerhalb eines Monats nach Bekanntgabe Einspruch eingelegt werden.', 'Mit freundlichen Grüßen', 'Ihre Familienkasse']
L.footer = ['Servicerufnummer 0800 4 5555 30']
doc(L, T(type='bescheid', sender='Familienkasse Baden-Württemberg West', recipient=p[1], date='2026-08-04', betrag=255.00, due=rb_frist('2026-08-04'), phone='0800 4 5555 30'))

# ================================================================== VERTRÄGE
# v01 Kündigungsbestätigung Fitness
p = person(0)
L = Letter('v01')
L.head = [('FitPark Saar GmbH', 15, True)]
L.ret = 'FitPark Saar GmbH · Dudweilerstraße 50 · 66111 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Mitgliedsnummer:', '100-4471'), ('Datum:', '10.10.2026')]
L.subject = 'Kündigungsbestätigung'
L.body = ['Hallo Herr Mustermann,', 'wir haben Ihre Kündigung vom 02.10.2026 erhalten. Ihre Mitgliedschaft endet zum 31.03.2027.',
          'Bis dahin können Sie unser Studio wie gewohnt nutzen. Der monatliche Beitrag von 34,90 € wird bis zum Vertragsende weiter per Lastschrift eingezogen.',
          'Schade, dass Sie gehen! Sportliche Grüße', 'Ihr FitPark-Team']
L.footer = ['FitPark Saar GmbH · Tel. 0681 9101112 · info@fitpark-saar.de']
doc(L, T(type='vertrag', sender='FitPark Saar GmbH', recipient=p[1], date='2026-10-10', kundennummer='100-4471', betrag=34.90, due='2027-03-31', phone='0681 9101112', email='info@fitpark-saar.de',
         contract=dict(cancelled=True, end='2027-03-31')), image=True)

# v02 Kündigungsbestätigung Zeitschrift
p = person(1)
L = Letter('v02')
L.head = [('Leseverlag Nord GmbH & Co. KG', 13, True), ('Abo-Service', 8, False)]
L.ret = 'Leseverlag Nord GmbH & Co. KG · Abo-Service · 20099 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Abo-Nr.:', 'AB 66 778 899'), ('Datum:', '03.10.2026')]
L.subject = 'Bestätigung Ihrer Kündigung'
L.body = ['Sehr geehrte Frau Beispiel,', 'hiermit bestätigen wir die Kündigung Ihres Abonnements „Wohnen & Garten“. Das Abonnement endet am 31.12.2026. Sie erhalten bis dahin alle Ausgaben.',
          'Mit freundlichen Grüßen', 'Ihr Abo-Service']
L.footer = ['Leseverlag Nord GmbH & Co. KG · abo@leseverlag-nord.de · Tel. 040 112233']
doc(L, T(type='vertrag', sender='Leseverlag Nord GmbH & Co. KG', recipient=p[1], date='2026-10-03', due='2026-12-31', phone='040 112233', email='abo@leseverlag-nord.de', vertragsnummer='AB 66 778 899',
         contract=dict(cancelled=True, end='2026-12-31')))

# v03 Handyvertrag Vertragsbestätigung (24 Monate)
p = person(2)
L = Letter('v03')
L.head = [('FunkNetz Mobil GmbH', 16, True)]
L.ret = 'FunkNetz Mobil GmbH | Postfach 40 10 20 | 80001 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kundennummer', '1029388811'), ('Vertragsnummer', 'V-77120-26'), ('Datum', '28.03.2025')]
L.subject = 'Ihre Vertragsbestätigung – Tarif FunkNetz Allnet L'
L.body = ['Willkommen bei FunkNetz, Herr Weber!', 'Ihr Tarif: FunkNetz Allnet L mit 40 GB. Monatliche Grundgebühr: 29,99 €.',
          'Vertragsbeginn: 01.04.2025. Mindestvertragslaufzeit: 24 Monate. Kündigungsfrist: 1 Monat zum Ende der Mindestvertragslaufzeit.',
          'Nach Ablauf der Mindestvertragslaufzeit verlängert sich der Vertrag auf unbestimmte Zeit und ist jederzeit mit einer Frist von einem Monat kündbar.',
          'Die Rechnungsbeträge werden per SEPA-Lastschrift eingezogen.', 'Ihr FunkNetz-Team']
L.footer = ['FunkNetz Mobil GmbH · Service 089 998877-0 · hilfe@funknetz-mobil.de']
doc(L, T(type='vertrag', sender='FunkNetz Mobil GmbH', recipient=p[1], date='2025-03-28', kundennummer='1029388811', vertragsnummer='V-77120-26', betrag=29.99, due='2027-02-28',
         phone='089 998877-0', email='hilfe@funknetz-mobil.de', contract=dict(cancelled=False, end='2027-03-31', notice='1 Monat')))

# v04 Stromvertrag 12 Monate + 12 Monate Verlängerung
p = person(3)
L = Letter('v04')
L.head = [('Isar Energie AG', 15, True)]
L.ret = 'Isar Energie AG · Energiestraße 1 · 80331 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kundennummer:', 'IE-4412-889'), ('Vertragskonto:', '6000 1122 33'), ('Datum:', '20.10.2025')]
L.subject = 'Auftragsbestätigung Stromlieferung – Tarif IsarStrom Fix 12'
L.body = ['Sehr geehrte Frau Schmitt,', 'vielen Dank für Ihren Auftrag. Wir beliefern Sie ab dem 01.11.2025 mit Strom.',
          'Vertragsbeginn: 01.11.2025 · Erstlaufzeit: 12 Monate · Kündigungsfrist: 6 Wochen zum Ende der Laufzeit. Der Vertrag verlängert sich automatisch um jeweils 12 Monate, wenn er nicht fristgerecht gekündigt wird.',
          'Ihr monatlicher Abschlag beträgt 72,00 €.', 'Mit freundlichen Grüßen', 'Isar Energie AG']
L.footer = ['Isar Energie AG · Kundenservice 0800 123 4567 · service@isar-energie.de']
doc(L, T(type='vertrag', sender='Isar Energie AG', recipient=p[1], date='2025-10-20', kundennummer='IE-4412-889', vertragsnummer='6000 1122 33', betrag=72.00, due='2027-09-19',
         phone='0800 123 4567', email='service@isar-energie.de', contract=dict(cancelled=False, end='2027-10-31', notice='6 Wochen')))

# v05 Fitness Vertrag 12 Monate, 3 Monate Frist, unbestimmt
p = person(4)
L = Letter('v05')
L.head = [('Elbe Fitness Club GmbH', 15, True)]
L.ret = 'Elbe Fitness Club GmbH · Hafenstraße 22 · 20359 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Mitgliedsnummer:', 'EF-30091'), ('Datum:', '01.10.2026')]
L.subject = 'Willkommen im Elbe Fitness Club – Ihre Mitgliedschaft'
L.body = ['Hallo Herr Yilmaz,', 'Beginn der Mitgliedschaft: 01.10.2026. Laufzeit: 12 Monate. Monatsbeitrag: 39,90 €.',
          'Die Kündigungsfrist beträgt 3 Monate zum Ende der Laufzeit. Danach verlängert sich die Mitgliedschaft auf unbestimmte Zeit und ist monatlich kündbar.',
          'Wir freuen uns auf Sie!', 'Ihr Team vom Elbe Fitness Club']
L.footer = ['Elbe Fitness Club GmbH · Tel. 040 5544332 · hallo@elbe-fitness.de']
doc(L, T(type='vertrag', sender='Elbe Fitness Club GmbH', recipient=p[1], date='2026-10-01', kundennummer='EF-30091', betrag=39.90, due='2027-06-30', phone='040 5544332', email='hallo@elbe-fitness.de',
         contract=dict(cancelled=False, end='2027-09-30', notice='3 Monate')))

# ================================================================== KONTOAUSZÜGE
p = person(0)
L = Letter('k01')
L.head = [('Sparkasse Saarbrücken', 15, True)]
L.ret = ''
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Kontoauszug', '10/2026'), ('Blatt', '1'), ('Datum', '01.10.2026'), ('IBAN', 'DE12 5905 0101 0000 1111 22')]
L.title = 'Kontoauszug'
L.body = [('table', [['Buchungstag', 'Vorgang', 'Betrag EUR'], ['01.09.2026', 'Gehalt Muster AG', '2.840,12'], ['02.09.2026', 'Lastschrift Stadtwerke', '-85,00'],
                     ['05.09.2026', 'Kartenzahlung Supermarkt', '-64,37'], ['15.09.2026', 'Dauerauftrag Miete', '-780,00'], ['30.09.2026', 'Lastschrift FitPark', '-34,90']], [40, 80, 40]),
          ('table', [['', '', ''], ['Alter Kontostand', '', '1.204,55'], ['Neuer Kontostand', '', '3.080,40']], [80, 40, 40])]
L.footer = ['Sparkasse Saarbrücken · Neumarkt 17 · 66117 Saarbrücken · BIC SAKSDE55XXX']
doc(L, T(type='kontoauszug', sender='Sparkasse Saarbrücken', recipient=p[1], date='2026-10-01', betrag=3080.40))

p = person(1)
L = Letter('k02')
L.head = [('Hauptstadtbank AG', 14, True), ('Online-Banking · Kontoauszug', 8, False)]
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Auszug Nr.', '9/2026'), ('Erstellt am', '30.09.2026')]
L.title = 'Kontoauszug September 2026'
L.body = [('table', [['Buchung', 'Valuta', 'Betrag'], ['Gutschrift Erstattung FA', '04.09.2026', '+771,00'], ['Lastschrift Berliner Gaswerke', '15.09.2026', '-120,00'], ['Überweisung Miete', '01.09.2026', '-950,00']], [80, 40, 40]),
          'Saldo alt: 2.410,10 EUR', 'Neuer Saldo: 2.111,10 EUR']
L.footer = ['Hauptstadtbank AG · Sitz Berlin · www.hauptstadtbank.de']
doc(L, T(type='kontoauszug', sender='Hauptstadtbank AG', recipient=p[1], date='2026-09-30', betrag=2111.10))

# ================================================================== LOHNABRECHNUNG
p = person(2)
L = Letter('l01')
L.head = [('Muster Logistik GmbH', 14, True), ('Personalabteilung', 8, False)]
L.ret = 'Muster Logistik GmbH · Industriestraße 5 · 50735 Köln'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Personalnummer:', '00471'), ('Abrechnungsmonat:', 'September 2026'), ('Datum:', '25.09.2026'), ('Steuerklasse:', '1')]
L.title = 'Entgeltabrechnung September 2026'
L.body = [('table', [['Bezüge', '', 'EUR'], ['Gehalt', '', '3.600,00'], ['Gesamtbrutto', '', '3.600,00'], ['Lohnsteuer', '', '-489,58'], ['Solidaritätszuschlag', '', '0,00'], ['Kirchensteuer', '', '-39,16'],
                     ['Krankenversicherung', '', '-293,40'], ['Rentenversicherung', '', '-334,80'], ['Arbeitslosenversicherung', '', '-46,80'], ['Pflegeversicherung', '', '-61,20'], ['Nettoverdienst', '', '2.335,06'], ['Auszahlungsbetrag', '', '2.335,06']], [120, 0, 40]),
          'Die Überweisung erfolgt auf Ihr Konto bei der Kreissparkasse Köln.']
L.footer = ['Muster Logistik GmbH · lohn@muster-logistik.de']
doc(L, T(type='lohnabrechnung', sender='Muster Logistik GmbH', recipient=p[1], date='2026-09-25', betrag=2335.06, email='lohn@muster-logistik.de'), image=True)

p = person(3)
L = Letter('l02')
L.head = [('Bayern Software AG', 14, True)]
L.ret = 'Bayern Software AG · Leopoldstraße 1 · 80802 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Pers.-Nr.:', '12-889'), ('Datum:', '28.08.2026')]
L.title = 'Gehaltsabrechnung August 2026'
L.body = [('table', [['', '', 'Betrag'], ['Grundgehalt', '', '4.950,00 €'], ['Steuerbrutto', '', '4.950,00 €'], ['Lohnsteuer', '', '-892,41 €'], ['Sozialversicherung gesamt', '', '-1.019,70 €'], ['Netto', '', '3.037,89 €'], ['Auszahlungsbetrag', '', '3.037,89 €']], [120, 0, 40])]
L.footer = ['Bayern Software AG · Personal: personal@bayern-software.de']
doc(L, T(type='lohnabrechnung', sender='Bayern Software AG', recipient=p[1], date='2026-08-28', betrag=3037.89, email='personal@bayern-software.de'))

# ================================================================== VERSICHERUNG
p = person(4)
L = Letter('i01')
L.head = [('Hanse Assekuranz AG', 14, True), ('Kraftfahrtversicherung', 8, False)]
L.ret = 'Hanse Assekuranz AG · Versicherungsallee 1 · 20095 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Versicherungsschein-Nr.:', 'KF-998877-12'), ('Datum:', '14.10.2026')]
L.subject = 'Beitragsrechnung Kfz-Versicherung 2027'
L.body = ['Sehr geehrter Herr Yilmaz,', 'für Ihre Kfz-Haftpflicht- und Teilkaskoversicherung (HH-MY 1234) berechnen wir für das Versicherungsjahr 01.01.2027 bis 31.12.2027:',
          ('table', [['', '', 'Beitrag'], ['Kfz-Haftpflicht', '', '412,30 €'], ['Teilkasko (SB 150 €)', '', '128,70 €'], ['Jahresbeitrag inkl. Versicherungsteuer', '', '541,00 €']], [120, 0, 40]),
          'Der Jahresbeitrag ist fällig am 01.01.2027 und wird per Lastschrift von Ihrem Konto eingezogen.',
          'Sie können den Vertrag mit einer Frist von einem Monat zum Ablauf des Versicherungsjahres kündigen.', 'Mit freundlichen Grüßen', 'Hanse Assekuranz AG']
L.footer = ['Hanse Assekuranz AG · Tel. 040 3333 4444 · kfz@hanse-assekuranz.de']
doc(L, T(type='versicherung', sender='Hanse Assekuranz AG', recipient=p[1], date='2026-10-14', vertragsnummer='KF-998877-12', betrag=541.00, phone='040 3333 4444', email='kfz@hanse-assekuranz.de',
         tax=dict(total=541.00, vat19=None, net=None, payment='lastschrift', category='versicherungen', labor=None, merchant='Hanse Assekuranz AG', date='2026-10-14')))

p = person(5); ib = iban_de(60050101, 8877665544)
L = Letter('i02')
L.head = [('Schwaben Versicherung VVaG', 14, True)]
L.ret = 'Schwaben Versicherung VVaG · Neckarstraße 1 · 70190 Stuttgart'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Versicherungsnummer:', 'HR 4410 2277'), ('Datum:', '02.10.2026')]
L.subject = 'Beitragsanpassung Ihrer Hausratversicherung'
L.body = ['Sehr geehrte Frau Krämer,', 'aufgrund gestiegener Schadenaufwendungen passen wir den Beitrag Ihrer Hausratversicherung zum 01.01.2027 an.',
          'Neuer Jahresbeitrag: 128,40 € (bisher 117,90 €).', 'Bitte überweisen Sie den Beitrag bis zum 01.01.2027.', f'IBAN {fmt_iban(ib)} · BIC SOLADEST600',
          'Sie haben ein Sonderkündigungsrecht innerhalb eines Monats nach Zugang dieser Mitteilung.', 'Mit freundlichen Grüßen', 'Schwaben Versicherung VVaG']
L.footer = ['Schwaben Versicherung VVaG · Tel. 0711 6655440 · service@schwaben-versicherung.de']
doc(L, T(type='versicherung', sender='Schwaben Versicherung VVaG', recipient=p[1], date='2026-10-02', vertragsnummer='HR 4410 2277', betrag=128.40, iban=ib, bic='SOLADEST600', due='2027-01-01',
         phone='0711 6655440', email='service@schwaben-versicherung.de'))

p = person(0)
L = Letter('i03')
L.head = [('Saar Haftpflicht AG', 14, True)]
L.ret = 'Saar Haftpflicht AG · Europaallee 3 · 66113 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Versicherungsschein-Nr.:', 'PH-55-0012345'), ('Datum:', '15.01.2026')]
L.title = 'Versicherungsschein'
L.subject = 'Privathaftpflichtversicherung Tarif Komfort'
L.body = ['Versicherungsnehmer: Max Mustermann', 'Versicherungsbeginn: 01.02.2026 · Vertragslaufzeit: 1 Jahr. Der Vertrag verlängert sich jeweils um ein Jahr, wenn er nicht drei Monate vor Ablauf gekündigt wird.',
          'Deckungssumme: 10 Mio. € pauschal · Selbstbeteiligung: 0 €', 'Jahresbeitrag: 59,90 € (inkl. Versicherungsteuer), zahlbar per Lastschrift.', 'Saar Haftpflicht AG']
L.footer = ['Saar Haftpflicht AG · Tel. 0681 400500 · vertrag@saar-haftpflicht.de']
doc(L, T(type='versicherung', sender='Saar Haftpflicht AG', recipient=p[1], date='2026-01-15', vertragsnummer='PH-55-0012345', betrag=59.90, due='2026-10-31', phone='0681 400500', email='vertrag@saar-haftpflicht.de',
         contract=dict(cancelled=False, end='2027-01-31', notice='3 Monate')))

# ================================================================== ARZT / KRANKENKASSE
p = person(1)
L = Letter('a01')
L.head = [('Gesundheitskasse Mitte', 14, True), ('Die Krankenkasse für Berlin', 8, False)]
L.ret = 'Gesundheitskasse Mitte · Alexanderplatz 1 · 10178 Berlin'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Versichertennummer:', 'A123456789'), ('Datum:', '11.09.2026')]
L.subject = 'Ihr Bonusprogramm 2026: 120 Euro für Ihre Gesundheit'
L.body = ['Liebe Frau Beispiel,', 'mit unserem Bonusprogramm belohnen wir Vorsorge: Lassen Sie die Gesundheitsuntersuchung und die Zahnvorsorge in Ihrer Praxis bestätigen.',
          'Reichen Sie das Bonusheft bis zum 31.01.2027 ein, und wir überweisen Ihnen bis zu 120,00 €.', 'Bleiben Sie gesund!', 'Ihre Gesundheitskasse Mitte']
L.footer = ['Gesundheitskasse Mitte · Servicetelefon 0800 2233445 · service@gesundheitskasse-mitte.de']
doc(L, T(type='arzt', sender='Gesundheitskasse Mitte', recipient=p[1], date='2026-09-11', betrag=None, due='2027-01-31', phone='0800 2233445', email='service@gesundheitskasse-mitte.de'))

p = person(2)
L = Letter('a02')
L.head = [('Radiologie am Dom', 14, True), ('Dr. med. Paul Röntgen · Dr. med. Lisa Bild', 8, False)]
L.ret = 'Radiologie am Dom · Domkloster 1 · 50667 Köln'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Patient:', 'Jonas Weber'), ('geb.:', '12.03.1988'), ('Datum:', '29.09.2026')]
L.subject = 'Befund MRT Kniegelenk rechts'
L.body = ['Sehr geehrter Herr Weber,', 'anbei erhalten Sie den Befund Ihrer Untersuchung vom 25.09.2026. Diagnose: Keine Hinweise auf eine Meniskusläsion.',
          'Bitte besprechen Sie das weitere Vorgehen mit Ihrer behandelnden Ärztin. Ihr Kontrolltermin: 20.11.2026, 10:30 Uhr.', 'Mit freundlichen Grüßen', 'Dr. med. Paul Röntgen']
L.footer = ['Radiologie am Dom · Tel. 0221 778899 · praxis@radiologie-am-dom.de']
doc(L, T(type='arzt', sender='Radiologie am Dom', recipient=p[1], date='2026-09-29', due='2026-11-20', phone='0221 778899', email='praxis@radiologie-am-dom.de'))

p = person(3)
L = Letter('a03')
L.head = [('Isar BKK', 14, True)]
L.ret = 'Isar BKK · Postfach 20 30 40 · 80001 München'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Versichertennummer:', 'S987654321'), ('Datum:', '16.09.2026')]
L.subject = 'Ihre neue elektronische Gesundheitskarte'
L.body = ['Sehr geehrte Frau Schmitt,', 'Ihre bisherige Gesundheitskarte läuft am 31.12.2026 ab. Bitte senden Sie uns bis zum 15.10.2026 ein aktuelles Foto für Ihre neue Karte.',
          'Mit freundlichen Grüßen', 'Ihre Isar BKK']
L.footer = ['Isar BKK · Telefon 089 556677-0 · karte@isar-bkk.de']
doc(L, T(type='arzt', sender='Isar BKK', recipient=p[1], date='2026-09-16', due='2026-10-15', phone='089 556677-0', email='karte@isar-bkk.de'))

# ================================================================== WERBUNG
p = person(4)
L = Letter('w01')
L.head = [('Möbelwelt Nord GmbH', 15, True)]
L.ret = 'Möbelwelt Nord GmbH · Gewerbepark 3 · 22113 Hamburg'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Datum:', '05.10.2026')]
L.subject = 'Exklusiv für Sie: 20 % Rabatt auf alles!'
L.body = ['Lieber Herr Yilmaz,', 'nur für kurze Zeit: Mit Ihrem persönlichen Gutschein sparen Sie 20 % auf Ihren nächsten Einkauf. Jetzt zugreifen – das Angebot gilt nur bis zum 31.10.2026!',
          'Ihr Aktionscode: HERBST20', 'Wenn Sie keine Werbung mehr erhalten möchten, können Sie dies jederzeit abbestellen.', 'Ihre Möbelwelt Nord']
L.footer = ['Möbelwelt Nord GmbH · www.moebelwelt-nord.de']
doc(L, T(type='werbung', sender='Möbelwelt Nord GmbH', recipient=p[1], date='2026-10-05', due='2026-10-31'))

p = person(5)
L = Letter('w02')
L.head = [('Sparfuchs Direktversicherung AG', 13, True)]
L.ret = 'Sparfuchs Direktversicherung AG · Postfach 1000 · 70001 Stuttgart'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Datum:', '25.09.2026')]
L.subject = 'Jetzt wechseln und bis zu 300 € sparen!'
L.body = ['Liebe Frau Krämer,', 'sparen Sie bei Ihrer Kfz-Versicherung: Neukunden erhalten unseren Vorteilstarif und einen Gutschein über 50 €. Jetzt unverbindlich Angebot anfordern!',
          'Das Angebot ist exklusiv und gilt nur für kurze Zeit.', 'Ihre Sparfuchs Direktversicherung']
L.footer = ['Werbung abbestellen: www.sparfuchs-direkt.de/abmelden']
doc(L, T(type='werbung', sender='Sparfuchs Direktversicherung AG', recipient=p[1], date='2026-09-25'))

# ================================================================== SONSTIGES
p = person(0)
L = Letter('s01')
L.head = [('Hausverwaltung Saarblick', 14, True)]
L.ret = 'Hausverwaltung Saarblick · Saaruferstraße 10 · 66117 Saarbrücken'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Objekt:', 'Lindenweg 3'), ('Datum:', '12.10.2026')]
L.subject = 'Information: Ablesung der Heizkostenverteiler'
L.body = ['Sehr geehrte Mieterinnen und Mieter,', 'am 05.11.2026 zwischen 8 und 12 Uhr werden die Heizkostenverteiler abgelesen. Bitte ermöglichen Sie den Zugang zu Ihrer Wohnung.',
          'Mit freundlichen Grüßen', 'Hausverwaltung Saarblick']
L.footer = ['Tel. 0681 6677889 · info@hv-saarblick.de']
doc(L, T(type='sonstiges', sender='Hausverwaltung Saarblick', recipient=p[1], date='2026-10-12', phone='0681 6677889', email='info@hv-saarblick.de'))

p = person(1)
L = Letter('s02')
L.head = [('Grundschule am Park', 14, True), ('Parkallee 4 · 10115 Berlin', 8, False)]
L.rcpt = ['An die Eltern der Klasse 2b']
L.info = [('Datum:', '08.10.2026')]
L.subject = 'Einladung zum Elternabend'
L.body = ['Liebe Eltern,', 'herzlich laden wir Sie zum Elternabend am Donnerstag, 22.10.2026, um 19:00 Uhr im Raum 104 ein. Bitte geben Sie den Rückmeldezettel bis zum 16.10.2026 ab.',
          'Viele Grüße', 'Klassenleitung 2b']
L.footer = ['Grundschule am Park · Sekretariat 030 8899001 · sekretariat@gs-am-park.de']
doc(L, T(type='sonstiges', sender='Grundschule am Park', date='2026-10-08', due='2026-10-16', phone='030 8899001', email='sekretariat@gs-am-park.de'))

p = person(2)
L = Letter('s03')
L.head = [('Kinderhilfe Rheinland e.V.', 14, True)]
L.ret = 'Kinderhilfe Rheinland e.V. · Rheinufer 9 · 50668 Köln'
L.rcpt = [p[0], p[1], p[2], p[3]]
L.info = [('Datum:', '20.01.2026')]
L.subject = 'Bestätigung über Geldzuwendungen'
L.body = ['im Sinne des § 10b des Einkommensteuergesetzes an eine der in § 5 Abs. 1 Nr. 9 KStG bezeichneten Körperschaften',
          'Name und Anschrift des Zuwendenden: Jonas Weber, Am Sportplatz 7, 50667 Köln', 'Betrag der Zuwendung: 150,00 € – in Buchstaben: einhundertfünfzig Euro',
          'Tag der Zuwendung: 12.12.2025', 'Es handelt sich nicht um den Verzicht auf Erstattung von Aufwendungen.', 'Wir sind wegen Förderung der Jugendhilfe nach dem letzten uns zugegangenen Freistellungsbescheid des Finanzamts Köln-Altstadt, StNr. 214/5888/1234, vom 03.05.2024 von der Körperschaftsteuer befreit.',
          'Köln, 20.01.2026', 'Kinderhilfe Rheinland e.V.']
L.footer = ['Kinderhilfe Rheinland e.V. · spenden@kinderhilfe-rheinland.de']
doc(L, T(type='sonstiges', sender='Kinderhilfe Rheinland e.V.', recipient=p[1], date='2026-01-20', betrag=150.00, email='spenden@kinderhilfe-rheinland.de', steuernummer='214/5888/1234',
         tax=dict(total=150.00, vat19=None, net=None, payment=None, category='spenden', labor=None, merchant='Kinderhilfe Rheinland e.V.', date='2025-12-12')))

# ================================================================== KASSENBONS
def bon(id, lines, truth, image=False):
    doc(Receipt(id, lines), truth, image)


bon('c01', ['**^FRISCHMARKT MÜLLER', '^Frischmarkt Müller oHG', '^Hauptstraße 12', '^66111 Saarbrücken', '^Tel. 0681 123321', '', rl('BIO VOLLMILCH 3,8%', '1,19 A'), rl('VOLLKORNBROT', '2,49 A'),
            rl('ÄPFEL ELSTAR 1KG', '2,99 A'), rl('SPÜLMITTEL', '1,45 B'), rl('KÜCHENROLLE 4ER', '3,29 B'), '-' * 40, rl('**SUMME EUR', '11,41'), '',
            rl('Geg. Girocard', '11,41'), '', rl('Steuer %', 'Netto  Steuer  Brutto'), rl('A= 7,0%', '6,24   0,43   6,67'), rl('B=19,0%', '3,98   0,76   4,74'),
            rl('Gesamtbetrag', '10,22   1,19  11,41'), '', '13.10.2026 18:42  Bon-Nr. 4711  Kasse 3', '^Vielen Dank für Ihren Einkauf!'],
    T(type='rechnung', sender='Frischmarkt Müller oHG', date='2026-10-13', betrag=11.41, phone='0681 123321', rechnungsnummer='4711',
      tax=dict(total=11.41, vat19=0.76, vat7=0.43, net=10.22, payment='ec', category='privat', labor=None, merchant='FRISCHMARKT MÜLLER', date='2026-10-13')), image=True)
bon('c02', ['**^DROGERIE SCHÖN', '^Schön Drogeriemärkte GmbH', '^Filiale 0815 Berlin-Mitte', '', rl('ZAHNPASTA', '1,95'), rl('SHAMPOO', '3,45'), rl('DUSCHGEL 2x1,25', '2,50'),
            rl('**ZU ZAHLEN', '7,90'), rl('BAR', '10,00'), rl('RÜCKGELD', '2,10'), '', rl('MwSt 19%', 'Netto 6,64 MwSt 1,26'), '', 'Datum: 02.10.2026  Uhrzeit: 11:05', 'Beleg-Nr. 2231'],
    T(type='rechnung', sender='Schön Drogeriemärkte GmbH', date='2026-10-02', betrag=7.90, rechnungsnummer='2231',
      tax=dict(total=7.90, vat19=1.26, vat7=None, net=6.64, payment='bar', category='privat', labor=None, merchant='Schön Drogeriemärkte GmbH', date='2026-10-02')))
bon('c03', ['**^ELEKTRO BLITZ', '^Elektro Blitz Fachmarkt GmbH', '^Königsallee 40, 40212 Düsseldorf', '^USt-IdNr. DE987654321', '', rl('MONITOR 27" ULTRA HD', '279,00'), rl('HDMI KABEL 2M', '9,99'),
            rl('**SUMME', '288,99'), '', rl('Kreditkarte VISA', '288,99'), rl('Netto 19%', '242,85'), rl('MwSt 19%', '46,14'), '', '28.09.2026 16:20', 'Bon-Nr. 30098'],
    T(type='rechnung', sender='Elektro Blitz Fachmarkt GmbH', date='2026-09-28', betrag=288.99, rechnungsnummer='30098',
      tax=dict(total=288.99, vat19=46.14, vat7=None, net=242.85, payment='kreditkarte', category='arbeitsmittel', labor=None, merchant='ELEKTRO BLITZ', date='2026-09-28')), image=True)
bon('c04', ['**^Rosen-Apotheke', '^Inh. Dr. Maria Rose e.K.', '^Rosenstraße 1, 10115 Berlin', '', rl('Zuzahlung Rezept', '10,00'), rl('Ibuprofen 400 20St', '4,98'), rl('Nasenspray', '3,99'),
            rl('**Gesamt', '18,97'), rl('EC-Karte', '18,97'), '', rl('19% MwSt enthalten', '3,03'), '', '07.10.2026 09:12'],
    T(type='rechnung', sender='Rosen-Apotheke', date='2026-10-07', betrag=18.97,
      tax=dict(total=18.97, vat19=3.03, vat7=None, net=15.94, payment='ec', category='krankheit', labor=None, merchant='Rosen-Apotheke', date='2026-10-07')))
bon('c05', ['**^TANKSTELLE AM RING', '^Ringstraße 99', '^50672 Köln', '', rl('Säule 4 Super E10', ''), rl('42,31 l x 1,749 EUR/l', '74,00'), rl('**Betrag EUR', '74,00'),
            rl('Girocard kontaktlos', '74,00'), '', rl('Netto', '62,18'), rl('MwSt 19,00%', '11,82'), '', 'Datum 09.10.2026 07:55', 'Beleg 001234'],
    T(type='rechnung', sender='TANKSTELLE AM RING', date='2026-10-09', betrag=74.00,
      tax=dict(total=74.00, vat19=11.82, vat7=None, net=62.18, payment='ec', category='fahrtkosten', labor=None, merchant='TANKSTELLE AM RING', date='2026-10-09')))
bon('c06', ['**^Buchhandlung Seitenwind', '^Inh. K. Blatt', '^Marktplatz 3, 80331 München', '', rl('Fachbuch: Steuerrecht kompakt', '39,90'), rl('Fachbuch: Excel für Profis', '24,99'),
            rl('**Summe', '64,89'), rl('Kartenzahlung', '64,89'), '', rl('enth. MwSt 7%', '4,25'), '', '15.08.2026  12:01'],
    T(type='rechnung', sender='Buchhandlung Seitenwind', date='2026-08-15', betrag=64.89,
      tax=dict(total=64.89, vat19=None, vat7=4.25, net=60.64, payment='ec', category='arbeitsmittel', labor=None, merchant='Buchhandlung Seitenwind', date='2026-08-15')), image=True)
bon('c07', ['**^Fernbahn Deutschland', '^Fernbahn Deutschland AG', '^Online-Ticket', '', 'Fahrkarte Köln Hbf -> Frankfurt(Main)Hbf', 'Fahrt am 21.09.2026, 2. Klasse', rl('Flexpreis', '72,90'),
            rl('**Gesamtpreis', '72,90 EUR'), rl('Bezahlt mit PayPal', '72,90'), rl('enthaltene MwSt 7%', '4,77'), '', 'Buchungsdatum: 18.09.2026', 'Auftragsnummer: FB-ZX7Q2'],
    T(type='rechnung', sender='Fernbahn Deutschland AG', date='2026-09-18', betrag=72.90,
      tax=dict(total=72.90, vat19=None, vat7=4.77, net=68.13, payment='paypal', category='fahrtkosten', labor=None, merchant='Fernbahn Deutschland', date='2026-09-18')))


# ------------------------------------------------------------------ write
def photo(pdf, out_jpg, seed):
    r = random.Random(seed)
    base = out_jpg[:-4]
    subprocess.run(['pdftoppm', '-r', '170', '-singlefile', '-png', pdf, base], check=True)
    im = Image.open(base + '.png').convert('RGB')
    os.remove(base + '.png')
    # slightly tilted, uneven light, blur and JPEG noise (phone photo of a letter)
    angle = r.uniform(-1.6, 1.6)
    im = im.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(235, 232, 225))
    w, h = im.size
    grad = Image.linear_gradient('L').resize((w, h)).point(lambda v: 200 + v * 55 // 255)
    shade = Image.merge('RGB', (grad, grad, grad))
    from PIL import ImageChops
    im = ImageChops.multiply(im, shade)
    im = im.filter(ImageFilter.GaussianBlur(0.7))
    im = ImageEnhance.Contrast(im).enhance(0.92)
    im.save(out_jpg, quality=72)


if __name__ == '__main__':
    truth = {}
    for i, (d, t, image) in enumerate(DOCS):
        pdf = os.path.join(OUT, d.id + '.pdf')
        d.render(pdf)
        t = dict(t)
        t['image'] = bool(image)
        truth[d.id] = t
        if image:
            photo(pdf, os.path.join(OUT, d.id + '.jpg'), i)
    json.dump(truth, open(os.path.join(OUT, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
    print(len(DOCS), 'documents,', sum(1 for d in DOCS if d[2]), 'photos')
