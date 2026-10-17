import sys, os
from playwright.sync_api import sync_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots')
URL = 'http://127.0.0.1:8850/'
h = sys.argv[1] if len(sys.argv) > 1 else '#/neu/tabelle?vorlage=haushaltsbuch'
name = sys.argv[2] if len(sys.argv) > 2 else 'peek'
phone = (sys.argv[3] if len(sys.argv) > 3 else 'phone') == 'phone'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844} if phone else {'width': 1366, 'height': 860}, has_touch=phone, is_mobile=phone, device_scale_factor=2 if phone else 1)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: print('PAGEERR', e))
    pg.on('console', lambda m: print('CONSOLE', m.type, m.text) if m.type in ('error', 'warning') else None)
    pg.goto(URL); pg.wait_for_timeout(1200)
    pg.evaluate(f"location.hash = {h!r}"); pg.wait_for_timeout(1500)
    js = sys.argv[4] if len(sys.argv) > 4 else ''
    if js: print(pg.evaluate(js)); pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, name + '.png'))
    b.close()
