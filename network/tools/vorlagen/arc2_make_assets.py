#!/usr/bin/env python3
"""Preview images of the CV Design-Galerie (/vorlagen/lebenslauf-designs/), rendered with the real CV engine
(lib/tpl-cv.js + pdf.js) from the gallery examples (/vorlagen/data/design-<id>.json) – exactly what
"Mit diesem Design öffnen" produces. Run by hand after changing designs or examples (needs Playwright + Pillow):

    python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py
    python3 network/tools/vorlagen/arc2_make_assets.py [--only <design> …]

Output: network/assets/vorlagen/designs/<design>-<de|en>.webp (480 × 679, first page).
"""
import base64
import functools
import http.server
import io
import sys
sys.dont_write_bytecode = True
import threading
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / 'assets' / 'vorlagen' / 'designs'
sys.path.insert(0, str(HERE))
from arc2_sections import DESIGN_IDS  # noqa: E402
from make_assets import RENDER, Handler  # noqa: E402

W, H = 480, 679


def main():
    args = sys.argv[1:]
    only = set(args[args.index('--only') + 1:]) if '--only' in args else set()
    OUT.mkdir(parents=True, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f'http://127.0.0.1:{srv.server_address[1]}/vorlagen/')
        for did in DESIGN_IDS:
            if only and did not in only:
                continue
            for lang in ('de', 'en'):
                vid = ('design-' if lang == 'de' else 'en-design-') + did
                url = page.evaluate(RENDER, {'id': vid, 'width': W})
                img = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB')
                if img.size != (W, H):
                    img = img.resize((W, H), Image.LANCZOS)
                out = OUT / f'{did}-{lang}.webp'
                img.save(out, 'WEBP', quality=80, method=6)
                print('design', out.name, out.stat().st_size)
        browser.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
