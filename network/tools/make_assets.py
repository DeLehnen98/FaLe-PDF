#!/usr/bin/env python3
"""FaleNetwork – raster assets from the SVG sources (needs Playwright + Chromium, Pillow).

    python3 network/tools/make_assets.py

Writes: assets/icons/{favicon-32,apple-touch-icon,icon-192,icon-512,icon-maskable-512}.png,
        favicon.ico, assets/og/og-{de,en}.png
"""
from pathlib import Path
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
LOGO = (ROOT / 'assets/logo/fale-network-mark.svg').as_uri()
SQUARE = (ROOT / 'assets/logo/fale-network-mark-square.svg').as_uri()
PDF = (ROOT / 'assets/icons/app-pdf.svg').as_uri()
CLEAN = (ROOT / 'assets/icons/app-clean.svg').as_uri()

OG = {
    'de': ('Apps, die auf deinem Gerät bleiben.', 'Kein Konto nötig · Verarbeitung auf dem Gerät · kein Tracking', 'bald'),
    'en': ('Apps that stay on your device.', 'No account needed · processing on your device · no tracking', 'soon'),
}


def og_html(lang):
    h, sub, soon = OG[lang]
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
    body{{margin:0;width:1200px;height:630px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
      background:linear-gradient(160deg,#312E81 0%,#171542 70%);color:#ECEDF8;display:grid;grid-template-columns:1fr 360px;}}
    .l{{padding:64px 0 56px 72px;display:flex;flex-direction:column}}
    .brand{{display:flex;align-items:center;gap:18px;font-size:40px;font-weight:800;letter-spacing:-1px}}
    .brand img{{width:72px;height:72px}} .brand b{{color:#C6C4FF}}
    h1{{font-size:68px;line-height:1.04;letter-spacing:-2.4px;margin:56px 0 0;font-weight:800;max-width:700px}}
    p{{margin:auto 0 0;font-size:26px;color:#B9BBE0}}
    .r{{display:grid;grid-template-columns:1fr 1fr;gap:26px;align-content:center;padding:0 64px 0 0}}
    .r div{{width:132px;height:132px;border-radius:30px;position:relative}}
    .r img{{width:132px;height:132px}}
    .e{{border:3px dashed rgba(185,187,224,.4)}}
    .bd{{position:absolute;top:-10px;right:-12px;background:#F5C04A;color:#2B2100;font-size:20px;font-weight:800;padding:3px 12px;border-radius:99px}}
    .u{{position:absolute;right:64px;bottom:52px;font-size:26px;font-weight:700;color:#2DD4BF}}
    </style></head><body>
    <div class="l"><div class="brand"><img src="{LOGO}"><span>Fale<b>Network</b></span></div><h1>{h}</h1><p>{sub}</p></div>
    <div class="r"><div><img src="{PDF}"></div><div><img src="{CLEAN}"><span class="bd">{soon}</span></div><div class="e"></div><div class="e"></div></div>
    <span class="u">fale.network</span>
    </body></html>'''


def main():
    icons = ROOT / 'assets/icons'
    with sync_playwright() as p:
        b = p.chromium.launch()

        def render(src, size, transparent=True):
            pg = b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
            pg.set_content(f'<html><body style="margin:0"><img src="{src}" style="display:block;width:{size}px;height:{size}px"></body></html>')
            pg.wait_for_load_state('networkidle')
            png = pg.screenshot(omit_background=transparent)
            pg.close()
            return Image.open(BytesIO(png)).convert('RGBA')

        def save(img, path):
            img.save(path, optimize=True)
            print(path.relative_to(ROOT), path.stat().st_size)

        save(render(LOGO, 32), icons / 'favicon-32.png')
        save(render(LOGO, 192), icons / 'icon-192.png')
        save(render(LOGO, 512), icons / 'icon-512.png')
        save(render(SQUARE, 180, False).convert('RGB'), icons / 'apple-touch-icon.png')
        save(render(SQUARE, 512, False).convert('RGB'), icons / 'icon-maskable-512.png')
        ico = render(LOGO, 64)
        ico.save(ROOT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
        print('favicon.ico', (ROOT / 'favicon.ico').stat().st_size)

        for lang in OG:
            pg = b.new_page(viewport={'width': 1200, 'height': 630})
            tmp = ROOT / 'tools' / f'_og-{lang}.html'
            tmp.write_text(og_html(lang), encoding='utf-8')
            pg.goto(tmp.as_uri())
            pg.wait_for_load_state('networkidle')
            img = Image.open(BytesIO(pg.screenshot())).convert('RGB')
            tmp.unlink()
            out = ROOT / 'assets/og' / f'og-{lang}.png'
            img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out, optimize=True)
            print(out.relative_to(ROOT), out.stat().st_size)
            pg.close()
        b.close()


if __name__ == '__main__':
    main()
