#!/usr/bin/env python3
"""Open Graph images for the FaLe Werkzeuge pages (needs Playwright + Chromium, Pillow), in the style of
network/tools/make_assets.py. Writes network/assets/og/og-tools-{de,en}.png (1200 × 630).

    python3 network/tools/webtools/make_og.py
"""
import sys
from io import BytesIO
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
from build import ICONS, svg  # noqa: E402

ROOT = HERE.parent.parent
LOGO = (ROOT / 'assets/logo/fale-network-mark.svg').as_uri()
TEXT = {
    'de': ('Werkzeuge für PDF und Bilder', 'Direkt im Browser · ohne Upload · ohne Konto', ['Zusammenfügen', 'Komprimieren', 'Bild in PDF']),
    'en': ('Tools for PDFs and images', 'Right in your browser · no upload · no account', ['Merge', 'Compress', 'JPG to PDF']),
}
TILES = [('merge', '#F5B84A'), ('compress', '#C2A4FF'), ('image-pdf', '#3EE0C9')]


def html(lang):
    h, sub, labels = TEXT[lang]
    tiles = ''.join(f'<div class="t"><span style="color:{c}">{svg(ICONS[i])}</span><b>{l}</b></div>' for (i, c), l in zip(TILES, labels))
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
    body{{margin:0;width:1200px;height:630px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#ECEDF8;
      background:radial-gradient(110% 90% at 100% 0%,rgba(45,212,191,.26),transparent 55%),radial-gradient(90% 120% at 0% 100%,rgba(124,108,255,.42),transparent 62%),linear-gradient(160deg,#2A2290 0%,#1A1458 52%,#0E0B2E 100%);
      display:grid;grid-template-columns:1fr 410px}}
    .l{{padding:64px 0 56px 72px;display:flex;flex-direction:column}}
    .brand{{display:flex;align-items:center;gap:18px;font-size:40px;font-weight:800;letter-spacing:-1px}}
    .brand img{{width:72px;height:72px}} .brand b{{color:#C6C4FF}}
    h1{{font-size:70px;line-height:1.03;letter-spacing:-2.4px;margin:52px 0 0;font-weight:800;max-width:660px}}
    p{{margin:auto 0 0;font-size:27px;color:#B9BBE0}}
    .r{{display:grid;gap:18px;align-content:center;padding:0 64px 40px 0}}
    .t{{display:flex;align-items:center;gap:20px;background:rgba(255,255,255,.08);border:1px solid rgba(185,187,224,.25);border-radius:26px;padding:18px 22px}}
    .t span{{display:grid;place-items:center;width:64px;height:64px;border-radius:18px;background:rgba(255,255,255,.1)}}
    .t svg{{width:38px;height:38px;stroke-width:2.4}} .t b{{font-size:28px;font-weight:750}}
    .u{{position:absolute;right:64px;bottom:44px;font-size:26px;font-weight:700;color:#2DD4BF}}
    </style></head><body>
    <div class="l"><div class="brand"><img src="{LOGO}"><span>Fale<b>Network</b></span></div><h1>{h}</h1><p>{sub}</p></div>
    <div class="r">{tiles}</div><span class="u">fale.network</span></body></html>'''


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        for lang in TEXT:
            pg = b.new_page(viewport={'width': 1200, 'height': 630})
            tmp = HERE / f'_og-{lang}.html'
            tmp.write_text(html(lang), encoding='utf-8')
            pg.goto(tmp.as_uri())
            pg.wait_for_load_state('networkidle')
            img = Image.open(BytesIO(pg.screenshot())).convert('RGB')
            tmp.unlink()
            out = ROOT / 'assets/og' / f'og-tools-{lang}.png'
            img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out, optimize=True)
            print(out.relative_to(ROOT), out.stat().st_size)
            pg.close()
        b.close()


if __name__ == '__main__':
    main()
