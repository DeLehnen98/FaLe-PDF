"""Generate FaLe PDF app icons (PNG) with Pillow.

Design: deep-ink indigo rounded tile, white page with folded corner,
text lines and a teal bookmark ribbon. Run: python3 scripts/make_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

INK_TOP = (49, 46, 129)      # #312E81
INK_BOTTOM = (23, 21, 66)    # #171542
PAGE = (255, 255, 255)
FOLD = (199, 210, 254)       # #C7D2FE
LINE = (165, 180, 252)       # #A5B4FC
TEAL = (45, 212, 191)        # #2DD4BF
TEAL_DARK = (13, 148, 136)   # #0D9488


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(INK_TOP[i] + (INK_BOTTOM[i] - INK_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c)
    return img


def draw_mark(img, cx, cy, s):
    """Draw page+ribbon mark centred at (cx, cy); s = page height in px."""
    d = ImageDraw.Draw(img)
    w, h = s * 0.76, s
    x0, y0 = cx - w / 2, cy - h / 2
    x1, y1 = x0 + w, y0 + h
    fold = w * 0.30
    r = s * 0.06
    # page body (polygon with folded corner top-right) + rounded other corners
    bg = img.copy()
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=PAGE)
    # cut the top-right corner: restore the background inside a triangle
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon([(x1 - fold, y0 - 4), (x1 + 4, y0 - 4), (x1 + 4, y0 + fold)], fill=255)
    img.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # fold triangle
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=FOLD)
    # text lines
    lx0 = x0 + w * 0.16
    lh = s * 0.055
    for i, frac in enumerate([0.50, 0.68, 0.62, 0.40]):
        ly = y0 + h * (0.40 + i * 0.13)
        d.rounded_rectangle([lx0, ly, lx0 + w * frac, ly + lh], radius=lh / 2, fill=LINE)
    # teal ribbon (bookmark) hanging from top-left area
    rx0 = x0 + w * 0.16
    rw = w * 0.20
    ry1 = y0 + h * 0.30
    d.polygon([(rx0, y0), (rx0 + rw, y0), (rx0 + rw, ry1), (rx0 + rw / 2, ry1 - rw * 0.45), (rx0, ry1)], fill=TEAL)
    d.rectangle([rx0, y0, rx0 + rw, y0 + s * 0.02], fill=TEAL_DARK)


def make(size, maskable=False):
    big = size * 4
    if maskable:
        img = gradient(big).convert("RGBA")
        draw_mark(img, big / 2, big / 2, big * 0.52)
    else:
        img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        tile = gradient(big).convert("RGBA")
        mask = Image.new("L", (big, big), 0)
        pad = big * 0.04
        ImageDraw.Draw(mask).rounded_rectangle([pad, pad, big - pad, big - pad], radius=big * 0.22, fill=255)
        img.paste(tile, (0, 0), mask)
        draw_mark(img, big / 2, big / 2, big * 0.60)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    for s in (192, 512):
        make(s).save(OUT / f"icon-{s}.png", optimize=True)
        make(s, maskable=True).save(OUT / f"icon-maskable-{s}.png", optimize=True)
    make(180, maskable=True).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    make(32).save(OUT / "favicon-32.png", optimize=True)
    print("icons written to", OUT)
