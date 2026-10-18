"""Desktop screenshots (Microsoft Store) and the screenshots in manifest.webmanifest (browser install dialog).
Needs the raw desktop captures:  python3 capture.py <de|en> desktop home files viewer doc sheet
  store/graphics/desktop/<lang>/NN_<shot>.png   1920 × 1080, 24-bit PNG  → Partner Center › Store listing › Desktop screenshots
  screenshots/wide-NN.jpg                        1280 × 720 JPEG (German)  → manifest "form_factor": "wide"
  screenshots/narrow-NN.jpg                      540 × 960 JPEG (German, from store/graphics/phone/de) → "form_factor": "narrow"
  site/img/<lang>-desktop.webp                   1120 × 630 (files screen) → start page, "Für Windows und Mac"
The manifest only allows PNG/JPEG here; the files are not precached by the service worker (scripts/build_sw.py,
scripts/vercel-build.mjs) – the browser loads them only for its install dialog."""
import os
from pathlib import Path
from PIL import Image

WORK = Path(os.environ.get('FALE_SHOTS_WORK', '/tmp/fale-store-shots'))
REPO = Path(__file__).resolve().parents[3]
GFX = REPO / 'store' / 'graphics'
SHOTS = ['home', 'files', 'viewer', 'doc', 'sheet']
WIDE = ['home', 'viewer', 'doc']
NARROW = ['01_home.png', '02_sign.png', '06_sheet.png']

for lang in ('de', 'en'):
    out = GFX / 'desktop' / lang
    out.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(SHOTS, 1):
        src = WORK / 'raw' / 'desktop' / lang / f'{s}.png'
        im = Image.open(src).convert('RGB')
        assert im.size == (1920, 1080), (src, im.size)
        im.save(out / f'{i:02d}_{s}.png', optimize=True)
        print('saved', out / f'{i:02d}_{s}.png')
    # start page, section "Für Windows und Mac": the app in a window frame
    Image.open(WORK / 'raw' / 'desktop' / lang / 'files.png').convert('RGB').resize((1120, 630), Image.LANCZOS) \
        .save(REPO / 'site' / 'img' / f'{lang}-desktop.webp', quality=82, method=6)

man = REPO / 'screenshots'
man.mkdir(exist_ok=True)
for i, s in enumerate(WIDE, 1):
    im = Image.open(WORK / 'raw' / 'desktop' / 'de' / f'{s}.png').convert('RGB').resize((1280, 720), Image.LANCZOS)
    im.save(man / f'wide-{i:02d}.jpg', quality=84, optimize=True, progressive=True)
for i, s in enumerate(NARROW, 1):
    im = Image.open(GFX / 'phone' / 'de' / s).convert('RGB').resize((540, 960), Image.LANCZOS)
    im.save(man / f'narrow-{i:02d}.jpg', quality=84, optimize=True, progressive=True)
print('manifest screenshots:', sorted(p.name for p in man.iterdir()))
