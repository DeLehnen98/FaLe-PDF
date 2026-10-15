#!/usr/bin/env python3
"""Rendered images of the Vorlagen-Archiv (run by hand after adding jobs or avatars, like webtools/make_og.py):

    network/assets/vorlagen/avatar/<id>.png   placeholder portraits (600 x 800) for the CV builder prefill
    network/assets/vorlagen/cv/<vorlage>.webp first page of each example CV, rendered with the real CV engine
                                              (lib/tpl-cv.js + pdf.js) – exactly what "Vorlage verwenden" produces

Needs Playwright + Chromium and Pillow. The SVG portraits and the pages come from build.py; run that first:
    python3 network/tools/build_pages.py && python3 network/tools/webtools/build.py
    python3 network/tools/vorlagen/make_assets.py [--only <vorlage-id> …] [--force]
"""
import base64
import functools
import http.server
import io
import sys
sys.dont_write_bytecode = True  # no __pycache__ inside the deployed folder
import threading
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent            # network/
sys.path.insert(0, str(HERE))
from avatars import AVATARS, avatar_svg  # noqa: E402
import build as vb  # noqa: E402

OUT_AV = ROOT / 'assets' / 'vorlagen' / 'avatar'
OUT_CV = ROOT / 'assets' / 'vorlagen' / 'cv'

RENDER = """async ({ id, width }) => {
  const { cvPdf, loadPhotoSource, cropPhoto } = await import('/assets/wt/lib/tpl-cv.js');
  const { openPdfjs, renderPage } = await import('/assets/wt/lib/pdf.js');
  const data = await (await fetch(`/vorlagen/data/${id}.json`)).json();
  const { photo, ...cv } = data.cv;
  let ph = null;
  if (photo) {
    const blob = await (await fetch(photo)).blob();
    ph = await cropPhoto(await loadPhotoSource(blob), { zoom: 1, cx: 0.5, cy: 0.45 }, cv.photoShape || 'circle');
  }
  const { bytes } = await cvPdf({ ...cv, date: '', signLine: false }, data.lang, ph);
  const doc = await openPdfjs(bytes);
  const canvas = await renderPage(await doc.getPage(1), { width });
  return canvas.toDataURL('image/png');
}"""


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm'}

    def log_message(self, *a):
        pass


def main():
    args = sys.argv[1:]
    force = '--force' in args
    only = set(args[args.index('--only') + 1:]) if '--only' in args else set()
    OUT_AV.mkdir(parents=True, exist_ok=True)
    OUT_CV.mkdir(parents=True, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{srv.server_address[1]}'
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 300, 'height': 400}, device_scale_factor=2)
        for aid in AVATARS:
            out = OUT_AV / f'{aid}.png'
            if out.exists() and not force:
                continue
            page.set_content(f'<html><body style="margin:0">{avatar_svg(aid)}</body></html>')
            png = page.locator('svg').screenshot()
            img = Image.open(io.BytesIO(png)).convert('RGB').quantize(colors=128, method=Image.Quantize.MEDIANCUT)
            img.save(out, optimize=True)
            print('avatar', out.name, out.stat().st_size)
        page = browser.new_page()
        page.goto(origin + '/vorlagen/')
        ids = sorted(f.stem for f in (ROOT / 'vorlagen' / 'data').glob('*.json'))
        for vid in ids:
            out = OUT_CV / f'{vid}.webp'
            if (only and vid not in only) or (out.exists() and not force and not only):
                continue
            url = page.evaluate(RENDER, {'id': vid, 'width': vb.THUMB_W})
            img = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB')
            if img.size != (vb.THUMB_W, vb.THUMB_H):
                img = img.resize((vb.THUMB_W, vb.THUMB_H), Image.LANCZOS)
            img.save(out, 'WEBP', quality=80, method=6)
            print('cv', out.name, out.stat().st_size)
        browser.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
