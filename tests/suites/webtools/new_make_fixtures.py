"""Fixtures for the 'new' agent tools (ocr-pdf, image-to-text, pdf-viewer, crop/rotate-image):
rendered scans with German text (umlauts), a sideways scan page, a mixed text+scan PDF, an encrypted scan,
a photo/screenshot with text, a long PDF with outline for the viewer."""
import io, random, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.pdfgen import canvas as rl
from reportlab.lib.pagesizes import A4

FIX = Path(__file__).resolve().parent / 'fixtures'
FIX.mkdir(exist_ok=True)
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
random.seed(7)

DE = ["Sehr geehrte Damen und Herren,",
      "hiermit bestätigen wir den Eingang Ihrer Bestellung.",
      "Die Lieferung der Äpfel und Birnen erfolgt übermorgen.",
      "Bitte beachten Sie die geänderte Größe der Kartons.",
      "Unsere Anschrift: Hauptstraße 12, 66111 Saarbrücken.",
      "Für Rückfragen stehen wir Ihnen gern zur Verfügung.",
      "Mit freundlichen Grüßen",
      "Jürgen Müller, Büroleitung"]
EN = ["Quarterly report for the warehouse team",
      "Shipments increased by twelve percent this quarter.",
      "Please check the attached delivery schedule carefully."]

def scan_page(lines, dpi=200, skew=1.2, font=SERIF, size_pt=13, noise=True):
    W, H = int(8.27 * dpi), int(11.69 * dpi)
    img = Image.new('L', (W, H), 246)
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(font, int(size_pt * dpi / 72))
    y = int(1.2 * dpi)
    d.text((int(1 * dpi), int(0.7 * dpi)), 'Muster GmbH · Lieferschein Nr. 4711', font=ImageFont.truetype(SANS, int(15 * dpi / 72)), fill=20)
    for ln in lines:
        d.text((int(1 * dpi), y), ln, font=f, fill=random.randint(15, 45))
        y += int(size_pt * 1.9 * dpi / 72)
    img = img.rotate(skew, resample=Image.BICUBIC, fillcolor=246)
    if noise:
        px = img.load()
        for _ in range(W * H // 400):
            x, yy = random.randrange(W), random.randrange(H)
            px[x, yy] = random.randint(120, 200)
        img = img.filter(ImageFilter.GaussianBlur(0.6))
    return img.convert('RGB')

def images_pdf(path, imgs, dpi=200):
    c = rl.Canvas(str(path), pagesize=A4)
    for im in imgs:
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=80); buf.seek(0)
        from reportlab.lib.utils import ImageReader
        w, h = A4
        if im.width > im.height: c.setPageSize((h, w)); w, h = h, w
        else: c.setPageSize(A4)
        c.drawImage(ImageReader(buf), 0, 0, w, h)
        c.showPage()
    c.save()

p1 = scan_page(DE)
p2 = scan_page(EN + DE[:3], skew=-0.8).rotate(90, expand=True)   # sideways content on a landscape page
images_pdf(FIX / 'new_scan_de.pdf', [p1, p2])
images_pdf(FIX / 'new_scan_1p.pdf', [p1])
# mixed: page 1 real text, page 2 scan
c = rl.Canvas(str(FIX / '_new_text1.pdf'), pagesize=A4)
c.setFont('Helvetica', 14); c.drawString(72, 760, 'Dieses Blatt hat bereits echten Text.'); c.drawString(72, 740, 'Er soll nicht doppelt erkannt werden.')
c.showPage(); c.save()
images_pdf(FIX / '_new_scan_only.pdf', [scan_page(DE[3:], skew=0.5)])
subprocess.run(['qpdf', '--empty', '--pages', str(FIX / '_new_text1.pdf'), str(FIX / '_new_scan_only.pdf'), '--', str(FIX / 'new_mixed.pdf')], check=True)
subprocess.run(['qpdf', '--encrypt', 'geheim', 'geheim', '256', '--', str(FIX / 'new_scan_1p.pdf'), str(FIX / 'new_scan_enc.pdf')], check=True)
# photo of a note (perspective-free, uneven light) + screenshot
ph = scan_page(DE[:4], dpi=150, skew=2.0).resize((1240, 1754))
grad = Image.linear_gradient('L').resize(ph.size).point(lambda v: 255 - v // 4)
ph = Image.composite(ph, Image.new('RGB', ph.size, (200, 190, 170)), grad).crop((60, 80, 1200, 900))
ph.save(FIX / 'new_note.jpg', quality=85)
ss = Image.new('RGB', (1080, 700), (255, 255, 255)); d = ImageDraw.Draw(ss)
d.rectangle((0, 0, 1080, 90), fill=(30, 60, 140)); d.text((30, 25), 'Einstellungen', font=ImageFont.truetype(SANS, 40), fill=(255, 255, 255))
for i, t in enumerate(['WLAN-Passwort: Sonnenblume 2024', 'Benutzername: grüner.löwe', 'Server: mail.beispiel.de']):
    d.text((40, 150 + i * 90), t, font=ImageFont.truetype(SANS, 38), fill=(20, 20, 20))
ss.save(FIX / 'new_screen.png')
# long PDF with outline + text for the viewer
c = rl.Canvas(str(FIX / 'new_book.pdf'), pagesize=A4)
for i in range(1, 41):
    if i % 10 == 1:
        c.bookmarkPage(f'k{i}'); c.addOutlineEntry(f'Kapitel {i // 10 + 1}', f'k{i}', level=0)
    c.setFont('Helvetica-Bold', 20); c.drawString(72, 780, f'Seite {i}')
    c.setFont('Helvetica', 12)
    for k in range(30):
        c.drawString(72, 740 - k * 20, f'Zeile {k + 1} auf Seite {i}: Grüße aus Saarbrücken' + (' – Suchwort Zebra' if (i == 27 and k == 5) else ''))
    c.showPage()
c.save()
subprocess.run(['qpdf', '--encrypt', 'geheim', 'geheim', '256', '--', str(FIX / 'new_book.pdf'), str(FIX / 'new_book_enc.pdf')], check=True)
for f in ['_new_text1.pdf', '_new_scan_only.pdf']: (FIX / f).unlink()
print('new fixtures ok')
# colour quadrants for crop/rotate checks (TL red, TR green, BL blue, BR yellow)
q = Image.new('RGB', (400, 300))
d = ImageDraw.Draw(q)
for (x, y, c) in [(0, 0, (230, 30, 30)), (200, 0, (30, 200, 30)), (0, 150, (30, 30, 230)), (200, 150, (240, 220, 20))]:
    d.rectangle((x, y, x + 199, y + 149), fill=c)
q.save(FIX / 'new_quad.png'); q.save(FIX / 'new_quad.jpg', quality=95)
print('quad ok')
Image.open(FIX / 'new_note.jpg').rotate(90, expand=True).save(FIX / 'new_note_side.jpg', quality=88)
print('side ok')
