"""Quick look: python3 peek.py '<hash>' out.png [w h] [js-after]"""
import sys, json
from playwright.sync_api import sync_playwright
h = sys.argv[1]; out = sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1366; hh = int(sys.argv[4]) if len(sys.argv) > 4 else 860
js = sys.argv[5] if len(sys.argv) > 5 else None
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': w, 'height': hh}, service_workers='block', locale='de-DE', has_touch=w < 500, is_mobile=w < 500, device_scale_factor=1)
    pg = ctx.new_page()
    msgs = []
    pg.on('console', lambda m: msgs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: msgs.append(f'[pageerror] {e}'))
    pg.goto('http://127.0.0.1:8880/')
    pg.wait_for_timeout(800)
    pg.evaluate(f"location.hash = {json.dumps(h)}")
    pg.wait_for_timeout(2000)
    if js:
        r = pg.evaluate(js)
        print('JS:', r)
        pg.wait_for_timeout(800)
    pg.screenshot(path=out)
    print('\n'.join(msgs[:20]))
    b.close()
