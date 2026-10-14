"""Play icon (512, full-bleed) + feature graphic (DE/EN, 1024x500) + OG image (1200x630)."""
import importlib.util, html, sys
sys.dont_write_bytecode = True  # do not leave scripts/__pycache__ behind
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]  # repository root
OUT = ROOT / 'store' / 'graphics'
import os
WORK = Path(os.environ.get('FALE_SHOTS_WORK', '/tmp/fale-store-shots'))  # build copy, demo files, raw captures
SP = WORK

# --- 1) Play Store icon: same mark as icons/ (scripts/make_icons.py), full-bleed square; Google applies the mask + shadow.
spec = importlib.util.spec_from_file_location('make_icons', ROOT / 'scripts' / 'make_icons.py')
mi = importlib.util.module_from_spec(spec); spec.loader.exec_module(mi)
big = 512 * 4
img = mi.gradient(big).convert('RGBA')
mi.draw_mark(img, big / 2, big / 2, big * 0.60)
icon = img.resize((512, 512), Image.LANCZOS)
icon.save(OUT / 'play-icon-512.png', optimize=True)  # 32-bit PNG (RGBA), opaque

# --- 2) Feature graphic + OG image (HTML/CSS rendered by Chromium)
TXT = {
    'de': dict(claim='PDF & Office –\ngratis, privat, offline', chips=['Ausfüllen & unterschreiben', 'Scannen mit Texterkennung', 'Dokumente, Tabellen, Folien', 'Optionaler KI-Assistent'],
               note='Alle Pro-Funktionen ohne Abo'),
    'en': dict(claim='PDF & office –\nfree, private, offline', chips=['Fill & sign', 'Scan with text recognition', 'Documents, sheets, slides', 'Optional AI assistant'],
               note='All pro features, no subscription'),
}

CSS = """
*{margin:0;box-sizing:border-box}
html,body{width:%(W)dpx;height:%(H)dpx;overflow:hidden}
body{font-family:Inter,system-ui,sans-serif;color:#fff;position:relative;
 background:radial-gradient(%(g1)s at 92%% 110%%, rgba(45,212,191,.42), rgba(45,212,191,0) 62%%),
 radial-gradient(%(g2)s at -5%% -10%%, rgba(142,138,247,.5), rgba(142,138,247,0) 60%%),
 linear-gradient(160deg,#3B37A0 0%%,#24206E 50%%,#141238 100%%)}
.l{position:absolute;left:%(pad)dpx;top:0;bottom:0;width:%(lw)dpx;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:%(bg)dpx}
.brand img{width:%(ic)dpx;height:%(ic)dpx}
.brand b{font-size:%(bn)dpx;font-weight:800;letter-spacing:-.03em}
.brand b span{color:#5EEAD4}
h1{margin-top:%(h1m)dpx;font-size:%(h1)dpx;line-height:1.12;font-weight:800;letter-spacing:-.02em}
ul{list-style:none;padding:0;margin-top:%(ulm)dpx;display:flex;flex-wrap:wrap;gap:%(cg)dpx}
li{font-size:%(cf)dpx;font-weight:600;padding:%(cp)s;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);white-space:nowrap}
.note{margin-top:%(nm)dpx;font-size:%(nf)dpx;color:#C7D2FE;font-weight:500}
.ph{position:absolute;right:%(pr)dpx;top:%(pt)dpx;padding:9px;border-radius:44px;background:#0B0B1C;transform:rotate(6deg);
 box-shadow:0 0 0 2px #2E2F55,0 30px 60px rgba(5,4,25,.6)}
.ph img{display:block;width:%(pw)dpx;border-radius:36px}
"""
GEO = {
    'feature': dict(W=1024, H=500, g1='700px 500px', g2='600px 450px', pad=56, lw=600, bg=16, ic=64, bn=46, h1m=22, h1=40, ulm=22, cg=10, cf=17, cp='8px 14px',
                    nm=18, nf=17, pr=56, pt=40, pw=250),
    'og': dict(W=1200, H=630, g1='820px 620px', g2='700px 560px', pad=70, lw=640, bg=18, ic=76, bn=54, h1m=26, h1=48, ulm=26, cg=12, cf=20, cp='9px 16px',
               nm=22, nf=20, pr=70, pt=48, pw=300),
}


def page(kind, lang):
    t = TXT[lang]; g = GEO[kind]
    shot = (SP / 'raw' / 'phone' / lang / 'home.png').as_uri()
    icon_uri = (ROOT / 'icons' / 'icon-512.png').as_uri()
    chips = ''.join(f'<li>{html.escape(c)}</li>' for c in t['chips'])
    return f"""<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><style>{CSS % g}</style></head><body>
<div class="l"><div class="brand"><img src="{icon_uri}" alt=""><b>FaLe <span>PDF</span></b></div>
<h1>{html.escape(t['claim']).replace(chr(10), '<br>')}</h1><ul>{chips}</ul><p class="note">{html.escape(t['note'])}</p></div>
<div class="ph"><img src="{shot}" alt=""></div></body></html>"""


with sync_playwright() as p:
    b = p.chromium.launch()
    for kind, langs in [('feature', ['de', 'en']), ('og', ['de', 'en'])]:
        g = GEO[kind]
        pg = b.new_page(viewport={'width': g['W'], 'height': g['H']})
        for lang in langs:
            tmp = SP / 'brand_tmp.html'; tmp.write_text(page(kind, lang), encoding='utf-8')
            pg.goto(tmp.as_uri()); pg.wait_for_timeout(300)
            # the text column must not run into the phone mock
            right = pg.evaluate("Math.max(...[...document.querySelectorAll('.l h1, .l li, .l .brand, .l .note')].map(e => e.getBoundingClientRect().right))")
            ph = pg.evaluate("document.querySelector('.ph').getBoundingClientRect().left")
            if right > ph - 16: print('OVERLAP', kind, lang, right, ph)
            out = OUT / (f'feature-graphic-{lang}.png' if kind == 'feature' else f'og-image-{lang}.png')
            pg.screenshot(path=str(out))
            Image.open(out).convert('RGB').save(out, optimize=True)
            print('wrote', out)
    b.close()

# Root copies for the landing page (/og-image.png, /og-image-en.png): 256-colour PNG keeps them ~60 KB
for lang, name in [('de', 'og-image.png'), ('en', 'og-image-en.png')]:
    Image.open(OUT / f'og-image-{lang}.png').convert('RGB').quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(ROOT / name, optimize=True)
    print('wrote', ROOT / name)

# Screenshots for the landing page (info.html / info-en.html)
(ROOT / 'info-assets').mkdir(exist_ok=True)
for lang in ('de', 'en'):
    for n in ('home', 'sign', 'ai'):
        Image.open(SP / 'raw' / 'phone' / lang / f'{n}.png').convert('RGB').resize((540, 1140), Image.LANCZOS).save(ROOT / 'info-assets' / f'{n}-{lang}.webp', quality=74, method=6)
print('wrote info-assets/*.webp')
