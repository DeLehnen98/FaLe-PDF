"""Generate OCR test material (images, image-only PDFs, cards, table) + ground truth."""
import json, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from reportlab.pdfgen import canvas as rl
from reportlab.lib.pagesizes import A4

SP = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SP, 'ocrdata')
os.makedirs(TD, exist_ok=True)
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FB = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FS = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
random.seed(7)
truth = {}

DE = [
    ('Rechnung für März 2026', 56, FB),
    ('Sehr geehrte Frau Müller,', 40, F),
    ('vielen Dank für Ihre Bestellung. Die Lieferung erfolgt', 40, F),
    ('übermorgen durch unseren Spediteur. Bitte prüfen Sie', 40, F),
    ('die Größe der Pakete und bestätigen Sie den Empfang.', 40, F),
    ('Grüße aus Saarbrücken, Ihr Kundenservice', 34, FS),
    ('Straße: Hauptstraße 12, 66111 Saarbrücken', 30, F),
    ('Öffnungszeiten: Montag bis Freitag, 9 bis 18 Uhr', 30, F),
]
EN = [
    ('Quarterly Report Summary', 56, FB),
    ('The quick brown fox jumps over the lazy dog.', 40, F),
    ('Revenue increased by twelve percent compared', 40, F),
    ('to the previous quarter, while costs remained', 40, F),
    ('stable across all regions and departments.', 40, F),
    ('Please contact our office for further details.', 32, FS),
]


def text_image(lines, w=2000, margin=120, gap=1.55, bg=255):
    hgt = margin * 2 + int(sum(s * gap for _, s, _ in lines))
    im = Image.new('L', (w, hgt), bg)
    d = ImageDraw.Draw(im)
    y = margin
    for t, s, f in lines:
        d.text((margin, y), t, font=ImageFont.truetype(f, s), fill=0)
        y += int(s * gap)
    return im


def save(im, name, **kw):
    p = os.path.join(TD, name)
    im.save(p, **kw)
    return p


# 1/2 clean text
save(text_image(DE), 'clean_de.png')
truth['clean_de'] = '\n'.join(t for t, _, _ in DE)
save(text_image(EN), 'clean_en.png')
truth['clean_en'] = '\n'.join(t for t, _, _ in EN)

# 3 small text (needs upscaling)
SMALL = [('Kleine Schrift: Bitte beachten Sie die Hinweise.', 15, F), ('Small print: terms and conditions apply here.', 15, F),
         ('Zahlung innerhalb von 14 Tagen ohne Abzug.', 15, F)]
save(text_image(SMALL, w=520, margin=20), 'small.png')
truth['small'] = '\n'.join(t for t, _, _ in SMALL)

# 4 photo-like scan: rotated, uneven light, noise, on a dark desk
page = text_image(DE, w=1800, margin=110).convert('RGB')
page = page.rotate(2.6, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))
W, H = page.size
grad = Image.new('L', (W, H))
gd = ImageDraw.Draw(grad)
for x in range(W):
    v = int(255 - 70 * (x / W))
    gd.line([(x, 0), (x, H)], fill=v)
page = Image.composite(page, Image.new('RGB', (W, H), (0, 0, 0)), grad.point(lambda v: v)).convert('RGB')
page = Image.blend(page, Image.new('RGB', (W, H), (235, 225, 205)), 0.12)
desk = Image.new('RGB', (W + 260, H + 260), (70, 52, 40))
desk.paste(page, (130, 120))
px = desk.load()
for _ in range(25000):
    x, y = random.randrange(desk.size[0]), random.randrange(desk.size[1])
    r, g, b = px[x, y]
    n = random.randint(-30, 30)
    px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
desk = desk.filter(ImageFilter.GaussianBlur(0.6))
save(desk, 'photo_scan.jpg', quality=82)
truth['photo_scan'] = truth['clean_de']

# 5 image-only multi-page PDF (3 pages) + mixed PDF (text page + image page)
pages_txt = [DE, EN, [('Seite drei: Abschlussbericht', 50, FB), ('Alle Angaben ohne Gewähr. Änderungen vorbehalten.', 38, F), ('Kontakt: info@beispiel.de, Telefon 0681 123456', 38, F)]]
truth['scan_pages'] = ['\n'.join(t for t, _, _ in p) for p in pages_txt]
imgs = []
for i, pl in enumerate(pages_txt):
    im = Image.new('L', (2480, 3508), 255)
    ti = text_image(pl, w=2300, margin=40)
    im.paste(ti, (90, 200))
    p = save(im, f'scanpage_{i+1}.png')
    imgs.append(p)
c = rl.Canvas(os.path.join(TD, 'scan3.pdf'), pagesize=A4)
for p in imgs:
    c.drawImage(p, 0, 0, width=A4[0], height=A4[1])
    c.showPage()
c.save()
c = rl.Canvas(os.path.join(TD, 'mixed.pdf'), pagesize=A4)
c.setFont('Helvetica', 14)
y = 780
for line in ['Dies ist eine echte Textseite mit auswählbarem Text.', 'Sie darf bei der Texterkennung nicht verändert werden.', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.']:
    c.drawString(72, y, line)
    y -= 22
c.showPage()
c.drawImage(imgs[1], 0, 0, width=A4[0], height=A4[1])
c.showPage()
c.save()
# text-only PDF for the banner negative check
c = rl.Canvas(os.path.join(TD, 'textonly.pdf'), pagesize=A4)
c.setFont('Helvetica', 14)
c.drawString(72, 780, 'Ganz normaler Text in einer PDF-Datei.')
c.showPage()
c.save()

# two scanned versions for compare (old/new)
for nm, lines in [('cmp_alt', [('Vertrag über Leistungen', 52, FB), ('Der Preis beträgt 100 Euro pro Monat.', 40, F), ('Die Laufzeit beträgt zwölf Monate.', 40, F)]),
                  ('cmp_neu', [('Vertrag über Leistungen', 52, FB), ('Der Preis beträgt 120 Euro pro Monat.', 40, F), ('Die Laufzeit beträgt zwölf Monate.', 40, F)])]:
    im = Image.new('L', (2480, 3508), 255)
    im.paste(text_image(lines, w=2300, margin=40), (90, 200))
    p = save(im, nm + '.png')
    c = rl.Canvas(os.path.join(TD, nm + '.pdf'), pagesize=A4)
    c.drawImage(p, 0, 0, width=A4[0], height=A4[1])
    c.showPage()
    c.save()

# 6 table image
rows = [['Artikel', 'Menge', 'Preis', 'Summe'],
        ['Kaffee', '2', '4,50', '9,00'],
        ['Tee', '3', '3,20', '9,60'],
        ['Kuchen', '1', '2,80', '2,80'],
        ['Wasser', '4', '1,50', '6,00']]
cw = [520, 300, 300, 300]
im = Image.new('L', (sum(cw) + 160, 80 + 90 * len(rows) + 80), 255)
d = ImageDraw.Draw(im)
fnt = ImageFont.truetype(F, 40)
fb = ImageFont.truetype(FB, 40)
y = 80
for r, row in enumerate(rows):
    x = 80
    for ci, cell in enumerate(row):
        d.text((x + 16, y + 22), cell, font=fb if r == 0 else fnt, fill=0)
        x += cw[ci]
    d.line([(80, y + 90), (80 + sum(cw), y + 90)], fill=120, width=2)
    y += 90
save(im, 'table.png')
truth['table'] = rows

# 7 business cards
def card(lines, name, logo=None):
    im = Image.new('RGB', (1700, 1000), (250, 250, 247))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 40, 1000], fill=(30, 90, 160))
    y = 110
    for t, s, f, col in lines:
        d.text((130, y), t, font=ImageFont.truetype(f, s), fill=col)
        y += int(s * 1.6)
    # photo it: slight rotation on a table
    ph = im.rotate(-1.5, resample=Image.BICUBIC, expand=True, fillcolor=(120, 110, 100))
    bg = Image.new('RGB', (ph.size[0] + 200, ph.size[1] + 200), (120, 110, 100))
    bg.paste(ph, (100, 100))
    save(bg, name, quality=88)

card([('Dr. Anna Schäfer', 72, FB, (20, 20, 20)), ('Geschäftsführerin', 42, F, (60, 60, 60)), ('Schäfer & Partner GmbH', 46, FB, (30, 90, 160)),
      ('Tel.: +49 681 9876543', 38, F, (20, 20, 20)), ('Mobil: +49 170 1234567', 38, F, (20, 20, 20)), ('E-Mail: anna.schaefer@schaefer-partner.de', 38, F, (20, 20, 20)),
      ('www.schaefer-partner.de', 38, F, (20, 20, 20)), ('Bahnhofstraße 5, 66111 Saarbrücken', 38, F, (20, 20, 20))], 'card_de.jpg')
truth['card_de'] = {'name': 'Dr. Anna Schäfer', 'firma': 'Schäfer & Partner GmbH', 'position': 'Geschäftsführerin', 'telefon': '+49 681 9876543',
                    'mobil': '+49 170 1234567', 'email': 'anna.schaefer@schaefer-partner.de', 'web': 'www.schaefer-partner.de', 'adresse': 'Bahnhofstraße 5, 66111 Saarbrücken'}
card([('John Miller', 72, FB, (20, 20, 20)), ('Senior Sales Manager', 42, F, (60, 60, 60)), ('Northwind Trading Ltd.', 46, FB, (30, 90, 160)),
      ('Phone: +44 20 7946 0958', 38, F, (20, 20, 20)), ('Mobile: +44 7700 900123', 38, F, (20, 20, 20)), ('john.miller@northwind.co.uk', 38, F, (20, 20, 20)),
      ('northwind.co.uk', 38, F, (20, 20, 20)), ('221 Baker Street, London NW1 6XE', 38, F, (20, 20, 20))], 'card_en.jpg')
truth['card_en'] = {'name': 'John Miller', 'firma': 'Northwind Trading Ltd.', 'position': 'Senior Sales Manager', 'telefon': '+44 20 7946 0958',
                    'mobil': '+44 7700 900123', 'email': 'john.miller@northwind.co.uk', 'web': 'northwind.co.uk', 'adresse': '221 Baker Street, London NW1 6XE'}

# special characters (outside WinAnsi) for the text layer robustness test
SPEC = [('Sonderzeichen: Ω ≤ ≥ → ł ő č – „Zitat“ € 5 %', 44, F), ('Greek αβγ und Kyrillisch Жж bleiben heil', 44, F)]
im = Image.new('L', (2480, 3508), 255)
im.paste(text_image(SPEC, w=2300, margin=40), (90, 200))
p = save(im, 'special.png')
c = rl.Canvas(os.path.join(TD, 'special.pdf'), pagesize=A4)
c.drawImage(p, 0, 0, width=A4[0], height=A4[1])
c.showPage()
c.save()

json.dump(truth, open(os.path.join(TD, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', sorted(os.listdir(TD)))
