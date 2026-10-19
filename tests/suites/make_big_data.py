"""Large test PDFs for the stress test (test_big.py) – generated, never committed (tests/suites/bigdata/).

big_text.pdf    600 pages of text (a long manual / contract collection)
big_scan.pdf    60 pages, each a full-page photo-like image (a scanned file of ~80 MB)
Run: python3 make_big_data.py
"""
import io, os, random
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bigdata')
os.makedirs(OUT, exist_ok=True)
WORDS = ('Vertrag Kündigung Frist Rechnung Betrag Zahlung Monat Kunde Leistung Anlage Seite Absatz Vereinbarung '
         'Haftung Gewährleistung Datenschutz Einwilligung Widerruf Lieferung Bestellung Preis Steuer Bank Konto').split()


def big_text(n=600):
    path = os.path.join(OUT, 'big_text.pdf')
    if os.path.exists(path):
        return path
    rnd = random.Random(7)
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle('Großes Handbuch')
    for p in range(1, n + 1):
        c.setFont('Helvetica-Bold', 16)
        c.drawString(60, 790, f'Kapitel {p}')
        c.bookmarkPage(f'p{p}')
        if p % 20 == 1:
            c.addOutlineEntry(f'Kapitel {p}', f'p{p}', level=0)
        c.setFont('Helvetica', 10)
        y = 760
        while y > 60:
            line = ' '.join(rnd.choice(WORDS) for _ in range(12))
            if p == 437 and y == 760 - 14 * 26:
                line = 'Hier steht das Suchwort Zauberwürfel genau einmal im ganzen Dokument.'
            c.drawString(60, y, line)
            y -= 14
        c.drawString(290, 30, str(p))
        c.showPage()
    c.save()
    return path


def big_scan(n=60):
    path = os.path.join(OUT, 'big_scan.pdf')
    if os.path.exists(path):
        return path
    rnd = random.Random(3)
    c = canvas.Canvas(path, pagesize=A4)
    for p in range(n):
        # a noisy "photo of paper" 1700×2400 px – compresses badly, like real scans
        im = Image.effect_noise((850, 1200), 40).convert('RGB').resize((1700, 2400))
        d = ImageDraw.Draw(im)
        for i in range(40):
            y = 150 + i * 52
            d.rectangle([120, y, 120 + rnd.randint(600, 1450), y + 18], fill=(40, 40, 50))
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=82)
        buf.seek(0)
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(buf), 0, 0, width=A4[0], height=A4[1])
        c.showPage()
    c.save()
    return path


if __name__ == '__main__':
    for f in (big_text(), big_scan()):
        print(f, round(os.path.getsize(f) / 1e6, 1), 'MB')
