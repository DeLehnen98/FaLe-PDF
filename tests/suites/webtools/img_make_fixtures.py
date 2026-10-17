"""Fixtures for the image tools (agent img): photos with EXIF/GPS/XMP/comments/trailer, PNG/WebP with
metadata, a document photo on a desk (for the scanner), a portrait-like photo, transparent PNG, big photos."""
import io, math, random, struct
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / 'fixtures' / 'img'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(7)

def photo(w, h, seed=1):
    """Photo-like content: gradients + shapes + noise (compresses like a real photo)."""
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(0, w):
            px[x, y] = (int(120 + 100 * math.sin(x / (w / 6) + seed)), int(110 + 90 * math.cos(y / (h / 5))), int(140 + 80 * math.sin((x + y) / (w / 3))))
    d = ImageDraw.Draw(im)
    for i in range(40):
        x, y = random.randrange(w), random.randrange(h)
        r = random.randrange(10, max(11, w // 8))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randrange(256), random.randrange(256), random.randrange(256)))
    im = im.filter(ImageFilter.GaussianBlur(1.2))
    noise = Image.effect_noise((w, h), 18).convert('RGB')
    return Image.blend(im, noise, 0.12)

def rat(v):
    from fractions import Fraction
    f = Fraction(v).limit_denominator(10000)
    return (f.numerator, f.denominator)

def gps_exif(img, orientation=1, lat=(52, 31, 12.345), lon=(13, 24, 36.9)):
    ex = img.getexif()
    ex[0x010F] = 'FaLeCam'
    ex[0x0110] = 'Testphone 12 Pro'
    ex[0x0131] = 'Test 17.2'
    ex[0x0132] = '2024:05:17 14:03:22'
    ex[0x013B] = 'Max Mustermann'
    ex[0x0112] = orientation
    exif_ifd = ex.get_ifd(0x8769)
    exif_ifd[0x9003] = '2024:05:17 14:03:21'
    exif_ifd[0x829D] = 1.8
    exif_ifd[0x8827] = 100
    exif_ifd[0xA431] = 'SN-123456789'
    exif_ifd[0xA434] = 'Back camera 6.86mm f/1.78'
    gps = ex.get_ifd(0x8825)
    gps[1] = 'N'; gps[2] = lat
    gps[3] = 'E'; gps[4] = lon
    gps[5] = b'\x00'; gps[6] = 41.5
    return ex

# 1) JPEG with EXIF (GPS, camera, serial, orientation 6), XMP, COM, MPF-like trailer
base = photo(800, 600)
d = ImageDraw.Draw(base); d.rectangle([0, 0, 800, 60], fill=(220, 30, 30))   # red band on top of the stored image (→ right after rotation 6)
ex = gps_exif(base, orientation=6)
buf = io.BytesIO()
xmp = b'<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="FaLe Test Editor 2"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
base.save(buf, 'JPEG', quality=90, exif=ex.tobytes(), xmp=xmp, comment=b'Urlaub bei Oma, Musterstrasse 5')
jb = buf.getvalue() + b'SEFT-trailer-with-private-data' * 10
(OUT / 'gps_photo.jpg').write_bytes(jb)

# 2) JPEG without metadata
buf = io.BytesIO(); photo(640, 480, 3).save(buf, 'JPEG', quality=88); (OUT / 'clean.jpg').write_bytes(buf.getvalue())

# 3) PNG with tEXt + eXIf (GPS), transparency
p = Image.new('RGBA', (400, 300), (0, 0, 0, 0))
dd = ImageDraw.Draw(p); dd.ellipse([50, 30, 350, 270], fill=(30, 120, 220, 255)); dd.rectangle([150, 120, 250, 180], fill=(250, 200, 0, 128))
from PIL import PngImagePlugin
info = PngImagePlugin.PngInfo(); info.add_text('Author', 'Erika Musterfrau'); info.add_text('Comment', 'privat')
pe = Image.Exif(); pe[0x010F] = 'FaLeCam'; g = pe.get_ifd(0x8825); g[1] = 'N'; g[2] = (48, 8, 6.0); g[3] = 'E'; g[4] = (11, 34, 30.0)
p.save(OUT / 'meta.png', pnginfo=info, exif=pe.tobytes())

# 4) WebP with EXIF + XMP
w = photo(500, 400, 5); we = gps_exif(w, orientation=1, lat=(40, 41, 21.0), lon=(74, 2, 40.0))
w.save(OUT / 'meta.webp', 'WEBP', quality=85, exif=we.tobytes(), xmp=xmp)

# 5) big phone photo 4032x3024 with EXIF (orientation 6)
big = photo(1008, 756, 9).resize((4032, 3024), Image.BICUBIC)
nz = Image.effect_noise((4032, 3024), 25).convert('RGB'); big = Image.blend(big, nz, 0.08)
be = gps_exif(big, orientation=6)
big.save(OUT / 'phone_big.jpg', 'JPEG', quality=92, exif=be.tobytes())

# 6) document photographed on a desk (perspective) for the scanner
W, H = 1600, 1200
desk = Image.new('RGB', (W, H), (92, 64, 44))
dk = ImageDraw.Draw(desk)
for i in range(0, W, 7): dk.line([(i, 0), (i + 200, H)], fill=(100 + (i % 23), 70, 48), width=2)
doc = Image.new('RGB', (840, 1188), (246, 244, 238))
dg = ImageDraw.Draw(doc)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 34); small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
except Exception: font = small = ImageFont.load_default()
dg.text((70, 70), 'RECHNUNG Nr. 2024-117', fill=(20, 20, 20), font=font)
for k in range(28): dg.text((70, 160 + k * 34), f'Position {k + 1:02d}   Beispieltext für die Erkennung   {k * 3 + 7},90 EUR', fill=(30, 30, 30), font=small)
dg.rectangle([60, 60, 780, 1128], outline=(40, 40, 40), width=3)
quad = [(430, 95), (1150, 160), (1215, 1135), (365, 1095)]  # TL TR BR BL in desk coords (portrait page, camera tilted)
def coeffs(src, dst):
    import numpy as np
    A = []; B = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return list(np.linalg.solve(np.array(A, float), np.array(B, float)))
c = coeffs([(0, 0), (840, 0), (840, 1188), (0, 1188)], quad)
warped = doc.transform((W, H), Image.PERSPECTIVE, c, Image.BICUBIC)
mask = Image.new('L', (840, 1188), 255).transform((W, H), Image.PERSPECTIVE, c, Image.BILINEAR)
desk.paste(warped, (0, 0), mask)
shade = Image.linear_gradient('L').resize((W, H)).point(lambda v: 255 - v // 3)
desk = Image.composite(desk, Image.new('RGB', (W, H), (0, 0, 0)), shade)
desk = desk.filter(ImageFilter.GaussianBlur(0.8))
desk.save(OUT / 'doc_photo.jpg', 'JPEG', quality=90)
(OUT / 'doc_quad.txt').write_text(' '.join(f'{x / W:.4f},{y / H:.4f}' for x, y in quad))

# 7) portrait-like photo for the passport tool (light background, face oval)
pp = Image.new('RGB', (900, 1200), (214, 218, 222))
pd = ImageDraw.Draw(pp)
pd.ellipse([300, 300, 600, 700], fill=(224, 182, 150))   # face
pd.ellipse([370, 450, 410, 480], fill=(40, 40, 40)); pd.ellipse([490, 450, 530, 480], fill=(40, 40, 40))  # eyes
pd.rectangle([250, 700, 650, 1200], fill=(40, 60, 110))  # shoulders
pd.ellipse([290, 250, 610, 420], fill=(70, 45, 30))  # hair
pp.save(OUT / 'portrait.jpg', 'JPEG', quality=92)

# 8) small transparent PNG logo, GIF, a 1x1 and an extreme panorama
lg = Image.new('RGBA', (300, 300), (0, 0, 0, 0)); ImageDraw.Draw(lg).polygon([(150, 10), (290, 290), (10, 290)], fill=(200, 0, 120, 255)); lg.save(OUT / 'logo.png')
Image.new('RGB', (1, 1), (10, 200, 10)).save(OUT / 'tiny.png')
photo(3000, 300, 11).save(OUT / 'panorama.jpg', 'JPEG', quality=85)
print('ok', sorted(p.name for p in OUT.iterdir()))
