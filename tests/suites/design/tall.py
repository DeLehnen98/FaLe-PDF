# Usage: PORT=9101 python3 tall.py out.png width height dark(0/1) hash [extra-js]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shots_lib as L
from playwright.sync_api import sync_playwright
out, w, hgt, dark, hsh = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4] == '1', sys.argv[5]
js = sys.argv[6] if len(sys.argv) > 6 else None
with sync_playwright() as p:
    b = p.chromium.launch()
    phone = w < 600
    ctx = b.new_context(viewport={'width': w, 'height': hgt}, device_scale_factor=2 if phone else 1, is_mobile=phone, has_touch=phone, locale='de-DE', color_scheme='dark' if dark else 'light')
    pg = ctx.new_page(); L.seed(pg)
    pg.evaluate("h => { location.hash = h; }", hsh); pg.wait_for_timeout(1500)
    if js: pg.evaluate(js); pg.wait_for_timeout(800)
    pg.screenshot(path=out); b.close()
