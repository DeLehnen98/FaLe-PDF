"""Big inputs for the freeze/hang sweep (stress_run.py) – written to fixtures/stress_*:
  stress_300p.pdf      300 text pages with headings (large page count)
  stress_photos.pdf    12 pages, each a 3000×4000 photo-like JPEG (~30 MB, image-heavy)
  stress_big.jpg       6000×8000 photo-like JPEG (48 MP)
  stress_big.png       4000×3000 PNG with alpha
  stress_long.txt      2 MB of text
"""
import io, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

FIX = Path(__file__).resolve().parent / 'fixtures'
FIX.mkdir(exist_ok=True)
random.seed(7)

def photo(w, h, seed):
    """Photo-like content: smooth gradients + shapes + fine noise (JPEG does not shrink it to nothing)."""
    rnd = random.Random(seed)
    small = Image.new('RGB', (w // 8, h // 8))
    d = ImageDraw.Draw(small)
    for _ in range(60):
        x, y = rnd.randrange(w // 8), rnd.randrange(h // 8)
        r = rnd.randrange(20, 160)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)))
    img = small.filter(ImageFilter.GaussianBlur(6)).resize((w, h), Image.BILINEAR)
    noise = Image.effect_noise((w, h), 24).convert('RGB')
    return Image.blend(img, noise, 0.12)

def main():
    p = FIX / 'stress_300p.pdf'
    if not p.exists():
        c = canvas.Canvas(str(p), pagesize=A4)
        for i in range(300):
            if i % 10 == 0:
                c.setFont('Helvetica-Bold', 22); c.drawString(72, 770, f'Kapitel {i // 10 + 1}')
            c.setFont('Helvetica', 10)
            for k in range(48):
                c.drawString(72, 740 - k * 14, f'Seite {i + 1}, Zeile {k + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.')
            c.drawString(500, 30, str(i + 1))
            c.showPage()
        c.save()
    p = FIX / 'stress_photos.pdf'
    if not p.exists():
        c = canvas.Canvas(str(p), pagesize=A4)
        for i in range(12):
            b = io.BytesIO(); photo(3000, 4000, i).save(b, 'JPEG', quality=88); b.seek(0)
            c.drawImage(ImageReader(b), 0, 0, *A4)
            c.showPage()
        c.save()
    p = FIX / 'stress_big.jpg'
    if not p.exists():
        photo(6000, 8000, 99).save(p, 'JPEG', quality=90)
    p = FIX / 'stress_big.png'
    if not p.exists():
        im = photo(4000, 3000, 5).convert('RGBA')
        a = Image.new('L', im.size, 255); ImageDraw.Draw(a).ellipse([200, 200, 3800, 2800], fill=180)
        im.putalpha(a); im.save(p)
    p = FIX / 'stress_long.txt'
    if not p.exists():
        p.write_text('\n'.join(f'Zeile {i}: Ein ganz normaler Satz mit Umlauten äöü und Zahlen {i * 7}.' for i in range(30000)), encoding='utf-8')
    for f in sorted(FIX.glob('stress_*')):
        print(f.name, f'{f.stat().st_size / 1e6:.1f} MB')

if __name__ == '__main__':
    main()
