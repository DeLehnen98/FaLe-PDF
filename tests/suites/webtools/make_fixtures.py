"""Image + encrypted PDF fixtures for the web tool tests. Run from the webtools folder."""
import random, subprocess, struct, io
from pathlib import Path
from PIL import Image, ImageDraw
OUT = Path(__file__).resolve().parent / 'fixtures'
OUT.mkdir(exist_ok=True)
random.seed(7)

def photo(w, h, gray=False):
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            r = int(128 + 100 * ((x / w) - 0.5) + random.randint(-40, 40))
            g = int(128 + 100 * ((y / h) - 0.5) + random.randint(-40, 40))
            b = int(140 + random.randint(-50, 50))
            d.rectangle([x, y, x + 3, y + 3], fill=(r, g, b))
    for i in range(30):
        x, y = random.randint(0, w), random.randint(0, h)
        d.ellipse([x, y, x + random.randint(40, 300), y + random.randint(40, 300)], fill=(random.randint(0, 255),) * 3 if gray else (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))
    return im.convert('L') if gray else im

photo(2400, 1800).save(OUT / '_big_photo.jpg', quality=95)
photo(2400, 1800, gray=True).save(OUT / '_gray_photo.jpg', quality=95)
photo(1600, 1200).save(OUT / '_flat_photo.png')
a = Image.new('RGBA', (800, 600), (0, 0, 0, 0))
ImageDraw.Draw(a).ellipse([50, 50, 750, 550], fill=(220, 40, 60, 200))
a.save(OUT / 'alpha.png')

# EXIF orientation 6: stored landscape 1200x800 with a RED band on the LEFT → displayed portrait 800x1200 with red on TOP
im = Image.new('RGB', (1200, 800), (40, 90, 200))
ImageDraw.Draw(im).rectangle([0, 0, 150, 800], fill=(230, 20, 20))
exif = Image.Exif(); exif[0x0112] = 6
im.save(OUT / 'photo_exif6.jpg', quality=90, exif=exif.tobytes())
# plain landscape photo (orientation 1) with a green band on top
im = Image.new('RGB', (1000, 700), (200, 200, 60))
ImageDraw.Draw(im).rectangle([0, 0, 1000, 90], fill=(20, 160, 60))
im.save(OUT / 'landscape.jpg', quality=88)
photo(640, 480).save(OUT / 'photo.webp', quality=85)
Image.new('P', (300, 200), 3).save(OUT / 'anim.gif')
photo(320, 240).save(OUT / 'pic.bmp')
try:
    photo(400, 300).save(OUT / 'pic.avif', quality=60)
except Exception as e:
    print('no avif', e)
# fake HEIC: correct "ftyp heic" box, but no decodable image (Chromium cannot decode HEIC anyway)
box = struct.pack('>I', 24) + b'ftypheic' + struct.pack('>I', 0) + b'mif1heic'
(OUT / 'iphone.heic').write_bytes(box + b'\0' * 2000)
(OUT / 'broken.pdf').write_bytes(b'this is not a pdf at all' * 50)
print('image fixtures written')
