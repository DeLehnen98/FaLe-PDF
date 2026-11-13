#!/usr/bin/env python3
"""Pictures of the Windows setup program (NSIS): windows/src-tauri/installer/sidebar.bmp (164×314, first and last
page) and header.bmp (150×57, the pages in between). Same look as the program („Schreibtisch & Register“,
css/windows.css): the desk, the white sheet, the five index tabs.

    python3 scripts/windows-installer-art.py            writes the two files
    python3 scripts/windows-installer-art.py --check    fails when the committed files differ (CI / tests)

Needs Pillow and the Barlow fonts (OFL) – the wordmark is set in Barlow Semi Condensed, the stand-in for Bahnschrift.
The bitmaps are committed, so the Windows build needs neither."""
import io, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'windows', 'src-tauri', 'installer')
ICON = os.path.join(ROOT, 'icons', 'icon-512.png')
DESK, SHEET, INK, MUTED, EDGE = '#DDE2EA', '#FFFFFF', '#14182B', '#5C6470', '#C3CAD6'
TABS = ['#3448C5', '#A8690F', '#0A7468', '#B13A5A', '#5C6470']  # Start, Dateien, Werkzeuge, Suche, Ich
S = 4  # drawn four times as large, then reduced: smooth edges without anti-aliasing tricks


def font(size, weight='700'):
    for d in (os.path.expanduser('~/.fonts'), '/usr/share/fonts/truetype/barlow', os.path.join(ROOT, 'scripts', 'fonts')):
        p = os.path.join(d, f'barlow-semi-condensed-latin-{weight}-normal.ttf')
        if os.path.exists(p):
            return ImageFont.truetype(p, size * S)
    raise SystemExit('Barlow Semi Condensed not found (see the note at the top of this file)')


def icon(px):
    im = Image.open(ICON).convert('RGBA').resize((px * S, px * S), Image.LANCZOS)
    return im


def sidebar():
    W, H = 164, 314
    im = Image.new('RGB', (W * S, H * S), DESK)
    d = ImageDraw.Draw(im)
    r = lambda x0, y0, x1, y1, **k: d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], **k)
    # the sheet starts at the right edge and runs into the white page of the setup window
    r(150, -8, W + 20, H + 8, radius=0, fill=SHEET)
    # index tabs stick out of the sheet towards the desk; the first one is in front
    y = 34
    for i, c in enumerate(TABS):
        w = 22 if i == 0 else 16
        h = 46
        r(150 - w, y, 156, y + h, radius=5 * S, fill=SHEET if i == 0 else c)
        if i == 0:
            r(150 - w, y, 156, y + h, radius=5 * S, outline=EDGE, width=S)
            d.rectangle([150 * S, (y + 1) * S, 158 * S, (y + h - 1) * S], fill=SHEET)  # attached to the sheet
            r(150 - w + 4, y + 8, 150 - w + 7, y + h - 8, radius=1 * S, fill=c)
        y += h + 6
    # the coloured tabs end where the sheet begins (only their outer corners are round)
    d.rectangle([150 * S + S, 0, W * S, H * S], fill=SHEET)
    d.line([150 * S, 0, 150 * S, 33 * S], fill=EDGE, width=S)
    d.line([150 * S, 81 * S, 150 * S, H * S], fill=EDGE, width=S)
    # mark and name
    ic = icon(56)
    im.paste(ic, (22 * S, 40 * S), ic)
    d.text((22 * S, 108 * S), 'FaLe PDF', font=font(27), fill=INK)
    d.text((23 * S, 141 * S), 'für Windows', font=font(13, '500'), fill=MUTED)
    # a loose sheet on the desk
    sh = Image.new('RGBA', (70 * S, 90 * S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([0, 0, 70 * S - 1, 90 * S - 1], radius=3 * S, fill=SHEET, outline=EDGE, width=S)
    for k, wline in enumerate((44, 52, 36, 50, 28)):
        sd.rounded_rectangle([9 * S, (14 + k * 12) * S, (9 + wline) * S, (18 + k * 12) * S], radius=2 * S, fill='#E3E7EE' if k else TABS[0])
    sh = sh.rotate(-7, resample=Image.BICUBIC, expand=True)
    im.paste(sh, (28 * S, 196 * S), sh)
    return im.resize((W, H), Image.LANCZOS)


def header():
    W, H = 150, 57
    im = Image.new('RGB', (W * S, H * S), SHEET)
    d = ImageDraw.Draw(im)
    ic = icon(34)
    im.paste(ic, ((W - 34 - 10) * S, 11 * S), ic)
    f = font(17)
    tw = d.textlength('FaLe PDF', font=f)
    d.text(((W - 34 - 10 - 8) * S - tw, 17 * S), 'FaLe PDF', font=f, fill=INK)
    return im.resize((W, H), Image.LANCZOS)


def bmp(im):
    b = io.BytesIO()
    im.convert('RGB').save(b, 'BMP')  # 24 bit, uncompressed, bottom-up: what NSIS expects
    return b.getvalue()


def main():
    files = {'sidebar.bmp': bmp(sidebar()), 'header.bmp': bmp(header())}
    if '--check' in sys.argv:
        bad = [n for n, data in files.items() if not os.path.exists(os.path.join(OUT, n)) or open(os.path.join(OUT, n), 'rb').read() != data]
        if bad:
            raise SystemExit('Setup-Bilder nicht aktuell: ' + ', '.join(bad) + ' – python3 scripts/windows-installer-art.py')
        print('Setup-Bilder sind aktuell')
        return
    os.makedirs(OUT, exist_ok=True)
    for n, data in files.items():
        open(os.path.join(OUT, n), 'wb').write(data)
        print(n, len(data), 'Bytes')


if __name__ == '__main__':
    main()
