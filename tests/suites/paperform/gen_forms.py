"""Test forms for „Papierformular automatisch ausfüllbar“ (invented authority, invented content).
flat_form.pdf  – born-digital but without form fields (vector lines/boxes, text labels)
scan_form.pdf  – the same form as a slightly rotated, noisy 200-dpi scan (image only → needs OCR for the labels)
letter.pdf     – an ordinary letter without anything to fill in (must not get many fields)
truth.json     – expected fields (name, type, box in points, top-left origin)"""
import json, os, random, subprocess, io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from PIL import Image, ImageFilter

D = os.path.dirname(os.path.abspath(__file__))
W, H = A4
truth = []


def T(x, y):  # top-left coordinates → reportlab
    return x, H - y


def field(name, typ, x0, y0, x1, y1):
    truth.append({'name': name, 'type': typ, 'box': [x0, y0, x1, y1]})


def form(c):
    c.setFont('Helvetica-Bold', 15); c.drawString(*T(60, 70), 'Stadt Musterstadt – Antrag auf Bewohnerparkausweis')
    c.setFont('Helvetica', 9); c.drawString(*T(60, 88), 'Bitte in Druckbuchstaben ausfüllen und unterschrieben zurücksenden.')
    c.setFont('Helvetica-Bold', 11); c.drawString(*T(60, 118), '1. Angaben zur Person')
    c.setLineWidth(0.8)
    # box grid with small labels at the top of each cell
    rows = [(128, 160, [('Name', 60, 300), ('Vorname', 300, 535)]),
            (160, 192, [('Geburtsdatum', 60, 230), ('Telefon', 230, 535)]),
            (192, 224, [('Straße, Hausnummer', 60, 535)]),
            (224, 256, [('PLZ', 60, 160), ('Ort', 160, 535)])]
    for top, bot, cells in rows:
        for lab, x0, x1 in cells:
            c.rect(x0, H - bot, x1 - x0, bot - top, stroke=1, fill=0)
            c.setFont('Helvetica', 7); c.drawString(x0 + 3, H - top - 8, lab)
            typ = 'date' if lab == 'Geburtsdatum' else 'text'
            field(lab, typ, x0, top, x1, bot)
    c.setFont('Helvetica-Bold', 11); c.drawString(*T(60, 290), '2. Fahrzeug')
    c.setFont('Helvetica', 10); c.drawString(*T(60, 318), 'Amtliches Kennzeichen:')
    c.line(180, H - 320, 400, H - 320); field('Amtliches Kennzeichen', 'text', 180, 300, 400, 321)
    c.drawString(*T(60, 346), 'Halter des Fahrzeugs:')
    for i, lab in enumerate(['ich selbst', 'Firmenwagen', 'anderer Halter']):
        x = 180 + i * 120
        c.rect(x, H - 348, 10, 10, stroke=1, fill=0)
        c.drawString(x + 15, H - 346, lab)
        field(lab, 'check', x, 338, x + 10, 348)
    c.setFont('Helvetica-Bold', 11); c.drawString(*T(60, 386), '3. Bemerkungen')
    c.rect(60, H - 480, 475, 84, stroke=1, fill=0); field('Bemerkungen', 'multiline', 60, 396, 535, 480)
    c.setFont('Helvetica', 9)
    c.drawString(*T(60, 520), 'Ich versichere, dass die Angaben richtig sind.')
    c.line(60, H - 580, 250, H - 580); c.setFont('Helvetica', 8); c.drawString(*T(60, 592), 'Ort, Datum'); field('Ort, Datum', 'text', 60, 555, 250, 581)
    c.line(320, H - 580, 535, H - 580); c.drawString(*T(320, 592), 'Unterschrift'); field('Unterschrift', 'sign', 320, 540, 535, 581)
    c.setFont('Helvetica', 7); c.drawString(*T(60, 800), 'Stadt Musterstadt · Bürgerbüro · Formular BP-1 (Testformular)')


def letter(c):
    c.setFont('Helvetica', 10)
    y = 80
    for line in ['Hausverwaltung Beispiel GmbH · Am Markt 3 · 66111 Saarbrücken', '', 'Frau Erika Musterfrau', 'Lindenweg 7', '66111 Saarbrücken', '', '',
                 'Nebenkostenabrechnung 2025', '', 'Sehr geehrte Frau Musterfrau,', '',
                 'anbei erhalten Sie die Nebenkostenabrechnung für das Jahr 2025. Es ergibt sich eine Nachzahlung',
                 'von 84,20 €, die wir bis zum 30.11.2026 auf unser Konto zu überweisen bitten.', '',
                 'Mit freundlichen Grüßen', '', 'Hausverwaltung Beispiel GmbH']:
        c.drawString(70, H - y, line); y += 15
    c.setLineWidth(0.5); c.line(70, H - 760, 525, H - 760)
    c.setFont('Helvetica', 7); c.drawString(70, H - 772, 'Hausverwaltung Beispiel GmbH · IBAN DE00 0000 0000 0000 0000 00 · Amtsgericht Musterstadt HRB 0000')


c = canvas.Canvas(os.path.join(D, 'flat_form.pdf'), pagesize=A4); form(c); c.showPage(); c.save()
c = canvas.Canvas(os.path.join(D, 'letter.pdf'), pagesize=A4); letter(c); c.showPage(); c.save()
# scan: 200 dpi, 0.6° rotation, paper tone + noise + slight blur, JPEG
subprocess.run(['pdftoppm', '-r', '200', '-png', '-singlefile', os.path.join(D, 'flat_form.pdf'), os.path.join(D, '_scan')], check=True)
im = Image.open(os.path.join(D, '_scan.png')).convert('L')
im = im.rotate(0.6, resample=Image.BICUBIC, expand=False, fillcolor=255)
random.seed(7)
px = im.load()
for _ in range(30000):
    x, y = random.randrange(im.width), random.randrange(im.height)
    px[x, y] = max(0, px[x, y] - random.randrange(40, 120))
im = im.point(lambda v: int(232 * v / 255) + 10).filter(ImageFilter.GaussianBlur(0.6))
buf = io.BytesIO(); im.convert('RGB').save(buf, 'JPEG', quality=72); buf.seek(0)
jpg = os.path.join(D, '_scan.jpg'); open(jpg, 'wb').write(buf.getvalue())
c = canvas.Canvas(os.path.join(D, 'scan_form.pdf'), pagesize=A4); c.drawImage(jpg, 0, 0, W, H); c.showPage(); c.save()
os.remove(os.path.join(D, '_scan.png')); os.remove(jpg)
json.dump({'fields': truth}, open(os.path.join(D, 'truth.json'), 'w'), indent=1, ensure_ascii=False)
print(len(truth), 'fields')
