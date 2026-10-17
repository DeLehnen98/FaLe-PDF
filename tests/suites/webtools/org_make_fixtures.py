"""Fixtures for the organize/optimize tools (agent "org"). Writes fixtures/org/*.pdf. Run from anywhere."""
import io, random, re, zlib
from pathlib import Path
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, A5, letter, landscape
from reportlab.lib.colors import Color, CMYKColor
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject

OUT = Path(__file__).resolve().parent / 'fixtures' / 'org'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(11)


def text_page(c, size, big, small='', color=(0.1, 0.1, 0.35)):
    w, h = size
    c.setPageSize(size)
    c.setFillColorRGB(*color)
    c.setFont('Helvetica-Bold', 30)
    c.drawString(50, h - 90, big)
    if small:
        c.setFillColorRGB(0.2, 0.2, 0.2)
        c.setFont('Helvetica', 12)
        c.drawString(50, h - 120, small)
    c.setFillColorRGB(0.85, 0.3, 0.2)
    c.rect(50, 60, 120, 60, fill=1, stroke=0)


# 1) mixed: 12 pages, sizes, /Rotate, bookmarks ------------------------------------------------
buf = io.BytesIO()
c = canvas.Canvas(buf)
sizes = [A4, A4, landscape(A4), letter, A4, A5, A4, landscape(A4), A4, A4, letter, A4]
for i, s in enumerate(sizes, 1):
    text_page(c, s, f'Seite {i}', f'Testseite {i} von 12 – Größe {round(s[0])}×{round(s[1])}')
    c.showPage()
c.save()
r = PdfReader(io.BytesIO(buf.getvalue()))
w = PdfWriter()
for i, p in enumerate(r.pages):
    if i == 6:
        p.rotate(90)  # page 7 shown landscape via /Rotate
    w.add_page(p)
for title, pg in (('Kapitel Eins', 0), ('Kapitel Zwei', 4), ('Anhang: Tabellen/Daten', 9)):
    w.add_outline_item(title, pg)
w.write(OUT / 'org_mixed.pdf')

# 2) 150 numbered pages -------------------------------------------------------------------------------
buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=A4)
for i in range(1, 151):
    text_page(c, A4, f'Seite {i}', 'Lange Testdatei')
    c.showPage()
c.save()
(OUT / 'org_150.pdf').write_bytes(buf.getvalue())

# 3) blank pages: content / blank / scanner-noise blank / page number only / one short line ----------
def noise_scan(dark_edge=True, dots=180):
    im = Image.new('L', (850, 1100), 250)
    d = ImageDraw.Draw(im)
    for _ in range(dots):
        x, y = random.randint(0, 849), random.randint(0, 1099)
        d.point((x, y), fill=random.randint(80, 180))
    if dark_edge:
        d.rectangle([0, 0, 849, 14], fill=40)     # scanner lid shadow at the top
        d.rectangle([838, 0, 849, 1099], fill=60)  # dark right edge
    return im

buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=A4)
W, H = A4
kinds = []
def add(kind):
    kinds.append(kind)
add('content'); text_page(c, A4, 'Inhalt 1', 'Erste Seite mit Text'); c.showPage()
add('blank'); c.setPageSize(A4); c.showPage()
add('content'); text_page(c, A4, 'Inhalt 2', 'Noch mehr Text'); c.drawString(50, 400, 'Ein Absatz mit ein paar Wörtern.'); c.showPage()
add('noise'); c.setPageSize(A4)
b = io.BytesIO(); noise_scan().save(b, 'PNG'); b.seek(0)
from reportlab.lib.utils import ImageReader
c.drawImage(ImageReader(b), 0, 0, W, H); c.showPage()
add('pagenum'); c.setPageSize(A4); c.setFont('Helvetica', 9); c.drawString(W / 2 - 4, 30, '5'); c.showPage()
add('content'); text_page(c, A4, 'Inhalt 3'); c.showPage()
add('blank'); c.setPageSize(A4); c.showPage()
add('content-scan'); c.setPageSize(A4)
im = noise_scan(); d = ImageDraw.Draw(im)
for k in range(14):
    d.rectangle([90, 120 + k * 50, 700, 140 + k * 50], fill=30)
b = io.BytesIO(); im.save(b, 'PNG'); b.seek(0)
c.drawImage(ImageReader(b), 0, 0, W, H); c.showPage()
add('shortline'); c.setPageSize(A4); c.setFont('Helvetica', 10); c.setFillColorRGB(0, 0, 0); c.drawString(200, 420, 'Nur eine kurze Notiz.'); c.showPage()
add('dust'); c.setPageSize(A4)
im = noise_scan(dots=400); d = ImageDraw.Draw(im)
for _ in range(60):
    x, y = random.randint(60, 780), random.randint(60, 1040)
    d.rectangle([x, y, x + 2, y + 2], fill=random.randint(60, 140))
b = io.BytesIO(); im.save(b, 'PNG'); b.seek(0)
c.drawImage(ImageReader(b), 0, 0, W, H); c.showPage()
c.save()
(OUT / 'org_blank.pdf').write_bytes(buf.getvalue())
print('blank kinds', kinds)

# 4) duplex scans -----------------------------------------------------------------------------
def pages_pdf(path, labels, size=A4):
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=size)
    for l in labels:
        text_page(c, size, l); c.showPage()
    c.save(); (OUT / path).write_bytes(buf.getvalue())
pages_pdf('org_fronts.pdf', ['Vorderseite 1', 'Vorderseite 2', 'Vorderseite 3'])
pages_pdf('org_backs.pdf', ['Rueckseite 3', 'Rueckseite 2', 'Rueckseite 1'])
pages_pdf('org_duplex.pdf', ['Vorderseite 1', 'Vorderseite 2', 'Vorderseite 3', 'Rueckseite 3', 'Rueckseite 2', 'Rueckseite 1'])
pages_pdf('org_c.pdf', ['Drittens 1', 'Drittens 2'])

# 5) book scan: cover (portrait), 2-up spreads with the gutter at 47 %, last page portrait ---------------
buf = io.BytesIO(); c = canvas.Canvas(buf)
c.setPageSize(A4); text_page(c, A4, 'Umschlag'); c.showPage()
SW, SH = 842, 595
gut = SW * 0.47
for k in range(2):
    c.setPageSize((SW, SH))
    left, right = 2 + 2 * k, 3 + 2 * k
    for x0, x1, num in ((0, gut, left), (gut, SW, right)):
        c.setFillColorRGB(0.1, 0.1, 0.1)
        c.setFont('Helvetica-Bold', 26)
        c.drawString(x0 + 30, SH - 70, f'Buchseite {num}')
        c.setFont('Helvetica', 11)
        for line in range(18):
            c.drawString(x0 + 30, SH - 110 - line * 22, 'Text text text text text text text text text text text'[: int((x1 - x0 - 60) / 6)])
    c.showPage()
c.setPageSize(A4); text_page(c, A4, 'Rueckseite'); c.showPage()
c.save()
(OUT / 'org_book.pdf').write_bytes(buf.getvalue())

# 6) colour: rg/RG, CMYK, cs/scn, form XObject, Flate RGB image, JPEG image, shading page ---------------
buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=A4)
c.setFillColorRGB(0.9, 0.1, 0.1); c.setFont('Helvetica-Bold', 28); c.drawString(50, 760, 'Rot und Bunt')
c.setStrokeColorRGB(0.1, 0.2, 0.9); c.setLineWidth(6); c.line(50, 740, 400, 740)
c.setFillColor(CMYKColor(0, 0.8, 0.9, 0)); c.rect(50, 600, 150, 100, fill=1, stroke=0)
c.setStrokeColor(CMYKColor(0.9, 0, 0.2, 0)); c.rect(250, 600, 150, 100, fill=0, stroke=1)
c.beginForm('logo'); c.setFillColorRGB(0.1, 0.7, 0.2); c.circle(40, 40, 35, fill=1, stroke=0); c.endForm()
c.doForm('logo')
im = Image.new('RGB', (200, 140)); d = ImageDraw.Draw(im)
for x in range(200):
    d.line([(x, 0), (x, 139)], fill=(x, 255 - x, 120))
b = io.BytesIO(); im.save(b, 'PNG'); b.seek(0)
c.drawImage(ImageReader(b), 50, 380, 200, 140)
im2 = Image.new('RGB', (300, 200), (30, 120, 220)); ImageDraw.Draw(im2).ellipse([40, 30, 260, 170], fill=(240, 200, 20))
b2 = io.BytesIO(); im2.save(b2, 'JPEG', quality=90); b2.seek(0)
c.drawImage(ImageReader(b2), 300, 380, 200, 133)
c.setFillColorRGB(0, 0, 0); c.setFont('Helvetica', 14); c.drawString(50, 300, 'Schwarzer Text bleibt Text')
c.showPage()
c.setFillColorRGB(0.2, 0.5, 0.8); c.setFont('Helvetica-Bold', 24); c.drawString(50, 760, 'Verlauf')
c.linearGradient(50, 300, 500, 700, (Color(1, 0, 0), Color(0, 0, 1)), extend=False)
c.showPage()
c.setFillColorRGB(0.5, 0.0, 0.5); c.setFont('Helvetica', 20); c.drawString(50, 760, 'Seite drei lila')
c.showPage()
c.save()
(OUT / 'org_color.pdf').write_bytes(buf.getvalue())

# 6b) mesh gradient (shading type 4, colour per vertex) – cannot be converted to gray directly
def raw_pdf(objs):
    out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'); offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f'{i} 0 obj\n'.encode() + o + b'\nendobj\n'
    x = len(out)
    out += f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'.encode() + b''.join(b'%010d 00000 n \n' % o for o in offs)
    out += f'trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n'.encode()
    return bytes(out)
tri = bytes([0, 10, 10, 255, 0, 0, 0, 240, 20, 0, 200, 0, 0, 120, 240, 0, 0, 255])
content = b'BT /F1 24 Tf 0 0 1 rg 50 760 Td (Mesh Verlauf) Tj ET /Sh0 sh'
objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> /Shading << /Sh0 5 0 R >> >> >>',
        b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream',
        b'<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 595 0 842 0 1 0 1 0 1] /Length %d >>\nstream\n' % len(tri) + tri + b'\nendstream',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
(OUT / 'org_mesh.pdf').write_bytes(raw_pdf(objs))

# 6c) book spread stored portrait with /Rotate 90 (shown landscape)
buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=(595, 842))
for k, (tx, ty, ang) in enumerate(((595, 0, 90), (0, 842, -90))):
    c.saveState(); c.translate(tx, ty); c.rotate(ang)
    for x0, num in ((0, 'Links'), (421, 'Rechts')):
        c.setFont('Helvetica-Bold', 26); c.drawString(x0 + 30, 595 - 70, f'Gedreht{k + 1} {num}')
        c.setFont('Helvetica', 11)
        for line in range(14): c.drawString(x0 + 30, 595 - 110 - line * 22, 'Text text text text text text text text')
    c.restoreState(); c.showPage()
c.save()
r = PdfReader(io.BytesIO(buf.getvalue())); w = PdfWriter()
for p, rot in zip(r.pages, (90, 270)): p.rotate(rot); w.add_page(p)
w.write(OUT / 'org_book_rot.pdf')

# 7) broken files (from org_mixed) ----------------------------------------------------------------
# uncompressed source so structures are visible
w = PdfWriter(clone_from=PdfReader(OUT / 'org_mixed.pdf'))
src_b = io.BytesIO(); w.write(src_b); src = src_b.getvalue()
(OUT / 'org_plain.pdf').write_bytes(src)
# truncated: last 25 % gone (xref + trailer + some objects)
(OUT / 'org_trunc.pdf').write_bytes(src[: int(len(src) * 0.75)])
# bad xref offsets: shift every offset by 37
def bad_xref(b):
    m = re.search(rb'xref\s*\n0 (\d+)\s*\n', b)
    start = m.end(); n = int(m.group(1))
    entries = b[start:start + 20 * n]
    fixed = bytearray()
    for k in range(n):
        e = entries[20 * k: 20 * k + 20]
        off = int(e[:10]) + (37 if k else 0)
        fixed += b'%010d' % off + e[10:]
    return b[:start] + bytes(fixed) + b[start + 20 * n:]
(OUT / 'org_badxref.pdf').write_bytes(bad_xref(src))
# missing trailer + xref (cut at "xref")
cut = src.rfind(b'xref')
(OUT / 'org_notrailer.pdf').write_bytes(src[:cut])
# broken page tree: /Pages object's /Kids replaced by a dangling ref, /Count wrong
m = re.search(rb'/Type /Pages', src)
seg_start = src.rfind(b'obj', 0, m.start())
seg_end = src.find(b'endobj', m.start())
seg = src[seg_start:seg_end]
seg2 = re.sub(rb'/Kids \[[^\]]*\]', lambda mm: b'/Kids [ 999 0 R ]' + b' ' * (len(mm.group(0)) - len(b'/Kids [ 999 0 R ]')), seg)
(OUT / 'org_badtree.pdf').write_bytes(src[:seg_start] + seg2 + src[seg_end:])
# garbled object in the middle (pdf-lib can't parse it, the xref still lets a reader find the pages)
m = re.search(rb'/Producer', src)
(OUT / 'org_garbled.pdf').write_bytes(src[:m.start()] + b'/Producer << [ (' + src[m.start() + 15:])
# damaged object headers ("obj" keyword broken in the first three objects)
(OUT / 'org_badobj.pdf').write_bytes(src.replace(b'obj', b'obi', 3))
print('org fixtures written to', OUT)
