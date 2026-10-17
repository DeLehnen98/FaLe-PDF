"""Fixtures for the edit tools (agent `edit`). Run from the webtools folder: python3 edit_make_fixtures.py"""
from pathlib import Path
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A5, letter, landscape
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject, NameObject, NumberObject
from PIL import Image, ImageDraw

FIX = Path(__file__).resolve().parent / 'fixtures'
FIX.mkdir(exist_ok=True)


def pages(spec):
    """spec: list of (size, draw_fn)"""
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for size, fn in spec:
        c.setPageSize(size)
        fn(c, size)
        c.showPage()
    c.save()
    return PdfReader(io.BytesIO(buf.getvalue()))


def label(text, sub='Lorem ipsum dolor sit amet.'):
    def fn(c, size):
        w, h = size
        c.setFont('Helvetica-Bold', 28)
        c.drawString(60, h - 110, text)
        c.setFont('Helvetica', 12)
        c.drawString(60, h - 140, sub)
        c.rect(40, 40, w - 80, h - 80)  # frame = page edge reference
    return fn


def write(reader_or_writer, name):
    w = reader_or_writer if isinstance(reader_or_writer, PdfWriter) else PdfWriter(clone_from=reader_or_writer)
    with open(FIX / name, 'wb') as f:
        w.write(f)


# 1. rotated pages: /Rotate 0, 90, 180, 270
r = pages([(A4, label(f'Rotation {a}')) for a in (0, 90, 180, 270)])
w = PdfWriter(clone_from=r)
for p, a in zip(w.pages, (0, 90, 180, 270)):
    if a:
        p[NameObject('/Rotate')] = NumberObject(a)
write(w, 'edit_rot.pdf')

# 2. offset MediaBox + CropBox (origin not at 0/0), plus a rotated one with offset
def offset_page(c, size):
    w, h = size
    c.translate(-200, -100)
    c.setFont('Helvetica-Bold', 24)
    c.drawString(-100, 600, 'Offset CropBox')
    c.rect(-150, -50, 495.28, 741.89)
r = pages([(A4, offset_page), (A4, offset_page)])
w = PdfWriter(clone_from=r)
for i, p in enumerate(w.pages):
    p.mediabox = RectangleObject([-200, -100, 395.28, 741.89])
    p.cropbox = RectangleObject([-150, -50, 345.28, 691.89])
    if i == 1:
        p[NameObject('/Rotate')] = NumberObject(90)
write(w, 'edit_offset.pdf')

# 3. mixed sizes
write(pages([(A4, label('Mixed A4')), (landscape(A4), label('Mixed A4 landscape')), (letter, label('Mixed Letter')), (A5, label('Mixed A5'))]), 'edit_mixed.pdf')

# 4. 120 pages
write(pages([(A4, label(f'Long page {i + 1}')) for i in range(120)]), 'edit_120.pdf')

# 5. content block with white margins (auto crop)
def block(x0, y0, x1, y1, t):
    def fn(c, size):
        c.setFillColorRGB(0.2, 0.3, 0.7)
        c.rect(x0, y0, x1 - x0, y1 - y0, fill=1, stroke=0)
        c.setFillColorRGB(0, 0, 0)
        c.setFont('Helvetica', 14)
        c.drawString(x0 + 10, y1 + 10, t)
    return fn
write(pages([(A4, block(150, 200, 450, 600, 'Block one')), (A4, block(100, 300, 300, 700, 'Block two'))]), 'edit_margins.pdf')

# 6. letterhead: page 1 = full design, page 2 = follow-up design
def lh_first(c, size):
    w, h = size
    c.setFillColorRGB(0.05, 0.45, 0.42)
    c.rect(0, h - 90, w, 90, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont('Helvetica-Bold', 26)
    c.drawString(50, h - 58, 'Musterfirma GmbH')
    c.setFillColorRGB(0.05, 0.45, 0.42)
    c.rect(0, 0, w, 30, fill=1, stroke=0)
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.setFont('Helvetica', 8)
    c.drawString(50, 40, 'Musterstrasse 1 - 12345 Musterstadt - Briefkopf Erstseite')
def lh_follow(c, size):
    w, h = size
    c.setFillColorRGB(0.05, 0.45, 0.42)
    c.rect(0, h - 24, w, 24, fill=1, stroke=0)
    c.setFillColorRGB(0.3, 0.3, 0.3)
    c.setFont('Helvetica', 8)
    c.drawString(50, 40, 'Briefkopf Folgeseite')
write(pages([(A4, lh_first), (A4, lh_follow)]), 'edit_letterhead.pdf')

# 7. letter body without background (3 pages) for the letterhead test
def body(i):
    def fn(c, size):
        c.setFont('Helvetica', 12)
        c.drawString(70, 650, f'Brieftext Seite {i}')
    return fn
write(pages([(A4, body(i + 1)) for i in range(3)]), 'edit_letter.pdf')

# 8. pages with big labels P1..P10 for n-up / booklet order checks
def big(i):
    def fn(c, size):
        w, h = size
        c.setFont('Helvetica-Bold', 60)
        c.drawCentredString(w / 2, h / 2, f'P{i}')
        c.setFont('Helvetica', 10)
        c.drawString(40, 40, f'marker{i:02d}')
    return fn
write(pages([(A4, big(i + 1)) for i in range(6)]), 'edit_p6.pdf')
write(pages([(A4, big(i + 1)) for i in range(10)]), 'edit_p10.pdf')

# 9. watermark logo with transparency
im = Image.new('RGBA', (600, 300), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle([10, 10, 590, 290], 40, fill=(200, 30, 60, 180))
d.ellipse([220, 70, 380, 230], fill=(255, 255, 255, 0))
im.save(FIX / 'edit_logo.png')
print('edit fixtures written')
