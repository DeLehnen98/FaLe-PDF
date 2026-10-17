"""Fixtures for test_image_to_svg.py (fixtures/vec/): a small anti-aliased colour logo (PNG), a black-ink
signature/stamp on paper (JPG with noise), a transparent icon (PNG) and a photo-like gradient (JPG)."""
import math, random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent / 'fixtures' / 'vec'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    S = 4   # draw large, scale down = anti-aliased edges like a real export
    # colour logo 320×200: navy rounded square with a white ring, orange circle, green bar
    im = Image.new('RGB', (320 * S, 200 * S), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([20 * S, 20 * S, 180 * S, 180 * S], radius=28 * S, fill=(24, 40, 96))
    d.ellipse([55 * S, 55 * S, 145 * S, 145 * S], fill=(255, 255, 255))
    d.ellipse([75 * S, 75 * S, 125 * S, 125 * S], fill=(24, 40, 96))
    d.ellipse([200 * S, 30 * S, 300 * S, 130 * S], fill=(245, 130, 20))
    d.rectangle([200 * S, 150 * S, 300 * S, 175 * S], fill=(30, 150, 80))
    im.resize((320, 200), Image.LANCZOS).save(OUT / 'logo.png')
    # signature-like ink stroke on slightly grey paper, JPG with noise
    random.seed(4)
    sig = Image.new('RGB', (900 * 2, 300 * 2), (243, 240, 232))
    d = ImageDraw.Draw(sig)
    pts = [(int((60 + t * 7.8) * 2), int((150 + 60 * math.sin(t / 9) + 25 * math.sin(t / 3.1)) * 2)) for t in range(100)]
    d.line(pts, fill=(15, 20, 60), width=12, joint='curve')
    d.ellipse([1300, 180, 1500, 380], outline=(15, 20, 60), width=12)
    sig = sig.resize((900, 300), Image.LANCZOS)
    px = sig.load()
    for y in range(sig.height):
        for x in range(sig.width):
            n = random.randint(-10, 10)
            px[x, y] = tuple(max(0, min(255, c + n)) for c in px[x, y])
    sig.save(OUT / 'signature.jpg', quality=85)
    # transparent icon 128×128: green leaf-ish shape
    ic = Image.new('RGBA', (128 * S, 128 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(ic)
    d.ellipse([16 * S, 30 * S, 112 * S, 98 * S], fill=(40, 160, 90, 255))
    d.polygon([(60 * S, 64 * S), (64 * S, 20 * S), (68 * S, 64 * S)], fill=(20, 110, 60, 255))
    ic.resize((128, 128), Image.LANCZOS).save(OUT / 'icon.png')
    # photo-like gradient
    ph = Image.new('RGB', (600, 400))
    px = ph.load()
    for y in range(400):
        for x in range(600):
            px[x, y] = (int(80 + 150 * x / 600), int(120 + 100 * y / 400), int(200 - 120 * x / 600))
    ph.filter(ImageFilter.GaussianBlur(2)).save(OUT / 'photo.jpg', quality=88)
    print('fixtures in', OUT)


if __name__ == '__main__':
    main()
