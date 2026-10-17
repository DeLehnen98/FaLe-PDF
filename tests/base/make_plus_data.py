"""Test files for the FaLe PDF Plus features."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak, Image as RLImage, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SP = os.path.dirname(os.path.abspath(__file__))
TD = os.path.join(SP, 'testdata_plus')
os.makedirs(TD, exist_ok=True)
st = getSampleStyleSheet()

# picture for figures
img = Image.new('RGB', (600, 360), (240, 244, 255))
d = ImageDraw.Draw(img)
for i in range(12):
    d.rectangle([30 + i * 45, 300 - i * 20, 60 + i * 45, 320], fill=(59, 55, 160))
d.text((30, 20), 'Umsatzentwicklung', fill=(20, 20, 40))
img.save(os.path.join(TD, 'chart.png'))

lorem = ('Der Lesemodus bricht den Text dieser Seite neu um, damit er auf kleinen Bildschirmen gut lesbar ist. '
         'Absätze werden zusammengeführt, Silbentrennungen am Zeilenende werden entfernt und Überschriften werden erkannt. ')

def report(path, variant=0):
    doc = SimpleDocTemplate(path, pagesize=A4, title='Quartalsbericht')
    s = [Paragraph('Quartalsbericht 2026', st['Title']),
         Paragraph('1. Zusammenfassung', st['Heading1']),
         Paragraph(lorem * 3 + ('Der Umsatz stieg um zwölf Prozent.' if variant == 0 else 'Der Umsatz stieg um fünfzehn Prozent im Vergleich zum Vorjahr.'), st['BodyText']),
         Paragraph('1.1 Details', st['Heading2']),
         Paragraph(lorem * 2, st['BodyText']),
         RLImage(os.path.join(TD, 'chart.png'), width=300, height=180),
         Paragraph('Abbildung 1: Umsatz nach Monaten.', st['Italic']),
         Paragraph(lorem, st['BodyText']),
         PageBreak(),
         Paragraph('2. Ausblick', st['Heading1']),
         Paragraph(lorem * 2 + ('Wir planen neue Standorte in Saarbrücken und Trier.' if variant == 0 else 'Wir planen neue Standorte in Saarbrücken.'), st['BodyText']),
         Paragraph('2.1 Risiken', st['Heading2']),
         Paragraph(lorem + 'Die Lieferketten bleiben angespannt.', st['BodyText'])]
    if variant == 1:
        s += [Paragraph('2.2 Chancen', st['Heading2']), Paragraph('Neue Märkte in Luxemburg bieten zusätzliches Wachstum.', st['BodyText'])]
    s += [PageBreak(), Paragraph('3. Anhang', st['Heading1']), Paragraph('Kontakt: info@example.de. ' + lorem, st['BodyText'])]
    doc.build(s)

report(os.path.join(TD, 'bericht_v1.pdf'), 0)
report(os.path.join(TD, 'bericht_v2.pdf'), 1)

# form-like PDF: labels with colons, underscores, drawn boxes and checkbox squares
c = canvas.Canvas(os.path.join(TD, 'antrag.pdf'), pagesize=A4)
W, H = A4
c.setFont('Helvetica-Bold', 16); c.drawString(60, H - 70, 'Antrag auf Mitgliedschaft')
c.setFont('Helvetica', 11)
c.drawString(60, H - 120, 'Vorname:'); c.drawString(300, H - 120, 'Nachname:')
c.drawString(60, H - 150, 'Straße: ______________________________')
c.drawString(60, H - 180, 'PLZ / Ort: ____________________________')
c.drawString(60, H - 210, 'E-Mail:')
c.rect(140, H - 216, 250, 20, stroke=1, fill=0)
c.drawString(60, H - 245, 'Telefon:')
c.rect(140, H - 251, 180, 20, stroke=1, fill=0)
c.rect(60, H - 290, 11, 11, stroke=1, fill=0); c.drawString(78, H - 288, 'Ich stimme den Bedingungen zu')
c.rect(60, H - 312, 11, 11, stroke=1, fill=0); c.drawString(78, H - 310, 'Newsletter abonnieren')
c.drawString(60, H - 360, 'Datum: __________________')
c.drawString(300, H - 360, 'Unterschrift:')
c.line(380, H - 362, 540, H - 362)
c.showPage(); c.save()

# PDF with large white margins (content in the middle) for auto-crop
c = canvas.Canvas(os.path.join(TD, 'raender.pdf'), pagesize=A4)
for p in range(2):
    c.setFont('Helvetica', 12)
    c.rect(150, 300, 300, 260, stroke=1, fill=0)
    c.drawString(170, 530, f'Inhalt Seite {p + 1} mit breiten Rändern')
    for k in range(8): c.drawString(170, 500 - k * 22, 'Zeile %d – Text im Kasten' % (k + 1))
    c.showPage()
c.save()

# scanned-only PDF (image page, no text)
scan = Image.new('RGB', (1240, 1754), 'white')
dd = ImageDraw.Draw(scan)
for k in range(30): dd.rectangle([120, 150 + k * 45, 1100, 170 + k * 45], fill=(60, 60, 60))
scan.save(os.path.join(TD, 'scan_page.jpg'), quality=80)
c = canvas.Canvas(os.path.join(TD, 'nur_scan.pdf'), pagesize=A4)
c.drawImage(os.path.join(TD, 'scan_page.jpg'), 0, 0, width=W, height=H)
c.showPage(); c.save()

# photos: shadowed document photo, noisy photo, moiré
w, h = 1200, 900
x = np.linspace(0, 1, w)[None, :]; y = np.linspace(0, 1, h)[:, None]
paper = 235 - 110 * np.clip((x * 0.8 + y * 0.6) - 0.6, 0, 1)  # shadow towards bottom-right
arr = np.repeat(paper[..., None], 3, axis=2)
for k in range(14):
    arr[100 + k * 50:112 + k * 50, 120:1050] *= 0.25
Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(TD, 'schatten.jpg'), quality=92)

rng = np.random.default_rng(4)
base = np.array(Image.open(os.path.join(TD, 'chart.png')).resize((900, 540))).astype(np.float32)
noisy = np.clip(base + rng.normal(0, 22, base.shape), 0, 255).astype(np.uint8)
Image.fromarray(noisy).save(os.path.join(TD, 'rauschen.png'))
blurred = Image.open(os.path.join(TD, 'chart.png')).resize((900, 540)).filter(ImageFilter.GaussianBlur(2.2))
blurred.save(os.path.join(TD, 'unscharf.png'))
xx, yy = np.meshgrid(np.arange(900), np.arange(600))
mo = 128 + 90 * np.sin(xx * 1.9 + yy * 0.4) * np.sin(yy * 1.7)
mo = np.clip(mo[..., None].repeat(3, 2) * 0.5 + base[:600 if base.shape[0] >= 600 else base.shape[0]].mean() * 0.5, 0, 255).astype(np.uint8)
Image.fromarray(mo).save(os.path.join(TD, 'moire.png'))

# portrait for passport photo: grey background, head ellipse
pp = Image.new('RGB', (1200, 1600), (95, 140, 190))  # blue-ish uniform background
dp = ImageDraw.Draw(pp)
dp.ellipse([420, 380, 780, 860], fill=(224, 182, 150))   # face
dp.ellipse([400, 330, 800, 620], fill=(70, 50, 35))      # hair top
dp.ellipse([420, 420, 780, 860], fill=(224, 182, 150))
dp.ellipse([505, 580, 545, 610], fill=(40, 40, 40)); dp.ellipse([655, 580, 695, 610], fill=(40, 40, 40))  # eyes
dp.rectangle([360, 900, 840, 1600], fill=(40, 60, 90))   # shoulders
dp.rectangle([540, 840, 660, 920], fill=(214, 172, 140))  # neck
pp.save(os.path.join(TD, 'portrait.jpg'), quality=92)
print('ok')
